import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { db } from "./db";

/**
 * Note una tantum lato server («flash notes»).
 *
 * Problema: dopo il reset manuale della password la password temporanea
 * viaggiava nell'URL di redirect (?temp=…) — finiva nella cronologia del
 * browser, nei referer e in qualunque log intermedio.
 *
 * Meccanismo: l'azione che genera il segreto lo STIPA qui (cifrato
 * AES-256-GCM con la chiave derivata da ADMIN_SESSION_SECRET) e reindirizza
 * pulito. La pagina, al render, RIVENDICA la nota del proprio account con un
 * DELETE atomico: chi la legge la consuma — ricaricare la pagina non
 * ripropone nulla. L'identità che può rivendicare sta in `audience` e il
 * chiamante verifica che il proprio ruolo sia in quell'elenco: la nota è
 * leggibile solo dall'utente che ha compiuto l'azione.
 *
 * Il DB non è authoritative su chi è connesso (i cookie sono firmati, non
 * registrati): l'autorizzazione al claim la fa il chiamante con la guardia
 * che già protegge la pagina; qui si garantisce che il contenuto sia cifrato
 * a riposo, consumabile una volta sola e con TTL breve.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minuti: una nota è per definizione effimera

function encKey(): Buffer {
  const secret = process.env.ADMIN_SESSION_SECRET || "dev-secret-cambia-in-produzione";
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(stored: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = stored.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Sweep best-effort delle note scadute (chiamato su ogni stash). */
async function purgeExpired(pool: NonNullable<ReturnType<typeof db>>): Promise<void> {
  try {
    await pool.query("delete from flash_notes where expires_at <= now()");
  } catch {
    // tabella non ancora migrata o DB momentaneo: lo stash prosegue comunque
  }
}

export interface StashNoteInput {
  /** Contenuto sensibile, cifrato a riposo (es. una password temporanea). */
  payload: string;
  /** Email dell'attore: puramente informativa (audit già traccia l'evento). */
  actorEmail: string;
  /** Identità che può rivendicare la nota (es. l'email dell'attore stesso). */
  audience: string[];
  /** Override del TTL (default 10 minuti). */
  ttlMs?: number;
}

/**
 * Stipa una nota una tantum. Ritorna l'id del claim (opaco, nessun segreto
 * dentro): l'azione lo usa come flag di redirect (?note=<id> senza valore).
 */
export async function stashNote(input: StashNoteInput): Promise<string | null> {
  const pool = db();
  if (!pool) return null; // niente DB: l'azione riceverà null e mostra l'esito senza nota
  await purgeExpired(pool);
  const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : TTL_MS;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into flash_notes (note_enc, created_by, audience, expires_at)
       values ($1, $2, $3::jsonb, now() + ($4 || ' milliseconds')::interval)
       returning id`,
      [encrypt(input.payload), input.actorEmail, JSON.stringify(input.audience), String(ttl)],
    );
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export interface ClaimNoteResult {
  ok: boolean;
  payload?: string;
  /** «nota» = inesistente, già consumata, scaduta o destinata ad altri:
   *  lo stesso motivo per tutti i casi non autorizzati (niente oracoli). */
  reason?: "nota" | "permessi" | "db";
}

/**
 * Rivendica la nota: UNA SOLA lettura (delete atomico in returning).
 * L'audience è verificata QUI (oltre che dal chiamante): se l'identità non
 * combacia la nota NON viene consumata — un claim sbagliato non deve
 * distruggere il messaggio destinato a un altro.
 */
export async function claimNote(id: string, identity: string[]): Promise<ClaimNoteResult> {
  const pool = db();
  if (!pool) return { ok: false, reason: "db" };
  const identities = identity.map((i) => i.toLowerCase().trim()).filter(Boolean);
  if (!identities.length) return { ok: false, reason: "permessi" };
  try {
    const { rows } = await pool.query<{ note_enc: string; audience: string[]; expires_at: Date }>(
      `delete from flash_notes
       where id = $1 and audience ?| $2::text[] and expires_at > now()
       returning note_enc, audience, expires_at`,
      [id, identities],
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: "nota" }; // già consumata, scaduta, o audience errata
    const payload = decrypt(row.note_enc);
    if (payload === null) return { ok: false, reason: "nota" }; // segreto cambiato dopo la scrittura
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "db" };
  }
}
