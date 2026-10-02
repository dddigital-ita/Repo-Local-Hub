import { db } from "@/lib/db";
import { cache } from "react";
import { readThroughDbConfig } from "@/lib/db-config-cache";
import {
  CHAT_EMOJIS_DEFAULT,
  getChatEmojis,
  getQuickReplies,
  getSlaPolicy,
  QUICK_REPLIES_DEFAULT,
} from "@/lib/tickets";
import { getEmailToolsConfig } from "@/lib/email-tools";
import {
  autoCloseStatus,
  emailStatus,
  leadFollowupStatus,
  chatEmojisStatus,
  quickRepliesStatus,
  slaStatus,
  socialStatus,
  telegramStatus,
  whatsappStatus,
  cloudflareStatus,
  EMPTY_WHATSAPP_CONFIG,
  type HubCardStatus,
} from "@/lib/settings-status";
import { getSocialChannelsView } from "@/lib/social-oauth";
import { getTelegramConfigView } from "@/lib/telegram-config";
import { getTurnstileSettings } from "@/lib/turnstile-settings";
import { getLastTurnstileTest } from "@/lib/turnstile-verify";

/**
 * STATO DELL'HUB IMPOSTAZIONI (server-only): carica i dati grezzi dal DB e
 * delega OGNI decisione di badge alle funzioni pure di `settings-status.ts`
 * (testabili con node, import diretto del .ts). La pagina dell'hub diventa
 * pura presentazione.
 *
 * Robustezza: ogni lettura degredisce da sola — DB assente, tabelle non
 * migrate o righe corrotte producono il default sicuro, mai un 500 dell'hub.
 */

export type SettingsStatuses = {
  replies: HubCardStatus;
  chatEmojis: HubCardStatus;
  sla: HubCardStatus;
  autoClose: HubCardStatus;
  email: HubCardStatus;
  whatsapp: HubCardStatus;
  telegram: HubCardStatus;
  social: HubCardStatus;
  followup: HubCardStatus;
  cloudflare: HubCardStatus;
};

async function readAutoCloseDays(): Promise<number> {
  const pool = db();
  if (!pool) return 0;
  try {
    const rows = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = 'ticket_autoclose_days'",
    );
    return Number(rows.rows[0]?.value) || 0;
  } catch {
    return 0;
  }
}

/** undefined = riga assente → default 48h attivo; null = OFF esplicito. */
async function readFollowupHours(): Promise<number | null | undefined> {
  const pool = db();
  if (!pool) return undefined;
  try {
    const rows = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = 'lead_followup_hours'",
    );
    const row = rows.rows[0];
    if (!row) return undefined;
    const n = Number(row.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return undefined;
  }
}

async function readWhatsAppConfig() {
  const pool = db();
  if (!pool) return EMPTY_WHATSAPP_CONFIG;
  try {
    const wa = await pool.query<{ phone_number_id: string | null; waba_token_enc: string | null; enabled: boolean }>(
      "select phone_number_id, waba_token_enc, enabled from whatsapp_config where id = 1",
    );
    const row = wa.rows[0];
    if (!row) return EMPTY_WHATSAPP_CONFIG;
    return {
      phoneNumberId: row.phone_number_id ?? null,
      wabaTokenEnc: row.waba_token_enc ?? null,
      enabled: Boolean(row.enabled),
    };
  } catch {
    return EMPTY_WHATSAPP_CONFIG;
  }
}

/** Carica tutto il necessario e deriva i sei stati dell'hub.
 *  Memoizzato per richiesta (cache() di React, ADR-005): Panoramica compone
 *  questo layer + Tools + Integrazioni nella STESSA richiesta — senza dedup
 *  le letture sarebbero il doppio (10 query per il solo hub Impostazioni).
 *  Le letture di configurazione passano dal TTL condiviso (60s, ADR-005
 *  esteso): le schede cambiano solo a salvataggio — la pill può invecchiare
 *  al massimo un minuto, un fallimento non viene mai memorizzato. Le tre
 *  chiavi content_settings con bump (SLA, emoji, risposte rapide) restano
 *  nello snapshot per-request di tickets.ts: la freschezza dopo il salvataggio
 *  lì è garantita dal bump, qui non serve altro. */
export const getSettingsStatuses = cache(async (): Promise<SettingsStatuses> => {
  const [repliesRaw, emojisRaw, slaRaw, emailRaw, autoCloseDays, followupHours, waRaw, tgView, socialAccounts, turnstile, turnstileTest] = await Promise.all([
    getQuickReplies().catch(() => QUICK_REPLIES_DEFAULT),
    getChatEmojis().catch(() => CHAT_EMOJIS_DEFAULT),
    getSlaPolicy().catch(() => ({})),
    readThroughDbConfig("email_tools", getEmailToolsConfig).catch(() => null),
    readThroughDbConfig("autoclose_days", readAutoCloseDays),
    readThroughDbConfig("followup_hours", readFollowupHours),
    readThroughDbConfig("whatsapp_config", readWhatsAppConfig),
    readThroughDbConfig("telegram_view", getTelegramConfigView).catch(() => null),
    // Canali social: account collegati (vista OAuth). TTL condiviso
    // come telegram_view: cambia solo al «Collega», la pill può
    // invecchiare al massimo un minuto. Il reader degredisce a [].
    readThroughDbConfig("social_accounts", getSocialChannelsView).catch(() => []),
    // Robustezza come le altre letture: DB assente o riga corrotta →
    // il reader degredisce da solo e l'hub mostra «Da configurare».
    readThroughDbConfig("turnstile", getTurnstileSettings).catch(() => null),
    // L'ultimo «Prova verifica» (audit): degredisce a null = mai eseguito.
    getLastTurnstileTest().catch(() => ({ lastTestAt: null, lastTestOk: null })),
  ]);
  return {
    replies: quickRepliesStatus(repliesRaw ?? QUICK_REPLIES_DEFAULT, QUICK_REPLIES_DEFAULT),
    chatEmojis: chatEmojisStatus(emojisRaw ?? CHAT_EMOJIS_DEFAULT, CHAT_EMOJIS_DEFAULT),
    sla: slaStatus(slaRaw),
    autoClose: autoCloseStatus(autoCloseDays),
    email: emailStatus({
      smtpHost: emailRaw?.smtpHost ?? null,
      user: emailRaw?.user ?? null,
      hasPassword: Boolean(emailRaw?.hasPassword),
    }),
    whatsapp: whatsappStatus(waRaw),
    telegram: telegramStatus({
      hasToken: Boolean(tgView?.hasToken),
      hasTeamChats: Boolean(tgView && tgView.teamChatIds.length > 0),
    }),
    social: socialStatus(socialAccounts?.length ?? 0),
    followup: leadFollowupStatus(followupHours),
    cloudflare: cloudflareStatus({
      active: Boolean(turnstile?.siteKey),
      fromDb: Boolean(turnstile?.fromDb),
      lastTestOk: turnstileTest.lastTestOk,
      lastTestAt: turnstileTest.lastTestAt,
    }),
  };
});
