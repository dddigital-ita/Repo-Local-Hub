/**
 * CHANNEL REGISTRY (Fase 4 del desk): il contratto che OGNI canale
 * chat/social implementa per entrare nel ticketing senza toccare coda né
 * scheda. Un canale nuovo = un adapter + una riga in CHANNELS: la lista
 * canali della inbox è già data-driven (GROUP BY), il registro lo
 * formalizza lato codice e la migration 040 lo vincola lato DB.
 *
 * Sicurezza webhook: HMAC-SHA256 sul corpo grezzo con il secret
 * dell'account (X-WAC-Signature: sha256=<hex>), confronto in tempo
 * costante — lo stesso schema di Meta (X-Hub-Signature-256) e del secret
 * token di Telegram, normalizzato in UNA verifica qui.
 */
import { db } from "./db";
import { decryptKey } from "./ai";
import {
  signWebhookBody,
  safeEqual,
  verifyHmac,
  verifyLinkedInSignature,
  signLinkedInChallenge,
  parseMetaInbound,
  parseTelegramInbound,
  parseLinkedInInbound,
  metaExternalId,
  linkedinExternalId,
} from "../../scripts/channel-webhook-core.mjs";

export { signWebhookBody, safeEqual, signLinkedInChallenge };

/**
 * Contratto condiviso con il check SQL (040 + 045 qui, 040
 * completa nel gemello): la sentinella tests/channel-registry.test.mjs
 * confronta l'UNIONE dei vincoli delle migration con questa lista.
 */
export const CHANNELS = ["web", "email", "whatsapp", "telegram", "instagram", "messenger", "facebook", "linkedin"] as const;
export type ChannelKey = (typeof CHANNELS)[number];

export interface ChannelAccountRow {
  id: string;
  channel: ChannelKey;
  external_id: string;
  label: string | null;
  credentials: Record<string, unknown>;
  enabled: boolean;
}

/** Metadati di presentazione (etichette/inbox) per i canali nel registry. */
export const CHANNEL_META: Record<ChannelKey, { label: string }> = {
  web: { label: "Chat web" },
  email: { label: "Email" },
  whatsapp: { label: "WhatsApp" },
  telegram: { label: "Telegram" },
  instagram: { label: "Instagram" },
  messenger: { label: "Messenger" },
  facebook: { label: "Facebook" },
  linkedin: { label: "LinkedIn" },
};

/**
 * L'adapter: cosa serve per essere un canale. Le implementazioni dei
 * canali già vivi restano dove sono (telegram-ingest, email-tools,
 * messaging) — l'adapter li DELEGA: niente big-bang, la Fase 5 li
 * riassorbe uno alla volta.
 */
export interface ChannelAdapter {
  key: ChannelKey;
  /** Il canale ha una porta webhook pull-based (Meta, Telegram)? */
  webhook: boolean;
  /**
   * Verifica la firma della richiesta per l'account. Riceve il corpo GREZZO
   * (l'HMAC si calcola sui byte esatti, non sul JSON riparsato) e gli header.
   */
  verifySignature(account: ChannelAccountRow, rawBody: string, headers: Headers): boolean;
  /**
   * Estrae i messaggi inbound dal payload del provider. Ritorna provider_ref
   * (per la dedup UNIQUE) + handle/nome/testo. Un payload non pertinente
   * ritorna [] (200 lato webhook: il provider non deve ritentare).
   */
  parseInbound(account: ChannelAccountRow, payload: unknown): InboundMessage[];
  /**
   * Estrae l'external_id dell' account ricevente dal payload
   * (entry[].id per Meta, organizationalEntity per LinkedIn):
   * il webhook la usa per trovare l'account da verificare.
   */
  externalIdFrom?(payload: unknown): string | null;
}

export interface InboundMessage {
  providerRef: string;
  /** L'identità del mittente lato provider (chat id, wa id, ig id). */
  senderHandle: string;
  senderName: string | null;
  text: string;
  /** ISO del messaggio lato provider, se detto (altrimenti ora). */
  sentAt?: string;
}

/* ── Firma webhook ───────────────────────────────────────────────── */

/** Il secret dell'account: cifrato a riposo (credentials.secretEnc). */
export function accountSecret(account: Pick<ChannelAccountRow, "credentials">): string | null {
  const enc = account.credentials?.["secretEnc"];
  return typeof enc === "string" && enc ? decryptKey(enc) : null;
}

