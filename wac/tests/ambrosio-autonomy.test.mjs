/**
 * AUTONOMIA AMBROSIO — le regole dei 3 livelli, verificate dove vivono.
 *
 * Il test importa DIRETTAMENTE `src/lib/ambrosio-autonomy.ts` (type
 * stripping di Node ≥22.6): nessuna costante duplicata, stessa filosofia
 * di tests/settings-status.test.mjs. Copre: accessi per livello, tetto
 * mosse con handoff, sanitizzazione documenti, parser proposta, e la
 * coerenza dei nomi tra layer puro e layer stati dell'hub.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auto = await import("../src/lib/ambrosio-autonomy.ts");
const {
  AMBROSIO_LEVELS,
  ACCESS_LABELS,
  accessList,
  accessAllowed,
  movesCapValidated,
  movesDecision,
  takeoverEnabled,
  sanitizeDoc,
  docsPromptBlock,
  parseProposalItems,
  parseProposalBlock,
  sanitizeProposalBody,
  levelLabel,
  PROPOSAL_TITLE_MAX,
  DOC_BODY_MAX,
} = auto;

test("accessi: L1 non ha tool, L2 la lista completa di qualifica, L3 eredita tutto e aggiunge la proposta", () => {
  assert.deepEqual(accessList(1), [], "L1 prende solo contatto: nessun accessorio");
  const l2 = accessList(2);
  for (const fn of ["salva_lead", "fissa_callback", "aggiorna_ticket", "nota_interna", "handoff", "cerca_cliente"]) {
    assert.ok(l2.includes(fn), `L2 sa fare ${fn}`);
  }
  assert.ok(!l2.includes("prepara_proposta"), "la proposta è solo di L3");
  const l3 = accessList(3);
  for (const fn of l2) assert.ok(l3.includes(fn), "chiusura per inclusione: L3 ha tutto L2");
  assert.ok(l3.includes("prepara_proposta"));
});

test("accessAllowed: il gate rifiuta tutto ciò che non è nella lista del livello", () => {
  assert.equal(accessAllowed(1, "salva_lead"), false);
  assert.equal(accessAllowed(2, "salva_lead"), true);
  assert.equal(accessAllowed(2, "prepara_proposta"), false);
  assert.equal(accessAllowed(3, "prepara_proposta"), true);
  assert.equal(accessAllowed(2, "funzione_inventata"), false);
});

test("tetto mosse: default 4, min 2, max 10, input corrotto normalizzato", () => {
  assert.equal(movesCapValidated(4), 4);
  assert.equal(movesCapValidated("7"), 7);
  assert.equal(movesCapValidated(1), 2, "sotto il minimo si torna al minimo");
  assert.equal(movesCapValidated(999), 10, "sopra il massimo si torna al massimo");
  assert.equal(movesCapValidated(NaN), 4);
  assert.equal(movesCapValidated(null), 4);
  assert.equal(movesCapValidated("abc"), 4);
});

test("mosse: dentro il tetto si risponde, al tetto si passa al team (handoff)", () => {
  const dentro = movesDecision(2, 4);
  assert.equal(dentro.allowed, true);
  assert.equal(dentro.handoff, false);
  assert.equal(dentro.used, 2);
  assert.equal(dentro.cap, 4);

  const alTetto = movesDecision(4, 4);
  assert.equal(alTetto.allowed, false, "a 4/4 la prossima risposta non è di Ambrosio");
  assert.equal(alTetto.handoff, true);
  assert.ok(alTetto.reason.includes("tetto"));

  const oltre = movesDecision(9, 4);
  assert.equal(oltre.allowed, false, "contatore andato oltre il tetto resta chiuso");
});

test("take-over SLA: solo livello 3 con lo switch attivo", () => {
  assert.equal(takeoverEnabled(3, true), true);
  assert.equal(takeoverEnabled(3, false), false, "l'umano può spegnere il take-over");
  assert.equal(takeoverEnabled(2, true), false, "L2 non subentra mai sulla SLA");
  assert.equal(takeoverEnabled(1, true), false);
});

test("documenti: sanitizzazione stretta, input vuoto rifiutato", () => {
  const buono = sanitizeDoc({ title: " Garanzia ", body: "12 mesi di correzioni.", category: "commerciale", lang: "en", priority: "3" });
  assert.ok(buono);
  assert.equal(buono.title, "Garanzia");
  assert.equal(buono.category, "commerciale");
  assert.equal(buono.lang, "en");
  assert.equal(buono.priority, 3);
  assert.equal(buono.active, true, "default attivo");

  assert.equal(sanitizeDoc({ title: "", body: "x" }), null, "titolo vuoto rifiutato");
  assert.equal(sanitizeDoc({ title: "x", body: "   " }), null, "corpo vuoto rifiutato");
  assert.equal(sanitizeDoc({}), null);

  const strano = sanitizeDoc({ title: "T", body: "B", category: "categoria_inventata", lang: "xx", priority: 9999 });
  assert.ok(strano);
  assert.equal(strano.category, "operativo", "categoria fuori lista → default");
  assert.equal(strano.lang, "it", "lingua fuori lista → default");
  assert.equal(strano.priority, 50, "priorità fuori scala → clamp");
});

test("documenti: il blocco prompt nomina la biblioteca solo a L3", () => {
  const docs = [{ title: "Politica garanzia", body: "12 mesi.", lang: "it", category: "commerciale" }];
  const l3 = docsPromptBlock(docs, 3);
  assert.ok(l3.includes("Politica garanzia"));
  assert.ok(l3.includes("come da nostro protocollo") || l3.includes("citare"), "L3 può citare la fonte");

  const l2 = docsPromptBlock(docs, 2);
  assert.ok(l2.includes("Politica garanzia"), "il contenuto arriva anche a L2 (nel prompt)");
  assert.ok(l2.includes("NON nominarle"), "a L2 la biblioteca resta interna");

  assert.equal(docsPromptBlock([], 3), "", "zero documenti → nessun blocco");
});

test("proposta: item parser tollerante (max 8, righe incomplete scartate)", () => {
  const items = parseProposalItems([
    { label: "Sito vetrina", price: "800 €" },
    { label: "SEO", price: "400 €/mese" },
    { label: "senza prezzo" },
    { price: "senza label" },
    "spazzatura",
    null,
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { label: "Sito vetrina", price: "800 €" });

  const tanti = parseProposalItems(Array.from({ length: 12 }, (_, i) => ({ label: `V${i}`, price: `${i} €` })));
  assert.equal(tanti.length, 8, "tetto di 8 voci");

  assert.equal(parseProposalItems(null).length, 0);
  assert.equal(parseProposalItems("no").length, 0);
});

test("proposta: il blocco <proposal> viene rimosso dalla risposta al cliente", () => {
  const reply = [
    "Ecco la proposta che preparo per il team.",
    "<proposal>",
    "TITOLO = Sito vetrina + SEO",
    "ITEM = Sito vetrina|800 €",
    "ITEM = SEO mensile|400 €/mese",
    "TESTO = Proposta senza impegno: consegna in 4 settimane, due revisioni incluse.",
    "</proposal>",
    "Dicono che vi chiamiamo entro domani.",
  ].join("\n");
  const { clean, proposal } = parseProposalBlock(reply);
  assert.ok(!clean.includes("<proposal>"), "il blocco non arriva al cliente");
  assert.ok(clean.includes("Ecco la proposta"));
  assert.ok(clean.includes("Dicono che vi chiamiamo"));
  assert.ok(proposal);
  assert.equal(proposal.title, "Sito vetrina + SEO");
  assert.equal(proposal.items.length, 2);
  assert.ok(proposal.body.startsWith("Proposta senza impegno"));

  const senza = parseProposalBlock("Risposta normale senza blocchi.");
  assert.equal(senza.proposal, null);
  assert.equal(senza.clean, "Risposta normale senza blocchi.");
});

test("proposta: titolo mancante o blocco malformato → nessuna proposta, testo pulito", () => {
  const { clean, proposal } = parseProposalBlock("<proposal>ITEM = A|1 €</proposal>");
  assert.equal(proposal, null, "senza TITOLO e TESTO il blocco è scartato");
  assert.ok(!clean.includes("ITEM"));

  const sanitizzato = sanitizeProposalBody("ok <script>alert(1)</script> <iframe src='x'></iframe>");
  assert.ok(!sanitizzato.includes("<script"));
  assert.ok(!sanitizzato.includes("<iframe"));
  assert.ok(sanitizzato.includes("&lt;script"), "i tag pericolosi sono neutralizzati, non eseguiti");

  const lungo = sanitizeProposalBody("x".repeat(PROPOSAL_TITLE_MAX + 500));
  assert.ok(lungo.length <= PROPOSAL_TITLE_MAX + 500, "il body sanitizzato non esplode (tetto gestito lato insert)");
  assert.ok(DOC_BODY_MAX > 0);
});

test("etichette: il nome del livello in hub e operatori usa lo stesso catalogo", () => {
  assert.equal(levelLabel(1), "L1 · Contatto");
  assert.equal(levelLabel(2), "L2 · Qualifica");
  assert.equal(levelLabel(3), "L3 · Proposta");
  assert.equal(AMBROSIO_LEVELS.length, 3);
  for (const l of AMBROSIO_LEVELS) {
    assert.ok(l.tagline.length > 10, `il livello ${l.level} ha una descrizione operativa`);
    assert.equal(levelLabel(l.level), l.name);
  }
  assert.ok(Object.keys(ACCESS_LABELS).length >= 7, "tutti gli accessi hanno una descrizione per la UI");
});

test("coerenza statica: il server layer e la route usano davvero il gate per livello", () => {
  // Sentinelle sul sorgente: il gate in runToolCall legge il livello, la
  // route lo imposta prima di rispondere, il cron imposta L3 nel take-over.
  const tools = readFileSync(new URL("../src/lib/ai-tools.ts", import.meta.url), "utf8");
  assert.ok(tools.includes("toolAllowedForLevel(call.fn)"), "runToolCall blocca i tool fuori dal livello");
  assert.ok(tools.includes("setToolLevel"), "il livello è impostabile dal chiamante");

  const cervello = readFileSync(new URL("../src/lib/ambrosio-turn.ts", import.meta.url), "utf8");
  assert.ok(cervello.includes("setToolLevel(auto.level)"), "il cervello (route web + Telegram) imposta il livello attivo prima del tool use");
  assert.ok(cervello.includes("movesDecision"), "il cervello applica il tetto mosse");
  assert.ok(cervello.includes("handoff"), "a tetto raggiunto la mano passa al team");

  const route = readFileSync(new URL("../src/app/api/chat/ai/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("handleAmbrosioTurn"), "la route web usa il cervello condiviso (nessuna logica duplicata)");

  const cron = readFileSync(new URL("../src/app/api/cron/tick/route.ts", import.meta.url), "utf8");
  assert.ok(cron.includes("claimSlaTakeoverCandidates"), "il cron prende i candidati take-over");
  assert.ok(cron.includes("takeoverEnabled"), "il take-over è gated dal livello e dallo switch");
  assert.ok(cron.includes("releaseTakeoverClaim"), "un take-over fallito rilascia il claim (mai a metà)");

  // Il parser dei tool deve essere TOLLERANTE (blocco con «;» finale, JSON
  // con fence) e il blocco grezzo non deve MAI raggiungere il testo cliente.
  assert.ok(tools.includes("function extractJsonObjects"), "recupero JSON per oggetti bilanciati (anche più chiamate in un blocco)");
  assert.ok(tools.includes("let clean = reply.replace(/<tool>[\\s\\S]*?<\\/tool>/g, \"\")"), "il blocco è rimosso dalla risposta qualunque sia l'esito del JSON (anche multi-blocco)");
  assert.ok(tools.includes("<tool>([\\s\\S]*)$"), "il blocco senza tag di chiusura viene comunque ripulito");

  // La migration deve avere le tre tabelle/colonne chiave.
  const mig = readFileSync(new URL("../neon/migrations/028-ambrosio-autonomy.sql", import.meta.url), "utf8");
  for (const needle of ["autonomy_level", "autonomy_moves_cap", "autonomy_takeover_sl", "ai_documents", "ai_proposals", "ai_takeover_at"]) {
    assert.ok(mig.includes(needle), `migration 028 contiene ${needle}`);
  }
});

test("chiave legacy: rimovibile e visibile senza segreti (difetto 401 perpetuo)", () => {
  const lib = readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
  // clearLegacyKey esiste e azzera il campo (la legacy SOVRASCRIVE la chiave
  // del primario nella catena: una invalida → 401 a ogni richiesta).
  assert.ok(lib.includes("export async function clearLegacyKey"), "clearLegacyKey esiste");
  assert.ok(lib.includes("api_key_enc = null"), "clearLegacyKey azzera api_key_enc");
  // Lo status per la UI NON espone la chiave, solo il provider a cui appartiene.
  assert.ok(lib.includes("getLegacyKeyStatus"), "stato legacy per la UI");
  assert.ok(!/legacyProvider[^;]*dec(?!ry)/.test(lib), "lo status non esponde la chiave decifrata");
  // La pagina provider mostra l'avviso e il percorso per rimuoverlo.
  const page = readFileSync(new URL("../src/app/admin/ai/provider/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("clearLegacyKeyAction"), "la pagina provider ha l'azione di rimozione");
  assert.ok(page.includes("Come provare il fallback"), "la pagina documenta come provare il fallback");
});

test("form di configurazione: avviso quando il salvataggio riusa la legacy di un altro provider", () => {
  const lib = readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
  // saveAiSettings calcola l'esito PRIMA di scrivere e lo restituisce alla UI.
  assert.ok(lib.includes("SaveAiSettingsOutcome"), "esito del salvataggio tipizzato per la UI");
  assert.ok(lib.includes("legacyRepurposed"), "rileva il riuso della legacy di un altro provider");
  // E il sync sulla card NON cancella più modello/base_url (difetto visto sul vivo).
  assert.ok(lib.includes("select model, base_url from ai_provider_keys"), "il sync conserva model/base_url della card");
  // L'azione traccia il riuso e la pagina di configurazione avvisa (banner + statico).
  const actions = readFileSync(new URL("../src/app/admin/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("ai.chiave-legacy-riusata"), "audit dedicato al riuso legacy");
  const config = readFileSync(new URL("../src/app/admin/ai/configurazione/page.tsx", import.meta.url), "utf8");
  assert.ok(config.includes("searchParams"), "il banner post-save arriva via query param");
  assert.ok(config.includes("sovrascrive quella salvata sulla card"), "banner post-save presente");
  assert.ok(config.includes("getLegacyKeyStatus"), "avviso statico con legacy esistente");
});

/* ── CRONOMETRO DI LATENZA (Inventario AI, ultime 24 ore) ───────────── */

