import { db } from "./db";
import { site } from "./site";

/**
 * Strumento SEO admin: meta globali, keyword per pagina, slug personalizzati
 * e redirect 301 — persistiti su content_settings (key `seo_config`), stesso
 * pattern di google_tools/site_theme. Senza DB o JSON invalido: default
 * coerenti (il sito funziona degradato, come tutto il resto).
 *
 * NOTA: le landing pubbliche restano generate da site.ts + [slug]/page.tsx
 * (statiche, già ottimizzate). Questo modulo gestisce le PERSONALIZZAZIONI:
 * meta/keyword per pagina (overlay sui contenuti di site.ts), slug custom
 * (l'app legge slugOverride e risponde anche su quello) e redirect 301
 * (il proxy li applica prima del router).
 */

export const SEO_CONFIG_KEY = "seo_config";

export interface LandingSeo {
  /** Title ≤ 60 caratteri (Google taglia oltre ~580px). */
  title: string;
  /** Meta description: ideale 120–160 caratteri. */
  description: string;
  /** Keyword principale (badge, JSON-LD, og:image). */
  keyword: string;
  /** Keyword secondarie (una per riga in UI, max 12). */
  keywords: string[];
  /** Slug personalizzato (vuoto = slug di site.ts). */
  slugOverride: string;
  /** Noindex: pagina esclusa da sitemap + meta robots noindex. */
  noindex: boolean;
}

export interface SeoRedirect {
  from: string;
  to: string;
  createdAt: string;
}

/**
 * Contenuti editabili di una landing (testi che l'admin può cambiare senza
 * toccare il codice). Vuoto = usa i testi di site.ts: il default è sempre
 * il codice, il DB contiene solo le personalizzazioni.
 */
export interface LandingContentOverride {
  /** Paragrafi introduttivi (1–6). */
  intro: string[];
  /** Servizi: titolo + testo (1–8). */
  services: { title: string; text: string }[];
  /** FAQ: domanda + risposta (0–12). */
  faq: { q: string; a: string }[];
  /** Riga «Prova sul territorio». */
  proof: string;
  /** H1 della pagina (vuoto = H1 di site.ts). */
  h1: string;
}

export interface SeoConfig {
  homeTitle: string;
  homeDescription: string;
  /** Keyword globali del sito (separate da virgola). */
  siteKeywords: string;
  ogSiteName: string;
  /** Override per landing, chiave = slug originale di site.ts. */
  landings: Record<string, LandingSeo>;
  redirects: SeoRedirect[];
  /** Contenuti personalizzati per landing (chiave = slug originale). */
  contents: Record<string, LandingContentOverride>;
  /**
   * Storico versioni contenuti per landing (chiave = slug originale).
   * Ogni sovrascrittura/reset archivia lo stato precedente; il più recente
   * è in testa. Ordinata dal più nuovo al più vecchio, max 10 per pagina.
   */
  contentHistory: Record<string, LandingContentVersion[]>;
  /** Storico versioni META per landing (stessa meccanica dei contenuti). */
  metaHistory: Record<string, LandingMetaVersion[]>;
  /**
   * Avvisi GSC per landing (chiave = slug originale): prodotti dal
   * confronto posizioni prima/dopo un ripristino di contenuti. Presenti
   * finché non si verifica «risolto» o «falso allarme» nella card.
   */
  pageAlerts: Record<string, LandingPageAlert>;
}

/** Avviso di calo posizioni GSC dopo un ripristino di contenuti. */
export interface LandingPageAlert {
  /** Posizione media nella finestra PRIMA del ripristino (28 giorni). */
  positionBefore: number;
  /** Posizione media dopo il ripristino (sul periodo trascorso). */
  positionAfter: number;
  /** ISO del ripristino misurato. */
  restoredAt: string;
  /** ISO della misurazione «dopo». */
  measuredAt: string;
  /** Giorni trascorsi tra ripristino e misurazione. */
  daysAfter: number;
  /** Quale versione è stata ripristinata (fonte archiviata). */
  restoredSource: "base" | "override" | "history";
  /** Stringa del timestamp della versione ripristinata (per tracciare quale). */
  restoredVersionTs: string;
}

