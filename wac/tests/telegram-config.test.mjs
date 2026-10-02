/**
 * CONFIG TELEGRAM — le regole di validazione verificate dove vivono.
 * Import diretto del .ts (Node ≥22.6 type stripping): validatori puri di
 * telegram-config-shared.ts, condivisi da server e pannello client.
 * La lettura/scrittura DB sta in telegram-config.ts (server-only).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/telegram-config-shared.ts");
const { isValidBotToken, isValidChatId, parseChatIds, chatIdsToCsv, TELEGRAM_TEST_MESSAGE } = m;

test("token bot: accetta il formato BotFather, rifiuta il resto", () => {
  assert.equal(isValidBotToken("1234567890:AAF3xyzABCdefGHIjklMNOpqrsTUVwxyz012345"), true);
  assert.equal(isValidBotToken("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"), true);
  assert.equal(isValidBotToken("no-token"), false);
  assert.equal(isValidBotToken("1234567890:"), false, "manca la parte segreta");
  assert.equal(isValidBotToken(""), false);
  assert.equal(isValidBotToken("12345:abc"), false, "troppo corto su entrambe le parti");
});

test("chat id: numerici (anche negativi) e @username, niente altro", () => {
  assert.equal(isValidChatId("555000111"), true);
  assert.equal(isValidChatId("-1001234567890"), true, "canale/supergruppo");
  assert.equal(isValidChatId("@nome_pubblico"), true);
  assert.equal(isValidChatId("ciao"), false);
  assert.equal(isValidChatId("12"), false, "troppo corto per essere reale");
  assert.equal(isValidChatId(""), false);
});

test("parseChatIds: trim, scarto vuoti, dedup — un solo punto di normalizzazione", () => {
  assert.deepEqual(parseChatIds(" 555000111, -100123 , 555000111 ,, @team "), ["555000111", "-100123", "@team"]);
  assert.deepEqual(parseChatIds(""), []);
  assert.deepEqual(parseChatIds("   "), []);
});

test("chatIdsToCsv: CSV normalizzato pronto per il salvataggio", () => {
  assert.equal(chatIdsToCsv(["555000111", "-100123", "555000111"]), "555000111,-100123");
});

test("il messaggio di prova dice cosa aspettarsi dal canale (notifiche + digest)", () => {
  assert.match(TELEGRAM_TEST_MESSAGE, /Test dalla scheda admin/);
  assert.match(TELEGRAM_TEST_MESSAGE, /digest serale/);
});
