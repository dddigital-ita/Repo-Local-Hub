import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { hashPassword } from "./admin";
import { db } from "./db";

/**
 * MOTORE DEL WIZARD D'INSTALLAZIONE (/setup) — l'equivalente web di
 * `npm run db:migrate` + `npm run admin:create`, orchestrato in un'unica
 * corsa guidata stile WordPress.
 *
 * Regole del repo rispettate:
 *  - le migration di neon/migrations/ sono additive e idempotenti (create
 *    if not exists, insert on conflict do nothing): rieseguirle su un DB
 *    già a posto non è un errore;
 *  - il tracciamento schema_migrations (migration 026) evita le
 *    riesecuzioni dei file con CREATE RULE senza IF NOT EXISTS (010, 024);
 *  - senza DATABASE_URL il sito degrada elegantemente: la pagina /setup
 *    parte comunque (niente DB richiesto per l'avvio).
 *
 * Sicurezza:
 *  - il wizard è una CORSA UNICA: al termine scrive il lock (file +
 *    riga su DB) e la pagina /setup smette di esistere (404, vedi layout);
 *  - le credenziali passano solo via server action e NON vengono mai
 *    ri-esposte: nei report la password non compare mai;
 *  - .env.local viene scritto con chmod 600 (best effort su cPanel).
 *
 * Nota Passenger/cPanel: il processo parte SENZA le env, quindi TUTTE le
 * query del wizard usano un pool proprio costruito sul DSN inserito
 * nell'installazione — non il pool di lib/db (che leggerebbe DATABASE_URL
 * mancante e restituirebbe null).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "neon", "migrations");
const ENV_FILE = path.join(process.cwd(), ".env.local");
const LOCK_FILE = path.join(process.cwd(), ".setup-completed");

/** Errori Postgres che su migration additive significano «già applicata». */
const ALREADY_RE = /already exists|duplicate key value violates unique constraint/i;
/** CREATE RULE senza IF NOT EXISTS: ricadono qui su uno schema esistente. */
const KNOWN_RULES = new Map([
  ["010-audit-log.sql", "CREATE RULE senza IF NOT EXISTS: innocuo se audit_log esiste già (applicata in passato)"],
  ["024-backup-history.sql", "CREATE RULE senza IF NOT EXISTS: innocuo se backup_history esiste già (applicata in passato)"],
]);

export type SetupState = "unconfigured" | "in_progress" | "completed";

export interface DbProbe {
  ok: boolean;
  server?: string;
  database?: string;
  user?: string;
  ssl?: boolean;
  error?: string;
}

export type LogLevel = "info" | "ok" | "warn" | "error";
export interface StepLog {
  step: string;
  level: LogLevel;
  message: string;
  at: string;
}
export interface InstallInput {
  siteUrl: string;
  dsn: string;
  adminEmail: string;
  adminPassword: string;
}
export interface InstallResult {
  ok: boolean;
  error?: string;
  logs: StepLog[];
}

/* ── pool dedicato al wizard ──
 * Stessa euristica SSL di lib/db.ts (localhost = senza SSL, gestito = SSL)
 * e flag uselibpqcompat=true per silenziare il warning di pg. Timeout corto:
 * l'utente non deve stare 30s su un host sbagliato. */

function createSetupPool(dsn: string): pg.Pool {
  const connectionString = dsn + (dsn.includes("?") ? "&" : "?") + "uselibpqcompat=true";
  return new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    ssl: dsn.includes("localhost") ? false : { rejectUnauthorized: false },
  });
}

function describePgError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e?.code) {
    case "ECONNREFUSED":
      return "Connessione rifiutata: il server PostgreSQL non risponde su quell'host/porta. Verifica host e porta (di solito 5432).";
    case "ETIMEDOUT":
    case "ENOTFOUND":
      return "Host non raggiungibile: controlla il nome host (su cPanel di solito «localhost»).";
    case "28P01":
      return "Password dell'utente database errata (errore PostgreSQL 28P01).";
    case "3D000":
      return "Database inesistente: crea il database dal pannello (PostgreSQL Database Wizard).";
    case "28000":
    case "42501":
      return "L'utente database non ha i permessi su questo database: ricrea l'utente col Wizard del pannello.";
    default:
      return e?.message ?? "Errore sconosciuto";
  }
}

/* ── stato del setup ── */

/**
 * Stato corrente: «unconfigured» = wizard disponibile; «in_progress» = lock
 * file presente ma installazione non conclusa (riprendibile); «completed» =
 * installazione conclusa (lock file O riga su DB): /setup è chiuso per sempre.
 */