/** Soglie dell'avviso calo posizioni (condivise UI/server). */
export const PAGE_ALERT_THRESHOLDS = {
  /** Minimo di giorni dopo il ripristino prima di misurare. */
  minDaysAfter: 10,
  /** Calo minimo di posizioni per considerarlo significativo. */
  minDrop: 2,
  /** Calo percentuale minimo (per pagine già in alto). */
  minDropPct: 20,
  /** Impressioni minime «dopo» per avere un confronto attendibile. */
  minImpressions: 30,
};

/** Una versione archiviata dei contenuti di una landing. */
export interface LandingContentVersion {
  intro: string[];
  services: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  proof: string;
  h1: string;
  /** ISO timestamp dell'archiviazione (= momento del salvataggio successivo). */
  archivedAt: string;
  /** Email dell'operatore che ha fatto il salvataggio che ha archiviato. */
  archivedBy: string;
  /** Dalla quale versione si è partiti: "base" = testi di codice site.ts. */
  source: "base" | "override" | "history";
}

/** Una versione archiviata delle META di una landing (title/description/keyword/slug/noindex). */
export interface LandingMetaVersion {
  title: string;
  description: string;
  keyword: string;
  keywords: string[];
  slugOverride: string;
  noindex: boolean;
  /** ISO timestamp dell'archiviazione (= momento del salvataggio successivo). */
  archivedAt: string;
  /** Email dell'operatore che ha fatto il salvataggio che ha archiviato. */
  archivedBy: string;
  /** Provenienza: "base" = default di codice (nessun override). */
  source: "base" | "override" | "history";
}

export const DEFAULT_SEO_CONFIG: SeoConfig = {
  homeTitle: `${site.name} — Web agency nel Salento`,
  homeDescription:
    "Web agency nel Salento: siti web in 7 giorni, e-commerce e SEO locale. Cerca nella barra, chatta col team e ti richiamiamo in giornata.",
  siteKeywords:
    "web agency Salento, siti web Lecce, SEO Salento, e-commerce Lecce, posizionamento Google Salento, siti web Gallipoli",
  ogSiteName: site.name,
  landings: {},
  redirects: [],
  contents: {},
  contentHistory: {},
  metaHistory: {},
  pageAlerts: {},
};

/* ── Sanitizers (puri, riusabili anche dal client) ─────────────── */

const MAX_TITLE = 70; // oltre, Google taglia: la UI mostra il contatore
const MAX_DESCRIPTION = 200; // ideale 120–160
const MAX_CONTENT_VERSIONS = 10; // storico contenuti per landing (il più nuovo in testa)
const MAX_META_VERSIONS = 10; // storico meta per landing (il più nuovo in testa)

export function sanitizeSeoTitle(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_TITLE) : "";
}

export function sanitizeSeoDescription(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_DESCRIPTION) : "";
}

/** Slug: lowercase, ascii, solo [a-z0-9-], niente doppi trattini né edge. */
export function sanitizeSlug(v: unknown): string {
  return typeof v === "string"
    ? v
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80)
    : "";
}

/** Lista keyword da textarea (una per riga o virgole) → array pulito. */
export function parseKeywordList(v: unknown, max = 12): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(/[\n,]/)
    .map((k) => k.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, max);
}

/** Path di redirect valido: assoluto interno (/foo/bar) o stessa pagina con query. */
export function isValidRedirectPath(v: string): boolean {
  // Solo path interni: niente domini esterni (open redirect), niente spazi.
  return v.startsWith("/") && !v.includes(" ") && !v.includes("\\") && v.length <= 500;
}

/* ── Config: lettura + scrittura ───────────────────────────────── */

function landingSeoFromRaw(raw: unknown): LandingSeo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = sanitizeSeoTitle(r.title);
  const description = sanitizeSeoDescription(r.description);
  const keyword = typeof r.keyword === "string" ? r.keyword.trim().slice(0, 80) : "";
  const keywords = Array.isArray(r.keywords)
    ? r.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().slice(0, 60)).filter(Boolean).slice(0, 12)
    : [];
  const slugOverride = sanitizeSlug(r.slugOverride);
  const noindex = r.noindex === true;
  // Tutto vuoto e nessun flag → override inutile: scartiamo.
  if (!title && !description && !keyword && keywords.length === 0 && !slugOverride && !noindex) {
    return null;
  }
  return { title, description, keyword, keywords, slugOverride, noindex };
}

