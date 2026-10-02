/**
 * AGGIORNAMENTI PER DOMINIO — funzioni PURE (decisione 2026-10-01,
 * docs/DECISIONE-UPDATES-BACKUP-2026-10-01.md §9).
 *
 * Il dominio è l'unità base: ogni area (temi, hero, Ambrosio AI, tools,
 * impostazioni) salva i propri snapshot JSON con changelog e rollback;
 * una «release» è un'etichetta sull'insieme, non un formato nuovo. Gli
 * snapshot vivono in content_settings (chiave `dominio_snapshot_<id>`,
 * stesso pattern di seo_backups): nessuna migration, righe on-demand.
 *
 * Questo file è importabile dai client (nessun db). La lettura/scrittura
 * sta in `domain-snapshots.ts` (server-only), sul taglio di theme.ts.
 */

/** I domini della v1. Il ticketing è uno STUB: si attiva quando la feature arriva. */
export const DOMINI = [
  { id: "temi", label: "Temi grafici", icona: "palette", attivo: true },
  { id: "hero", label: "Hero animato", icona: "sparkles", attivo: true },
  { id: "ambrosio", label: "Ambrosio AI", icona: "bot", attivo: true },
  { id: "tools", label: "Tools", icona: "wrench", attivo: true },
  { id: "settings", label: "Impostazioni", icona: "sliders", attivo: true },
  { id: "ticketing", label: "Ticketing (in arrivo)", icona: "ticket", attivo: false },
] as const;

export type DominioId = (typeof DOMINI)[number]["id"];

/** Alias per i punti d'uso che parlano inglese. */
export type DomainId = DominioId;

export function isDominioAttivo(id: string): id is Exclude<DominioId, "ticketing"> {
  return DOMINI.some((d) => d.id === id && d.attivo);
}

export function labelDominio(id: string): string {
  return DOMINI.find((d) => d.id === id)?.label ?? id;
}

/** Chiave content_settings dello storico snapshot del dominio. */
export function dominioSnapshotKey(domain: DomainId | string): string {
  return `dominio_snapshot_${domain}`;
}

/** Massimo snapshot per dominio: i più vecchi cadono (dedup oltre). */
export const SNAPSHOT_MAX = 20;

/** Un nodo dello storico (come viene persistito in content_settings). */
export interface SnapshotEntry {
  /** ISO dello snapshot. */
  takenAt: string;
  /** Email dell'admin che l'ha salvato (o "import"). */
  takenBy: string;
  /** Nota facoltativa: il perché (es. «prima della nuova palette»). */
  nota: string;
  /** sha256 del payload canonico: due snapshot identici non si duplicano. */
  sha256: string;
  /** Il payload del dominio COMPLETO al momento dello snapshot. */
  data: unknown;
}

/**
 * Serializzazione CANONICA (chiavi ordinate ricorsivamente): la stessa
 * lezione di seo-backups.ts — jsonb riordina le chiavi, il confronto di
 * dedup e lo sha256 devono vedere la stessa stringa per lo stesso stato.
 */
