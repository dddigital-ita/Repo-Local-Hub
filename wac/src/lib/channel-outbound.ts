/**
 * OUTBOUND multi-canale — Fase 5, step 5.1 (PIANO-FASE-5-DESK).
 *
 * Il desk era inbound-only sui social: il webhook porta i messaggi
 * del cliente dentro il ticket, ma l'operatore non poteva partire
 * dal ticket verso WhatsApp/Instagram/Messenger/Facebook. Questo
 * modulo è l'unico gateway di uscita: risolve l'account canale
 * (channel_accounts, credenziali cifrate AES-256-GCM), invia col
 * token dell'account e specchia il messaggio nel thread con
 * provider_ref = id del provider — la UNIQUE parziale
 * (channel_account_id, provider_ref) della migration 040 rende
 * l'inserimento idempotente: lo stesso provider_ref non entra
 * due volte, neanche a invio ritentato.
 *
 * SPLIT puro/impuro: i passi senza dipendenze (payload Graph,
 * parse risposta, dispatch Graph con fetch iniettabile) vivono in
 * channel-outbound-pure.ts e sono re-exportati qui — le sentinelle
 * unit (tests/channel-outbound.test.mjs) importano il modulo
 * puro, che ha ZERO import (Node ESM non risolve import relativi
 * extensionless). La parte con dipendenze (DB channel_accounts,
 * Bot API Telegram, mirror nel thread) vive qui sotto ed è coperta
 * dall'E2E.
 *
 * Telegram non è Graph: il bot vive su telegram_chats (legacy,
 * per scelta — vedi migration 040), quindi usa la Bot API via
 * telegram.ts con la stessa facciata di sendOutbound.
 *
 * WhatsApp business-initiated: fuori dalla finestra di 24 ore Meta
 * accetta solo template approvati. Qui NON blocchiamo l'invio —
 * la policy è del chiamante (il form avvisa l'operatore): se Meta
 * rifiuta, l'errore dell'API (#131047 ecc.) torna a chi ha
 * premuto invio, non viene inghiottito.
 *
 * GUARD DI SITO (Crema): perimetro Crema fino allo step 5.4
 * (twin-sync dei moduli puri verso il gemello). Non è nel manifest
 * twin-sync — vedere AGENTS.md, voce «Solo Crema: channel-outbound».
 */
import { db } from "./db";
import { decryptKey } from "./ai";
import { formatForChannel } from "./messaging";
import { getEffectiveTelegramConfig } from "./telegram-config";
import { sendMessage } from "./telegram";
import {
  dispatchGraphOutbound,
  isOutboundChannel,
  META_TEXT_MAX,
  type OutboundAccount,
  type OutboundChannelKey,
  type OutboundResult,
} from "./channel-outbound-pure";

/** I puri sono la superficie pubblica di questo modulo: un solo punto d'ingresso. */
export * from "./channel-outbound-pure";

/* ── Account dal DB ───────────────────────────────────────── */

/**
 * Primo account abilitato del canale (oggi un account per canale:
 * la UNIQUE (channel, external_id) di 040 permette più righe, si
 * prende la più vecchia come identità canonica del canale).
 * Il token è cifrato a riposo: lo si decifra qui, mai in rotta.
 */
export async function resolveOutboundAccount(
  channel: OutboundChannelKey,
): Promise<OutboundAccount | null> {
  if (channel === "telegram") return null; // Bot API, non Graph: nessun account channel_accounts
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{
    id: string;
    channel: string;
    external_id: string;
    credentials: Record<string, unknown>;
  }>(
    `select id, channel, external_id, credentials
     from channel_accounts
     where channel = $1 and enabled = true
     order by created_at asc
     limit 1`,
    [channel],
  );
  const row = rows[0];
  if (!row) return null;
  const enc = row.credentials?.["tokenEnc"];
  if (typeof enc !== "string" || !enc) return null; // account senza token: non inviabile
  const token = decryptKey(enc);
  if (!token) return null;
  return {
    id: row.id,
    channel: row.channel as OutboundChannelKey,
    externalId: row.external_id,
    token,
  };
}