export async function setupState(): Promise<SetupState> {
  try {
    if (existsSync(LOCK_FILE)) {
      return readFileSync(LOCK_FILE, "utf8").includes("completed") ? "completed" : "in_progress";
    }
  } catch {
    // file illeggibile: si prosegue con i controlli seguenti
  }
  // Il lock su DB conta anche senza file (es. filesystem ricostruito):
  // se il DB dice «completato», il wizard resta chiuso.
  const pool = db();
  if (pool) {
    try {
      const res = await pool.query<{ completed: boolean }>(
        "select completed from setup_lock where singleton = 1",
      );
      if (res.rows[0]?.completed) return "completed";
    } catch {
      // tabella assente (prima installazione) o DB irraggiungibile: prosegui
    }
  }
  return "unconfigured";
}

function markInProgress(): void {
  writeFileSync(LOCK_FILE, `in_progress ${new Date().toISOString()}\n`);
}

function markCompleted(): void {
  try {
    writeFileSync(LOCK_FILE, `completed ${new Date().toISOString()}\n`);
    chmodSync(LOCK_FILE, 0o600);
  } catch {
    // permessi restrittivi non garantiti su tutti gli hosting: il lock su DB
    // e la chiusura della rotta restano la protezione principale
  }
}

/* ── probe database (step 2 del wizard) ── */

