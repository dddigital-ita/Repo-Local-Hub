import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Sentinella delle PERFORMANCE ADMIN (ADR-005: l'auth una volta per richiesta).
 * Come desk-autopilota e takeover-origin: i guard testuali tengono insieme i
 * pezzi — qui il contratto è che una navigazione /admin NON può più paginare
 * 3-4 SELECT identiche su Neon. Il costo del caricamento deve essere delle
 * pagine, non dell'auth.
 */

const ROOT = process.cwd();

test("la riga admin passa dal loader memoizzato per richiesta", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "admin.ts"), "utf8");
  assert.match(lib, /import \{ cache \} from "react"/, "la memoizzazione per richiesta è cache() di React");
  assert.match(lib, /const loadAdminRow = cache\(/, "il loader della riga deve essere un cache()");
  // getAdminUser deve DELEGARE al loader: niente query dirette nel corpo della guardia.
  const guardia = lib.match(/export async function getAdminUser[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(guardia, "getAdminUser non trovata");
  assert.match(guardia, /loadAdminRow\(/, "getAdminUser deve usare il loader memoizzato");
  assert.doesNotMatch(guardia, /pool\.query\(/, "getAdminUser non deve più interrogare il DB da sola");
});

test("il recupero del socket morto resta una proprietà del loader", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "admin.ts"), "utf8");
  const loader = lib.match(/const loadAdminRow = cache\([\s\S]*?\n\);\n/)?.[0] ?? "";
  assert.ok(loader, "loadAdminRow non trovata");
  // Stessa regex dei transienti che proteggeva getAdminUser (blip Neon).
  assert.match(
    loader,
    /terminat\|ECONNRESET\|ECONNREFUSED\|ETIMEDOUT\|EPIPE\|connection\|timeout\|socket/i,
    "il loader deve riconoscere i fallimenti transienti come faceva getAdminUser",
  );
  assert.match(loader, /select 1/, "il risveglio della connessione deve restare nel loader");
  // Fail-closed: qualunque fallimento arriva motivato, mai un falso ok.
  assert.match(loader, /db_errore_non_transient:/, "l'errore non transitorio resta motivato");
  assert.match(loader, /db_persistente:/, "il fallimento dopo il risveglio resta motivato");
  assert.match(loader, /db_non_configurato/, "DB assente non è un ok: è un rigetto motivato");
});

test("l'app user non duplica l'identità: un getAdminUser deduplicato", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "users.ts"), "utf8");
  const fn = lib.match(/export async function getAppUser[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(fn, "getAppUser non trovata");
  assert.match(fn, /await getAdminUser\(\)/, "l'identità deve passare da getAdminUser (memoizzata)");
  assert.match(fn, /select \* from admin_users where email = \$1/, "la riga completa resta UNA query per richiesta");
});

test("l'area personale non raddoppia più l'auth nel layout", () => {
  const layout = readFileSync(path.join(ROOT, "src", "app", "admin", "layout.tsx"), "utf8");
  assert.match(layout, /getAdminUser\(\)/, "il layout usa la stessa identità memoizzata");
  assert.match(layout, /getAppUser\(\)/, "il ruolo arriva da getAppUser, che DEDUPLICA il primo getAdminUser");
});

test("content_settings: UNA query per richiesta (ADR-005 esteso)", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "tickets.ts"), "utf8");
  assert.match(lib, /const memoizedSnapshot = cache\(/, "lo snapshot di content_settings deve essere un cache() di React");
  // I tre lettori passano dallo snapshot: niente query dirette nei corpi.
  for (const fn of ["getSlaPolicy", "getChatEmojis", "getQuickReplies"]) {
    const corpo = lib.match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.ok(corpo, `${fn} non trovata`);
    assert.match(corpo, /snapshotPerRichiesta\(\)/, `${fn} deve leggere dallo snapshot per richiesta`);
    assert.doesNotMatch(corpo, /pool\.query\(/, `${fn} non deve più interrogare il DB da sola`);
  }
  // Le action che scrivono queste chiavi devono fare il bump di versione:
  // il render della STESSA richiesta altrimenti leggerebbe lo snapshot stante.
  const actions = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");
  const saveQuick = actions.match(/export async function saveQuickReplies[\s\S]*?\n\}/)?.[0] ?? "";
  const saveEmojis = actions.match(/export async function saveChatEmojis[\s\S]*?\n\}/)?.[0] ?? "";
  const saveSla = actions.match(/export async function saveSlaPolicy[\s\S]*?\n\}/)?.[0] ?? "";
  for (const [name, corpo] of [["saveQuickReplies", saveQuick], ["saveChatEmojis", saveEmojis], ["saveSlaPolicy", saveSla]]) {
    assert.ok(corpo, `${name} non trovata`);
    assert.match(corpo, /bumpContentSettingsVersion\(\)/, `${name} deve invalidare lo snapshot dopo l'upsert`);
  }
});

