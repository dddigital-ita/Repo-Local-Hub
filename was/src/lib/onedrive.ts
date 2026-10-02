import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";

/**
 * INTEGRAZIONE MICROSOFT ONEDRIVE — Microsoft Graph API.
 *
 * Microsoft NON ha account di servizio JWT come Google: l'app si
 * autentica con il flusso OAuth2 client-credentials (tenant ID +
 * client ID + client secret) e ottiene un token per Graph con lo
 * scope «.default». Le credenziali stanno cifrate AES-256-GCM in
 * content_settings, chiave `onedrive_config`, campo `credsEnc` —
 * read-modify-write che preserva gli altri campi, stessa scuola
 * di Drive (un solo posto per la configurazione, il segreto non
 * tocca mai il DB in chiaro e non torna al browser).
 *
 * Flusso di collegamento (stesso pattern a passi di Drive):
 *   1. Microsoft Entra ID → Registrazioni app → nuova registrazione
 *   2. Certificati e segreti → nuovo segreto client (visibile una
 *      volta sola: copiarlo subito)
 *   3. Permessi APPLICAZIONE Microsoft Graph: Files.Read.All (o
 *      Files.ReadWrite.All quando serviranno gli upload) e
 *      «Concedi consenso amministratore» — senza il consenso il
 *      test torna 401/403
 *   4. Incolla ID tenant + ID applicazione + segreto, salva,
 *      «Prova connessione»
 *
 * Zero dipendenze nuove: form-urlencoded con fetch + AbortSignal.timeout.
 */

export const ONEDRIVE_CONFIG_KEY = "onedrive_config";
/** Scope statico del client-credentials: i permessi reali sono quelli
 *  assegnati all'app in Entra ID (Files.Read.All di default). */
export const ONEDRIVE_SCOPE = "https://graph.microsoft.com/.default";

export interface OneDriveCredentials {
  /** Tenant (GUID o dominio, es. «contoso.onmicrosoft.com»). */
  tenantId: string;
  /** ID applicazione (client). */
  clientId: string;
  /** Segreto client — mai mostrato in UI. */
  clientSecret: string;
}

interface StoredOneDriveConfig {
  credsEnc?: unknown;
}

