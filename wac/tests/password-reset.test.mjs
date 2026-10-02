import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

/**
 * Sentinelle del recupero password self-service («password dimenticata»).
 * Il percorso completo (richiesta → token → reset → login) è in
 * tests/e2e/password-reset.spec.ts: qui si blindano le invarianti di
 * sicurezza che NON devono mai regredire, leggendo il codice così com'è.
 */

const LIB = "src/lib/password-reset.ts";
const ACTIONS = "src/app/admin/password-dimenticata/actions.ts";
const PAGE = "src/app/admin/password-dimenticata/page.tsx";

test("lib/password-reset: token a 256 bit, solo SHA-256 nel DB", async () => {
  const src = await readFile(LIB, "utf8");
  assert.ok(src.includes("randomBytes(32)"), "token casuale a 256 bit (base64url)");
  assert.ok(src.includes('createHash("sha256")'), "nel DB va SOLO l'hash SHA-256 del token, mai il token in chiaro");
  assert.ok(/insert into password_reset_tokens\s*\(email, token_hash, expires_at, created_ip\)/.test(src), "l'INSERT scrive SOLO email + token_hash (+ scadenza/IP): mai una colonna col token in chiaro");
});

test("lib/password-reset: risposta neutra, identica per email esistente e ignota", async () => {
  const src = await readFile(LIB, "utf8");
  // Il token viene generato e scritto PRIMA di sapere se l'email esiste:
  // tempo e scritture non distinguono i due casi.
  const insertIdx = src.indexOf("insert into password_reset_tokens");
  const existsIdx = src.indexOf('from admin_users where email = $1 and active');
  assert.ok(insertIdx !== -1 && existsIdx !== -1, "query di esistenza presente");
  assert.ok(insertIdx < existsIdx, "il token è generato PRIMA del check di esistenza (nessuna differenza misurabile)");
  assert.ok(src.includes("neutral: true"), "il risultato verso il client è sempre neutro");
  assert.ok(src.includes("richiesta (email ignota)"), "solo l'audit distingue i due casi (per il super admin)");
});

test("lib/password-reset: token monouso, scadenza 1h, minimo 8 caratteri", async () => {
  const src = await readFile(LIB, "utf8");
  assert.ok(src.includes("TOKEN_TTL_MS = 60 * 60 * 1000"), "scadenza 1 ora");
  assert.ok(src.includes("row.used_at"), "token già usato → rifiutato");
  assert.ok(src.includes('"scaduto"'), "token scaduto → errore dedicato");
  assert.ok(src.includes("newPassword.length < 8"), "minimo 8 caratteri sulla nuova password");
});

test("lib/password-reset: reset in transazione su client dedicato, sessioni uccise", async () => {
  const src = await readFile(LIB, "utf8");
  assert.ok(src.includes("pool.connect()"), "transazione su client DEDICATO (begin/commit sul pool sarebbero su connessioni diverse)");
  assert.ok(src.includes('"begin"') && src.includes('"commit"') && src.includes('"rollback"'), "update password + token usato in un'unica transazione");
  assert.ok(src.includes("fingerprint"), "documentata la revoca delle sessioni via fingerprint della password");
  assert.ok(src.includes('"password.reset_done"'), "il reset finisce nell'audit log");
});

test("azioni: rate limit 3/h per IP e redirect neutro", async () => {
  const src = await readFile(ACTIONS, "utf8");
  assert.ok(src.includes('limit("pw-reset", ip, 3, 60 * 60_000)'), "rate limit 3 richieste/ora per IP sull'invio del link");
  assert.ok(src.includes("?sent=1"), "redirect sempre con ?sent=1: lo schermo non rivela se l'email esiste");
  assert.ok(src.includes("encodeURIComponent(token)"), "il token torna nell'URL solo via redirect encodato");
});

test("pagina: messaggio anti-enumerazione ed errori tradotti", async () => {
  const page = await readFile(PAGE, "utf8");
  assert.ok(page.includes("Se questa email corrisponde a un account"), "conferma neutra: non dice se l'account esiste");
  assert.ok(page.includes("dura 1 ora"), "l'utente sa che il link scade");
  assert.ok(page.includes("già usato"), "token riusato → messaggio chiaro");
  assert.ok(page.includes('type="password"'), "campi nuova password mascherati");
  assert.ok(page.includes('autoComplete="new-password"'), "autoComplete new-password per i password manager");
});
