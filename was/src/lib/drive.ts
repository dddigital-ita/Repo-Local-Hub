import { createSign, randomUUID } from "node:crypto";
import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";
import { GOOGLE_TOOLS_KEY } from "./google-tools";

/**
 * INTEGRAZIONE GOOGLE DRIVE — account di servizio.
 *
 * Il JSON del service account è salvato dentro la stessa riga `content_settings`
 * del Google growth kit (`google_tools`), sotto la chiave `driveCredsEnc`:
 * un solo posto dove vive la config Google, cifrata AES-256-GCM come le altre
 * chiavi. `saveGoogleToolsConfig` ora preserva anche questo campo.
 *
 * Flusso di collegamento (stesso pattern a passi di Notion):
 *   1. Google Cloud Console → nuovo progetto → abilita "Google Drive API"
 *   2. IAM → Service Accounts → crea account di servizio → chiave JSON
 *   3. Condividi la cartella Drive con l'email del service account (Editor)
 *   4. Incolla il JSON qui, salva, «Prova connessione»
 *
 * Autenticazione: JWT firmato RS256 con la `private_key` del JSON → access
 * token OAuth2 (scope `drive`, pronto per gli upload futuri). Zero dipendenze
 * nuove: firma con `node:crypto`, chiamate con `fetch` + `AbortSignal.timeout`.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export interface DriveCredentials {
  clientEmail: string;
  privateKey: string;
}

interface ServiceAccountJson {
  client_email?: unknown;
  private_key?: unknown;
}

interface StoredGoogleToolsWithDrive {
  driveCredsEnc?: unknown;
}

export interface DriveConfig {
  /** true quando c'è un JSON salvato (cifrato) in content_settings. */
  hasCreds: boolean;
  /** Email del service account (unico campo mostrabile in UI). */
  clientEmail: string | null;
  /** Esito dell'ultimo «Prova connessione», come fa Notion. */
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

const DRIVE_TEST_ACTION = "drive.test";

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Legge la riga google_tools includendo il campo drive cifrato. */
async function readDriveEnc(): Promise<{ encrypted: string; lastTestAt: string | null; lastTestOk: boolean | null }> {
  const pool = db();
  if (!pool) return { encrypted: "", lastTestAt: null, lastTestOk: null };
  try {
    const { rows } = await pool.query<{ value: StoredGoogleToolsWithDrive }>(
      "select value from content_settings where key = $1",
      [GOOGLE_TOOLS_KEY],
    );
    const stored = rows[0]?.value;
    if (!stored || typeof stored !== "object") return { encrypted: "", lastTestAt: null, lastTestOk: null };
    const encrypted = clean(stored.driveCredsEnc, 4000);
    const lastTest = await pool.query<{ created_at: string; detail: string | null }>(
      "select created_at, detail from audit_log where action = $1 order by created_at desc limit 1",
      [DRIVE_TEST_ACTION],
    );
    const last = lastTest.rows[0];
    return {
      encrypted,
      lastTestAt: last?.created_at ?? null,
      lastTestOk: last ? Boolean(last.detail && last.detail.startsWith("OK")) : null,
    };
  } catch {
    return { encrypted: "", lastTestAt: null, lastTestOk: null };
  }
}

/** Config per la UI: mai il segreto, solo presenza + email + esito test. */
export async function getDriveConfig(): Promise<DriveConfig> {
  const { encrypted, lastTestAt, lastTestOk } = await readDriveEnc();
  if (!encrypted) return { hasCreds: false, clientEmail: null, lastTestAt, lastTestOk };
  const creds = parseServiceAccount(decryptKey(encrypted) ?? "");
  return { hasCreds: Boolean(creds), clientEmail: creds?.clientEmail ?? null, lastTestAt, lastTestOk };
}

/** Credenziali decifrate per chi deve CHIAMARE l'API (upload futuri, test). */
export async function getDriveCredentials(): Promise<DriveCredentials | null> {
  const { encrypted } = await readDriveEnc();
  if (!encrypted) return null;
  return parseServiceAccount(decryptKey(encrypted) ?? "");
}

function parseServiceAccount(raw: string): DriveCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccountJson;
    const clientEmail = clean(parsed.client_email, 200);
    const privateKey = clean(parsed.private_key, 4000);
    return clientEmail && privateKey ? { clientEmail, privateKey } : null;
  } catch {
    return null;
  }
}

/**
 * Salva il JSON del service account (cifrato). Accetta sia il file intero
 * scaricato da Google Cloud sia l'oggetto già ridotto { client_email,
 * private_key }. Con removeCreds cancella la configurazione.
 *
 * Read-modify-write della riga google_tools: le altre config (GA4, GSC, API
 * key) restano intatte — tocca SOLO il proprio campo, come fa removeGsc.
 */
export async function saveDriveCredentials(
  rawJson: string,
  opts: { removeCreds?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "database non configurato" };
  const creds = parseServiceAccount(rawJson);
  if (!opts.removeCreds && !creds) {
    return {
      ok: false,
      error: "JSON non valido: servono client_email e private_key (il file completo scaricato da Google Cloud va bene).",
    };
  }
  const current = await pool.query<{ value: StoredGoogleToolsWithDrive }>(
    "select value from content_settings where key = $1",
    [GOOGLE_TOOLS_KEY],
  );
  const old = current.rows[0]?.value ?? {};
  const next: StoredGoogleToolsWithDrive = {
    ...old,
    driveCredsEnc: opts.removeCreds ? "" : encryptKey(rawJson.slice(0, 4000)),
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [GOOGLE_TOOLS_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

/* ── JWT service account → access token (condiviso con Calendar) ── */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Access token OAuth2 da service account JWT RS256. Il meccanismo è lo
 * stesso per TUTTE le API Google dell'agenzia: Drive e Google Calendar
 * cambiano solo lo scope richiesto — un solo posto che firma, chiama e
 * gestisce gli errori OAuth (aggiungere Outlook/Zoho qui non serve mai).
 */
export async function googleServiceAccountToken(creds: DriveCredentials, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = base64url(signer.sign(creds.privateKey));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${signature}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    throw new Error(`Google OAuth ha risposto ${response.status}: ${text || "senza dettagli"}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Risposta OAuth senza access_token.");
  return data.access_token;
}

async function driveAccessToken(creds: DriveCredentials): Promise<string> {
  return googleServiceAccountToken(creds, DRIVE_SCOPE);
}

/**
 * Test di connessione REALE: chiede un access token con il JWT e poi elenca
 * i file della cartella condivisa (about/get per la verifica minima). Un JSON
 * valido ma senza API Drive abilitata o cartella non condivisa fallisce qui —
 * che è esattamente ciò che il test deve scoprire prima dell'uso in produzione.
 */
export async function testDriveConnection(): Promise<{ ok: boolean; message: string }> {
  const creds = await getDriveCredentials();
  if (!creds) return { ok: false, message: "Credenziali mancanti: salva prima il JSON del service account." };
  try {
    const token = await driveAccessToken(creds);
    const response = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user",
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) {
      const text = (await response.text()).slice(0, 160);
      return { ok: false, message: `Drive API ha risposto ${response.status}: ${text || "controlla API abilitata e condivisione cartella"}.` };
    }
    return { ok: true, message: `Connesso come ${creds.clientEmail}: API Drive raggiungibile.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return { ok: false, message: `Drive non raggiungibile: ${msg}. Controlla connettività e private_key.` };
  }
}

/** UUID per nomi file univoci (upload futuri), riusabile ovunque. */
export function driveFileName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}