/** Sanifica l'intera config arrivata dal form/JSON admin. */
export function sanitizeSeoConfig(raw: unknown): SeoConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const landings: Record<string, LandingSeo> = {};
  const rawLandings = (r.landings ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawLandings).slice(0, 60)) {
    const cleaned = landingSeoFromRaw(val);
    if (cleaned) landings[String(key).slice(0, 100)] = cleaned;
  }
  const redirects: SeoRedirect[] = Array.isArray(r.redirects)
    ? (r.redirects as unknown[])
        .slice(0, 100)
        .map((x) => {
          const rr = (x ?? {}) as Record<string, unknown>;
          return {
            from: sanitizeSlug(String(rr.from ?? "")).slice(0, 100),
            to: typeof rr.to === "string" ? rr.to.trim().slice(0, 300) : "",
            createdAt: typeof rr.createdAt === "string" ? rr.createdAt.slice(0, 40) : new Date(0).toISOString(),
          };
        })
        .filter((x) => x.from.length > 0 && isValidRedirectPath(x.to))
    : [];
  // Contenuti landing: intro/services/faq/proof/h1 personalizzati.
  const contents: Record<string, LandingContentOverride> = {};
  const rawContents = (r.contents ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawContents).slice(0, 60)) {
    const c = (val ?? {}) as Record<string, unknown>;
    const intro = Array.isArray(c.intro)
      ? (c.intro as unknown[]).slice(0, 6).map((x) => String(x ?? "").trim().slice(0, 2000)).filter(Boolean)
      : [];
    const services = Array.isArray(c.services)
      ? (c.services as unknown[])
          .slice(0, 8)
          .map((x) => {
            const s = (x ?? {}) as Record<string, unknown>;
            return { title: String(s.title ?? "").trim().slice(0, 120), text: String(s.text ?? "").trim().slice(0, 800) };
          })
          .filter((s) => s.title && s.text)
      : [];
    const faq = Array.isArray(c.faq)
      ? (c.faq as unknown[])
          .slice(0, 12)
          .map((x) => {
            const f = (x ?? {}) as Record<string, unknown>;
            return { q: String(f.q ?? "").trim().slice(0, 300), a: String(f.a ?? "").trim().slice(0, 1500) };
          })
          .filter((f) => f.q && f.a)
      : [];
    const proof = typeof c.proof === "string" ? c.proof.trim().slice(0, 500) : "";
    const h1 = typeof c.h1 === "string" ? c.h1.trim().slice(0, 160) : "";
    if (intro.length || services.length || faq.length || proof || h1) {
      contents[String(key).slice(0, 100)] = { intro, services, faq, proof, h1 };
    }
  }

  // Storico contenuti: solo voci ben formate; il ripristino riusa i percorsi
  // di salvataggio normali, quindi i contenuti tornano comunque sanificati.
  const contentHistory: Record<string, LandingContentVersion[]> = {};
  const rawHistory = (r.contentHistory ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawHistory).slice(0, 60)) {
    if (!Array.isArray(val)) continue;
    const versions = (val as unknown[])
      .slice(0, MAX_CONTENT_VERSIONS)
      .map((x): LandingContentVersion | null => {
        const v = (x ?? {}) as Record<string, unknown>;
        const src: LandingContentVersion["source"] =
          v.source === "history" ? "history" : v.source === "override" ? "override" : "base";
        return {
          intro: Array.isArray(v.intro) ? (v.intro as unknown[]).slice(0, 6).map((p) => String(p ?? "").slice(0, 2000)) : [],
          services: Array.isArray(v.services)
            ? (v.services as unknown[]).slice(0, 8).map((s) => {
                const sv = (s ?? {}) as Record<string, unknown>;
                return { title: String(sv.title ?? "").slice(0, 120), text: String(sv.text ?? "").slice(0, 800) };
              })
            : [],
          faq: Array.isArray(v.faq)
            ? (v.faq as unknown[]).slice(0, 12).map((f) => {
                const fv = (f ?? {}) as Record<string, unknown>;
                return { q: String(fv.q ?? "").slice(0, 300), a: String(fv.a ?? "").slice(0, 1500) };
              })
            : [],
          proof: typeof v.proof === "string" ? v.proof.slice(0, 500) : "",
          h1: typeof v.h1 === "string" ? v.h1.slice(0, 160) : "",
          archivedAt: typeof v.archivedAt === "string" ? v.archivedAt.slice(0, 40) : new Date(0).toISOString(),
          archivedBy: typeof v.archivedBy === "string" ? v.archivedBy.slice(0, 200) : "sconosciuto",
          source: src,
        };
      })
      .filter((v): v is LandingContentVersion => v !== null);
    if (versions.length > 0) contentHistory[String(key).slice(0, 100)] = versions;
  }

  // Storico meta: stesse regole dello storico contenuti.
  const metaHistory: Record<string, LandingMetaVersion[]> = {};
  const rawMetaHistory = (r.metaHistory ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawMetaHistory).slice(0, 60)) {
    if (!Array.isArray(val)) continue;
    const versions = (val as unknown[])
      .slice(0, MAX_META_VERSIONS)
      .map((x): LandingMetaVersion | null => {
        const v = (x ?? {}) as Record<string, unknown>;
        const src: LandingMetaVersion["source"] =
          v.source === "history" ? "history" : v.source === "override" ? "override" : "base";
        return {
          title: sanitizeSeoTitle(v.title),
          description: sanitizeSeoDescription(v.description),
          keyword: typeof v.keyword === "string" ? v.keyword.slice(0, 80) : "",
          keywords: Array.isArray(v.keywords)
            ? (v.keywords as unknown[]).slice(0, 12).map((k) => String(k ?? "").slice(0, 60)).filter(Boolean)
            : [],
          slugOverride: sanitizeSlug(v.slugOverride),
          noindex: v.noindex === true,
          archivedAt: typeof v.archivedAt === "string" ? v.archivedAt.slice(0, 40) : new Date(0).toISOString(),
          archivedBy: typeof v.archivedBy === "string" ? v.archivedBy.slice(0, 200) : "sconosciuto",
          source: src,
        };
      })
      .filter((v): v is LandingMetaVersion => v !== null);
    if (versions.length > 0) metaHistory[String(key).slice(0, 100)] = versions;
  }

  // Avvisi GSC: un solo avviso per pagina, i campi essenziali validati.
  const pageAlerts: Record<string, LandingPageAlert> = {};
  const rawAlerts = (r.pageAlerts ?? {}) as Record<string, unknown>;
  for (const [key, val] of Object.entries(rawAlerts).slice(0, 60)) {
    const a = (val ?? {}) as Record<string, unknown>;
    const positionBefore = Number(a.positionBefore);
    const positionAfter = Number(a.positionAfter);
    if (!Number.isFinite(positionBefore) || !Number.isFinite(positionAfter) || typeof a.restoredAt !== "string") continue;
    pageAlerts[String(key).slice(0, 100)] = {
      positionBefore,
      positionAfter,
      restoredAt: a.restoredAt.slice(0, 40),
      measuredAt: typeof a.measuredAt === "string" ? a.measuredAt.slice(0, 40) : new Date(0).toISOString(),
      daysAfter: Number.isFinite(Number(a.daysAfter)) ? Math.max(0, Math.round(Number(a.daysAfter))) : 0,
      restoredSource: a.restoredSource === "history" ? "history" : a.restoredSource === "override" ? "override" : "base",
      restoredVersionTs: typeof a.restoredVersionTs === "string" ? a.restoredVersionTs.slice(0, 40) : "",
    };
  }

  return {
    homeTitle: sanitizeSeoTitle(r.homeTitle) || DEFAULT_SEO_CONFIG.homeTitle,
    homeDescription: sanitizeSeoDescription(r.homeDescription) || DEFAULT_SEO_CONFIG.homeDescription,
    siteKeywords:
      typeof r.siteKeywords === "string" ? r.siteKeywords.trim().slice(0, 400) : DEFAULT_SEO_CONFIG.siteKeywords,
    ogSiteName: typeof r.ogSiteName === "string" ? r.ogSiteName.trim().slice(0, 80) || site.name : DEFAULT_SEO_CONFIG.ogSiteName,
    landings,
    redirects,
    contents,
    contentHistory,
    metaHistory,
    pageAlerts,
  };
}