/* ── Specchio nel thread ──────────────────────────────────── */

/**
 * Il messaggio partito vive nel thread del ticket (registro
 * unificato messages). Con provider_ref: l'inserimento è
 * idempotente sulla UNIQUE parziale di 040 — un invio ritentato
 * con lo stesso mid non duplica la riga.
 */
async function persistOutboundMessage(
  accountId: string | null,
  conversationId: string,
  body: string,
  author: string | null,
  providerRef: string | null,
): Promise<void> {
  const pool = db();
  if (!pool) return;
  await pool.query(
    `insert into messages (conversation_id, sender, body, author, channel_account_id, provider_ref)
     values ($1, 'operator', $2, $3, $4, $5)
     on conflict (channel_account_id, provider_ref)
     where channel_account_id is not null and provider_ref is not null
     do nothing`,
    [conversationId, body, author, accountId, providerRef],
  );
}

/* ── Invio ────────────────────────────────────────────────── */

export interface OutboundOptions {
  /** Ticket in cui specchiare il messaggio (omesso = solo invio, niente riga nel thread). */
  conversationId?: string;
  /** Firma dell'operatore sulla riga del thread. */
  author?: string;
  /** fetch iniettabile: i test passano un mock (nessuna rete). */
  fetchImpl?: typeof fetch;
}

/**
 * Invia a un account già risolto (WhatsApp/Meta via Graph,
 * Telegram via Bot API) e specchia nel thread. Il testo è già
 * adattato al canale dal chiamante (formatForChannel).
 */
export async function dispatchOutbound(
  account: OutboundAccount | null,
  channel: OutboundChannelKey,
  to: string,
  text: string,
  opts: OutboundOptions = {},
): Promise<OutboundResult> {
  // Telegram: la Bot API del bot dell'agenzia (telegram_chats),
  // non Graph. sendMessage gestisce chunking e fallback plain.
  if (channel === "telegram") {
    const cfg = await getEffectiveTelegramConfig();
    if (!cfg) return { ok: false, providerRef: null, error: "telegram_non_configurato" };
    try {
      await sendMessage(cfg.token, to, text);
      if (opts.conversationId) {
        await persistOutboundMessage(null, opts.conversationId, text, opts.author ?? null, null);
      }
      return { ok: true, providerRef: null, error: null };
    } catch (e) {
      return { ok: false, providerRef: null, error: e instanceof Error ? e.message : "telegram_errore_rete" };
    }
  }

  if (!account) {
    return { ok: false, providerRef: null, error: `${channel}_non_configurato` };
  }
  // Graph: il dispatch (payload, fetch, parse) è il passo puro;
  // qui resta solo il mirror nel thread.
  const result = await dispatchGraphOutbound(account, channel, to, text, {
    fetchImpl: opts.fetchImpl,
  });
  if (result.ok && opts.conversationId) {
    await persistOutboundMessage(account.id, opts.conversationId, text, opts.author ?? null, result.providerRef);
  }
  return result;
}

/**
 * Facciata unica: risolve l'account del canale e invia.
 * Il testo è adattato al canale qui (WhatsApp: niente markdown
 * pesante; Meta: limite di lunghezza) — un solo punto di
 * policy, come formatForChannel già fa per Ambrosio.
 */
export async function sendOutbound(
  channel: string,
  to: string,
  text: string,
  opts: OutboundOptions = {},
): Promise<OutboundResult> {
  if (!isOutboundChannel(channel)) {
    return { ok: false, providerRef: null, error: "canale_non_supportato" };
  }
  const adapted =
    channel === "whatsapp"
      ? formatForChannel(text, "whatsapp")
      : channel === "telegram"
        ? text
        : text.slice(0, META_TEXT_MAX);
  if (channel === "telegram") {
    return dispatchOutbound(null, "telegram", to, adapted, opts);
  }
  const account = await resolveOutboundAccount(channel);
  return dispatchOutbound(account, channel, to, adapted, opts);
}
