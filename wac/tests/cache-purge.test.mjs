/**
 * TEST FREE CACHE — stesso metodo del repo: le decisioni vivono in moduli
 * puri (cache-shared) importabili senza DB, il wiring si verifica leggendo
 * le decisioni dove vivono. Niente server, niente pg.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

// Le funzioni pure di cache-shared sono importabili senza DB. Eseguiamo
// davvero sanificazione, catalogo e selezione, come fanno gli altri test.
const shared = await import(path.join(ROOT, "src", "lib", "cache-shared.ts"));
const {
  sanitizeCacheReason,
  CACHE_TARGETS,
  selectedTargets,
  wantsTarget,
  targetLabels,
  isCacheableMethod,
  cacheAgeInfo,
} = shared;

const actionsSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");
const pageSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "tools", "cache", "page.tsx"), "utf8");
const purgeSrc = readFileSync(path.join(ROOT, "src", "lib", "cache-purge.ts"), "utf8");
const panelSrc = readFileSync(path.join(ROOT, "src", "components", "cache-panel.tsx"), "utf8");
const toolsSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "tools", "page.tsx"), "utf8");
const destinationsSrc = readFileSync(path.join(ROOT, "src", "lib", "admin-destinations.ts"), "utf8");
const prodlikeSrc = readFileSync(path.join(ROOT, "tests", "e2e", "prodlike-cache.spec.ts"), "utf8");

/* ── logica pura: sanificazione motivo ───────────────────────────── */

test("sanitizeCacheReason: tipi sbagliati ricadono su stringa vuota, senza lanciare", () => {
  for (const raw of [null, undefined, 42, {}, [], true]) {
    assert.equal(sanitizeCacheReason(raw), "");
  }
});

test("sanitizeCacheReason: trim e cap a 200 (protezione del log append-only)", () => {
  assert.equal(sanitizeCacheReason("  ciao  "), "ciao");
  const long = sanitizeCacheReason("x".repeat(500));
  assert.ok(long.length <= 200);
  assert.equal(long, "x".repeat(200));
});

/* ── semantica del tool: cosa è cacheabile e cosa si purga ───────── */

test("solo GET/HEAD sono cacheabili: le mutation non passano dalla cache", () => {
  assert.equal(isCacheableMethod("GET"), true);
  assert.equal(isCacheableMethod("head"), true);
  assert.equal(isCacheableMethod("POST"), false);
  assert.equal(isCacheableMethod("DELETE"), false);
});

test("il catalogo dichiara i QUATTRO target: layout, home, landing, admin", () => {
  assert.deepEqual(
    CACHE_TARGETS.map((t) => t.id).sort(),
    ["admin", "home", "landing", "layout"],
  );
  // Ogni target dichiara il proprio costo (l'admin sceglie sapendo cosa paga).
  for (const t of CACHE_TARGETS) {
    assert.ok(t.label.length > 3, `${t.id}: label troppo corta`);
    assert.ok(t.description.length > 20, `${t.id}: descrizione troppo corta`);
    assert.ok(["pesante", "contenuto", "trascurabile"].includes(t.cost), `${t.id}: costo non valido`);
  }
  // Il layout è dichiarato il più costoso, admin il più economico: onestà UI.
  assert.equal(CACHE_TARGETS.find((t) => t.id === "layout")?.cost, "pesante");
  assert.equal(CACHE_TARGETS.find((t) => t.id === "admin")?.cost, "trascurabile");
});

test("selectedTargets: legge SOLO gli id del catalogo, ogni altro campo è scartato", () => {
  const fd = new FormData();
  fd.set("home", "1");
  fd.set("arbitrary", "1"); // tentativo di path libero via form: ignorato
  fd.set("layout", "true"); // non è la conferma «1»: ignorato
  assert.deepEqual(selectedTargets(fd), ["home"], "solo target noti col flag esatto passano");
});

test("selectedTargets: multi-selezione nell'ordine del catalogo, non del form", () => {
  const fd = new FormData();
  fd.set("admin", "1");
  fd.set("landing", "1");
  fd.set("home", "1");
  assert.deepEqual(selectedTargets(fd), ["home", "landing", "admin"]);
});

test("wantsTarget: la conferma esplicita è '1' su TUTTI i target scelti, non uno solo", () => {
  const fdYes = new FormData();
  fdYes.set("home", "1");
  fdYes.set("landing", "1");
  assert.equal(wantsTarget(fdYes, ["home", "landing"]), true);
  const fdPartial = new FormData();
  fdPartial.set("home", "1"); // landing manca: la conferma è incompleta
  assert.equal(wantsTarget(fdPartial, ["home", "landing"]), false);
  const fdEmpty = new FormData();
  assert.equal(wantsTarget(fdEmpty, ["layout"]), false);
  assert.equal(wantsTarget(fdEmpty, []), true, "nessun target richiesto = nessuna conferma dovuta");
  assert.equal(wantsTarget(fdYes, []), true);
});

