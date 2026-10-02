/**
 * EMOJI DELLA CHAT — il set configurabile dell'admin, verificato dove vive.
 *
 * Il test importa DIRETTAMENTE `src/lib/settings-status.ts` (regole pure)
 * e PARSA i file reali (tickets.ts, actions.ts, Chat.tsx, consulenza
 * page, scheda admin) per sentinelle di coerenza: nessuna costante
 * duplicata senza guardia, come il test di contrasto.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readSource } from "./helpers/source.mjs";

const m = await import("../src/lib/settings-status.ts");
const { chatEmojisStatus, hubSummary } = m;

// Lettura senza commenti (tests/helpers/source.mjs): le asserzioni cadono
// sul CODICE, mai su un commento — il difetto che ha accecato la sentinella
// `size: "invisible"` del widget fino al commit ca52657.
const read = (p) => readSource(p).code;

const DEFAULT_EMOJIS = ["😀", "👍", "🔥"];

test("emoji chat: set predefinito → grigio «Predefinite» con conteggio", () => {
  const s = chatEmojisStatus(DEFAULT_EMOJIS, DEFAULT_EMOJIS);
  assert.equal(s.ok, false);
  assert.equal(s.warn, false); // mai ambra: il default è una scelta, non un'action dovuta
  assert.equal(s.label, "Predefinite");
  assert.deepEqual(s.counts, [{ n: 3, label: "emoji" }]);
});

test("emoji chat: set personalizzato → verde «Personalizzate»", () => {
  const s = chatEmojisStatus(["🚀", "🎯"], DEFAULT_EMOJIS);
  assert.equal(s.ok, true);
  assert.equal(s.warn, false);
  assert.equal(s.label, "Personalizzate");
});

test("emoji chat: l'ordine conta (stesso set, ordine diverso = personalizzato)", () => {
  const s = chatEmojisStatus([...DEFAULT_EMOJIS].reverse(), DEFAULT_EMOJIS);
  assert.equal(s.ok, true);
});

test("emoji chat: un set vuoto salvato non arriva mai allo status — la lettura degrada sul default", () => {
  // Guardia in getChatEmojis (sentinella su tickets.ts): list.length ? list : default.
  // Lo status puro, se mai ricevesse [], segnala «Personalizzato» (testo ≠ default):
  // è il comportamento onesto della funzione, irraggiungibile nel flusso reale.
  const s = chatEmojisStatus([], DEFAULT_EMOJIS);
  assert.equal(s.ok, true);
  assert.deepEqual(s.counts, [{ n: 0, label: "emoji" }]);
});

test("emoji chat: entra nel riepilogo hub senza spostare l'ambra (warn sempre false)", () => {
  const summary = hubSummary([chatEmojisStatus(DEFAULT_EMOJIS, DEFAULT_EMOJIS)]);
  assert.equal(summary.ok, true); // grigio non genera azioni attese
});

// ── Sentinelle di coerenza sui file reali ──────────────────────────

test("tickets.ts: chiave, max e default dell'emoji chat esistono e sono allineati", () => {
  const src = read("src/lib/tickets.ts");
  assert.match(src, /CHAT_EMOJIS_KEY = "chat_emoji_picker"/);
  assert.match(src, /CHAT_EMOJIS_MAX = 24/);
  assert.match(src, /export async function getChatEmojis\(/);
  // La lettura degrada sul default, mai su un vuoto muto.
  assert.match(src, /return list\.length \? list : \[\.\.\.CHAT_EMOJIS_DEFAULT\]/);
  // Validazione: cap in code point, non caratteri UTF-16.
  assert.match(src, /\[\.\.\.x\]\.length <= 8/);
});

test("actions.ts: saveChatEmojis riusa la stessa disciplina di saveQuickReplies", () => {
  const src = read("src/app/admin/actions.ts");
  assert.match(src, /export async function saveChatEmojis\(/);
  // niente scritture superflue: confronto col corrente prima dell'upsert
  assert.match(src, /JSON\.stringify\(list\) === JSON\.stringify\(current\)/);
  // audit con chiave dedicata (mai riuso dell'azione risposte-rapide)
  assert.match(src, /logAudit\(user\.email, "chat\.emoji"/);
  // revalidate della scheda e dell'hub
  assert.match(src, /revalidatePath\("\/admin\/settings\/emoji-chat"\)/);
});

test("Chat.tsx: DEFAULT_EMOJIS è sincronizzato con CHAT_EMOJIS_DEFAULT di tickets.ts", () => {
  const tickets = read("src/lib/tickets.ts");
  const chat = read("src/components/chat/Chat.tsx");
  const block = tickets.match(/CHAT_EMOJIS_DEFAULT = \[([\s\S]*?)\] as const/);
  assert.ok(block, "CHAT_EMOJIS_DEFAULT non trovato in tickets.ts");
  const inTickets = [...block[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(inTickets.length >= 20, "il set predefinito deve restare ricco");
  const block2 = chat.match(/const DEFAULT_EMOJIS = \[([\s\S]*?)\];/);
  assert.ok(block2, "DEFAULT_EMOJIS non trovato in Chat.tsx");
  const inChat = [...block2[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(inChat, inTickets, "i due set devono restare identici: allineali o centralizza");
});

test("Chat.tsx: il picker usa il set della prop con fallback sul default", () => {
  const chat = read("src/components/chat/Chat.tsx");
  assert.match(chat, /emojis\?: string\[\]/);
  assert.match(chat, /emojis\?\.length \? emojis : DEFAULT_EMOJIS/);
});

test("consulenza: la pagina passa le emoji dal layer dati al componente", () => {
  const page = read("src/app/consulenza/page.tsx");
  assert.match(page, /getChatEmojis\(\)/);
  assert.match(page, /emojis=\{emojis\}/);
});

test("hub impostazioni: card, scheda admin e command palette registrate", () => {
  const hub = read("src/app/admin/settings/page.tsx");
  assert.match(hub, /href="\/admin\/settings\/emoji-chat"/);
  assert.match(hub, /chatEmojis\.counts\.map/);
  assert.match(read("src/app/admin/settings/emoji-chat/page.tsx"), /ChatEmojiEditor/);
  assert.match(
    read("src/lib/admin-destinations.ts"),
    /\/admin\/settings\/emoji-chat.*Emoji della chat/,
  );
  // La card vive nella sezione Canali (spostata da Ticketing il 2026-10-02):
  // la chat pubblica è un mezzo con cui l'agenzia parla, non una regola del team.
  const canali = hub.slice(hub.indexOf('title="Canali"'), hub.indexOf('title="Protezione"'));
  assert.match(canali, /href="\/admin\/settings\/emoji-chat"/, "la card emoji deve stare nella sezione Canali");
  const ticketing = hub.slice(hub.indexOf('title="Ticketing"'), hub.indexOf('title="Canali"'));
  assert.doesNotMatch(ticketing, /emoji-chat/, "la card emoji non deve più stare in Ticketing");
});

test("settings-status-server: lo stato emoji vive nel layer server (mai inline nella pagina)", () => {
  const server = read("src/lib/settings-status-server.ts");
  assert.match(server, /chatEmojisStatus\(emojisRaw/);
  assert.match(server, /getChatEmojis\(\)\.catch\(\(\) => CHAT_EMOJIS_DEFAULT\)/);
});

test("cloudflare: l'hub legge l'ultimo test dal layer server e la card lo stampa come meta", () => {
  // Reader: l'esito dell'ultimo «Prova verifica» entra in cloudflareStatus.
  const server = read("src/lib/settings-status-server.ts");
  assert.match(server, /getLastTurnstileTest\(\)\.catch/, "la lettura audit degredisce a null (mai eseguito)");
  assert.match(server, /lastTestOk: turnstileTest\.lastTestOk/);
  // Hub: la card Cloudflare renderizza le meta accanto alla pill.
  const hub = read("src/app/admin/settings/page.tsx");
  assert.match(hub, /cloudflare\.meta \?\? \[\]/);
  // Pure: la funzione produce la meta, con esito e data corta.
  const pure = read("src/lib/settings-status.ts");
  assert.match(pure, /Ultimo test OK · /);
  assert.match(pure, /Ultimo test fallito · /);
});

// ── Picker frimousse: dataset locale, ricerca e anteprima ─────────

test("Chat.tsx: il picker è frimousse, con dataset locale e nessun CDN", () => {
  const chat = read("src/components/chat/Chat.tsx");
  // Il pacchetto è quello giusto e il dataset è risolto localmente:
  // il resolver di default scaricherebbe Emojibase da jsdelivr a runtime.
  assert.match(chat, /from "frimousse"/);
  assert.match(chat, /resolveEmojiData=\{\(\) => emojiData\}/);
  assert.doesNotMatch(chat, /emojibaseUrl/, "mai emojibaseUrl: forzerebbe il fetch a CDN");
  assert.match(chat, /chatEmojiData\(emojis\)/);
  // Ricerca e anteprima: le parti frimousse sono tutte montate.
  assert.match(chat, /FrimousseEmojiPicker\.Search/);
  assert.match(chat, /FrimousseEmojiPicker\.ActiveEmoji/);
  // Il picker si monta solo quando è aperto: il dataset segue il set admin.
  assert.match(chat, /\{emojiOpen && \(/);
});

test("chat-emoji-data.ts: il catalogo admin copre tutte le predefinite con label e tag", async () => {
  // Il catalogo (/admin/settings/emoji-chat) e il picker pubblico condividono
  // la stessa fonte: ogni predefinita deve esserci, cercabile in italiano.
  const { CHAT_EMOJI_CATALOG, chatEmojiData } = await import("../src/components/chat/chat-emoji-data.ts");
  const fallback = chatEmojiData([]); // il fallback sono le predefinite
  const defaulti = fallback.emojis.map((e) => e.emoji);
  const nelCatalogo = new Set(CHAT_EMOJI_CATALOG.map((c) => c.emoji));
  for (const emoji of defaulti) {
    assert.ok(nelCatalogo.has(emoji), `${emoji} è nel picker predefinito ma non nel catalogo admin`);
  }
  assert.ok(
    CHAT_EMOJI_CATALOG.every((c) => c.label.length > 0 && c.tags.length > 0),
    "ogni voce del catalogo serve label e tag per la ricerca",
  );
});

test("chat-emoji-editor: catalogo con ricerca, riordino righe e anteprima live", () => {
  const editor = read("src/components/chat-emoji-editor.tsx");
  // Il catalogo viene dal modulo condiviso col picker (una cura, due posti).
  assert.match(editor, /CHAT_EMOJI_CATALOG/);
  assert.match(editor, /from "@\/components\/chat\/chat-emoji-data"/);
  // Ricerca case/accent-insensitive su label e tag.
  assert.match(editor, /normalize\(/);
  assert.match(editor, /aria-multiselectable/);
  // Label italiana VISIBILE sotto ogni emoji (griglia allargata):
  // la cella non è più quadrata 3rem e la label troncata non è sr-only.
  assert.match(editor, /minmax\(4\.5rem,1fr\)/, "il catalogo mostra le label: celle più larghe");
  assert.match(editor, /max-w-full truncate/, "la label è visibile (troncata), non sr-only");
  // Tooltip esteso: label + le tag che guidano la ricerca.
  assert.match(editor, /c\.tags\.join\(", "\)/);
  // Riordino: l'ordine del set è il menu dei visitatori.
  assert.match(editor, /function move\(/);
  assert.match(editor, /Sposta su l'emoji/);
  // Anteprima del picker nell'ordine corrente.
  assert.match(editor, /Anteprima del picker/);
});

test("chat-emoji-editor: «Ripristina predefinite» riempie le righe col canone in un click", () => {
  const editor = read("src/components/chat-emoji-editor.tsx");
  const page = read("src/app/admin/settings/emoji-chat/page.tsx");
  // Il canone arriva come prop dalla Server Component: il client
  // NON importa lib/tickets (layer DB — mai nel bundle browser).
  assert.match(editor, /defaults: readonly string\[\]/);
  assert.doesNotMatch(editor, /from "@\/lib\/tickets"/, "il client non importa il layer DB");
  // Un click, nessun merge: il set torna interamente al default
  // (con il cap max, anche se il canone crescesse oltre).
  assert.match(editor, /function restoreDefaults\(\)/);
  assert.match(editor, /setRows\(defaults\.slice\(0, max\)\)/);
  // Il blocco del pulsante: type=button (riempie SENZA salvare),
  // onClick sulla funzione, icona di restore e label italiana.
  const i = editor.indexOf("Ripristina predefinite");
  assert.ok(i > 0, "label «Ripristina predefinite» non trovata");
  // Blocco intero del pulsante (dalla sua apertura alla label):
  // una finestra fissa sarebbe accecata dal className lungo.
  const btnBlock = editor.slice(editor.lastIndexOf("<button", i), i);
  assert.match(btnBlock, /type="button"/, "il ripristino non deve fare submit");
  assert.match(btnBlock, /onClick=\{restoreDefaults\}/);
  assert.match(btnBlock, /RotateCcw/);
  // La pagina passa il canone: una fonte sola (tickets.ts).
  assert.match(page, /defaults=\{CHAT_EMOJIS_DEFAULT\}/);
  // defaultCount sostituita dal set, non duplicata.
  assert.doesNotMatch(editor, /defaultCount/);
  assert.doesNotMatch(page, /defaultCount/);
});

test("chat-emoji-data.ts: dataset derivato dal set admin, mai vuoto, tag IT", async () => {
  const { chatEmojiData } = await import("../src/components/chat/chat-emoji-data.ts");
  const data = chatEmojiData(["🚀", "🎯", "✨"]);
  assert.equal(data.locale, "it");
  assert.equal(data.emojis.length, 3);
  // L'ordine del set admin è preservato: è il menu che vedono i visitatori.
  assert.deepEqual(data.emojis.map((e) => e.emoji), ["🚀", "🎯", "✨"]);
  // Ogni voce ha label e tag per la ricerca.
  assert.ok(data.emojis.every((e) => e.label.length > 0 && e.tags.length > 0));
  assert.ok(data.emojis.every((e) => e.category === 0));
  // Una categoria sola, che il CSS fissa in cima alla viewport.
  assert.deepEqual(data.categories, [{ index: 0, label: "Scelte per te" }]);
  // Set vuoto: il dataset non è mai vuoto (frimousse mostrerebbe solo «Nessun risultato»).
  const fallback = chatEmojiData([]);
  assert.ok(fallback.emojis.length >= 20);
  // Emoji fuori catalogo (aggiunta dall'admin): non rompe il dataset.
  const custom = chatEmojiData(["🦄"]);
  assert.equal(custom.emojis[0].emoji, "🦄");
  assert.ok(custom.emojis[0].label.length > 0);
});
