import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";

/**
 * Impostazioni del captcha invisibile (Turnstile) gestite da Shield.
 *
 * Le chiavi possono arrivare da DUE fonti, con priorità:
 *  1. Environment (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`):
 *     la via deployment-native, utile in CI e per chi gestisce via shell.
 *  2. Database (`content_settings`, key = `turnstile_tools`): configurabile
 *     dall'admin senza rideploy. La SECRET è cifrata AES-256-GCM (stesso
 *     meccanismo delle credenziali SMTP/API), la SITE KEY è pubblica per
 *     definizione e sta in chiaro nel JSON.
 *
 * Regola di esposizione: la site key torna al client SOLO se esiste anche la
 * secret (env o DB): una site key senza secret non verifica niente e non deve
 * nemmeno montare il widget.
 */

export const TURNSTILE_SETTINGS_KEY = "turnstile_tools";

interface StoredTurnstile {
  siteKey?: unknown;
  secretEnc?: unknown;
}

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export interface TurnstileSettings {
  siteKey: string;
  /** true se le chiavi attive vengono dal DB (configurazione admin). */
  fromDb: boolean;
  /** true se ESISTE una config DB (anche oscurata dalle env): abilita la rimozione. */
  hasDbConfig: boolean;
  /** Hint mascherato della secret salvata (mai la secret stessa). */
  secretHint: string | null;
}

/** Legge la config DB (null se assente o DB non configurato). */
async function readStored(): Promise<StoredTurnstile | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ value: StoredTurnstile }>(
      "select value from content_settings where key = $1",
      [TURNSTILE_SETTINGS_KEY],
    );
    const stored = rows[0]?.value;
    return stored && typeof stored === "object" ? stored : null;
  } catch {
    return null;
  }
}

/** Site key + stato, per la pagina Shield (nessun segreto nel payload). */
export async function getTurnstileSettings(): Promise<TurnstileSettings> {
  const stored = await readStored();
  const dbSite = clean(stored?.siteKey, 200);
  const secret = stored?.secretEnc ? decryptKey(clean(stored.secretEnc, 2000)) : null;
  const envSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const envSecret = process.env.TURNSTILE_SECRET_KEY ?? "";
  const fromDb = Boolean((dbSite && secret) && !(envSite && envSecret));
  // La site key mostrata è quella che il widget userà davvero.
  const siteKey = envSite && envSecret ? envSite : dbSite && secret ? dbSite : "";
  const hint = (value: string): string | null =>
    value ? `${value.slice(0, 2)}${"•".repeat(Math.max(4, Math.min(10, value.length - 4)))}${value.slice(-2)}` : null;
  return {
    siteKey,
    fromDb,
    hasDbConfig: Boolean(dbSite || secret),
    secretHint: envSecret ? null : hint(secret ?? ""),
  };
}

/** Sanitizza e salva; secret vuota = conserva quella esistente. */
export async function saveTurnstileSettings(input: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "Database non configurato." };
  const siteKey = clean(input.siteKey, 200);
  const secret = typeof input.secret === "string" ? input.secret.trim() : "";
  if ((siteKey && !secret && !(await readStored())?.secretEnc) || (secret && !siteKey)) {
    return { ok: false, error: "Servono ENTRAMBE le chiavi: site key (pubblica) e secret key." };
  }
  const stored = await readStored();
  const next: StoredTurnstile = { ...stored, siteKey };
  if (secret) next.secretEnc = encryptKey(secret);
  await pool.query(
    "insert into content_settings (key, value) values ($1, $2) on conflict (key) do update set value = $2",
    [TURNSTILE_SETTINGS_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

/** Cancella la config DB: le env (se ci sono) tornano la fonte attiva. */
export async function clearTurnstileSettings(): Promise<void> {
  const pool = db();
  if (!pool) return;
  await pool.query("delete from content_settings where key = $1", [TURNSTILE_SETTINGS_KEY]);
}

/** Chiavi attive per la verifica server: DB come fallback, env con priorità. */
export async function getActiveSecret(): Promise<string | null> {
  const envSecret = process.env.TURNSTILE_SECRET_KEY;
  if (envSecret) return envSecret;
  const stored = await readStored();
  const secret = stored?.secretEnc ? decryptKey(clean(stored.secretEnc, 2000)) : null;
  return secret || null;
}

/** Site key per il client: env prima, DB dopo; MAI senza secret attiva. */
export async function getActiveSiteKey(): Promise<string | null> {
  const secret = await getActiveSecret();
  if (!secret) return null;
  const envSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (envSite) return envSite;
  const stored = await readStored();
  const site = clean(stored?.siteKey, 200);
  return site || null;
}
