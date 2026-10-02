#!/usr/bin/env node
/**
 * RESET del DB E2E (disposable, locale): drop + create + schema + migration.
 *
 *   node scripts/e2e-db-reset.mjs
 *
 * Cosa fa:
 *   1. DROP DATABASE was_e2e (termina le connessioni residue del dev server E2E)
 *   2. CREATE DATABASE was_e2e
 *   3. Applica neon/schema.sql (tabelle base) — via psql, come la procedura manuale
 *   4. Applica tutte le migration di neon/migrations/ in ordine (runner del repo)
 *
 * Utile anche a mano: il DB di E2E è sempre ricreabile da zero, zero stato nascosto.
 * Prod è intoccabile: il DSN è hardcoded locale e il runner usa DATABASE_URL
 * passata dall'ambiente (scripts/db-migrate-all.mjs legge env, non .env.local,
 * quando è impostata).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB = process.env.E2E_PGDATABASE ?? "was_e2e";
const HOST = process.env.E2E_PGHOST ?? "localhost";
const PORT = process.env.E2E_PGPORT ?? "5432";
// In locale (trust auth) la password non serve e nessun utente esplicito:
// libpq usa l'utente del SO (superuser del Postgres Homebrew). In CI il
// servizio Postgres di GitHub Actions esige password: passare E2E_PGPASSWORD.
const PASS = process.env.E2E_PGPASSWORD;
const USER = process.env.E2E_PGUSER ?? (PASS ? "postgres" : "");
const CRED = USER ? (PASS ? `${USER}:${PASS}@` : `${USER}@`) : "";
const ADMIN_DSN = `postgresql://${CRED}${HOST}:${PORT}/postgres`;

function psql(dsn, file) {
  execFileSync("psql", [dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

// 1+2: drop & create
execFileSync(
  "psql",
  [ADMIN_DSN, "-v", "ON_ERROR_STOP=1", "-q", "-c", `drop database if exists ${DB};`, "-c", `create database ${DB};`],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const schema = path.join(ROOT, "neon", "schema.sql");
if (!existsSync(schema)) {
  console.error(`schema non trovato: ${schema}`);
  process.exit(1);
}
psql(`postgresql://${CRED}${HOST}:${PORT}/${DB}`, schema);

// 4: migration del repo, col runner ufficiale, puntato al DB di E2E
const e2eDsn = `postgresql://${CRED}${HOST}:${PORT}/${DB}`;
execFileSync("node", ["scripts/db-migrate-all.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: e2eDsn },
});

console.log(`\ne2e db pronto: ${e2eDsn}`);
