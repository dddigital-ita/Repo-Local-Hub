import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { readSource, codeBlock } from "./helpers/source.mjs";

/**
 * Sentinelle del captcha invisibile (scheda Cloudflare in Impostazioni).
 * Il flusso live (widget + verify) è già coperto dagli E2E di chat/lead con le
 * chiavi di test Cloudflare; qui si blindano le invarianti di sicurezza.
 *
 * Le letture passano da tests/helpers/source.mjs: le asserzioni cadono sul
 * CODICE, mai sui commenti (la vecchia sentinella `size: "invisible"` è
 * passata per settimane solo perché la stringa era rimasta in un commento).
 * I documenti .md si leggono con readFile: lì non c'è «codice» da isolare.
 */

const SETTINGS = "src/lib/turnstile-settings.ts";
const TS = "src/lib/turnstile.ts";
const SHIELD_PAGE = "src/app/admin/shield/page.tsx";
const CF_PAGE = "src/app/admin/settings/cloudflare/page.tsx";
const CF_ACTIONS = "src/app/admin/settings/cloudflare/actions.ts";
const CHECKLIST_ROUTE = "src/app/admin/settings/cloudflare/checklist/page.tsx";
const CHECKLIST_DOC = "CHECKLIST-CAPTCHA-PRODUZIONE.md";
const LOGIN_ACTION = "src/app/admin/actions.ts";
const LOGIN_PAGE = "src/app/admin/login/page.tsx";
const WIDGET = "src/components/turnstile-widget.tsx";

test("turnstile-settings: secret cifrata (AES) e mai in chiaro nel DB o nel payload", async () => {
  const { code } = readSource(SETTINGS);
  assert.ok(code.includes("encryptKey("), "la secret entra cifrata con encryptKey (AES-256-GCM)");
  assert.ok(code.includes("decryptKey("), "lettura via decryptKey");
  assert.ok(!/secret:\s*(?!Enc)[a-zA-Z]/.test(code.replace(/secretHint|secret \|\||secret \?|secret\)|secret,|secret =|secret\.|\(secret|segreto/g, "")), "nessuna proprietà 'secret' in chiaro negli oggetti esposti");
  assert.ok(code.includes("secretHint"), "al client va solo l'indizio mascherato");
  // La site key senza secret non deve montare il widget.
  assert.ok(code.includes("if (!secret) return null;"), "site key al client SOLO se esiste anche la secret attiva");
});

test("turnstile-settings: priorità env su DB, salvataggio conservativo della secret", async () => {
  const { code } = readSource(SETTINGS);
  assert.ok(code.includes("process.env.TURNSTILE_SECRET_KEY"), "la env secret è letta per prima");
  assert.ok(code.includes("if (secret) next.secretEnc = encryptKey(secret)"), "secret vuota nel form = conserva quella esistente");
  assert.ok(code.includes("Servono ENTRAMBE le chiavi"), "validazione: site + secret insieme");
  assert.ok(code.includes("delete from content_settings where key = $1"), "la cancellazione ripristina le env come fonte");
});

test("turnstile: fail-open su API irraggiungibile, token mancante rifiutato SOLO se attivo", async () => {
  const { code } = readSource(TS);
  assert.ok(code.includes('if (!secret || !site) return { ok: true, reason: "disabled" }'), "senza chiavi attive: tutto passa (disabled), nessun falso blocco");
  assert.ok(code.includes('"token_mancante"'), "token mancante con captcha attivo → rifiuto esplicito (non Shield-bannabile)");
  assert.ok(code.includes("api_unreachable"), "Cloudflare giù → fail-open (mai bloccare i clienti veri)");
  assert.ok(code.includes("AbortSignal.timeout"), "la chiamata siteverify ha un timeout");
});

test("password-dimenticata: captcha sull'invio email pubblico, neutro anche nell'errore", async () => {
  const { code } = readSource("src/app/admin/password-dimenticata/actions.ts");
  const tsIdx = code.indexOf("await verifyTurnstile(formData.get(\"turnstileToken\")");
  const rlIdx = code.indexOf('limit("pw-reset"');
  assert.ok(tsIdx !== -1, "requestResetAction verifica il token captcha");
  assert.ok(rlIdx !== -1, "requestResetAction ha il rate limit");
  assert.ok(tsIdx < rlIdx, "il captcha blocca PRIMA di consumare il budget delle richieste email");
  const tsBlock = code.slice(tsIdx, rlIdx);
  assert.ok(!tsBlock.includes("shieldViolate"), "nessuna violazione Shield dal blocco captcha (widget lazy)");
  assert.ok(!/redirect\([^)]*email/.test(tsBlock), "l'errore captcha NON rimanda l'email dell'utente (anti-enumerazione integro)");
  const page = await readFile("src/app/admin/password-dimenticata/page.tsx", "utf8");
  assert.ok(page.includes('containerId="wac-turnstile-reset"'), "widget dedicato sulla pagina di richiesta");
  assert.ok(/captchaSiteKey && !token/.test(page), "il form col token privato NON monta il widget (solo la richiesta pubblica)");
  assert.ok(page.includes('captcha: "Verifica di sicurezza non riuscita'), "errore captcha neutro tradotto in pagina");
});

