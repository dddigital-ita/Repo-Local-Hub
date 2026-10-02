/**
 * COERENZA SCHEDA CLIENTE ↔ LEAD COLLEGATO — le regole di composizione
 * dell'identità, verificate dove vivono.
 *
 * La scheda cliente NON copia i dati del lead: li deriva con regole pure
 * che vivono in `src/lib/clients-shared.ts` (zero import, il taglio del
 * repo per i layer testabili — vedi settings-status.ts). Il test le
 * importa DIRETTAMENTE: nessuna costante duplicata, le decisioni sono
 * verificate dove vivono davvero.
 *
 *  - TELEFONO: `toE164Pure` normalizza lead.phone / lead.wa_phone nello
 *    stesso E.164 che fa da chiave di dedup — lo stesso numero su canali
 *    diversi è UN cliente; `identityPhonePure` decide la priorità
 *    wa_phone > lead_phone (fonte più stabile dell'identità);
 *  - BUDGET: `withBudgetTotal` somma il MASSIMO di ogni voce dichiarata —
 *    il «~N € dichiarati» che la scheda di Giulia mostrava coerente con
 *    «1.000–3.000 €» scritto in chat è derivato qui;
 *  - NOME: `resolveClientNamePure` decide la priorità lead > header email
 *    > locale dell'indirizzo — la scheda mostra il nome del lead quando
 *    esiste, non il pezzo prima della @ di una email;
 *  - il modulo server `clients.ts` deve usare QUELLE regole, non copie
 *    locali (sentinelle statiche sul sorgente).
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shared = await import("../src/lib/clients-shared.ts");
const { toE164Pure, identityPhonePure, withBudgetTotal, byBudgetDesc, resolveClientNamePure, normEmailPure } = shared;

/* ── telefono: la chiave di identità ─────────────────────────────── */

test("il telefono della scheda è l'E.164 del lead: stessa normalizzazione del dedup", () => {
  // Formati diversi con cui un lead può arrivare (web, WhatsApp, import):
  // tutti DEVErano finire nello stesso E.164, o il dedup rompe l'identità.
  assert.equal(toE164Pure("+39 333 9876543"), "+393339876543");
  assert.equal(toE164Pure("3339876543"), "+393339876543");
  assert.equal(toE164Pure("+393339876543"), "+393339876543");
});

test("numeri non normalizzabili diventano null: meglio nessun dedup che uno sbagliato", () => {
  assert.equal(toE164Pure(""), null);
  assert.equal(toE164Pure("abc"), null);
  assert.equal(toE164Pure("123"), null); // troppo corto
  assert.equal(toE164Pure(null), null);
});

test("wa_phone ha la priorità su lead.phone (fonte più stabile dell'identità)", () => {
  assert.equal(identityPhonePure("+393339876543", "3331234567"), "+393339876543");
  // fallback: senza wa_phone il lead.phone basta (web chat)
  assert.equal(identityPhonePure(null, "3331234567"), "+393331234567");
  // senza nessuno: null (la scheda resterà senza telefono, mai inventato)
  assert.equal(identityPhonePure(null, null), null);
});

/* ── budget: il «~N € dichiarati» della scheda ───────────────────── */

const base = { budgets: null };

test("«1.000–3.000 €» dichiarato in chat → ~3000 € nella scheda (il massimo è il segnale)", () => {
  const r = withBudgetTotal({ ...base, budgets: ["1.000-3.000 euro"] });
  assert.equal(r.budget_total, 3000);
});

test("più lead: la scheda somma il tetto di ogni voce (il budget è cumulativo)", () => {
  const r = withBudgetTotal({ ...base, budgets: ["1.000-3.000 euro", "fino a 1.500"] });
  assert.equal(r.budget_total, 4500);
});

test("numeri troppo piccoli (anni, cifre sporche) e «poco/molto» non contano come budget", () => {
  assert.equal(withBudgetTotal({ ...base, budgets: ["poco"] }).budget_total, null);
  assert.equal(withBudgetTotal({ ...base, budgets: ["2024"] }).budget_total, null); // sotto 50
  assert.equal(withBudgetTotal({ ...base, budgets: ["5000001 euro"] }).budget_total, null); // sopra il tetto: quasi sicuro un telefono
});

test("senza budget il campo resta null: la scheda non stampa «0 € dichiarati»", () => {
  assert.equal(withBudgetTotal({ ...base, budgets: null }).budget_total, null);
  assert.equal(withBudgetTotal({ ...base, budgets: [] }).budget_total, null);
  assert.equal(withBudgetTotal({ ...base, budgets: [null] }).budget_total, null);
});

test("separatore delle migliaia (2.500 / 1.500) non altera il totale", () => {
  assert.equal(withBudgetTotal({ ...base, budgets: ["2.500€"] }).budget_total, 2500);
  assert.equal(withBudgetTotal({ ...base, budgets: ["1.500"] }).budget_total, 1500);
});

/* ── nome: la priorità del sync ──────────────────────────────────── */

test("il nome del lead vince sempre (la scheda mostra Giulia, non giulia@…)", () => {
  assert.equal(resolveClientNamePure("Giulia", "Header Name", "giulia@esempio.it"), "Giulia");
  assert.equal(resolveClientNamePure("Giulia   ", null, null), "Giulia"); // trim
});

