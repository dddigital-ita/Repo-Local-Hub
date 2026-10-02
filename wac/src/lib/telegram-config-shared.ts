/**
 * CONFIG TELEGRAM — cuore PURO (validatori e formattatori condivisi da
 * server e pannello client): nessun import, le stesse regole girano nei
 * test di node e nella UI. Il layer DB/invio sta in telegram-config.ts.
 */

/** Formato token dei bot Telegram: <numeric_id>:<alphanumeric_35>. */
export function isValidBotToken(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(token.trim());
}

/**
 * Chat/team id: numerici (possono essere negativi per gruppi/supergruppi,
 * -100… per canali) oppure @username pubblico. La lista è CSV.
 */
export function isValidChatId(id: string): boolean {
  const t = id.trim();
  return /^-?\d{5,25}$/.test(t) || /^@[A-Za-z0-9_]{4,64}$/.test(t);
}

/** Da CSV a lista pulita (trim, dedup, scarti vuoti): un solo punto. */
export function parseChatIds(csv: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of csv.split(",")) {
    const id = raw.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Lista → CSV normalizzato (per il salvataggio). */
export function chatIdsToCsv(ids: string[]): string {
  return parseChatIds(ids.join(",")).join(",");
}

/** Il messaggio di prova che la scheda invia alla prima chat del team. */
export const TELEGRAM_TEST_MESSAGE = [
  "✅ Test dalla scheda admin — il canale Telegram dell'agenzia funziona.",
  "Da qui arrivano: notifiche, campanelli SLA/handoff e il digest serale di Ambrosio.",
].join("\n");
