#!/usr/bin/env node
/**
 * SETUP LOCALHOST — installer one-command per un ambiente locale pulito.
 *
 *   npm run setup:local -- --dry-run           mostra il piano, non tocca nulla
 *   npm run setup:local                        installa tutto su localhost
 *   npm run setup:local -- --admin-email=io@me.it --admin-password=LungaSicura1
 *   npm run setup:local -- --dsn=postgresql://utente:pass@localhost:5432/db
 *
 * Che cosa fa (in ordine, ogni passo idempotente):
 *   1. dipendenze npm (npm install se node_modules/pg manca);
 *   2. ruolo Postgres locale (CREATE ROLE se manca, mai toccato se esiste);
 *   3. database locale (CREATE DATABASE OWNER ruolo);
 *   4. schema base      → psql -f neon/schema.sql (idempotente, percorso ufficiale);
 *   5. migration        → node scripts/db-migrate-all.mjs (tracking schema_migrations);
 *   6. super admin      → node scripts/create-admin.mjs (scrypt, stessa convenzione repo);
 *   7. .env.local       → DATABASE_URL puntato a localhost (+ backup in backups/).
 *
 * Convenzioni rispettate (NESSUN file dell'installer web /setup viene toccato):
 *  - il DSN locale è l'unica fonte: il wizard /setup resta il percorso web;
 *  - password admin via argomento, altrimenti generata (crypto.randomBytes)
 *    e mostrata una volta sola in console;
 *  - ADMIN_SESSION_SECRET esistente conservato, come fa il wizard;
 *  - il DSN precedente in .env.local non si butta: backup in backups/ e
 *    copia commentata nel file per il rollback manuale.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

/* ── argomenti ── */

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const has = (name) => args.includes(`--${name}`);

const DRY_RUN = has("dry-run") || has("n");
const RESET_DB_PASSWORD = has("reset-db-password");

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/* ── .env.local esistente (parser manuale, come db-migrate-all e create-admin) ── */

// Nota: il flag si chiama --env e NON --env-file (opzione nativa di node,
// che npm aggancerebbe a se stesso prima che lo script la veda).
const ENV_FILE = flag("env") ?? ".env.local";
const envNow = new Map();
try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !envNow.has(m[1])) envNow.set(m[1], m[2].replace(/^"(.*)"$/, "$1"));
  }
} catch {
  // .env.local assente: prima installazione, verrà creato al passo 7
}

/* ── configurazione target ── */

const DB_HOST = flag("db-host") ?? "localhost";
const DB_PORT = flag("db-port") ?? "5432";
const DB_NAME = flag("db-name") ?? "webagencycrema";
const DB_USER = flag("db-user") ?? "wac";
const ADMIN_DSN = flag("admin-dsn") ?? `postgresql://${DB_HOST}:${DB_PORT}/postgres`;

const existingDsn = envNow.get("DATABASE_URL")?.trim() || "";
let dbPassword = flag("db-password") ?? "";
let dsn;

if (flag("dsn")) {
  dsn = flag("dsn");
  const u = new URL(dsn);
  dbPassword = decodeURIComponent(u.password || "");
} else {
  // Password del ruolo: da flag; su un ruolo già esistente senza password nota
  // si può rigenerare con --reset-db-password; altrimenti user@localhost via trust.
  dbPassword = dbPassword || safeDecode(existingDsn.match(/^postgres(ql)?:\/\/[^:]+:([^@]*)@/)?.[2] || "");
  dsn = `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(dbPassword)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

const ADMIN_EMAIL = (flag("admin-email") ?? envNow.get("ADMIN_EMAIL") ?? "admin@localhost").toLowerCase();
const ADMIN_PASSWORD = flag("admin-password") ?? process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "";
const SITE_URL = flag("site-url") ?? (envNow.get("NEXT_PUBLIC_SITE_URL")?.trim() || "http://localhost:3200");

const isLocal = (s) => /@(localhost|127\.0\.0\.1|::1)[:/]/.test(s);
const maskDsn = (s) => {
  try {
    const u = new URL(s);
    const auth = u.username ? `${u.username}:${u.password ? "••••" : ""}@` : "";
    return `${u.protocol}//${auth}${u.host}${u.pathname}`;
  } catch {
    return "(dsn non valido)";
  }
};

/* ── util ── */

const qident = (s) => `"${s.replace(/"/g, '""')}"`;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const info = (msg) => console.log(`  · ${msg}`);
const die = (msg) => {
  console.error(`\n  ✖ ${msg}`);
  process.exit(1);
};
const generatedPassword = () => randomBytes(12).toString("base64url"); // 16 char, no escape

/* ── piano ── */

