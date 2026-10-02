#!/usr/bin/env node
/**
 * Salva una chiave provider per Ambrosio direttamente su DB, cifrata
 * AES-256-GCM con la stessa derivazione di src/lib/ai.ts (encryptKey su
 * ADMIN_SESSION_SECRET): l'app la decifra senza alcun cambio di codice.
 *
 * Uso:
 *   node scripts/set-ai-key.mjs <provider> <chiave> [--model <modello>]
 *
 * Esempio:
 *   node scripts/set-ai-key.mjs anthropic sk-ant-api03-… --model claude-sonnet-4-5
 *
 * La chiave entra in ai_provider_keys (catena di fallback multi-provider).
 * Se il provider è già il primario in ai_settings, viene aggiornata anche la
 * chiave legacy di quella tabella (retrocompatibilità col form singolo).
 * Il primario NON viene cambiato: si promuove da /admin/ai/provider.
 *
 * (Il codice di cifratura è duplicato di proposito: gli script non importano
 * TypeScript da src/lib.)
 */
import { readFileSync } from "node:fs";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import pg from "pg";

const PROVIDERS = new Set(["anthropic", "openai", "gemini", "openrouter", "freebuff", "custom"]);

const [provider, apiKey] = process.argv.slice(2);
const modelIdx = process.argv.indexOf("--model");
const model = modelIdx >= 0 ? (process.argv[modelIdx + 1] ?? "").trim() : "";

if (!provider || !apiKey || !PROVIDERS.has(provider)) {
  console.error("uso: node scripts/set-ai-key.mjs <provider> <chiave> [--model <modello>]");
  console.error(`provider ammessi: ${[...PROVIDERS].join(" | ")}`);
  process.exit(1);
}

// Carica .env.local (come scripts/create-admin.mjs, senza dipendenze extra)
const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* niente .env.local: si fa affidamento alle variabili d'ambiente */
}

const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET;
if (!DATABASE_URL) {
  console.error("DATABASE_URL mancante: configura .env.local prima.");
  process.exit(1);
}
if (!ADMIN_SESSION_SECRET) {
  console.error("ADMIN_SESSION_SECRET mancante: senza questo l'app non potrebbe decifrare la chiave.");
  process.exit(1);
}

/* ── Cifratura: identica a encryptKey di src/lib/ai.ts ── */
function encryptKey(plain) {
  const key = createHash("sha256").update(ADMIN_SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

/* ── Verifica facoltativa della chiave contro il provider, prima di salvarla ── */
async function verifyKey(key) {
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok ? true : `HTTP ${res.status}`;
    }
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok ? true : `HTTP ${res.status}`;
    }
  } catch (e) {
    return e instanceof Error ? e.message : "errore di rete";
  }
  return null; // gli altri provider non hanno un endpoint di verifica economico: si salva senza test
}

const masked = `${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`;
const verify = await verifyKey(apiKey.trim());
if (verify === true) {
  console.log(`Chiave ${provider} verificata sul provider: OK (${masked})`);
} else if (verify) {
  console.error(`La chiave NON è stata accettata da ${provider}: ${verify}. Niente salvataggio.`);
  process.exit(1);
} else {
  console.log(`Verifica non disponibile per ${provider}: salvo senza test.`);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

try {
  const enc = encryptKey(apiKey.trim());

  // 1. Catena multi-provider (usata da providerChain in src/lib/ai.ts)
  await pool.query(
    `insert into ai_provider_keys (provider, api_key_enc, model, base_url, enabled)
     values ($1, $2, nullif($3, ''), null, true)
     on conflict (provider) do update set
       api_key_enc = excluded.api_key_enc,
       model = coalesce(excluded.model, ai_provider_keys.model),
       enabled = true, updated_at = now()`,
    [provider, enc, model],
  );

  // 2. Chiave legacy di ai_settings SOLO se questo provider è il primario:
  //    providerChain attribuisce la chiave legacy al provider primario.
  const { rows } = await pool.query("select enabled, provider, model from ai_settings where id = 1");
  const current = rows[0];
  await pool.query("insert into ai_settings (id) values (1) on conflict (id) do nothing");
  if (current?.provider === provider) {
    await pool.query("update ai_settings set api_key_enc = $1, updated_at = now() where id = 1", [enc]);
  }

  const { rows: keys } = await pool.query("select provider, enabled from ai_provider_keys where enabled = true order by provider");
  const after = (await pool.query("select enabled, provider, model from ai_settings where id = 1")).rows[0];

  console.log(`✅ Chiave ${provider} salvata e cifrata (${masked})`);
  console.log(`   ai_provider_keys attive: ${keys.map((k) => k.provider).join(", ")}`);
  console.log(`   ai_settings → enabled=${after.enabled}, provider=${after.provider}, model=${after.model || "(default)"}`);
  if (!after.enabled) console.log("   ⚠️ Ambrosio è disattivato: attivalo da /admin/ai.");
  if (after.provider !== provider) {
    console.log(`   ℹ️ Il primario resta "${after.provider}": ${provider} entra in catena come fallback.`);
    console.log('      Per promuoverlo: /admin/ai/provider → "Imposta primario".');
  }
} finally {
  await pool.end();
}
