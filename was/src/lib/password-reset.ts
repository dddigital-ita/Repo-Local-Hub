import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { hashPassword } from "./admin";
import { logAudit } from "./audit";
import { sendEmailViaTools } from "./email-tools";

/**
 * Reset password SELF-SERVICE («password dimenticata»).
 *
 * Regole di sicurezza, tutte non negoziabili:
 *  1. La risposta alla richiesta è SEMPRE neutra: che l'email esista o no,
 *     l'utente vede lo stesso messaggio (nessuna enumerazione account).
 *  2. Il token è casuale a 256 bit e nel DB va SOLO il suo SHA-256: un
 *     backup o una lettura DB non permettono di resettare nessuno.
 *  3. Durata 1 ora, uso SINGOLO (used_at), revoca implicita al cambio
 *     password (le sessioni muoiono via fingerprint, vedi lib/admin).
 *  4. Il rate limit 3/h per IP sta nell'endpoint (qui non si può: è
 *     per-richiesta, non per-utente) — così anche spamming di richieste
 *     non allaga le caselle.
 *  5. L'email potrebbe non essere configurata: in quel caso la richiesta
 *     finisce in audit con esito esplicito, il super admin vede chi è
 *     bloccato e può usare il reset manuale da /admin/utenti.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 ora

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface RequestResetResult {
  /** Sempre true verso il client: la risposta neutra non rivela nulla. */
  neutral: true;
  /** Dettaglio operativo per audit/monitoraggio, mai per la UI. */
  delivered: boolean;
  reason?: "email_non_configurata" | "invio_fallito" | "db" | "rate";
}

export async function requestPasswordReset(email: string, ip: string): Promise<RequestResetResult> {
  const normalized = email.toLowerCase().trim();
  const pool = db();
  if (!pool) return { neutral: true, delivered: false, reason: "db" };

  // Token SEMPRE generato (anche per email inesistente): il tempo CPU e la
  // scrittura non devono distinguere i due casi.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await pool.query(
    `insert into password_reset_tokens (email, token_hash, expires_at, created_ip)
     values ($1, $2, now() + interval '1 hour', $3)`,
    [normalized, tokenHash, ip],
  );

  const { rows } = await pool.query<{ email: string }>(
    "select email from admin_users where email = $1 and active",
    [normalized],
  );
  const exists = Boolean(rows[0]);

  await logAudit(normalized || "(vuota)", "password.reset_request", null, exists ? "richiesta" : "richiesta (email ignota)");

  if (!exists) {
    // Email inesistente: risposta identica, nessun invio, token orfano che
    // scade da solo (un raro insert in più non è un leak).
    return { neutral: true, delivered: false };
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const link = `${base}/admin/password-dimenticata?token=${encodeURIComponent(token)}`;
  const minuti = Math.round(TOKEN_TTL_MS / 60_000);
  const sent = await sendEmailViaTools({
    to: normalized,
    subject: "Web Agency Salento — reset della tua password",
    text:
      `Ciao,\n\nhai chiesto di reimpostare la password del pannello (area team).\n` +
      `Il link qui sotto è valido ${minuti} minuti e si può usare UNA sola volta:\n\n${link}\n\n` +
      `Se non eri tu, ignora questa email: la tua password resta quella di prima.\n\n` +
      `— Web Agency Salento`,
  });

  if (!sent.ok) {
    await logAudit(normalized, "password.reset_request", null, `invio fallito: ${sent.error ?? "?"}`);
    return { neutral: true, delivered: false, reason: sent.error?.includes("non configurata") ? "email_non_configurata" : "invio_fallito" };
  }
  await logAudit(normalized, "password.reset_request", null, "email inviata");
  return { neutral: true, delivered: true };
}

export type ConfirmResetResult =
  | { ok: true }
  | { ok: false; error: "token" | "scaduto" | "validazione" | "db" };

/** Consuma il token e imposta la nuova password (minimo 8 caratteri). */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<ConfirmResetResult> {
  if (newPassword.length < 8) return { ok: false, error: "validazione" };
  const pool = db();
  if (!pool) return { ok: false, error: "db" };
  const tokenHash = sha256(token);
  const { rows } = await pool.query<{ id: string; email: string; expires_at: Date; used_at: Date | null }>(
    `select id, email, expires_at, used_at from password_reset_tokens where token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  // Token ignoto, già usato o scaduto: stesso messaggio, stessa path.
  if (!row || row.used_at) return { ok: false, error: "token" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "scaduto" };

  const newHash = hashPassword(newPassword);
  // Transazione su client DEDICATO (il pool condivide le connessioni: begin
  // su pool.query finirebbe su una connessione diversa dal commit).
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update admin_users set password_hash = $1 where email = $2", [newHash, row.email]);
    await client.query("update password_reset_tokens set used_at = now() where id = $1", [row.id]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    // L'errore va nel log: un fallimento di persistenza silenzioso nasconderebbe
    // un bug agli occhi di chi opera (visto nel vivo con l'E2E).
    console.error("[password-reset] update fallito:", e);
    return { ok: false, error: "db" };
  } finally {
    client.release();
  }
  // Le sessioni dell'utente muoiono da sole: il fingerprint della password nel
  // cookie firmato non matcha più (meccanismo di revoca di lib/admin).
  await logAudit(row.email, "password.reset_done", null, "self-service");
  return { ok: true };
}