test("login admin: verifica Turnstile PRIMA del rate limit e senza violazioni Shield", async () => {
  const { code } = readSource(LOGIN_ACTION);
  const tsIdx = code.indexOf("await verifyTurnstile(formData.get(\"turnstileToken\")");
  const rlIdx = code.indexOf('limit("admin-login"');
  assert.ok(tsIdx !== -1, "loginAction verifica il token captcha");
  assert.ok(rlIdx !== -1, "loginAction ha il rate limit");
  assert.ok(tsIdx < rlIdx, "il captcha blocca PRIMA di consumare il budget dei tentativi");
  // Il ramo captcha NON chiama shieldViolate (il 403 anti-bot non deve bannare l'IP di un admin vero).
  const tsBlock = code.slice(tsIdx, rlIdx);
  assert.ok(!tsBlock.includes("shieldViolate"), "nessuna violazione Shield dal blocco captcha del login");
  assert.ok(tsBlock.includes("anti-bot non riuscita"), "messaggio d'errore dedicato all'utente");
});

test("login page: widget montato solo con site key attiva, token nel form", async () => {
  const { code } = readSource(LOGIN_PAGE);
  assert.ok(code.includes("activeTurnstileSiteKey"), "la pagina decide server-side se montare il widget");
  assert.ok(code.includes("TurnstileLoginField"), "il form porta il campo token");
  assert.ok(!code.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY"), "nessun accesso diretto alle env nel client component di pagina");
});

test("widget: site key via prop, nessuna opzione size, cleanup remove() all'unmount", async () => {
  const { code } = readSource(WIDGET);
  assert.ok(code.includes("containerId"), "container configurabile: login e globale possono coesistere");
  assert.ok(!code.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY"), "la site key arriva dalla prop server-side, non dalle env client");
  // L'invisibilità dipende dal TIPO di sitekey (decisione Cloudflare 2026-09):
  // passare l'opzione size fa rifiutare il render («expected "compact",
  // "flexible", or "normal"») e blocca ogni login. `code` è senza commenti:
  // l'asserzione non può più cadere su un commento.
  const renderBlock = codeBlock(code, "turnstile.render(container, {", "callback:");
  assert.ok(renderBlock.includes("sitekey: siteKey,"), "il blocco render è quello atteso");
  assert.ok(!renderBlock.includes("size:"), "nessuna opzione size nel render: il tipo di widget decide l'invisibilità");
  assert.ok(code.includes("-left-[9999px]") && code.includes("aria-hidden"), "il contenitore resta fuori schermo e non interagibile");
  // All'unmount i MIEI widget escono dal registry Cloudflare: senza remove()
  // ogni login→admin orfanizza il widget e i log E2E gridano.
  assert.ok(code.includes("?.remove(id)"), "cleanup remove() all'unmount: nessun widget orfano");
  assert.ok(code.includes("myIdsRef"), "gli id rimossi sono solo quelli dell'istanza (ref per istanza)");
  assert.ok(code.includes("remove: (id?: string) => void;"), "il tipo globale dichiara remove()");
});

test("turnstile-verify: test reale con token fittizio ufficiale, secret mai esposta, ultimo test dall'audit", async () => {
  const { code } = readSource("src/lib/turnstile-verify.ts");
  assert.ok(code.includes('"XXXX.DUMMY.TOKEN.XXXX"'), "usa il token fittizio UFFICIALE Cloudflare (mai un token di un visitatore)");
  assert.ok(code.includes("getActiveSecret"), "il test usa la secret attiva (env o DB), stessa del runtime");
  assert.ok(code.includes('"invalid-input-response"'), "rifiuto del solo token finto = secret valida → verde");
  assert.ok(code.includes('"invalid-input-secret"'), "secret rifiutata → rosso (il guasto si scopre qui, non su un lead)");
  assert.ok(code.includes("AbortSignal.timeout"), "la chiamata ha un timeout");
  assert.ok(code.includes("cloudflare.test"), "azione audit dedicata: l'ultimo test si legge dal log append-only");
  assert.ok(code.includes('startsWith("OK")'), "l'esito dell'ultimo test deriva dal dettaglio audit (convenzione Drive)");
  // La scheda mostra l'esito e l'ultimo test, con sentinella sul bottone.
  const page = readSource(CF_PAGE).code;
  assert.ok(page.includes("testTurnstileAction"), "il bottone «Prova verifica» è nella scheda");
  assert.ok(page.includes("getLastTurnstileTest"), "l'indicatore «ultimo test» legge dall'audit");
});

test("cloudflare: scheda Impostazioni con editor e azioni con audit, Shield di sola lettura", async () => {
  // L'editor vive nella scheda Cloudflare dell'hub Impostazioni (UNA scheda =
  // UNA pagina): fonte attiva dichiarata, segreto solo come hint mascherato.
  const page = readSource(CF_PAGE).code;
  assert.ok(page.includes("getTurnstileSettings"), "la scheda legge la config salvata");
  assert.ok(page.includes("chiavi da Cloudflare (DB)"), "la UI dichiara la fonte attiva (DB)");
  assert.ok(page.includes("chiavi da environment (prioritaria)"), "la UI dichiara la fonte attiva (env)");
  assert.ok(page.includes("saveTurnstileAction") && page.includes("clearTurnstileAction"), "salvataggio e rimozione dalla scheda");
  assert.ok(page.includes("/admin/shield"), "la scheda rimanda a Shield per la diagnostica");
  const actions = readSource(CF_ACTIONS).code;
  assert.ok(actions.includes("cloudflare.turnstile_save") && actions.includes("cloudflare.turnstile_clear"), "ogni azione finisce nell'audit log");
  assert.ok(actions.includes("cloudflare.test"), "il «Prova verifica» finisce nell'audit come le altre schede");
  assert.ok(actions.includes("requireAdmin"), "le azioni richiedono l'admin autenticato");
  // Shield resta la diagnostica: niente editor, solo stato + rimando.
  const shield = readSource(SHIELD_PAGE).code;
  assert.ok(shield.includes("getTurnstileSettings"), "Shield mostra lo stato del captcha");
  assert.ok(shield.includes("/admin/settings/cloudflare"), "Shield rimanda alla scheda che contiene l'editor");
  assert.ok(!shield.includes("saveTurnstileAction") && !shield.includes("clearTurnstileAction"), "Shield non contiene più l'editor (fonte unica)");
});

test("checklist captcha: «Prova verifica» è documentato come passo di verifica post-attivazione", async () => {
  const doc = await readFile(CHECKLIST_DOC, "utf8");
  assert.ok(doc.includes("## 3. Inserire le chiavi reali dalla scheda Cloudflare"), "il salvataggio delle chiavi reali passa dalla scheda, non da Shield");
  assert.ok(doc.includes("3. **Prova verifica**"), "il passo 3.3 documenta il bottone «Prova verifica» in scheda");
  assert.ok(doc.includes("| 2 | **Prova verifica** |"), "la tabella delle verifiche post-attivazione contiene il passo dedicato");
  assert.ok(doc.includes("cloudflare.test"), "l'audit atteso include il test di verifica");
  assert.ok(doc.includes("chiavi da Cloudflare (DB)"), "il badge della fonte attiva cita il DB");
  // Il documento non deve più puntare all'era pre-scheda.
  assert.ok(!doc.includes("su Shield DOPO l'ultimo deploy"), "nessun rimando all'editor in Shield");
  assert.ok(!doc.includes("shield.turnstile_save"), "l'azione audit rinominata non resta nel doc");
});

test("checklist captcha: la scheda rimanda al documento servito dal repo, senza copie", async () => {
  // La pagina admin legge il file DAL DISCO: una fonte sola, mai in desync.
  const route = readSource(CHECKLIST_ROUTE).code;
  assert.ok(route.includes("requireAdmin"), "la pagina della checklist richiede l'admin autenticato");
  assert.ok(route.includes('"CHECKLIST-CAPTCHA-PRODUZIONE.md"'), "legge il documento reale dal repo");
  assert.ok(route.includes("parseMarkdownDoc") && route.includes("parseInlineTokens"), "renderizza con il parser condiviso (nessuna copia del testo)");
  assert.ok(route.includes('export const dynamic = "force-dynamic"'), "contenuto sempre letto a richiesta, non statico");
  // Due ingressi in scheda: la guida (quando servono le chiavi) e l'editor.
  const page = readSource(CF_PAGE).code;
  const occurrences = page.split("/admin/settings/cloudflare/checklist").length - 1;
  assert.ok(occurrences >= 2, "la scheda collega la checklist sia nella guida che nell'editor");
});

test("shield: pannello eventi filtrabile per tipo con conteggi 7 giorni", async () => {
  const { code } = readSource("src/lib/shield.ts");
  assert.ok(code.includes("interval '7 days'"), "i conteggi per tipo coprono 7 giorni");
  assert.ok(code.includes("SHIELD_KINDS"), "i tipi noti sono una costante esplicita (a zero si vedono comunque)");
  assert.ok(code.includes("kindFilter: kindFilter && byKind7d.some"), "il filtro è validato contro i tipi conosciuti (parametro sconosciuto → tutti)");
  assert.ok(code.includes("where kind = $1"), "la lista filtrata è una query parametrizzata");
  const page = readSource(SHIELD_PAGE).code;
  assert.ok(page.includes("getShieldStats(kind ?? null)"), "la pagina passa il filtro da searchParams");
  assert.ok(page.includes('href={`/admin/shield?kind=${encodeURIComponent(k)}`}'), "i conteggi sono link di filtro con encoding");
  assert.ok(page.includes('href="/admin/shield"'), "il link «Tutti» rimuove il filtro");
  assert.ok(page.includes("Nessun evento di tipo"), "lista vuota con filtro attivo → messaggio dedicato");
});
