/**
 * SOCIAL OAUTH (Fase 5, §2/§3 del piano cache-TTL-e-social):
 * connessione OAuth delle pagine Meta (Facebook + Instagram
 * Business) e delle organizzazioni LinkedIn.
 *
 * Flusso (identico per i due provider):
 *   1. POST /api/auth/<provider>/start — admin autenticato, genera
 *      uno state CSRF casuale e lo pianta in cookie httpOnly
 *      (10 minuti), poi 302 al dialog del provider;
 *   2. GET /api/auth/<provider>/callback — il contratto del
 *      provider: ?code= + ?state=. Lo state si confronta in
 *      tempo costante col cookie (il GET NON è prefetchabile
 *      con successo senza un code+state validi); la scrittura
 *      è UN upsert idempotente su channel_accounts con i token
 *      cifrati AES-256-GCM (encryptKey, stessa chiave delle API
 *      AI e del token WhatsApp).
 *
 * Il contratto che l'OAuth POPOLA è quello del registry
 * (channel-registry.ts): external_id + credentials{secretEnc,
 * accessTokenEnc[, userTokenEnc, expiresAt]} — il webhook
 * omnicanale verifica già le firme con quei segreti, quindi
 * dopo il «Collega» i webhook funzionano senza altro codice.
 *
 * LinkedIn: lo scope è w_identity (sola identità organizzazione).
 * Il MESSAGGING resta SPENTO: w_organization_social richiede
 * l'approvazione Marketing Developer Platform — nessun codice
 * di invio esiste finché non arriva.
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { encryptKey, decryptKey } from "@/lib/ai";
import { safeEqual } from "@/lib/channel-registry";
import { absoluteUrl } from "@/lib/site";

/** TTL dello state CSRF: 10 minuti, come il flusso OAuth tipico. */
export const OAUTH_STATE_TTL_SECONDS = 600;

const META_GRAPH = "https://graph.facebook.com/v23.0";
const META_DIALOG = "https://www.facebook.com/v23.0/dialog/oauth";
const LINKEDIN_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_API = "https://api.linkedin.com/v2";

/** Scope Meta: lista pagine + metadata + IG basic + messaging. */
const META_SCOPE = [
  "pages_show_list",
  "pages_manage_metadata",
  "instagram_basic",
  "pages_messaging",
].join(",");

/** Scope LinkedIn: identità organizzazione (messaging SPENTO). */
const LINKEDIN_SCOPE = "w_identity";

/* ── Config provider ─────────────────────────────────────── */

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
}

/** Credenziali app Meta dall'env; null se non configurate. */
export function getMetaAppConfig(): MetaAppConfig | null {
  const appId = (process.env.META_APP_ID ?? "").trim();
  const appSecret = (process.env.META_APP_SECRET ?? "").trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export interface LinkedinAppConfig {
  clientId: string;
  clientSecret: string;
}

/** Credenziali app LinkedIn dall'env; null se non configurate. */
export function getLinkedinAppConfig(): LinkedinAppConfig | null {
  const clientId = (process.env.LINKEDIN_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/* ── State CSRF (cookie httpOnly, 10 min) ────────────────── */

/** Stato CSRF casuale (base64url, 16 byte). */
export function newOAuthState(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Pianta lo state nel cookie httpOnly (sameSite lax, 10 min):
 * il provider lo riporta indietro sul callback e il confronto
 * costante blocca i CSRF. Il cookie NON è mai esposto al JS.
 */
export async function setOAuthStateCookie(name: string, value: string): Promise<void> {
  const store = await cookies();
  store.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
}

/**
 * Verifica lo state del callback contro il cookie (tempo
 * costante). Il cookie resta: scade da solo in 10 minuti —
 * cancellarlo qui sarebbe una scrittura nel GET del callback,
 * che invece porta UNA sola scrittura: l'upsert account.
 */
export async function verifyOAuthState(name: string, expected: string): Promise<boolean> {
  const store = await cookies();
  const actual = store.get(name)?.value;
  if (!actual || !expected) return false;
  return safeEqual(actual, expected);
}

/* ── URL di avvio (il POST /start costruisce il 302) ─────── */

/** URL del dialog Meta (pagine + IG Business). */
export function metaAuthorizationUrl(state: string, redirectUri: string, app: MetaAppConfig): string {
  const q = new URLSearchParams({
    client_id: app.appId,
    redirect_uri: redirectUri,
    state,
    scope: META_SCOPE,
  });
  return `${META_DIALOG}?${q.toString()}`;
}

/** URL dell'autorizzazione LinkedIn (identità organizzazione). */
export function linkedinAuthorizationUrl(state: string, redirectUri: string, app: LinkedinAppConfig): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: app.clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPE,
  });
  return `${LINKEDIN_AUTH}?${q.toString()}`;
}

/* ── Scambio token e lettura account (server-side) ───────── */

/** Errore di provider con messaggio già pronto per il banner. */
export class ProviderError extends Error {}

async function jsonOrThrow(res: Response, what: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ProviderError(`${what}: risposta non JSON da ${what}`);
  }
  if (!res.ok) {
    const detail = typeof body.error === "object" && body.error !== null
      ? (body.error as Record<string, unknown>).message ?? JSON.stringify(body.error)
      : String(body.error ?? body);
    throw new ProviderError(`${what}: ${String(detail).slice(0, 200)}`);
  }
  return body;
}

