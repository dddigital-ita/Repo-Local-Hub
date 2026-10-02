import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { logAudit } from "./audit";

/**
 * Auth admin semplice (niente servizi esterni): email + password sulla tabella
 * admin_users (scrypt), sessione = cookie httpOnly firmato con HMAC.
 * ADMIN_SESSION_SECRET in .env.local. Gli utenti si creano con
 * `npm run admin:create` o via SQL (vedi README).
 */

const COOKIE = "wac_admin";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 ore

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || "dev-secret-cambia-in-produzione";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return test.length === ref.length && timingSafeEqual(test, ref);
}

export interface AdminIdentity {
  email: string;
  displayName: string;
  operatorId: string | null;
}

/**
 * Rivocaibilità delle sessioni: il cookie firmato da solo è immortale — se
 * l'utente viene cancellato o la password cambia, il token resta valido fino
 * a scadenza (difetto visto sul vivo: sessione ancora valida dopo la cancellazione
 * dell'admin). Il payload porta quindi l'IMPRONTA della password_hash al login
 * e getAdminUser la riverifica sul DB a ogni richiesta: password cambiata o
 * utente cancellato → ogni cookie firmato smette subito di valere (fail-closed:
 * DB irraggiungibile = nessuna sessione accettata).
 */
function pwFingerprint(passwordHash: string): string {
  return createHmac("sha256", secret()).update(`pw:${passwordHash}`).digest("hex").slice(0, 16);
}

/**
 * Anti-enumerazione: con email inesistente si eseguiva zero scrypt (risposta
 * istantanea) mentre con password sbagliata su email vera si bruciava il costo
 * di scrypt: misurando la latenza si potevano scoprire le email valide.
 * Qui un hash fittizio garantisce lo STESSO lavoro CPU in entrambi i casi.
 */
let dummyHash: string | null = null;
function burnScrypt(password: string): void {
  if (!dummyHash) {
    dummyHash = `${randomBytes(16).toString("hex")}:${scryptSync("equalizer", randomBytes(16), 64).toString("hex")}`;
  }
  verifyPassword(password, dummyHash);
}

