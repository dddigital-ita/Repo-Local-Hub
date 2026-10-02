/**
 * GUARD DI SITO (Crema) — regole pure dell'outbound
 * multi-canale (Fase 5, step 5.1 del PIANO-FASE-5-DESK):
 * il primo messaggio di un ticket può partire su
 * WhatsApp (Graph API) o Telegram (Bot API), oltre che
 * via email. I payload Graph sono passi puri testati
 * qui (channel-outbound-pure.ts: ZERO import, la
 * convenzione del repo); il fetch è iniettabile (mock,
 * nessuna rete); le query su DB vivo (resolveAccount,
 * mirror nel thread, Bot API Telegram) sono coperte
 * dall'E2E.
 * Il gemello (Web Agency Salento) non ha l'outbound
 * social: NON copiare questo file, è perimetro Crema
 * (vedi AGENTS.md, voce «Solo Crema: channel-outbound»).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  GRAPH_API,
  META_TEXT_MAX,
  OUTBOUND_CHANNELS,
  buildGraphPayload,
  dispatchGraphOutbound,
  graphErrorDetail,
  isOutboundChannel,
  parseGraphResponse,
} from "../src/lib/channel-outbound-pure.ts";

const OUTBOUND_SRC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/lib/channel-outbound.ts",
  ),
  "utf8",
);
const ACTIONS_SRC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/app/admin/actions.ts",
  ),
  "utf8",
);
const NEW_TICKET_PAGE = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/app/admin/tickets/new/page.tsx",
  ),
  "utf8",
);

// —— Costanti: la lista dei canali è una regola, non una coincidenza ——

test("OUTBOUND_CHANNELS: whatsapp, telegram e i tre canali Meta (pronti, non ancora selezionabili)", () => {
  assert.deepEqual(OUTBOUND_CHANNELS, [
    "whatsapp",
    "telegram",
    "facebook",
    "instagram",
    "messenger",
  ]);
  assert.equal(GRAPH_API, "https://graph.facebook.com/v20.0");
  assert.equal(META_TEXT_MAX, 2000);
});

test("isOutboundChannel: i cinque canali sì, email/web/LinkedIn/no", () => {
  for (const c of OUTBOUND_CHANNELS) assert.equal(isOutboundChannel(c), true);
  assert.equal(isOutboundChannel("email"), false);
  assert.equal(isOutboundChannel("web"), false);
  assert.equal(isOutboundChannel("linkedin"), false);
  assert.equal(isOutboundChannel(""), false);
  assert.equal(isOutboundChannel(null), false);
});

// —— buildGraphPayload: un payload per canale, passi puri ——

test("payload WhatsApp: messaging_product, numero in cifre (senza «+»), tipo text", () => {
  const payload = buildGraphPayload("whatsapp", "+39 333 1234567", "Buongiorno");
  assert.deepEqual(payload, {
    messaging_product: "whatsapp",
    to: "393331234567",
    type: "text",
    text: { body: "Buongiorno" },
  });
});

test("payload WhatsApp: «to» non normalizzabile → null (meglio nessun invio che un numero sbagliato)", () => {
  assert.equal(buildGraphPayload("whatsapp", "+++", "ciao"), null);
  assert.equal(buildGraphPayload("whatsapp", "", "ciao"), null);
});

test("payload Meta (facebook/instagram/messenger): recipient + message", () => {
  for (const channel of ["facebook", "instagram", "messenger"]) {
    assert.deepEqual(buildGraphPayload(channel, "1000123456", "Ciao"), {
      recipient: { id: "1000123456" },
      message: { text: "Ciao" },
    });
  }
});

test("payload Telegram: null — la Bot API non è Graph, ha la sua strada", () => {
  assert.equal(buildGraphPayload("telegram", "12345", "ciao"), null);
});

// —— parseGraphResponse: provider_ref dalle due forme di risposta ——

test("risposta WhatsApp: provider_ref = wamid in messages[0].id", () => {
  assert.equal(
    parseGraphResponse("whatsapp", { messages: [{ id: "wamid.HBgL" }] }),
    "wamid.HBgL",
  );
  assert.equal(parseGraphResponse("whatsapp", {}), null);
  assert.equal(parseGraphResponse("whatsapp", { messages: [] }), null);
  assert.equal(parseGraphResponse("whatsapp", null), null);
});

test("risposta Meta: provider_ref = message_id", () => {
  assert.equal(
    parseGraphResponse("instagram", { message_id: "mid.$gA" }),
    "mid.$gA",
  );
  assert.equal(parseGraphResponse("messenger", {}), null);
});

// —— graphErrorDetail: il testo pensato per l'operatore ——

test("dettaglio errore Graph: preferisce error_user_msg, poi message, vuoto su spazzatura", () => {
  assert.equal(
    graphErrorDetail({ error: { message: "(#131047)", error_user_msg: "Messaggio non consentito" } }),
    "Messaggio non consentito",
  );
  assert.equal(
    graphErrorDetail({ error: { message: "(#131047) No approved template" } }),
    "(#131047) No approved template",
  );
  assert.equal(graphErrorDetail(null), "");
  assert.equal(graphErrorDetail("stringa"), "");
});

// —— dispatchGraphOutbound: fetch iniettabile, nessuna rete nei test ——

const ACCOUNT = {
  id: "acc-1",
  channel: "whatsapp",
  externalId: "1234567890",
  token: "TOKEN-SEGRETO",
};

test("dispatch WhatsApp: URL pinned {externalId}/messages, Bearer del token dell'account, payload corretto", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test-1" }] }) };
  };
  const res = await dispatchGraphOutbound(ACCOUNT, "whatsapp", "+393331234567", "Buongiorno", {
    fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.providerRef, "wamid.test-1");
  assert.equal(res.error, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GRAPH_API}/1234567890/messages`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer TOKEN-SEGRETO");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: "whatsapp",
    to: "393331234567",
    type: "text",
    text: { body: "Buongiorno" },
  });
});

test("dispatch WhatsApp: errore Graph → ok=false con status e dettaglio dell'API (torna all'operatore)", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: { message: "(#131047) No approved template", error_user_msg: "Messaggio non consentito" },
    }),
  });
  const res = await dispatchGraphOutbound(ACCOUNT, "whatsapp", "+393331234567", "ciao", {
    fetchImpl,
  });
  assert.equal(res.ok, false);
  assert.equal(res.providerRef, null);
  assert.match(res.error, /^graph_400/);
  assert.match(res.error, /Messaggio non consentito/);
});

test("dispatch: destinazione WhatsApp non normalizzabile → whatsapp_destinazione_non_valida (prima del fetch)", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const res = await dispatchGraphOutbound(ACCOUNT, "whatsapp", "+++", "ciao", { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error, "whatsapp_destinazione_non_valida");
  assert.equal(called, false); // nessuna richiesta partita
});

test("dispatch Telegram via Graph → telegram_non_e_graph (la Bot API è un'altra strada)", async () => {
  const res = await dispatchGraphOutbound(ACCOUNT, "telegram", "12345", "ciao");
  assert.equal(res.ok, false);
  assert.equal(res.error, "telegram_non_e_graph");
});

test("dispatch: fetch che tira (rete giù) → errore leggibile, non una throw", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const res = await dispatchGraphOutbound(ACCOUNT, "whatsapp", "+393331234567", "ciao", {
    fetchImpl,
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "network down");
});

// —— Split puro/impuro: il modulo con dipendenze è un thin layer ——

test("channel-outbound.ts: re-esporta i puri e tiene solo ciò che ha bisogno del DB/Bot API", () => {
  assert.match(OUTBOUND_SRC, /export \* from "\.\/channel-outbound-pure"/);
  // La parte impura: risoluzione account, mirror nel thread, Bot API, facciata.
  assert.match(OUTBOUND_SRC, /export async function resolveOutboundAccount/);
  assert.match(OUTBOUND_SRC, /export async function dispatchOutbound/);
  assert.match(OUTBOUND_SRC, /export async function sendOutbound/);
  // Il mirror nel thread usa la UNIQUE parziale di 040: lo stesso mid non entra due volte.
  assert.match(OUTBOUND_SRC, /on conflict \(channel_account_id, provider_ref\)/);
  assert.match(OUTBOUND_SRC, /where channel_account_id is not null and provider_ref is not null/);
  assert.match(OUTBOUND_SRC, /do nothing/);
});

// —— Wiring del form: selettore canale e bug fix body/bodyHtml ——

test("form «Nuovo ticket»: email/WhatsApp/Telegram selezionabili, Meta e LinkedIn disabilitati «in arrivo»", () => {
  for (const value of ["email", "whatsapp", "telegram"]) {
    assert.match(NEW_TICKET_PAGE, new RegExp(`<option value="${value}">`));
  }
  for (const label of ["Instagram", "Messenger", "Facebook", "LinkedIn"]) {
    assert.match(NEW_TICKET_PAGE, new RegExp(`<option disabled>${label} — in arrivo</option>`));
  }
  // L'avviso business-initiated è una decisione di design (Meta può
  // rifiutare il primo messaggio senza template): deve essere visibile.
  assert.match(NEW_TICKET_PAGE, /business-initiated/);
});

test("createTicketAction: il body deriva da bodyHtml quando il campo body è vuoto (bug dal commit eab3699)", () => {
  assert.match(ACTIONS_SRC, /bodyFromForm \|\| htmlToEmailText\(bodyHtmlRaw\)/);
  // Il contatto si valida PER CANALE: E.164 per WhatsApp.
  assert.match(ACTIONS_SRC, /toE164\(contact\)/);
  // Il ticket nasce col canale scelto, non sempre 'email'.
  assert.match(ACTIONS_SRC, /values \(\$1, 'open', \$2, \$3, \$4, \$5, \$6\)/);
  // E l'invio social passa per la facciata unica.
  assert.match(ACTIONS_SRC, /sendOutbound\(channel, contactHandle/);
});
