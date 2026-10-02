/**
 * FASE 4 Ambrosio — layer messaging: architettura a canali.
 *
 * Il cervello di Ambrosio (ai.ts, ai-tools.ts, lead-extract) NON sa nulla
 * dei canali: produce testo e azioni. Questo layer decide COME il testo
 * entra ed esce da un canale. La web chat è il primo adapter (il codice
 * esistente la usa tramite route proprie); WhatsApp Business sarà un
 * secondo adapter: domani si scrive il webhook Meta, si implementano i
 * due metodi, si accende la pagina admin — e nulla altro cambia.
 *
 * Predisposizione, non attivazione: nessun percorso chiama WhatsAppAdapter
 * finché l'account Meta non esiste (enabled=false di default su DB).
 */
import { db } from "@/lib/db";
import { decryptKey } from "@/lib/ai";
import { logAudit } from "@/lib/audit";
import { sendMessage } from "@/lib/telegram";
import { getEffectiveTelegramConfig } from "@/lib/telegram-config";

/** Canali previsti. Validazione a livello app (niente check constraint). */
export const CHANNELS = ["web", "whatsapp", "email", "telegram"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

/** Vincoli WhatsApp pre-ingestiti nel design (PROMPT-AMBROSIO-AI.md, Fase 4). */
export interface ChannelPolicy {
  /** finestra customer care (ore) dentro la quale si può rispondere libero */
  serviceWindowHours: number;
  /** lunghezza massima del messaggio in uscita */
  maxOutLength: number;
  /** markdown pesante ammesso (grassetto, elenchi, titoli) */
  allowRichMarkdown: boolean;
  /** messaggi business-initiated (es. follow-up Fase 2) ammessi fuori finestra */
  allowBusinessInitiated: boolean;
}

export const CHANNEL_POLICY: Record<Channel, ChannelPolicy> = {
  web: {
    serviceWindowHours: 24 * 365, // niente finestra: la web chat non scade
    maxOutLength: 4000,
    allowRichMarkdown: true,
    allowBusinessInitiated: true, // il follow-up nel thread web è lecito (canale nostro)
  },
  whatsapp: {
    serviceWindowHours: 24, // dentro la finestra si risponde libero...
    maxOutLength: 4096, // limite reale dell'API Cloud
    allowRichMarkdown: false, // niente markdown pesante: testo semplice + emoji
    allowBusinessInitiated: false, // ...fuori SOLO template approvati, e qui non si va
  },
  email: {
    serviceWindowHours: 24 * 365, // risposta libera: si risponde alla mail arrivata
    maxOutLength: 20_000,
    allowRichMarkdown: true,
    allowBusinessInitiated: true, // le risposte del ticket partono dall'SMTP dell'agenzia
  },
  telegram: {
    serviceWindowHours: 24 * 365, // chat privata col bot: si risponde sempre
    maxOutLength: 4000, // margine sul limite reale API (4096)
    allowRichMarkdown: false, // solo **grassetto** → <b>, il resto testo
    allowBusinessInitiated: true, // la risposta dell'operatore alla chat del cliente
  },
};

/** Il follow-up di Ambrosio (business-initiated) è lecito su questo canale? */
export function canSendFollowup(channel: Channel): boolean {
  return CHANNEL_POLICY[channel].allowBusinessInitiated;
}

/** Adatta il testo di Ambrosio ai vincoli del canale. Idempotente, mai bloccante. */
export function formatForChannel(text: string, channel: Channel): string {
  const t = text.trim();
  if (channel === "web" || channel === "email") return t;
  if (channel === "telegram") {
    // Telegram: il grassetto si può tenere (diventa <b> lato telegram.ts);
    // qui si passa plaintext con i vincoli di lunghezza del canale.
    return t.replace(/^#{1,6}\s+/gm, "").slice(0, CHANNEL_POLICY.telegram.maxOutLength);
  }
  // WhatsApp: niente markdown pesante — si toglieno **, ##, link autoreferenziali.
  const plain = t
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .slice(0, CHANNEL_POLICY.whatsapp.maxOutLength);
  return plain;
}

/**
 * Normalizzazione E.164 condivisa web+WhatsApp: lo stesso numero al telefono
 * è lo stesso cliente, qualunque canale abbia scritto. Ritorna null se il
 * numero non è normalizzabile (meglio null che un dedup sbagliato).
 */
export function toE164(raw: string, defaultCountry = "39"): string | null {
  const t = raw.trim();
  if (!t) return null;
  const withPlus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  if (withPlus) return `+${digits}`;
  // Senza prefisso internazionale: assume il paese di default (Italia).
  if (digits.length < 8 || digits.length > 13) return null;
  return `+${defaultCountry}${digits}`;
}

/* ── Interfaccia adapter ─────────────────────────────────────────── */

export interface InboundMessage {
  channel: Channel;
  /** id thread lato canale (per web = conversation uuid; per WA = wa phone/chat id) */
  threadId: string;
  sender: "visitor";
  body: string;
  /** numero E.164 del mittente (web: assente; WA: sempre presente) */
  fromPhone?: string;
}

export interface OutboundMessage {
  to: string; // threadId del canale
  body: string;
}

export interface ChannelAdapter {
  readonly channel: Channel;
  /** riceve un messaggio inbound e lo persiste nel modello canonico messages */
  inbound(msg: InboundMessage): Promise<void>;
  /** invia una risposta sul canale */
  reply(msg: OutboundMessage): Promise<void>;
}

/* ── Adapter web (attivo oggi, usato indirettamente dalle route chat) ── */

export const webAdapter: ChannelAdapter = {
  channel: "web",
  async inbound(msg: InboundMessage): Promise<void> {
    const pool = db();
    if (!pool) return;
    await pool.query("insert into messages (conversation_id, sender, body) values ($1, 'visitor', $2)", [
      msg.threadId,
      msg.body,
    ]);
  },
  async reply(msg: OutboundMessage): Promise<void> {
    const pool = db();
    if (!pool) return;
    await pool.query("insert into messages (conversation_id, sender, body) values ($1, 'bot', $2)", [
      msg.to,
      msg.body,
    ]);
  },
};

/* ── Adapter WhatsApp (predisposto, mai attivato finché Meta non c'è) ── */

export interface WhatsAppCreds {
  phoneNumberId: string;
  token: string;
  enabled: boolean;
}

/** Credenziali dalla tabella dedicata (token cifrato AES-256-GCM). Null se assenti. */
export async function getWhatsAppCreds(): Promise<WhatsAppCreds | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{ phone_number_id: string; waba_token_enc: string; enabled: boolean }>(
      "select phone_number_id, waba_token_enc, enabled from whatsapp_config where id = 1",
    );
    const r = rows[0];
    if (!r || !r.enabled) return null;
    const token = decryptKey(r.waba_token_enc);
    if (!token || !r.phone_number_id) return null;
    return { phoneNumberId: r.phone_number_id, token, enabled: true };
  } catch {
    return null; // tabella non ancora migrata: predisposizione senza errori
  }
}