/** Legge la config salvata; DB assente/JSON invalido → default. */
export async function getSeoConfig(): Promise<SeoConfig> {
  const pool = db();
  if (!pool) return DEFAULT_SEO_CONFIG;
  try {
    const { rows } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = $1",
      [SEO_CONFIG_KEY],
    );
    const raw = rows[0]?.value;
    if (!raw || typeof raw !== "object") return DEFAULT_SEO_CONFIG;
    return sanitizeSeoConfig(raw);
  } catch {
    return DEFAULT_SEO_CONFIG;
  }
}

/** Salva la config (upsert su content_settings). */
export async function saveSeoConfig(config: SeoConfig): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("database non configurato");
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [SEO_CONFIG_KEY, JSON.stringify(config)],
  );
}

/**
 * Archivia una versione dei contenuti di una landing in testa allo storico
 * (il più recente primo), con tetto a MAX_CONTENT_VERSIONS. È il chiamante
 * a decidere COSA archiviare (lo stato corrente prima della sovrascrittura)
 * e chi (operatore): qui si gestisce solo la meccanica dello storico.
 */
export function pushContentVersion(
  config: SeoConfig,
  slugKey: string,
  version: Omit<LandingContentVersion, never> & { archivedAt?: string },
): void {
  const entry: LandingContentVersion = {
    intro: version.intro,
    services: version.services,
    faq: version.faq,
    proof: version.proof,
    h1: version.h1,
    archivedAt: version.archivedAt ?? new Date().toISOString(),
    archivedBy: version.archivedBy,
    source: version.source,
  };
  const list = config.contentHistory[slugKey] ?? [];
  config.contentHistory[slugKey] = [entry, ...list].slice(0, MAX_CONTENT_VERSIONS);
}