export interface OneDriveConfig {
  /** true quando c'è una configurazione (cifrata) in content_settings. */
  hasCreds: boolean;
  /** ID tenant e ID applicazione: unici campi mostrabili in UI. */
  tenantId: string | null;
  clientId: string | null;
  /** Esito dell'ultimo «Prova connessione», come fa Notion/Drive. */
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

const ONEDRIVE_TEST_ACTION = "onedrive.test";

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Legge la riga onedrive_config includendo il campo cifrato. */
async function readOneDriveEnc(): Promise<{ encrypted: string; lastTestAt: string | null; lastTestOk: boolean | null }> {
  const pool = db();
  if (!pool) return { encrypted: "", lastTestAt: null, lastTestOk: null };
  try {
    const { rows } = await pool.query<{ value: StoredOneDriveConfig }>(
      "select value from content_settings where key = $1",
      [ONEDRIVE_CONFIG_KEY],
    );
    const stored = rows[0]?.value;
    if (!stored || typeof stored !== "object") return { encrypted: "", lastTestAt: null, lastTestOk: null };
    const encrypted = clean(stored.credsEnc, 4000);
    const lastTest = await pool.query<{ created_at: string; detail: string | null }>(
      "select created_at, detail from audit_log where action = $1 order by created_at desc limit 1",
      [ONEDRIVE_TEST_ACTION],
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

/** Config per la UI: mai il segreto, solo presenza + tenant/client + esito test. */
export async function getOneDriveConfig(): Promise<OneDriveConfig> {
  const { encrypted, lastTestAt, lastTestOk } = await readOneDriveEnc();
  if (!encrypted) return { hasCreds: false, tenantId: null, clientId: null, lastTestAt, lastTestOk };
  const creds = parseOneDriveCredentials(decryptKey(encrypted) ?? "");
  return {
    hasCreds: Boolean(creds),
    tenantId: creds?.tenantId ?? null,
    clientId: creds?.clientId ?? null,
    lastTestAt,
    lastTestOk,
  };
}

/** Credenziali decifrate per chi deve CHIAMARE l'API (test, upload futuri). */
export async function getOneDriveCredentials(): Promise<OneDriveCredentials | null> {
  const { encrypted } = await readOneDriveEnc();
  if (!encrypted) return null;
  return parseOneDriveCredentials(decryptKey(encrypted) ?? "");
}

/**
 * Accetta il JSON con chiavi snake_case (come l'app manifest di
 * Azure) o camelCase: { tenant_id | tenantId, client_id | clientId,
 * client_secret | clientSecret }. Restituisce null se manca un
 * campo: il salvatore rifiuta configurazioni parziali.
 */
export function parseOneDriveCredentials(raw: string): OneDriveCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tenantId = clean(parsed.tenant_id ?? parsed.tenantId, 200);
    const clientId = clean(parsed.client_id ?? parsed.clientId, 200);
    const clientSecret = clean(parsed.client_secret ?? parsed.clientSecret, 4000);
    return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
  } catch {
    return null;
  }
}

/**
 * Salva le credenziali (cifrate). Con removeCreds cancella la
 * configurazione. Read-modify-write della riga onedrive_config:
 * eventuali altri campi futuri restano intatti — tocca SOLO credsEnc.
 */
export async function saveOneDriveCredentials(
  input: OneDriveCredentials,
  opts: { removeCreds?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "database non configurato" };
  const creds = {
    tenantId: clean(input.tenantId, 200),
    clientId: clean(input.clientId, 200),
    clientSecret: clean(input.clientSecret, 4000),
  };
  if (!opts.removeCreds && (!creds.tenantId || !creds.clientId || !creds.clientSecret)) {
    return {
      ok: false,
      error: "servono tutti e tre i valori: ID tenant, ID applicazione (client) e segreto client.",
    };
  }
  const current = await pool.query<{ value: StoredOneDriveConfig }>(
    "select value from content_settings where key = $1",
    [ONEDRIVE_CONFIG_KEY],
  );
  const old = current.rows[0]?.value ?? {};
  const next: StoredOneDriveConfig = {
    ...old,
    credsEnc: opts.removeCreds ? "" : encryptKey(JSON.stringify(creds)),
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [ONEDRIVE_CONFIG_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

/**
 * Token OAuth2 client-credentials: POST a
 * login.microsoftonline.com/{tenant}/oauth2/v2.0/token con
 * grant_type=client_credentials. Il token vale per gli scope che
 * l'app ha già (consentiti dall'amministratore): da qui la chiamata
 * Graph di test.
 */
export async function oneDriveAccessToken(creds: OneDriveCredentials): Promise<string> {
  const response = await fetch(`https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: ONEDRIVE_SCOPE,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 200);
    let hint = "";
    try {
      const err = JSON.parse(text) as { error_description?: string };
      if (err.error_description) hint = `: ${err.error_description.slice(0, 140)}`;
    } catch {
      // risposta non-JSON: va bene il testo grezzo
    }
    throw new Error(`Microsoft identity ha risposto ${response.status}${hint || (text ? `: ${text}` : "")}.`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Risposta OAuth senza access_token.");
  return data.access_token;
}

/**
 * Test di connessione REALE: token client-credentials e poi la
 * lettura della libreria documenti del sito root via Graph
 * (`/sites/root/drive`). Un'app senza Files.Read.All o senza
 * consenso amministrativo fallisce qui — esattamente ciò che il
 * test deve scoprire prima dell'uso in produzione.
 */
export async function testOneDriveConnection(): Promise<{ ok: boolean; message: string }> {
  const creds = await getOneDriveCredentials();
  if (!creds) return { ok: false, message: "Credenziali mancanti: salva prima ID tenant, ID applicazione e segreto client." };
  try {
    const token = await oneDriveAccessToken(creds);
    const response = await fetch("https://graph.microsoft.com/v1.0/sites/root/drive", {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 160);
      const hint =
        response.status === 401 || response.status === 403
          ? " Controlla i permessi applicazione Files.Read.All (o Files.ReadWrite.All) e il consenso amministratore."
          : "";
      return { ok: false, message: `Graph ha risposto ${response.status}: ${text || "senza dettagli"}.${hint}` };
    }
    const data = (await response.json()) as { id?: string; name?: string };
    const lib = data.name ? ` «${data.name.slice(0, 60)}»` : "";
    return { ok: true, message: `Connesso: Microsoft Graph raggiungibile — libreria${lib} del sito root leggibile.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore sconosciuto";
    return { ok: false, message: `OneDrive non raggiungibile: ${msg}` };
  }
}
