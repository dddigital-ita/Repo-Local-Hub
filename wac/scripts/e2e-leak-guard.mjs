// E2E LEAK GUARD — ogni suite deve lasciare il DB condiviso come l'ha trovato.
//
// Gli spec E2E seminano righe di prova (marcate /e2e-* o @e2e.local) e le
// ripuliscono in afterAll. Quando un afterAll manca (vedi utenti.spec prima
// del fix 9eaf3cd) le righe di prova si accumulano nel DB condiviso e
// falsano in silenzio i controlli dei run successivi. Questo guard gira
// DOPO ogni suite (globalTeardown in playwright.config.ts) e fallisce se
// resta qualcosa, stampando il comando di pulizia giusto per ogni tabella.
//
// Esclusioni volute:
//  - audit_log è APPEND-ONLY per design (rule no_delete in DB): gli attori
//    unici per run di turnstile-shield non sono un leak, sono la storia.
//  - Le tabelle mai toccate dagli spec (es. operators dopo la pulizia di
//    tickets-dashboard) non vengono controllate: niente falsi positivi.
//
// Modalità: default export per Playwright (throw = run fallita); CLI con
// `node scripts/e2e-leak-guard.mjs` (exit 1 = leak).

import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

// Stessa ricetta degli spec: DATABASE_URL da .env.e2e (DB disposable wac_e2e,
// mai il dev diurno né il produzione). Override con E2E_DATABASE_URL.
function dsn() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const env = readFileSync(path.resolve(".env.e2e"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("e2e-leak-guard: DATABASE_URL non trovata in .env.e2e");
  return line.slice("DATABASE_URL=".length).trim();
}

// Tabella → predetto dei marker e2e → comando di pulizia (stampato al fallimento).
const CONTROLLI = [
  {
    tabella: "conversations",
    sql: `select count(*)::int as n from conversations where source_page like '/e2e%'`,
    marker: "source_page like '/e2e%'",
    pulizia: `delete from conversations where source_page like '/e2e%' -- cascade su messages/ticket_notes`,
    spec: "tickets-inbox, tickets-pagination, tickets-dashboard",
  },
  {
    tabella: "messages",
    sql: `select count(*)::int as n from messages where author like 'e2e-%'`,
    marker: "author like 'e2e-%'",
    pulizia: `delete from messages where author like 'e2e-%'`,
    spec: "tickets-dashboard (risposte attribuite)",
  },
  {
    tabella: "leads",
    sql: `select count(*)::int as n from leads where source_page like '/e2e%'`,
    marker: "source_page like '/e2e%'",
    pulizia: `delete from leads where source_page like '/e2e%'`,
    spec: "leads-admin, callbacks-admin (lead del callback)",
  },
  {
    tabella: "callbacks",
    sql: `select count(*)::int as n from callbacks where notes = 'e2e-cb-mark'`,
    marker: "notes = 'e2e-cb-mark'",
    pulizia: `delete from callbacks where notes = 'e2e-cb-mark'`,
    spec: "callbacks-admin",
  },
  {
    tabella: "admin_users",
    sql: `select count(*)::int as n from admin_users where email like '%@e2e.local'`,
    marker: "email like '%@e2e.local'",
    pulizia: `delete from admin_users where email like '%@e2e.local'`,
    spec: "tutti gli spec admin (utenti, password-reset, tickets-*, …)",
  },
  {
    tabella: "password_reset_tokens",
    sql: `select count(*)::int as n from password_reset_tokens where email like '%@e2e.local'`,
    marker: "email like '%@e2e.local'",
    pulizia: `delete from password_reset_tokens where email like '%@e2e.local'`,
    spec: "password-reset",
  },
  {
    tabella: "shield_events",
    sql: `select count(*)::int as n from shield_events where detail = 'e2e-filtro'`,
    marker: "detail = 'e2e-filtro'",
    pulizia: `delete from shield_events where detail = 'e2e-filtro'`,
    spec: "turnstile-shield",
  },
];

export async function runLeakGuard() {
  const client = new pg.Client({ connectionString: dsn() });
  let results;
  try {
    await client.connect();
    const union = CONTROLLI.map((c) => `(${c.sql})`).join(" union all ");
    results = (await client.query(union)).rows.map((r) => Number(r.n));
  } catch (err) {
    throw new Error(`e2e-leak-guard: impossibile interrogare il DB E2E: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }

  const leak = CONTROLLI.map((c, i) => ({ ...c, n: results[i] })).filter((c) => c.n > 0);

  if (leak.length === 0) {
    console.log(`✓ e2e-leak-guard: nessuna riga di prova residua nel DB condiviso (${CONTROLLI.length} tabelle controllate).`);
    return;
  }

  const righe = leak
    .map((c) => `  - ${c.tabella}: ${c.n} riga/e (${c.marker}) — seed di: ${c.spec}\n    pulizia: ${c.pulizia}`)
    .join("\n");
  throw new Error(
    `e2e-leak-guard: ${leak.reduce((s, c) => s + c.n, 0)} riga/e di prova lasciate nel DB condiviso —\n` +
      `un afterAll manca o non passa. Rimuovile e correggi lo spec responsabile:\n${righe}`,
  );
}

export default runLeakGuard;

// CLI diretta: node scripts/e2e-leak-guard.mjs
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  runLeakGuard()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`✖ ${err.message}`);
      process.exit(1);
    });
}
