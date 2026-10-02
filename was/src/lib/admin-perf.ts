/**
 * TELEMETRIA LETTA (server-only, funzioni pure): aggrega gli eventi
 * `admin.render` dell'audit (una riga per navigazione admin, detail = "123ms",
 * vedi admin-telemetry.ts) in una vista per pagina: mediana, coda (p95), caso
 * peggiore e — quando esiste storia sufficiente — il confronto PRIMA/DOPO
 * l'ADR-005 esteso (le ottimizzazioni della 0.7.1/0.7.2: reader singolo,
 * cache per richiesta, TTL 60 s, indice 044).
 *
 * Tutto qui è PURO: la pagina /admin/tools/perf è presentazione, i test unit
 * importano direttamente il .ts (stesso schema di desk-autopilota-shared).
 * Niente cache, niente TTL: la pagina è force-dynamic e la lettura parte
 * dall'indice della migration 044 — una navigazione amministrativa in più
 * ogni tanto è il prezzo dichiarato di guardare i numeri veri.
 */

/** Data di rilascio 0.7.1/0.7.2 (ADR-005 esteso): PRIMA vs DOPO per pagina. */
export const PERF_RELEASE_CUT_ISO = "2026-10-01T17:00:00Z";

/** Soglie del piano (PIANO-PRESTAZIONI): verde sotto 1 s, ambra sotto 2,5 s.
 *  Il verde è il cursore della scheda (perf_target_ms): queste sono i
 *  valori di DEFAULT, e l'ambra deriva: 2,5× il target (col default
 *  1 s → esattamente 2,5 s, la firma del piano). */
export const PERF_TARGET_CALDO_MS = 1_000;
export const PERF_AMBRA_MS = 2_500;

/** Minimo di campioni per fidarsi di una mediana: sotto, la scheda lo dice. */
export const PERF_MIN_CAMPIONI = 3;

export type AdminRenderRow = {
  target: string;
  detail: string;
  created_at: string;
};

export type PaginaPerf = {
  path: string;
  /** Ordine di presentazione (l'ultima navigazione per prima). */
  ultimo: string;
  /** PRIMA del taglio: null se la pagina non ha campioni in quel periodo. */
  prima: Periodo | null;
  /** DOPO il taglio (il «caldo» recente). */
  dopo: Periodo | null;
};

export type Periodo = {
  n: number;
  /** Mediana (p50): il caricamento tipico. */
  p50: number;
  /** Coda: 1 navigazione su 20 paga almeno questo. */
  p95: number;
  worst: number;
};

/** "1234ms" → 1234. Robusto a spazi e assenze: un detail non parsabile è
 *  un campione perso, non un'eccezione (l'audit è la fonte, non il formato). */
export function parseMs(detail: string): number | null {
  const m = /^(\d+)\s*ms$/.exec(detail.trim());
  return m ? Number(m[1]) : null;
}

