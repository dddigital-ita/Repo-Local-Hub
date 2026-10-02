#!/usr/bin/env node
/**
 * BACKUP COMPLETO DELLA VERSIONE — un solo comando:
 *
 *   npm run backup            (backup della commit corrente, di solito un tag)
 *   npm run backup -- --ref v0.3.0   (backup di un tag/branch/sha specifico)
 *
 * Produce in backups/<nome>/ tre file:
 *   - db-<nome>.sql.gz      dump PostgreSQL completo (schema + dati, pg_dump
 *                           plain SQL compresso: ripristinabile con psql ovunque,
 *                           Neon incluso — vedi RESTORE nel MANIFEST.json)
 *   - code-<nome>.tar.gz    archivio del codice ESATTO del ref (git archive:
 *                           solo file tracciati, niente node_modules/build)
 *   - MANIFEST.json         versione, commit, tag, date, sha256 e dimensioni
 *                           di ogni artefatto, host del DB (mai credenziali)
 *
 * Il dump viene creato PRIMA dell'archivio: entrambi parlano della stessa
 * versione. Se uno dei due passi fallisce lo script esce con errore e NON
 * scrive un manifest incompleto.
 *
 * Due guardie nate dal primo giro reale:
 *   1. pg_dump rifiuta server più recenti di lui (server 18 vs client 16):
 *      qui si risolve da solo il client PIÙ RECENTE disponibile.
 *   2. pg_dump include il DSN (con password) nei suoi errori: ogni messaggio
 *      stampato passa da redact().
 *
 * (Parsing di .env.local duplicato di proposito: gli script non importano
 * TypeScript da src/lib — stesso taglio di scripts/set-ai-key.mjs.)
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = process.cwd();

/* ── .env.local (stesso pattern di scripts/set-ai-key.mjs) ── */
const env = {};
try {
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* niente .env.local: si fa affidamento alle variabili d'ambiente */
}
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL mancante: configura .env.local prima.");
  process.exit(1);
}

/* ── Ref di cui fare il backup (default: HEAD) ── */
const refIdx = process.argv.indexOf("--ref");
const ref = refIdx >= 0 ? (process.argv[refIdx + 1] ?? "").trim() : "HEAD";
if (!ref) {
  console.error("uso: npm run backup [-- --ref <tag|branch|sha>]");
  process.exit(1);
}

/* ── Identità della versione (^{commit}: i tag annotati vengono dereferenziati
 *    al commit — `git rev-parse v0.3.0` restituirebbe lo sha dell'oggetto tag) ── */
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const commit = execFileSync("git", ["rev-parse", `${ref}^{commit}`], { cwd: ROOT, encoding: "utf8" }).trim();
const commitShort = commit.slice(0, 7);
const tagsOnCommit = execFileSync("git", ["tag", "--points-at", commit], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

/* ── Nome del backup ── */
const now = new Date();
const stamp =
  [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("") +
  "-" +
  [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("");
const name = `wac-v${version}-${stamp}`;
const outDir = path.join(ROOT, "backups", name);
mkdirSync(outDir, { recursive: true });

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}
/** Host del DB per il manifest: mai utente, password o nome db. */
function dbHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "(host non riconoscibile)";
  }
}
/** Messaggi senza credenziali: qualunque DSN nel testo viene mascherato. */
function redact(text) {
  return String(text).replace(
    /postgres(ql)?:\/\/[^\s/:]+:[^\s/@]+@([^\s/?]+)/g,
    (_m, _p, host) => `postgresql://***:***@${host}`,
  );
}

/**
 * pg_dump più recente disponibile: PATH + Cellar homebrew (libpq, libpq@N,
 * postgresql, postgresql@N). Serve perché pg_dump rifiuta server più
 * recenti di lui e il PATH può puntare a un client vecchio.
 */
function resolvePgDump() {
  const candidates = new Set();
  for (const d of (process.env.PATH ?? "").split(":")) {
    if (d) candidates.add(path.join(d, "pg_dump"));
  }
  for (const base of ["/opt/homebrew/Cellar", "/usr/local/Cellar"]) {
    if (!existsSync(base)) continue;
    for (const formula of readdirSync(base)) {
      if (!/^(libpq|postgresql)(@\d+)?$/.test(formula)) continue;
      const formulaDir = path.join(base, formula);
      for (const ver of readdirSync(formulaDir)) {
        candidates.add(path.join(formulaDir, ver, "bin", "pg_dump"));
      }
    }
  }
  let best = null;
  let bestMajor = -1;
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const out = execFileSync(c, ["--version"], { encoding: "utf8" });
      const major = parseInt((out.match(/pg_dump \(PostgreSQL\) (\d+)/) ?? [])[1] ?? "0", 10);
      if (major > bestMajor) {
        best = c;
        bestMajor = major;
      }
    } catch {
      /* binario non eseguibile: si salta */
    }
  }
  if (!best) {
    console.error("pg_dump non trovato: installare libpq (brew install libpq) o PostgreSQL.");
    process.exit(1);
  }
  return { bin: best, major: bestMajor };
}

