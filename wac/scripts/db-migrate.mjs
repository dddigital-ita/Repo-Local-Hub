#!/usr/bin/env node
/* Runner SQL per Neon: legge DATABASE_URL da .env.local ed esegue un file .sql. */
import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("uso: node scripts/db-migrate.mjs <file.sql>");
  process.exit(1);
}

const env = readFileSync(".env.local", "utf8");
const match = env.match(/^DATABASE_URL=["']?([^"'\n]+)["']?\s*$/m);
if (!match) {
  console.error("DATABASE_URL non trovata in .env.local");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: match[1], ssl: match[1].includes("localhost") ? false : { rejectUnauthorized: false } });
const sql = readFileSync(file, "utf8");
try {
  await pool.query(sql);
  console.log(`OK: ${file} applicata`);
} catch (err) {
  console.error("ERRORE:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
