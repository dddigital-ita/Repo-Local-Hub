/**
 * Rate limiter in-memory (sliding window) per le API pubbliche.
 * Per 1 IP con poche decine di visite al giorno è più che sufficiente;
 * su serverless ogni istanza ha la sua mappa: è una protezione, non un muro.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

/** Pulizia periodica delle entry vecchie (ogni 5 minuti). */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < 60 * 60 * 1000);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Controlla e registra un hit. Esempio: limit("chat", ip, 20, 60_000)
 * = max 20 richieste al minuto per la funzione "chat".
 */
export function limit(name: string, identifier: string, max: number, windowMs: number): RateLimitResult {
  sweep();
  const key = `${name}:${identifier}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= max) {
    const oldest = bucket.hits[0] ?? now;
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: max - bucket.hits.length, retryAfterSec: 0 };
}

/** IP del client tenendo conto di proxy/CDN (Vercel mette x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