test("senza lead: header email, poi parte locale dell'indirizzo (rete di sicurezza)", () => {
  assert.equal(resolveClientNamePure(null, "Paola Rossi", "paola.rossi@esempio.it"), "Paola Rossi");
  assert.equal(resolveClientNamePure(null, null, "paola.rossi@esempio.it"), "paola rossi");
  assert.equal(resolveClientNamePure(null, null, null), null);
});

test("email normalizzata: minuscola e validata, o null (chiave di dedup affidabile)", () => {
  assert.equal(normEmailPure("  Paola.Rossi@Esempio.IT "), "paola.rossi@esempio.it");
  assert.equal(normEmailPure("non una email"), null);
  assert.equal(normEmailPure(null), null);
});

/* ── sentinelle: il modulo server usa QUELLE regole, non copie ───── */

const SERVER_SRC = readFileSync(new URL("../src/lib/clients.ts", import.meta.url), "utf8");

test("clients.ts importa le regole dal layer condiviso (nessuna copia locale)", () => {
  assert.match(SERVER_SRC, /from "\.\/clients-shared"/);
  assert.doesNotMatch(SERVER_SRC, /function normEmail\(/, "normEmail duplicata in clients.ts");
  assert.doesNotMatch(SERVER_SRC, /export function withBudgetTotal\(c: ClientRow\)/, "withBudgetTotal duplicata in clients.ts");
  assert.doesNotMatch(SERVER_SRC, /const EMAIL_RE/, "EMAIL_RE duplicata in clients.ts");
});

test("l'update del cliente «completa ma non distrugge»: coalesce sui campi identità", () => {
  // Un campo assente in un ticket nuovo NON cancella ciò che si sapeva:
  // è la regola che mantiene nome/telefono/email coerenti tra i canali.
  assert.match(SERVER_SRC, /name = coalesce\(clients\.name, \$2\)/);
  assert.match(SERVER_SRC, /email_norm = coalesce\(clients\.email_norm, \$3\)/);
  assert.match(SERVER_SRC, /last_seen_at = greatest\(clients\.last_seen_at, \$6\)/);
});

test("il dedup cerca prima il telefono poi l'email: identità stabile > contatto smarrito", () => {
  const phoneIdx = SERVER_SRC.indexOf("select id from clients where phone_e164 = $1");
  const emailIdx = SERVER_SRC.indexOf("select id from clients where email_norm = $1");
  assert.ok(phoneIdx !== -1 && emailIdx !== -1);
  assert.ok(phoneIdx < emailIdx, "il dedup deve preferire il telefono all'email");
});

/* ── ordine del portafoglio: budget più alto prima ───────────────── */

test("«Budget: più alto prima»: con budget davanti in ordine decrescente, senza budget dopo (stabile)", () => {
  const rows = [
    { name: "senza", budget_total: null },
    { name: "grande", budget_total: 4500 },
    { name: "piccolo", budget_total: 800 },
    { name: "medio", budget_total: 1500 },
  ];
  const sorted = [...rows].sort(byBudgetDesc);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["grande", "medio", "piccolo", "senza"],
  );
});

test("listClients applica l'ordinamento solo con sort=budget (scelta esplicita, non default)", () => {
  assert.match(SERVER_SRC, /sort === "budget" \? clients\.sort\(byBudgetDesc\) : clients/);
  assert.match(SERVER_SRC, /byBudgetDesc,/); // importato dal layer condiviso, non copiato
});

test("la pagina lista espone chip e colonna del budget (searchParam ordina, blocco card)", () => {
  const page = readFileSync(new URL("../src/app/admin/clients/page.tsx", import.meta.url), "utf8");
  assert.match(page, /ordina === "budget"/);
  assert.match(page, /ordina=budget/); // il link che attiva
  assert.match(page, /Budget dichiarato/); // la colonna della card
  assert.match(page, /aria-pressed=\{byBudget\}/); // stato accessibile
});

test("il KPI del portafoglio somma con la regola condivisa: mai uno 0 finto senza DB", () => {
  // La somma riusa withBudgetTotal (estrazione testata) e in errore
  // torna null — la pagina mostra «—», non uno zero che sembrerebbe dato.
  const lib = readFileSync(new URL("../src/lib/clients.ts", import.meta.url), "utf8");
  const sumIdx = lib.indexOf("export async function sumPortfolioBudget");
  assert.ok(sumIdx !== -1);
  const body = lib.slice(sumIdx, lib.indexOf("}", lib.indexOf("reduce", sumIdx)));
  assert.match(body, /withBudgetTotal\(\{[\s\S]*?budgets: r\.budgets/, "la somma deve riusare l'estrazione testata");
  assert.match(body, /return null;/, "senza DB/DB non migrato: null, non 0");
  const page = readFileSync(new URL("../src/app/admin/clients/page.tsx", import.meta.url), "utf8");
  assert.match(page, /sumPortfolioBudget/);
  assert.match(page, /portfolio != null \? `~\$\{portfolio\.toLocaleString\("it-IT"\)\} €` : "—"/);
});
