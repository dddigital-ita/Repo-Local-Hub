import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

// Sentinelle del sistema utenti: RUOLI (super_admin | admin) + area personale.
// Il pericolo qui è la superficie dei PRIVILEGI: ogni sentinela chiude una via
// per cui un admin normale potrebbe gestire gli altri utenti, o un account
// disattivato potrebbe restare operativo.

test("la migration 030 crea i ruoli con promozione del primo account", () => {
  const m = read("neon", "migrations", "030-admin-users-roles-profile.sql");
  assert.match(m, /role\s+text not null default 'admin'/, "manca la colonna role con default admin");
  assert.match(m, /check\s*\(role in \('super_admin',\s*'admin'\)\)/, "manca il check sul dominio dei ruoli");
  assert.match(m, /add column if not exists first_name/, "manca il campo nome");
  assert.match(m, /add column if not exists vat_number/, "manca la partita IVA");
  assert.match(m, /add column if not exists fiscal_code/, "manca il codice fiscale");
  assert.match(m, /add column if not exists address/, "manca l'indirizzo");
  // Promozione: SOLO se non esiste già un super admin (idempotente, primo vince).
  assert.match(m, /order by created_at asc, email asc limit 1/, "la promozione deve scegliere il primo account per created_at");
  assert.match(m, /not exists \(select 1 from admin_users where role = 'super_admin'\)/, "la promozione non deve sovrascrivere un super admin esistente");
});

test("le guardie server-side esistono e sono usate nelle azioni utenti", () => {
  const lib = read("src", "lib", "users.ts");
  assert.match(lib, /export async function requireSuperAdmin/, "manca la guardia super admin");
  assert.match(lib, /export async function requireActiveUser/, "manca la guardia utente attivo");
  assert.match(lib, /user\.role !== "super_admin"/, "requireSuperAdmin deve verificare il ruolo sul DB");
  // Le azioni di gestione iniziano tutte con la guardia.
  const actions = read("src", "app", "admin", "utenti", "actions.ts");
  const nGuards = (actions.match(/await requireSuperAdmin\(\)/g) ?? []).length;
  assert.ok(nGuards >= 5, `le azioni utenti devono chiamare requireSuperAdmin (trovate: ${nGuards})`);
});

test("le protezioni ultimo-super-admin e self sono nei tre percorsi distruttivi", () => {
  const lib = read("src", "lib", "users.ts");
  for (const fn of ["setUserRole", "setUserActive", "deleteUser"]) {
    const body = lib.slice(lib.indexOf(`export async function ${fn}`));
    const next = body.slice(0, body.indexOf("\nexport async function", 10) || undefined);
    assert.match(next, /ultimo_super|self/, `${fn}: manca la protezione ultimo super admin / self`);
  }
  // self: mai azioni distruttive sul proprio account
  assert.match(lib, /emailN === actor\.toLowerCase\(\)\.trim\(\)/, "manca il confronto self vs attore");
});

test("l'account disattivato è bloccato nel login E in ogni sessione", () => {
  const admin = read("src", "lib", "admin.ts");
  assert.match(admin, /if \(row\.active === false\) return false;/, "il login deve rifiutare gli account disattivati");
  // Enforcement CENTRALE: anche un cookie firmato valido muore con l'account
  // (con audit del motivo: session.rejected / account_disattivato).
  assert.match(admin, /if \(rows\[0\]\.active === false\) return rejectSession\("account_disattivato", email\);/, "getAdminUser deve invalidare le sessioni degli account disattivati");
});

test("il reset password genera una temporanea forte e non la logga", () => {
  const lib = read("src", "lib", "users.ts");
  const body = lib.slice(lib.indexOf("export async function resetUserPassword"));
  assert.match(body, /randomBytes\(9\)\.toString\("base64url"\)/, "la password temporanea deve essere randomica");
  assert.match(body, /Aa1!/, "la temporanea deve includere maiuscola, numero e simbolo");
  assert.match(body, /user\.password_reset/, "il reset deve finire in audit (l'evento, NON la password)");
  assert.ok(!/logAudit\([^)]*temp/.test(body), "la password temporanea NON deve finire nel log di audit");
});