test("targetLabels: etichette del catalogo nell'ordine dato", () => {
  assert.equal(targetLabels(["layout"]), "Tutto il sito");
  assert.equal(targetLabels(["home", "admin"]), "Solo la home, Solo l'admin");
  assert.equal(targetLabels([]), "");
});

/* ── età della cache: regole di calcolo ─────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-30T12:00:00Z");

const ageAt = (iso, now = NOW) => cacheAgeInfo({ at: iso, targets: [] }, now);

test("cacheAgeInfo: giorni interi senza purga, etichetta in italiano", () => {
  assert.equal(ageAt(new Date(NOW - 1).toISOString()).label, "oggi");
  assert.equal(ageAt(new Date(NOW - 2 * DAY + 1).toISOString()).label, "ieri");
  const tre = ageAt(new Date(NOW - 3 * DAY).toISOString());
  assert.equal(tre.days, 3);
  assert.equal(tre.label, "3 giorni");
});

test("cacheAgeInfo: mai purgata o data malformata → null (l'UI dice «mai purgata»)", () => {
  for (const last of [null, { at: null, targets: [] }, { at: "garbage", targets: [] }]) {
    assert.equal(cacheAgeInfo(last, NOW), null);
  }
});

test("cacheAgeInfo: data nel futuro → null, mai un numero negativo in scheda", () => {
  assert.equal(cacheAgeInfo({ at: new Date(NOW + DAY).toISOString(), targets: [] }, NOW), null);
});

/* ── action: ordine requireAdmin → selezione → conferma → purga ──── */

test("l'action esige requireAdmin PRIMA di ogni gesto, selezione e conferma prima della purga", () => {
  const idx = actionsSrc.indexOf("export async function purgeCacheAction");
  assert.ok(idx !== -1, "l'action della purga non esiste");
  const block = actionsSrc.slice(idx, actionsSrc.indexOf("redirect(`/admin/tools/cache", idx));
  const order = (needle) => {
    const at = block.indexOf(needle);
    assert.ok(at !== -1, `manca ${needle}`);
    return at;
  };
  const purgeAt = order("purgeSiteCache(targets)");
  assert.ok(order("requireAdmin()") < purgeAt, "requireAdmin prima della purga");
  assert.ok(order("selectedTargets") < purgeAt, "la selezione precede la purga");
  assert.ok(order("targets.length === 0") < purgeAt, "zero target = nessun gesto");
  assert.ok(order("wantsTarget") < purgeAt, "la conferma precede la purga");
  assert.ok(order("logAudit(") > purgeAt, "l'audit registra l'esito");
  assert.ok(block.includes("sanitizeCacheReason"), "il motivo finisce sanificato in audit");
  assert.match(block, /cache\.purga/);
  assert.ok(block.includes("targetLabels(targets)"), "l'audit registra QUALE target");
});

