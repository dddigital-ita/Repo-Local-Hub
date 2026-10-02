import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

/**
 * Sentinella del CHANNEL REGISTRY: migration ↔ codice, stessa
 * ricetta della sentinella client-type (038). Se qualcuno aggiunge
 * un canale a un solo lato (check SQL o lista CHANNELS), la suite
 * rompe qui prima che rompa il webhook.
 *
 * GEMELLO-PARI (byte-identica nei due repo): il check effettivo è
 * l'UNIONE dei vincoli delle migration — una migration già applicata
 * non si modifica mai, la lista si estende con una nuova migration
 * additiva. Crema: 040 (Fase 4) + 045 (facebook/linkedin); il
 * gemello: una sola 040 già completa. Stessa unione, stesso esito.
 */

const ROOT = process.cwd();
const TWIN_NAME = JSON.parse(readFileSync(path.join(ROOT, "twin-sync.json"), "utf8"))["twin-name"];
const gemelloPresente = existsSync(path.join(path.dirname(ROOT), TWIN_NAME, "package.json"));

test("la migration 040 esiste ed è idempotente/additiva", () => {
  const sql = readFileSync(path.join(ROOT, "neon", "migrations", "040-channel-accounts.sql"), "utf8");
  assert.match(sql, /create table if not exists channel_accounts/, "manca la tabella channel_accounts");
  assert.match(sql, /add column if not exists channel_account_id/, "manca channel_account_id su messages");
  assert.match(sql, /add column if not exists provider_ref/, "manca provider_ref su messages");
  assert.match(sql, /unique index[^;]*messages_provider_ref_unique[\s\S]*channel_account_id[\s\S]*provider_ref/, "manca la UNIQUE di idempotenza (account, provider_ref)");
});

test("la lista canali del codice è coperta dal check SQL (unione delle migration)", () => {
  const files = readdirSync(path.join(ROOT, "neon", "migrations"))
    .filter((f) => /channel/.test(f) && f.endsWith(".sql"));
  assert.ok(files.length > 0, "nessuna migration dei canali trovata");
  const nelDb = new Set();
  for (const f of files) {
    const sql = readFileSync(path.join(ROOT, "neon", "migrations", f), "utf8");
    for (const m of sql.matchAll(/channel in \(([^)]+)\)/g)) {
      for (const c of m[1].split(",")) nelDb.add(c.trim().replace(/'/g, ""));
    }
  }

  // Import del registry: file ESM puro senza dipendenze DB nel path della lista.
  const registry = readFileSync(path.join(ROOT, "src", "lib", "channel-registry.ts"), "utf8");
  const listMatch = registry.match(/export const CHANNELS = \[([^\]]+)\] as const/);
  assert.ok(listMatch, "manca CHANNELS nel registry");
  const nelCodice = listMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));

  for (const canale of nelCodice) {
    assert.ok(nelDb.has(canale), `il canale «${canale}» è nel codice ma NON nel check SQL delle migration`);
  }
  assert.ok(nelCodice.includes("web") && nelCodice.includes("email") && nelCodice.includes("whatsapp") && nelCodice.includes("telegram"), "i canali già vivi devono restare nel registry");
  assert.ok(nelCodice.includes("instagram") && nelCodice.includes("messenger"), "i canali social della Fase 4 devono essere predisposti");
  assert.ok(nelCodice.includes("facebook") && nelCodice.includes("linkedin"), "facebook e linkedin devono essere predisposti nel ticketing");
});

test("la firma webhook è HMAC-SHA256 col prefisso sha256= (schema Meta normalizzato)", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  const secret = "s3greto-di-prova";
  const body = JSON.stringify({ entry: [] });
  const attesa = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  assert.equal(mod.signWebhookBody(secret, body), attesa, "la firma deve essere HMAC-SHA256 sul corpo grezzo");
  // Deterministica: stessa materia → stessa firma.
  assert.equal(mod.signWebhookBody(secret, body), mod.signWebhookBody(secret, body));
});

test("l'adapter Meta estrae solo messaggi reali dell'account ricevente", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  // L'account non serve più al parser puro (external_id va diretto):
  // la variabile resterebbe inutilizzata — il filtro per account è nel test stesso.
  const payload = {
    entry: [
      {
        id: "1789",
        messaging: [
          { message: { mid: "m.1", text: "ciao, info?" }, sender: { id: "utente-1" }, timestamp: 1727700000000 },
          { message: { mid: "m.2", text: "eco", is_echo: true }, sender: { id: "1789" } }, // echo: fuori
          { message: { mid: "m.3", text: "altro" }, sender: { id: "utente-2" } },
        ],
      },
      { id: "ALTRO-ACCOUNT", messaging: [{ message: { mid: "m.4", text: "non mio" }, sender: { id: "x" } }] },
    ],
  };
  const msgs = mod.parseMetaInbound("1789", payload);
  assert.deepEqual(
    msgs.map((m) => m.providerRef),
    ["m.1", "m.3"],
    "devono passare solo i messaggi reali dell'account 1789 (no echo, no altri account)",
  );
  assert.equal(msgs[0].senderHandle, "utente-1");
  assert.equal(msgs[0].sentAt, new Date(1727700000000).toISOString());
  // external_id Meta: l'id dell'account ricevente (entry[].id).
  assert.equal(mod.metaExternalId(payload), "1789");
  assert.equal(mod.metaExternalId({ entry: [{ id: 42 }] }), "42");
  assert.equal(mod.metaExternalId({}), null);
});