const nodeModulesReady = existsSync("node_modules/pg");
const adminPasswordFinal = ADMIN_PASSWORD || generatedPassword();
const dbPasswordWasGenerated = !dbPassword;
if (dbPasswordWasGenerated) dbPassword = generatedPassword();
// Il DSN si costruisce DOPO l'assegnazione della password (generata o da flag):
// costruirlo prima lasciava una password vuota nel DSN scritto su file.
if (!flag("dsn")) {
  dsn = `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(dbPassword)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

console.log("\n== Setup localhost — WebAgencyCrema ==\n");
console.log("Piano di installazione:");
console.log(`  1. Dipendenze npm        — ${nodeModulesReady ? "già presenti" : "npm install"}`);
console.log(`  2. Ruolo DB              — ${DB_USER} su ${DB_HOST}:${DB_PORT}${RESET_DB_PASSWORD ? " (password reimpostata)" : dbPasswordWasGenerated ? " (password generata)" : ""}`);
console.log(`  3. Database              — ${DB_NAME} (owner ${DB_USER})`);
console.log(`  4. Schema base           — psql -f neon/schema.sql`);
console.log(`  5. Migration             — node scripts/db-migrate-all.mjs`);
console.log(`  6. Super admin           — ${ADMIN_EMAIL}`);
console.log(`  7. .env.local            — DATABASE_URL → ${maskDsn(dsn)}`);
if (existingDsn && existingDsn !== dsn) {
  console.log(`     ⚠ esiste già un DATABASE_URL diverso (${maskDsn(existingDsn)}): backup in backups/ e copia commentata per il rollback`);
}
console.log("");

if (DRY_RUN) {
  console.log("dry-run: nessuna modifica eseguita. Per installare: npm run setup:local\n");
  process.exit(0);
}

/* ── 1. dipendenze ── */

console.log("[1/7] Dipendenze npm");
if (nodeModulesReady) {
  ok("node_modules/pg presente: npm install saltato");
} else {
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { stdio: "inherit" });
  if (r.status !== 0) die("npm install fallito: controlla l'output sopra.");
  ok("dipendenze installate");
}

const pg = (await import("pg")).default;

const poolOpts = { max: 1, connectionTimeoutMillis: 5000, ssl: false };

/* ── 2. ruolo DB ── */

console.log("\n[2/7] Ruolo PostgreSQL");
const admin = new pg.Pool({ ...poolOpts, connectionString: ADMIN_DSN });
try {
  await admin.query("select 1");
} catch (err) {
  die(`Amministrazione Postgres non raggiungibile su ${ADMIN_DSN}: ${err.message}
      Su macOS/Homebrew il trust locale basta: verifica con  psql -d postgres -c "select 1".`);
}
const roleKnown = await admin.query("select 1 from pg_roles where rolname = $1", [DB_USER]);
const sqlQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'"; // statement utility: niente bind params
if (roleKnown.rowCount === 0) {
  await admin.query(`create role ${qident(DB_USER)} login password ${sqlQuote(dbPassword)}`);
  ok(`ruolo ${DB_USER} creato (password: ${dbPassword}) — conservala nel DSN`);
} else if (RESET_DB_PASSWORD) {
  await admin.query(`alter role ${qident(DB_USER)} password ${sqlQuote(dbPassword)}`);
  ok(`password del ruolo ${DB_USER} reimpostata`);
} else {
  info(`ruolo ${DB_USER} già esistente: intoccato${dbPasswordWasGenerated ? " (se la password non è nota: --db-password=… o --reset-db-password)" : ""}`);
}

/* ── 3. database ── */

console.log("\n[3/7] Database");
const dbKnown = await admin.query("select 1 from pg_database where datname = $1", [DB_NAME]);
if (dbKnown.rowCount === 0) {
  await admin.query(`create database ${qident(DB_NAME)} owner ${qident(DB_USER)}`);
  ok(`database ${DB_NAME} creato (owner ${DB_USER})`);
} else {
  info(`database ${DB_NAME} già esistente: intoccato`);
}
await admin.end();

// Probe col DSN finale: se il ruolo esisteva con un'altra password, l'errore
// arriva QUI con l'istruzione giusta, non a metà schema.sql.
const probe = new pg.Pool({ ...poolOpts, connectionString: dsn });
try {
  await probe.query("select 1");
  await probe.end();
} catch (err) {
  die(`Connessione col DSN costruito fallita (${err.message}).\n      Se il ruolo ${DB_USER} esiste con un'altra password: riesegui con --db-password=… oppure --reset-db-password.`);
}

/* ── 4. schema base (psql, percorso ufficiale di neon/schema.sql) ── */

