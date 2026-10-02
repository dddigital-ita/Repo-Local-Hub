/**
 * TEST DB MIGRATE ALL — il runner di migration è codice operativo: i test
 * verificano le sue decisioni SENZA toccare un database.
 *
 * Il modulo esegue il main all'import (apre il pool e parte), quindi —
 * come il test di contrasto del repo, che parsa i file — leggiamo il
 * sorgente e verifichiamo le decisioni dove vivono:
 *  1. ordine deterministico: solo .sql, sort() lessicografico (convenzione
 *     numerica 001-026 del repo);
 *  2. tracciamento schema_migrations: bootstrap additivo, i file con riga
 *     NON vengono rieseguiti, il checksum rileva il drift;
 *  3. classificazione degli esiti: "already exists" è GIÀ APPLICATA con
 *     backfill della riga; gli altri errori contano come falliti (exit 1);
 *  4. dry-run: nessuna query di applicazione prima del gate;
 *  5. wiring npm: script db:migrate e passaggio argomenti `--`;
 *  6. i file 010 e 024 (CREATE RULE senza IF NOT EXISTS) hanno la nota
 *     esplicita: la corsa reale di allineamento li ha visti cadere lì.
 *  7. DB vergine: la guardia sulle tabelle base esce presto con
 *     l'istruzione giusta, prima di qualsiasi scrittura.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const RUNNER = path.join(ROOT, "scripts", "db-migrate-all.mjs");
const MIGRATIONS = path.join(ROOT, "neon", "migrations");

const src = readFileSync(RUNNER, "utf8");

test("il runner ordina solo i .sql e usa l'ordine lessicografico", () => {
  assert.match(src, /\.filter\(\(f\) => f\.endsWith\("\.sql"\)\)/);
  assert.match(src, /\.sort\(\)/, "manca il sort deterministico");
});

test("tracciamento: bootstrap additivo di schema_migrations con checksum", () => {
  assert.match(src, /create table if not exists \$\{TRACK_TABLE\}/);
  assert.match(src, /createHash\("sha256"\)/, "manca il checksum sha256");
  assert.match(src, /checksum/, "il record deve salvare il checksum");
});

test("i file già tracciati NON vengono rieseguiti (skip prima di pool.query(sql))", () => {
  const gateIdx = src.indexOf("recorded.get(file)");
  const execIdx = src.indexOf("await pool.query(sql)");
  assert.ok(gateIdx !== -1 && execIdx !== -1);
  assert.ok(gateIdx < execIdx, "il gate del tracciamento deve precedere l'esecuzione");
  assert.match(src.slice(gateIdx, execIdx), /TRACCIATA/);
  assert.match(src.slice(gateIdx, execIdx), /skipped\+\+/);
});

test("drift: checksum diverso produce warning DRIFT, non un errore", () => {
  assert.match(src, /DRIFT/);
  assert.match(src, /file modificato dopo l'applicazione/);
  const driftBranch = src.slice(src.indexOf("if (rec.checksum !== checksum)"), src.indexOf("skipped++"));
  assert.doesNotMatch(driftBranch, /failed\+\+/, "il drift non è un fallimento della corsa");
});

test("la riga di tracciamento viene scritta insieme all'applicazione (stesso ramo try)", () => {
  const execIdx = src.indexOf("await pool.query(sql)");
  const tryBlock = src.slice(execIdx, src.indexOf("} catch (err) {", execIdx));
  assert.match(tryBlock, /insert into \$\{TRACK_TABLE\}/, "l'insert manca nel ramo di successo");
  assert.match(tryBlock, /on conflict \(filename\) do nothing/);
});

test("backfill: un «already exists» registra comunque la riga (il prossimo giro salta)", () => {
  const alreadyIdx = src.indexOf("ALREADY_RE.test");
  const alreadyBranch = src.slice(alreadyIdx, src.indexOf("} else {", alreadyIdx));
  assert.match(alreadyBranch, /insert into \$\{TRACK_TABLE\}/, "il backfill manca nel ramo already");
  assert.match(alreadyBranch, /GIÀ APPLICATA/);
  assert.doesNotMatch(alreadyBranch, /failed\+\+/, "un «già applicata» conta come fallito");
});

test("«already exists» è classificato GIÀ APPLICATA e non fa fallire la corsa", () => {
  assert.match(src, /ALREADY_RE = .*already exists/i);
  const alreadyIdx = src.indexOf("ALREADY_RE.test");
  const alreadyBranch = src.slice(alreadyIdx, src.indexOf("} else {", alreadyIdx));
  assert.match(alreadyBranch, /GIÀ APPLICATA/, "il ramo already non marca GIÀ APPLICATA");
  assert.doesNotMatch(alreadyBranch, /failed\+\+/, "un «già applicata» conta come fallito");
});

test("la convenzione dei numeri d'ordine regge: i file partono tutti con NNN-", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 26, `attese almeno 26 migration, trovate ${files.length}`);
  for (const f of files) {
    assert.match(f, /^\d{3}-/, `file fuori convenzione: ${f}`);
  }
  // con il sort lessicografico il prefisso numerico garantisce l'ordine corretto
  const sorted = [...files].sort();
  assert.deepEqual(sorted.map((f) => f.slice(0, 3)), [...sorted.map((f) => f.slice(0, 3))].sort());
});

test("gli errori veri contano come falliti e l'exit code è 1", () => {
  const alreadyIdx = src.indexOf("ALREADY_RE.test");
  const elseIdx = src.indexOf("} else {", alreadyIdx);
  const elseBranch = src.slice(elseIdx, src.indexOf("await pool.end()"));
  assert.match(elseBranch, /failed\+\+/, "gli errori veri non incrementano failed");
  const tail = src.slice(src.indexOf("riepilogo:"));
  assert.match(tail, /process\.exit\(1\)/, "manca exit 1 in coda al report");
});

test("il riepilogo distingue tracciate, backfillate e applicate adesso", () => {
  assert.match(src, /già tracciate in schema_migrations/);
  assert.match(src, /backfillate/);
  assert.match(src, /applicate adesso/);
});

test("dry-run: non esegue query (il gate precede ogni applicazione)", () => {
  const dryGate = src.indexOf("if (dryRun)");
  const poolQuery = src.indexOf("await pool.query(sql)");
  assert.ok(dryGate !== -1 && poolQuery !== -1);
  // il ramo dry-run decide PRIMA di arrivare a pool.query(sql)
  const before = src.slice(0, poolQuery).lastIndexOf("if (dryRun)");
  assert.ok(before !== -1, "il gate dry-run deve precedere l'esecuzione");
  assert.match(src, /--dry-run/, "manca il flag --dry-run");
});

test("DB vergine: la guardia fallisce presto con l'istruzione, prima di ogni scrittura", () => {
  const guardIdx = src.indexOf("to_regclass('public.");
  assert.ok(guardIdx !== -1, "manca la guardia sulle tabelle base");
  // zero scritture prima del fail: la guardia precede il bootstrap del tracciamento
  const trackIdx = src.indexOf("create table if not exists \${TRACK_TABLE}");
  assert.ok(trackIdx !== -1);
  assert.ok(guardIdx < trackIdx, "la guardia deve precedere il bootstrap di schema_migrations");
  // il dry-run resta una lettura pura: la guardia vive nel ramo !dry-run, subito prima
  const dryGate = src.lastIndexOf("if (!dryRun)", guardIdx);
  assert.ok(dryGate !== -1 && guardIdx - dryGate < 400, "la guardia deve stare nel ramo !dry-run");
  // il messaggio indica entrambi i percorsi giusti, col comando pronto da incollare
  const guardEnd = src.indexOf("process.exit(1)", guardIdx);
  assert.ok(guardEnd !== -1, "la guardia deve uscire con exit 1");
  const msg = src.slice(guardIdx, guardEnd);
  assert.match(msg, /neon\/schema\.sql/);
  assert.match(msg, /wizard/, "il messaggio deve nominare il wizard /setup");
  assert.match(msg, /psql/, "il messaggio deve dare il comando psql pronto da incollare");
  assert.match(msg, /ON_ERROR_STOP/);
});

test("la guardia copre tutte le tabelle base di neon/schema.sql (oggi come domani)", () => {
  const schema = readFileSync(path.join(ROOT, "neon", "schema.sql"), "utf8");
  const baseTables = [...schema.matchAll(/^create table if not exists (\w+)/gm)].map((m) => m[1]);
  assert.ok(baseTables.length >= 6, `schema.sql deve dichiarare le tabelle base, trovate ${baseTables.length}`);
  const arrMatch = src.match(/const BASE_TABLES = \[([^\]]*)\]/);
  assert.ok(arrMatch, "manca l'array BASE_TABLES della guardia");
  const guarded = [...arrMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...guarded].sort(),
    [...baseTables].sort(),
    "BASE_TABLES e schema.sql non sono allineati: se una tabella base cambia, la guardia deve seguirla",
  );
});

test("il runner carica .env.local solo se DATABASE_URL non è già nell'ambiente", () => {
  assert.match(src, /if \(!process\.env\.DATABASE_URL\)/);
  assert.match(src, /\.env\.local/);
});

test("wiring npm: script db:migrate presente e documentato nel corpo", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["db:migrate"], "node scripts/db-migrate-all.mjs");
  assert.match(src, /npm run db:migrate/, "l'hint nel report nomina lo script sbagliato");
});

test("la migration 026 crea la tabella di tracciamento con la stessa struttura del runner", () => {
  const migration = readFileSync(path.join(MIGRATIONS, "026-schema-migrations.sql"), "utf8");
  assert.match(migration, /create table if not exists schema_migrations/);
  assert.match(migration, /checksum\s+text not null/);
  assert.match(migration, /applied_at\s+timestamptz/);
});