test("l'adapter Telegram accetta solo chat private con testo", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  const ok = mod.parseTelegramInbound({ message: { message_id: 42, chat: { id: 555, type: "private", first_name: "Mario" }, text: "buongiorno", date: 1727700000 } });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].providerRef, "555:42");
  assert.equal(ok[0].senderHandle, "555");
  const gruppo = mod.parseTelegramInbound({ message: { message_id: 43, chat: { id: -100, type: "group" }, text: "no" } });
  assert.equal(gruppo.length, 0, "gruppi/canali fuori policy");
});

test("la route webhook resta gemello-pari (è FUORI manifest: le route non entrano nel twin-sync)", { skip: gemelloPresente ? false : "checkout gemello non raggiungibile" }, () => {
  // Il twin-sync.json non può contenere route (perimetro della
  // sentinella twin-sync: pagine/route mai condivise). Il core,
  // il registry e questa sentinella sono nel manifest e il
  // twin-sync li garantisce; la route — puro wiring DB/audit
  // sopra le funzioni condivise — resta identica PER DISCIPLINA
  // gemello-pari: si aggiorna in coppia e questo test la tiene
  // onesta finché il gemello è raggiungibile.
  const rel = "src/app/api/webhooks/[channel]/route.ts";
  assert.equal(
    readFileSync(path.join(ROOT, rel), "utf8"),
    readFileSync(path.join(path.dirname(ROOT), TWIN_NAME, rel), "utf8"),
    `DIVERGE: ${rel} — la route non è coperta dal twin-sync, aggiornarla in coppia`,
  );
});

test("la firma LinkedIn è HMAC-SHA256 di «hmacsha256=<corpo grezzo>» (hex nudo nell'header)", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  const secret = "client-secret-di-prova";
  const body = JSON.stringify({ events: [] });
  const attesa = createHmac("sha256", secret).update(`hmacsha256=${body}`, "utf8").digest("hex");
  assert.equal(mod.signLinkedInBody(secret, body), attesa, "il string-to-sign è «hmacsha256=» + corpo");
  assert.equal(mod.verifyLinkedInSignature(secret, body, attesa), true);
  assert.equal(mod.verifyLinkedInSignature(secret, body, `00${attesa.slice(2)}`), false, "firma alterata rifiutata");
  assert.equal(mod.verifyLinkedInSignature(secret, body, null), false, "header mancante rifiutato");
  // L'header X-LI-Signature contiene SOLO l'hex: il prefisso vive nel string-to-sign.
  assert.ok(!attesa.startsWith("hmacsha256="));
});

test("la challenge LinkedIn è hex(HMAC-SHA256(challengeCode, clientSecret))", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  const secret = "client-secret-di-prova";
  const code = "890e4665-4dfe-4ab1-b689-ed553bceeed0";
  const attesa = createHmac("sha256", secret).update(code, "utf8").digest("hex");
  assert.equal(mod.signLinkedInChallenge(code, secret), attesa);
  assert.equal(mod.signLinkedInChallenge(code, secret), mod.signLinkedInChallenge(code, secret), "deterministica");
});

test("l'adapter LinkedIn estrae solo azioni con testo e usa notificationId come provider_ref", async () => {
  const mod = await import(path.join(ROOT, "scripts", "channel-webhook-core.mjs"));
  const payload = {
    events: [
      {
        notificationId: 101,
        organizationalEntity: "urn:li:organization:1234",
        action: "COMMENT",
        lastModifiedAt: 1727700000000,
        decoratedGeneratedActivity: { owner: "urn:li:person:abc", text: "  Ottimo!  " },
      },
      { notificationId: 102, action: "LIKE", decoratedGeneratedActivity: { owner: "urn:li:person:x" } }, // no testo: fuori
      { notificationId: 103, action: "COMMENT", decoratedGeneratedActivity: { text: "senza owner" } }, // no owner: fuori
    ],
  };
  const msgs = mod.parseLinkedInInbound(payload);
  assert.deepEqual(msgs.map((m) => m.providerRef), ["101"], "notificationId è la chiave di dedup documentata");
  assert.equal(msgs[0].senderHandle, "abc", "il mittente è il person URN (id finale)");
  assert.equal(msgs[0].text, "Ottimo!", "il testo è trimmato");
  assert.equal(msgs[0].sentAt, new Date(1727700000000).toISOString());
  // external_id LinkedIn: l'URN dell'organizzazione.
  assert.equal(mod.linkedinExternalId(payload), "urn:li:organization:1234");
  assert.equal(mod.linkedinExternalId({ events: [{ action: "LIKE" }] }), null);
  // Batch anche come array al top level (documentazione LinkedIn).
  assert.equal(mod.parseLinkedInInbound([payload.events[0]]).length, 1);
});
