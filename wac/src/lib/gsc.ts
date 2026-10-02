import { getGscCredentials, type GscCredentials } from "./google-tools";
import { site } from "./site";

/**
 * Google Search Console — lettura delle query reali (searchAnalytics).
 * Usa le credenziali OAuth salvate cifrate in Tools (client id/secret +
 * refresh token): niente SDK, solo due fetch. I fallback/limiti sono gli
 * stessi del resto del progetto: mai bloccante, errori parlanti in UI.
 *
 * Nota API: i dati di Search Console hanno un ritardo di 2–3 giorni, quindi
 * la finestra "ultimi N giorni" esclude gli ultimi 3 per non mostrare buchi.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites";

export interface GscQueryRow {
  /** Query digitata su Google ("" = anchoring/altro — esclusa). */
  query: string;
  clicks: number;
  impressions: number;
  /** Posizione media (0 se non disponibile). */
  position: number;
}

export interface GscQueries {
  rows: GscQueryRow[];
  siteUrl: string;
  /** Giorni effettivamente interrogati (per la nota in UI). */
  days: number;
}

/** Errore con messaggio già pronto per l'admin (questi risultati finiscono in UI). */
export class GscError extends Error {}

async function fetchAccessToken(creds: GscCredentials): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    if (res.status === 400 || res.status === 401) {
      throw new GscError("Refresh token rifiutato da Google: rifai il passo OAuth e risalva le credenziali in Tools.");
    }
    throw new GscError(`Google OAuth ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new GscError("Google non ha restituito un access token: riprova tra poco.");
  return data.access_token;
}

interface ApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  position?: number;
}

/** Finestra interrogabile: ultimi N giorni chiusi 3 giorni fa (dati GSC in ritardo). */
function dateWindow(days: number): { startDate: string; endDate: string; days: number } {
  const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end), days };
}

async function searchAnalytics(
  creds: GscCredentials,
  body: Record<string, unknown>,
): Promise<ApiRow[]> {
  const token = await fetchAccessToken(creds);
  const url = `${SEARCH_URL}/${encodeURIComponent(creds.siteUrl)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    if (res.status === 403) {
      throw new GscError(
        "Accesso negato: verifica che l'account OAuth sia proprietario (o con permesso «pieno») della proprietà su Search Console.",
      );
    }
    if (res.status === 404) {
      throw new GscError(
        `Proprietà «${creds.siteUrl}» non trovata: controlla che l'URL salvo in Tools corrisponda esattamente a quello di Search Console.`,
      );
    }
    throw new GscError(`Search Console ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { rows?: ApiRow[] };
  return data.rows ?? [];
}

function toRows(apiRows: ApiRow[]): GscQueryRow[] {
  return apiRows
    .map((r) => ({
      query: String(r.keys?.[0] ?? "").trim(),
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      position: Number(r.position ?? 0),
    }))
    .filter((r) => r.query.length > 0);
}

/**
 * Top query del sito (dimensione: query). Default 28 giorni, max 90;
 * restituisce fino a `limit` righe ordinate per click dall'API.
 */
export async function getGscQueries(days = 28, limit = 50): Promise<GscQueries> {
  const creds = await getGscCredentials();
  if (!creds) throw new GscError("Credenziali Search Console mancanti: salvale in Admin → Tools.");
  const window = dateWindow(Math.min(Math.max(days, 7), 90));
  const apiRows = await searchAnalytics(creds, {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: ["query"],
    rowLimit: Math.min(Math.max(limit, 10), 250),
    dataState: "final",
  });
  return { rows: toRows(apiRows), siteUrl: creds.siteUrl, days: window.days };
}

/**
 * Query di una singola pagina (dimensioni: query + page, filtro sulla pagina)
 * per affiancarle alle keyword configurate in quella card dell'editor SEO.
 */
export async function getGscPageQueries(pagePath: string, days = 28, limit = 25): Promise<GscQueries> {
  const creds = await getGscCredentials();
  if (!creds) throw new GscError("Credenziali Search Console mancanti: salvale in Admin → Tools.");
  const base = site.url.replace(/\/$/, "");
  const absolute = pagePath.startsWith("/") ? `${base}${pagePath}` : pagePath;
  const window = dateWindow(Math.min(Math.max(days, 7), 90));
  const apiRows = await searchAnalytics(creds, {
    startDate: window.startDate,
    endDate: window.endDate,
    dimensions: ["query", "page"],
    dimensionFilterGroups: [
      {
        filters: [{ dimension: "page", expression: absolute }],
      },
    ],
    rowLimit: Math.min(Math.max(limit, 10), 100),
    dataState: "final",
  });
  return { rows: toRows(apiRows), siteUrl: creds.siteUrl, days: window.days };
}

/**
 * Posizione media AGGREGATA di una pagina su una finestra arbitraria: usa
 * start/end offset e gruppo "page" così l'API restituisce una sola riga con
 * la media complessiva (non la media delle query — corretta per l'analisi
 * before/after di un cambiamento). Numero clic/impression incluse.
 */
export async function getGscPagePosition(
  pagePath: string,
  days = 28,
  endOffset = 3,
): Promise<{ position: number; clicks: number; impressions: number; days: number } | null> {
  const creds = await getGscCredentials();
  if (!creds) throw new GscError("Credenziali Search Console mancanti: salvale in Admin → Tools.");
  const base = site.url.replace(/\/$/, "");
  const absolute = pagePath.startsWith("/") ? `${base}${pagePath}` : pagePath;
  const d = Math.min(Math.max(days, 7), 90);
  const end = new Date(Date.now() - endOffset * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (d - 1) * 24 * 60 * 60 * 1000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const apiRows = await searchAnalytics(creds, {
    startDate: iso(start),
    endDate: iso(end),
    dimensions: ["page"],
    dimensionFilterGroups: [
      { filters: [{ dimension: "page", expression: absolute }] },
    ],
    rowLimit: 1,
    dataState: "final",
  });
  const row = apiRows[0];
  if (!row) return null; // pagina senza dati nella finestra
  return {
    position: Number(row.position ?? 0),
    clicks: Math.round(row.clicks ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    days: d,
  };
}

export interface GscTrendPoint {
  /** Data ISO (yyyy-mm-dd). */
  date: string;
  /** Posizione media del giorno (0 se la pagina non ha avuto impression). */
  position: number;
  impressions: number;
  clicks: number;
}

/**
 * Serie giornaliera della posizione media di una pagina (ultimi N giorni,
 * chiusi 3 giorni fa per il ritardo dei dati GSC). Dimensione "date" con
 * filtro pagina: una riga per giorno. Serve al grafico in-card: trend,
 * buchi (giorni senza impression) e correlazione coi ripristini.
 */
export async function getGscPagePositionTrend(pagePath: string, days = 90): Promise<GscTrendPoint[]> {
  const creds = await getGscCredentials();
  if (!creds) throw new GscError("Credenziali Search Console mancanti: salvale in Admin → Tools.");
  const base = site.url.replace(/\/$/, "");
  const absolute = pagePath.startsWith("/") ? `${base}${pagePath}` : pagePath;
  const d = Math.min(Math.max(days, 14), 90);
  const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (d - 1) * 24 * 60 * 60 * 1000);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const apiRows = await searchAnalytics(creds, {
    startDate: iso(start),
    endDate: iso(end),
    dimensions: ["date"],
    dimensionFilterGroups: [
      { filters: [{ dimension: "page", expression: absolute }] },
    ],
    rowLimit: 100,
    dataState: "final",
  });
  const byDate = new Map<string, ApiRow>();
  for (const r of apiRows) {
    const date = String(r.keys?.[0] ?? "");
    if (date) byDate.set(date, r);
  }
  // Serie completa: i giorni senza dati diventano position 0 / impressions 0
  // (il grafico li mostrerà come vuoti, non come «posizione 1»).
  const points: GscTrendPoint[] = [];
  for (let i = 0; i < d; i++) {
    const day = new Date(start.getTime() + i * 86400000);
    const key = iso(day);
    const r = byDate.get(key);
    points.push({
      date: key,
      position: Number(r?.position ?? 0),
      impressions: Math.round(r?.impressions ?? 0),
      clicks: Math.round(r?.clicks ?? 0),
    });
  }
  return points;
}

/** Test di connessione: una query minima sull'ultima settimana disponibile. */
export async function testGscConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const creds = await getGscCredentials();
    if (!creds) return { ok: false, message: "Credenziali Search Console mancanti." };
    const token = await fetchAccessToken(creds);
    const res = await fetch(`${SEARCH_URL}/${encodeURIComponent(creds.siteUrl)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 403) {
        return { ok: false, message: "Token valido ma accesso negato alla proprietà: manca il permesso «pieno» all'account OAuth." };
      }
      if (res.status === 404) {
        return { ok: false, message: `Proprietà «${creds.siteUrl}» non trovata su Search Console: correggi l'URL in Tools.` };
      }
      return { ok: false, message: `Search Console ha risposto ${res.status}.` };
    }
    const data = (await res.json()) as { permissionLevel?: string };
    return {
      ok: true,
      message: `Collegato a ${creds.siteUrl} (permesso: ${data.permissionLevel ?? "sconosciuto"}).`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof GscError ? e.message : "Search Console non raggiungibile: riprova tra poco." };
  }
}
