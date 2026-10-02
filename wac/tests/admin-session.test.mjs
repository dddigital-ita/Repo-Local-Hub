/**
 * SESSIONI ADMIN RIVOCABILI — sentinelle dove vivono.
 *
 * Il cookie firmato era immortale: firma HMAC + scadenza, mai il DB. Cancellare
 * l'utente o cambiare la password lasciava la sessione valida fino a 12 ore
 * (visto sul vivo). Ora il payload porta l'impronta della password_hash e
 * getAdminUser la riverifica a ogni richiesta, fail-closed.
 *
 * Esecuzione: `npm test` (node --test).
 */
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const lib = readFileSync(new URL("../src/lib/admin.ts", import.meta.url), "utf8");

test("sessioni admin: l'impronta della password viaggia nel payload firmato", () => {
  assert.ok(lib.includes("pwFingerprint"), "funzione impronta password presente");
  // Il fingerprint deriva dall'HMAC con lo stesso segreto di sessione, non è l'hash in chiaro.
  assert.ok(/createHmac\("sha256", secret\(\)\)/.test(lib), "impronta HMAC col segreto di sessione");
  // Login la include nel payload; getAdminUser la confronta.
  assert.ok(/\$\{pwFingerprint\(stored\)\}`/.test(lib), "login: impronta nel payload");
});

test("sessioni admin: getAdminUser riverifica sul DB e fallisce chiuso", () => {
  // Verifica della password_hash corrente a ogni richiesta.
  assert.ok(lib.includes("select password_hash from admin_users where email = $1"), "riverifica password_hash sul DB");
  assert.ok(lib.includes("pwMark !== pwFingerprint(current)"), "impronta dissimile → sessione rifiutata");
  // Cookie senza impronta (pre-fix) o utente cancellato → rifiutato (con audit del motivo).
  assert.ok(lib.includes('rejectSession("utente_assente", email)'), "utente cancellato → rifiutato");
  assert.ok(lib.includes('rejectSession("cookie_senza_fingerprint_pre_fix", email)'), "cookie senza impronta → rifiutato");
  // Fail-closed: DB irraggiungibile in modo PERSISTENTE = nessuna sessione
  // accettata. Un errore TRANSITORIO (socket idle ucciso dal proxy Neon:
  // «clic → di nuovo al login» con cookie valido, visto sul vivo) ha diritto
  // a un risveglio del pool e a un secondo tentativo — con riverifica di
  // fingerprint e stato attivo sul DB, quindi nessuna revoca reale salta.
  assert.ok(!/catch\s*\{\s*return user|catch\s*\{\s*\/\* ok/.test(lib), "nessun fail-open nel catch");
  const failClosed = lib.includes("db_persistente:");
  assert.ok(failClosed, "DB irraggiungibile in modo persistente → sessione rifiutata");
  // Errore transitorio (socket idle ucciso dal proxy) → ping di risveglio e
  // secondo tentativo PRIMA di arrendersi: il fingerprint viene comunque
  // riverificato sul DB, quindi nessuna revoca reale salta.
  assert.ok(/ECONNRESET/i.test(lib), "errori transitori classificati (ECONNRESET & co.)");
  assert.ok(lib.includes('await pool.query("select 1")'), "ping di risveglio del pool nel recupero");
});

test("sicurezza self-service: cambio password rinnova la sessione corrente e lista le attive", () => {
  // Lib: cambio con verifica dell'attuale + rinnovo del cookie con l'impronta nuova.
  assert.ok(lib.includes("export async function changeAdminPassword"), "cambio password self-service");
  assert.ok(lib.includes("export async function issueSessionFor"), "rinnovo sessione senza riverificare la password");
  // Il login registra l'impronta nell'audit (materia prima della lista sessioni).
  assert.ok(lib.includes('"admin.login"') && lib.includes("fp:"), "login loggato con fingerprint");
  // Lista sessioni: match impronta-log vs hash attuale.
  assert.ok(lib.includes("export async function getAdminSessions"), "lista sessioni attive");
  // Pagina + azioni + etichette audit + destinazione palette.
  const page = readFileSync(new URL("../src/app/admin/sicurezza/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("changePasswordAction") && page.includes("refreshSessionAction"), "pagina sicurezza cablata");
  const actions = readFileSync(new URL("../src/app/admin/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("admin.password-cambiata"), "audit del cambio password");
  const audit = readFileSync(new URL("../src/app/admin/audit/page.tsx", import.meta.url), "utf8");
  assert.ok(audit.includes('"admin.login"'), "etichetta audit per il login");
  const dest = readFileSync(new URL("../src/lib/admin-destinations.ts", import.meta.url), "utf8");
  assert.ok(dest.includes("/admin/sicurezza"), "destinazione nella palette ⌘K");
});