/** Percentile con interpolazione lineare su lista ORDINATA (contratto interno). */
export function percentileOrdinato(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function periodo(sortedMs: readonly number[]): Periodo {
  const n = sortedMs.length;
  return {
    n,
    p50: Math.round(percentileOrdinato(sortedMs, 0.5)),
    p95: Math.round(percentileOrdinato(sortedMs, 0.95)),
    worst: n ? sortedMs[n - 1]! : 0,
  };
}

/**
 * Aggrega le righe audit (già filtrate su action = 'admin.render') per pagina.
 * Righe non parsabili scartate in silenzio; le pagine restano in ordine di
 * ultima comparsa (decrescente) — la pagina appena navigata si legge in cima.
 */
export function aggregaPerPagina(rows: readonly AdminRenderRow[], cutIso: string): PaginaPerf[] {
  const cut = Date.parse(cutIso);
  const perPath = new Map<string, { prima: number[]; dopo: number[]; ultimo: string }>();
  for (const row of rows) {
    const ms = parseMs(row.detail);
    if (ms === null) continue;
    const path = row.target || "/";
    let entry = perPath.get(path);
    if (!entry) {
      entry = { prima: [], dopo: [], ultimo: row.created_at };
      perPath.set(path, entry);
    }
    const quando = Date.parse(row.created_at);
    if (Number.isFinite(quando) && quando >= cut) entry.dopo.push(ms);
    else entry.prima.push(ms);
    // ISO 8601: il confronto lessicografico è l'ordine temporale.
    if (row.created_at > entry.ultimo) entry.ultimo = row.created_at;
  }
  return [...perPath.entries()]
    .map(([path, entry]) => {
      const ordina = (a: number[]) => [...a].sort((x, y) => x - y);
      return {
        path,
        ultimo: entry.ultimo,
        prima: entry.prima.length ? periodo(ordina(entry.prima)) : null,
        dopo: entry.dopo.length ? periodo(ordina(entry.dopo)) : null,
      };
    })
    .sort((a, b) => (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : a.path.localeCompare(b.path)));
}

/** Lettura DB: gli eventi admin.render (lettura viva, indice della 044).
 *  Degredisce a [] senza DB o audit non migrato: la scheda mostra il vuoto,
 *  mai un 500 (stesso contratto degli altri strumenti di sistema). */
export async function leggiAdminRender(pool: {
  query: (sql: string) => Promise<{ rows: AdminRenderRow[] }>;
}): Promise<AdminRenderRow[]> {
  try {
    const { rows } = await pool.query(
      `select target, detail, created_at from audit_log
       where action = 'admin.render'
       order by created_at desc
       limit 2000`,
    );
    return rows;
  } catch {
    return [];
  }
}

/** Colore della pill: la firma del piano. Il target (verde) è un
 *  parametro — il cursore della scheda, default il target del piano
 *  (1 s a caldo); l'ambra segue il target (2,5×), così le tre bande
 *  restano coerenti a qualsiasi posizione del cursore. */
export function sogliaTone(
  ms: number,
  targetMs: number = PERF_TARGET_CALDO_MS,
): "ok" | "warn" | "late" {
  if (ms <= targetMs) return "ok";
  if (ms < targetMs * (PERF_AMBRA_MS / PERF_TARGET_CALDO_MS)) return "warn";
  return "late";
}

/** "870ms" / "1,2s": sopra il secondo si legge in secondi (i numeri grandi
 *  spaventano più di quanto informativi). */
export function formattaMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace(".", ",")}s`;
}

/** Δ percentuale DOPO vs PRIMA: negativo = miglioramento. null senza base. */
export function deltaPercent(prima: Periodo | null, dopo: Periodo | null): number | null {
  if (!prima || !dopo || prima.p50 === 0) return null;
  return Math.round(((dopo.p50 - prima.p50) / prima.p50) * 100);
}

/* ── Risoluzione del pathname per la telemetria ─────────────────── */

export type HeaderGetter = { get(name: string): string | null };

/**
 * Il path della richiesta per la riga admin.render. La versione corrente di
 * Next NON espone il pathname al layout (x-invoke-path e next-url sono stati
 * rimossi: verificato con probe su build reale — tutti null). Restano due
 * fonti oneste: l'header dell'edge proxy davanti all'app (x-forwarded-uri:
 * presente dove la piattaforma lo inoltra, es. produzione) e, in mancanza,
 * il bucket generico /admin — che resta UN dato vero (il tempo è reale),
 * solo meno granulare. MAI inventare il path dal referer: è da DOVE arriva
 * il visitatore, non dove va.
 */
export function risolviPath(h: HeaderGetter): string {
  const diretto = h.get("x-invoke-path") ?? h.get("next-url") ?? h.get("x-forwarded-uri");
  if (diretto && diretto.startsWith("/")) return diretto.split("?")[0] ?? diretto;
  return "/admin";
}