export async function login(email: string, password: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  const { rows } = await pool.query<{
    password_hash: string;
    operator_id: string | null;
    display_name: string | null;
    active: boolean;
  }>(
    "select password_hash, operator_id, display_name, active from admin_users where email = $1",
    [email.toLowerCase().trim()],
  );
  const row = rows[0];
  const stored = row?.password_hash;
  if (!stored) {
    burnScrypt(password); // stesso tempo CPU di una verifica vera
    return false;
  }
  if (!verifyPassword(password, stored)) return false;
  // Account disattivato da un super admin: credenziali giuste ma accesso negato.
  // Il check sta DOPO la verifica password: il timing non distingue un account
  // spento da una password sbagliata (niente enumerazione di stato).
  if (row.active === false) return false;

  const opId = row.operator_id ?? "-";
  const dName = encodeURIComponent(row.display_name ?? email.split("@")[0]);
  const payload = `${email.toLowerCase().trim()}|${Date.now() + SESSION_TTL_MS}|${opId}|${dName}|${pwFingerprint(stored)}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  // Sessioni attive in /admin/sicurezza: il log porta l'impronta della
  // password_hash al login (fire-and-forget come tutto l'audit). Gli errori
  // di login NON finiscono qui: il rate limit + Shield se ne occupano.
  await logAudit(email.toLowerCase().trim(), "admin.login", null, `fp:${pwFingerprint(stored)}`);
  return true;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/* ── Sicurezza: cambio password self-service + sessioni attive ── */

/**
 * Cambia la password dell'admin corrente: verifica quella attuale (stesso
 * anti-enumerazione del login), scrive il nuovo hash scrypt. Le sessioni
 * esistenti MUOIONO da sole: l'impronta della password nel payload firmato
 * non matcha più (meccanismo di revoca introdotto con il fingerprint).
 * Ritorna il nuovo token di sessione perché l'azione rinnovi il cookie:
 * l'admin non deve essere sloggato dal proprio cambio password.
 */
export async function changeAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: "credenziali" | "db" | "validazione" }> {
  if (newPassword.length < 8) return { ok: false, error: "validazione" };
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const normalized = email.toLowerCase().trim();
  const { rows } = await pool.query<{ password_hash: string }>(
    "select password_hash from admin_users where email = $1",
    [normalized],
  );
  const stored = rows[0]?.password_hash;
  if (!stored) {
    burnScrypt(currentPassword);
    return { ok: false, error: "credenziali" };
  }
  if (!verifyPassword(currentPassword, stored)) return { ok: false, error: "credenziali" };
  const newHash = hashPassword(newPassword);
  await pool.query("update admin_users set password_hash = $1 where email = $2", [newHash, normalized]);
  return { ok: true };
}

/**
 * Emette un nuovo token di sessione per un admin già autenticato (stesso
 * contrato del login, senza riverificare la password): serve dopo il cambio
 * password per rinnovare il cookie con l'impronta aggiornata.
 */
export async function issueSessionFor(email: string): Promise<void> {
  const pool = db();
  if (!pool) return;
  const normalized = email.toLowerCase().trim();
  const { rows } = await pool.query<{
    password_hash: string;
    operator_id: string | null;
    display_name: string | null;
  }>("select password_hash, operator_id, display_name from admin_users where email = $1", [normalized]);
  const row = rows[0];
  if (!row) return; // utente sparito nel frattempo: niente cookie
  const opId = row.operator_id ?? "-";
  const dName = encodeURIComponent(row.display_name ?? normalized.split("@")[0]);
  const payload = `${normalized}|${Date.now() + SESSION_TTL_MS}|${opId}|${dName}|${pwFingerprint(row.password_hash)}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export interface AdminSessionRow {
  email: string;
  displayName: string;
  /** Scadenza del cookie (epoch ms). */
  expiresAt: number;
  /** True se l'impronta nel log matcha la password_hash ATTUALE: quella
   * sessione (se il suo cookie esiste ancora da qualche parte) funzionerebbe. */
  current: boolean;
}

/**
 * Sessioni "attive": i cookie firmati sono stateless, quindi l'unica cosa che
 * il server PUÒ sapere è quali token sarebbero ancora validi. La materia prima
 * è il log di audit (append-only, `admin.login` con fingerprint nell'audit):
 * per ogni login degli ultimi 12h (TTL della sessione) riverifichiamo l'impronta
 * salvata nel dettaglio contro la password_hash attuale — match = sessione che
 * funzionerebbe ancora; mismatch o utente cancellato = sessione morta dalla
 * revoca. La sessione CORRENTE è riconosciuta dal cookie, non dal log.
 */
export async function getAdminSessions(): Promise<AdminSessionRow[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      actor: string;
      detail: string | null;
      created_at: Date;
    }>(
      `select actor, detail, created_at from audit_log
       where action = 'admin.login' and created_at > now() - interval '12 hours'
       order by created_at desc`,
    );
    const hashes = new Map<string, string | null>();
    const out: AdminSessionRow[] = [];
    for (const r of rows) {
      const fp = r.detail?.match(/^fp:([0-9a-f]{16})/)?.[1];
      if (!fp) continue; // login pre-fix o senza fingerprint
      const email = r.actor.toLowerCase();
      if (out.some((s) => s.email === email)) continue; // il più recente per email
      if (!hashes.has(email)) {
        const h = await pool.query<{ password_hash: string }>(
          "select password_hash from admin_users where email = $1",
          [email],
        );
        hashes.set(email, h.rows[0]?.password_hash ?? null);
      }
      const currentHash = hashes.get(email);
      const exp = new Date(r.created_at).getTime() + SESSION_TTL_MS;
      if (exp < Date.now()) continue;
      out.push({
        email,
        displayName: email.split("@")[0],
        expiresAt: exp,
        current: currentHash ? fp === pwFingerprint(currentHash) : false,
      });
    }
    return out;
  } catch {
    return []; // tabella assente o pre-migrazione
  }
}

export async function getAdminUser(): Promise<AdminIdentity | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString();
  } catch {
    return null;
  }
  if (sign(payload) !== sig) return null;
  const [email, expiry, operatorId, displayName, pwMark] = payload.split("|");
  if (!email || !expiry || Number(expiry) < Date.now()) return null;
  // Rivocaibilità: senza impronta (cookie pre-fix) o con utente cancellato o
  // password cambiata la sessione non vale più. Fail-closed: se il DB non
  // risponde, la sessione è rifiutata (niente "fail open" di cortesia).
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ password_hash: string; active: boolean }>(
      "select password_hash, active from admin_users where email = $1",
      [email.toLowerCase().trim()],
    );
    const current = rows[0]?.password_hash;
    if (!current || !pwMark || pwMark !== pwFingerprint(current)) return null;
    // Account disattivato da un super admin: il cookie firmato resta formalmente
    // valido ma la sessione vale zero (enforcement centrale: copre requireAdmin
    // e ogni pagina /admin senza eccezioni).
    if (rows[0].active === false) return null;
  } catch {
    return null; // DB irraggiungibile: nessuna sessione accettata
  }
  return {
    email,
    operatorId: operatorId && operatorId !== "-" ? operatorId : null,
    displayName: displayName && displayName !== "-" ? decodeURIComponent(displayName) : email.split("@")[0],
  };
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return user;
}