/**
 * Adapter WhatsApp: implementazione reale dell'API Cloud Message API,
 * MA inerte finché getWhatsAppCreds() non ritorna credenziali valide.
 * Nessun credito Meta speso in questa fase: i metodi falliscono in
 * silenzio se la configurazione è assente o disabilitata.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  async inbound(): Promise<void> {
    // Il webhook Meta (futuro) chiamerà questo metodo; oggi nessun chiamante.
    throw new Error("whatsapp_non_attivo");
  },
  async reply(msg: OutboundMessage): Promise<void> {
    const creds = await getWhatsAppCreds();
    if (!creds) {
      await logAudit("system", "whatsapp.invio-bloccato", msg.to, "canale predisposto ma non attivo");
      throw new Error("whatsapp_non_attivo");
    }
    // Percorso reale, pronto per l'attivazione (nessun costo finché disabilitato):
    // POST graph.facebook.com/v20.0/{phone_number_id}/messages con token bearer.
    const res = await fetch(`https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "text",
        text: { body: formatForChannel(msg.body, "whatsapp") },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`whatsapp_api_${res.status}`);
  },
};

export function adapterFor(channel: Channel): ChannelAdapter {
  return channel === "whatsapp" ? whatsappAdapter : channel === "telegram" ? telegramAdapter : webAdapter;
}

/* ── Adapter Telegram (canale bidirezionale, migration 033) ──────── */

/**
 * Outbound Telegram: la risposta dell'operatore dal ticket arriva nella chat
 * privata del cliente. L'inbound non passa da qui (webhook e polling hanno
 * la loro pipeline con dedup su update_id).
 *
 * `msg.to` accetta DUE forme, come i due chiamanti reali:
 *  - chat id numerico (risposta operatore da actions.ts: contact_handle
 *    già risolto) → invio diretto, la riga del messaggio è già nel ticket;
 *  - conversation uuid (follow-up del cron) → si risolve contact_handle e
 *    la risposta bot viene anche inserita nel thread, come fa webAdapter.
 * Se il chat id non è noto il canale degrada a errore: chi chiama gestisce
 * (l'operatore vede l'audit, il follow-up rilascia il claim).
 */
export const telegramAdapter: ChannelAdapter = {
  channel: "telegram",
  async inbound(): Promise<void> {
    // L'inbound reale è processTelegramMessage (telegram-ingest.ts).
    throw new Error("telegram_inbound_altrove");
  },
  async reply(msg: OutboundMessage): Promise<void> {
    const cfg = await getEffectiveTelegramConfig();
    const pool = db();
    const isChatId = /^-?\d+$/.test(msg.to);
    let chatId = msg.to;
    if (!isChatId) {
      if (!pool) throw new Error("db_non_configurato");
      const { rows } = await pool.query<{ contact_handle: string | null }>(
        "select contact_handle from conversations where id = $1",
        [msg.to],
      );
      chatId = rows[0]?.contact_handle ?? "";
      if (!chatId) throw new Error("telegram_chat_non_noto");
    }
    if (!cfg) throw new Error("telegram_non_configurato");
    await sendMessage(cfg.token, chatId, msg.body);
    if (!isChatId && pool) {
      // Follow-up: il testo vive anche nel thread del ticket (registro).
      await pool.query("insert into messages (conversation_id, sender, body) values ($1, 'bot', $2)", [
        msg.to,
        msg.body,
      ]);
    }
  },
};
