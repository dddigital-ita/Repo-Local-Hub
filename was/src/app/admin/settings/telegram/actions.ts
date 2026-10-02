"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import {
  getEffectiveTelegramConfig,
  getTelegramConfigView,
  saveTelegramConfig,
} from "@/lib/telegram-config";
import { sendMessage, getUpdates } from "@/lib/telegram";
import { TELEGRAM_TEST_MESSAGE } from "@/lib/telegram-config-shared";

export interface TelegramChatRow {
  id: string;
  label: string;
  kind: string;
}

/**
 * Chat che hanno scritto al bot (getUpdates): la stessa lista che il vecchio
 * script CLI mostrava, ora dentro la scheda. Null se il bot non è raggiungibile.
 * (Funzione interna: solo l'action «Rileva chat» è esposta al client.)
 */
async function getTelegramBotChats(): Promise<TelegramChatRow[] | null> {
  const cfgView = await getTelegramConfigView();
  if (!cfgView.hasToken) return null;
  const cfg = await getEffectiveTelegramConfig();
  if (!cfg) return null;
  try {
    const { ok, updates } = await getUpdates(cfg.token, 0);
    if (!ok) return null;
    const seen = new Map<string, TelegramChatRow>();
    interface AnyChat {
      id?: number | string;
      type?: string;
      title?: string;
      first_name?: string;
      username?: string;
    }
    for (const u of updates) {
      const upd = u as Record<"message" | "edited_message" | "channel_post" | "my_chat_member", { chat?: AnyChat } | undefined>;
      for (const key of ["message", "edited_message", "channel_post", "my_chat_member"] as const) {
        const chat = upd[key]?.chat;
        if (!chat || chat.id == null) continue;
        const id = String(chat.id);
        if (seen.has(id)) continue;
        const label =
          chat.title ||
          chat.first_name ||
          chat.username ||
          "sconosciuta";
        seen.set(id, {
          id,
          label: String(label ?? "sconosciuta"),
          kind: chat.type ?? "unknown",
        });
      }
    }
    return [...seen.values()];
  } catch {
    return null;
  }
}

/** Salva la scheda e torna al banner (pattern del pannello email). */
export async function saveTelegramConfigAction(formData: FormData) {
  const user = await requireAdmin();
  const result = await saveTelegramConfig({
    botToken: String(formData.get("botToken") ?? ""),
    teamChatIds: String(formData.get("teamChatIds") ?? ""),
    webhookSecret: String(formData.get("webhookSecret") ?? ""),
    enabled: formData.get("enabled") === "on",
  });
  await logAudit(user.email, result.ok ? "telegram.impostazioni" : "telegram.errore", null, result.error ?? null);
  const msg = result.ok
    ? result.webhookCommand
      ? `Configurazione salvata. Se il secret è nuovo, re-imposta il webhook: ${result.webhookCommand}`
      : "Configurazione Telegram salvata"
    : result.error ?? "Errore salvataggio";
  redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent(msg)}`);
}

/** Messaggio di prova reale alla prima chat del team configurata. */
export async function testTelegramAction(formData: FormData) {
  const user = await requireAdmin();
  const view = await getTelegramConfigView();
  const override = String(formData.get("testChatId") ?? "").trim();
  const chatId = override || view.teamChatIds[0] || "";

  if (!view.hasToken) {
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent("Token mancante: salva prima la configurazione.")}`);
  }
  if (!chatId) {
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent("Nessuna chat di destinazione: scrivi un messaggio al bot e rileva le chat, oppure inserisci un Chat ID.")}`);
  }

  const cfg = await getEffectiveTelegramConfig();
  if (!cfg) {
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent("Config non risolvibile (token non valido o disattivato).")}`);
  }
  try {
    await sendMessage(cfg!.token, chatId, TELEGRAM_TEST_MESSAGE);
    await logAudit(user.email, "telegram.test", chatId, "messaggio di prova inviato");
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent(`Messaggio di prova inviato alla chat ${chatId}.`)}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await logAudit(user.email, "telegram.test_errore", chatId, detail.slice(0, 300));
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent(`Invio fallito: ${detail}`)}`);
  }
}

/** Rileva le chat che hanno interagito col bot e le propone nel form (audit). */
export async function detectTelegramChatsAction() {
  const user = await requireAdmin();
  const chats = await getTelegramBotChats();
  await logAudit(
    user.email,
    "telegram.rileva_chat",
    null,
    chats ? `${chats.length} chat trovate` : "bot non raggiungibile",
  );
  if (!chats || chats.length === 0) {
    redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent("Nessuna chat trovata: scrivi un messaggio al bot (o aggiungilo a un gruppo) e riprova tra qualche secondo.")}`);
  }
  const csv = chats!.map((c) => c.id).join(",");
  redirect(`/admin/settings/telegram?telegram_test=${encodeURIComponent(`Trovate ${chats!.length} chat: ${csv} — copiale nel campo «Chat del team» se sono quelle giuste.`)}`);
}
