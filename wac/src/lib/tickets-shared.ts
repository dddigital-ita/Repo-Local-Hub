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
    `Buongiorno, la scrivo per il ticket #${ticketNumber} della Web Agency Crema.`,
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

/* ═══════════════════════════════════════════════════════════════
   TICKET UPGRADE (migration 046): tag, escalation, merge.
   Regole PURE — zero import, testate direttamente in
   tests/ticketing-upgrade.test.mjs (guard di sito: la feature è
   di Crema, il gemello non ha queste regole).
   ═══════════════════════════════════════════════════════════════ */

/** Max tag applicabili a un ticket (la card non è un muro di chip). */
export const TICKET_TAGS_MAX = 12;

/** Max caratteri per tag: abbastanza per «preventivo-immediato»,
 *  non abbastanza per frasi intere (i tag sono etichette, non campi liberi). */
export const TICKET_TAG_MAX_LEN = 30;

/** Max voci del vocabolario canonico (impostazioni → tag): i tag
 *  suggeriti devono restare scansionabili in una datalist. */
export const TICKET_TAG_VOCAB_MAX = 30;

/**
 * Normalizza una lista di tag grezzi (input da form: campo testo,
 * textarea, CSV): trim, minuscolo, spazi interni → trattino
 * (kebab-case: il tag è una chiave, non una frase), dedup
 * preservando l'ordine, tag vuoti o troppo lunghi scartati, max
 * `max` risultati. Regola pura: la stessa normalizzazione vale
 * per i tag del ticket e per il vocabolario (con max diverso),
 * così un tag salvato nel vocabolario combacia SEMPRE con quello
 * applicato al ticket — due normalizzatori che divergono avrebbero
 * prodotto «preventivo immediato» vs «preventivo-immediato»,
 * rompendo il filtro ?tag=.
 */
export function sanitizeTags(
  input: Iterable<string>,
  max: number = TICKET_TAGS_MAX,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (!tag || tag.length > TICKET_TAG_MAX_LEN) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Livello di escalation massimo (migration 046: check 0..3). */
export const ESCALATION_MAX = 3;

/**
 * Tonalità del livello di escalation: il viola dice «passaggio
 * di mano a competenze superiori», non urgenza (il rosso resta
 * alla priorità urgente — due segnali diversi non condividono
 * il colore, altrimenti l'escalation sembra un'allarme e
 * l'urgenza un cambio di reparto). Qui (non in tickets.ts)
 * perché la usa il pannello escalation, componente CLIENT:
 * tickets.ts importa il DB e non può entrare nel bundle.
 */
export const ESCALATION_TONE: Record<number, string> = {
  0: "bg-slate-100/70 text-slate-500 ring-1 ring-slate-200/60",
  1: "bg-violet-50/90 text-violet-700 ring-1 ring-violet-200/70",
  2: "bg-fuchsia-50/90 text-fuchsia-700 ring-1 ring-fuchsia-200/70",
  3: "bg-red-50/90 text-red-700 ring-1 ring-red-200/70",
};

/** Chip dei tag: neutra, la categorizzazione non urla (il
 *  colore è riservato a priorità, SLA ed escalation). Come
 *  ESCALATION_TONE: serve al tag editor, componente client. */
export const TAG_TONE = "bg-white/70 text-slate-600 ring-1 ring-white/70";

/**
 * Prossimo livello di escalation: 0 (base, «Livello 1») sale a
 * 1…3; al massimo restituisce null (il pulsante scompare: non
 * esiste un «oltre»). Livelli negativi o non interi trattati come
 * 0: la regola non lancia mai, l'azione server la usa su dati DB
 * che il check già tiene in 0..3. Regola pura testata in
 * tests/ticketing-upgrade.test.mjs.
 */
export function nextEscalationLevel(current: number): number | null {
  const lvl = Math.floor(Number.isFinite(current) ? current : 0);
  const safe = Math.max(0, Math.min(ESCALATION_MAX, lvl));
  return safe >= ESCALATION_MAX ? null : safe + 1;
}

/**
 * Etichetta del livello di escalation: 0 è il livello base (il
 * ticket «normale», non un fallimento), 1..3 sono i livelli di
 * supporto superiore. Una sola mappa — dashboard, card e dettaglio
 * dicono la stessa cosa con le stesse parole.
 */
export function escalationLabel(level: number): string {
  const lvl = Math.floor(Number.isFinite(level) ? level : 0);
  return lvl <= 0 ? "Livello 1" : `Livello ${Math.min(ESCALATION_MAX, lvl) + 1}`;
}

/**
 * Guardia del merge: può fondersi solo un ticket VIVO (non già
 * fuso) in un altro ticket VIVO, diverso da sé. Regola pura — la
 * action server la usa PRIMA di scrivere, il test la verifica
 * direttamente. «Chiuso» non è un ostacolo: fondere un duplicato
 * in un ticket già risolto è il caso d'uso tipico (il duplice
 * aperto per errore si chiude nel merge). Chi decide se il problema
 * è davvero «lo stesso identico» è l'agente: la UI mostra numero
 * e query di entrambi prima di confermare.
 */
export function canMerge(g: {
  /** sorgente === destinazione (stesso id). */
  self: boolean;
  /** il ticket sorgente è già fuso (merged_into non nullo). */
  alreadyMerged: boolean;
  /** la destinazione è già un ticket fuso (non può assorbire). */
  destinationMerged: boolean;
}): boolean {
  return !g.self && !g.alreadyMerged && !g.destinationMerged;
}