/**
 * Meta: code → token di accesso breve. Il redirect_uri DEVE
 * essere quello registrato nell'app (stesso valore dello start).
 */
export async function exchangeMetaCode(code: string, redirectUri: string, app: MetaAppConfig): Promise<string> {
  const res = await fetch(`${META_GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.appId,
      redirect_uri: redirectUri,
      client_secret: app.appSecret,
      code,
    }),
  });
  const body = await jsonOrThrow(res, "meta.scambio_code");
  const token = body.access_token;
  if (typeof token !== "string" || !token) throw new ProviderError("meta.scambio_code: token assente");
  return token;
}

/** Meta: token breve → token utente a 60 giorni (fb_exchange_token). */
export async function extendMetaToken(
  shortToken: string,
  app: MetaAppConfig,
): Promise<{ accessToken: string; expiresAt: string | null }> {
  const url = new URL(`${META_GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("client_secret", app.appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(url.toString());
  const body = await jsonOrThrow(res, "meta.token_60gg");
  const token = body.access_token;
  if (typeof token !== "string" || !token) throw new ProviderError("meta.token_60gg: token assente");
  const seconds = typeof body.expires_in === "number" ? body.expires_in : null;
  return {
    accessToken: token,
    expiresAt: seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null,
  };
}

export interface MetaPageAccount {
  id: string;
  name: string;
  accessToken: string;
  instagramBusinessAccount: { id: string; name: string; accessToken: string } | null;
}

/**
 * Meta: pagine gestibili dal token utente (con il token IG
 * Business collegato, quando c'è). Ogni pagina diventa un account
 * facebook; ogni IG Business un account instagram.
 */
export async function fetchMetaPageAccounts(userToken: string): Promise<MetaPageAccount[]> {
  const url = new URL(`${META_GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,name,access_token}");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userToken);
  const res = await fetch(url.toString());
  const body = await jsonOrThrow(res, "meta.pagine");
  const data = body.data;
  if (!Array.isArray(data)) throw new ProviderError("meta.pagine: risposta senza lista pagine");
  return data
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
    .map((p) => {
      const ig = p.instagram_business_account as Record<string, unknown> | null | undefined;
      return {
        id: String(p.id ?? ""),
        name: String(p.name ?? "Pagina Facebook"),
        accessToken: String(p.access_token ?? ""),
        instagramBusinessAccount:
          ig && ig.id && ig.access_token
            ? { id: String(ig.id), name: String(ig.name ?? "Instagram"), accessToken: String(ig.access_token) }
            : null,
      };
    })
    .filter((p) => p.id && p.accessToken);
}

/** LinkedIn: code → access token (form-encoded, come da spec). */
export async function exchangeLinkedinCode(
  code: string,
  redirectUri: string,
  app: LinkedinAppConfig,
): Promise<string> {
  const res = await fetch(LINKEDIN_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
  });
  const body = await jsonOrThrow(res, "linkedin.scambio_code");
  const token = body.access_token;
  if (typeof token !== "string" || !token) throw new ProviderError("linkedin.scambio_code: token assente");
  return token;
}

export interface LinkedinOrganization {
  id: string;
  name: string;
}

/**
 * LinkedIn: organizzazioni in cui il token è amministratore.
 * w_identity espone l'elenco delle org gestite; l'external_id
 * dell'account è l'URN organizzazione (lo stesso che il webhook
 * riceve in events[].organizationalEntity).
 */
export async function fetchLinkedinOrganizations(accessToken: string): Promise<LinkedinOrganization[]> {
  const url = new URL(`${LINKEDIN_API}/organizations`);
  url.searchParams.set("role", "ADMINISTRATOR");
  url.searchParams.set("count", "25");
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  const body = await jsonOrThrow(res, "linkedin.organizzazioni");
  const elements = body.elements;
  if (!Array.isArray(elements)) throw new ProviderError("linkedin.organizzazioni: risposta senza lista");
  return elements
    .filter((o): o is Record<string, unknown> => Boolean(o && typeof o === "object"))
    .map((o) => ({ id: String(o.id ?? ""), name: String(o.localizedName ?? o.name ?? "Organizzazione LinkedIn") }))
    .filter((o) => o.id);
}

/* ── Persistenza: channel_accounts (il contratto del webhook) ── */

/**
 * Upsert idempotente dell'account social: il webhook omnicanale
 * (/api/webhooks/[channel]) trova ESATTAMENTE questa riga via
 * findChannelAccount(channel, external_id) e verifica la firma
 * con credentials.secretEnc — dopo il «Collega» non serve altro.
 */
export async function upsertChannelAccount(
  channel: string,
  externalId: string,
  label: string,
  credentials: Record<string, string>,
): Promise<void> {
  const pool = db();
  if (!pool) return;
  await pool.query(
    `insert into channel_accounts (channel, external_id, label, credentials, enabled)
     values ($1, $2, $3, $4, true)
     on conflict (channel, external_id) do update
       set credentials = excluded.credentials,
           label = excluded.label,
           enabled = excluded.enabled,
           updated_at = now()`,
    [channel, externalId, label, JSON.stringify(credentials)],
  );
}

/** Credenziali di una pagina Meta (app secret + token pagina + utente 60gg). */
export function facebookCredentials(appSecret: string, pageToken: string, userToken: string, expiresAt: string | null): Record<string, string> {
  const creds: Record<string, string> = {
    secretEnc: encryptKey(appSecret),
    accessTokenEnc: encryptKey(pageToken),
    userTokenEnc: encryptKey(userToken),
  };
  if (expiresAt) creds.expiresAt = expiresAt;
  return creds;
}

/** Credenziali di un account Instagram Business (app secret + token IG). */
export function instagramCredentials(appSecret: string, igToken: string): Record<string, string> {
  return { secretEnc: encryptKey(appSecret), accessTokenEnc: encryptKey(igToken) };
}

/** Credenziali di un'organizzazione LinkedIn (client secret + token). */
export function linkedinCredentials(clientSecret: string, accessToken: string): Record<string, string> {
  return { secretEnc: encryptKey(clientSecret), accessTokenEnc: encryptKey(accessToken) };
}

/* ── Vista pannello (mai un segreto per intero) ──────────── */

export type SocialChannelKey = "facebook" | "instagram" | "linkedin";

export interface SocialAccountView {
  channel: SocialChannelKey;
  externalId: string;
  label: string | null;
  enabled: boolean;
  /** Secret presente (cifrato): il webhook può verificare le firme. */
  hasSecret: boolean;
  /** Token di accesso presente (cifrato). */
  hasToken: boolean;
  /** Suggerimento mascherato del token (primi 6 + • + ultimi 4). */
  tokenHint: string | null;
  /** Scadenza del token utente Meta (ISO), quando nota. */
  userTokenExpiresAt: string | null;
}

/** Suggerimento mascherato (pattern di telegram-config/google-tools). */
function hintFor(value: string): string | null {
  if (!value) return null;
  return `${value.slice(0, 6)}${"•".repeat(Math.max(4, Math.min(value.length - 12, 24)))}${value.slice(-4)}`;
}

/**
 * Account social collegati, per la scheda Canali social:
 * external_id (visibile, è l'identità pubblica della pagina/org)
 * + impronte mascherate. I token restano cifrati nel DB.
 */
export async function getSocialChannelsView(): Promise<SocialAccountView[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{
      channel: SocialChannelKey;
      external_id: string;
      label: string | null;
      credentials: Record<string, unknown>;
      enabled: boolean;
    }>(
      `select channel, external_id, label, credentials, enabled
       from channel_accounts
       where channel in ('facebook','instagram','linkedin')
       order by channel, label nulls last, external_id`,
    );
    return rows.map((r) => {
      const creds = r.credentials ?? {};
      const tokenEnc = typeof creds.accessTokenEnc === "string" ? creds.accessTokenEnc : null;
      const token = tokenEnc ? decryptKey(tokenEnc) : null;
      const expiresAt = typeof creds.expiresAt === "string" ? creds.expiresAt : null;
      return {
        channel: r.channel,
        externalId: r.external_id,
        label: r.label,
        enabled: r.enabled,
        hasSecret: typeof creds.secretEnc === "string" && Boolean(creds.secretEnc),
        hasToken: Boolean(token),
        tokenHint: token ? hintFor(token) : null,
        userTokenExpiresAt: expiresAt,
      };
    });
  } catch {
    return []; // tabella non migrata: nessun account, nessun errore
  }
}

/** redirect_uri registrati nell'app provider (stessa base del sito). */
export const META_REDIRECT_PATH = "/api/auth/meta/callback";
export const LINKEDIN_REDIRECT_PATH = "/api/auth/linkedin/callback";

export function metaRedirectUri(): string {
  return absoluteUrl(META_REDIRECT_PATH);
}

export function linkedinRedirectUri(): string {
  return absoluteUrl(LINKEDIN_REDIRECT_PATH);
}