test("la nav mostra Utenti solo ai super admin e l'Area personale a tutti", () => {
  const nav = read("src", "components", "admin-nav.tsx");
  assert.match(nav, /role === "super_admin"/, "la voce Utenti deve essere condizionata al ruolo");
  assert.match(nav, /\/admin\/profilo/, "manca il link all'Area personale");
  assert.match(nav, /role\?: string/, "AdminNav deve accettare il ruolo dal layout");
  const layout = read("src", "app", "admin", "layout.tsx");
  assert.match(layout, /getAppUser/, "il layout deve leggere il ruolo per la nav");
});

test("le pagine profilo e utenti esistono e la pagina utenti è protetta", () => {
  assert.ok(existsSync(path.join(ROOT, "src", "app", "admin", "profilo", "page.tsx")), "manca /admin/profilo");
  assert.ok(existsSync(path.join(ROOT, "src", "app", "admin", "utenti", "page.tsx")), "manca /admin/utenti");
  const page = read("src", "app", "admin", "utenti", "page.tsx");
  assert.match(page, /await requireSuperAdmin\(\)/, "la pagina utenti deve usare la guardia super admin");
  assert.match(page, /visitor|self|tu/, "l'elenco deve distinguere il proprio account");
});

test("l'E2E copre login super admin, profilo, creazione utente e blocco disattivato", () => {
  const spec = read("tests", "e2e", "utenti.spec.ts");
  assert.match(spec, /super_admin/, "manca il seed del super admin");
  assert.match(spec, /from admin_users/, "il seed deve scrivere admin_users nel DB E2E");
  assert.match(spec, /profilo/, "manca lo scenario area personale");
  assert.match(spec, /crea account/i, "manca lo scenario creazione utente");
  assert.match(spec, /Credenziali non valide/, "manca l'asserzione del blocco post-disattivazione");
  assert.match(spec, /cambia email/i, "manca lo scenario cambio email (proprio account)");
  assert.match(spec, /Password non corretta/, "manca la verifica che il cambio email esiga la password");
  assert.match(spec, /utenti\.spec|admin\/utenti/, "la spec deve puntare alle pagine utenti");
});

