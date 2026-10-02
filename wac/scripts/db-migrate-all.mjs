#!/usr/bin/env node
/**
 * DB MIGRATE ALL — applica in ordine tutte le migration di neon/migrations/
 * e stampa un report chiaro: il DB di dev si allinea con un solo comando.
 *
 *   npm run db:migrate             applica tutto
 *   npm run db:migrate -- --dry-run  mostra cosa farebbe, non tocca nulla
 *
 * Come classifica l'esito di ogni file:
 *   - APPLICATA  : la query è andata a buon fine;
 *   - GIÀ APPLICATA : Postgres ha risposto "already exists" (le migration
 *     del repo sono additive e idempotenti: create ... if not exists,
 *     insert ... on conflict do nothing). Lo stesso schema è stato
 *     applicato da una corsa precedente — non è un problema;
 *   - ERRORE     : tutto il resto (età del DB, permessi, SQL rotto) — il
 *     runner continua con i file successivi ma esce 1, così una CI lo
 *     nota. I CREATE RULE senza IF NOT EXISTS (010, 024) ricadono qui
 *     quando lo schema esiste già: il report li nomina esplicitamente.
 *
 * Le migration NON usano transazioni per file (l'idempotenza è la
 * strategia del repo): ogni file parte comunque da uno schema coerente.
 *
 * Su un DB vergine il runner non prova nemmeno a partire: le migration
 * presuppongono le tabelle base di neon/schema.sql (applicate dal wizard
 * /setup, dal reset E2E o a mano con psql) — in assenza esce subito con
 * l'istruzione giusta invece di far fallire ogni file con «relation does
 * not exist».
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

// carica .env.local se DATABASE_URL non è già nell'ambiente (come db-clean.mjs)
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
      }
    }
  } catch {
    // niente .env.local: l'errore arrive sotto dal pool
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("-n");

const MIGRATIONS_DIR = path.join(process.cwd(), "neon", "migrations");

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`db-migrate-all: directory non trovata: ${MIGRATIONS_DIR}`);
  process.exit(1);
}

// Riconosce gli errori Postgres che significano "questa migration era
// già stata applicata" — innocui per costruzione (schema idempotente).
const ALREADY_RE = /already exists|duplicate key value violates unique constraint/i;

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // 001-…, 011-ai…, 011-message…: l'ordine numerico è la convenzione del repo

if (files.length === 0) {
  console.error(`db-migrate-all: nessun file .sql in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

if (dryRun) console.log("— DRY RUN: nessuna query verrà eseguita —\n");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const results = []; // { file, status, detail }
const KNOWN_RULES = new Map([
  ["010-audit-log.sql", "CREATE RULE senza IF NOT EXISTS: innocuo se audit_log esiste già (applicata in passato)"],
  ["024-backup-history.sql", "CREATE RULE senza IF NOT EXISTS: innocuo se backup_history esiste già (applicata in passato)"],
]);

let applied = 0;
let already = 0;
let failed = 0;
let skipped = 0;

try {
  await pool.query("select 1"); // fallisce qui con un messaggio chiaro se il DB non è raggiungibile
} catch (err) {
  console.error("db-migrate-all: DATABASE_URL non raggiungibile:", err.message);
  process.exit(1);
}

/* ── guardia: senza le tabelle base di neon/schema.sql non si procede ──
 * Le migration di neon/migrations/ modificano tabelle create da
 * neon/schema.sql (conversations, leads, …): su un DB vergine ogni file
 * cadrebbe con «relation does not exist». Il percorso ufficiale applica
 * PRIMA la base (wizard /setup, scripts/e2e-db-reset.mjs, oppure psql a
 * mano): qui lo verifichiamo in una sola query di sola lettura e usciamo
 * presto con l'istruzione — zero scritture su un DB che non è a posto,
 * nemmeno il bootstrap del tracciamento che viene dopo. */
if (!dryRun) {
  const BASE_TABLES = ["operators", "conversations", "messages", "leads", "admin_users", "content_settings"];
  const baseCheck = BASE_TABLES.map((t) => `to_regclass('public.${t}') is null as missing_${t}`).join(", ");
  const { rows } = await pool.query(`select ${baseCheck}`);
  const missing = BASE_TABLES.filter((t) => rows[0]?.[`missing_${t}`]);
  if (missing.length > 0) {
    console.error(`db-migrate-all: questo database non ha lo schema di base (mancano: ${missing.join(", ")}).`);
    console.error("  Le migration presuppongono le tabelle create da neon/schema.sql: senza di esse ogni file fallirebbe con «relation does not exist».");
    console.error("  Il percorso giusto è uno di questi:");
    console.error("    - il wizard d'installazione (/setup), che applica schema e migration nell'ordine;");
    console.error("    - applicare prima la base a mano:  psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f neon/schema.sql");
    console.error("  (lo stesso ordine di scripts/e2e-db-reset.mjs: prima schema.sql, poi le migration)");
    process.exit(1);
  }
}