test("telemetria render admin: after() nel layout, degrada, prefetch esclusi", () => {
  const layout = readFileSync(path.join(ROOT, "src", "app", "admin", "layout.tsx"), "utf8");
  assert.match(layout, /import \{ after \} from "next\/server"/, "la registrazione deve andare in after() (fuori dal percorso della risposta)");
  assert.match(layout, /Date\.now\(\)/, "il tempo deve partire nel layout, prima dell'auth");
  assert.match(layout, /next-router-prefetch/, "i prefetch RSC devono restare fuori campione");
  assert.match(layout, /logAdminRenderTime\(/, "il layout deve delegare alla lib di telemetria");
  const lib = readFileSync(path.join(ROOT, "src", "lib", "admin-telemetry.ts"), "utf8");
  assert.match(lib, /logAudit\(/, "la registrazione passa dall'audit (fonte unica)");
  assert.match(lib, /"admin\.render"/, "l'azione è admin.render con target = path");
  assert.match(lib, /catch/, "la telemetria non deve mai rompere la pagina misurata");
  // Il middleware del timing non esiste: il tempo vive nel layout (stesso orologio su Vercel).
  assert.equal(existsSync(path.join(ROOT, "src", "middleware.ts")), false, "nessun middleware: il timing nello stesso processo del render");
});

test("l'audit del rigetto resta intatto: stessa telemetria, una query sola", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "admin.ts"), "utf8");
  const guardia = lib.match(/export async function getAdminUser[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(guardia, /rejectSession\(res\.reason, email\)/, "i rigetti infrastrutturali arrivano motivati dal loader");
  assert.match(guardia, /rejectSession\("utente_assente"/, "l'utente assente resta un rigetto esplicito");
  assert.match(guardia, /rejectSession\("fingerprint_diverso_password_cambiata"/, "la revoca per cambio password resta");
  assert.match(guardia, /rejectSession\("account_disattivato"/, "la disattivazione resta un rigetto");
});

/* ══════════════════════════════════════════════════════════════════
   ADR-005 ESTESO (ottobre 2026): i fan-out dei layer di stato degli hub.
   La navigazione Impostazioni → Tools pagava 18–21 query (e la Panoramica
   44) perché getIntegrationStatus eseguiva TUTTI i reader del registro per
   tornare UNA pill e i layer non erano deduplicati per richiesta. Qui il
   contratto testuale che impedisce la regressione: memoizzazione per
   richiesta + reader singolo + TTL condiviso + skeleton di navigazione.
   ══════════════════════════════════════════════════════════════════ */

test("getIntegrationStatus esegue SOLO il reader richiesto (niente fan-out)", () => {
  const lib = readFileSync(path.join(ROOT, "src", "lib", "integrations-status.ts"), "utf8");
  const fn = lib.match(/export async function getIntegrationStatus[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(fn, "getIntegrationStatus non trovata");
  assert.doesNotMatch(
    fn,
    /getIntegrationStatuses\(\)/,
    "NON deve delegare al registro completo: una pill non deve pagare tutti i reader",
  );
  assert.match(fn, /CACHED_SINGLE\[/, "deve usare la funzione memoizzata precostruita per chiave");
  // Le funzioni memoizzate per chiave hanno identità stabile (precostruite a
  // livello modulo): un cache() creato a ogni chiamata non deduplicherebbe.
  assert.match(lib, /CACHED_SINGLE[:\s]*Record<|const CACHED_SINGLE = /, "la mappa di funzioni memoizzate esiste");
  assert.match(lib, /Object\.fromEntries/, "una funzione memoizzata per OGNI def del registro");
  // Il registro completo resta memoizzato per richiesta (Panoramica).
  const tutti = lib.match(/export const getIntegrationStatuses = cache\(/);
  assert.ok(tutti, "getIntegrationStatuses deve essere memoizzato per richiesta");
});

test("i tre layer status-server sono memoizzati per richiesta (cache() di React)", () => {
  for (const [file, fn] of [
    ["settings-status-server.ts", "getSettingsStatuses"],
    ["tools-status-server.ts", "getToolsStatuses"],
    ["integrations-status.ts", "getIntegrationStatuses"],
  ]) {
    const lib = readFileSync(path.join(ROOT, "src", "lib", file), "utf8");
    assert.match(
      lib,
      new RegExp(`export const ${fn} = cache\\(`),
      `${fn} deve essere un cache() di React: la Panoramica compone più hub nella STESSA richiesta`,
    );
  }
});

test("il TTL condiviso delle config esiste ed è usato dai layer (60s, no cache negativa)", () => {
  const ttl = readFileSync(path.join(ROOT, "src", "lib", "db-config-cache.ts"), "utf8");
  assert.match(ttl, /DB_CONFIG_TTL_MS = 60_000/, "TTL di 60 secondi, dichiarato come contratto");
  assert.match(ttl, /inflight/, "single-flight: letture concurrent sulla stessa chiave condividono la Promise");
  assert.doesNotMatch(ttl, /setInterval/, "nessun cron di scadenza: pulizia al passaggio (AGENTS.md: niente timer che tengono vivo il processo)");
  for (const file of ["settings-status-server.ts", "tools-status-server.ts", "integrations-status.ts"]) {
    const lib = readFileSync(path.join(ROOT, "src", "lib", file), "utf8");
    assert.match(lib, /readThroughDbConfig\(/, `${file} passa dal TTL condiviso per le config che cambiano solo a salvataggio`);
  }
});

test("ogni navigazione admin ha un loading skeleton (mai schermo fermo)", () => {
  const loading = readFileSync(path.join(ROOT, "src", "app", "admin", "loading.tsx"), "utf8");
  assert.match(loading, /aria-busy="true"/, "il skeleton è annunciato alle tecnologie assistive");
  assert.match(
    loading,
    /rounded-3xl bg-white\/55/,
    "stessa disciplina grafica delle card glass: il passaggio skeleton → pagina non lampeggia",
  );
});

test("migration 044: l'indice per le letture «ultimo evento per action» esiste", () => {
  const mig = readFileSync(path.join(ROOT, "neon", "migrations", "044-audit-action-index.sql"), "utf8");
  assert.match(mig, /create index if not exists audit_log_action_created_idx/, "idempotente, come le altre");
  assert.match(mig, /on audit_log \(action, created_at desc\)/, "parte da action: serve ai pattern «action IN (…) ORDER BY created_at DESC LIMIT 1»");
});
