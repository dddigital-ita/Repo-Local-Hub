import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  aggregaPerPagina,
  deltaPercent,
  formattaMs,
  parseMs,
  percentileOrdinato,
  periodo,
  risolviPath,
  sogliaTone,
  PERF_AMBRA_MS,
  PERF_MIN_CAMPIONI,
  PERF_RELEASE_CUT_ISO,
  PERF_TARGET_CALDO_MS,
} from "../src/lib/admin-perf.ts";

/**
 * Guard della VISTA di telemetria admin (admin.render → /admin/tools/perf):
 * le funzioni pure sono testate coi dati veri (righe audit come le scrive
 * logAdminRenderTime), il wiring pagina/scheda è guard testuale come nelle
 * altre sentinelle del progetto.
 */

const ROOT = process.cwd();

test("parseMs: accetta solo il formato che scrive la telemetria", () => {
  assert.equal(parseMs("1234ms"), 1234);
  assert.equal(parseMs(" 87ms "), 87);
  // Robustezza: formato diverso = campione perso, non un'eccezione.
  assert.equal(parseMs("1,2s"), null);
  assert.equal(parseMs(""), null);
  assert.equal(parseMs("abcms"), null);
});

test("percentileOrdinato: interpolazione lineare su lista ordinata", () => {
  assert.equal(percentileOrdinato([], 0.5), 0);
  assert.equal(percentileOrdinato([100], 0.95), 100);
  assert.equal(percentileOrdinato([100, 200], 0.5), 150);
  assert.equal(percentileOrdinato([100, 200, 300, 400], 0.5), 250);
  // p95 di 20 campioni = il 19° (indice interpolato 18.05).
  const venti = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
  assert.equal(percentileOrdinato(venti, 0.95), 1905);
});

test("periodo: mediana, p95 e worst arrotondati a ms interi", () => {
  const p = periodo([100, 200, 301]);
  assert.deepEqual(p, { n: 3, p50: 200, p95: 291, worst: 301 });
  assert.deepEqual(periodo([]), { n: 0, p50: 0, p95: 0, worst: 0 });
});

test("aggregaPerPagina: per pagina, PRIMA/DOPO al taglio, ordine di ultima comparsa", () => {
  const righe = [
    { target: "/admin/settings", detail: "2000ms", created_at: "2026-09-30T10:00:00Z" },
    { target: "/admin/settings", detail: "400ms", created_at: "2026-10-01T18:00:00Z" },
    { target: "/admin/tools", detail: "2200ms", created_at: "2026-09-29T09:00:00Z" },
    { target: "/admin/tools", detail: "600ms", created_at: "2026-10-01T18:05:00Z" },
    { target: "/admin/tools", detail: "500ms", created_at: "2026-10-01T18:10:00Z" },
    { target: "/admin/tools", detail: "spazzatura", created_at: "2026-10-01T18:11:00Z" },
  ];
  const pagine = aggregaPerPagina(righe, PERF_RELEASE_CUT_ISO);
  // La pagina navigata più di recente in cima: «ultimo» è il MAX delle righe,
  // non la prima incontrata (le righe d'ingresso non sono ordinate per certi).
  assert.equal(pagine[0].path, "/admin/tools");
  assert.equal(pagine[0].ultimo, "2026-10-01T18:10:00Z");
  const tools = pagine[0];
  assert.equal(tools.prima.p50, 2200);
  assert.equal(tools.dopo.p50, 550, "due campioni DOPO (600 e 500): mediana 550");
  assert.equal(tools.dopo.n, 2, "la riga non parsabile è un campione perso, non un errore");
  assert.equal(tools.dopo.worst, 600);
  const settings = pagine[1];
  assert.equal(settings.prima.p50, 2000);
  assert.equal(settings.dopo.p50, 400);
});

