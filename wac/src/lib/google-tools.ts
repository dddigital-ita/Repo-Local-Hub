import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";

export const GOOGLE_TOOLS_KEY = "google_tools";

export interface GoogleToolsConfig {
  ga4Id: string;
  gtmId: string;
  gscToken: string;
  clarityId: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  /** Stato credenziali API Search Console (per le query reali in /admin/seo). */
  hasGscCreds: boolean;
  gscSiteUrl: string | null;
}

interface StoredGoogleTools {
  ga4Id?: unknown;
  gtmId?: unknown;
  gscToken?: unknown;
  clarityId?: unknown;
  apiKeyEnc?: unknown;
  gscCredsEnc?: unknown;
  /** Service account Google Drive (JSON cifrato), scritto da src/lib/drive.ts. */
  driveCredsEnc?: unknown;
}

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function safeTrackingId(value: unknown, prefix: "G-" | "GTM-" | "CLARITY-"): string {
  const raw = clean(value, 40).toUpperCase();
  if (prefix === "G-" && /^G-[A-Z0-9]+$/.test(raw)) return raw;
  if (prefix === "GTM-" && /^GTM-[A-Z0-9]+$/.test(raw)) return raw;
  if (prefix === "CLARITY-" && /^[A-Z0-9_-]{6,40}$/.test(raw)) return raw;
  return "";
}