export async function testConnection(dsnInput: string): Promise<DbProbe> {
  const dsn = dsnInput.trim();
  let parsed: URL;
  try {
    parsed = new URL(dsn);
  } catch {
    return { ok: false, error: "Connection string non valida: deve iniziare con postgresql:// o postgres://" };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { ok: false, error: "Protocollo errato: la connection string PostgreSQL inizia con postgresql://" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "Host mancante nella connection string (su cPanel di solito: postgresql://utente:password@localhost:5432/nomedb)" };
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    return { ok: false, error: "Nome database mancante nella connection string (dopo l'ultima barra)" };
  }

  const pool = createSetupPool(dsn);
  try {
    const v = await pool.query<{ version: string; db: string; user: string }>(
      "select version() as version, current_database() as db, current_user as user",
    );
    const row = v.rows[0];
    return {
      ok: true,
      server: row.version.split(" on ")[0], // «PostgreSQL 16.4 (…)»
      database: row.db,
      user: row.user,
      ssl: !dsn.includes("localhost"),
    };
  } catch (err) {
    return { ok: false, error: describePgError(err) };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/* ── scrittura .env.local ── */

const mask = (value: string) => (value.length <= 4 ? "••••" : `${value.slice(0, 2)}••••${value.slice(-2)}`);

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function buildEnvContent(siteUrl: string, dsn: string, previousSecret: string | null): string {
  const lines = [
    "# Generato dal wizard d'installazione (/setup) — non committare mai questo file.",
    "",
    "# ── Sito ──",
    `NEXT_PUBLIC_SITE_URL=${siteUrl}`,
    "",
    "# ── Database PostgreSQL ──",
    `DATABASE_URL=${dsn}`,
    "",
    "# ── Sessioni admin ──",
    `ADMIN_SESSION_SECRET=${previousSecret ?? randomSecret()}`,
    "",
    "# ── Email notifiche (opzionale: configura dopo da /admin) ──",
    "# RESEND_API_KEY=",
    "# NOTIFY_EMAIL=",
    '# EMAIL_FROM="Nome Agenzia <noreply@dominio.it>"',
    "",
    "# ── Telegram (opzionale) ──",
    "# TELEGRAM_BOT_TOKEN=",
    "# TELEGRAM_CHAT_ID=",
    "# Secret del webhook bidirezionale (stesso valore passato a scripts/telegram-webhook.mjs):",
    "# TELEGRAM_WEBHOOK_SECRET=",
    "# Sviluppo locale senza HTTPS: polling al posto del webhook:",
    "# TELEGRAM_POLLING=1",
    "",
  ];
  return lines.join("\n");
}

function readExistingEnvSecret(): string | null {
  try {
    const content = readFileSync(ENV_FILE, "utf8");
    const m = content.match(/^ADMIN_SESSION_SECRET=(.+)$/m);
    return m?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

/* ── migration runner (logica identica a scripts/db-migrate-all.mjs) ── */

interface MigrationOutcome {
  file: string;
  status: "applicata" | "tracciata" | "backfill" | "errore" | "drift";
  detail?: string;
}

export function splitSqlStatements(sql: string): string[] {
  /* Tokenizer minimale ma corretto per i file SQL del repo:
   * - i commenti «-- …» (a inizio riga E inline, pieni di «;» e apostrofi
   *   italiani) vengono RIMOSSI, non solo protetti: un frammento di
   *   commento arrivato a Postgres produce «syntax error at or near "ogni"»;
   * - le stringhe con apici (escape «''» compreso) restano intere;
   * - i dollar-quoted ($$…$$ e $tag$…$tag$, come il blocco do $$ di 028)
   *   proteggono i «;» interni dallo split. */
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // commento di riga: dal «--» alla fine della riga
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      current += " ";
      continue;
    }
    // stringa con apici, con escape raddoppiato ('')
    if (ch === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      current += sql.slice(start, i);
      continue;
    }
    // dollar-quoted: $$…$$ oppure $tag$…$tag$
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      const s = current.trim();
      if (s) statements.push(s);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function runMigrations(
  pool: pg.Pool,
  log: (level: LogLevel, msg: string) => void,
): Promise<{ ok: boolean; outcomes: MigrationOutcome[] }> {
  const outcomes: MigrationOutcome[] = [];
  if (!existsSync(MIGRATIONS_DIR)) {
    log("error", `Directory migration non trovata: ${MIGRATIONS_DIR} — hai caricato la cartella neon/ sul server?`);
    return { ok: false, outcomes };
  }
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    log("error", "Nessun file .sql in neon/migrations/: caricamento incompleto.");
    return { ok: false, outcomes };
  }
  log("info", `${files.length} migration trovate in neon/migrations/`);

  // Tracciamento (026): bootstrap additivo, come il runner CLI.
  const TRACK = "schema_migrations";
  await pool.query(
    `create table if not exists ${TRACK} (
       filename   text primary key,
       checksum   text not null,
       applied_at timestamptz not null default now(),
       runner     text not null default 'setup-wizard'
     )`,
  );
  const recorded = new Map<string, string>();
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    `select filename, checksum from ${TRACK}`,
  );
  for (const r of rows) recorded.set(r.filename, r.checksum);

  const checksumOf = (sql: string) => createHash("sha256").update(sql).digest("hex").slice(0, 16);
  let failed = 0;

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = checksumOf(sql);
    const rec = recorded.get(file);
    if (rec !== undefined) {
      outcomes.push({
        file,
        status: rec === checksum ? "tracciata" : "drift",
        detail: rec === checksum ? undefined : "file modificato dopo l'applicazione",
      });
      continue;
    }
    try {
      for (const statement of splitSqlStatements(sql)) {
        await pool.query(statement);
      }
      await pool.query(
        `insert into ${TRACK} (filename, checksum) values ($1, $2) on conflict (filename) do nothing`,
        [file, checksum],
      );
      outcomes.push({ file, status: "applicata" });
    } catch (err) {
      const message = (err as Error).message ?? "errore";
      if (ALREADY_RE.test(message)) {
        await pool.query(
          `insert into ${TRACK} (filename, checksum) values ($1, $2) on conflict (filename) do nothing`,
          [file, checksum],
        );
        outcomes.push({ file, status: "backfill", detail: KNOWN_RULES.get(file) ?? message });
      } else {
        outcomes.push({ file, status: "errore", detail: message });
        failed++;
      }
    }
  }

  for (const o of outcomes) {
    const extra = o.detail ? ` — ${o.detail}` : "";
    const level: LogLevel =
      o.status === "errore" ? "error" : o.status === "drift" ? "warn" : o.status === "applicata" ? "ok" : "info";
    log(level, `${o.file} · ${o.status}${extra}`);
  }
  if (failed > 0) {
    log("error", `${failed} migration in errore: l'installazione si interrompe qui (rilancia il wizard: i file a posto sono tracciati e verranno saltati).`);
  }
  return { ok: failed === 0, outcomes };
}

/* ── installazione completa ── */

export async function runInstall(input: InstallInput): Promise<InstallResult> {
  const logs: StepLog[] = [];
  const log = (step: string, level: LogLevel, message: string) =>
    logs.push({ step, level, message, at: new Date().toISOString() });

  markInProgress();

  const siteUrl = input.siteUrl.trim().replace(/\/+$/, "");
  const dsn = input.dsn.trim();
  const email = input.adminEmail.trim().toLowerCase();
  const pool = createSetupPool(dsn);

  try {
    /* 1 — DB */
    log("db", "info", "Verifica della connessione al database…");
    const probe = await testConnection(dsn);
    if (!probe.ok) {
      log("db", "error", probe.error ?? "Connessione fallita");
      return { ok: false, error: probe.error, logs };
    }
    log("db", "ok", `Connesso: ${probe.server} · database «${probe.database}» · utente «${probe.user}»${probe.ssl ? " · SSL" : ""}`);

    /* 2 — estensione per gen_random_uuid (PG < 13 lo richiede) */
    log("ext", "info", "Verifica dell'estensione pgcrypto (serve a gen_random_uuid sui vecchi PostgreSQL)…");
    try {
      await pool.query("create extension if not exists pgcrypto");
      log("ext", "ok", "Estensione pgcrypto pronta.");
    } catch {
      const check = await pool
        .query<{ has: boolean }>("select to_regproc('gen_random_uuid') is not null as has")
        .catch(() => ({ rows: [{ has: false }] }));
      if (!check.rows[0]?.has) {
        const msg =
          "gen_random_uuid() non disponibile e pgcrypto non installabile con questo utente. " +
          "Apri phpPgAdmin dal pannello ed esegui: CREATE EXTENSION pgcrypto; — poi rilancia il wizard.";
        log("ext", "error", msg);
        return { ok: false, error: msg, logs };
      }
      log("ext", "ok", "gen_random_uuid già disponibile (PostgreSQL moderno): pgcrypto non necessario.");
    }

    /* 3 — schema base + migration */
    log("migrate", "info", "Applicazione dello schema di base (tabelle principali)…");
    const schemaPath = path.join(process.cwd(), "neon", "schema.sql");
    if (!existsSync(schemaPath)) {
      const msg = "File neon/schema.sql mancante: hai caricato la cartella neon/ sul server?";
      log("migrate", "error", msg);
      return { ok: false, error: msg, logs };
    }
    const schemaSql = readFileSync(schemaPath, "utf8");
    try {
      for (const statement of splitSqlStatements(schemaSql)) {
        await pool.query(statement);
      }
      log("migrate", "ok", "Schema di base applicato (tabelle, indici, seed iniziali).");
    } catch (err) {
      const message = (err as Error).message ?? "errore";
      log("migrate", "error", `Schema di base: ${message}`);
      return { ok: false, error: `Schema di base: ${message}`, logs };
    }

    log("migrate", "info", "Applicazione delle migration (idempotenti)…");
    const mig = await runMigrations(pool, (level, msg) => log("migrate", level, msg));
    if (!mig.ok) {
      return { ok: false, error: "Una o più migration sono fallite: vedi il log qui sopra.", logs };
    }
    const applied = mig.outcomes.filter((o) => o.status === "applicata").length;
    const tracked = mig.outcomes.filter((o) => o.status === "tracciata").length;
    log("migrate", "ok", `Schema allineato: ${applied} applicate adesso, ${tracked} già a posto.`);

    /* 4 — super admin */
    log("admin", "info", `Creazione del super admin «${email}»…`);
    const hash = hashPassword(input.adminPassword);
    await pool.query(
      `insert into admin_users (email, password_hash, role, active)
       values ($1, $2, 'super_admin', true)
       on conflict (email) do update
         set password_hash = excluded.password_hash,
             role = 'super_admin',
             active = true`,
      [email, hash],
    );
    log("admin", "ok", "Super admin pronto: potrà entrare su /admin con questa email e questa password.");

    /* 5 — lock su DB */
    await pool.query(
      `create table if not exists setup_lock (
         singleton    int primary key default 1 check (singleton = 1),
         completed    boolean not null default false,
         completed_at timestamptz,
         site_url     text
       )`,
    );
    await pool.query(
      `insert into setup_lock (singleton, completed, completed_at, site_url)
       values (1, true, now(), $1)
       on conflict (singleton) do update set completed = true, completed_at = now(), site_url = excluded.site_url`,
      [siteUrl],
    );
    log("lock", "ok", "Lock di completamento scritto: il wizard non sarà più raggiungibile.");

    /* 6 — .env.local (scritto SOLO a installazione riuscita) */
    const previousSecret = readExistingEnvSecret();
    mkdirSync(process.cwd(), { recursive: true });
    writeFileSync(ENV_FILE, buildEnvContent(siteUrl, dsn, previousSecret));
    try {
      chmodSync(ENV_FILE, 0o600);
    } catch {
      // su alcuni hosting chmod via Node non è permesso: il file vive fuori
      // dal web root e viene letto solo dal processo, il rischio residuo è minimo
    }
    log("env", "ok", `.env.local scritto (DATABASE_URL ${mask(dsn.replace(/^postgresql:\/\//, ""))}) — ADMIN_SESSION_SECRET ${previousSecret ? "conservato dal file precedente" : "generato nuovo"}.`);

    await pool.end();

    /* 7 — lock file */
    markCompleted();
    log("done", "ok", "Installazione completata. Passa al riavvio dell'app dal pannello (Setup Node.js App → Restart).");
    return { ok: true, logs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("fatal", "error", message);
    return { ok: false, error: message, logs };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Ripristino manuale: cancella il lock file per far ripartire il wizard. */
export function resetSetupLockFile(): { ok: boolean; error?: string } {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