/* ── tracciamento (026-schema-migrations) ──
 *
 * La tabella rende il report ESATTO: chi ha già una riga NON viene
 * rieseguito (i file con CREATE RULE, senza IF NOT EXISTS, fallirebbero).
 * Bootstrap additivo: se la tabella non c'è (DB vecchi), il runner la
 * crea, esegue TUTTI i file (idempotenti) e registra il backfill.
 * Il checksum rileva file modificati DOPO l'applicazione (drift).
 */

const checksumOf = (sql) => createHash("sha256").update(sql).digest("hex").slice(0, 16);
const TRACK_TABLE = "schema_migrations";

const recorded = new Map(); // filename -> { checksum, applied_at }
const tracked = await pool
  .query(
    `create table if not exists ${TRACK_TABLE} (
       filename   text primary key,
       checksum   text not null,
       applied_at timestamptz not null default now(),
       runner     text not null default 'db-migrate-all'
     )`
  )
  .then(() => pool.query(`select filename, checksum, applied_at from ${TRACK_TABLE}`))
  .then(({ rows }) => {
    for (const r of rows) recorded.set(r.filename, r);
    return rows.length;
  });
const freshTable = tracked === 0 && files.length > 0;
if (freshTable && !dryRun) {
  console.log(`tracciamento: ${TRACK_TABLE} appena creata — tutti i file verranno eseguiti (idempotenti) e registrati (backfill).\n`);
}

for (const file of files) {
  const full = path.join(MIGRATIONS_DIR, file);
  const sql = readFileSync(full, "utf8");
  const checksum = checksumOf(sql);

  if (dryRun) {
    results.push({ file, status: "DRY-RUN", detail: `${sql.split(";").filter((s) => s.trim()).length} statement` });
    continue;
  }

  // Già tracciata: niente riesecuzione. Con checksum diverso = file
  // modificato DOPO l'applicazione: warning esplicito (drift), non errori.
  const rec = recorded.get(file);
  if (rec) {
    if (rec.checksum !== checksum) {
      results.push({ file, status: "DRIFT", detail: `file modificato dopo l'applicazione (checksum ${rec.checksum} → ${checksum}): la riga registra la versione applicata` });
    } else {
      results.push({ file, status: "TRACCIATA" });
    }
    skipped++;
    continue;
  }

  try {
    await pool.query(sql);
    await pool.query(`insert into ${TRACK_TABLE} (filename, checksum) values ($1, $2) on conflict (filename) do nothing`, [file, checksum]);
    results.push({ file, status: "APPLICATA" });
    applied++;
  } catch (err) {
    if (ALREADY_RE.test(err.message)) {
      const note = KNOWN_RULES.get(file);
      // Lo schema c'era ma nessuna riga: registra il backfill, il prossimo
      // giro il file salterà (con CREATE RULE evita anche il fallimento).
      await pool.query(`insert into ${TRACK_TABLE} (filename, checksum) values ($1, $2) on conflict (filename) do nothing`, [file, checksum]);
      results.push({ file, status: "GIÀ APPLICATA", detail: note ?? err.message });
      already++;
    } else {
      results.push({ file, status: "ERRORE", detail: err.message });
      failed++;
    }
  }
}

await pool.end();

/* ── report ── */

const pad = "  ";
const ICONS = { "APPLICATA": "✚", "TRACCIATA": "✓", "GIÀ APPLICATA": "·", "ERRORE": "✖", "DRY-RUN": "?", "DRIFT": "⚠" };

console.log(`db-migrate-all — ${files.length} migration in neon/migrations/`);
console.log("");
for (const r of results) {
  const extra = r.detail ? ` — ${r.detail}` : "";
  console.log(`${pad}${ICONS[r.status]} ${r.file.padEnd(28)} ${r.status}${extra}`);
}
console.log("");
if (dryRun) {
  console.log(`dry-run completato: ${files.length} migration verrebbero applicate in ordine. Per eseguire: npm run db:migrate`);
} else {
  console.log(`riepilogo: ${applied} applicate adesso · ${skipped} già tracciate in schema_migrations · ${already} backfillate · ${failed} in errore`);
  if (failed > 0) {
    console.log("\nIl DB è in uno stato parzialmente allineato: risolvi gli errori e rilancia (i file già a posto sono tracciati e verranno saltati).");
    process.exit(1);
  }
}