test("deltaPercent e soglie: il negativo è un miglioramento, le soglie sono del piano", () => {
  const prima = periodo([2000, 2200, 2400]);
  const dopo = periodo([500, 550, 600]);
  const delta = deltaPercent(prima, dopo);
  assert.ok(delta < -70 && delta > -80, `delta atteso ~ -74%, ricevuto ${delta}`);
  assert.equal(deltaPercent(null, dopo), null, "senza PRIMA non c'è confronto");
  assert.equal(PERF_TARGET_CALDO_MS, 1_000, "target del piano: 1 s a caldo");
  assert.equal(PERF_AMBRA_MS, 2_500);
  assert.equal(PERF_MIN_CAMPIONI, 3, "sotto questa storia la scheda dice «pochi campioni»");
  assert.equal(sogliaTone(870), "ok");
  assert.equal(sogliaTone(1_200), "warn");
  assert.equal(sogliaTone(3_000), "late");
  // Il target è il cursore della scheda: le bande si muovono con lui.
  assert.equal(sogliaTone(870, 500), "warn", "870 sopra un target da 500 ms");
  assert.equal(sogliaTone(870, 900), "ok", "870 sotto un target da 900 ms");
  // Ambra = 2,5× il target: con target 800 ms l'ambra finisce a 2 s.
  assert.equal(sogliaTone(1_999, 800), "warn");
  assert.equal(sogliaTone(2_000, 800), "late");
});

test("formattaMs: ms sotto il secondo, secondi con virgola italiana sopra", () => {
  assert.equal(formattaMs(870), "870ms");
  assert.equal(formattaMs(1_200), "1,2s");
  assert.equal(formattaMs(12_340), "12s");
});

test("risolviPath: l'edge header quando c'è, il bucket /admin quando manca, MAI il referer", () => {
  const h = (vals) => ({ get: (name) => vals[name] ?? null });
  // L'header dell'edge proxy (produzione) vince, senza querystring.
  assert.equal(risolviPath(h({ "x-forwarded-uri": "/admin/settings?x=1" })), "/admin/settings");
  assert.equal(risolviPath(h({ "x-invoke-path": "/admin/tools" })), "/admin/tools");
  assert.equal(risolviPath(h({ "next-url": "/admin/tools/perf" })), "/admin/tools/perf");
  // Null ovunque (verificato col probe su build reale: questa versione di
  // Next non espone il pathname al layout) → bucket onesto, non inventato.
  assert.equal(risolviPath(h({})), "/admin");
  // Un header path-like ma vuoto/malformato non inganna.
  assert.equal(risolviPath(h({ "x-forwarded-uri": "https://x.it/admin/y" })), "/admin");
});

test("la pagina esiste, è force-dynamic e legge dal DB senza cache", () => {
  const pagina = readFileSync(path.join(ROOT, "src", "app", "admin", "tools", "perf", "page.tsx"), "utf8");
  assert.ok(existsSync(path.join(ROOT, "src", "app", "admin", "tools", "perf", "page.tsx")), "pagina mancante");
  assert.match(pagina, /export const dynamic = "force-dynamic"/, "la scheda deve leggere i numeri veri a ogni apertura");
  assert.match(pagina, /requireAdmin\(\)/, "protetta dall'admin come le altre schede di sistema");
  assert.match(pagina, /leggiAdminRender\(/, "legge gli eventi admin.render dall'audit");
  assert.match(pagina, /aggregaPerPagina\(/, "aggrega con la lib pura");
  assert.match(pagina, /PERF_RELEASE_CUT_ISO/, "il taglio PRIMA/DOPO è la costante dichiarata, non un numero magico");
  // Robustezza come le altre schede: senza DB si mostra il vuoto, mai un 500.
  assert.match(pagina, /pool \? await leggiAdminRender\(pool\) : \[\]/);
});

test("la scheda Velocità è nella sezione Sistema di Tools", () => {
  const hub = readFileSync(path.join(ROOT, "src", "app", "admin", "tools", "page.tsx"), "utf8");
  assert.match(hub, /href: "\/admin\/tools\/perf"/, "la scheda deve essere raggiungibile dall'hub Tools");
  assert.match(hub, /title: "Velocità"/);
  // La pagina resta fuori dai pill di stato: non è una configurazione da monitorare.
  assert.doesNotMatch(hub, /"\/admin\/tools\/perf": statuses/);
});

test("la telemetria resta quella dell'ADR-005: admin.render con il ms nel dettaglio", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "admin-telemetry.ts"), "utf8");
  assert.match(lib, /"admin\.render"/);
  assert.match(lib, /`\$\{ms\}ms`/, "il dettaglio resta «Nms»: è il formato che la vista sa leggere");
});