/** Verifica generica HMAC (X-WAC-Signature): la usano gli adapter che seguono lo schema Meta/Telegram-normalizzato. */
function verifyHmacHeader(account: ChannelAccountRow, rawBody: string, headers: Headers, headerName: string): boolean {
  const secret = accountSecret(account);
  if (!secret) return false; // senza secret configurato, niente verifica possibile → rifiuta
  return verifyHmac(secret, rawBody, headers.get(headerName) ?? "");
}

/* ── Adapter dei canali ──────────────────────────────────────────── */

/**
 * Telegram: delega al webhook esistente (che verifica col SUO secret token
 * header). L'adapter qui normalizza la verifica sullo stesso header e il
 * parse sull'update shape — la pipeline resta in telegram-ingest.
 */
const telegramAdapter: ChannelAdapter = {
  key: "telegram",
  webhook: true,
  verifySignature: (account, _raw, headers) => verifyHmacHeader(account, _raw, headers, "x-telegram-bot-api-secret-token"),
  parseInbound: (_account, payload) => parseTelegramInbound(payload),
};

/**
 * Meta (Instagram/Messenger/Facebook): stesso schema firma
 * (X-Hub-Signature-256 sul corpo grezzo, app secret), payload a
 * entries/messaging — la pagina Facebook riceve sulla stessa
 * Messenger Platform. La Fase 5 aggiunge l'outbound (Graph API);
 * l'inbound normalize qui è già completo.
 */
function metaAdapter(key: "instagram" | "messenger" | "facebook"): ChannelAdapter {
  return {
    key,
    webhook: true,
    verifySignature: (account, raw, headers) => verifyHmacHeader(account, raw, headers, "x-hub-signature-256"),
    parseInbound: (account, payload) => parseMetaInbound(account.external_id, payload),
    externalIdFrom: (payload) => metaExternalId(payload),
  };
}

/**
 * LinkedIn (Organization Social Action): firma X-LI-Signature =
 * hex(HMAC-SHA256("hmacsha256=" + corpo grezzo, clientSecret)) —
 * l'header ha SOLO l'hex. La validazione GET ?challengeCode=
 * (challengeResponse) è nella route: il secret serve prima di
 * avere un payload. L'external_id è l'URN dell'organizzazione.
 */
const linkedinAdapter: ChannelAdapter = {
  key: "linkedin",
  webhook: true,
  verifySignature: (account, raw, headers) => {
    const secret = accountSecret(account);
    if (!secret) return false; // senza clientSecret configurato, niente verifica possibile → rifiuta
    return verifyLinkedInSignature(secret, raw, headers.get("x-li-signature") ?? "");
  },
  parseInbound: (_account, payload) => parseLinkedInInbound(payload),
  externalIdFrom: (payload) => linkedinExternalId(payload),
};

/** I canali webhookabili nel registry. web/email/whatsapp hanno le loro porte (route dedicate, non lookup). */
const ADAPTERS: Partial<Record<ChannelKey, ChannelAdapter>> = {
  telegram: telegramAdapter,
  instagram: metaAdapter("instagram"),
  messenger: metaAdapter("messenger"),
  facebook: metaAdapter("facebook"),
  linkedin: linkedinAdapter,
};

export function getAdapter(channel: string): ChannelAdapter | null {
  return ADAPTERS[channel as ChannelKey] ?? null;
}

/* ── Account dal DB ──────────────────────────────────────────────── */

export async function findChannelAccount(channel: string, externalId: string): Promise<ChannelAccountRow | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<ChannelAccountRow>(
    `select id, channel, external_id, label, credentials, enabled
     from channel_accounts where channel = $1 and external_id = $2 and enabled`,
    [channel, externalId],
  );
  return rows[0] ?? null;
}

/* ── Rispecchiamento legacy (telegram_chats → channel_accounts) ──── */

/**
 * Il canale telegram resta su telegram_chats (token e webhook segreto lì):
 * il registry lo ESPONE come account sintetico così /api/webhooks/[channel]
 * e la inbox possono trattarlo come gli altri, senza migrare credenziali.
 */
export async function syncChannelAccountsFromLegacy(): Promise<void> {
  const pool = db();
  if (!pool) return;
  try {
    await pool.query(`
      insert into channel_accounts (channel, external_id, label, credentials, enabled)
      select 'telegram', t.chat_id::text, coalesce(nullif(t.title, ''), nullif(t.username, ''), 'Bot Telegram'),
             jsonb_build_object('legacy_chat_id', t.chat_id), true
      from telegram_chats t
      on conflict (channel, external_id) do update
        set label = coalesce(excluded.label, channel_accounts.label),
            updated_at = now()
    `);
  } catch {
    // telegram_chats non esiste (installazione senza telegram): zero righe, nessun errore.
  }
}
