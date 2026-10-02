#!/usr/bin/env node
/**
 * Recupera i chat ID che hanno interagito col bot Telegram.
 * Uso: node scripts/telegram-chat-id.mjs <BOT_TOKEN>
 * Prima scrivi un messaggio al bot (o nel gruppo dove è stato aggiunto),
 * poi lancia questo script: elenca chat e id da mettere in .env.local.
 */

const token = process.argv[2];
if (!token) {
  console.error("Uso: node scripts/telegram-chat-id.mjs <BOT_TOKEN>");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error("Errore API Telegram:", JSON.stringify(data));
  process.exit(1);
}

const seen = new Map();
for (const u of data.result) {
  for (const key of ["message", "edited_message", "channel_post", "my_chat_member"]) {
    const chat = u[key]?.chat;
    if (chat) {
      const label =
        chat.title ??
        [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
        chat.username ??
        "sconosciuta";
      seen.set(chat.id, `${chat.id} — ${chat.type === "group" || chat.type === "supergroup" ? "gruppo: " : ""}${label}`);
    }
  }
}

if (seen.size === 0) {
  console.log("Nessuna chat trovata. Scrivi un messaggio al bot (o nel gruppo) e riprova entro pochi secondi.");
  process.exit(0);
}

console.log("Chat trovate (usa l'id in TELEGRAM_CHAT_ID, anche più di uno separati da virgola):\n");
for (const line of seen.values()) console.log(" •", line);
