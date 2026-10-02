import pg from "pg";

/**
 * Pool Postgres (Neon). La connection string sta in DATABASE_URL (server-only:
 * mai NEXT_PUBLIC_*). Se non è configurata, il sito continua a funzionare
 * degradato: chat e notifiche sì, persistenza no.
 *
 * uselibpqcompat=true: come da avviso di pg, evita il warning di deprecazione
 * sui modi SSL mantenendo lo stesso livello di sicurezza attuale
 * (TLS senza verifica stretta del certificato, come richiesto da Neon).
 */

const rawConnectionString = process.env.DATABASE_URL;

// Aggiunge il flag senza toccare .env.local
const connectionString = rawConnectionString
  ? rawConnectionString + (rawConnectionString.includes("?") ? "&" : "?") + "uselibpqcompat=true"
  : undefined;

declare global {
  var __pgPool: pg.Pool | null;
}

export function db(): pg.Pool | null {
  if (!connectionString) return null;
  if (!global.__pgPool) {
    global.__pgPool = new pg.Pool({
      connectionString,
      ssl: rawConnectionString?.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global.__pgPool;
}

export function dbConfigured(): boolean {
  return Boolean(rawConnectionString);
}
