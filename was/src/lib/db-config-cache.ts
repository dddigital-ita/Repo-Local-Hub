/**
 * TTL in-process per le letture DB di CONFIGURAZIONE (server-only).
 *
 * Le schede degli hub admin (tema, hero, SLA, token Telegram, Turnstile,
 * credenziali Notion/Google/Drive/Calendar…) cambiano SOLO quando un admin
 * salva: tra un salvataggio e l'altro rileggere tutto a ogni navigazione
 * significa pagare decine di round-trip su Neon per dati identici. Qui la
 * validità: un reader che consulta `dbConfigFresh(key)` riusa il valore
 * memorizzato fino a scadenza, e rilegge dal DB una volta scaduta.
 *
 * Perché NON invalidazione push a ogni scrittura: le config vivono in punti
 * diversi (content_settings, tabelle proprie, cifrature locali) e la coppia
 * scrittore→lettore è distribuita su oltre dieci moduli — il registro centrale
 * richiederebbe di toccare ogni azione di salvataggio, con il rischio reale di
 * dimenticarne una e servire configurazione stantia per sempre. Un TTL CORTO
 * (60s) rende il limite temporale un CONTRATTO dichiarato: la pill di un hub
 * può invecchiare al massimo un minuto, quindi nessuna azione admin resta
 * mai cieca più a lungo. (Le chiavi con bump già esistente — SLA, emoji,
 * risposte rapide — restano nella snapshot per-request di tickets.ts, qui
 * non entrano.)
 *
 * Perché in-process e non Redis: la function Vercel è un processo unico,
 * il file vive con essa. Nessuna dipendenza nuova, nessun keepalive verso
 * Neon (AGENTS.md): il cron di scadenza non esiste — la pulizia avviene
 * al passaggio, come React ripulisce il suo cache.
 *
 * Robustezza al primo colpo dopo il risveglio Neon: il valore è `undefined`
 * finché la prima lettura non va a buon fine — niente cache negativa, la
 * pagina conserva la sua degradazione nativa (reader → default sicuro).
 */

export const DB_CONFIG_TTL_MS = 60_000;

type Entry = { value: unknown; at: number };

const store = new Map<string, Entry>();

/** true se esiste un valore ancora valido per la chiave (e lo ritocca via se scaduto). */
export function dbConfigFresh(key: string): boolean {
  const hit = store.get(key);
  if (!hit) return false;
  if (Date.now() - hit.at >= DB_CONFIG_TTL_MS) {
    store.delete(key);
    return false;
  }
  return true;
}

/** Il valore memorizzato (undefined se assente o scaduto: il chiamante rilegge). */
export function dbConfigGet<T>(key: string): T | undefined {
  if (!dbConfigFresh(key)) return undefined;
  return store.get(key)!.value as T;
}

/** Memorizza il valore appena letto dal DB. */
export function dbConfigSet(key: string, value: unknown): void {
  if (value === undefined) return;
  if (store.size > 100) {
    // Non è un cron: al passaggio si tolgono le voci scadute (volume tipico
    // = le poche chiavi di config della richiesta corrente).
    const now = Date.now();
    for (const [k, e] of store) {
      if (now - e.at >= DB_CONFIG_TTL_MS) store.delete(k);
    }
  }
  store.set(key, { value, at: Date.now() });
}

/** Visibile solo ai test: il numero di voci vive. */
export function dbConfigSize(): number {
  return store.size;
}

/* ── Read-through con single-flight ─────────────────────────────── */

const inflight = new Map<string, Promise<unknown>>();

/**
 * Legge dal DB SOLO se la chiave non ha un valore valido in TTL: altrimenti
 * ritorna il valore memorizzato. La prima lettura concurrent sulla STESSA
 * chiave condivide la Promise (single-flight): dentro una richiesta in cui
 * due layer chiedono la stessa config non si pagano due round-trip. Un
 * fallimento NON viene memorizzato (nessuna cache negativa): l'errore torna
 * al chiamante, che degenerisce come sempre — e il colpo dopo ritenta.
 */
export async function readThroughDbConfig<T>(key: string, read: () => Promise<T>): Promise<T> {
  const cached = dbConfigGet<T>(key);
  if (cached !== undefined) return cached;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = (async () => {
    const value = await read();
    dbConfigSet(key, value);
    return value;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
