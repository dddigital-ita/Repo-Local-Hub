/**
 * OUTBOUND multi-canale — PARTE PURA (Fase 5, step 5.1,
 * PIANO-FASE-5-DESK).
 *
 * Zero import, type stripping: la convenzione del repo
 * per i layer puri, testata direttamente dalle sentinelle
 * unit (tests/channel-outbound.test.mjs). La parte con
 * dipendenze (DB channel_accounts, Bot API Telegram,
 * mirror nel thread) vive in channel-outbound.ts e la
 * importa — le query su DB vivo sono coperte dall'E2E.
 *
 * WhatsApp business-initiated: fuori dalla finestra di
 * 24 ore Meta accetta solo template approvati. Qui NON
 * blocchiamo l'invio — la policy è del chiamante (il
 * form avvisa l'operatore): se Meta rifiuta, l'errore
 * dell'API (#131047 ecc.) torna a chi ha premuto invio,
 * non viene inghiottito.
 *
 * GUARD DI SITO (Crema): perimetro Crema fino allo step
 * 5.4 (twin-sync dei moduli puri verso il gemello).
 */

/** Canali con outbound social (Graph API) o Bot API. web/email hanno già la loro porta. */
export const OUTBOUND_CHANNELS = [
  "whatsapp",
  "telegram",
  "facebook",
  "instagram",
  "messenger",
] as const;
export type OutboundChannelKey = (typeof OUTBOUND_CHANNELS)[number];

export function isOutboundChannel(v: unknown): v is OutboundChannelKey {
  return typeof v === "string" && (OUTBOUND_CHANNELS as readonly string[]).includes(v);
}

/** Base URL Graph API (versione pinned: 20.0, come l'adapter WhatsApp in messaging.ts). */
export const GRAPH_API = "https://graph.facebook.com/v20.0";

/** Limite reale Meta per messaggi testo (margine sotto i 2000 documentati). */
export const META_TEXT_MAX = 2000;

/** Account canale risolto: la riga channel_accounts col token decifrato. */
export interface OutboundAccount {
  id: string;
  channel: OutboundChannelKey;
  /** WhatsApp: phone_number_id del numero Business. Meta: id pagina/IG. */
  externalId: string;
  token: string;
}

export interface OutboundResult {
  ok: boolean;
  /** Id del messaggio lato provider (wamid WhatsApp, mid Graph). Telegram: null (la Bot API non lo restituisce a sendMessage). */
  providerRef: string | null;
  error: string | null;
}

/* ── Payload Graph (passi puri: testabili senza rete) ─────── */

/**
 * Costruisce il CORPO della richiesta Graph API per il canale
 * (l'URL — GRAPH_API/{externalId}/messages — lo costruisce
 * il chiamante, che ha l'account). Ritorna null per
 * Telegram (non è Graph) o `to` WhatsApp non normalizzabile.
 * `to` WhatsApp è normalizzato in cifre (l'API vuole il
 * numero senza «+»); `to` Meta è l'id del destinatario
 * (PSID/IG user).
 */
export function buildGraphPayload(
  channel: OutboundChannelKey,
  to: string,
  text: string,
): Record<string, unknown> | null {
  if (channel === "whatsapp") {
    const phoneDigits = to.replace(/[^\d]/g, "");
    if (!phoneDigits) return null;
    return {
      messaging_product: "whatsapp",
      to: phoneDigits,
      type: "text",
      text: { body: text },
    };
  }
  if (channel === "facebook" || channel === "instagram" || channel === "messenger") {
    return {
      recipient: { id: to },
      message: { text },
    };
  }
  return null; // telegram: Bot API, non Graph
}

/**
 * Estrae il provider_ref dalla risposta Graph: WhatsApp risponde
 * `{ messages: [{ id }] }`, Meta `{ message_id }`. Niente id →
 * null (il messaggio è partito, l'idempotenza si perde: accettabile,
 * meglio un duplicato potenziale che un errore falso).
 */
export function parseGraphResponse(
  channel: OutboundChannelKey,
  json: unknown,
): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  if (channel === "whatsapp") {
    const messages = obj.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0] as Record<string, unknown> | undefined;
      const id = first?.id;
      return typeof id === "string" && id ? id : null;
    }
    return null;
  }
  const messageId = obj.message_id;
  return typeof messageId === "string" && messageId ? messageId : null;
}

/** Dettaglio errore Graph (error_user_msg è il testo pensato per l'operatore). */
export function graphErrorDetail(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const err = (json as { error?: { message?: string; error_user_msg?: string } }).error;
  const detail = err?.error_user_msg ?? err?.message ?? "";
  return typeof detail === "string" ? detail.slice(0, 200) : "";
}

/* ── Dispatch Graph (fetch iniettabile: nessuna rete nei test) ── */

export interface GraphDispatchOptions {
  /** fetch iniettabile: i test passano un mock (nessuna rete). */
  fetchImpl?: typeof fetch;
}

/**
 * Invia a un account già risolto via Graph API (WhatsApp/Meta)
 * e ritorna il provider_ref. Il testo è già adattato al canale
 * dal chiamante (formatForChannel). Il mirror nel thread
 * (idempotente su provider_ref) è a carico del chiamante
 * con DB — channel-outbound.ts.
 */
export async function dispatchGraphOutbound(
  account: OutboundAccount,
  channel: OutboundChannelKey,
  to: string,
  text: string,
  opts: GraphDispatchOptions = {},
): Promise<OutboundResult> {
  if (channel === "telegram") {
    return { ok: false, providerRef: null, error: "telegram_non_e_graph" };
  }
  const payload = buildGraphPayload(channel, to, text);
  if (!payload) {
    return { ok: false, providerRef: null, error: `${channel}_destinazione_non_valida` };
  }
  const fetchFn = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(`${GRAPH_API}/${account.externalId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const detail = graphErrorDetail(json);
      return {
        ok: false,
        providerRef: null,
        error: `graph_${res.status}${detail ? `: ${detail}` : ""}`,
      };
    }
    return { ok: true, providerRef: parseGraphResponse(channel, json), error: null };
  } catch (e) {
    return { ok: false, providerRef: null, error: e instanceof Error ? e.message : "errore_rete" };
  }
}
