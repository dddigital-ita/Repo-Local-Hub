/**
 * SEED «VERDE» DELLA PANORAMICA — SOLO PER VERIFICA BROWSER LOCALE.
 *
 * `node scripts/overview-green.mjs green`    → semina lo stato tutto-ok
 * `node scripts/overview-green.mjs restore`  → ripristina lo snapshot
 *
 * Cosa semina (tutto fittizio, mai chiamate reali verso i servizi):
 * - google_tools: gscCredsEnc + ga4/gtm (Google «Collegato»), driveCredsEnc
 * - email_tools: smtp+imap+user+passwordEnc (Email «Collegata»)
 * - notion_settings: enabled + chiave (Notion «Pronto»)
 * - ai_settings: enabled + chiave (Ambrosio attivo)
 * - audit: backup.creato / notion.sync / drive.test con actor «seed-verifica»
 *
 * Prima di toccare qualcosa salva uno snapshot in content_settings
 * (`_overview_backup`); `restore` lo rimette a posto e si cancella da solo.
 *
 * NOTA sull'audit: `audit_log` è append-only A LIVELLO DB (RULE no_delete /
 * no_update) — le righe del seed («seed-verifica», detail «OK — seed
 * verifica») restano PERMANENTI anche dopo il restore, per design. Su un DB
 * di verifica è innocuo; spariscono solo con un reset del database.
 */
import { randomBytes, createHash, createCipheriv } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";

const mode = process.argv[2];
if (mode !== "green" && mode !== "restore") {
  console.error('Uso: node scripts/overview-green.mjs "green" | "restore"');
  process.exit(1);
}

// Carica .env.local come create-admin.mjs (niente dipendenze extra).
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante.");
  process.exit(1);
}

/** Stessa derivazione di src/lib/ai.ts (encKey): stessa chiave del server. */
function encryptKey(plain) {
  const secret = process.env.ADMIN_SESSION_SECRET || "dev-secret-cambia-in-produzione";
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

const BACKUP_KEY = "_overview_backup";
const SEED_ACTOR = "seed-verifica";
const SETTINGS_KEYS = ["google_tools", "email_tools"];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function upsertSetting(key, value) {
  await pool.query(
    "insert into content_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb",
    [key, JSON.stringify(value)],
  );
}

async function seed() {
  // 1. Snapshot dello stato attuale (settings + righe notion/ai + audit del dominio).
  const snap = {
    settings: {},
    notion: (await pool.query("select enabled, api_key_enc, database_id, last_test_at, last_test_ok from notion_settings where id = 1")).rows[0] ?? null,
    ai: (await pool.query("select enabled, api_key_enc from ai_settings where id = 1")).rows[0] ?? null,
    audit: (
      await pool.query(
        "select id, actor, action, target, detail, created_at from audit_log where action in ('backup.creato','backup.errore','notion.sync','drive.test') order by created_at",
      )
    ).rows,
  };
  for (const key of SETTINGS_KEYS) {
    const r = await pool.query("select value from content_settings where key = $1", [key]);
    snap.settings[key] = r.rows[0]?.value ?? null;
  }
  await upsertSetting(BACKUP_KEY, snap);
  console.log("Snapshot salvato.");

  // 2. google_tools: preserva i campi esistenti, aggiunge GSC + GA4/GTM + Drive.
  const google = snap.settings.google_tools ?? {};
  await upsertSetting("google_tools", {
    ...google,
    ga4Id: "G-VERDETEST1",
    gtmId: "GTM-VERDE123",
    gscCredsEnc: encryptKey("fake-gsc-credentials"),
    driveCredsEnc: encryptKey(
      JSON.stringify({ client_email: "verde@fake.iam.gserviceaccount.com", private_key: "fake" }),
    ),
  });

  // 3. email_tools: SMTP completo.
  const email = snap.settings.email_tools ?? {};
  await upsertSetting("email_tools", {
    ...email,
    smtpHost: "smtp.verde.local",
    smtpPort: "587",
    imapHost: "imap.verde.local",
    imapPort: "993",
    user: "verde@verde.local",
    passwordEnc: encryptKey("fake-password"),
  });

  // 4. Notion: attivo + chiave.
  await pool.query("insert into notion_settings (id) values (1) on conflict (id) do nothing");
  await pool.query(
    "update notion_settings set enabled = true, api_key_enc = $1, database_id = coalesce(database_id, 'verde-db'), last_test_at = now(), last_test_ok = true where id = 1",
    [encryptKey("fake-notion-key")],
  );

  // 5. Ambrosio: attivo + chiave.
  await pool.query("insert into ai_settings (id) values (1) on conflict (id) do nothing");
  await pool.query(
    "update ai_settings set enabled = true, api_key_enc = $1, provider = coalesce(provider, 'anthropic') where id = 1",
    [encryptKey("fake-ai-key")],
  );

  // 6. Audit DOPO il backup (che legge l'ultimo evento): successi freschi.
  await pool.query(
    "insert into audit_log (actor, action, target, detail) values ($1,'backup.creato','panoramica','OK — seed verifica'),($1,'notion.sync','panoramica','OK — seed verifica'),($1,'drive.test','panoramica','OK — seed verifica')",
    [SEED_ACTOR],
  );

  console.log("SEED VERDE OK — ricarica /admin.");
}

async function restore() {
  const r = await pool.query("select value from content_settings where key = $1", [BACKUP_KEY]);
  const snap = r.rows[0]?.value;
  if (!snap) {
    console.error("Nessuno snapshot da ripristinare.");
    return;
  }

  // Settings: valore originale, o assenza originale.
  for (const key of SETTINGS_KEYS) {
    const original = snap.settings[key];
    if (original === null || original === undefined) {
      await pool.query("delete from content_settings where key = $1", [key]);
    } else {
      await upsertSetting(key, original);
    }
  }

  // Notion / AI: colonne toccate tornano allo snapshot (o allo stato neutro se la riga non c'era).
  const n = snap.notion;
  if (n) {
    await pool.query(
      "update notion_settings set enabled = $1, api_key_enc = $2, database_id = $3, last_test_at = $4, last_test_ok = $5 where id = 1",
      [n.enabled, n.api_key_enc, n.database_id, n.last_test_at, n.last_test_ok],
    );
  } else {
    await pool.query(
      "update notion_settings set enabled = false, api_key_enc = null, last_test_at = null, last_test_ok = null where id = 1",
    );
  }
  const a = snap.ai;
  if (a) {
    await pool.query("update ai_settings set enabled = $1, api_key_enc = $2 where id = 1", [a.enabled, a.api_key_enc]);
  } else {
    await pool.query("update ai_settings set enabled = false, api_key_enc = null where id = 1");
  }

  // Audit: la tabella è append-only (RULE DB): le righe del seed NON sono
  // cancellabili — restano come traccia verificabile della prova. Tutto il
  // resto (settings, notion_settings, ai_settings) torna esattamente com'era.
  await pool.query("delete from content_settings where key = $1", [BACKUP_KEY]);

  console.log("RIPRISTINO OK — stato precedente alla verifica.");
}

try {
  if (mode === "green") await seed();
  else await restore();
} finally {
  await pool.end();
}
