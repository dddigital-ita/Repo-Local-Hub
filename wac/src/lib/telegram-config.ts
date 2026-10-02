/**
 * CONFIG TELEGRAM (server-only): lettura/scrittura della tabella
 * telegram_config (migration 034) e risoluzione DELLA config effettiva.
 *
 * Priorità: DB (scheda admin) → env (installazioni storiche). Il fallback
 * mantiene il comportamento attuale: finché nessuno salva la scheda, token
 * e chat continuano a arrivare da .env.local; dopo il salvataggio, il DB
 * comanda (l'env resta solo come ripiego se la riga viene disattivata).
 * I segreti sono cifrati AES-256-GCM (encryptKey/decryptKey di ai.ts,
 * stessa chiave delle API AI e del token WhatsApp).
 *
 * Questa lib è la fonte per TUTTO il runtime: webhook, digest serale e
 * risposta operatore leggono da qui, non più direttamente l'env.
 */
import { db } from "@/lib/db";
import { decryptKey, encryptKey } from "@/lib/ai";
import {
  isValidBotToken,
  isValidChatId,
  parseChatIds,
  chatIdsToCsv,
} from "@/lib/telegram-config-shared";
import type { TelegramConfig } from "@/lib/telegram";
// Nota: solo TYPE import da telegram.ts (file puro, senza dipendenze) —
// la direzione delle dipendenze è telegram-config → telegram, mai il verso.

interface StoredTelegramConfig {
  botTokenEnc: string | null;
  teamChatIds: string | null;
  webhookSecretEnc: string | null;
  enabled: boolean;
}

export interface TelegramConfigView {
  /** true = la config effettiva arriva dal DB (scheda admin), false = env. */
  fromDb: boolean;
  hasToken: boolean;
  /** Suggerimento mascherato (mai il token per intero). */
  tokenHint: string | null;
  teamChatIdsCsv: string;
  teamChatIds: string[];
  hasWebhookSecret: boolean;
  webhookSecretHint: string | null;
  enabled: boolean;
}

/** Suggerimento mascherato (pattern di google-tools.hintFor). */
function hintFor(value: string): string | null {
  if (!value) return null;
  return `${value.slice(0, 6)}${"•".repeat(Math.max(4, Math.min(value.length - 12, 24)))}${value.slice(-4)}`;
}

/** Config di riserva dall'env (comportamento storico di getTelegramConfig). */
function envFallbackConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) return null;
  return {
    token,
    teamChatIds: (process.env.TELEGRAM_CHAT_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}

async function readStored(): Promise<StoredTelegramConfig | null> {
  const pool = db();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{
      bot_token_enc: string | null;
      team_chat_ids: string | null;
      webhook_secret_enc: string | null;
      enabled: boolean;
    }>("select bot_token_enc, team_chat_ids, webhook_secret_enc, enabled from telegram_config where id = 1");
    const r = rows[0];
    if (!r) return null;
    return {
      botTokenEnc: r.bot_token_enc,
      teamChatIds: r.team_chat_ids,
      webhookSecretEnc: r.webhook_secret_enc,
      enabled: r.enabled,
    };
  } catch {
    return null; // tabella non migrata: fallback env senza errori
  }
}

/** La scheda admin mostra QUESTA vista (mai i segreti per intero). */
export async function getTelegramConfigView(): Promise<TelegramConfigView> {
  const stored = await readStored();
  const env = envFallbackConfig();
  if (!stored) {
    return {
      fromDb: false,
      hasToken: Boolean(env?.token),
      tokenHint: env?.token ? hintFor(env.token) : null,
      teamChatIdsCsv: process.env.TELEGRAM_CHAT_ID ?? "",
      teamChatIds: env?.teamChatIds ?? [],
      hasWebhookSecret: Boolean(env?.webhookSecret),
      webhookSecretHint: env?.webhookSecret ? hintFor(env.webhookSecret) : null,
      enabled: Boolean(env?.token),
    };
  }
  const token = stored.botTokenEnc ? decryptKey(stored.botTokenEnc) : null;
  const secret = stored.webhookSecretEnc ? decryptKey(stored.webhookSecretEnc) : null;
  return {
    fromDb: Boolean(stored.enabled && token),
    hasToken: Boolean(token) || Boolean(env?.token),
    tokenHint: token ? hintFor(token) : env?.token ? hintFor(env.token) : null,
    teamChatIdsCsv: stored.teamChatIds ?? process.env.TELEGRAM_CHAT_ID ?? "",
    teamChatIds: parseChatIds(stored.teamChatIds ?? ""),
    hasWebhookSecret: Boolean(secret) || Boolean(env?.webhookSecret),
    webhookSecretHint: secret ? hintFor(secret) : env?.webhookSecret ? hintFor(env.webhookSecret) : null,
    enabled: Boolean(stored.enabled && token),
  };
}