const lat = await import("../src/lib/latency-shared.ts");

test("cronometro: media e p95 interpolato su un campione noto", () => {
  // Campione 1..10: media 5.5 → 5500 ms; p95 interpolato 9.55 → 9550 ms.
  const s = lat.latencyStats([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  assert.equal(s.count, 10);
  assert.equal(s.avgMs, 5500);
  assert.equal(s.p95Ms, 9550);
  // L'ordine d'arrivo è irrilevante.
  const shuffled = lat.latencyStats([10000, 1000, 5000, 3000, 7000, 2000, 9000, 4000, 6000, 8000]);
  assert.equal(shuffled.p95Ms, 9550);
});

test("cronometro: l'outlier è visibile al p95 e la media resta com'è", () => {
  // Nove risposte da 1 s + una da 30 s: la media (3.9 s) sta sotto soglia,
  // il p95 no: interpolazione lineare a pos 8.55 → 1000 + 29000*0.55 = 16950,
  // ben oltre i 5 s (il cliente vero l'ha aspettata). La media da sola avrebbe
  // nascosto il problema: è esattamente il difetto che il p95 rende visibile.
  const xs = [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 30000];
  const s = lat.latencyStats(xs);
  assert.equal(s.count, 10);
  assert.equal(s.avgMs, 3900);
  assert.equal(s.p95Ms, 16950);
  assert.equal(lat.latencyVerdict(s), "warn");
});

test("cronometro: verdetto ok/warn/alert sulla soglia di 5 secondi", () => {
  assert.equal(lat.LATENCY_ALERT_MS, 5000, "la soglia richiesta è 5 s");
  assert.equal(lat.latencyVerdict(lat.EMPTY_LATENCY), "ok", "nessun dato non è un problema");
  assert.equal(
    lat.latencyVerdict(lat.latencyStats([100, 200, 300, 400])),
    "ok",
    "tutto entro soglia",
  );
  // p95 sopra, media sotto: avviso (outlier, non norma).
  assert.equal(lat.latencyVerdict(lat.latencyStats([1000, 1000, 1000, 6000])), "warn");
  // Media sopra: allarme (lentezza diffusa).
  assert.equal(lat.latencyVerdict(lat.latencyStats([6000, 7000, 8000, 9000])), "alert");
});

test("cronometro: valori sporchi scartati, casi limite", () => {
  // Non numerici, negativi e non finiti vengono scartati prima del calcolo.
  const s = lat.latencyStats(["1200", 1500, null, undefined, -500, NaN, Infinity, 900]);
  assert.equal(s.count, 3);
  assert.equal(s.avgMs, 1200); // (1200 + 1500 + 900) / 3
  // Campione di uno: p95 = l'unico valore.
  assert.deepEqual(lat.latencyStats([4200]), { count: 1, avgMs: 4200, p95Ms: 4200 });
  // Campione vuoto o sporcissimo: EMPTY, verdict neutro.
  assert.deepEqual(lat.latencyStats([]), lat.EMPTY_LATENCY);
  assert.deepEqual(lat.latencyStats(["x", null, -1]), lat.EMPTY_LATENCY);
  assert.equal(lat.latencyVerdict(lat.EMPTY_LATENCY), "ok");
});

test("cronometro: la soglia vive SOLO nel layer condiviso (mai copiata inline)", () => {
  const page = readFileSync(new URL("../src/app/admin/ai/inventario/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("LATENCY_ALERT_MS"), "la pagina legge la soglia condivisa");
  assert.ok(!/5\s*_?000/.test(page), "nessun 5000 cablato nella pagina: la soglia non si duplica");
  // La lettura 24h degredisce da sola e usa il puro per il calcolo.
  const lib = readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
  assert.ok(lib.includes("getLatencyStats24h"), "lettura 24h esiste");
  assert.ok(lib.includes("interval '24 hours'"), "finestra 24 ore");
  assert.ok(lib.includes("latencyStats(rows.map"), "il calcolo usa il layer puro condiviso");
});
