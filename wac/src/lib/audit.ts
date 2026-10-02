import { db } from "./db";

/**
 * Log di audit amministrativo: ogni azione sensibile fatta da un agente
 * (lead, ticket, pacchetti, operatori, callback, AI, Notion, Shield) finisce
 * qui con chi, cosa, su cosa e quando. La tabella è append-only (rule SQL:
 * niente UPDATE né DELETE) — il log non si può riscrivere.
 *
 * fire-and-forget: un errore di audit non deve mai bloccare l'azione utente.
 */
export async function logAudit(
  actor: string,
  action: string,
  target?: string | null,
  detail?: string | null,
): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    await pool.query(
      "insert into audit_log (actor, action, target, detail) values ($1, $2, $3, $4)",
      [actor, action, target ?? null, detail ?? null],
    );
  } catch (e) {
    console.error("[audit] write failed:", e);
  }
}
