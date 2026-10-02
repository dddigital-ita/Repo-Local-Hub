#!/usr/bin/env node
/**
 * REGISTRA IL WEBHOOK TELEGRAM (canale bidirezionale, migration 033).
 *
 * Uso:
 *   node scripts/telegram-webhook.mjs <BOT_TOKEN> <URL> [SECRET]
 *
 * Esempi:
 *   node scripts/telegram-webhook.mjs 123456:ABC-DEF https://miosito.it/api/telegram/webhook
 *   node scripts/telegram-webhook.mjs 123456:ABC-DEF https://miosito.it/api/telegram/webhook $(openssl rand -hex 32)
 *
 * Il SECRET (opzionale ma raccomandato) va messo anche in .env.local come
 * TELEGRAM_WEBHOOK_SECRET: il webhook lo confronta con l'header
 * x-telegram-bot-api-secret-token che Telegram aggiunge a ogni chiamata.
 *
 * Senza argomenti: mostra lo stato attuale (getWebhookInfo).
 */
import { setWebhook, deleteWebhook, getWebhookInfo } from "../src/lib/telegram.ts";

const [token, url, secret] = process.argv.slice(2);

if (!token) {
  console.error("Uso: node scripts/telegram-webhook.mjs <BOT_TOKEN> <URL> [SECRET]");
  console.error("      node scripts/telegram-webhook.mjs <BOT_TOKEN> --status");
  process.exit(1);
}

if (!url || url === "--status") {
  const info = await getWebhookInfo(token);
  console.log("Stato webhook:", JSON.stringify(info, null, 2));
  if (info.last_error_message) console.log("\n⚠ Ultimo errore Telegram:", info.last_error_message);
  if (url !== "--status") {
    console.log("\nPer registrare: node scripts/telegram-webhook.mjs <BOT_TOKEN> <URL> [SECRET]");
    console.log("Per rimuovere:  node scripts/telegram-webhook.mjs <BOT_TOKEN> --delete");
  }
  process.exit(0);
}

if (url === "--delete") {
  const r = await deleteWebhook(token);
  console.log("Webhook rimosso:", JSON.stringify(r));
  process.exit(0);
}

if (!url.startsWith("https://")) {
  console.error("L'URL deve essere HTTPS (requisito dell'API Telegram per i webhook).");
  console.error("In sviluppo locale senza HTTPS usa TELEGRAM_POLLING=1 (vedi README).");
  process.exit(1);
}

const r = await setWebhook(token, url, secret ?? null);
console.log("Webhook impostato:", JSON.stringify(r));
if (secret) {
  console.log(`\nSegna questo secret in .env.local (server):\n  TELEGRAM_WEBHOOK_SECRET=${secret}`);
}
console.log("\nVerifica con: node scripts/telegram-webhook.mjs " + token + " --status");