export function jsonCanonico(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(jsonCanonico).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const chiavi = Object.keys(obj).sort();
  return `{${chiavi.map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`).join(",")}}`;
}

/**
 * Filtri dell'EXPORT verso il gemello (decisione: sì, con whitelist).
 * Il payload LOCALE resta completo; la variante gemello porta solo ciò che
 * è «gemello-pari» (logica e struttura), MAI segreti o testi di sito.
 */
const FILTRO_GEMELLO: Record<string, (data: Record<string, unknown>) => Record<string, unknown>> = {
  temi: (d) => {
    // Il tema è struttura+colori: passa tutto (i colori SONO la fix).
    const t = (d.site_theme ?? {}) as Record<string, unknown>;
    return { site_theme: { theme: t.theme, mode: t.mode, primary: t.primary, accent: t.accent } };
  },
  hero: (d) => {
    // L'hero porta template/flags/ricette (gemello-pari), MAI i testi:
    // eyebrow/title/subtitle/placeholder sono la voce del sito.
    const h = (d.site_hero ?? {}) as Record<string, unknown>;
    if (!h || typeof h !== "object") return { site_hero: null };
    const gemello: Record<string, unknown> = { ...h };
    for (const k of ["eyebrow", "title", "titleHighlight", "subtitle", "placeholder"]) delete gemello[k];
    return { site_hero: gemello };
  },
  ambrosio: (d) => {
    // MAI la chiave API: il gemello ha le sue. Prompt e FAQ sono la lezione
    // condivisa; temperature/provider/model sono gemello-pari.
    const s = (d.ai_settings ?? {}) as Record<string, unknown>;
    const f = Array.isArray(d.ai_faqs) ? d.ai_faqs : [];
    const { api_key_enc: _scartata, ...senzaChiave } = s;
    return { ai_settings: senzaChiave, ai_faqs: f };
  },
  tools: (d) => {
    // Config calendario senza token (l'hash dell'export token non viaggia).
    const hub = { ...((d.calendar_hub ?? {}) as Record<string, unknown>) };
    for (const k of Object.keys(hub)) if (/token/i.test(k)) delete hub[k];
    return { calendar_hub: hub };
  },
  settings: (d) => d, // le impostazioni di comportamento sono gemello-pari per definizione
};

/** Variante «per il gemello» di un payload di dominio (whitelist + niente segreti). */
export function filtraPerGemello(domain: DomainId | string, data: unknown): unknown {
  const filtro = FILTRO_GEMELLO[domain];
  if (!filtro || !data || typeof data !== "object") return data;
  return filtro(data as Record<string, unknown>);
}

/** Defensiva: lo storico letto dal DB è shaped come ci si aspetta o si scarta. */
export function sanitizeEntries(raw: unknown): SnapshotEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): SnapshotEntry | null => {
      const e = (x ?? {}) as Record<string, unknown>;
      if (typeof e.takenAt !== "string" || !e.data || typeof e.sha256 !== "string") return null;
      return {
        takenAt: e.takenAt.slice(0, 40),
        takenBy: typeof e.takenBy === "string" ? e.takenBy.slice(0, 200) : "system",
        nota: typeof e.nota === "string" ? e.nota.slice(0, 200) : "",
        sha256: e.sha256.slice(0, 64),
        data: e.data,
      };
    })
    .filter((e): e is SnapshotEntry => e !== null)
    .slice(0, SNAPSHOT_MAX);
}

/* ── FASE 3: etichette di release ─────────────────────────────── */

/** Massimo etichette di release: le più vecchie cadono. */
export const RELEASE_MAX = 10;

/**
 * Un'etichetta di release: un punto NOMINATO che raggruppa gli
 * snapshot correnti di tutti i domini attivi. Non è un formato
 * nuovo di dati — «punti» referenzia i takenAt degli snapshot che
 * già vivono in `dominio_snapshot_<dominio>` (decisione §9: la
 * release è un'etichetta sull'insieme, non un artefatto a parte).
 */
export interface ReleaseLabel {
  /** Nome slug univoco: es. «tools-fix-2026-10-05». */
  nome: string;
  /** ISO di creazione. */
  creataAt: string;
  /** Email dell'admin che l'ha creata. */
  creataDa: string;
  /** Nota facoltativa: il perché della release. */
  nota: string;
  /** Dominio → takenAt dello snapshot che l'etichetta congela. */
  punti: Record<string, string>;
}

/**
 * Il nome è uno slug leggibile (es. tools-fix-2026-10-05):
 * minuscole, cifre e tratti, 3–60 caratteri. Ritorna l'errore,
 * o null se il nome è valido.
 */
export function validaNomeRelease(nome: string): string | null {
  const n = nome.trim();
  if (n.length < 3) return "minimo 3 caratteri";
  if (n.length > 60) return "massimo 60 caratteri";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) {
    return "solo minuscole, cifre e tratti (es. tools-fix-2026-10-05)";
  }
  return null;
}

/** Defensiva: le etichette lette dal DB sono shaped come ci si aspetta. */
export function sanitizeReleases(raw: unknown): ReleaseLabel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): ReleaseLabel | null => {
      const e = (x ?? {}) as Record<string, unknown>;
      if (typeof e.nome !== "string" || !e.nome.trim()) return null;
      if (typeof e.creataAt !== "string" || typeof e.creataDa !== "string") return null;
      if (!e.punti || typeof e.punti !== "object" || Array.isArray(e.punti)) return null;
      const punti: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.punti as Record<string, unknown>)) {
        // Solo domini attivi: un punto su un dominio futuro/rimosso non si ripristina.
        if (typeof v === "string" && v && isDominioAttivo(k)) punti[k] = v.slice(0, 40);
      }
      return {
        nome: e.nome.slice(0, 60),
        creataAt: e.creataAt.slice(0, 40),
        creataDa: e.creataDa.slice(0, 200),
        nota: typeof e.nota === "string" ? e.nota.slice(0, 200) : "",
        punti,
      };
    })
    .filter((e): e is ReleaseLabel => e !== null)
    .slice(0, RELEASE_MAX);
}

/* ── IMPORT dall'export «per gemello» (FASE 2, decisione §9) ────────── */

export interface ExportValido {
  dominio: DominioId;
  generato: string;
  data: unknown;
}

/**
 * Valida il JSON di un export da importare. Regola di sicurezza: si
 * accettano SOLO gli export `per: "gemello"` — un export completo locale
 * contiene segreti (chiave API) e testi di sito: non è un artefatto di
 * scambio, e non deve poter sovrascrivere l'altro sito nemmeno per errore.
 */
export function validaExport(raw: string): { ok: true; valore: ExportValido } | { ok: false; errore: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errore: "il file non è JSON valido" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, errore: "struttura inattesa (atteso un oggetto export)" };
  const e = parsed as Record<string, unknown>;
  if (e.strumento !== "aggiornamenti-per-dominio") return { ok: false, errore: "non è un export dello strumento aggiornamenti per dominio" };
  if (e.per !== "gemello") return { ok: false, errore: 'accetto solo un export «per gemello»: gli export completi contengono segreti e testi di sito' };
  if (!isDominioAttivo(String(e.dominio ?? ""))) return { ok: false, errore: `dominio non attivo o sconosciuto: ${String(e.dominio ?? "—")}` };
  if (!e.data || typeof e.data !== "object") return { ok: false, errore: "payload del dominio mancante" };
  return { ok: true, valore: { dominio: e.dominio as DominioId, generato: typeof e.generato === "string" ? e.generato : "", data: e.data } };
}

/** Sintesi compatta di un valore per la tabella del diff (mai PII/segreti: non li contiene un export gemello). */
export function sintesiValore(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  const s = typeof v === "string" ? v : jsonCanonico(v);
  const unRiga = s.replace(/\s+/g, " ").trim();
  return unRiga.length > 60 ? `${unRiga.slice(0, 57)}…` : unRiga;
}

export interface RigaDiff {
  chiave: string;
  stato: "uguale" | "cambiata" | "nuova";
  prima: string;
  dopo: string;
}

/**
 * Diff leggibile attuale → in arrivo, per chiave di primo livello e (per gli
 * oggetti) di secondo: il confirm dell'import guarda QUI, non al JSON grezzo.
 * Gli array (es. ai_faqs) si confrontano come blocco: cambiati se il canonico
 * differisce (l'etichetta porta il numero di elementi).
 */
export function diffDominio(attuale: unknown, inArrivo: unknown): RigaDiff[] {
  const a = (attuale ?? {}) as Record<string, unknown>;
  const b = (inArrivo ?? {}) as Record<string, unknown>;
  const righe: RigaDiff[] = [];
  const chiavi = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of chiavi) {
    const av = a[k];
    const bv = b[k];
    const uguali = jsonCanonico(av ?? null) === jsonCanonico(bv ?? null);
    if (uguali) {
      righe.push({ chiave: k, stato: "uguale", prima: sintesiValore(av), dopo: sintesiValore(bv) });
      continue;
    }
    // Oggetti (non array): diff a secondo livello per essere leggibili.
    if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av) && !Array.isArray(bv)) {
      const oa = av as Record<string, unknown>;
      const ob = bv as Record<string, unknown>;
      const inner = [...new Set([...Object.keys(oa), ...Object.keys(ob)])].sort();
      for (const ik of inner) {
        const iv1 = oa[ik];
        const iv2 = ob[ik];
        const iUguale = jsonCanonico(iv1 ?? null) === jsonCanonico(iv2 ?? null);
        righe.push({
          chiave: `${k}.${ik}`,
          stato: iUguale ? "uguale" : iv1 === undefined ? "nuova" : "cambiata",
          prima: sintesiValore(iv1),
          dopo: sintesiValore(iv2),
        });
      }
    } else {
      const etichetta = Array.isArray(bv) ? `${bv.length} elementi` : sintesiValore(bv);
      righe.push({ chiave: k, stato: av === undefined ? "nuova" : "cambiata", prima: sintesiValore(av), dopo: etichetta });
    }
  }
  return righe;
}

/**
 * Merge dell'import NELLO stato locale: la struttura in arrivo si sovrappone
 * a ciò che c'è, MAI il contrario — i testi dell'hero assenti dall'export
 * gemello restano la voce di QUESTO sito, i campi mai esportati (chiave API,
 * token) restano quelli correnti. Gli array interi sostituiscono (FAQ: la
 * lista è l'artefatto condiviso; il diff mostra il blocco prima del si).
 */
export function mergiaImport(dominio: DominioId, attuale: unknown, inArrivo: unknown): Record<string, unknown> {
  const a = (attuale ?? {}) as Record<string, unknown>;
  const b = (inArrivo ?? {}) as Record<string, unknown>;
  const merge = (k: string) => ({ ...(a[k] as Record<string, unknown>), ...(b[k] as Record<string, unknown>) });
  switch (dominio) {
    case "temi":
      return { site_theme: merge("site_theme") };
    case "hero":
      return { site_hero: merge("site_hero") };
    case "ambrosio":
      return {
        ai_settings: merge("ai_settings"),
        ...(Array.isArray(b.ai_faqs) ? { ai_faqs: b.ai_faqs } : {}),
      };
    case "tools":
      return { calendar_hub: merge("calendar_hub") };
    case "settings":
      return { ...a, ...b };
    default:
      return { ...a, ...b };
  }
}
