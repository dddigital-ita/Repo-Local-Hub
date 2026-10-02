import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "./db";
import { getAdminUser, hashPassword, verifyPassword, issueSessionFor } from "./admin";
import { logAudit } from "./audit";

/**
 * Utenti dell'app: RUOLI (super_admin | admin) + Area personale.
 *
 * Estende l'auth di lib/admin (scrypt + cookie firmato + revoca via fingerprint)
 * senza toccarne i meccanismi:
 *  - il RUOLO non viaggia nel cookie: getSuperAdmin lo riverifica sul DB a ogni
 *    richiesta, quindi un declassamento o una disattivazione valgono SUBITO
 *    (nessuna sessione fantasma da attendere);
 *  - le modifiche agli utenti passano tutte da qui e finiscono in audit_log con
 *    l'attore (chi ha fatto cosa), così la gestione utenti è tracciabile.
 */

export type UserRole = "super_admin" | "admin";

/** Campi anagrafici dell'area personale (tutti nullable-safe: DB default ''). */
export interface PersonalInfo {
  firstName: string;
  lastName: string;
  vatNumber: string;
  fiscalCode: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  bio: string;
}

export type AppUser = {
  email: string;
  role: UserRole;
  active: boolean;
  operatorId: string | null;
  displayName: string;
  createdAt: string;
} & PersonalInfo;

function toUser(r: Record<string, unknown>): AppUser {
  return {
    email: r.email as string,
    role: (r.role as UserRole) ?? "admin",
    active: (r.active as boolean) ?? true,
    operatorId: (r.operator_id as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? (r.email as string).split("@")[0],
    createdAt: new Date(r.created_at as Date).toISOString(),
    firstName: (r.first_name as string) ?? "",
    lastName: (r.last_name as string) ?? "",
    vatNumber: (r.vat_number as string) ?? "",
    fiscalCode: (r.fiscal_code as string) ?? "",
    phone: (r.phone as string) ?? "",
    address: (r.address as string) ?? "",
    city: (r.city as string) ?? "",
    province: (r.province as string) ?? "",
    postalCode: (r.postal_code as string) ?? "",
    bio: (r.bio as string) ?? "",
  };
}

/**
 * L'utente corrente con ruolo e dati anagrafici (null se non autenticato).
 * L'IDENTITÀ arriva dal loader memoizzato della richiesta (ADR-005 in
 * lib/admin): la riga `select *` qui resta una sola per richiesta, perché
 * il secondo getAdminUser dentro questa funzione deduplica col primo del
 * layout — prima ogni pagina /admin paginava l'auth 3-4 volte su Neon.
 */
export async function getAppUser() {
  const identity = await getAdminUser();
  if (!identity) return null;
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query("select * from admin_users where email = $1", [
    identity.email.toLowerCase().trim(),
  ]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Guardia per le aree riservate ai super admin (gestione sito e utenti). */
export async function requireSuperAdmin(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "super_admin" || !user.active) redirect("/admin?err=permessi");
  return user;
}

/** L'utente corrente deve esistere ed essere attivo (usato nelle azioni). */
export async function requireActiveUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user || !user.active) redirect("/admin/login");
  return user;
}

/* ── Area personale ────────────────────────────────────────────── */

const TEXT_LIMITS: Partial<Record<keyof PersonalInfo, number>> = {
  firstName: 80,
  lastName: 80,
  vatNumber: 20,
  fiscalCode: 20,
  phone: 30,
  address: 160,
  city: 80,
  province: 3,
  postalCode: 10,
  bio: 500,
};

/** Aggiorna i campi personali dell'utente corrente (mai email né ruolo). */
export async function updateOwnProfile(email: string, fields: Partial<PersonalInfo>): Promise<number> {
  const pool = db();
  if (!pool) throw new Error("db_non_disponibile");
  // Le chiavi del form sono camelCase, le colonne del DB snake_case: la mappa
  // è esplicita (una colonna scrivibile per campo — niente interpolazione di
  // nomi non verificati).
  const COLUMNS: Record<keyof PersonalInfo, string> = {
    firstName: "first_name",
    lastName: "last_name",
    vatNumber: "vat_number",
    fiscalCode: "fiscal_code",
    phone: "phone",
    address: "address",
    city: "city",
    province: "province",
    postalCode: "postal_code",
    bio: "bio",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, max] of Object.entries(TEXT_LIMITS) as [keyof PersonalInfo, number][]) {
    const v = fields[key];
    if (typeof v === "string") {
      sets.push(`${COLUMNS[key]} = $${values.length + 1}`);
      values.push(v.trim().slice(0, max));
    }
  }
  if (!sets.length) return 0;
  values.push(email.toLowerCase().trim());
  await pool.query(`update admin_users set ${sets.join(", ")} where email = $${values.length}`, values);
  return sets.length;
}

