#!/usr/bin/env node
/**
 * Pulizia dati operativi (conversazioni, messaggi, lead, callbacks) per
 * ripartire puliti in produzione. NON tocca operators né admin_users.
 *
 * Uso:
 *   node scripts/db-clean.mjs --dry-run    mostra cosa cancellerebbe (default)
 *   node scripts/db-clean.mjs --yes        cancella davvero
 *
 * Richiede DATABASE_URL nell'ambiente (es. da .env.local).
 */

import { Pool } from "pg";
import { readFileSync } from "node:fs";

// carica .env.local se DATABASE_URL non è già nell'ambiente
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
const dryRun = !args.includes("--yes");

// ordine FK: i figli prima dei padri
const TABLES = ["messages", "callbacks", "leads", "conversations"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const counts = {};
  for (const t of TABLES) {
    const { rows } = await pool.query(`select count(*)::int as n from ${t}`);
    counts[t] = rows[0].n;
  }

  const preserved = await pool.query(
    "select count(*)::int as n from operators"
  );
  const admins = await pool.query("select count(*)::int as n from admin_users");

  console.log("── Stato attuale ──");
  for (const t of TABLES) console.log(`  ${t.padEnd(15)} ${counts[t]}`);
  console.log(`  (preservati: ${preserved.rows[0].n} operatori, ${admins.rows[0].n} admin)\n`);

  if (dryRun) {
    console.log("DRY RUN — niente cancellato. Per pulire davvero:");
    console.log("  node scripts/db-clean.mjs --yes");
  } else {
    console.log("Cancellazione in corso…");
    await pool.query("begin");
    for (const t of TABLES) {
      const res = await pool.query(`delete from ${t}`);
      console.log(`  ${t.padEnd(15)} ${res.rowCount} righe cancellate`);
    }
    await pool.query("commit");
    console.log("\n✅ Database operativo pulito: pronto per i lead veri.");
  }
} catch (e) {
  console.error("Errore:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
