/**
 * CRONOMETRO DI LATENZA — regole PURE (zero import), il taglio del repo per i
 * layer testabili (come settings-status.ts e ambrosio-autonomy.ts).
 *
 * Media e p95 delle risposte di Ambrosio e la soglia d'allarme: la matematica
 * vive qui, le letture DB in ai.ts, la UI dell'Inventario AI solo la stampa —
 * il test importa direttamente questo file (type stripping, nessuna build).
 */

/**
 * Soglia d'allarme per la latenza delle risposte (ms): oltre, l'Inventario AI
 * avvisa. UNA sola definizione: la pagina e la lettura la importano da qui
 * (il test verifica che non esista una copia inline che può divergere).
 */
export const LATENCY_ALERT_MS = 5_000;

export interface LatencyStats {
  /** Risposte considerate dal cronometro. */
  count: number;
  /** Media (ms), null senza dati. */
  avgMs: number | null;
  /** p95 (ms): il 95% delle risposte arriva entro questo tempo. Null senza dati. */
  p95Ms: number | null;
}

export const EMPTY_LATENCY: LatencyStats = { count: 0, avgMs: null, p95Ms: null };

/**
 * Media e p95 di un campione di latenze (ms) già letto dal DB. Robusto:
 * non numerici e negativi sono scartati, l'ordine d'arrivo è irrilevante.
 *
 * Il p95 usa interpolazione lineare (convenzione dei monitor APM): il valore
 * non deve esistere nel campione, conta la posizione. Con un outlier (una
 * risposta lenta) la media resta com'è, il p95 lo rende visibile: è il
 * difetto che il cronometro deve mostrare, non nascondere.
 */
export function latencyStats(raw: readonly unknown[]): LatencyStats {
  const xs = raw
    .map((v) => {
      if (typeof v === "number") return v;
      // null/undefined/"" NON sono 0 ms (Number(null) === 0: un buco nei dati
      // non deve diventare una risposta istantanea): li marchia non validi.
      if (v == null || v === "") return NaN;
      return Number(v);
    })
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.round(n))
    .sort((a, b) => a - b);
  if (xs.length === 0) return EMPTY_LATENCY;

  const avg = xs.reduce((s, n) => s + n, 0) / xs.length;
  const pos = (xs.length - 1) * 0.95;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const p95 = xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  return { count: xs.length, avgMs: Math.round(avg), p95Ms: Math.round(p95) };
}

/**
 * Verdetto del cronometro: verde entro soglia, avviso se il p95 la supera
 * (qualche risposta lenta), allarme se la media la supera (lentezza diffusa).
 */
export function latencyVerdict(s: LatencyStats): "ok" | "warn" | "alert" {
  if (s.count === 0 || s.avgMs == null || s.p95Ms == null) return "ok";
  if (s.avgMs > LATENCY_ALERT_MS) return "alert";
  if (s.p95Ms > LATENCY_ALERT_MS) return "warn";
  return "ok";
}