const artifacts = [];
try {
  /* ── 1. Dump del database (plain SQL → gzip: universale, psql -f lo legge) ── */
  const pgDump = resolvePgDump();
  const dbFile = path.join(outDir, `db-${name}.sql`);
  console.log(`① Dump del database (${dbHost(DATABASE_URL)}) con pg_dump ${pgDump.major}…`);
  try {
    execFileSync(
      pgDump.bin,
      ["--no-owner", "--no-privileges", "--dbname", DATABASE_URL, "--file", dbFile],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (e) {
    // stderr di pg_dump può contenere il DSN: solo versione redatta, mai il raw
    const stderr = e && typeof e === "object" && "stderr" in e ? String(e.stderr ?? "") : "";
    throw new Error(`pg_dump ${pgDump.major} (${pgDump.bin}) fallito: ${redact(stderr || String(e))}`);
  }
  execFileSync("gzip", ["-9", dbFile], { cwd: ROOT });
  const dbGz = dbFile + ".gz";
  artifacts.push({
    file: path.basename(dbGz),
    kind: "database-dump",
    bytes: statSync(dbGz).size,
    sha256: sha256(dbGz),
  });

  /* ── 2. Archivio del codice del ref (git archive: solo file tracciati) ── */
  const codeFile = path.join(outDir, `code-${name}.tar.gz`);
  console.log(`② Archivio del codice (${ref} → ${commitShort})…`);
  execFileSync("git", ["archive", "--format=tar.gz", `-o${codeFile}`, ref], { cwd: ROOT });
  artifacts.push({
    file: path.basename(codeFile),
    kind: "code-archive",
    bytes: statSync(codeFile).size,
    sha256: sha256(codeFile),
  });

  /* ── 3. Manifest ── */
  const manifest = {
    name,
    version,
    ref,
    commit,
    commitShort,
    tags: tagsOnCommit,
    createdAt: now.toISOString(),
    database: {
      host: dbHost(DATABASE_URL),
      format: "pg_dump plain SQL, gzip -9",
      restore: `gunzip -c ${path.basename(dbGz)} | psql "$TARGET_DATABASE_URL"`,
      note: [
        "Il client psql deve essere di versione ≥ il server da cui è nato il dump",
        "(un dump di pg_dump 18 porta marker come \\unrestrict che i client vecchi rifiutano).",
        "Un errore benigno atteso su server < 18: unrecognized configuration parameter \"transaction_timeout\".",
        "Se il target non parte da schema vuoto, valutare prima scripts/db-migrate-all.mjs.",
      ].join(" "),
    },
    code: {
      format: "git archive tar.gz (solo file tracciati del ref)",
      extract: `tar -xzf ${path.basename(codeFile)}`,
      note: "L'archivio non contiene .git: per npm ci serve un repo (git init) perché il postinstall configura core.hooksPath. Il DATABASE_URL di drill verso un server locale deve usare \"localhost\" (non 127.0.0.1): l'euristica SSL dell'app lo attende esplicito.",
    },
    artifacts,
    integrity: {
      algorithm: "sha256",
      verify: artifacts.map((a) => `shasum -a 256 -c <<< "${a.sha256}  ${a.file}"`).join("\n"),
    },
  };
  const manifestFile = path.join(outDir, "MANIFEST.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n✅ Backup completo: backups/${name}`);
  for (const a of artifacts) {
    console.log(`   ${a.file}  — ${mb(a.bytes)}  sha256:${a.sha256.slice(0, 12)}…`);
  }
  console.log("   MANIFEST.json — restore e verifica documentati dentro.");
} catch (e) {
  console.error(`\n❌ Backup fallito: ${redact(e instanceof Error ? e.message : String(e))}`);
  console.error("Nessun MANIFEST.json scritto: il backup non è completo, eliminare la cartella.");
  process.exit(1);
}
