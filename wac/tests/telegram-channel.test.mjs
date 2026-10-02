/**
 * CANALE TELEGRAM — le funzioni pure verificate dove vivono.
 *
 * Import diretto del .ts (Node ≥22.6 type stripping), come gli altri test
 * del repo: niente costanti duplicate, la regressione si vede qui.
 * Le funzioni di rete (sendMessage, setWebhook…) NON sono testate: fanno
 * I/O verso l'API Telegram e il loro fallback è best-effort per design.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/telegram.ts");
const {
  TELEGRAM_MESSAGE_MAX,
  extractMessage,
  escapeHtml,
  formatForTelegram,
  chunkText,
  getTelegramConfig,
} = m;

const priv = (over = {}) => ({
  update_id: 42,
  message: {
    text: "ciao",
    from: { first_name: "Maria", username: "maria_h", language_code: "it" },
    chat: { id: 555000111, type: "private", first_name: "Maria", username: "maria_h" },
    ...over,
  },
  ...{},
});

test("extractMessage: chat privata con testo → messaggio completo", () => {
  const msg = extractMessage(priv());
  assert.ok(msg);
  assert.equal(msg.updateId, 42);
  assert.equal(msg.chat.id, "555000111");
  assert.equal(msg.chat.kind, "private");
  assert.equal(msg.text, "ciao");
  assert.equal(msg.firstName, "Maria");
  assert.equal(msg.username, "maria_h");
});

test("extractMessage: gruppo e canale fuori policy (il bot non risponde in gruppo)", () => {
  assert.equal(extractMessage(priv({ chat: { id: -100, type: "group" } })), null);
  assert.equal(extractMessage(priv({ chat: { id: -1000, type: "supergroup" } })), null);
  assert.equal(extractMessage(priv({ chat: { id: -1001234, type: "channel" } })), null);
});

test("extractMessage: edit, post e messaggi senza testo ignorati", () => {
  assert.equal(extractMessage({ update_id: 1, edited_message: priv().message }), null);
  assert.equal(extractMessage({ update_id: 1, channel_post: { text: "x", chat: { id: 1, type: "channel" } } }), null);
  assert.equal(extractMessage(priv({ text: "   " })), null);
  assert.equal(extractMessage({ update_id: "no" }), null);
  assert.equal(extractMessage(null), null);
});

test("escapeHtml: &, <, > protetti (l'HTML di Telegram non si rompe col testo del cliente)", () => {
  assert.equal(escapeHtml("a < b & c > d"), "a &lt; b &amp; c &gt; d");
});

test("formatForTelegram: **grassetto** diventa <b>, il resto markdown pesante sparisce", () => {
  const { html, plain } = formatForTelegram("**Prezzi**: sito vetrina da 800€\n## Titolo\n[link](https://x.it)");
  assert.equal(html, "<b>Prezzi</b>: sito vetrina da 800€\nTitolo\nlink (https://x.it)");
  assert.equal(plain, "Prezzi: sito vetrina da 800€\nTitolo\nlink (https://x.it)");
});

test("formatForTelegram: il testo con < > & viene escapato MA il grassetto resta tag", () => {
  const { html } = formatForTelegram("**a** <script> & b");
  assert.equal(html, "<b>a</b> &lt;script&gt; &amp; b");
});

test("chunkText: testo corto resta intero, testo lungo si spezza sotto il limite API", () => {
  assert.deepEqual(chunkText("breve"), ["breve"]);
  const long = Array.from({ length: 600 }, (_, i) => `riga ${i}`).join("\n");
  const parts = chunkText(long);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= TELEGRAM_MESSAGE_MAX);
  assert.equal(parts.join("\n"), long, "nessun carattere perso nello spezzo");
});

test("getTelegramConfig: senza token → null (canale spento, il webhook risponde telegram_off)", () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  try {
    assert.equal(getTelegramConfig(), null);
    process.env.TELEGRAM_BOT_TOKEN = "t";
    const cfg = getTelegramConfig();
    assert.equal(cfg.token, "t");
    assert.deepEqual(cfg.teamChatIds, []);
    assert.equal(cfg.webhookSecret, null);
    process.env.TELEGRAM_CHAT_ID = "1, 2 ,3";
    assert.deepEqual(getTelegramConfig().teamChatIds, ["1", "2", "3"]);
    process.env.TELEGRAM_WEBHOOK_SECRET = "  s3cr3t  ";
    assert.equal(getTelegramConfig().webhookSecret, "s3cr3t", "secret trimmato");
  } finally {
    if (saved !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
  }
});