/* ── Cambio email ─────────────────────────────────────────────── */

export type ChangeEmailResult =
  | { ok: true }
  | { ok: false; error: "credenziali" | "formato" | "esiste" | "inesistente" | "db" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Cambia l'email del PROPRIO account: richiede la password corrente (l'email
 * è l'identità di login: senza conferma chi lascia il pc aperto potrebbe
 * prenderne possesso). Le sessioni attuali muoiono da sole (il fingerprint della
 * password cambia? No: cambia l'EMAIL nel payload firmato) — per questo qui
 * si ri-emette il cookie con l'identità nuova, come fa il cambio password.
 */
export async function changeOwnEmail(
  currentEmail: string,
  password: string,
  newEmail: string,
): Promise<ChangeEmailResult> {
  const normalized = newEmail.toLowerCase().trim();
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: "formato" };
  if (normalized === currentEmail.toLowerCase().trim()) return { ok: true }; // niente da fare
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  // Anti-enumerazione: verifica password con lo stesso costo anche se l'email
  // di destinazione esiste già (burnScrypt vive in lib/admin, qui riuso verify
  // sul proprio hash: il caso «email già presa» non deve costare zero scrypt).
  const me = await pool.query<{ password_hash: string; active: boolean }>(
    "select password_hash, active from admin_users where email = $1",
    [currentEmail.toLowerCase().trim()],
  );
  const stored = me.rows[0]?.password_hash;
  if (!stored || me.rows[0].active === false) return { ok: false, error: "credenziali" };
  if (!verifyPassword(password, stored)) return { ok: false, error: "credenziali" };
  const clash = await pool.query<{ email: string }>("select email from admin_users where email = $1", [normalized]);
  if (clash.rows[0]) return { ok: false, error: "esiste" };
  try {
    await pool.query("update admin_users set email = $1 where email = $2", [normalized, currentEmail.toLowerCase().trim()]);
  } catch (e) {
    if (String(e).includes("duplicate key")) return { ok: false, error: "esiste" };
    return { ok: false, error: "db" };
  }
  // Audit: il target porta la vecchia email, il dettaglio la nuova.
  await logAudit(normalized, "user.email_change", currentEmail.toLowerCase().trim(), null);
  await issueSessionFor(normalized); // nuovo cookie col payload aggiornato
  return { ok: true };
}

/** Cambia email a un ALTRO utente: solo super admin (niente password richiesta,
 *  ma vietata verso l'ultimo super admin? No: l'email non cambia i privilegi,
 *  resta lo stesso account). Le sessioni dell'utente muoiono: il payload
 *  firmato porta la vecchia email e il check sul DB non la trova più. */
export async function setUserEmail(actor: string, oldEmail: string, newEmail: string): Promise<ChangeEmailResult> {
  const normalized = newEmail.toLowerCase().trim();
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: "formato" };
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const oldN = oldEmail.toLowerCase().trim();
  if (normalized === oldN) return { ok: true };
  const target = await pool.query<{ email: string }>("select email from admin_users where email = $1", [oldN]);
  if (!target.rows[0]) return { ok: false, error: "inesistente" };
  const clash = await pool.query<{ email: string }>("select email from admin_users where email = $1", [normalized]);
  if (clash.rows[0]) return { ok: false, error: "esiste" };
  try {
    await pool.query("update admin_users set email = $1 where email = $2", [normalized, oldN]);
  } catch (e) {
    if (String(e).includes("duplicate key")) return { ok: false, error: "esiste" };
    return { ok: false, error: "db" };
  }
  await logAudit(actor, "user.email_change", oldN, `→ ${normalized}`);
  if (oldN === actor.toLowerCase().trim()) await issueSessionFor(normalized);
  return { ok: true };
}

/* ── Gestione utenti (solo super admin) ────────────────────────── */

export async function listUsers(): Promise<AppUser[]> {
  const pool = db();
  if (!pool) return [];
  const { rows } = await pool.query("select * from admin_users order by created_at asc");
  return rows.map(toUser);
}

export interface CreateUserData {
  email: string;
  password: string;
  role: UserRole;
  displayName?: string;
}