/**
 * Archivia una versione delle META di una landing in testa allo storico
 * (stessa meccanica dei contenuti): il chiamante decide cosa e chi.
 */
export function pushMetaVersion(
  config: SeoConfig,
  slugKey: string,
  version: LandingMetaVersion,
): void {
  const list = config.metaHistory[slugKey] ?? [];
  config.metaHistory[slugKey] = [version, ...list].slice(0, MAX_META_VERSIONS);
}

/**
 * Registra l'avviso di calo posizioni di una landing: UN avviso per pagina,
 * il più recente vince (se ne misuri uno nuovo, sovrascrive il vecchio).
 */
export function recordPageAlert(config: SeoConfig, slugKey: string, alert: LandingPageAlert): void {
  config.pageAlerts[slugKey] = alert;
}

/* ── Helper per il sito pubblico ───────────────────────────────── */

export interface EffectiveLandingSeo {
  /** Slug realmente servito (override o originale). */
  slug: string;
  title: string;
  description: string;
  keyword: string;
  keywords: string[];
  noindex: boolean;
}

/**
 * Unisce i contenuti statici di site.ts con gli override admin.
 * `landings` è l'array importato da site.ts (passato dal chiamante per
 * evitare dipendenze circolari: site.ts non importa seo.ts).
 */
export function effectiveLandingSeo<T extends { slug: string; title: string; description: string; keyword: string; keywords: string[] }>(
  landing: T,
  config: SeoConfig,
): EffectiveLandingSeo {
  const o = config.landings[landing.slug];
  return {
    slug: o?.slugOverride || landing.slug,
    title: o?.title || landing.title,
    description: o?.description || landing.description,
    keyword: o?.keyword || landing.keyword,
    keywords: o && o.keywords.length > 0 ? o.keywords : landing.keywords,
    noindex: o?.noindex ?? false,
  };
}

/**
 * Contenuti effettivi di una landing: override admin (se esiste) sopra i
 * testi di site.ts, campo per campo. Un override parziale riempie solo i
 * campi personalizzati; senza DB o senza override resta tutto al codice.
 */
export function effectiveLandingContent<T extends { slug: string; h1: string; intro: string[]; services: { title: string; text: string }[]; faq: { q: string; a: string }[]; proof: string }>(
  landing: T,
  config: SeoConfig,
): T {
  const o = config.contents[landing.slug];
  if (!o) return landing;
  return {
    ...landing,
    h1: o.h1 || landing.h1,
    intro: o.intro.length > 0 ? o.intro : landing.intro,
    services: o.services.length > 0 ? o.services : landing.services,
    faq: o.faq.length > 0 ? o.faq : landing.faq,
    proof: o.proof || landing.proof,
  };
}

/** Mappa slug-originale → slug-effettivo (per sitemap e proxy). */
export function slugOverrideMap(config: SeoConfig): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [base, o] of Object.entries(config.landings)) {
    if (o.slugOverride && o.slugOverride !== base) map[base] = o.slugOverride;
  }
  return map;
}

