/**
 * GOOGLE CALENDAR — regole PURE (zero import), il taglio del repo per i
 * layer testabili (come ambrosio-autonomy.ts e settings-status.ts).
 *
 * Titolo, descrizione e finestra temporale dell'evento: qui la matematica
 * e le etichette, in google-calendar.ts le letture DB e le chiamate API.
 * Il test importa direttamente questo file (type stripping, nessuna build).
 */

export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Durata di default di un appuntamento sul calendario (minuti). */
export const GCAL_EVENT_DURATION_MIN = 30;

const TITLE_MAX = 120;
const DESC_MAX = 4000;

/** Chi firma l'impegno sul calendario: il bot si dichiara SEMPRE. */
export function gcalEventTitle(name: string | null, operator: string | null, isAi: boolean): string {
  const who = isAi ? "Ambrosio AI" : operator ?? "Team";
  const label = name ? `Appuntamento con ${name}` : "Appuntamento con cliente";
  return `${label} — ${who}`.slice(0, TITLE_MAX);
}

/** Descrizione evento: contesto utile al team, niente segreti, niente PII in più. */
export function gcalEventDescription(d: {
  phone: string | null;
  service: string | null;
  slot: string | null;
  conversationId: string | null;
  /** Portafoglio clienti: se il contatto è già noto (nome + ticket totali). */
  clientName?: string | null;
  clientTickets?: number | null;
}): string {
  const lines = [
    d.phone ? `Telefono: ${d.phone}` : null,
    d.service ? `Servizio: ${d.service}` : null,
    d.slot ? `Slot richiesto: ${d.slot}` : null,
    d.conversationId ? `Conversazione: ${d.conversationId}` : null,
    d.clientName ? `Cliente noto: ${d.clientName} (ticket: ${d.clientTickets ?? 0})` : null,
    "Appuntamento registrato dal gestionale dell'agenzia.",
  ].filter(Boolean) as string[];
  return lines.join("\n").slice(0, DESC_MAX);
}

/** Finestra evento: inizio + durata default (30 min). */
export function gcalEventWindow(start: Date): { start: Date; end: Date } {
  return { start, end: new Date(start.getTime() + GCAL_EVENT_DURATION_MIN * 60_000) };
}
