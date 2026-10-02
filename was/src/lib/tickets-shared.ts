/**
 * Regole PURE dei ticket (zero import, il taglio del repo per i layer
 * testabili — come latency-shared.ts e settings-status.ts): ciò che non
 * tocca il DB e serve a più viste vive qui, e il test lo importa
 * direttamente (type stripping, nessuna build).
 */

/**
 * Età relativa compatta per la scansione della coda («2h», «3gg», «2sett»):
 * la data assoluta resta sulla riga (accanto, con title) — la forma breve
 * dice QUANTO è vecchio, quella lunga dice QUANDO è successo (Fase 2 del
 * assessment docs/tickets-redesign-assessment.md). La soglia è la stessa
 * per inbox e scheda cliente: un solo posto, mai una copia inline.
 */
export function relativeAge(from: string | Date, now: Date = new Date()): string {
  const then = typeof from === "string" ? new Date(from) : from;
  const mins = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}gg`;
  const weeks = Math.floor(days / 7);
  return `${weeks}sett`;
}

/**
 * Link WhatsApp contestuale al ticket: wa.me col numero del lead e il
 * testo precompilato che CITA il ticket — il cliente non deve spiegare
 * chi è (il contesto esiste dal primo «ciao»). Regola pura condivisa da
 * scheda cliente (pill) e inbox (icona, variante C del assessment):
 * un solo posto, mai due costruttori che divergono.
 */
export function waTicketHref(waDigits: string, ticketNumber: number): string {
  const text = encodeURIComponent(
    `Buongiorno, la scrivo per il ticket #${ticketNumber} della Web Agency Salento.`,
  );
  return `https://wa.me/${waDigits}?text=${text}`;
}

/**
 * Pattern LIKE «contiene» per la ricerca: i wildcard dell'utente (% e _)
 * e l'escape di ILIKE (\) vengono LETTERALIZZATI, così «100%» trova «100%»
 * e non «100» seguito da qualunque cosa. Regola pura condivisa da inbox e
 * portafoglio (un solo costruttore di pattern, mai due che divergono):
 * senza escape la ricerca reinterpretava l'input in silenzio — la stessa
 * famiglia del fallback del canale a zero. L'escape di default di Postgres
 * è il backslash: nessuna clausola ESCAPE da aggiungere.
 */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * I canali con tab PERMANENTE nella inbox: esistono anche a 0 conversazioni
 * («nessun WhatsApp» è uno stato, non un canale inesistente). Regola pura
 * condivisa da tre consumatori che devono restare coerenti — la validazione
 * del ?channel, le tab e il conteggio per canale: una sola lista, mai tre
 * copie che divergono. Un canale nuovo della migration resta data-driven:
 * compare da solo via GROUP BY, senza toccare questa lista.
 */
export const KNOWN_CHANNELS = ["web", "email", "whatsapp"] as const;

/**
 * Fonde le righe (channel, n) del GROUP BY nella mappa dei conteggi: i
 * canali permanenti partono da 0 e restano presenti anche senza righe; un
 * channel NULL (righe storiche senza canale) conta come «web»; i canali
 * non noti passano intatti. Regola pura, testata direttamente in
 * tests/tickets-channels.test.mjs — la variante con DB vivo è nell'E2E.
 */
export function mergeChannelCounts(
  rows: { channel: string | null; n: number }[],
  known: readonly string[] = KNOWN_CHANNELS,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of known) out[c] = 0;
  for (const r of rows) {
    const ch = r.channel ?? "web";
    out[ch] = (out[ch] ?? 0) + r.n;
  }
  return out;
}