function hintFor(value: string): string | null {
  if (!value) return null;
  return `${value.slice(0, 4)}${"•".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export async function getGoogleToolsConfig(): Promise<GoogleToolsConfig> {
  const fallback: GoogleToolsConfig = {
    ga4Id: process.env.NEXT_PUBLIC_GA4_ID || "",
    gtmId: process.env.NEXT_PUBLIC_GTM_ID || "",
    gscToken: process.env.NEXT_PUBLIC_SEARCH_GSC_TOKEN || "",
    clarityId: process.env.NEXT_PUBLIC_CLARITY_ID || "",
    hasApiKey: false,
    apiKeyHint: null,
    hasGscCreds: false,
    gscSiteUrl: null,
  };
  const pool = db();
  if (!pool) return fallback;
  try {
    const { rows } = await pool.query<{ value: StoredGoogleTools }>(
      "select value from content_settings where key = $1",
      [GOOGLE_TOOLS_KEY],
    );
    const stored = rows[0]?.value;
    if (!stored || typeof stored !== "object") return fallback;
    const encrypted = clean(stored.apiKeyEnc, 1000);
    const apiKey = encrypted ? decryptKey(encrypted) : null;
    const gscEnc = clean(stored.gscCredsEnc, 2000);
    return {
      ga4Id: safeTrackingId(stored.ga4Id, "G-") || fallback.ga4Id,
      gtmId: safeTrackingId(stored.gtmId, "GTM-") || fallback.gtmId,
      gscToken: clean(stored.gscToken, 200) || fallback.gscToken,
      clarityId: safeTrackingId(stored.clarityId, "CLARITY-") || fallback.clarityId,
      hasApiKey: Boolean(apiKey),
      apiKeyHint: hintFor(apiKey ?? ""),
      hasGscCreds: Boolean(gscEnc),
      gscSiteUrl: gscSiteFromCreds(gscEnc),
    };
  } catch {
    return fallback;
  }
}

export async function saveGoogleToolsConfig(input: {
  ga4Id: string;
  gtmId: string;
  gscToken: string;
  clarityId: string;
  apiKey?: string;
  removeApiKey?: boolean;
}): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  const current = await pool.query<{ value: StoredGoogleTools }>(
    "select value from content_settings where key = $1",
    [GOOGLE_TOOLS_KEY],
  );
  const old = current.rows[0]?.value ?? {};
  const next: StoredGoogleTools = {
    ga4Id: safeTrackingId(input.ga4Id, "G-"),
    gtmId: safeTrackingId(input.gtmId, "GTM-"),
    gscToken: clean(input.gscToken, 200),
    clarityId: safeTrackingId(input.clarityId, "CLARITY-"),
    apiKeyEnc: input.removeApiKey
      ? ""
      : input.apiKey
        ? encryptKey(input.apiKey.slice(0, 200))
        : old.apiKeyEnc,
    gscCredsEnc: old.gscCredsEnc,
    driveCredsEnc: old.driveCredsEnc,
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [GOOGLE_TOOLS_KEY, JSON.stringify(next)],
  );
}

export async function testPageSpeed(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey) return { ok: false, message: "API key Google mancante: salvala prima di testare PageSpeed." };
  const url = process.env.NEXT_PUBLIC_SITE_URL || "https://www.webagencycrema.com";
  try {
    const response = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) {
      return { ok: false, message: `PageSpeed ha risposto ${response.status}: controlla API key e API abilitata.` };
    }
    const data = (await response.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
    const score = data.lighthouseResult?.categories?.performance?.score;
    return {
      ok: typeof score === "number",
      message: typeof score === "number" ? `PageSpeed mobile: ${Math.round(score * 100)}/100 su ${url}.` : "Risposta PageSpeed senza punteggio.",
    };
  } catch {
    return { ok: false, message: "PageSpeed non raggiungibile: riprova tra poco." };
  }
}

export async function getGoogleApiKey(): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ value: StoredGoogleTools }>(
      "select value from content_settings where key = $1",
      [GOOGLE_TOOLS_KEY],
    );
    const encrypted = clean(rows[0]?.value?.apiKeyEnc, 1000);
    return encrypted ? decryptKey(encrypted) : null;
  } catch {
    return null;
  }
}

/* ── Search Console API (query reali in /admin/seo) ──────────── */

export interface GscCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  siteUrl: string;
}

interface GscCredsJson {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  siteUrl?: string;
}

/** Normalizza l'URL proprietà a una forma accettata dall'API (no trailing slash, dimensione prefisso). */
function normalizeGscSite(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("sc-domain:")) return `sc-domain:${v.slice("sc-domain:".length).trim().toLowerCase()}`;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

/** Legge il siteUrl dalle credenziali cifrate (solo per lo stato in UI). */
function gscSiteFromCreds(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptKey(encrypted) ?? "") as GscCredsJson;
    const site = typeof parsed.siteUrl === "string" ? parsed.siteUrl : "";
    return site || null;
  } catch {
    return null;
  }
}

export async function getGscCredentials(): Promise<GscCredentials | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ value: StoredGoogleTools }>(
      "select value from content_settings where key = $1",
      [GOOGLE_TOOLS_KEY],
    );
    const encrypted = clean(rows[0]?.value?.gscCredsEnc, 2000);
    if (!encrypted) return null;
    const parsed = JSON.parse(decryptKey(encrypted) ?? "") as GscCredsJson;
    const creds: GscCredentials = {
      clientId: clean(parsed.clientId, 200),
      clientSecret: clean(parsed.clientSecret, 200),
      refreshToken: clean(parsed.refreshToken, 300),
      siteUrl: normalizeGscSite(String(parsed.siteUrl ?? "")),
    };
    return creds.clientId && creds.clientSecret && creds.refreshToken && creds.siteUrl ? creds : null;
  } catch {
    return null;
  }
}

/**
 * Salva le credenziali OAuth di Search Console. Il JSON arriva dal form di
 * Tools: sia il blocco "installed" del file scaricato da Google Cloud che i
 * tre campi sciolti. Cifrato AES-256-GCM come le altre chiavi; il refresh
 * token non viene mai rispedito al browser.
 */
export async function saveGscCredentials(rawJson: string, siteUrl: string): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "database non configurato" };

  let clientId = "";
  let clientSecret = "";
  let refreshToken = "";
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const installed = (parsed.installed ?? parsed.web ?? parsed) as Record<string, unknown>;
    clientId = clean(installed.client_id, 200);
    clientSecret = clean(installed.client_secret, 200);
    refreshToken = clean(installed.refresh_token, 300);
  } catch {
    return { ok: false, error: "JSON non valido: incolla il contenuto del file OAuth scaricato da Google Cloud." };
  }
  if (!clientId || !clientSecret || !refreshToken) {
    return {
      ok: false,
      error: "Mancano client_id, client_secret o refresh_token: completa il flusso OAuth (passo 2) e riprova.",
    };
  }
  const site = normalizeGscSite(siteUrl);
  if (!site) return { ok: false, error: "URL proprietà non valido: usa https://www.webagencycrema.com oppure sc-domain:…" };

  const current = await pool.query<{ value: StoredGoogleTools }>(
    "select value from content_settings where key = $1",
    [GOOGLE_TOOLS_KEY],
  );
  const old = current.rows[0]?.value ?? {};
  const next: StoredGoogleTools = {
    ga4Id: old.ga4Id,
    gtmId: old.gtmId,
    gscToken: old.gscToken,
    clarityId: old.clarityId,
    apiKeyEnc: old.apiKeyEnc,
    gscCredsEnc: encryptKey(JSON.stringify({ clientId, clientSecret, refreshToken, site })),
    driveCredsEnc: old.driveCredsEnc,
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [GOOGLE_TOOLS_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

export async function removeGscCredentials(): Promise<void> {
  const pool = db();
  if (!pool) return;
  const current = await pool.query<{ value: StoredGoogleTools }>(
    "select value from content_settings where key = $1",
    [GOOGLE_TOOLS_KEY],
  );
  const old = current.rows[0]?.value ?? {};
  const next: StoredGoogleTools = { ...old, gscCredsEnc: "", driveCredsEnc: old.driveCredsEnc };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [GOOGLE_TOOLS_KEY, JSON.stringify(next)],
  );
}