console.log("\n[4/7] Schema base (neon/schema.sql)");
if (!existsSync("neon/schema.sql")) die("neon/schema.sql mancante: sei nella root del repo?");
const psql = spawnSync(
  "psql",
  ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", dsn, "-f", "neon/schema.sql"],
  { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
);
if (psql.status !== 0) die(`schema.sql fallito: ${(psql.stderr || "").trim().split("\n").slice(-3).join(" · ")}`);
ok("tabelle base, indici e seed applicati (idempotente)");

/* ── 5. migration (runner ufficiale del repo, tracking schema_migrations) ── */

console.log("\n[5/7] Migration (neon/migrations/)");
const mig = spawnSync(process.execPath, ["scripts/db-migrate-all.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: dsn },
});
if (mig.status !== 0) die("db-migrate-all fallito: controlla il report sopra.");
ok("migration allineate");

/* ── 6. super admin (stesso scrypt di src/lib/admin.ts) ── */

console.log("\n[6/7] Super admin");
// Rerun non-interferente: se l'admin esiste già e la password non è stata
// passata esplicitamente, l'hash scrypt NON viene ruotato — il cambio di
// password_hash ucciderebbe all'istante le sessioni /admin aperte (il
// fingerprint della password è dentro ogni cookie di sessione).
// Per reimpostarla a mano: npm run admin:create email "nuovaPassword"
const admCheck = new pg.Pool({ ...poolOpts, connectionString: dsn });
const adminAlreadyThere = await admCheck
  .query("select 1 from admin_users where email = $1", [ADMIN_EMAIL])
  .then((r) => r.rowCount > 0)
  .catch(() => false);
await admCheck.end();

if (adminAlreadyThere && !flag("admin-password")) {
  ok(`admin ${ADMIN_EMAIL} già esistente: hash intoccato (sessioni /admin preservate)`);
} else {
  const adm = spawnSync(process.execPath, ["scripts/create-admin.mjs", ADMIN_EMAIL, adminPasswordFinal], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: dsn },
  });
  if (adm.status !== 0) die(`create-admin fallito: ${(adm.stderr || adm.stdout || "").trim()}`);
  ok(`admin pronto: ${ADMIN_EMAIL}`);
}

/* ── 7. .env.local (backup prima di toccare; segreto esistente conservato) ── */

console.log("\n[7/7] " + ENV_FILE);
let existingContent = "";
try {
  existingContent = readFileSync(ENV_FILE, "utf8");
} catch {
  // file assente: si crea da zero
}

const keepSecret = envNow.get("ADMIN_SESSION_SECRET")?.trim() || randomBytes(32).toString("base64url");
const BLOCK_START = "# ── Setup localhost (scripts/setup-localhost.mjs) ──";
const localBlock = [
  BLOCK_START,
  `NEXT_PUBLIC_SITE_URL=${SITE_URL}`,
  `DATABASE_URL=${dsn}`,
  `ADMIN_SESSION_SECRET=${keepSecret}`,
  "",
  "",
].join("\n");

// Rerun = convergenza: i blocchi setup-localhost precedenti si SOSTITUISCONO
// (mai duplicati). Il resto del file resta com'è.
const blockStart = existingContent.indexOf(BLOCK_START);
const baseContent = blockStart === -1 ? existingContent : existingContent.slice(0, blockStart).replace(/\s+$/, "\n");

// Un DSN attivo NON-locale viene commentato per il rollback (una volta sola:
// i rerun successivi trovano solo righe di commento o localhost).
const activeRemoteDsn = existingContent
  .split("\n")
  .map((l) => l.match(/^(DATABASE_URL=.+)$/)?.[1])
  .find((v) => v && !isLocal(v));

let finalContent = baseContent + localBlock;
if (existingDsn === dsn && existingContent === baseContent + localBlock) {
  ok(".env.local già corretto: byte-identico, niente riscrittura (next dev non ricarica le env)");
} else if (activeRemoteDsn) {
  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `backups/.env.local.pre-setup-${stamp}`;
  writeFileSync(backupPath, existingContent, { mode: 0o600 });
  const escaped = activeRemoteDsn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  finalContent = finalContent.replace(
    new RegExp(`^${escaped}$`, "m"),
    `# [setup-localhost ${stamp}] vecchio DSN: ${activeRemoteDsn}`,
  );
  writeFileSync(ENV_FILE, finalContent, { mode: 0o600 });
  ok(`DATABASE_URL aggiornato a localhost — backup precedente: ${backupPath}`);
} else if (blockStart === -1) {
  writeFileSync(ENV_FILE, finalContent, { mode: 0o600 });
  ok("DATABASE_URL e ADMIN_SESSION_SECRET aggiunti");
} else {
  writeFileSync(ENV_FILE, finalContent, { mode: 0o600 });
  ok("blocco localhost aggiornato (i blocchi precedenti sono stati sostituiti)");
}

/* ── report finale ── */

console.log("\n== Installazione localhost completata ==\n");
console.log(`  1. Avvia il sito:      npm run dev${flag("env") ? `  (oppure: WAC_ENV_FILE=${ENV_FILE} node scripts/localhost-dev-server.mjs -p 3300)` : ""}`);
console.log(`  2. Apri:               ${SITE_URL}`);
console.log(`  3. Admin:              ${SITE_URL}/admin`);
console.log(`     email:              ${ADMIN_EMAIL}`);
console.log(`     password:           ${adminPasswordFinal}`);
if (dbPasswordWasGenerated) console.log(`  4. DSN (già scritto in .env.local): ${maskDsn(dsn)}`);
console.log("");