/**
 * Trova la landing a partire dallo slug realmente servito: prima quello
 * originale, poi i reverse-lookup sugli slug personalizzati (un URL
 * rinominato deve continuare a trovare la sua pagina).
 */
export function findLandingByServedSlug<T extends { slug: string }>(
  slug: string,
  landings: T[],
  config: SeoConfig,
): T | undefined {
  const direct = landings.find((l) => l.slug === slug);
  if (direct) return direct;
  return landings.find((l) => config.landings[l.slug]?.slugOverride === slug);
}

/* ── Diff pre-import (backup vs config live) ───────────────────── */

/** Confronto semplice per campo testo: trim + uguaglianza. */
function sameText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** Riga del diff di una sezione per landing. */
export interface SeoConfigDiffRow {
  /** Pagina (slug originale), "globale" per i meta home, o path «/…» per i redirect. */
  page: string;
  /** Sezione: meta, contenuti, redirect o alert. */
  section: "meta" | "contenuti" | "redirect" | "alert";
  /** added = presente solo nel backup, removed = solo nella config live, changed = presente in entrambi ma diverso. */
  change: "added" | "removed" | "changed";
}

/**
 * Confronta una config di backup con quella live (entrambe GIÀ
 * sanificate): elenca le differenze per pagina e sezione. Il chiamante
 * decide come mostrarle; qui solo la logica pura di confronto.
 */
export function diffSeoConfig(backup: SeoConfig, live: SeoConfig): SeoConfigDiffRow[] {
  const rows: SeoConfigDiffRow[] = [];

  // Meta globali (home).
  if (
    !sameText(backup.homeTitle, live.homeTitle) ||
    !sameText(backup.homeDescription, live.homeDescription) ||
    !sameText(backup.siteKeywords, live.siteKeywords) ||
    !sameText(backup.ogSiteName, live.ogSiteName)
  ) {
    rows.push({ page: "globale", section: "meta", change: "changed" });
  }

  const pages = new Set([
    ...Object.keys(backup.landings),
    ...Object.keys(live.landings),
    ...Object.keys(backup.contents),
    ...Object.keys(live.contents),
  ]);

  for (const page of pages) {
    const bm = backup.landings[page];
    const lm = live.landings[page];
    if (bm && !lm) {
      rows.push({ page, section: "meta", change: "added" });
    } else if (!bm && lm) {
      rows.push({ page, section: "meta", change: "removed" });
    } else if (
      bm &&
      lm &&
      (!sameText(bm.title, lm.title) ||
        !sameText(bm.description, lm.description) ||
        !sameText(bm.keyword, lm.keyword) ||
        bm.keywords.join(",") !== lm.keywords.join(",") ||
        bm.slugOverride !== lm.slugOverride ||
        bm.noindex !== lm.noindex)
    ) {
      rows.push({ page, section: "meta", change: "changed" });
    }

    const bc = backup.contents[page];
    const lc = live.contents[page];
    if (bc && !lc) {
      rows.push({ page, section: "contenuti", change: "added" });
    } else if (!bc && lc) {
      rows.push({ page, section: "contenuti", change: "removed" });
    } else if (bc && lc && JSON.stringify(bc) !== JSON.stringify(lc)) {
      rows.push({ page, section: "contenuti", change: "changed" });
    }
  }

  const alertPages = new Set([...Object.keys(backup.pageAlerts), ...Object.keys(live.pageAlerts)]);
  for (const page of alertPages) {
    const ba = backup.pageAlerts[page];
    const la = live.pageAlerts[page];
    const baTs = ba?.restoredAt ?? "";
    const laTs = la?.restoredAt ?? "";
    if (baTs !== laTs) {
      rows.push({ page, section: "alert", change: ba && !la ? "added" : !ba && la ? "removed" : "changed" });
    }
  }

  // Redirect: confronto per «from».
  const map = (list: SeoRedirect[]) => new Map(list.map((r) => [r.from, r.to]));
  const bm2 = map(backup.redirects);
  const lm2 = map(live.redirects);
  for (const [from, to] of bm2) {
    if (!lm2.has(from)) rows.push({ page: from, section: "redirect", change: "added" });
    else if (lm2.get(from) !== to) rows.push({ page: from, section: "redirect", change: "changed" });
  }
  for (const from of lm2.keys()) {
    if (!bm2.has(from)) rows.push({ page: from, section: "redirect", change: "removed" });
  }

  return rows;
}
