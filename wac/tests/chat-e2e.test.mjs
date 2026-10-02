import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Sentinelle dell'E2E chat lead-gen: il percorso ricerca → chat → lead è il
// motore del business, quindi deve restare coperto END-TO-END (UI + DB).
// Qui si rompe la suite se qualcuno scollega la spec dal DB, riduce lo script
// o reintroduce il bug del 2026-09-27 (INSERT con parametri disallineati:
// il lead non veniva mai salvato e nessuno se n'accorgeva perché il catch
// ingoiava l'errore e la notifica partiva lo stesso).

test("la spec E2E copre ricerca, script completo e persistenza nel DB", () => {
  const spec = readFileSync(path.join(ROOT, "tests", "e2e", "chat-lead.spec.ts"), "utf8");
  assert.match(spec, /consulenza\?q=/, "manca l'apertura della chat dalla ricerca");
  assert.match(spec, /Un sito web nuovo/, "manca lo step service");
  assert.match(spec, /Entro quando ti servirebbe\?/, "manca lo step timing");
  assert.match(spec, /Budget indicativo/, "manca lo step budget");
  assert.match(spec, /Azienda.*ditta/, "manca lo step company");
  assert.match(spec, /Invia e fatti richiamare/, "manca il submit del consenso");
  assert.match(spec, /from leads/, "l'E2E deve rileggere il lead DAL DB");
  assert.match(spec, /lead_captured/, "manca l'asserzione dello stato lead_captured");
  assert.match(spec, /visitor_messages/, "manca l'asserzione sulla trascrizione persistita");
});

test("l'INSERT del lead ha colonne e parametri allineati (bug 66d2d61)", () => {
  const route = readFileSync(path.join(ROOT, "src", "app", "api", "lead", "route.ts"), "utf8");
  const values = route.match(/values\s*\(([^)]*)\)/)?.[1] ?? "";
  const cols = route.match(/insert into leads\s*\(([\s\S]*?)\)\s*\n\s*values/)?.[1] ?? "";
  const nCols = cols.split(",").length;
  // Contano i VALORI totali (placeholder $N + letterali tipo true/'nuovo'),
  // non solo i placeholder: l'invariante è «un valore per colonna».
  const nValues = values.split(",").length;
  assert.equal(
    nValues,
    nCols,
    `l'INSERT del lead ha ${nValues} valori per ${nCols} colonne: disallineati, il lead non verrà salvato`,
  );
  // company/company_name devono stare ESATTAMENTE nelle posizioni $8/$9:
  // fino al 2026-09-27 erano appesi in coda e la colonna boolean `hot`
  // riceveva il nome della ditta (INSERT fallito in silenzio).
  assert.match(route, /company,\s*\/\/\s*\$8/, "company non è nella posizione $8");
  assert.match(route, /companyName,\s*\/\/\s*\$9/, "company_name non è nella posizione $9");
  assert.match(route, /Boolean\(lead\.hot\),\s*\/\/\s*\$10/, "hot non è nella posizione \$10");
});

test("l'insert del lead fallisce rumorosamente: niente catch che ingoia", () => {
  const route = readFileSync(path.join(ROOT, "src", "app", "api", "lead", "route.ts"), "utf8");
  // Il bug è stato invisibile per 4 giorni perché il catch restituiva ok:true
  // senza leadId: la risposta deve tradire il fallimento della persistenza.
  assert.match(
    route,
    /leadInsertFailed/,
    "un fallimento dell'INSERT deve emergere nella risposta API, non restare silenzioso",
  );
});

test("il reset DB E2E esiste, usa env E2E_PG* e applica schema+migration", () => {
  const p = path.join(ROOT, "scripts", "e2e-db-reset.mjs");
  assert.ok(existsSync(p), "manca scripts/e2e-db-reset.mjs");
  const s = readFileSync(p, "utf8");
  assert.match(s, /E2E_PGDATABASE/, "il DB E2E deve essere configurabile via env (CI)");
  assert.match(s, /E2E_PGPASSWORD/, "in CI il Postgres del servizio richiede password");
  assert.match(s, /schema\.sql/, "il reset deve applicare lo schema");
  assert.match(s, /db-migrate-all\.mjs/, "il reset deve applicare le migration col runner del repo");
  // Prod intoccabile: nessun DSN di Neon hardcoded nello script.
  assert.ok(!/ep-[a-z0-9-]+\.amazonaws\.com|neon\.tech/.test(s), "DSN remoto hardcoded nello script di reset");
});

test("la CI monta Postgres e resetta il DB prima dell'E2E", () => {
  const wf = readFileSync(path.join(ROOT, ".github", "workflows", "overlay-guard.yml"), "utf8");
  assert.match(wf, /postgres:16/, "la CI non monta il servizio Postgres");
  assert.match(wf, /e2e-db-reset\.mjs/, "la CI non resetta il DB E2E prima dei test");
  assert.match(wf, /E2E_PGPASSWORD/, "la CI non passa la password al DB E2E");
});

test("l'ambiente E2E è committato e non contiene segreti", () => {
  const env = readFileSync(path.join(ROOT, ".env.e2e"), "utf8");
  assert.ok(!/ENCRYPTED|AIza|sk-[A-Za-z0-9]{20}/.test(env), "segreto in .env.e2e");
  // Turnstile: solo le chiavi di TEST pubbliche Cloudflare (1x00000000000000000000AA).
  assert.match(env, /1x00000000000000000000AA/, "manca la site key di test Turnstile");
});