test("il cambio email è protetto: password propria, formato, collisioni", () => {
  const lib = read("src", "lib", "users.ts");
  const body = lib.slice(lib.indexOf("export async function changeOwnEmail"));
  assert.match(body, /verifyPassword\(/, "il cambio email self-service DEVE richiedere la password corrente");
  assert.match(body, /EMAIL_RE\.test/, "manca la validazione del formato email");
  assert.match(body, /duplicate key/, "la collisione email deve essere gestita (race tra check e update)");
  assert.match(body, /user\.email_change/, "il cambio email deve finire in audit");
  assert.match(body, /issueSessionFor\(/, "dopo il cambio la sessione va ri-emessa con la nuova email");
  // Anche la via super admin esiste e scrive in audit.
  const admin = lib.slice(lib.indexOf("export async function setUserEmail"));
  assert.match(admin, /user\.email_change/, "manca l'audit per il cambio email da super admin");
  // La pagina profilo ha il form con password obbligatoria.
  const page = read("src", "app", "admin", "profilo", "page.tsx");
  assert.match(page, /changeEmailAction/, "manca il form cambio email nel profilo");
  assert.match(page, /currentPassword/, "il form deve chiedere la password attuale");
});

test("admin_users è FUORI dal ciclo backup/restore: nessun dato account lascia il server", () => {
  const shared = read("src", "lib", "restore-shared.ts");
  // La tabella non deve stare né nell'ordine di ripristino né nelle dipendenze.
  const order = shared.slice(shared.indexOf("RESTORE_ORDER = ["));
  const orderBody = order.slice(0, order.indexOf("] as const"));
  assert.ok(!orderBody.includes("admin_users"), "RESTORE_ORDER non deve contenere admin_users");
  const deps = shared.slice(shared.indexOf("RESTORE_DEPS"));
  assert.ok(!deps.includes('admin_users: ['), "RESTORE_DEPS non deve contenere admin_users");
  // BACKUP_NEVER è il contratto esplicito: mai esportata, mai ripristinabile.
  assert.match(shared, /BACKUP_NEVER[^;]*admin_users/, "manca BACKUP_NEVER con admin_users");
  assert.match(shared, /export function isBackupNever/);

  // Il ciclo di backup esclude la tabella: select * solo su BACKUP_TABLES.
  const maint = read("src", "lib", "maintenance.ts");
  assert.match(
    maint,
    /BACKUP_TABLES = RESTORE_ORDER\.filter\(\(t\) => !isBackupNever\(t\)\)/,
    "il backup deve filtrare BACKUP_NEVER",
  );
  // Il restore filtra la whitelist E il backstop anti-forgery: un file
  // forgiato con righe admin_users (es. role: 'super_admin') non tocca
  // mai la tabella — niente auto-promozione, niente disattivazione.
  assert.match(
    maint,
    /isBackupNever\(t\)/,
    "la selezione restore deve escludere BACKUP_NEVER",
  );
  const execBody = maint.slice(maint.indexOf("export async function executeRestore"));
  assert.match(
    execBody,
    /if \(isBackupNever\(table\)\) continue/,
    "il ciclo insert deve avere il backstop isBackupNever",
  );
});

test("il probe /setup smette di esistere a installazione completata", () => {
  const actions = read("src", "app", "setup", "actions.ts");
  const body = actions.slice(actions.indexOf("export async function testConnectionAction"));
  assert.match(body, /setupState\(\)/, "testConnectionAction deve riverificare il lock");
  assert.match(
    body,
    /state === "completed"/,
    "il probe deve rifiutare le richieste su un sito già installato",
  );
});

test("la password temporanea del reset NON viaggia nell'URL: nota server cifrata e monouso", () => {
  // L'azione stipa la nota e redirecta solo con un flag opaco: mai ?temp=.
  const actions = read("src", "app", "admin", "utenti", "actions.ts");
  const resetBody = actions.slice(actions.indexOf("export async function resetUserPasswordAction"));
  assert.ok(!/temp=/.test(resetBody), "il redirect del reset non deve portare la password in query");
  assert.match(resetBody, /stashNote\(/, "il reset deve stipare la nota lato server");
  assert.match(resetBody, /audience: \[me\.email\]/, "la nota deve essere rivendicabile solo dall'attore");

  // La lib cifra a riposo e cancella al primo claim (monouso, niente oracoli).
  const noteLib = read("src", "lib", "note.ts");
  assert.match(noteLib, /aes-256-gcm/, "la nota deve essere cifrata (AES-256-GCM)");
  assert.match(noteLib, /delete from flash_notes/, "il claim deve consumare la nota (delete)");
  assert.match(noteLib, /audience \?\|/, "il claim deve verificare l'audience lato query");

  // La pagina rivendica la nota e rifiuta il caso «già vista» con messaggio
  // neutro: il payload della nota non può arrivare da nessun altro canale.
  const page = read("src", "app", "admin", "utenti", "page.tsx");
  assert.match(page, /claimNote\(note, \[me\.email\]\)/, "la pagina deve rivendicare la nota col proprio account");
  assert.ok(!/searchParams[^\n]*temp/.test(page), "la pagina non deve più leggere ?temp=");
});

test("le nuove destinazioni sono nella palette ⌘K", () => {
  const d = read("src", "lib", "admin-destinations.ts");
  assert.match(d, /\/admin\/profilo/, "manca l'Area personale nella palette");
  assert.match(d, /\/admin\/utenti/, "manca Utenti nella palette");
});