test("la purga è SOLO in cache-purge.ts: i revalidatePath del form non esistono", () => {
  // L'action non replica il gesto: passa da cache-purge.
  const idx = actionsSrc.indexOf("export async function purgeCacheAction");
  const block = actionsSrc.slice(idx, actionsSrc.indexOf("redirect(`/admin/tools/cache", idx));
  assert.doesNotMatch(block, /revalidatePath\(/, "il gesto vive in cache-purge.ts");
  // cache-purge contiene le chiamate ed è fail-safe.
  assert.match(purgeSrc, /revalidatePath\("\/", "layout"\)/);
  assert.match(purgeSrc, /revalidatePath\("\/admin", "layout"\)/);
  assert.match(purgeSrc, /revalidatePath\("\/"\)/, "la home ha la sua purga page-level");
  assert.match(purgeSrc, /try/, "la purga degredisce con grazia, mai un 500");
});

test("i target singoli NON usano il layout largo: il costo minore deve essere vero", () => {
  // home: page-level («/» senza «layout»); la sua riga non deve contenere «layout».
  const homeBlock = purgeSrc.slice(purgeSrc.indexOf('id === "home"'), purgeSrc.indexOf('id === "landing"'));
  assert.match(homeBlock, /revalidatePath\("\/"\);/);
  assert.doesNotMatch(homeBlock, /"layout"/);
  // landing: il layout largo è GIUSTIFICATO nel commento (slug non enumerabili).
  const landingBlock = purgeSrc.slice(purgeSrc.indexOf('id === "landing"'), purgeSrc.indexOf('id === "admin"'));
  assert.match(landingBlock, /revalidatePath\("\/", "layout"\);/);
  assert.match(landingBlock, /enumerabili|layout-level/, "la scelta va spiegata dove si fa");
  // admin: layout admin, non il root layout (che trascinerebbe il sito pubblico).
  const adminBlock = purgeSrc.slice(purgeSrc.indexOf('id === "admin"'), purgeSrc.indexOf("return true"));
  assert.match(adminBlock, /revalidatePath\("\/admin", "layout"\);/);
  assert.doesNotMatch(adminBlock, /revalidatePath\("\/", "layout"\)/);
});

/* ── wiring admin: hub Tools, palette ⌘K e pannello collegato ────── */

test("wiring admin: scheda nell'hub Tools, destinazione palette e pannello client collegato", () => {
  assert.match(toolsSrc, /\/admin\/tools\/cache/);
  assert.match(toolsSrc, /Free cache/);
  assert.match(destinationsSrc, /\/admin\/tools\/cache/);
  assert.match(destinationsSrc, /Free cache/);
  assert.match(panelSrc, /purgeCacheAction/);
  assert.match(panelSrc, /confirming/, "la purga passa dalla conferma a due fasi");
  assert.match(panelSrc, /CACHE_TARGETS\.map/, "la UI rende il catalogo, non una lista parallela");
});

test("il pannello alterna layout e singoli: mai entrambi nella stessa purga", () => {
  assert.match(panelSrc, /id === "layout"/, "la mutua esclusione vive nel pannello");
  assert.match(panelSrc, /chosen\.map/, "la conferma viaggia solo sui target scelti");
});

test("la scheda richiede admin, non è indicizzabile e valida i target dell'esito", () => {
  assert.match(pageSrc, /requireAdmin\(\)/);
  assert.match(pageSrc, /robots: \{ index: false/);
  assert.match(pageSrc, /force-dynamic/);
  assert.match(pageSrc, /VALID_TARGETS/, "l'esito mostra solo target del catalogo");
  assert.match(pageSrc, /targetLabels/, "l'esito parla in etichette, non in id grezzi");
});

test("età della cache: letta dall'audit con degradazione onesta, calcolo nel puro", () => {
  // Il calcolo vive nel layer puro (cache-shared), il reader nel server.
  assert.match(purgeSrc, /readLastPurge/, "il reader esiste in cache-purge");
  const reader = purgeSrc.slice(purgeSrc.indexOf("async function readLastPurge"));
  assert.match(reader, /cache\.purga/, "l'evento letto è quello dell'action");
  assert.match(reader, /order by created_at desc/, "l'ultima purga, non la prima");
  assert.match(reader, /if \(!pool\) return null/, "senza DB: nessuna informazione, non un 500");
  assert.match(reader, /catch/, "audit non migrato: degrada, non lancia");
  // La scheda mostra l'età e non inventa una storia che non c'è.
  assert.match(pageSrc, /cacheAgeInfo\(lastPurge\)/);
  assert.match(pageSrc, /Mai purgata dal registro/, "caso null: detto onestamente in UI");
});

test("la prova prodlike del tool esiste e copre il flusso completo", () => {
  // La spec gira solo nella config prodlike (testMatch della config).
  assert.match(prodlikeSrc, /admin\/tools\/cache/);
  // I quattro target renduti + età onesta su storia vuota.
  for (const label of ["Tutto il sito", "Solo la home", "Solo le landing SEO", "Solo l'admin"]) {
    assert.ok(prodlikeSrc.includes(label), `la spec verifica il target «${label}»`);
  }
  assert.match(prodlikeSrc, /Mai purgata dal registro/);
  // La conferma a due fasi è attraversata davvero (prepara → sì, svuota).
  assert.match(prodlikeSrc, /Prepara la purga/);
  assert.match(prodlikeSrc, /Sì, svuota:/);
  // Il gate senza selezione: il bottone primario da solo non purga.
  assert.match(prodlikeSrc, /Svuota la cache/, "il bottone primario è provato senza target");
  // L'audit è verificato dal DB (attore, target, motivo) e l'età da «oggi».
  assert.match(prodlikeSrc, /cache\.purga/);
  assert.match(prodlikeSrc, /Ultima purga: oggi/);
  // La mutua esclusione layout↔singoli è provata nel browser.
  assert.match(prodlikeSrc, /not\.toBeChecked\(\)/);
});