/** Crea un account: solo super admin. Password minimo 8 caratteri. */
export async function createUser(actor: string, data: CreateUserData): Promise<{ ok: boolean; error?: string }> {
  const email = data.email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "email" };
  if (data.password.length < 8) return { ok: false, error: "corta" };
  if (data.role !== "super_admin" && data.role !== "admin") return { ok: false, error: "ruolo" };
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const pw = hashPassword(data.password);
  try {
    await pool.query(
      `insert into admin_users (email, password_hash, role, display_name)
       values ($1, $2, $3, $4)`,
      [email, pw, data.role, data.displayName?.trim() || email.split("@")[0]],
    );
  } catch (e) {
    const msg = String(e);
    if (msg.includes("duplicate key")) return { ok: false, error: "esiste" };
    return { ok: false, error: "db" };
  }
  await logAudit(actor, "user.create", email, data.role);
  return { ok: true };
}

/** Cambia ruolo: solo super admin. L'ultimo super admin non è declassabile. */
export async function setUserRole(actor: string, email: string, role: UserRole): Promise<{ ok: boolean; error?: string }> {
  if (role !== "super_admin" && role !== "admin") return { ok: false, error: "ruolo" };
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const emailN = email.toLowerCase().trim();
  const { rows } = await pool.query<{ role: UserRole }>(
    "select role from admin_users where email = $1",
    [emailN],
  );
  if (!rows[0]) return { ok: false, error: "inesistente" };
  if (rows[0].role === "super_admin" && role === "admin") {
    const { rows: supers } = await pool.query<{ n: number }>(
      "select count(*)::int as n from admin_users where role = 'super_admin' and active",
    );
    if ((supers[0]?.n ?? 0) <= 1) return { ok: false, error: "ultimo_super" };
  }
  await pool.query("update admin_users set role = $1 where email = $2", [role, emailN]);
  await logAudit(actor, "user.role", emailN, role);
  return { ok: true };
}

/** Attiva/disattiva: un account disattivato non entra più (check al login). */
export async function setUserActive(actor: string, email: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const emailN = email.toLowerCase().trim();
  if (emailN === actor.toLowerCase().trim()) return { ok: false, error: "self" };
  const { rows } = await pool.query<{ role: UserRole; active: boolean }>(
    "select role, active from admin_users where email = $1",
    [emailN],
  );
  if (!rows[0]) return { ok: false, error: "inesistente" };
  if (active === false && rows[0].role === "super_admin") {
    const { rows: supers } = await pool.query<{ n: number }>(
      "select count(*)::int as n from admin_users where role = 'super_admin' and active",
    );
    if ((supers[0]?.n ?? 0) <= 1) return { ok: false, error: "ultimo_super" };
  }
  await pool.query("update admin_users set active = $1 where email = $2", [active, emailN]);
  await logAudit(actor, active ? "user.activate" : "user.deactivate", emailN, null);
  return { ok: true };
}

/** Reset password: solo super admin, genera una password temporanea da mostrare una volta. */
export async function resetUserPassword(
  actor: string,
  email: string,
): Promise<{ ok: boolean; error?: string; tempPassword?: string }> {
  const emailN = email.toLowerCase().trim();
  const temp = `${randomBytes(9).toString("base64url")}Aa1!`; // ≥8 con maiuscola+num+simbolo
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const res = await pool.query("update admin_users set password_hash = $1 where email = $2", [
    hashPassword(temp),
    emailN,
  ]);
  if (!res.rowCount) return { ok: false, error: "inesistente" };
  // Le sessioni dell'utente muoiono da sole: il fingerprint della password nel
  // cookie firmato non matcha più (meccanismo di revoca di lib/admin).
  await logAudit(actor, "user.password_reset", emailN, null);
  return { ok: true, tempPassword: temp };
}

/** Cancella l'account: mai l'ultimo super admin, mai se stesso. */
export async function deleteUser(actor: string, email: string): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const emailN = email.toLowerCase().trim();
  if (emailN === actor.toLowerCase().trim()) return { ok: false, error: "self" };
  const { rows } = await pool.query<{ role: UserRole }>("select role from admin_users where email = $1", [emailN]);
  if (!rows[0]) return { ok: false, error: "inesistente" };
  if (rows[0].role === "super_admin") {
    const { rows: supers } = await pool.query<{ n: number }>(
      "select count(*)::int as n from admin_users where role = 'super_admin'",
    );
    if ((supers[0]?.n ?? 0) <= 1) return { ok: false, error: "ultimo_super" };
  }
  await pool.query("delete from admin_users where email = $1", [emailN]);
  await logAudit(actor, "user.delete", emailN, null);
  return { ok: true };
}