/**
 * La config EFFETTIVA per tutto il runtime (webhook, digest, notifiche).
 * DB attivo e valido → vince; altrimenti env; senza nulla → null.
 */
export async function getEffectiveTelegramConfig(): Promise<TelegramConfig | null> {
  const stored = await readStored();
  if (stored?.enabled && stored.botTokenEnc) {
    const token = decryptKey(stored.botTokenEnc);
    const chatIds = parseChatIds(stored.teamChatIds ?? "");
    if (token) {
      return {
        token,
        teamChatIds: chatIds,
        webhookSecret: stored.webhookSecretEnc ? decryptKey(stored.webhookSecretEnc) : null,
      };
    }
  }
  return envFallbackConfig();
}

/** Risultato del salvataggio (i messaggi finiscono nel banner della scheda). */
export interface SaveTelegramConfigResult {
  ok: boolean;
  error?: string;
  /** Istruzioni per il webhook se token/secret sono nuovi o cambiati. */
  webhookCommand?: string;
}

/**
 * Salva la scheda. Un token senza chat valide → errore (inutilizzabile).
 * Token/secret vuoti = conservano quelli salvati (pattern della password
 * del pannello email). Disattivare (= enabled false) torna al fallback env.
 */
export async function saveTelegramConfig(input: {
  botToken: string;
  teamChatIds: string;
  webhookSecret: string;
  enabled: boolean;
}): Promise<SaveTelegramConfigResult> {
  const pool = db();
  if (!pool) return { ok: false, error: "Database non configurato." };

  const token = input.botToken.trim();
  if (token && !isValidBotToken(token)) {
    return { ok: false, error: "Il token non ha il formato di un bot Telegram (123456:ABC…). Controlla su BotFather." };
  }

  const chatIds = parseChatIds(input.teamChatIds);
  for (const id of chatIds) {
    if (!isValidChatId(id)) {
      return { ok: false, error: `Chat ID non valido: «${id}» — deve essere un numero (anche negativo) oppure @nomepubblico.` };
    }
  }
  if (token && chatIds.length === 0) {
    return { ok: false, error: "Serve almeno un Chat ID valido: senza chat il bot non ha destinatari." };
  }

  const secret = input.webhookSecret.trim();

  // Riga unica (id=1): upsert sui segreti NON toccati = conservare
  // (token/secret vuoti nel form = «lascia invariato», come la password
  // del pannello email).
  await pool.query(
    `insert into telegram_config (id, bot_token_enc, team_chat_ids, webhook_secret_enc, enabled, updated_at)
     values (1,
             nullif($2, ''),
             nullif($3, ''),
             nullif($4, ''),
             $5,
             now())
     on conflict (id) do update set
       bot_token_enc = coalesce(nullif($2, ''), telegram_config.bot_token_enc),
       team_chat_ids = $3,
       webhook_secret_enc = coalesce(nullif($4, ''), telegram_config.webhook_secret_enc),
       enabled = $5,
       updated_at = now()`,
    [
      token ? encryptKey(token) : "",
      chatIdsToCsv(chatIds),
      secret ? encryptKey(secret) : "",
      input.enabled && Boolean(token),
    ],
  );

  // Istruzioni operative: se il secret cambia, il webhook va re-impostato.
  const finalToken = token || "";
  const webhookCommand =
    token && secret
      ? `node scripts/telegram-webhook.mjs ${finalToken.slice(0, 8)}… https://TUODOMINIO/api/telegram/webhook <stesso secret>`
      : undefined;

  return { ok: true, webhookCommand };
}
