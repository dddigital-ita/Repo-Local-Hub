import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

test("i value dei bottoni della chat vivono SOLO nella fonte unica STEP_BUTTONS", () => {
  // 30/09/2026: lo step company usava value interni 'no'/'sì' e la bolla utente
  // echoava il value: chi cliccava «Professionale» vedeva la propria bolla
  // scrivere «no». I value finiscono anche nei campi del lead, quindi devono
  // essere parole leggibili — e dal refactoring abitano in UNA costante
  // (STEP_BUTTONS in chat-script.ts) referenziata dagli step: la sentinella
  // blocca sia i token interni sia i value letterali duplicati altrove.
  const script = readFileSync(path.join(ROOT, "src", "lib", "chat-script.ts"), "utf8");

  const start = script.indexOf("export const STEP_BUTTONS = {");
  const end = script.indexOf("} as const;", start);
  assert.ok(start > 0 && end > start, "manca il blocco STEP_BUTTONS in chat-script.ts");
  const block = script.slice(start, end);
  const outside = script.slice(0, start) + script.slice(end);

  // 0. La costante è popolata: 5 step a bottoni (service 5, timing 3,
  //    existing_site 3, budget 4, company 2 = 17 value attesi oggi).
  const valueCount = [...block.matchAll(/\bvalue:\s*['"]/g)].length;
  assert.ok(
    valueCount >= 17,
    `STEP_BUTTONS ha ${valueCount} value: attesi almeno 17 — la costante è stata svuotata?`,
  );

  // 1. Nessun token interno nel blocco fonte.
  for (const v of ["value: 'sì'", "value: 'no'", 'value: "sì"', 'value: "no"']) {
    assert.ok(!script.includes(v), `value interno «${v}» in chat-script: finisce in bolla e nel lead`);
  }

  // 2. Nessun value letterale FUORI dal blocco: gli step referenziano la
  //    costante, non copiano i valori (la duplicazione è il bug che seminava).
  const strayValues = [...outside.matchAll(/\bvalue:\s*['"]/g)];
  assert.equal(
    strayValues.length,
    0,
    `value letterali fuori da STEP_BUTTONS (righe ${strayValues.map((m) => script.slice(0, m.index).split("\n").length).join(", ")}): usare STEP_BUTTONS`,
  );

  // 3. Ogni step a bottoni referenzia la fonte unica.
  for (const step of ["service", "timing", "existing_site", "budget", "company"]) {
    assert.ok(
      script.includes(`buttons: STEP_BUTTONS.${step},`),
      `lo step ${step} non referenzia STEP_BUTTONS.${step}`,
    );
  }
});

test("migration 038: conversione legacy exact-match con audit dell'origine", () => {
  // I lead scritti PRIMA del fix 1d915ce hanno company='sì'/'no' ed
  // existing_site='no': la migration 038 li converte nei valori nuovi
  // conservando l'origine in audit_log. La sentinella blinda le tre
  // proprietà che la rendono sicura su qualunque DB storico.
  const migPath = path.join(ROOT, "neon", "migrations", "038-lead-company-legacy.sql");
  assert.ok(existsSync(migPath), "manca la migration 038 dei valori legacy");
  const mig = readFileSync(migPath, "utf8");
  // Exact-match: niente LIKE/ILIKE che travolgerebbero testo libero legittimo
  // (es. existing_site = 'sì, datato' deve restare com'è).
  assert.ok(!/\blike\b/i.test(mig), "la migration non deve usare LIKE: solo exact-match");
  for (const w of ["where l.company = 'sì'", "where l.company = 'no'", "where l.existing_site = 'no'"]) {
    assert.ok(mig.includes(w), `manca la conversione exact-match «${w}»`);
  }
  // Provenienza: l'audit (append-only, schema 010) precede ogni update e
  // la migration non cancella nulla.
  const firstAudit = mig.indexOf("insert into audit_log");
  const firstUpdate = mig.indexOf("update leads");
  assert.ok(firstAudit >= 0 && firstUpdate > firstAudit, "l'audit dell'origine deve precedere gli update");
  assert.ok(!/\b(delete\s+from|truncate)\b/i.test(mig), "la migration non deve cancellare dati");
  // Coerenza: i valori di destinazione sono quelli che lo script scrive OGGI.
  const script = readFileSync(path.join(ROOT, "src", "lib", "chat-script.ts"), "utf8");
  for (const v of ["'azienda'", "'professionista'", "'no, da zero'"]) {
    assert.ok(script.includes(`value: ${v}`), `lo script non contiene il value ${v}: la 038 punta a valori inesistenti`);
  }
});

test("ogni colonna di leads raggiunge l'export CSV e l'interfaccia della dashboard", () => {
  // La tabella leads cresce (migration additive) e il suo schema vive SPARSO:
  // neon/schema.sql + N file di migration. Due volte una colonna è nata e non
  // è arrivata ai consumatori (company/company_name sono finite in DB e
  // notifica ma né CSV né dashboard, 30/09/2026). Questa sentinella rilegge
  // lo schema DAI FILE (niente DB: gira anche in CI) ed esige che ogni
  // colonna abbia una destinazione consapevole: nel CSV, nell'interfaccia
  // LeadRow, o in una delle liste di esclusione documentate qui sotto.
  const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

  // 1. Colonne reali: create table in schema.sql + alter add column nelle migration.
  const schema = read(path.join("neon", "schema.sql"));
  const leadsDef = schema.slice(
    schema.indexOf("create table if not exists leads ("),
    schema.indexOf(");", schema.indexOf("create table if not exists leads (")),
  );
  const columns = new Set([...(leadsDef.matchAll(/^ {2}([a-z_]+)/gm) ?? [])].map((m) => m[1]));
  for (const f of readdirSync(path.join(ROOT, "neon", "migrations")).filter((f) => f.endsWith(".sql"))) {
    for (const m of read(path.join("neon", "migrations", f)).matchAll(
      /alter table leads add column (?:if not exists )?([a-z_]+)/g,
    )) {
      columns.add(m[1]);
    }
  }
  assert.ok(columns.size >= 25, `colonne leads parsate: ${columns.size}, troppo poche: parsing rotto?`);

  // 2. Esclusioni DOCUMENTATE (una colonna qui è una scelta, non una dimenticanza):
  //    UUID di collegamento e bookkeeping di sync non servono a chi usa l'export
  //    né alla card della dashboard.
  const CSV_INTERNAL = ["conversation_id", "callback_id", "notion_synced_at"];
  const UI_INTERNAL = [
    ...CSV_INTERNAL,
    "consent",              // implicito: un lead in dashboard esiste solo col consenso
    "wa_phone",             // canale WhatsApp gestito dai flussi dedicati, non dalla card
    "whatsapp_opt_in",
    "whatsapp_opt_in_at",
  ];
  for (const c of [...CSV_INTERNAL, ...UI_INTERNAL]) {
    assert.ok(columns.has(c), `esclusione «${c}» non è una colonna di leads: aggiornare la sentinella`);
  }

  // 3. Export CSV: ogni colonna non interna deve esserci (e solo quelle).
  //    Le colonne vivono in LEADS_CSV_COLUMNS (lead-company.ts), fonte unica
  //    condivisa da route e report settimanale.
  const helper = read(path.join("src", "lib", "lead-company.ts"));
  const csvBlock = helper.match(/LEADS_CSV_COLUMNS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
  assert.ok(csvBlock.length > 0, "blocco LEADS_CSV_COLUMNS non trovato in lead-company.ts");
  const csvCols = [...csvBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const csvMissing = [...columns].filter((c) => !CSV_INTERNAL.includes(c) && !csvCols.includes(c));
  assert.deepEqual(
    csvMissing,
    [],
    `colonne di leads assenti dall'export CSV (aggiungile a LEADS_CSV_COLUMNS o a CSV_INTERNAL): ${csvMissing.join(", ")}`,
  );
  const csvGhost = csvCols.filter((c) => !columns.has(c));
  assert.deepEqual(csvGhost, [], `l'CSV esporta colonne inesistenti (typo?): ${csvGhost.join(", ")}`);
  // La route e il report settimanale usano il builder condiviso: nessuno
  // riconforma il CSV per conto suo (le due fonti diverrebbero silenziosamente).
  for (const p of [
    path.join("src", "app", "api", "admin", "leads.csv", "route.ts"),
    path.join("src", "lib", "lead-report.ts"),
  ]) {
    assert.ok(read(p).includes("buildLeadsCsv"), `${p} non usa buildLeadsCsv: fonti CSV duplicate`);
  }

  // 4. Interfaccia LeadRow della dashboard: ogni colonna non interna dichiarata.
  const page = read(path.join("src", "app", "admin", "leads", "page.tsx"));
  const rowBlock = page.match(/interface LeadRow \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(rowBlock.length > 0, "interfaccia LeadRow non trovata in admin/leads/page.tsx");
  const rowFields = [...rowBlock.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  const rowMissing = [...columns].filter((c) => !UI_INTERNAL.includes(c) && !rowFields.includes(c));
  assert.deepEqual(
    rowMissing,
    [],
    `colonne di leads assenti da LeadRow (dichiarale o aggiungile a UI_INTERNAL): ${rowMissing.join(", ")}`,
  );
  const rowGhost = rowFields.filter((c) => !columns.has(c));
  assert.deepEqual(rowGhost, [], `LeadRow dichiara colonne inesistenti (typo?): ${rowGhost.join(", ")}`);
});

test("segmento tipo cliente: whitelist condivisa da dashboard ed export CSV", () => {
  // La whitelist e la WHERE del segmento vivono SOLO in src/lib/lead-company.ts:
  // duplicarle tra /admin/leads e /api/admin/leads.csv sarebbe la stessa deriva
  // dei value inline — le due viste smetterebbero di mostrare/esportare la
  // stessa lista senza che nulla rompa.
  const helper = readFileSync(path.join(ROOT, "src", "lib", "lead-company.ts"), "utf8");
  assert.ok(helper.includes("LEAD_COMPANY_SEGMENTS"), "manca LEAD_COMPANY_SEGMENTS nell'helper");
  assert.ok(helper.includes("leadCompanyWhere"), "manca leadCompanyWhere nell'helper");

  const consumers = [
    path.join(ROOT, "src", "app", "admin", "leads", "page.tsx"),
    path.join(ROOT, "src", "app", "api", "admin", "leads.csv", "route.ts"),
  ];
  for (const p of consumers) {
    const src = readFileSync(p, "utf8");
    assert.ok(
      src.includes("from \"@/lib/lead-company\""),
      `${p} non usa l'helper condiviso del segmento`,
    );
    // Niente WHITELIST o WHERE ridichiarate: quei letterali appartengono all'helper.
    for (const id of ["LEAD_COMPANY_SEGMENTS =", "function leadCompanyWhere", "function leadCompanyFilenameSuffix"]) {
      assert.ok(!src.includes(id), `${p} ridichiara «${id}»: vive solo in lead-company.ts`);
    }
    // Niente rivalidazione del PARAMETRO GREZZO (es. `companyParam === "azienda"`):
    // la validazione della querystring è solo resolveLeadCompanySegment. I
    // confronti sui value GIÀ RISOLTI (etichette, chip su lead.company) sono
    // mappatura legittima e restano al loro posto.
    assert.ok(
      !/companyParam\s*[=!]==/.test(src),
      `${p} rivalida il parametro grezzo del segmento: passarlo a resolveLeadCompanySegment`,
    );
  }
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
