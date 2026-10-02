# CHANGELOG

Registro delle decisioni del progetto. Ogni voce risponde a tre domande: cosa è cambiato, perché, con quale conseguenza. Le fasi citate si riferiscono a `ROADMAP-UPGRADE.md`.

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/); versionamento semantico del ticketing: le fasi della roadmap sono le milestone. Le fasi di Ambrosio si riferiscono a `REPORT-AMBROSIO-AI.md`.

---

## [Versione 0.5.0] — 2026-09-28 · Modalità manutenzione e catalogo servizi di Ambrosio — la release del go-live

Le tappe atterrate dopo il tag v0.4.0, tutte verificate sul vivo o in build:

- **Modalità manutenzione** (`33cdfe6`): toggle in `/admin/tools/manutenzione` con conferma a due fasi e audit log; il cancello vive nel proxy e serve a tutto il pubblico un HTML autonomo (zero script, zero chat, zero banner cookie) con **503 + Retry-After** — Google riprova invece di deindicizzare; `/admin` resta raggiungibile col cancello acceso; stato in `content_settings` (chiave `maintenance_mode`), **zero migration**. 14 unit nuovi + spec E2E del ciclo completo.
- **Catalogo servizi** (`0d23e21`): Ambrosio vende anche servizi (fotografo, video, assistenza, SOS web) oltre ai pacchetti — migration additiva `035` con colonna `kind` su `packages`, seed guardito dei 4 servizi (entra solo se l'archivio non ha ancora servizi), tab Pacchetti/Servizi in admin, sezione home separata, e `revalidatePath("/")` nelle action del catalogo: senza di essa la home ISR (300s) mostrava il vecchio listino per 5 minuti dopo una modifica. Tutto l'ecosistema (Notion, gcal, notify, proposte) eredita gratis: legge gli stessi campi.
- **Il catalogo entra in chat** (`e639afd`): la prova dal vivo ha mostrato che Ambrosio diceva «non abbiamo un pacchetto specifico di fotografia» nonostante il catalogo servizi — `ambrosioReply` caricava solo `kind="package"`. Ora il prompt riceve entrambi i cataloghi (stesso fix per il copywriter delle FAQ) con l'istruzione di citare nome esatto e prezzo scritto, e l'ancora esplicita sul SOS web per le emergenze.
- **I contatti si chiedono una volta sola** (`3ae905d`): il vivo mostrava la richiesta contatti+consenso doppiata nella stessa risposta; la regola entra nei blocchi L1/L2 con esempio di chiusura corretta (le frasi modello battono i divieti astratti sui modelli piccoli) e nel prompt di default il divieto dei calchi inglesi. Sul DB di sviluppo la regola è già nel prompt editabile dell'operatore: in produzione va portata via `/admin/ai/configurazione`.
- **Rete di sicurezza pre-go-live**: guard anti-leak E2E in globalTeardown (`5b8fa03`), lint tornato muto (`3aca392`), `db:migrate` su DB vergine fallisce con l'istruzione giusta invece di 24 errori (`a5392cc`).

Verifica di release: 309/309 unit, 65 E2E (leak guard incluso), lint muto, typecheck ok, wizard `/setup` simulato end-to-end nel browser su DB vergine, replay `schema.sql` + 37 migration pulito e idempotente, build `.next-prod` rigenerata dal tag.

---

## [Versione 0.4.0] — 2026-09-28 · Telegram bidirezionale, setup guidato, blindature RBAC, contatti reali, captcha in Impostazioni

Le tappe atterrate dopo il tag v0.3.0, tutte verificate sul vivo o in build:

- **Telegram bidirezionale** (`7089fe8`): Ambrosio risponde sul bot con lo stesso cervello della web chat (estratto in `ambrosio-turn.ts`), ogni chat diventa un ticket nel CRM, comandi /start /stato /umano /stop; campanello handoff al team solo sulla transizione vera; digest serale 20–23 Roma con lead, conversazioni, handoff e callback; risposte degli agenti dal ticket verso la chat del cliente; scheda admin `/admin/settings/telegram` con segreti cifrati (migration 033 e 034). 25 test nuovi.
- **Setup guidato e deploy cPanel** (`4380978`): il probe `/setup` guida l'installazione (env, migration, admin) e smette di esistere a installazione finita; `server.js` per Passenger, guide DEPLOY-CPANEL e GO-LIVE.
- **RBAC e backup** (`6bad0dd`): admin_users fuori dal ciclo backup/restore (BACKUP_NEVER + backstop anti-forgery), reset password senza URL (note monouso cifrate, migration 032), sentinelle estese ed E2E Playwright.
- **Contatti reali e Manuale Operativo** (`8d868d4`): numeri veri del team con safePhone a guardia delle env finte, oggetto contacts unico per header/footer/sticky/landing/JSON-LD, titolare privacy DDDigital, Manuale `/admin/tools/manuale`, picker emoji GDPR-safe predisposto.
- **Scheda Cloudflare (Turnstile)** (`a32ca1a`): le chiavi del captcha si inseriscono e modificano in Impostazioni (`/admin/settings/cloudflare`, secret cifrata su DB, Shield ridotto a diagnostica); bottone «Prova verifica» con `siteverify` reale, meta «Ultimo test» nell'hub e CHECKLIST-CAPTCHA-PRODUZIONE aggiornata con il nuovo passo post-attivazione.

---

## [Widget Turnstile senza size] — 2026-09-28 · L'invisibilità dipende dal tipo di sitekey

### Contesto
Il widget montava il challenge con `size: "invisible"`. L'API attuale di
Cloudflare lo rifiuta («expected "compact", "flexible", or "normal"»): il
render falliva e nessun token veniva più generato — ogni login bloccato.

### Deciso
- **Nessuna opzione `size` nel render**: il comportamento invisibile dipende
  dal TIPO di sitekey (i widget invisibili non hanno footprint visivo a
  prescindere dalla size). Il contenitore resta comunque fuori schermo
  (`aria-hidden`, off-screen) e non interagibile.
- **Cleanup `remove()` all'unmount, per-istanza**: senza, ogni login→admin
  orfanizza il widget nel registry Cloudflare e i log E2E si riempiono di
  «Cannot find Widget cf-chl-widget-…». Fix in `be1fc4d` (insieme alla
  paginazione della coda ticket).
- **Le sentinelle leggono il CODICE, non i commenti**: la vecchia asserzione
  su `size: "invisible"` è continuata a passare «per caso», cadendo sul
  commento nuovo. La sentinella ora estrae il blocco render scartando le
  righe di commento (`ca52657`); l'helper condiviso `tests/helpers/source.mjs`
  generalizza l'approccio (strip consapevole delle stringhe, `readSource`,
  `assertInCode`).

### Note operative
Nessun cambio di chiavi né di configurazione: chi ha widget invisibili non
devi toccare nulla sul pannello Cloudflare. E2E login/chat/lead con captcha
attivo: verdi sul componente nuovo.

---

## [Scheda Cloudflare (Turnstile)] — 2026-09-28 · Le chiavi del captcha in Impostazioni, con prova di siteverify

### Contesto
L'editor delle chiavi Turnstile viveva in Shield, mescolato alla diagnostica
(eventi, ban, reset): chi doveva ruotare una secret lavorava nella pagina
sbagliata e ogni funzione nuova cresceva nel posto meno adatto. Si separano i
ruoli: la configurazione va nell'hub Impostazioni, Shield resta diagnostica.

### Aggiunto
- **Scheda `/admin/settings/cloudflare`**: editor completo delle chiavi
  (site key pubblica + secret cifrata AES-256-GCM, mai restituita al client,
  solo hint mascherato), guida a 4 passi e badge della fonte attiva dichiarata
  («chiavi da Cloudflare (DB)» vs «chiavi da environment (prioritaria)»).
- **Bottone «Prova verifica»**: chiama davvero `siteverify` di Cloudflare con
  la secret attiva (env o DB) e il token fittizio ufficiale: con chiavi reali
  il verde arriva dal rifiuto del solo token, con le chiavi di test
  dall'accettazione — in entrambi i casi dimostra che la secret è valida e la
  catena verso Cloudflare è viva. API irraggiungibile → rosso esplicito (qui
  non vale il fail-open: si misura, non si blocca nessuno).
- **Meta «Ultimo test» nell'hub**: la card Cloudflare della sezione Protezione
  mostra l'esito dell'ultima prova (OK/KO con data) letto dall'audit
  append-only — nessun nuovo campo di configurazione.
- **Panoramica e command palette**: la riga Impostazioni segnala il captcha
  «Da configurare» tra i pendenze; ⌘K raggiunge la scheda.
- **Checklist leggibile in app** (`/admin/settings/cloudflare/checklist`):
  pagina admin di sola lettura che renderizza CHECKLIST-CAPTCHA-PRODUZIONE
  letto dal disco (fonte unica, mai una copia) tramite il parser puro
  `markdown-lite.ts` — heading, liste, tabelle, code block, citazioni e
  grassetto, senza dipendenze nuove. La scheda la collega in due punti:
  guida (passo 3) e note dell'editor.

### Modificato
- **Shield di sola lettura** per il captcha: stato, hint e link «Gestisci da
  Impostazioni → Cloudflare»; le azioni di editor escono da Shield — una
  fonte unica di configurazione, Shield resta la diagnostica (eventi, ban,
  reset).
- **CHECKLIST-CAPTCHA-PRODUZIONE** allineata: «Prova verifica» è il nuovo
  passo di verifica post-attivazione (#2 nella tabella delle 8), l'audit
  atteso diventa `cloudflare.turnstile_save` + `cloudflare.test` e tutti i
  rimandi all'editor passano da Shield alla scheda Cloudflare.

### Deciso
- **Scheda nella sezione Protezione, fuori dal registro integrazioni**:
  Turnstile non fa arrivare né partire dati, è un controllo di sicurezza sui
  form; il registro è riservato a eventuali API Cloudflare vere (DNS, cache).
- **Audit con prefisso `cloudflare.`** (`cloudflare.turnstile_save`,
  `cloudflare.turnstile_clear`, `cloudflare.test`): azioni migrate dalla
  vecchia coppia `shield.turnstile_*`, la cronologia resta consultabile.

### Note operative
Stato in `cloudflareStatus` (funzione pura) + reader server, attivo solo con
ENTRAMBE le chiavi (stessa regola del runtime). Nessuna migration: la config
vive in `content_settings` (`turnstile_tools`). E2E Playwright spostata sulla
scheda (salvataggio, rimozione, «Prova verifica», meta nell'hub) e verificata
dal vivo.

---

## [Telegram bidirezionale] — 2026-09-28 · Ambrosio risponde anche su Telegram

### Contesto
Telegram era solo un canale in USCITA (notify.ts: lead, «cliente attende», Shield,
cron). Chi scriveva al bot non riceveva risposta: i messaggi restavano lì, senza
webhook né thread. Il canale bidirezionale riutilizza il cervello di Ambrosio
senza duplicarlo: stesso gate di autonomia, stessa raccolta lead, stessi tool.

### Aggiunto
- **Webhook `/api/telegram/webhook`**: secret opzionale via header
  `x-telegram-bot-api-secret-token` (confronto in tempo costante), dedup su
  `update_id` (tabella `telegram_updates`, stessa forma di `email_ingest`),
  solo chat private (gruppi/canali fuori policy). Registrazione con
  `node scripts/telegram-webhook.mjs <TOKEN> <URL> [SECRET]`.
- **Cervello condiviso (`src/lib/ambrosio-turn.ts`)**: il cuore di
  `/api/chat/ai` (gate autonomia, tetto mosse con handoff, raccolta lead,
  tool calls, safety-net L3, persistenza) estratto in lib; la route web
  resta un guscio con Shield e rate-limit. Comportamento identico.
- **Pipeline (`src/lib/telegram-ingest.ts`)** condivisa webhook/polling:
  thread una-conversazione-per-chat-id (`contact_handle`, migration 033),
  comandi `/start` `/stato` `/umano` `/stop`, routing Ambrosio ↔ team con le
  stesse regole della web chat (riapertura ticket chiusi, campanello
  «cliente attende» con dedup, handoff umano su richiesta esplicita).
- **Outbound operativo**: le risposte degli agenti dal ticket `telegram`
  escono via adapter messaging (nuovo canale in CHANNELS) verso la chat del
  cliente (`contact_handle`). Best-effort: fallito = audit
  `ticket.risposta_telegram_errore`, il messaggio resta nel ticket.
- **Campanello handoff** (`notifyHandoff`): quando Ambrosio non sa (o non
  può) gestire il cliente e chiama `handoff`, il team riceve email+Telegram
  con motivo, canale e link al ticket. Parte SOLO sulla transizione vera
  verso `operator` (update condizionale con `returning`: nessun doppione su
  ritenti o percorsi concorrenti) e copre sia l'handoff deciso dal modello
  sia quello forzato dal tetto mosse — web e Telegram allo stesso modo.
- **Polling di riserva**: cron step 13 con `TELEGRAM_POLLING=1` (sviluppo
  locale senza HTTPS; webhook e getUpdates non convivono su Telegram).
- **Salute**: `/api/health` e card «Inventario» mostrano la modalità del
  canale (webhook / webhook senza secret / polling / off).
- **Digest serale Telegram** (step 14 del cron, finestra 20–23 Roma,
  1/giorno): la chiusura della giornata di Ambrosio sulle chat del team —
  lead salvati con ripartizione per canale, conversazioni seguite, passaggi
  al team, callback fissate con slot e nome. Formato puro testato
  (`telegram-digest-format.ts`), query del giorno civile di Roma, dedup
  giornaliero su `content_settings` come il digest mattutino, invio
  best-effort con esito in audit (`telegram.digest_sera`). La giornata
  quieta si dice lo stesso: il silenzio sembrerebbe un digest rotto.
- **Scheda admin `/admin/settings/telegram`** (migration 034): token,
  chat del team e secret del webhook configurabili dall'UI — cifrati
  AES-256-GCM su `telegram_config` (stessa chiave delle API AI e del token
  WhatsApp), mai mostrati per intero, «vuoto = conserva» come la password
  del pannello email. Risoluzione runtime DB → env (fallback storico per
  le installazioni esistenti, nessuna rottura); bottoni «Rileva chat»
  (getUpdates al posto dello script CLI) e «Invia messaggio di prova»;
  nuovo canale nell'hub Impostazioni con stato puro testato
  (`telegramStatus`).

### Migration
- **033-telegram-channel.sql** (additiva): `conversations.contact_handle`
  (indirizzo generico del canale: email usa l'indirizzo, Telegram il chat
  id), `telegram_chats` (registry), `telegram_updates` (dedup).

### Note
- Le notifiche one-way esistenti (notify.ts) non cambiano: lo stesso bot ora
  parla E ascolta. L'handoff umano non tocca la AI: finché il ticket è in
  mano al team, i messaggi Telegram entrano nel thread senza risposte automatiche.

---

## [RBAC backup/restore + probe chiuso + nota monouso] — 2026-09-28 · admin_users non lascia mai il server

### Contesto
Audit dei confini di privilegio tra super admin e admin: due buchi rompevano
l'isolamento degli account.

1. **Escalation via restore.** Il restore accettava un file JSON caricato da
   un admin qualsiasi e sovrascriveva le tabelle indicate — `admin_users`
   inclusa. Un admin semplice poteva auto-promuoversi `role: 'super_admin'`
   (o disattivare/cancellare il super admin) con un file forgiato, aggirando
   la guardia `requireSuperAdmin`.
2. **Fuga di dati via backup.** L'export JSON includeva `admin_users`: hash
   delle password (scrypt) e anagrafica privata del super admin (codice
   fiscale, P.IVA, indirizzo, telefono) scaricabili da qualunque admin —
   nonostante il commento «niente credenziali nel file», vero solo per la
   connection string.

In più: il probe del wizard (`testConnectionAction`) restava raggiungibile
con richiesta forgiata anche a installazione completata (il layout chiudeva
la pagina, non l'action).

### Deciso
**`admin_users` è FUORI dal ciclo backup/restore, per costruzione.**
Gli account si gestiscono solo da `/admin/utenti` (guardia server-side) e
dal wizard d'installazione: uniche superfici di scrittura legittime.

- `BACKUP_NEVER` + `isBackupNever()` in `lib/restore-shared.ts`: la tabella
  è rimossa da `RESTORE_ORDER` e `RESTORE_DEPS` (non esiste come opzione né
  nel piano né nella UI). Rimetterla in lista sarebbe una regression.
- **Difesa in profondità** in `lib/maintenance.ts`: i backup esportano solo
  `BACKUP_TABLES` (ordine meno `BACKUP_NEVER`); il restore filtra la
  selezione della whitelist **e** ha un backstop esplicito nel ciclo di
  insert — anche un file forgiato che dichiara `admin_users` non tocca mai
  la tabella, nemmeno dopo un refactor della lista.
- **Probe `/setup` chiuso dal lock**: `testConnectionAction` riverifica
  `setupState()` prima di toccare il database; a wizard completato l'endpoint
  risponde «Il wizard è già stato completato» — coerente col 404 del layout.
- **Password temporanea del reset in nota monouso** (migration `032`,
  `lib/note.ts`): non viaggia più nell'URL (`?temp=…` finiva in cronologia,
  referer e log intermedi). L'action la stipa in `flash_notes` cifrata
  AES-256-GCM (chiave da `ADMIN_SESSION_SECRET`, pattern delle chiavi AI),
  audience = solo l'email dell'attore, TTL 10 minuti con sweep; la pagina la
  RIVENDICA una volta con `DELETE … RETURNING` atomico (audience verificata
  in query con `?|`). Redirect solo con flag opaco `?note=<id>`; claim
  sbagliato → messaggio neutro, senza oracoli. Fallita la stash (DB
  momentaneo) l'esito resta generico: il segreto non entra mai nell'URL.

### Verifica
- Sentinelle RBAC nuove in `tests/users-rbac.test.mjs`: admin_users fuori
  da ordine/dipendenze/filtri, probe chiuso dal lock, nessun segreto
  nell'URL del reset. Suite: 206/206.
- **E2E nuove** in `tests/e2e/backup-restore.spec.ts` (app viva, login
  reali): backup 401 senza sessione; il file scaricato NON contiene
  `admin_users`; reset con nota monouso (banner una volta, URL pulito, la
  temporanea vale al login da contesto fresco); **attacco vivo**: un admin
  semplice carica un backup forgiato con `role: 'super_admin'` → il piano
  non propone la tabella, il restore completa le tabelle legit e l'attore
  resta `admin` nel DB. Suite completa: 29/29.
- `tsc --noEmit` ✓, ESLint ✓, build di produzione ✓.

### Conseguenze
- I backup preesistenti contengono ancora i dati degli account: vanno
  custoditi o cancellati; i nuovi non li includeranno più.
- Al deploy serve la migration `032-flash-notes.sql` (wizard o
  `npm run db:migrate`); senza, il reset manuale degrada con esito generico
  «rilancia il reset», mai con segreti esposti.
- Ripristinare account da backup non è più possibile (per design): la via
  resta la gestione da `/admin/utenti`, tracciata in audit.

---

## [Pannello Shield «Reset password»] — 2026-09-27 · Lo spam del reset diventa visibile

### Contesto
Con il captcha attivo l'endpoint non inonda più le caselle, ma lo spam ai
suoi danni restava invisibile: bisognava setacciare a mano gli eventi Shield
e l'audit. Ora Shield mostra gli ultimi tentativi di reset con l'esito
classificato, per vedere a colpo d'occhio «sta arrivando spam» da «tutto
regolare».

### Aggiunto
- **Pannello «Reset password — tentativi recenti»** (tra la card captcha e
  gli IP bannati): righe audit 48h (max 12) con esito per riga — Inviata /
  Fallita / Cambiata — attore, dettaglio dell'errore (es. motivo invio
  fallito) e timestamp. Due contatori 24h accanto al titolo: richieste
totali e invii falliti.
- `getResetAttempts()` + `classifyResetAttempt()` in lib/shield: l'audit è
  la fonte (il blocco captcha/rate non ci scrive — è un redirect prima —
  quindi il pannello mostra ciò che è arrivato davvero al flusso email).

### Verifica
- E2E dedicato: seed con esiti misti → contatori ≥ soglia, classificazioni
  visibili, attore e dettaglio leggibili. Asserzioni relative perché
  l'audit è append-only e la top-12 può contenere righe reali di suite
  precedenti (le posizioni non sono il contratto del pannello).
- Pipeline: 196/196 sentinelle · 25/25 E2E · lint 0/0 · typecheck ✓.

---

## [Captcha su password-dimenticata] — 2026-09-27 · Anche il reset è protetto

### Contesto
`/admin/password-dimenticata` è un endpoint PUBBLICO che invia email: il
bersaglio ideale per bombardare le caselle dell'agenzia (rate limit 3/h
esistente, ma un bot blockato dal captcha non consuma nemmeno quello).

### Aggiunto
- **Captcha invisibile sulla richiesta di reset**: widget dedicato
  (`wac-turnstile-reset`) + campo token nel form. La verifica sta PRIMA del
  rate limit e SENZA violazioni Shield (come sul login). L'errore anti-bot è
  NEUTRO come tutte le risposte della pagina: l'anti-enumerazione resta
  integro anche sull'errore.
- **Il form col token privato NON monta il widget**: chi ha il link email ha
  già superato la verifica fuori banda — zero attrito dove non serve.
- La pagina legge la site key al volo dal DB: le chiavi salvate su Shield
  dopo il deploy proteggono il reset senza riavvii (solo la via env richiede
  il restart).

### Verifica
- E2E password-reset: widget montato + token prima del submit, richiesta con
  captcha attivo → risposta neutra, form token senza widget.
- Prova di produzione-like aggiornata: **6/6** su `next start` (build).
- Sentinella dedicata (captcha prima del rate limit, neutro, widget solo
  sulla richiesta). Pipeline: 196/196 · 24/24 E2E · lint 0/0 · typecheck ✓.
- CHECKLIST-CAPTCHA-PRODUZIONE.md aggiornata (7 verifiche post-attivazione).

---

## [Captcha: prova di produzione] — 2026-09-27 · 5/5 su build reale + checklist attivazione

### Cosa è stato provato (e come)
Verifica del captcha contro un server BUILD (`next start` su :3105, motore
identico al deploy — non il dev) con DB E2E e chiavi di TEST Cloudflare:
- **Login**: widget invisibile montato, script Cloudflare caricato, token
  generato (poll su `window.wacTurnstile`), login reale riuscito;
- **Chat**: percorso ricerca → /consulenza → `chat/init` passa la verifica
  (greeting + bottoni pronti, mai `captcha_failed`);
- **Lead**: widget globale sulle pagine pubbliche con token pronto;
- **siteverify**: la catena runtime → Cloudflare risponde davvero — secret
  corrotta → `success:false`, `invalid-input-secret` (niente fail-open
  silenzioso). Con le chiavi di TEST qualunque token è valido per design:
  il rifiuto vero lo dimostra la secret sbagliata.

### Aggiunto
- `tests/e2e/prodlike-captcha.spec.ts` + `playwright.prodlike.config.ts`:
  la prova gira SOLO con `--config playwright.prodlike.config.ts` contro il
  server :3105 (la config standard la ignora: esige il server a mano).
- `scripts/prodlike-server.sh start|stop`: lancia/ferma il server build
  staccato (double-fork python: le shell dei tool uccidono i figli diretti).
- **`CHECKLIST-CAPTCHA-PRODUZIONE.md`**: chiavi su Cloudflare (dominio,
  Invisible), scelta env-vs-Shield (le env vincono: attenzione alle chiavi
  di test), inserimento da Shield, 6 verifiche post-attivazione, prove
  ripetibili, ripristino d'emergenza (Rimuovi config DB = captcha off).

### Verifica
Pipeline standard: 195/195 sentinelle · 23/23 E2E (prodlike esclusa) ·
lint 0/0 · typecheck ✓. Prova produzione-like: 5/5.

---

## [Eventi Shield filtrabili] — 2026-09-27 · Pannello eventi per tipo + conteggi 7 giorni

### Aggiunto
- **Conteggi ultimi 7 giorni per tipo** nella pagina Shield: pill cliccabili
  (Rate limit, Honeypot, Payload sospetto, Ban, Sblocco) che filtrano la lista
  «Eventi recenti». I tipi noti si vedono anche a zero; un tipo comparsouna
  volta in DB (non previsto) aggiunge la sua pill. «Tutti» rimuove il filtro.
- **Filtro via searchParams** (`?kind=rate_limit`): condivisibile e
  ri-apribile; la query lista è parametrizzata e il valore del filtro è
  validato contro i tipi conosciuti (un valore sconosciuto torna «tutti»,
  mai lista rotta). Con filtro attivo la lista mostra fino a 50 eventi.
- Lista vuota con filtro attivo → messaggio dedicato (non quello generico).

### Perché
Con Shield che ora copre login, chat, lead, callback e captcha, il log unico
mescolava eventi di natura diversa: per capire «sta arrivando un attacco o
è solo il rate limit delle 18:00?» serviva leggere riga per riga. I conteggi
7 giorni danno la tendenza a colpo d'occhio, il filtro isola il tipo.

### Verifica
- E2E `pannello eventi` (in turnstile-shield.spec.ts): seed deterministici
  (auto-pulenti per rerun-safety), conteggi esatti (l'evento di 8 giorni fa
  NON conta), filtro che isola il tipo, «Tutti», tipo senza eventi con
  messaggio dedicato, filtro sconosciuto senza rotture.
- Sentinella nuova in tests/turnstile-shield.test.mjs (query 7 giorni,
  validazione filtro, link encodati). Pipeline: 195/195 · 23/23 E2E ·
  lint 0/0 · typecheck ✓.

---

## [Captcha su Shield] — 2026-09-27 · Turnstile invisibile su login + chiavi configurabili

### Contesto
Il captcha invisibile (Cloudflare Turnstile) proteggeva solo chat e lead,
e le chiavi vivevano solo in .env: modificarle richiedeva un rideploy e il
login del team restava scoperto dietro il solo rate limit.

### Aggiunto
- **Chiavi gestibili da Shield** (card «Captcha invisibile»): site key +
  secret salvate su content_settings, la SECRET CIFRATA AES-256-GCM (stesso
  meccanismo di SMTP/API key) e MAI restituita al client — solo un hint
  mascherato. Priorità env > DB dichiarata nella UI; config DB rimovibile
  (le env tornano la fonte attiva). Audit: shield.turnstile_save / _clear.
- **Login protetto**: widget dedicato + campo token che aspetta il challenge
  lazy (max 5s) prima del submit; token monouso → il widget si resetta dopo
  ogni tentativo fallito. Un token mancante/invalido blocca PRIMA di
  consumare il rate limit e SENZA violazioni Shield (il widget è lazy: un
  timing sfavorevole non è un abuso).
- **verifyTurnstile settings-aware**: chiavi attive da env o DB; fail-open
  se l'API Cloudflare è irraggiungibile (mai bloccare i clienti veri).
- **Widget multi-istanza**: siteKey/containerId via prop dal server (le env
  non toccano più il client), login e widget globale coesistono.

### Nota operativa
Per attivare in produzione: pannello Cloudflare → Turnstile → chiavi di
produzione → incollarle in Shield. Per lo sviluppo restano le chiavi di TEST
ufficiali Cloudflare in .env.e2e (sempre valide, widget invisibile).

### Verifica
- E2E 4 nuovi (`turnstile-shield.spec.ts`): login reale con captcha attivo,
  salvataggio (secret mai in chiaro né nella pagina né nel DB), audit,
  rimozione config. Sentinelle 7 nuove (`tests/turnstile-shield.test.mjs`).
- Pipeline: 194/194 sentinelle · 22/22 E2E · lint 0/0 · typecheck ✓.
- Fix correlato: password-reset.ts logga l'errore DB del reset (un fallimento
  di persistenza non deve restare invisibile) e rollback resilient.

---

## [Recupero password self-service] — 2026-09-27 · «Password dimenticata» via email

### Contesto
Fin a oggi un utente che perdeva la password era bloccato finché un super
admin non gliene settava una temporanea da /admin/utenti. Ora chi non entra
può sbloccarsi da solo: link «Password dimenticata?» nella pagina di login →
email con link monouso (1 ora) → nuova password scelta dall'utente.

### Aggiunto
- **Migration 031**: tabella `password_reset_tokens` (email, token_hash,
  expires_at, used_at, created_ip, created_at). Il token (256 bit random)
  nel DB va SOLO come SHA-256: un backup o una lettura DB non permettono di
  resettare nessuno.
- **`src/lib/password-reset.ts`**: richiesta + conferma. Le regole non
  negoziabili: risposta SEMPRE neutra (che l'email esista o no lo schermo e
  il timing non cambiano — il token viene generato prima del check di
  esistenza, l'audit distingue solo per il super admin); token monouso con
  scadenza 1h; reset in transazione su client dedicato (begin/commit su
  pool.query finirebbero su connessioni diverse); minimo 8 caratteri.
- **Pagine `/admin/password-dimenticata`**: form email → conferma neutra →
  form nuova password (con conferma). Errori tradotti (token/scaduto/
  validazione/rate/db). Link «Password dimenticata?» aggiunto alla login.
- **Rate limit 3 richieste/ora per IP** sull'invio del link (anti-spamming
  caselle); ogni richiesta e ogni esito finiscono nell'audit log.
- **Sessioni**: al reset la password cambia → il fingerprint del cookie non
  matcha più → tutte le sessioni dell'account muoiono (meccanismo esistente
  di lib/admin, zero codice nuovo).

### Nota operativa (SMTP)
L'invio usa `sendEmailViaTools` (SMTP configurabile da Impostazioni → Tools).
Se l'email NON è configurata, la richiesta resta comunque neutra per
l'utente, l'audit registra `invio fallito: non configurata` e il super admin
deve continuare a usare il reset manuale da Utenti. Al deploy: applicare la
migration 031 e configurare l'SMTP.

### Verifica
- E2E `password-reset.spec.ts` (4 test): risposta neutra IDENTICA per email
  esistente e ignota; token hashato con scadenza ~1h; reset completo (nuova
  vale, vecchia morta ai login reali); token monouso.
- Sentinelle 6 nuove (`tests/password-reset.test.mjs`): token solo hashato,
  neutralità strutturale, monouso/scadenza, transazione, rate limit, messaggi.
- Fix di infrastruttura test: `workers: 1` in Playwright (i file girano in
  parallelo anche con `fullyParallel: false`; password-reset e utenti
  scrivono entrambi admin_users → race sul seed) + pulizia finale della spec
  password-reset (non deve lasciare *@e2e.local nel DB condiviso).
- Pipeline: 160/160 sentinelle · 18/18 E2E · lint 0/0 · typecheck ✓.

---

## [Cambio email + logout rotto] — 2026-09-27 · L'email si cambia (con password), il logout rifatto

### Aggiunto
- **Cambio email self-service** (Area personale, per TUTTI gli utenti): nuova
  email + **password corrente obbligatoria** (l'email è l'identità di login:
  senza conferma chi lascia il pc aperto perderebbe l'account). Al successo la
  sessione viene RI-EMESSA con la nuova email (resti dentro), le altre
  scadono da sole. Validazioni: formato, collisione (anche via race — il
  duplicate key del DB è gestito), audit `user.email_change`.
- **Cambio email da super admin** (pagina Utenti): form inline nella card di
  ogni utente; le sessioni dell'utente muoiono col vecchio payload firmato.
- **E2E 2 scenari nuovi** (spec utenti, 8 totali): cambio email proprio con
  password sbagliata rifiutata → giusta → logout → rientro SOLO con la nuova;
  super admin cambia email a un altro dalla UI.
- Sentinella nuova: password obbligatoria, validazioni, audit, re-issue
  sessione, form con password attuale (154 test totali).
- **Account `dddigitalink@gmail.com` creato super admin** sul DB di sviluppo
  (credenziali consegnate a parte, non nel repo).

### Corretto (scoperto dall'E2E nuovo)
- **IL LOGOUT ERA ROTTO**: /admin/logout era una pagina con form verso una
  Server Action che non si auto-inviava (nessun JS lo faceva partire) — il
  click su «Esci» lasciava l'utente su /admin/logout CON LA SESSIONE VIVA.
  Rifatta come Route Handler GET che cancella il cookie e redirige al login.
- **Rate limit vs E2E**: la spec utenti fa 14 login reali/ora dallo stesso IP
  (8/h in produzione): il test finiva bloccato da «Troppi tentativi». Con
  `WAC_E2E=1` (impostata dal webServer Playwright) il limite sale a 100 SOLO
  nell'ambiente di test; in produzione resta 8/h per IP.

---

## [Utenti e area personale] — 2026-09-27 · Ruoli super_admin/admin, gestione account e anagrafica per utente

### Aggiunto
- **Ruoli sull'account** (migration `030`): `role` (`super_admin` | `admin`, con
  CHECK sul dominio) e `active` su `admin_users`. **Il primo account per data di
  creazione viene promosso automaticamente a super admin** — nessuna password in
  chiaro nel repo, promozione idempotente (vince solo se non esiste già un
  super admin). Sul DB di sviluppo: `info@webagencycrema.com`.
- **`src/lib/users.ts`**: guardie `requireSuperAdmin()` / `requireActiveUser()`
  (il ruolo è riverificato sul DB a ogni richiesta: declassamento o disattiva-
  zione valgono SUBITO, nessuna sessione fantasma), gestione utenti completa
  (crea, cambio ruolo, attiva/disattiva, **reset password con temporanea
  one-shot mostrata una sola volta**, cancella). Protezioni: mai azioni
  distruttive sul proprio account, **mai declassare/disattivare/cancellare
  l'ultimo super admin attivo** (backstop server contro race e chiamate dirette).
- **Area personale `/admin/profilo`** (per ogni utente): scheda identità
  (email, ruolo, stato) + 10 campi anagrafici editabili — nome, cognome,
  **partita IVA**, codice fiscale, **telefono**, **via e numero civico**, città,
  provincia, CAP, note. Salvataggio con toast, bottone disabilitato quando non
  c'è nulla da salvare; email/ruolo non passano MAI dal form (whitelist dei
  campi in `updateOwnProfile` con mappa esplicita colonna↔campo).
- **Gestione utenti `/admin/utenti`** (solo super admin): lista account con
  ruolo/stato/anagrafica, creazione con password iniziale, azioni per utente.
  Ogni azione finisce in `audit_log` con l'attore (`user.create`, `user.role`,
  `user.deactivate`, `user.password_reset`, `user.delete`).
- **Account disattivato = doppio lucchetto**: rifiutato al login (check DOPO la
  verifica password: il timing non enumera lo stato) e le sue sessioni vive
  muoiono all'istante (enforcement centrale in `getAdminUser`, copre ogni pagina
  /admin). Verificato E2E con due contesti browser simultanei.
- **Nav e ⌘K**: «Area personale» per tutti; «Utenti» visibile SOLO ai super
  admin (il ruolo arriva dal layout); palette aggiornata con entrambe le schede.
- **Sentinelle** (`tests/users-rbac.test.mjs`, 8): promozione idempotente nella
  migration, guardie server-side su ogni azione, protezioni ultimo-super/self,
  divieto di loggare la password temporanea, gating nav/pagina, E2E agganciato.
- **E2E** (`tests/e2e/utenti.spec.ts`, 6): seed scrypt su `wac_e2e`, creazione
  account reale via UI, anagrafica persistita nel DB e riletta dopo reload,
  gating ruolo (nav + URL diretta), disattivazione con revoca immediata,
  autoprotezione dell'ultimo super admin. Login reali: 6 (< rate limit 8/h).

### Corretto
- Copy login datata («riservato a Daniele e Michele»): gli account ora si
  gestiscono da Utenti. `GlassCard` ora diffonde props arbitrarie (`data-*`).

### Nota operativa
- Il deploy richiede la migration `030` sul DB di produzione (già tracciata dal
  runner: `DATABASE_URL=… node scripts/db-migrate-all.mjs`). Prima dell'upgrade
  TUTTI gli account esistenti valgono `admin`: solo il primo storico diventa
  super admin — assegnare ruoli extra da `/admin/utenti` dopo il primo login.

---

## [E2E chat lead-gen] — 2026-09-27 · Il motore del business sotto sorveglianza end-to-end — e il bug che ha smascherato

### Scoperto (e corretto)
- **BUG CRITICO di produzione, invisibile da 4 giorni** (introdotto dal commit
  `66d2d61` del 23/09): nell'INSERT di `/api/lead` i valori `company`/
  `company_name` erano stati appesi **in coda all'array** invece che nelle
  posizioni $8/$9 → la colonna boolean `hot` riceveva una stringa, l'INSERT
  falliva **ogni volta**, il `catch` ingoiava l'errore e l'API rispondeva
  comunque `ok: true` con la chiusura a video e la notifica Telegram partita.
  **Nessun lead è stato salvato nel DB dal 23/09**: il flusso «sembrava»
  funzionare perché l'utente vedeva la conferma. Corretto l'ordine dei
  parametri; ora l'INSERT resta allineato perché una sentinella confronta
  numero di colonne e numero di valori.
- La risposta di `/api/lead` ora espone `leadInsertFailed`: un fallimento di
  persistenza non può più restare invisibile (prima: `ok:true` senza leadId).

### Aggiunto
- **E2E chat lead-gen** (`tests/e2e/chat-lead.spec.ts`, Playwright): apertura
  dalla ricerca home («Cerca servizi digitali» → `/consulenza?q=…`), greeting
  con la query citata, percorso completo dei 9 step dello script (5 a bottoni,
  3 testuali con validazione, checkbox consenso), **lead rilegto dal DB** con
  tutti i campi (nome, telefono, service, urgency, existing_site, budget,
  company, company_name, consent, initial_query, source_page) e conversazione
  marcata `lead_captured` con le **8 risposte del visitatore persistite** via
  `/api/chat/message` — la trascrizione che il team rilegge è completa.
- **DB E2E disposable** (`scripts/e2e-db-reset.mjs`): drop+create di `wac_e2e`
  locale, schema + tutte le migration col runner del repo. DSN configurabili
  via `E2E_PG*` (in locale trust auth senza utente esplicito — il ruolo
  «postgres» non esiste su Homebrew; in CI `E2E_PGPASSWORD` imposta utente+
  password del servizio). Prod intoccabile: DSN mai hardcoded.
- **`.env.e2e` committato**: contiene solo DSN locale e chiavi di **test**
  pubbliche Cloudflare (site+secret «always valid»): l'E2E funziona out-of-
  the-box per chiunque cloni il repo, Turnstile fail-open con token di test.
- **CI con Postgres** (`overlay-guard.yml`): servizio `postgres:16`, step di
  reset del DB E2E, `DATABASE_URL` per Next, `E2E_PGPASSWORD` per reset e spec.
- **Sentinelle** (`tests/chat-e2e.test.mjs`, 6): copertura degli step nella
  spec, **allineamento colonne↔valori dell'INSERT** (l'invariante che il bug
  `66d2d61` ha violato), divieto di catch silenziosi sulla persistenza, reset
  env-driven, CI agganciata, nessun segreto in `.env.e2e`.
- Nota sul flusso reale, fissata nella spec: il **greeting apre la chat e i
  bottoni del primo step appaiono senza il testo della domanda** (implicito nel
  saluto); le domande successive arrivano come messaggi con typing delay.

### Verificato
- E2E **6/6 verdi** (4 consenso + 2 chat) in ~21s; il percorso completo UI→DB
  dura 15,7s e termina con il lead nel DB, non solo con la conferma a video.
- Suite 144/144 · lint 0/0 · typecheck ✓ · overlay guard ✓.

---

## [E2E consenso cookie] — 2026-09-27 · Playwright entra nel repo, il flusso GDPR è sorvegliato

### Aggiunto
- **Playwright 1.63** (chromium) con `npm run test:e2e` e `playwright.config.ts`:
  il webServer E2E gira su **distDir proprio (`.next-e2e`)** e porta 3100 — il lock
  «another dev server» di Next 16 vive nel distDir, quindi nessun conflitto col dev
  diurno (3200). In locale riusa un server già attivo; in CI ne monta uno suo.
- **4 scenari E2E** (`tests/e2e/consent.spec.ts`): banner al primo visitatore con
  **nessuno script googletagmanager nel DOM pre-consenso**, «Solo necessari» →
  denied persistente al reload, «Accetta tutti» → granted persistente, **cambio
  idea dal footer** («Preferenze cookie» → riapre → la nuova scelta vince).
- **Job CI esteso**: install chromium + `test:e2e` dopo lint/guard/typecheck/test.
- **Sentinelle** (`tests/consent-e2e.test.mjs`): la spec deve coprire i quattro
  passi, il footer deve restare agganciato a `openPreferences`, la condizione di
  riapertura non può più dipendere da `consent === "unknown"`.

### Il valore dimostrato al primo giro
- L'E2E ha **preso due difetti veri**: (1) il «cambia idea dal footer» promesso
  dalla cookie policy **non esisteva** — `openPreferences` era privo di qualunque
  aggancio UI, e la condizione `showBanner && consent === "unknown"` avrebbe
  impedito per sempre di riaprire il banner dopo una scelta: creato il bottone
  nel footer («Preferenze cookie», visibile solo a chi ha già scelto, al posto
  del link Cookie policy) e tolta la condizione; (2) una regressione introdotta
  dal refactor setState-in-effect — il banner riappariva al reload anche con
  consenso già espresso (l'effect di mount ignorava il cookie): corretta con il
  check del cookie nell'effect. Le asserzioni di persistenza inizialmente
  fallivano anche per un errore del TEST (init script che cancellava il cookie
  a ogni load, incluso il reload): rimosso — il contesto Playwright è già
  pulito per ogni test.

### Verificato
- **4/4 E2E** · lint 0/0 · typecheck ✓ · **138/138 test** ✓ · guard ✓.

---

## [Lint 0/0 con regole React Compiler] — 2026-09-27 · i 10 pattern rifattorizzati, non silenziati

### Il debito chiuso
I 10 warning `react-hooks/set-state-in-effect` (baseline nota della fase 16) sono
portati a zero con fix canonici — e il downgrade della regola a warning è stato
**rimosso** dalla config: tornata `error`, ogni nuovo setState sincrono in effect
rompe la lint.

| File | Pattern | Fix |
|---|---|---|
| `consent.tsx` | cookie letto in effect | **`useSyncExternalStore`**: il cookie è la verità (subscribe focus/visibility), zero mirror di stato |
| `hero-cursor-glow.tsx` | gate media-query con state | **`useSyncExternalStore`** con server snapshot `false`: niente mismatch di idratazione (regressione scoperta al browser e corretta) |
| `admin-nav.tsx` | chiudi menu su cambio path | **reset in render** con firma `{ forPathname, openMenu }` (pattern docs) |
| `admin-command-palette.tsx` | reset query/active in effect | reset **derivato con firma** `{ sig: open:query, active }`; focus via `autoFocus` nativo; overflow in effect puro |
| `ticket-search.tsx` | `if (q) setOpen(true)` in effect | valore **derivato**: `openDerived = open \|\| Boolean(q)` |
| `ai-faq-editor.tsx` | copia prop in state al mount | lazy init da prop (la prop dei search params non cambia nel ciclo di vita) |
| `hero-editor.tsx` | reset `setCfg(saved)` mount-only (dead) | **rimosso**: i dati server via router.refresh non richiedono risincrono client |
| `turnstile-widget.tsx` | `setMounted(true)` in effect | rimosso il flag: `setupGlobal()` idempotente, il ref callback non dipende più dallo state |
| `ticket-chat.tsx` | `void load()` sincrono in effect | primo giro in `requestAnimationFrame` (fuori dal corpo sincrono) |

### Verificato
- lint **0 errori / 0 warning** · typecheck ✓ · **134/134 test** ✓ · build con zero
deprecation warning.
- **Browser (dev server)**: banner cookie — assenza con cookie presente, comparsa
post-idratazione senza flash, grant/deny funzionanti (cookie scritto, banner chiuso);
glow hero — portale montato e `data-hero-cursor="on"`; console **senza hydration
error** (prima del fix useSyncExternalStore ce n'era uno, introdotto dal primo
tentativo e subito corretto); palette e polling non toccati visivamente.

### Nota
- `turnstile-widget` non usa più `useState`: il flag `mounted` rendeva il primo
  giro dello script condizionato a un re-render extra senza beneficio (setup è
  idempotente). Comportamento invariato con site key assente (nessun widget).

---

## [Convenzione proxy di Next 16] — 2026-09-27 · zero deprecation warning nella build

### Cambiato
- **`src/middleware.ts` → `src/proxy.ts`** con il codemod ufficiale
  `@next/codemod middleware-to-proxy`: export rinominato `middleware` → `proxy`,
  matcher e logica invariati (redirect 301 SEO + protezione sessione admin),
  niente runtime segment da rimuovere (non era dichiarato). Nota operativa: con
  source = file o path assoluto il codemod canary rispondeva «file inesistente»
  (stub npx su macOS); è passato solo con **source = directory** (`npx -y
  @next/codemod@latest middleware-to-proxy src`) — e i contatori finali mentivano
  (0 ok), ma il file era stato scritto correttamente.
- **`/og` senza `export const runtime = "edge"`**: su 16 il runtime di default
  (Node) supporta `next/og`; la dichiarazione era il motivo dell'ultima warning di
  deprecazione e disabilitava la generazione statica della rotta. Verificato:
  `/og` → 200 `image/png`.
- Commenti di riferimento allineati (proxy.ts, route seo/config, lib/seo.ts); lo
  storico del CHANGELOG resta storia.

### Risultato
- **Build con ZERO deprecation warning** (prima: middleware→proxy + Edge runtime).
- Comportamento runtime preservato: `/admin` 307 al login (proxy attivo), home/
  consulenza 200, `/og` 200 image/png, first load 197,8 kB gzip (stabile).
- Sentinelle (`tests/next16-proxy.test.mjs`): proxy.ts con export `proxy` e
  matcher, niente `middleware.ts`, nessun `runtime = "edge"` nel codebase.

---

## [Baseline 15.5.26 misurato] — 2026-09-27 · il confronto apples-to-apples ribalta i numeri

### Il dato
- Misura con `scripts/measure-payload.mjs` del lavoro pre-upgrade, ricostruito in un
  **worktree git isolato** all'ultimo commit 15.x (`45386d4`, poi `next@15.5.26`:
  scoperta a margine — l'upgrade 15.5.26 del Passo 1 non era mai stato committato,
  era vissuto solo nell'albero di lavoro fino al commit dell'upgrade 16).
- **Il «103 kB» della metrica First Load di 15.x non era comparabile**: escludeva i
  chunk per-route e i preload. Il payload reale servito dalla produzione 15.5.26 era
  **238,4 kB gzip** (JS 206,7 + CSS 15,8 + HTML 15,9; 17 asset).

### Confronto apples-to-apples (home `/`, stessa macchina, stessa sessione)

| Configurazione | JS gzip | Totale gzip | vs baseline 15.5.26 |
|---|---|---|---|
| 15.5.26 webpack (produzione pre-upgrade) | 206,7 kB | **238,4 kB** | — |
| 16.3.6 webpack (default deploy attuale) | 166,5 kB | **197,3 kB** | **−41 kB (−17%)** |
| 16.3.6 Turbopack | 239,2 kB | ~270 kB | +13% |

- **L'upgrade Next 16 su webpack è un miglioramento del payload del −17%** sul
  first load reale: i 41 kB in meno si pagano da soli.
- La penalità Turbopack sul vero baseline è **+13%** (32 kB), non il +80% suggerito
  dal vecchio confronto metrica-vs-misura. La scelta del deploy su webpack resta
  (migliore su entrambe le dimensioni), ma il prezzo del futuro switch Turbopack è
  molto più basso di quanto stimato al Passo 2.
- Il budget `bundle-watch` (210 kB) è ora **più severo della produzione storica**:
  regredire fino al payload 15.5 fa già suonare l'allarme.

### Lezione di misura (valida per sempre)
- Una metrica di build («First Load JS» di 15.x) e una misura di payload servito
  **non sono la stessa grandezza**: ogni confronto va fatto con UNA sola unità.
  Da oggi l'unità unica del repo è `scripts/measure-payload.mjs`.

---

## [Bundle watch in CI] — 2026-09-27 · Passo 4 del piano, attivato in anticipo

### Aggiunto
- **Job CI `bundle-watch`** (`.github/workflows/bundle-watch.yml`): a ogni push/PR su
  main esegue la build di release (guard incluso) **cronometrandola**, avvia
  `next start` e misura il **first load gzip reale** della home con
  `scripts/measure-payload.mjs` — il sostituto della tabella "First Load JS"
  rimossa in Next 16. Risultato nella **GitHub Step Summary** (tabella build-time +
  first load) e salvato come artefatto `bundle-report`.
- **Budget d'allarme a 210 kB** (`scripts/check-bundle-budget.mjs`): +6% sui ~198 kB
  webpack-16 misurati al Passo 2 — esattamente il regresso Turbopack (239 kB) da non
  pagare due volte. L'allarme fallisce il job, così il confronto con il budget è
  visibile nella PR prima del merge. Se un giorno si migra a Turbopack, il budget va
  rinegoziato con una misura nuova PRIMA del merge: un contratto, non un rumore.
- **Sentinelle** (`tests/bundle-watch.test.mjs`): il workflow deve restare collegato
  agli script reali, con budget esplicito e formato misura coerente — se qualcosa si
  scollega, la suite rompe prima del deploy.

### Verificato in locale
- Build **senza DATABASE_URL e senza .env.local**: exit 0 — in CI **zero segreti**.
  La home senza DB risponde 200 con il fallback CSS del hero (marker `data-template`
  presente), quindi la misura su `/` regge nell'ambiente pulito della CI.
- Catena misura→budget: 197,3 kB misurati (in linea con i ~198 del Passo 2); ✓ sotto
  budget, ✖ + exit 1 con budget forzato a 150: l'allarme suona davvero.
- 132/132 test (4 sentinelle nuove) · lint ✓ · typecheck ✓ · guard ✓.

### Nota
- Il repo resta senza remote: il workflow (come overlay-guard.yml) è pronto per
  quando il repo verrà pubblicato su GitHub — la convenzione già adottata nel repo.
- I tempi di build del job sono comparabili solo tra run della stessa classe di
  runner (ubuntu-latest di GitHub), non con i valori misurati in locale (M4 Pro).

---

## [GO Next 16] — 2026-09-27 · main fuso, deploy pronto su webpack, Passo 3 armato

### Decisione
- **Go firmato**: `upgrade/next-16` fuso su main con fast-forward (`0abd0d0`), gate
  completo al merge (lint 0 errori · typecheck ✓ · 128/128 test ✓ · guard ✓ ·
  `build:local` exit 0 su **webpack**). Main gira ora **Next 16.3.6**.
- Strategia ereditata dal Passo 2: il paracadute `--webpack` diventa il **default del
  deploy** (payload ~198 kB gzip vs ~270 kB di Turbopack), Turbopack resta dietro
  `build:turbo`/`dev:turbo` (build a caldo da 6s) finché il gap JS di ~70 kB non si
  chiude o dietro scelta deliberata.

### Aggiunto
- **`scripts/verify-deploy.mjs`**: verifica post-deploy del Passo 3 — rotte chiave
  (home, consulenza, sitemap, robots, health), health con `database: ok`, marker
  `data-template` del sistema hero nella home (prova che il DB di produzione
  risponde). Exit 1 al primo fallimento. Collaudato in locale: 7/7 ✓.

### Cambiato
- `package.json`: `build`/`build:local`/`start` con `--webpack` esplicito; `dev` pure
  (parità dev/deploy), `dev:turbo` e `build:turbo` per Turbopack (quest'ultimo ora
  con guard e `WAC_DIST_DIR=.next-prod`, allineato agli altri).
- PIANO-NEXT-16-TURBOPACK.md: Passo 3 «IN CORSO» con la procedura concreta
  (repo locale senza remote → collegare GitHub o Vercel CLI, primo deploy su
  staging senza dominio, verifica con verify-deploy + measure-payload, osservare
  il cron un ciclo prima del dominio di produzione).

---

## [Next 16.3.6 su branch dedicato] — 2026-09-27 · Passo 2 del piano, misura bundle inclusa

### Metodologia
- Upgrade eseguito **su branch `upgrade/next-16`** (mai su main): `next` 15.5.26 → 16.3.6, `@next/third-parties` allineato alla 16.3.6. React resta 19.3.0.
- In 16 la tabella **"First Load JS" è scomparsa dall'output di build** (sia Turbopack che webpack): creata **`scripts/measure-payload.mjs`**, misura sostitutiva permanente per la sorveglianza bundle del Passo 4 — scarica HTML, chunk JS e CSS della route e somma le dimensioni **gzip reali** (deterministica, indipendente dal server).

### Numeri (M4 Pro, build di produzione, home `/`)

| Configurazione | First load (payload gzip servito) | Tempo build |
|---|---|---|
| 15.5.26 webpack (baseline su main) | 103 kB con la metrica First Load di Next (il nuovo strumento misura il payload: a regime sarà il termine di paragone) | ~20s |
| **16.3.6 Turbopack (default)** | **~270 kB** (239 JS + 16 CSS + 16 HTML gzip) | **6s a caldo, compile 572ms** — la cache persistente è arrivata ed è spietata |
| **16.3.6 webpack (`--webpack`)** | **~198 kB** (166 JS + 16 CSS + 16 HTML) | 19s |

- Route table **identica**: 65 route, stesso split statico/SSG/dinamico su entrambi i bundler.
- **Il paracadute `--webpack` funziona su 16**: il deploy può partire con bundler webpack e payload ~198 kB, migrando a Turbopack quando il divario JS (239 vs 166) si chiude.

### Decisione
- L'upgrade **resta su branch**: main continua a girare 15.5.26 finché non si firma il go. Turbopack-16 consegna ancora ~1,4× il JS di webpack-16, ma il tempo di build a caldo rende la 16 attraente: o si parte col deploy su `--webpack` (payload sotto controllo, bundler ufficiale fino a fine 16) o si accetta il payload Turbopack in cambio di build da 6 secondi. Decisione operativa, non tecnica.

### Sicurezza
- **Il residuo postcss del Passo 1 è chiuso**: su 16 le 6 advisory dentro `next/node_modules/postcss` spariscono; `npm audit` scende a **3 advisory (1 low, 2 moderate)** tutte in `@hono/node-server` 2.0.0–2.0.9 (dipendenza del driver Neon: path traversal serve-static su Windows + memory-leak WebSocket), ortogonali a Next. Il fix proposto è `neon@2.1.2` (breaking) — valutazione separata dall'upgrade Next.

### Porting richiesto da 16 (tutto fatto)
- `eslint-config-next@16` esporta **flat config nativa**: `eslint.config.mjs` aggiornato senza più `FlatCompat`.
- Le nuove regole **React Compiler** (react-hooks v6) alzano 10 errori `set-state-in-effect` su pattern di mount preesistenti. Fix meccanici fatti: `Chat.tsx` (accessi ref→state nei render), `lead-tools.tsx` e `ticket-chat.tsx` (purity: `Date.now()` spostato fuori dal percorso render). I restanti pattern di mount (gate da localStorage, focus/overflow command palette, cablaggio Turnstile) richiederebbero refactor a rischio regressione: abbassati a **warning con baseline nota = 10** e TODO tracciato in config (mai `eslint-disable` a ISOLONE).
- In `ticket-chat.tsx` la soglia di animazione è diventata **state fissato al primo load riuscito** (equivalente del ref `mountedAt`, senza lettura ref nel render): semantica invariata, regole contente.
- **Deprecation warning nuove di 16** (non bloccanti, schedulate nel piano): convenzione `middleware` → `proxy` (codemod ufficiale disponibile), Edge → Node runtime.
- `tsconfig.json`: `jsx: react-jsx` (automatic runtime, mandatory 16) e include tipi generati.
- TypeScript gira dentro la build (5,2s): la CI resta con `tsc --noEmit` indipendente, quindi nessuna verifica persa.

### Verificato
- lint **0 errori / 10 warning tracciati** · typecheck ✓ · **128/128 test** ✓ · build Turbopack ✓ **e** webpack ✓ su 16 · `next start` di produzione: `/`, `/consulenza`, `/api/health` → 200 · overlay-guard ✓.

---

## [Backup completo one-command] — 2026-09-27 · DB + codice dal tag, un solo comando

### Aggiunto
- **`npm run backup [-- --ref <tag>]`** (`scripts/backup-full.mjs`): in `backups/<nome>/` produce il **dump PostgreSQL completo** (pg_dump plain SQL gzip: schema+dati, ripristinabile con `psql -f` ovunque, Neon incluso), l'**archivio del codice esatto del ref** (`git archive`: solo file tracciati) e un **MANIFEST.json** con versione, commit (tag annotati dereferenziati), sha256 di ogni artefatto e istruzioni di restore/verifica. Il manifest è scritto solo se ENTRAMBI gli artefatti sono riusciti: mai un backup «parziale» che sembrava completo.
- Due guardie nate dal primo giro reale: **risoluzione del pg_dump più recente** (il PATH proponeva il 16, ma pg_dump rifiuta server 18 — il resolver passa per il Cellar homebrew e usa il 18.6) e **redazione delle credenziali** (pg_dump include il DSN con password nei suoi errori: ogni messaggio stampato è mascherato). `backups/` ignorato da git.
- Verificato sul vivo con checksum dal manifest OK, 36 tabelle nel dump (incluse `audit_log` e lo schema `neon_auth`), archivio da 439 file con i fogli CSS per dominio.

### Drill di restore eseguito (v0.3.0)
- **Restore completo su PostgreSQL locale usa-e-getta** (`wac_drill_v030` su 5432, mai il DB di produzione): 0 errori tranne il benigno `transaction_timeout` (parametro del server 18, atteso su server 16); 27 tabelle pubbliche, 4 admin, 83 conversazioni, `site_hero` alla configurazione di produzione (gradient-flow attivo).
- **App avviata dal codice dell'archivio** su DB di drill: `/api/health` → `ok / database ok`, 4 connessioni al server di drill e la prova regina — la home renderizza `data-template="gradient-flow"` **letto dal DB ripristinato**.
- Tre conoscenze operative tornate nel runbook del manifest: il client psql deve essere ≥ il server che ha generato il dump (marker `\unrestrict` di pg_dump 18); l'archivio non contiene `.git` quindi il restore serve `git init` prima di `npm ci` (postinstall); il DSN di drill verso server locali deve usare `localhost` (non `127.0.0.1`) per l'euristica SSL dell'app.
- Distruzione completa verificata: database di drill eliminato, codice e log rimossi, **Neon intatto (83 conversazioni)**. Backup definitivo: **`backups/wac-v0.3.0-20260927-121819/`**.

---

## [Versione 0.3.0] — 2026-09-27 · hero misurabile, CSS ordinato, chat viva

Le tappe atterrate dopo il tag v0.2.0, tutte verificate sul vivo o in build:

- **Hero animato con test A/B** (`3fb02ac`): 4 template stile Apple editabili da `/admin/tools/hero`, default spento; misurazione GA4 a doppia faccia (impression + dimensione `hero_variant` su ogni `search_start`). Il playtest dedicato (`0779ff2`) ha corretto due difetti reali: la scia del mouse mai nata (deadlock fra portale ed effetto) e le modifiche batched nell'editor che si sovrascrivevano (stale closure).
- **CSS per dominio** (`1b93716`): `globals.css` dimezzato (1033 → 559 righe, solo design system) con `admin.css`, `hero.css` e `chat.css` importati nell'ordine di cascata originale; il riordino dell'bundle è dimostrato inerte dalla scansione del codebase.
- **Chat Telegram, emoji picker e toolchain** (`066db95`): bolle con gradient animato, avatar con anello, picker configurabile da admin (20 emoji, target touch 44px); ESLint flat config in CI e pre-push, Turbopack valutato con benchmark (si resta su webpack per il deploy).

---

## [Next 15.5.26] — 2026-09-27 · Passo 1 del piano Next 16

### Aggiunto
- **`next` 15.5.4 → 15.5.26** (ultima 15.x stabile; dist-tag latest = 16.3.6, fuori dal Passo 1): rollup di patch di sicurezza e fix senza breaking change. React resta 19.3.0 (già dedupato), `@next/third-parties` allineato alla stessa 15.5.26.
- **`npm audit fix` non-forzato in coda**: sharp 0.35.4 (le due CVE high su libheif/libvips ereditate da Next) chiuse senza toccare la versione di next; residuo dichiarato e accettato: 6 vulnerabilità (1 low, 4 moderate, 1 high) TUTTE dentro `next/node_modules/postcss` — il fix richiederebbe next 16 (breaking), ed è esattamente il Passo 2 del piano. In produzione la superficie postcss/source-map non è esposta: l'attacco dichiarato (`.map` disclosure) non ha percorso nel deployment attuale.

### Verificato
- **Criterio d'uscita del Passo 1 pienamente soddisfatto**: lint 0/0 · typecheck ✓ · **128/128 test** ✓ · overlay-guard ✓ (187 file) · `build:local` ✓ (First Load 103 kB, +1 kB da import di Link nuovi — traccia del turno lint) · `next start` di produzione: `/`, `/consulenza?q=…`, `/privacy-policy`, `/sitemap.xml`, `/api/health` 200 (health con DB ok e operatore di turno reale) · boot `next dev` webpack: 200 su home e consulenza · **ZERO deprecation warning** nei log di build e dev (nessun legacyBehavior/AMP/quality emerso) · range `^15.5.26` in package.json: le patch future 15.x arrivano con un semplice `npm update`.

### Nota
- Con questo il repo è pronto per il **Passo 2** (Next 16 su branch dedicato, misura obbligatoria del bundle con baseline 103 kB) secondo `PIANO-NEXT-16-TURBOPACK.md`.

---

### Aggiunto
- **ESLint reale, in forma Next 16**: `next lint` è rimosso in 16 e qui non stava girando da nessuna parte (script senza config né dipendenza — il linter non aveva MAI analizzato il codice). Ora: **ESLint 9** + `eslint-config-next@15.5.4` con config flat `eslint.config.mjs` (preset core-web-vitals + typescript, convenzione `_` per i parametri volutamente inutilizzati, fixture del guard overlay escluse), script `"lint": "eslint ."`, lint in **CI** (prima di guard e test) e nel **pre-push hook**. Baseline: 0 errori, 0 warning.
- **Piano di migrazione `PIANO-NEXT-16-TURBOPACK.md`**: quattro passi verificabili (15.5→ultima 15.x → 16 su branch → deploy Turbopack → backlog), con i numeri del trial come baseline (102 vs 198 kB First Load), i rischi mitigati (ordine CSS, precisione decimale, misura obbligatoria del bundle al Passo 2 con paracadute `--webpack`) e le cose deliberate DA NON fare (View Transitions restano API nativa, niente flag sperimentali senza problema misurato).

### Corretto
- **Il debito che il primo lint vero ha portato a galla — 15 errori e 26 warning, tutti saldati**:
  - `useQuickFaq` in `wp-editor.tsx` era una funzione con nome da hook chiamata in un callback (violazione rules-of-hooks che anche un esame attento confondeva): rinominata `applyQuickFaq` — era un falso hook, non un bug di reattare.
  - 5 `<a>` interni convertiti a `<Link>` (consent banner, cookie-policy, «Torna al sito» e «home» in consulenza, riferimento provider in configurazione AI): client navigation e prefetch tornati.
  - 8 apostrofi non escapati (`react/no-unescaped-entities`) e 26 import/variabili/parametri morti rimossi (actions, tickets, digest, shield, ai-tools, palette…), con la signature di `shieldCheck` preservata tramite `_endpoint`.
- **Verifica**: lint 0/0 · typecheck ✓ · 128/128 test ✓ · `build:local` ✓ (First Load invariato a 102 kB) · pre-push hook eseguito a mano: verde.

---

## [Emoji chat configurabili] — 2026-09-27 · il picker segue l'admin

### Aggiunto
- **Emoji del picker della chat editabili da `/admin/settings/emoji-chat`**: stessa architettura delle risposte rapide — layer dati in `tickets.ts` (`getChatEmojis`, chiave `chat_emoji_picker` su `content_settings`, default con DB assente o set vuoto), server action `saveChatEmojis` con la stessa disciplina (JSON riscritto solo se diverso, audit `chat.emoji`, cap 24 voci, validazione in **code point** — `Array.from`, non `.slice`: una emoji composta con modificatore/ZWJ conta 2–4 caratteri UTF-16 e i bottoni del picker sono cerchi da 44px, non testi), editor dedicato `ChatEmojiEditor` (input singoli, cap code point lato client) e scheda con `SubPageHeader` nel gruppo Ticketing dell'hub Impostazioni, con card `HubCard` (conteggio + stato) e destinazione nella command palette ⌘K (`chatEmojisStatus` in `settings-status.ts`, warn sempre false: il default è una scelta, non un'action dovuta — quindi la pill di riepilogo e la riga Panoramica restano coerenti senza toccarle).
- **La chat pubblica legge il set dell'admin**: la pagina `/consulenza` carica le emoji dal layer dati (`.catch` → default, come da convenzione di degradazione) e le passa come prop; il componente ha fallback sul proprio `DEFAULT_EMOJIS` se la prop manca o è vuota — il set predefinito vive in due posti GUARDATI: il test di sentinella `tests/chat-emoji.test.mjs` confronta i due array e fallisce se divergono.

### Verificato
- End-to-end su dev (porta 3200): scheda admin 307 (protetta), picker in chat col set default (20 emoji); simulazione del salvataggio admin (riga `content_settings` nel formato della server action) → ricaricata la chat il picker mostra il set personalizzato NELL'ORDINE scelto (🚀 🎯 🔥); ripristino default (delete della riga) → 20 emoji di nuovo in chat. Typecheck ✓ · **128/128 test** (12 nuovi in `tests/chat-emoji.test.mjs`: regole pure + 7 sentinelle sui file reali, inclusa la sincronizzazione dei due default) · overlay-guard ✓ (187 file).

---

## [CSS per dominio] — 2026-09-27 · globals.css dimezzato, cascata invariata

### Modificato
- **globals.css 1033 → 559 righe — ora solo design system**: motore di temi, mirror dark, tema Glossy, glass/aurora, glow della barra, View Transitions — le parti che tre test e l'overlay-guard leggono direttamente (contrast, toast-layer, overlay-guard: 16/16 verdi). I domini applicativi escono in fogli dedicati, importati dal layout nell'ordine di cascata originale: **`src/app/admin.css`** (101 righe: WpEditor + micro-interazioni ticketing), **`src/app/hero.css`** (212: hero animato, scia del mouse, campi editor), **`src/app/chat.css`** (161: chat stile Telegram — blocco del flusso parallelo portato byte-exact).
- **Cascata dimostrata invariata**: estrazione byte-exact dei blocchi (i quattro pezzi ricompongono l'originale per sha) e stream CSS di pagina a pari dimensione (81.302 byte); l'unico riordino nel bundle — le variant utilities Tailwind (hover:, sm:, ecc.) ora precedono le classi di dominio invece di seguirle — è risultato inerte dalla scansione dell'intero codebase: nessun elemento combina una classe di dominio con una variante sulla stessa proprietà.

---

## [Turbopack + chat Telegram] — 2026-09-27 · dev più veloce, chat più viva

### Aggiunto
- **Turbopack senza stravoglimenti**: `npm run dev:turbo` (stabile in 15.5) accanto a `dev` webpack — zero rischi sul flusso esistente, prova in parallelo quando si vuole. `npm run build:turbo` espone la build beta **solo da riga di comando, senza script npm che invochino flag beta** (convenzione «next.config.puro»: le transizioni restano su View Transitions API nativa). Verificato: Ready in 794ms, `/` e `/consulenza` 200, `/admin` 307 al login, middleware compilato — stesso comportamento del dev webpack.
- **Trial build Turbopack su branch `trial/turbopack-build` (verdetto: NON migrare il deploy)**. Benchmark a freddo e a caldo su dist dir isolate (`.next-bench-*`, rimossa dopo; `.next` del dev mai toccata — verificato per mtime e contenuti): tempi **webpack 19,7s → 16s caldo, turbopack 13,6s → 13s caldo** (M4 Pro, 12 core): guadagno ~19% a regime, coerente con le «differenze note» Vercel sui progetti piccoli (cache persistente webpack già matura). Il vero scoglio è il bundle: **First Load JS condiviso 102 kB (webpack) vs 198 kB (turbopack, di cui 182 kB JS)** — quasi doppio, esattamente la differenza documentata «webpack produces more optimized bundles»; a 102 kB la home paga già il suo peso, raddoppiarlo non è accettabile. Output FUNZIONANTE e identico: 65 route app con lo stesso split statico/dinamico (manifest confrontati), CSS unico con tutte le classi del design system (chat, aurora, glass, hero) e i 29 override dark, `@property`/View Transitions/reduced-motion integri, smoke test con `next start` 200 su home/consulenza/privacy/sitemap/health, header di sicurezza intatti, confronto visivo dei valori calcolati identico (gradient animato, avatar, raggi). Note operative verificate: `distDir` via `WAC_DIST_DIR` È rispettato dalla build Turbopack (contrariamente a quanto ipotizzato in prima battuta — la separazione dev/prod resta valida); Turbopack non fa type checking in build (qui indifferente: CI gira `tsc --noEmit`); niente cache persistente Turbopack in 15.5 (arriverà con le 16.x); l'ordine CSS può differire (qui CSS globale unico: nessun impatto). **Raccomandazione: restare su webpack per il deploy, rivalutare con Next 16 (Turbopack default + cache persistente + gap bundle chiuso); `dev:turbo` resta disponibile per l'iterazione quotidiana.**
- **Chat stile Telegram**: righe con avatar circolari da 32px (agente: foto del team se c'è, altrimenti iniziale su `--brand-100`; Ambrosio: badge viola con scintilla; visitatore: iniziale — «O» di Ospite finché non dice il nome — su gradiente azzurro) e bolla visitatore con **gradient brand animato** (`chat-gradient-flow`: solo `background-position`, GPU-friendly, spenta sotto `prefers-reduced-motion`). Le bolle non usano backdrop-filter (righe animate in transform da framer-motion: artefatti Chromium, stessa lezione di `.glass-solid`) e i colori passano dai token CSS: tema e dark mode seguono da soli. Orario dentro la bolla, split sinistra/destra come il client Telegram.
- **Emoji picker nel composer**: 20 emoticon ad alto impatto (faccia, mano, affari) in pillola glass, target touch 44px (WCAG 2.5.5), chiusura con Esc o clic fuori (toggle escluso), inserimento nel composer da cui è stato aperto (script o Ambrosio) con focus restituito all'input. Zero dipendenze nuove: `Smile` di lucide già presente.

### Verificato
- Browser su dev server esistente (porta 3200): splash → saluto, picker aperto da bottone, emoji inserita, bolla visitatore con gradient animato (`chat-gradient-flow` attivo, `background-size: 220%`), avatar «O», script avanzato alla domanda successiva; dark mode forzata via `data-mode`: bolla agente su superficie scura con testo chiaro, gradient visitatore invariato. Typecheck ✓ · 116/116 test ✓ · overlay-guard ✓ (185 file).

---

## [Playtest hero animato] — 2026-09-27 · due difetti trovati sul vivo

### Corretto
- **La scia del mouse non è mai esistita a runtime** (`HeroCursorGlow`): il componente renderizza `null` finché `ready` è false, ma l'unico `useEffect` usciva subito (ref nulli: il portale non era ancora montato) senza mai raggiungere `setReady(true)` — deadlock silenzioso, scia morta all'arrivo. Fix: due effetti in cascata (ammissioni → portale → cablaggio, dipendenza `[ready]`). Verificato dal vivo: punto che insegue con lerp veloce (605→610) e scia larga in inerzia (433), portali presenti, `data-hero-cursor="on"` solo mentre l'hero è a schermo.
- **Modifiche batched nell'editor si sovrascrivevano** (`HeroEditor.update`): il nuovo stato partiva da `cfg` in closure, quindi tre modifiche nello stesso tick (o batched da React) lasciavano sul DB solo l'ultima. Fix: `setCfg(prev => …)` funzionale con anteprima accodata via `queueMicrotask`. Stesso scenario rifatto dopo il fix: tutte e tre le modifiche (template, font, accento) sopravvivono al salvataggio.

### Verificato
- Playtest completo dei 4 template sulla home reale (login admin): Gradient flow (pan 9s, Playfair caricata, accento `#c2410c` propagato nella CSS var, riflesso breathe), Spotlight (sheen su `h1::after`, 2.8s, blend overlay), Caret (placeholder auto-scritto carattere per carattere, sequenza catturata), Lens (anello `--lens-angle` in rotazione: 12° → 48,9° in 700ms); hero spento = home identica a prima, nessun portale residuo. Typecheck ✓ · 116/116 test ✓.

---

## [Hero animato con test A/B] — 2026-09-27 · la home si può provare senza cambiarla

### Aggiunto
- **Hero animato «serissimo stile Apple»**: 4 template (Spotlight, Caret, Lens, Gradient flow) che sostituiscono l'apertura statica della home quando attivi da `/admin/tools/hero` — testi, font (Inter/Manrope/Playfair oltre a Geist), colore accento e direzione della sfumatura modificabili con anteprima live. **Default spento**: la home resta com'è finché un admin non la attiva. Solo transform/opacity, niente backdrop-filter nuovo (lezione overlay-guard), tutto spento sotto `prefers-reduced-motion`; la scia del mouse vive in `HeroCursorGlow` su portale body e solo mentre l'hero è a schermo.
- **Test A/B (GA4)**: con il test acceso la home è divisa 50/50 con bucketing deterministico su cookie first-party (`wac_ab`, FNV-1a) — nessun flicker, stessa variante a ogni refresh. Misurazione a doppia faccia: impression `hero_animated_view` (server, per varianti pari) e dimensione `hero_variant` su ogni `search_start` (dalla barra statica E da quella animata), così il report GA4 confronta le ricerche per variante senza esport.
- **Architettura**: regole pure in `hero-shared.ts` / `ab-shared.ts` (importabili da client, server e test — 15 sentinelle), persistenza in `hero.ts`, pannello `/admin/tools/hero` con hub Tools e overview allineati. Migration 029 (`ai_provider_log`) commessa: era già in uso alla tabella «Ultime risposte della catena» del pannello provider ma non era nel repo.
- **`scripts/set-ai-key.mjs`**: imposta una chiave provider di Ambrosio da CLI (cifrata AES-256-GCM come l'app, verifica facoltativa contro il provider) — utile quando l'UI non c'è ancora o la chiave è delicata da incollare a mano.

### Versione
- 0.2.0 → 0.2.1 (primo commit del flusso hero A/B dopo il tag v0.2.0).

---

## [Sessioni admin revocabili] — 2026-09-27 · il cookie non è più immortale

### Corretto
- **Sessione valida anche dopo cancellazione utente o cambio password**: il cookie firmato era verificato solo per firma HMAC e scadenza (stateless), quindi restava valido fino a 12 ore anche se l'account non esisteva più — visto sul vivo durante il playtest (sessione attiva con admin di test già cancellato).

### Aggiunto
- **Impronta della password nel payload firmato** (`src/lib/admin.ts`): al login viaggia l'HMAC (a 16 caratteri, segreto di sessione) della `password_hash`; `getAdminUser` la riverifica sul DB a ogni richiesta. Password cambiata, utente cancellato o cookie pre-fix senza impronta → sessione subito rifiutata. **Fail-closed**: DB irraggiungibile = nessuna sessione accettata. Verificato dal vivo: cambio password via SQL → redirect al login; utente cancellato → idem. Costo: una query indicizzata per richiesta admin (PK su email).
- **/admin/sicurezza** (gruppo Sistema, in palette ⌘K): cambio password self-service (verifica dell'attuale, minimo 8 caratteri, audit `admin.password-cambiata`, sessione corrente rinnovata con l'impronta nuova — l'admin non si sloga da solo, le altre sessioni muoiono) e **lista delle sessioni attive** costruita dal log di audit (`admin.login` con impronta nel dettaglio): ogni riga mostra login, scadenza e se il cookie di quel login funzionerebbe ancora. Il pulsante «Rinnova solo questa sessione» rinnova il cookie corrente (dopo un sospetto è il minimo; la revoca vera resta il cambio password). Verificato dal vivo nel browser: due cambi password consecutivi con relogin trasparente, lista corretta prima e dopo («revocata dal cambio password»), rinnovo ok.

---

## [Catena provider Ambrosio] — 2026-09-27 · niente più 401 perpetui

### Corretto
- **Chiave legacy invalida rimossa dal DB di dev**: il form storico di Configurazione scrive in `ai_settings.api_key_enc`, che **sovrascrive la chiave del primario** nella catena di fallback — con una chiave Anthropic scaduta ogni richiesta partiva con un 401 prima di cadere su `custom` (rumore + latenza a ogni giro). Ora il DB di dev contiene solo la chiave valida del provider custom: verificato dal vivo — zero 401 nel log, `used_provider: custom`, `fallbacks_tried: []`.

### Aggiunto
- **`clearLegacyKey`** (`src/lib/ai.ts`): azzera `api_key_enc`; **`getLegacyKeyStatus`** espone solo esistenza e provider di appartenenza, mai la chiave. Azione admin `clearLegacyKeyAction` con audit `ai.chiave-legacy-rimossa`.
- **/admin/ai/provider**: avviso «Chiave legacy attiva» con pulsante di rimozione quando esiste una chiave legacy che non appartiene al primario, e guida «Come provare il fallback» (imposta secondario volutamente sbagliato → verifica in `/admin/ai/test` che il primario risponda e che `fallbacks_tried` registri il salto; poi ripristinare).
- **Tabella «Ultime risposte della catena»** nella stessa pagina: gli ultimi 15 tentativi del log 029 con quando, provider, esito (primario ok / dopo fallback), fallback provati, latenza e modello — un 401 ricorrente sul primario si vede come riga «dopo fallback» senza aprire il log. Verificata dal vivo con le righe storiche del 401 e quelle pulite dopo la rimozione.
- **Salva-guardia nel form di Configurazione**: se il salvataggio riusa lo slot legacy di un **altro** provider (la chiave che sovrascrive la card del primario), l'admin ora lo sa subito — audit `ai.chiave-legacy-riusata`, redirect con banner in pagina che spiega il riuso e rimanda alla tabella della catena, più avviso statico quando una legacy esiste già. Stessa passata ha corretto il difetto gemello osservato sul vivo: il sync della chiave sulla card azzerava **modello e Base URL** della card (per custom: qwen2.5:7b e l'URL di Ollama spariti a ogni salva). Entrambi i percorsi verificati dal vivo nel browser (banner + audit + card intatta; caso neutro senza banner).

---

## [Playtest Autonomia] — 2026-09-27 · i difetti che i test statici non vedevano

### Corretto (tutto osservato sul vivo, browser + thread reali)
- **Migration 028 no-op su DB esistenti**: le colonne di autonomia su `ai_settings` erano solo nel `create table if not exists` (no-op su DB già presenti) — la verifica dal vivo ha trovato `ai_settings` senza `autonomy_level` pur col runner che segnava la migration come applicata. Ora ogni colonna ha il suo `alter table add column if not exists` e il guard-connessione ripete gli ALTER.
- **Captcha mancante ≠ violazione Shield**: i 403 Turnstile di `/api/chat/init` (token non ancora pronto, script lazy) salivano nel contatore `bad_payload` e dopo 3 violazioni l'IP del visitatore vero restava bannato 24h. Stesso trattamento su `/api/lead`. Il rate limit resta la difesa.
- **Sessioni fantasma**: con init fallito il client apriva comunque Ambrosio, le cui risposte finivano in una chat che il team non vedrebbe mai (zero ticket, zero lead). Ora la route AI rifiuta `no_conversation` e il client non offre l'AI senza conversazione persistita.
- **Blocchi `<tool>` grezzi al cliente**: risposta tutta-azione o con tag di chiusura assente passava il JSON al visitatore. Il parser ora gestisce blocchi multipli (fino a 8), oggetti bilanciati (`extractJsonObjects`), e se il messaggio è solo-azione al cliente va una conferma onesta, mai il JSON.
- **Tool prima del lead**: `fissa_callback` arrivava PRIMA dell'estrazione del lead e veniva negata («nessun lead con consenso») — l'ordine in route è ora estrazione lead → esecuzione tool.
- **Handoff del tetto mosse bloccato dal proprio gate**: `setToolLevel` era DOPO il gate mosse, quindi l'handoff forzato partiva col livello default L1 e veniva bloccato (audit vuoto, thread mai passato al team). Ora il livello è impostato prima del gate: `ambrosio.handoff — tetto mosse raggiunto (5/4)` in audit, status `operator`, nota per il team.
- **Consenso «sparso» non riconosciuto**: «sono d'accordo, richiamatemi» a metà frase dava `null` e il lead promesso non veniva salvato. Estrattore esteso (richiamatemi/richiamarmi/fissatemi…, con guardia anti «non chiamatemi») e nome ripulito dal prefisso «Sono».
- **Proposta scritta solo in chat**: a L3 il modello piccolo scrive il preventivo come testo senza chiamare `prepara_proposta` — per il team non esisteva nessuna bozza. Ora: prompt take-over rinforzato (registrazione obbligatoria) + rete di sicurezza in route (bozza automatica con voci estratte, dedup per conversazione, sempre `draft`).

### Verificato dal vivo
- **L1** (browser, team fuori turno): qualifica in domande, zero tool, lead `source=ai` con consenso. **L2**: alla 5ª mossa Ambrosio si ferma, handoff in audit, thread `operator` con nota di consegna. **L3**: SLA violata → tick cron via curl (`aiTakeover: 3`) → annuncio trasparente nel thread → proposta con preventivo in BOZZA visibile in `/admin/ai/proposte` (revisione team). Typecheck ✓, 111/111 test.

---

### Aggiunto
- **3 livelli di gestione attivabili** (scheda `/admin/ai/autonomia`, migration 028): **L1 Contatto** (solo qualifica in 4 domande + richiamata, NESSUN tool), **L2 Qualifica** (risponde in automatico con tetto mosse 2–10, default 4, poi handoff automatico al team), **L3 Proposta** (eredita L2 e aggiunge il take-over SLA). Ogni livello lascia spazio all'essere umano per costruzione: L1 finisce nella richiamata, L2 nel tetto mosse, L3 nella revisione della proposta.
- **Gate dei tool per livello**: la whitelist vive nel layer puro `ambrosio-autonomy.ts` (`accessList`, chiusura per inclusione) ed è applicata in `runToolCall` — un tool fuori dal livello attivo non viene eseguito MAI, anche se il modello lo chiama; la risposta testuale resta valida (stessa fallibilità silenziosa delle altre azioni).
- **Tetto mosse L2 nella route chat**: prima del provider si contano le risposte bot della conversazione; al tetto Ambrosio non risponde più, fa handoff (claim su status, senza doppi) e lascia nel thread il messaggio di consegna a una persona vera.
- **Sezione Documenti** (`/admin/ai/documenti`): la biblioteca che istruisce Ambrosio (titolo, categoria operativo/commerciale/tecnico/procedura, lingua it-en-de-fr-es, priorità, tetto 8000 char, sanitizzata). Nel prompt accanto a FAQ e pacchetti, max 10 attivi, lingua del cliente con fallback it; solo a L3 può citarne la fonte («come da nostro protocollo…»), a L1/L2 restano interne.
- **Tool `prepara_proposta`** (solo L3): titolo + testo + item «Voce|prezzo» (max 8); la proposta nasce SEMPRE in stato `draft` su `ai_proposals` — mai inviata da sola. Scheda `/admin/ai/proposte` con flusso di revisione Bozza → Approvata → Inviata → Accettata/Persa, tutto in audit.
- **Take-over SLA (cron step 11, solo L3 con switch attivo)**: superata la finestra «prossima risposta», Ambrosio subentra sui ticket mai presi in carico (dedup `ai_takeover_at`, claim-then-announce: l'annuncio fallito rilascia il claim, mai un take-over a metà). Annuncio trasparente nel thread («sono Ambrosio, prendo io la mano») + nota interna col contesto; la raccolta dati e la proposta avvengono nella chat normale col gate L3 attivo.
- **Ambrosio tra gli operatori** (`/admin/operators`): card con livello attivo, badge take-over e lista accessi espandibile — lo STESSO catalogo `accessList()` della scheda Autonomia (7 accessi descritti, check/spento): un solo posto decide cosa può fare, hub e pagina operatori non possono divergere.
- **Hub AI esteso**: tre nuove schede (Autonomia, Documenti, Proposte) con stati dal layer dati (`autonomyStatus` = sempre scelta deliberata, mai ambra; `documentsStatus` ambra con zero documenti; `proposalsStatus` ambra con bozze da revisionare) — la pill di riepilogo dell'hub le conta già.
- **Command palette**: «Autonomia AI», «Documenti AI», «Proposte AI» con keywords («livelli», «biblioteca», «preventivi»…).

### Verificato
- Migration 028 applicata col runner (✚ APPLICATA); typecheck ✓; **111/111** test (11 nuovi in `tests/ambrosio-autonomy.test.mjs`: accessi per livello, tetto mosse, take-over gated, sanitizzazione documenti, parser proposta, coerenza statica gate/route/cron/migration); guard overlay ✓ (183 file).

---

## [Target Notion] — 2026-09-26 · il workspace pronto a ricevere

### Aggiunto
- **Database unificato «Web Agency — Lead & Clienti» nel workspace** (hub `01 · Clienti & Prospect`): schema = mapping lead (Nome, Telefono, Servizio, Urgenza, Budget, Stato, Sorgente, Ricerca iniziale, Pagina origine, Note, Creato) + colonne client (Email, Azienda, Ticket, Canali, Ultimo contatto). Scelta operativa a database UNICO: un database Notion ha una sola proprietà title, quindi il mapping client condivide «Nome» coi lead e «Telefono» è rich_text (commit `1e1aaa7`, con sentinelle sui tipi — un mismatch uscirebbe solo alla consegna come 400 di Notion). Database ID salvato in `notion_settings`.

### Nota
- La consegna reale resta in attesa del secret dell'integrazione (`ntn_…`), che si salva dalla scheda Admin → Notion e resta cifrato AES-256-GCM nel DB: col token, «Prova connessione» → «Sincronizza ora» consegnano lead e client nel database unificato (le 4 schede sono in coda col presidio anti-doppioni `notion_synced_at`).

---

## [KPI in Panoramica] — 2026-09-26 · il valore del portafoglio anche nel mattinario

### Aggiunto
- **KPI «Portafoglio clienti» nella Panoramica admin**: il valore commerciale del portafoglio arriva anche nella dashboard mattutina, come quinto KPI della griglia (tinta smeraldo, sub «budget dichiarato») — chi apre l'admin vede subito quanto vale il portafoglio prima di aprire la sezione Clienti. Legge lo STESSO layer della lista (`sumPortfolioBudget`, estrazione testata condivisa: una sola fonte di verità); senza DB «—», mai uno zero finto. Cifra text-2xl (pattern della lista) per stare in riga nella colonna più stretta.

### Verificato
- Browser sui dati reali: «~5000 €» = somma delle card della lista Clienti; screenshot con griglia a 5 bilanciata e cifra su una riga dopo l'aggiustamento. **81/81**, typecheck ✓.

---

## [KPI valore portafoglio] — 2026-09-26 · quanto vale il portafoglio, a colpo d'occhio

### Aggiunto
- **KPI «Budget dichiarato» nella lista Clienti**: la somma dei «~N € dichiarati» di tutte le schede come quinto KPI (griglia a 5, tinta smeraldo, cifra text-2xl per la stringa lunga) — la lettura commerciale del portafoglio accanto ai numeri d'identità. `sumPortfolioBudget` riusa l'estrazione testata `withBudgetTotal` (nessuna regola duplicata); senza DB o tabella non migrata torna `null` e la pagina mostra «—»: mai uno zero che sembrerebbe dato.

### Verificato
- Browser sui dati reali: KPI «~5000 €» = somma esatta delle card (3000+1000+1000); screenshot con la griglia a 5 bilanciata. Test di sentinella (riuso dell'estrazione, null in degradazione, formattazione in pagina) — **81/81**, typecheck ✓.

---

## [Notion × Clienti] — 2026-09-26 · il database si allinea all'intenzione del motore

### Corretto
- **Il vincolo `notion_sync_queue_entity_check` non scarta più i clienti**: la coda Notion nata con la 022 conosceva solo lead/ticket/callback, ma il sync del portafoglio incoda con `entity='client'` (il ramo di mapping esisteva già nel motore) — ogni enqueue finiva scartato e il log registrava `[notion-queue] enqueue fallito`. La migration 027 ricrea il vincolo in transazione con le quattro entità (additiva e idempotente, come le altre) e aggiunge `clients.notion_synced_at`.
- **Idempotenza anti-doppioni del portafoglio**: il drain crea pagine nuove (non fa update), quindi la consegna ora marca il client come già accade per i lead (`notion_synced_at`, schema 007) e l'azione incoda SOLO le schede mai consegnate — senza filtro ogni giro di sync ri-accodava tutte le schede e il workspace si riempiva di copie.

### Verificato
- DB reale: 027 applicata col runner (`✚ APPLICATA`), vincolo a quattro entità e colonna presenti; sync dal browser → 4 client accodati e **zero** «enqueue fallito» nel log (prima: scartati a ogni giro); seconda corsa → coda invariata (unique + filtro, niente copie). In dev senza token il drain degrada come previsto («Notion non configurato», retry visibile nel sync log). 5 test nuovi sulla catena (motore, migration, marcatura drain, filtro enqueue, lettura) — **80/80**, typecheck ✓.

---

## [Budget in lista] — 2026-09-26 · la lettura commerciale del portafoglio

### Aggiunto
- **Colonna «Budget dichiarato» nella lista Clienti**: il valore derivato (`withBudgetTotal`) esce dalla riga contatti e diventa un blocco proprio della card, allineato a destra con cifre tabulari — le card si confrontano a colpo d'occhio. Chi non ha dichiarato un budget non mostra la colonna: lo zero non è un dato.
- **Chip «Budget: più alto prima»** (`?ordina=budget`): ordinamento decrescente per budget dichiarato, chi non l'ha dichiarato segue in coda senza saltare né riordinarsi a ogni sync (comparatore `byBudgetDesc` nel layer condiviso, ordinamento lato dato dopo la lettura — niente SQL nuovo). Stato accessibile con `aria-pressed`.

### Verificato
- Browser su dati reali + fixture (cliente senza budget): ordine Giulia:3000 → Marco:1000 → Bianchi:1000 (stabile sui pari) → null in coda; colonna visibile solo dove il budget esiste; screenshot con chip attivo. 3 test nuovi (comparatore, gate `sort === "budget"`, sentinelle su pagina) — **75/75**, typecheck ✓.

---

## [Coerenza scheda-lead] — 2026-09-26 · l'identità del cliente è una regola, non una copia

### Aggiunto
- **Layer puro `src/lib/clients-shared.ts`** (zero import, il taglio del repo per i layer testabili): le regole che derivano l'identità della scheda cliente dal lead collegato — telefono E.164 (`toE164Pure`, la stessa normalizzazione che fa da chiave di dedup), priorità `wa_phone` > `lead.phone` (`identityPhonePure`), somma euristica del budget (`withBudgetTotal`), priorità del nome (lead > header email > locale dell'indirizzo, `resolveClientNamePure`) — vivono in un modulo importabile dai test di node senza loader. `clients.ts` le usa invece di copie locali: nessuna costante duplicata, le decisioni sono verificate dove vivono davvero.
- **Test di coerenza `tests/client-lead-coherence.test.mjs`** (14 test): importa direttamente il layer puro e verifica le regole d'identità — E.164 dei formati con cui il lead arriva (web/WhatsApp/import) e null se non normalizzabile (meglio nessun dedup che uno sbagliato), budget cumulativo come tetto di ogni voce, nome lead sempre vincente sulla @ dell'email, e sentinelle statiche su `clients.ts` (importa le regole condivise; l'update «completa ma non distrugge» con coalesce; il dedup cerca prima il telefono poi l'email).

### Corretto
- **`withBudgetTotal` non confonde più un anno con un budget**: «dal 2024» veniva contato come 2024 € (il regex prendeva il numero nudo). Ora una cifra nella forma di anno (19xx/20xx, senza separatore di migliaia) è scartata; le run di cifre sono prese INTERE, così un telefono «5000001» non viene più troncato a 6 digit e trasformato in un budget da 500.000 €. Contesto reale in chat («budget 2024: 3000 euro») continua a valere 3000.

### Verificato
- Typecheck ✓ · 72/72 test ✓ · guard overlay ✓ (169 file).

---

## [DB migrate all] — 2026-09-26 · il DB di dev si allinea con un solo comando

### Aggiunto
- **WhatsApp contestuale ai ticket nella scheda cliente**: ogni ticket WhatsApp del cliente porta il SUO link `wa.me` con testo precompilato che cita il ticket («Buongiorno, la scrivo per il ticket #N…») — il contesto esiste già dal primo «ciao», il cliente non deve spiegare chi è. Il numero del ticket arriva dalla query del dettaglio (`leads.wa_phone` via left join); la card del ticket diventa un contenitore con due azioni (apri il ticket / WhatsApp del ticket) invece di un link unico, e il WhatsApp generico resta nell'header per il contesto scheda. Verificato nel browser con fixture reale: sync → 2 ticket riconciliati → link presente con aria-label «WhatsApp per il ticket #N» e testo corretto.
- **Canale email del portafoglio verificato nel browser** (il pulsante era già previsto dal codice): fixture con ticket `channel='email'` + `contact_email` → sync di Ambrosio crea la scheda (KPI «Con email» 0→1) con `mailto:` su lista e dettaglio. Chiude il punto aperto del report di riepilogo.
- **Report di riepilogo `REPORT-CICLO-CONTAINING-BLOCK.md`**: la mappa del giorno — il ciclo containing block su quattro livelli di presidio (fix `8e5c7ba`, audit `0dea258`, guard in build `18a8c81`, push/CI `fe158a9`, invariante toast `0837d79`) e l'attivazione del portafoglio Clienti (migration 025 applicata, sync Ambrosio provata nel browser con 4 clienti riconciliati, scheda dettaglio verificata end-to-end con nota persistita). Con lo strumentario lasciato al repo e i punti aperti (remote GitHub assente, canali email da verifica browser, identità git).
- **Tracciamento `schema_migrations`** (migration 026 + runner aggiornato): il report smette di DEDURRE lo stato dall'«already exists» di Postgres e diventa ESATTO — una riga per file con checksum sha256. Chi ha la riga NON viene rieseguito (✓ TRACCIATA, la seconda corsa è in ~1s); checksum diverso = ⚠ DRIFT (file modificato dopo l'applicazione: warning, non errore); al primo giro su DB vecchi la tabella nasce additiva e i file già applicati vengono backfillati (· GIÀ APPLICATA con riga). 6 test nuovi sulle decisioni di tracciamento (gate prima dell'esecuzione, insert nel ramo di successo e di backfill, drift non-fatale, struttura coerente tra 026 e runner).
- **`npm run db:migrate`** (`scripts/db-migrate-all.mjs`): applica in ordine tutte le migration di `neon/migrations/` con report chiaro — ogni file classificato come ✚ APPLICATA, · GIÀ APPLICATA (l'«already exists» di Postgres su schema idempotente, con nota esplicita per i CREATE RULE senza IF NOT EXISTS di 010 e 024) o ✖ ERRORE. Gli errori veri non interrompono la corsa ma fanno uscire 1 (così una CI li nota); il report suggerisce di rilanciare dopo il fix. `--dry-run` mostra l'elenco e il numero di statement senza toccare nulla. Il DB di dev resta allineato anche quando una migration arriva a repo già clonato — l'allineamento del 26/09 (025-clients mancante) da ora è `npm run db:migrate`.
- **8 test sul runner** (`tests/db-migrate-all.test.mjs`): ordine lessicografico della convenzione numerica NNN-, classificazione degli esiti (un «già applicata» non è un fallimento, un errore vero sì con exit 1), gate del dry-run prima di ogni query, caricamento di `.env.local` solo se `DATABASE_URL` non è nell'ambiente, wiring dello script npm. Il runner esegue all'import: le decisioni sono verificate leggendo il sorgente, come il test di contrasto.

### Verificato
- **Dry-run e corsa reale sul DB di dev**: 26 migration in ordine, 24 applicate, 010 e 024 riconosciute come già applicate con la nota giusta, 0 errori, exit 0; dry-run senza side-effect. Suite completa 52/52 e typecheck puliti.

---

## [Guard overlay fixed] — 2026-09-26 · la build fallisce se il bug containing block torna

### Aggiunto
- **Invariante del layer toast reso eseguibile** (`tests/toast-layer.test.mjs`, 7 test): l'invariante scoperto nella verifica browser dei toast — il layer è viewport-anchored su ogni rotta admin perché il suo unico antenato è `main.aurora`, solo gradient — è ora verificato a ogni `npm test`: layout che monta AdminToaster prima di nav e contenuti, classi viewport-anchored del layer (`fixed inset-x-0 top-4 z-[100] pointer-events-none`), pillola glass figlia e mai antenato, `main.aurora` e `.aurora` in globals.css senza proprietà a rischio, nessun layout di rotta che bypassi il layout admin. Validato per mutazione: invertire Toaster e Nav nel layout fa fallire il test.
- **Pre-push hook versionato `githooks/pre-push`** + **workflow CI `.github/workflows/overlay-guard.yml`**: il guard non vive solo nella build locale — la stessa sentinella gira prima che il push parta (hook attivato automaticamente da `postinstall` via `core.hooksPath`, saltabile in emergenza con `--no-verify`) e server-side a ogni push/PR verso main (insieme a typecheck e test, il guard SEMPRE per primo). Il repo oggi non ha remote: hook versionato e workflow sono pronti per quando verrà pubblicato.
- **Guard automatico `scripts/overlay-guard.mjs`**: analisi statica con il compilatore TypeScript già in repo — mappa le superfici a rischio (classi CSS con `backdrop-filter`/`filter`/`will-change` in `globals.css` + utility Tailwind `backdrop-blur*` e affini), ricostruisce il grafo dei componenti renderizzati (anche attraverso import interni e children passati come props) e fallisce con exit 1 se da una superficie è raggiungibile un elemento `fixed` senza passare da `createPortal`. Il report indica file:riga, l'elemento incriminato, il percorso root → superficie e il rimando al fix di riferimento (palette ⌘K, commit `8e5c7ba`).
- **5 test sul presidio del perimetro** (`tests/pre-push-guard.test.mjs`): hook eseguibile che chiama il guard, esito 0 sul repo pulito, attivazione via `postinstall`, `core.hooksPath` attivo in checkout, workflow CI con il guard prima di typecheck e test.
- **6 test su fixture dedicate** (`tests/overlay-guard.test.mjs` + `tests/fixtures/overlay-guard/`): bug attraverso import denominato e default, bug da literal dentro `cn()`, esenzione del portale, `fixed` legale fuori dal vetro, e il codice reale del repo che deve passare. Le fixture sono escluse dal typecheck (`tsconfig.json`) per non inquinare `tsc` con JSX di prova.

### Verificato
- **Baseline reale**: guard verde su 168 file (2 classi CSS a rischio, 3 percorsi già protetti da portale); canary temporanea con bug iniettato → exit 1 con report corretto, poi rimossa; suite completa 32/32 e typecheck puliti. Verifica browser dedicata dei toast (gli overlay più esposti alle superfici glass) su tutte le rotte admin: layer viewport-anchored ovunque, nessun caso reale da correggere.
- **Pre-push end-to-end**: remote bare temporaneo + canary con violazione → il hook blocca il push con il report della violazione; canary rimossa → il push passa con il guard verde. Suite completa 37/37 (32 + 5 nuove) e typecheck puliti.

### Limiti (dichiarati nell'intestazione dello script)
- className dinamiche (template literal, `cn(…)` con variabili) non sono valutabili e l'elemento è trattato come non a rischio; JSX costruito via variabili non risolte non viene seguito; l'aliasing di `createPortal` è riconosciuto solo da import interni. Limiti accettati per un guard di build: coprono il caso reale accaduto, non ogni eventualità.

---

## [Audit overlay fixed] — 2026-09-26 · zero altri casi, rischio documentato alla fonte

### Aggiunto
- **Sentinella nel design system**: il blocco Liquid Glass di `globals.css` apre con la regola per spec CSS — ogni elemento con `backdrop-filter` (come `.glass`, `.glass-strong`) è containing block dei discendenti `position:fixed`; anche `filter` e `transform` lo creano. Chi aggiunge un overlay parte da lì: portale su `document.body`, o verifica della catena degli antenati. La memoria del bug palette non vive più solo nel CHANGELOG, ma nel punto del codice dove nasce il rischio.

### Verificato
- **Audit dei 5 overlay `fixed` dell'app** (palette ⌘K, AdminToaster, CookieBanner, StickyCall, AuroraLayers): solo la palette era montata dentro una superficie glass; gli altri quattro hanno catene di antenati pulite (`.aurora` sul body/main è solo gradient, PublicOnly e ConsentProvider sono fragment) e nessun fix necessario. Nessun `position:fixed` nascosto nei CSS né inline (il posizionamento off-screen di Turnstile è `absolute`).

---

## [Fix palette ⌘K] — 2026-09-26 · l'overlay copre di nuovo tutto il viewport

### Corretto
- **La command palette non copriva più la pagina**: l'overlay «fixed inset-0» si dimensionava sulla sola nav invece che sul viewport — la pagina sotto restava brillante e cliccabile dietro la modale. Causa per spec CSS: la palette è montata nella nav, dentro `.glass-strong` che ha `backdrop-filter`; un antenato con backdrop-filter (o filter/transform) diventa CONTAINING BLOCK dei figli `position: fixed`. Non era una regressione dei valori, era il containing block.

### Modificato
- **`createPortal` su `document.body`** (pattern canonico React): il dialogo viene montato fuori da ogni antenato «contaminante» e `fixed` vale di nuovo il viewport. Verificato nel DOM (parent = BODY, rect = viewport esatto) e a video (desktop: overlay pieno, pagina attenuata e non cliccabile).

### Nota
- La skill di riferimento interrogata per il pattern modale non aveva un match specifico sul caso: la diagnosi viene dalla spec CSS (containing block per backdrop-filter) e dalla verifica nel browser.

---

## [Digest mattutino] — 2026-09-26 · l'agenda arriva in email, una volta al giorno

### Aggiunto
- **Digest mattutino agli admin** (`src/lib/digest.ts` + formato puro `digest-format.ts`): una email nella finestra 6–9 di Roma con l'«Agenda di oggi» — sezione Operativo (SLA, promesse, con il rosso che guida l'oggetto: «1 scadenza violata — agire adesso») e sezione Configurazione (le schede ambra dei tre hub, chiamate per nome con `destinationLabel`).
- **Veicolo: il cron tick esistente** (passo 10, best-effort come gli altri): tick ogni 15 minuti → `isMorningDigestTime` decide la finestra, dedup giornaliero su `content_settings` (`morning_digest_sent` = {date}) fa sì che la prima chiamata utile vinca. Flag scritto SOLO dopo almeno un invio riuscito: un SMTP giù riprova al tick successivo, sempre in finestra.
- **Destinatari: `admin_users`** — l'identità di login è anche la lista digest; nessun campo da configurare. Invio via SMTP dell'agenzia (`sendEmailViaTools`), esito in audit (`digest.inviato` / `digest.errore`, etichettati in italiano).
- **Silenzio onesto**: nessun pendio → NESSUNA email (il flag viene comunque impostato): il digest è un aggiornamento, non una sirena — il team non deve filtrare messaggi inutili.

### Nota
- Zero regole duplicate: il formato (oggetto, righe, finestra) è puro e testato (3 nuovi test, 25/25); le sezioni nascono dalle STESSE fonti della Panoramica (`overview-status`, `slaAgendaStatus`, `recallsAgendaStatus`). Un hub nuovo che entra nel registro appare nel digest da solo.

---

## [Agenda di oggi] — 2026-09-26 · un solo posto per ciò che aspetta

### Modificato
- **La card «Stato della configurazione» diventa «Agenda di oggi» con DUE piani**: *Operativo* (SLA dei ticket, promesse da richiamare — si agisce oggi) e *Configurazione* (schede incomplete — si completa quando si può). Stesse funzioni pure degli hub per entrambi i piani: `slaAgendaStatus` e `recallsAgendaStatus` entrano in `settings-status.ts` (testate, input negativi normalizzati).
- **Il blocco ambra «Da richiamare» è assorbito**: la pill ora conta TUTTE le promesse in finestra (prima l'elenco era limitato a 5 e il titolo mostrava quello), la qualifica «N in ritardo su M» eredita la regola della dashboard, e l'elenco nominativo (chi/telefono/quando) resta dentro la card come dettaglio della riga.

### Aggiunto
- **Quarto tono in `HubStatus`: `danger` (rosso)** — riservato alle SCADENZE VIOLATE (ticket in ritardo SLA, promessa scaduta): semanticamente diverso dall'ambra («incompleto, agisci quando puoi»); nessun hub di configurazione lo usa, è un linguaggio dell'agenda.
- Regola esplicitata nei test: il verde «Giornata libera» dell'agenda NON dice «nessun problema», dice «nessun pendio operativo» — la configurazione parla nella sezione sotto.

### Nota
- KPI e agenda leggono la STESSA cifra SLA dalla stessa query: il «38 in ritardo» della card ticket e la pill «38 ticket in ritardo» non possono divergere.

---

## [Riepilogo in Panoramica] — 2026-09-26 · le azioni in attesa, dove la giornata inizia

### Aggiunto
- **Card «Stato della configurazione» in Panoramica**: una riga per hub (Impostazioni, Tools, Ambrosio) con la stessa pill di riepilogo dell'hub e i salti diretti alle schede incomplete, **chiamate per nome** («Notion», «Posta elettronica»…) — il nome viene da `destinationLabel()`, lo stesso catalogo della command palette: un solo posto dice come si chiama ogni scheda.
- Non duplica la regola: legge gli STESSI layer dati (`settings-status-server`, `tools-status-server`, `ambrosio-status-server` + registro integrazioni) e le STESSI funzioni pure (`hubSummary`/`pendingOf`).
- **`overview-status.ts`**: reader server-only che compone le tre righe; le integrazioni entrano nella riga del hub che le espone (Impostazioni per tutte, Google/Notion anche in Tools — stesso comportamento degli hub), i link di ogni riga sono univoci.
- **`pendingOf()` e `dedupeByKey()` in `settings-status.ts` (pure, testate)**: le chiavi delle schede ambra, e il dedup per non contare due volte lo stesso problema (es. la chiave AI, contata dalla scheda Provider e dallo stato vitale).

### Corretto (coerenza emersa componendo i tre hub)
- **La pill dell'hub Impostazioni ora include le integrazioni** che la pagina mostra nella sezione Integrazioni: prima le ambre (Notion, Google, Drive) non contavano nel riepilogo — la pill diceva «Nessuna azione attesa» con tre integrazioni da collegare sotto.
- **La pill dell'hub AI non conta più la chiave due volte** (scheda Provider + stato vitale): dedup by-key.

### Nota
- Con l'ID a chiave stabile condiviso, hub e Panoramica non possono divergere: stessa fonte, stessa regola, stessa cifra.
- **Verifica browser end-to-end** (dev server dedicato, DB di verifica): ambra naturale (4/2/3 con chip nominali) e verde seminato via `scripts/overview-green.mjs` (snapshot → seed → ripristino verificato a zero residui), desktop e mobile 390px, click sui chip naviga alle schede giuste. Scoperta utile: `audit_log` è append-only a livello DB (RULE no_delete/no_update) — le righe di seed restano come traccia verificabile della prova.

---

## [Riepilogo negli header hub] — 2026-09-26 · una pill dice quante azioni sono in attesa

### Aggiunto
- **`hubSummary()` in `settings-status.ts` (pura, testata)**: somma gli stati dell'hub e restituisce la pill di riepilogo — «Nessuna azione attesa» (verde) o «N schede da completare» (ambra). Contano SOLO le ambre: le grigie sono default o OFF di proposito, nessuna azione dovuta — la semantica dei tre toni applicata all'intero hub. Hub senza stati valutabili = tutto ok.
- **Pill di riepilogo nell'header dei TRE hub**: Impostazioni (6 stati), Tools (le 4 schede con segnale valutabile, `null` escluse), Ambrosio (le 3 schede + lo stato vitale di chiave/attivazione, coerente con le pill della dashboard).

### Nota
- Il calcolo vive nel layer dati, non nella UI: un hub nuovo che adotta il pattern ottiene la pill gratis, e la regola «cosa merita azione» è la stessa testata per le schede singole.

---

## [Layer dati hub Ambrosio] — 2026-09-26 · terzo e ultimo hub sul layer dati

### Aggiunto
- **Tre funzioni pure per Ambrosio** in `settings-status.ts`: `trainingStatus` (FAQ attive + domande vere degli ultimi 30 gg non coperte — l'ambra «N da coprire» è l'unico segnale d'azione; zero FAQ con zero domande è «Copertura ok», non un problema), `aiConfigStatus` (ambra «Da attivare» SOLO se spento con chiave salvata; spento senza chiave resta grigio perché attivarlo ora non si può — il badge giusto è sulla scheda Provider), `providerStatus` (una sola chiave basta per il verde: niente fallback configurato NON è un errore, è una scelta legittima).
- **`ambrosio-status-server.ts`**: UN solo punto di caricamento che restituisce stati e dati della dashboard (stato corrente + statistiche 30 gg). Prima la pagina derivava i badge inline doppiamente; ora la lettura avviene una volta sola.
- **3 nuovi test** (17/17 totali), incluso l'input negativo normalizzato.

### Modificato
- **La pagina `/admin/ai` è pura presentazione**: la `view` del reader alimenta la dashboard, i tre badge arrivano dagli stati. Comportamento visivo identico (le sfumature grigio/ambra erano già giuste: ora sono test).

### Nota
- Con questo la copertura è completa: i TRE hub dell'admin (Impostazioni, Tools, Ambrosio) derivano i badge da funzioni pure importabili dai test node — la divergenza tra hub è diventata una regression testata, non vigilanza manuale.

---

## [Layer dati hub Tools] — 2026-09-26 · anche Tools legge i suoi stati dal layer

### Aggiunto
- **`tools-status.ts` (puro) + `tools-status-server.ts` (server)**: stesso taglio di settings-status. Tema («Personalizzato» solo con almeno un colore dell'agenzia, grigio sul default), backup con lo stato VERO dall'audit («Mai eseguito» e «Errore ultimo» in ambra, successo più recente = verde «Ultimo: N gg», date malformate ignorate, ambiente senza DB neutro — il test inietta il tempo, zero sleep/mock).
- **Google kit: regola unica condivisa** — la funzione pura `googleKitStatus` vive in tools-status e il reader del registro integrazioni la riusa: «collegato = credenziali Search Console» è deciso in UN solo posto, l'hub Tools e l'hub Impostazioni non possono più divergere.
- **`getIntegrationStatus(key)`** nel registro: un'altra pagina riusa i reader senza duplicare query; Tools non riscrive la logica Notion/Google.
- **5 nuovi test** (`tests/tools-status.test.mjs`): 14/14 totali.

### Modificato
- **L'hub Tools mostra le pill di stato** sulle card che hanno un segnale reale (tema, backup, Google, Notion); le pagine di sistema senza segnale restano senza badge — nessun finto stato. La pagina resta pura presentazione.

---

## [Layer dati degli stati hub] — 2026-09-26 · i badge dell'hub diventano testabili

### Aggiunto
- **`settings-status.ts` (cuore puro, zero import)**: le regole che decidono tono/label/conteggi dei badge Ticketing, Canali e Ambrosio (personalizzate vs predefinite, SLA attiva per ore > 0, email collegata solo completa, WhatsApp predisposto/da attivare/attivo, follow-up default 48h vs OFF esplicito) vivono in funzioni pure importabili dai test node DIRETTAMENTE dal .ts (type stripping, nessuna costante duplicata — stessa filosofia del test di contrasto).
- **`tests/settings-status.test.mjs`**: 7 test che fissano la semantica dei tre toni — grigio per gli OFF di proposito (chiusura automatica, WhatsApp non configurato), ambra solo dove c'è azione attesa (email incompleta, credenziali WhatsApp non attivate, follow-up spento esplicitamente) — più input corrotti che degradano senza lanciare.
- **`settings-status-server.ts` (server-only)**: le letture DB (autoclose, followup, whatsapp_config, email, risposte, SLA) sono uscite dalla pagina; ogni lettura degredisce da sola (DB assente/tabelle non migrate → default sicuro, mai 500 dell'hub).

### Modificato
- **La pagina `/admin/settings` è pura presentazione**: nessuna query inline, nessuna derivazione inline — stampa gli stati ricevuti, come la sezione Integrazioni già leggeva dal registro. Comportamento identico (regressioni coperte dai test).

---

## [Google Drive nel registro] — 2026-09-26 · seconda integrazione, scheda, stato e test reale

### Aggiunto
- **Google Drive entra nel registro delle integrazioni** con scheda dedicata `/admin/settings/drive` (appare da sola in hub e command palette, gruppo «Integrazioni») e reader di stato in tre toni: «Da collegare» (ambra, niente JSON), «Da verificare» (ambra, JSON salvato ma test mai riuscito) e «Collegato» (verde, dopo un test reale riuscito). Il salvataggio da solo NON accredita il collegamento: il JSON può avere l'API Drive spenta o la chiave scaduta — solo il test lo dimostra.
- **Test di connessione REALE** (`testDriveConnection`): JWT RS256 firmato con la private_key del service account → access token OAuth2 → chiamata `about/get` su Drive API. Zero dipendenze nuove (`node:crypto` + fetch). Fallisce con messaggi parlanti se API spenta, chiave invalida o credenziali corrotte — il punto è scoprirlo prima dell'uso in produzione, non all'upload del primo file.
- **Scheda a 4 passi** stesso pattern di Notion: abilita API → crea service account + chiave JSON → condividi la cartella con l'email dell'account (passo obbligatorio, senza Editor l'upload verrà negato) → incolla e prova. Banner esito come per Notion, dettagli errore completi in audit (`drive.test` con OK/ERRORE nel detail).

### Corretto
- **`content_settings` preserva il nuovo campo**: `saveGoogleToolsConfig` e `saveGscCredentials` (read-modify-write parziale) ora ricopiano `driveCredsEnc`; prima dell'aggiunta del campo il salvataggio di GA4/GSC avrebbe cancellato le credenziali Drive. Il reader Drive, speculare, tocca solo il proprio campo e non riscrive GA4/GSC/API key.

### Note
- Cifratura AES-256-GCM come le altre chiavi (`driveCredsEnc` dentro la riga `google_tools` di `content_settings`): un solo posto dove vive la config Google, segreto mai rispedito al browser (solo l'email del service account è mostrabile). Scope OAuth `drive` già richiesto: la futura sincronizzazione foto/pratiche riusa direttamente `getDriveCredentials()`.

---

## [Registro delle integrazioni] — 2026-09-26 · la sezione Integrazioni si popola da sola

### Aggiunto
- **Registro dichiarativo delle integrazioni** (`integrations-registry.ts` defs pure + `integrations-status.ts` reader server-side): la sezione «Integrazioni» dell'hub Impostazioni e il gruppo «Integrazioni» della command palette si generano DAL REGISTRO — aggiungere Google Drive, fatturazione o qualsiasi altro servizio significa aggiungere UNA def (icona, label, href, keywords) e, volendo, un reader di stato. Zero modifiche alla UI dell'hub e alla palette.
- **Google growth kit entra come integrazione** (era solo in Tools): stato «Collegato/Da collegare» letto da `hasGscCreds` (credenziali Search Console API = il collegamento REALE che alimenta le query di /admin/seo) e conteggio «N snippet attivi» (GA4/GTM configurati). La scheda resta anche nell'hub Tools: l'hub elenca le integrazioni, Tools resta il pannello di dettaglio.
- **Def senza reader = integrazione comunque visibile**: stato neutro «Presente» — la UI self-healing non si rompe mai mentre lo stato dettagliato arriva col reader.

### Deciso
- **Due file, due responsabilità**: le defs sono pure (importabili da componenti client come la palette, nessun DB), i reader sono server-only (importano `db` e le lib di config). Il collegamento def↔reader avviene per `key` con fallback gestito — un reader che lancia non spezza mai l'hub.
- **Notion esce dall'elenco statico «Sistema» della palette** (ora vive nel gruppo «Integrazioni» dal registro): stessa pagina, un solo posto che dichiara cosa è un'integrazione.

### Verifiche
- `typecheck` ✓ · `npm test` 2/2 ✓ · `build:local` ✓.

---

## [Ultimo sync Notion sull'hub] — 2026-09-26 · il badge dice QUANDO è avvenuta l'ultima consegna

### Aggiunto
- **Pill «Ultimo sync» sulla card Notion dell'hub**: data dell'ultima consegna riuscita (es. «Ultimo sync: 26 set»), letta dall'audit (`action = 'notion.sync'`, ultimo record). Fonte scelta per convenzione del progetto («l'audit è il registro da cui si leggono le statistiche»): la coda `notion_sync_queue` CANCELLA le righe riuscite (idempotenza), quindi non può dire quando è avvenuto l'ultimo sync — il registro append-only sì.
- **Ogni drain riuscito scrive ora `notion.sync` in audit** (`drainNotionQueue`): il cron, il bottone «Sincronizza» di Notion e il sync del portafoglio clienti passano tutti dallo stesso drain — una sola fonte, un solo evento per giro con almeno una consegna.

### Corretto
- **BUG: i lead consegnati non venivano mai marcati**. L'update di `leads.notion_synced_at` viveva in `syncLeadsNotionAction` ma puntava a una tabella inesistente (`notion_sync_queue_delivered`, mai creata da nessuna migration) con `.catch(() => {})` che ne nascondeva il fallimento: l'idempotenza dichiarata su `notion_synced_at` non partiva MAI e ogni sync manuale riaccodava e rideliverava gli stessi lead, creando doppioni nel workspace. La marcatura ora avviene DENTRO il drain, al momento della consegna (`update leads set notion_synced_at = now() where id = $1 and notion_synced_at is null`): il contatore «N in coda» dell'hub — finora sempre gonfio — scende davvero a 0 dopo il sync.

### Deciso
- **Marcatura nel drain, non nell'action**: il drain è l'unico punto che SA quando una consegna è davvero riuscita (per entità, non solo per i lead); le action al di sopra orchestrano l'enqueue, non assumono l'esito. Il `.catch(() => {})` sulla marcatura resta solo per il caso «colonna non ancora migrata».

### Verifiche
- `typecheck` ✓ · `npm test` 2/2 ✓ · `build:local` ✓.

---

## [Stati ricchi negli hub] — 2026-09-26 · numeri live e ambra sulle configurazioni incomplete

### Aggiunto
- **Conteggi live sulle card degli hub**: Risposte rapide mostra «N salvate», Policy SLA «N priorità», Notion «N lead in coda» (query su `notion_synced_at is null`, la stessa cifra della pagina), Addestramento «N risposte» attive — l'hub non dice solo DOVE andare ma COSA troverai.
- **Avvisi ambra quando la configurazione è incompleta**: email «Da collegare», Notion «In attesa chiavi», chiave AI «Chiave mancante», follow-up «Disattivato» e Addestramento «N da coprire» (domande vere non coperte da FAQ, calcolato con `rankFaqSuggestions`) diventano pill ambra — visibili dall'hub senza aprire le schede. WhatsApp resta neutro «Predisposto»: è spento DI PROPOSITO (Fase 4), non è una configurazione dimenticata.

### Corretto
- **Follow-up lead mentiva sull'hub**: la card mostrava sempre «Attivo» anche quando il follow-up era disattivato esplicitamente (0 ore). Ora legge `lead_followup_hours` distinguendo riga assente (default 48h) da `null` (OFF esplicito) e mostra «Disattivato» in ambra quando serve.

### Deciso
- **Tre toni, un significato ciascuno** (`HubStatus` esteso con `warn`): verde = completo e attivo, ambra = funziona MA incompleto/spento (merita un colpo d'occhio, non è un guasto), grigio = default/predefinito senza azione attesa. «Disattivata» per scelta deliberata (chiusura automatica) resta grigia: l'ambra è riservata a ciò che COMPLETA l'attivazione (chiavi, collegamenti, copertura FAQ).
- **`HubCount` separato dallo stato**: i numeri usano una pill neutra tabular-nums, il tono semantico resta alle sole condizioni — un numero non è né buono né cattivo finché non lo si interpreta.

### Verifiche
- `typecheck` ✓ · `npm test` 2/2 ✓ · `build:local` ✓.

---

## [Command palette ⌘K] — 2026-09-26 · salto diretto a qualsiasi scheda

### Aggiunto
- **Ricerca rapida nell'admin** (`⌘K` / `Ctrl+K`, bottone «Vai a…» nella nav): palette che raggiunge TUTTE le schede degli hub — Tools, Impostazioni, Ambrosio — più le aree della nav e le pagine di sistema (Notion, SEO, Shield, Audit). Con gli hub cresciuti (10+ schede) il salto diretto diventa il gesto più veloce: niente ricordare DOVE sta una configurazione, basta sapere COME si chiama.
- **Ricerca fuzzy con keywords tecniche**: ogni destinazione porta parole chiave («smtp» trova la scheda email, «faq» l'addestramento, «autoclose» la chiusura automatica) — funziona anche con l'italiano o col termine inglese. Risultati raggruppati per area (Panoramica, Gestione, Ambrosio AI, Impostazioni, Tools, Sistema) nello stesso ordine degli hub.
- **Tastiera completa, pattern dialog+combobox (WCAG)**: ↓/↑ scelgono, Enter apre, Esc chiude, focus intrappolato nell'input con `aria-activedescendant`, click fuori chiude, il focus torna al trigger alla chiusura, body scroll-lock mentre è aperta. Il selettore di gruppo ⌘K NON intercetta i campi testo: il loro shortcut nativo resta libero.
- **Pannello a due livelli (verifica browser mobile)**: `glass-strong` è al 72% di opacità e su mobile (390px) il contenuto della pagina traspariva sotto i risultati. Il pannello ora ha una base `bg-white` opaca con la superficie vetro sopra: leggibilità garantita su ogni sfondo, look invariato su desktop (overlay scurito a 40% + blur 12px).
- **Catalogo condiviso** (`src/lib/admin-destinations.ts`): le 25 destinazioni sono una lista dichiarativa con icona, gruppo e keywords — la palette e i futuri consumer (es. breadcrumb, suggerimenti) leggono dalla stessa fonte; il filtro è una funzione pura testabile.

### Deciso
- **Design glass, stesso dialogo del sito**: overlay con blur, contenitore `glass-strong` rounded-3xl, voci con tile-icona come le card degli hub — la palette sembra nata nell'admin, non incollata. Zero dipendenze nuove: il filtro fuzzy è ~10 righe, nessuna libreria command palette.
- **Attivazione dal bottone, non solo tastiera**: il trigger «Vai a…» con kbd ⌘K è sempre visibile nella nav (anche su mobile, dove la scorciatoia non esiste) — la funzione non è scoperta solo da chi conosce il gesto.

### Verifiche
- `typecheck` ✓ · `npm test` 2/2 ✓ · `build:local` ✓ (la palette è nel layout admin: nessuna rotta nuova, il bundle la carica una volta per tutte le pagine).

---

## [Impostazioni e Ambrosio a schede] — 2026-09-26 · hub ordinati come Tools, una scheda = una pagina

### Cambiato
- **Impostazioni diventa un hub di schede** (stesso pattern di `/admin/tools`): le sei configurazioni non vivono più impilate in una pagina lunghissima ma in schede-link che aprono pagine dedicate — Risposte rapide (`/settings/risposte-rapide`), Policy SLA (`/sla`), Chiusura automatica, Posta elettronica, WhatsApp Business, Follow-up lead. Ogni card mostra lo stato corrente («Personalizzate/Predefinite», «Ogni N gg», «Collegata/Da collegare») così si capisce al volo cosa richiede attenzione senza aprire niente.
- **Ambrosio stesso trattamento**: stato e statistiche 30 giorni restano in cima (la pagina resta la sua dashboard), la GESTIONE diventa quattro schede — Addestramento (FAQ + tabelle d'uso, `/ai/addestramento`), Configurazione (on/off, provider, chiave, prompt), Intelligenze multiple (fallback), Prova dal vivo.
- **Redirect email e AI aggiornati**: le azioni salvataggio/test/sync email tornano ora su `/admin/settings/email`; il test AI atterra su `/admin/ai/test` e le bozze FAQ su `/admin/ai/addestramento` — l'utente finisce DOVE vede l'esito o la bozza, non più su una pagina che ignora i suoi parametri.
- **Notion entra nell'hub come sezione «Integrazioni»** (link diretto a `/admin/notion`, badge «Pronto/In attesa chiavi» letto da `getNotionSettings`): è una sincronizzazione verso un servizio esterno, non navigazione quotidiana, quindi resta fuori nav ma trova casa tra le Impostazioni. La sua pagina adotta lo stesso header standard delle schede (`SubPageHeader` con back-link) mantenendo il badge di stato nel sottotitolo.
- **Componenti condivisi nuovi**: `HubCard`/`HubStatus` (tile-link con stato, `settings-hub.tsx`) e `SubPageHeader` (back-link + titolo, `sub-page-header.tsx`) eliminano la duplicazione tra le pagine nuove.

### Deciso
- **Niente redirect legacy dai vecchi URL**: le entry point erano la nav (punta già agli hub) e le action (aggiornate); verificato con ricerca che nessun componente client contenesse link hard-coded a `/admin/settings` o `/admin/ai` con parametri.
- **Lo stato nelle card dell'hub si legge live dal DB** (content_settings, whatsapp_config) con gli stessi try/catch delle pagine precedenti: le schede restano informative anche con tabelle non migrate.

### Verifiche
- `typecheck` ✓ · `build:local` ✓ con le 10 rotte nuove compilate (`/admin/settings/*` × 6, `/admin/ai/*` × 4 + i due hub ridotti).

---

## [Filtri inbox rifiniti] — 2026-09-25 · «Di colleghi» e ricerca a richiesta

### Cambiato
- **«Collega» → «Di colleghi»**: il gergo interno non spiegava il filtro (i ticket assegnati ad altri). Ora si legge come una possesso: Miei / Di colleghi.
- **Ricerca a richiesta**: collassata è un bottone «Cerca» — il gesto più frequente della inbox è scansionare e la casella vuota era un'inutile promessa permanente (critica: nove controlli prima del primo ticket). Si espande al click con focus automatico, si richiude con Escape o blur se vuota; con una ricerca attiva resta aperta con «Annulla». Il contesto filtri (f, channel) attraversa la submission come nella vecchia form inline.

### Verifiche
- Browser: collassata di default (desktop e mobile), espansione con focus, richiusura Escape, auto-riapertura con query attiva, Annulla torna alla coda senza azzerare i filtri. `typecheck` ✓ · `build:local` ✓ (23/23).

## [Lead e Callback sullo schema della inbox] — 2026-09-25 · identità, riga di stato e zona azioni separate

### Cambiato
- **Lead**: le semantiche (da Ambrosio, hot, callback fissata) escono dal paragrafo del nome e diventano una RIGA DI STATO sotto il titolo — l'identità (nome · telefono) si legge da sola, ogni classificazione ha il suo spazio. La colonna destra resta la zona azioni (stato, temperatura, richiamo, nota) allineata come la inbox.
- **Callback**: la riga di stato unifica slot + orario + temperatura del lead (prima: slot con emoji 📞 nella riga del titolo, temperatura dispersa nella colonna azioni). Esiti «Fatto/Mancato» senza i glifi ✓/✗ nel testo — le icone lucide sono lo standard (l'emoji era l'ultima rimasta nel backend).
- **Temperatura senza emoji**: il segment Caldo/Tiepido/Freddo usa le icone lucide (fiamma/flocco), non più 🔥/❄️.

### Verifiche
- Browser desktop + mobile (390px, zero overflow): righe di stato distinte, esiti con icone, zero emoji nel backend. `typecheck` ✓ · `build:local` ✓ (23/23, dopo pulizia cache prod corrotta).

## [SLA dei ticket bot] — 2026-09-25 · «in attesa operatore» invece di falsa urgenza

### Cambiato
- **I ticket ancora al bot escono dal calcolo SLA**: `slaTier` restituisce «in attesa operatore» (tinta neutra) per `status = bot` — nessun operatore ha promesso nulla, «Bot in ritardo» non aveva referente nel mondo reale e gonfiava la coda di urgenza finta, svalutando il segnale rosso dei ticket veri. In inbox 7 ticket su 18 risultavano «in ritardo» con 0 messaggi. Appena un operatore prende in carico il ticket cambia stato e rientra nei tier normali (verificato: #73 in conversazione resta «in ritardo» nel dettaglio).

---

## [Portafoglio Clienti] — 2026-09-25 · la sezione «Clienti» tutta gestita da Ambrosio

### Aggiunto
- **Sezione Clienti** (`/admin/clients`, voce «Clienti» nel menu Gestione): il portafoglio clienti NON si compila a mano — Ambrosio in automatico recupera i dati del cliente DAI TICKET (lead di chat/WhatsApp, mittente email, email citate nei messaggi) e compone le schede, deduplicate per telefono E.164 o email normalizzata. Lo stesso numero su chat e WhatsApp è UN cliente con tutti i suoi ticket, su tutti i canali.
- **Lista con KPI e azioni collegate**: 4 card (Clienti, con telefono, con email, aziende), ricerca per nome/email/telefono/ditta, e per ogni scheda le azioni canale — chiama, WhatsApp, email, apri i ticket (con badge «N aperti» e canali di provenienza).
- **Scheda cliente** (`/admin/clients/[id]`): identità ricostruita, azioni canale, nota libera dell'agente (audit `client.nota`), ticket collegati con stato/priorità/«attende risposta» e gli ultimi messaggi come contesto rapido. I ticket restano la fonte di verità: da qui si APRONO, non si modificano.
- **Sync automatica** (blocco 9 del cron, dopo l'ingest email così anche i ticket appena nati entrano al primo giro): roster `client_conversations` — ogni ticket processato UNA volta, la INSERT con `on conflict do nothing` è il lock anche con tick paralleli (convenzione dedup del progetto). Disattivabile con `content_settings` key `clients_sync_enabled = {"enabled": false}`; sync manuale col bottone in pagina (`syncClientsAction`, audit `client.sync`).
- **Migration 025** (`neon/migrations/025-clients.sql`): tabelle `clients` (indici unique parziali su phone_e164/email_norm = dedup) e `client_conversations` (roster, cascade su delete del ticket). Riferimenti SOFT dalla scheda ai ticket: cancellare un ticket non cancella mai il cliente. Aggiunte al backup/restore (RESTORE_ORDER: clients senza FK vere, client_conversations dipende da clients+conversations).

### Estensioni (stesso giro)
- **Notion collegato**: il sync manuale del portafoglio accoda anche le schede clienti sulla coda Notion esistente (entità `client`, mapping default Cliente/Telefono/Email/Azienda/Ticket/Canali/Ultimo contatto, stessa config e stesso rate limit dei lead) — attiva finché l'entità lead è attiva in config; errori non bloccanti e visibili nel sync log.
- **Tool `cerca_cliente` di Ambrosio** (sola lettura, in whitelist): durante la chat riconosce un cliente già noto per telefono E.164, email o nome esatto — il risultato finisce nell'audit e nella nota/contesto. Nome senza fuzzy: meglio «non trovato» che un falso positivo pronunciato al cliente.
- **Handoff con contesto**: quando Ambrosio passa il turno al team su una conversazione con lead noto nel portafoglio, la nota interna diventa «[handoff] motivo — cliente noto: Nome (Azienda) — N ticket totali, M aperti, ultimo contatto …»: l'agente apre il ticket sapendo già chi ha davanti.
- **Valore aggregato + filtro**: la lista e la scheda mostrano «~N € dichiarati» (somma euristica dei MASSIMI dei budget dichiarati nei lead dei suoi ticket; solo cifre davvero scritte, soglie 50€–500k per escludere telefoni e rumore) e il filtro «Solo con ticket aperti» (`?aperti=1`) isola chi ha lavoro in corso.

### Deciso
- **Nessuna copia dei dati**: la scheda collega i ticket esistenti e ne ricava l'identità al sync; i ticket restano la fonte di verità (stesso principio di Notion: lo strumento sincronizza, non duplica). L'update del cliente «completa ma non distrugge»: un campo nuovo riempie un buco, non sovrascrive ciò che si sapeva.
- **Dedup sul telefono normalizzato prima dell'email**: il numero (E.164 via `messaging.toE164`, la stessa normalizzazione web+WhatsApp della Fase 4) è l'identità più stabile; l'email copre il canale email e i lead senza telefono. Nessuno dei due → niente scheda (meglio vuoto che doppioni).
- **Audit come fonte delle statistiche future**: ogni sync scrive `client.sync` con actor `ambrosio@ai` (cron) o l'agente (manuale) — coerente col resto del registro append-only.

### Verifiche
- `npm run typecheck` ✓ · `npm test` ✓ (2/2) · `npm run build:local` ✓ (rotte `/admin/clients` e `/admin/clients/[id]` compilate)

## [Macro-aree e schede singole] — 2026-09-25 · Nav a 5 voci, Tools come hub di schede

### Aggiunto
- **Nav a macro-aree**: Panoramica · **Gestione ▾** (Ticket, Lead, Callback, Operatori, Pacchetti) · Ambrosio AI · Impostazioni · Tools. Prima: 13 voci che sforavano il contenitore (Tools «spariva» oltre il bordo). Il pulsante di gruppo porta il nome della pagina attiva con la pillola animata, così la pagina su cui sei non è mai anonima dietro i tre punti. Notion, SEO, Shield e Audit escono dalla nav: non sono navigazione quotidiana.
- **Tools come hub di schede**: ogni strumento vive nella SUA pagina (`/admin/tools/theme`, `/tools/backup`, `/tools/google`), raggiunta da card con chevron — stesso schema delle schede Notion/SEO/Shield/Audit. Prima: sei pannelli annegati in una pagina chilometrica.
- **Posta elettronica in Impostazioni**: SMTP+IMAP e sync sono un canale di comunicazione del team, non uno strumento tecnico — stanno con gli altri canali (WhatsApp, risposte rapide). I redirect delle server action (salvataggio, test, sync) seguono il nuovo percorso.
- **Footer nascosto nel backend**: gate client `PublicOnly` nel root layout (il footer resta server-rendered per il pubblico; nel backend era rumore sotto l'ultimo strumento).

### Verifiche
- Browser: hub Tools (3 schede operative + 4 di sistema), schede backup/google/theme con back-link, Impostazioni con il pannello email, nav con pillola su pagina interna e menu Gestione, mobile 390px senza overflow. `typecheck` ✓ · `build:local` ✓ (23/23) · `npm test` 2/2.

## [Pagine elenco sul design system] — 2026-09-25 · Ticket, Lead e Callback come il resto dell'admin

### Aggiunto
- **Header di pagina uniformi** (pattern Panoramica/Tools): h1 text-2xl + icona + sottotitolo operativo. Ticket guadagna i contatori della coda accanto al titolo (badge neutro «18 aperti» + ambra semantica «N da rispondere»), Lead il senso della lista («ultimi 200 contatti entrati da chat, form e callback»), Callback la spiegazione del flusso («si chiama, si segna l'esito, si rilascia lo slot»). Prima: «Inbox ticket» text-xl senza icona, «Lead (ultimi 200)» e «Callback fissate» text-lg.
- **CTA e stati sul design system**: «Nuovo ticket» su GlassLinkButton primary, «Sincronizza email» su GlassButton (primaria quando il canale email è vuoto — visibile quando serve, glass altrimenti), «Export CSV» su GlassLinkButton glass, banner di sync ed empty state su GlassNotice.

### Scoperto
- **GlassBadge non è per le semantiche**: il colore testuale vive nel CSS (`.glass-badge`, slate-700/800 per light/dark) e a pari specificità batte le utility del chiamante — nell'header ticket «5 da rispondere» perdeva l'ambra diventando grigio. Corretto tenendo i badge semantici (azione dovuta, esiti callback, temperatura lead) su pill dedicate: la decisione di design «le semantiche non si toccano» ora vale anche per GlassBadge, che resta il badge NEUTRO su vetro (14,7:1 in dark, 5,1:1 in light).

### Verifiche
- Browser: le tre pagine in light e dark — header allineati, semantiche con le loro tinte, badge neutro a 14,65:1 in dark; `typecheck` ✓ · `build:local` ✓.

---

## [Tools dal menu] — 2026-09-25 · la nav va a capo invece di nascondere le voci

### Corretto
- **«Tools sparito» dal menu admin**: con la voce SEO arrivata a 13, la nav scrollabile orizzontale nascondeva Tools e Impostazioni oltre il bordo (contenuto 1291px in un contenitore da 1078px) — e `no-scrollbar` toglieva anche l'indice dello scorrimento: voci esistevano ma erano irraggiungibili a occhio. Fix: `flex-wrap` con voci centrate su due file — zero contenuto tagliato, la pillola animata di framer-motion segue il cambio riga da sola, su mobile le sole icone si dispongono su due file ordinate (verificato a 390px).
- Lezione di design: la promessa «mai tagliate a destra» la mantiene il wrap, non lo scroll senza affordance; lo scroll orizzontale senza scrollbar visibile è un contenuto che non esiste.

---

## [Test di contrasto automatico] — 2026-09-25 · le regressioni di leggibilità falliscono la build

### Aggiunto
- **`npm test` — tests/contrast.test.mjs (node:test, zero dipendenze)**: calcola il contrasto WCAG di TUTTI gli stati del design system in light E dark e fallisce sotto 4,5:1. Coperti: GlassStatus (ok/ko), GlassBadge neutro (testo da `.glass-badge`), badge brand (light dai chiamanti, dark dall'override CSS `!important`), GlassNotice (info/success/warning), le pill semantiche delle pagine elenco («da rispondere», esiti callback, temperatura lead).
- **Nessun valore duplicato**: il test PARSA i file sorgente — token da `globals.css` (blocco `:root` + mirror `html[data-mode="dark"]`), coppie fg/bg da `glass.tsx` — come il browser parsa il CSS. Cambiare una tinta nel sorgente cambia il test: niente copie da mantenere allineate.
- **Modello di calcolo fedele alla resa reale** (lo stesso dell'audit manuale): alpha-compositing figli→padri sulla aurora (i gradient del body sono invisibili a `getComputedStyle`), caso peggiore tra i due estremi del gradient e tra i contesti reali (direttamente sull'aurora o su card `.glass-solid`); semantiche su scale Tailwind v3 statiche (decisione: non si toccano), slate/brand dai token CSS col mirror dark.
- **Verificato con mutation test**: tinta volutamente cieca su GlassStatus (emerald-200/500) → il test fallisce con l'elenco preciso (`GlassStatus collegato [light]: 1,22:1`); ripristinata → passa. Il difetto più subdolo catturato durante la scrittura: la alpha di GlassBadge/Notice su aurora scura rende il fondo PIÙ scuro della aurora stessa (compositing, non «vetro chiaro») — modello matematico, non euristico.

### Note
- Il test gira su `node --test` (glob `tests/*.test.mjs`): nessun runner da installare. Da qui in poi, una tinta sotto AA nel design system rompe la pipeline come un type error.

---

## [Contrasto AA delle pagine pubbliche] — 2026-09-25 · home, landing e consulenza, light e dark

### Aggiunto
- **`--on-brand`, il colore del testo sopra i fondi brand**: il tema pubblico è personalizzabile (`themeVars` inietta la scala 50–950 inline da SSR) e con un primario CHIARO scelto dall'utente la scala dark schiarisce il 600: il bianco dei CTA («Cerca», «Parla col team», «Chiama ora») crollava a 1,57:1 in light e 1,46:1 in dark. `onBrandColor()` (pura, in theme-shared) misura il contrasto WCAG reale contro brand-600 e sceglie bianco o quasi-nero — l'equivalente light di `adjustScaleForDark`. Fallback `#ffffff` = tema default blu (6,2:1) e zendesk (6,6:1), che passano sempre. L'override CSS copre CTA e `.step-dot` in ENTRAMBE le modalità (prima solo dark).
- **`.glass-badge` in dark corretto**: l'override testuale usava `--slate-200`, che nella scala dark INVERTITA è blu-navy scuro → badge hero «Agenzia web con sede…» a 1,19:1 su vetro scuro. Il mirror giusto di slate-700 light è slate-800 dark (226 232 240): 14,7:1. Migliora anche i badge admin in dark.

### Corretti
- **Footer pubblico**: copyright `text-slate-500` su vetro bianco/40 = 4,41:1 → slate-600 (5,5:1); in dark la scala invertita lo rende comunque chiaro.
- **«Turni: …» nella home**: slate-500 su aurora chiara = 4,18:1 → slate-600.
- **Breadcrumb landing**: slate-500 = 4,18:1 → slate-600 (il corpo era già slate-600/700).
- **Placeholder globali**: `rgb(var(--slate-500) / 0.9)` misurava 4,49:1, appena sotto AA → alpha pieno (4,9:1).
- **FAQ home**: il «+» brand-500 su vetro bianco = 2,6:1 → brand-700 (4,5:1); città nelle card landing slate-400 → slate-500 su vetro.

### Note di misura
- Scanner corretto in due punti: i livelli di sfondo si compongono FIGLI→padri (l'ordine inverso falsava i vetri translucidi) e la base finale è la aurora (gradient del body, invisibile a `getComputedStyle`): fallback per-mode chiaro/scuro al posto del bianco. Le misure si prendono a transizioni disattivate (i colori a metà transizione falsavano il dark).
- Il dark pubblico è server-side (variabili inline su `<html>`): per testarlo in modo deterministico si replicano inline scala + `--on-brand` con la stessa matematica di `adjustScaleForDark`/`onBrandColor`.

### Verifiche
- Browser: home (133 testi), landing (66) e /consulenza (28 + placeholder) — zero elementi sotto AA in light e dark, con tema default blu, tema zendesk e primario verde chiaro simulato; `typecheck` ✓ · `build:local` ✓.

---

## [Contrasto AA di stati e badge] — 2026-09-25 · leggibilità misurata, light e dark

### Corretti
- **GlassStatus grigio sotto AA in light**: slate-500 su slate-100 = 4,34:1 (sotto 4,5 per testo 11px). Ora slate-600 su slate-100 con ring-300: 5,0:1.
- **Badge contatore brand illeggibile in dark** («0/4 strumenti collegati», «Server collegato»): brand-700 (scuro) su brand-50 (chiaro) in dark = 1,1:1. Ora il badge scambia i ruoli: fondo brand-900 traslucido, testo brand-200 con `!important` (la multipla `html[data-mode] .text-brand-*` schiarisce ogni utility text-brand con specificità 0,2,1 e batteva l'override a parità di classe). Contratto misurato: ~10,7:1.
- **Stesso difetto sulle pill di stato brand** («In conversazione» nei ticket, «Server collegato»): unify via attributo `[class*=bg-brand-50][class*=text-brand-700]` — stessa resa scura. Prima 1,83:1, ora ~10:1.
- **GlassBadge con doppia utility testo**: la base `text-slate-700` contende con `text-brand-700` del chiamante (in dark vinceva slate, testo scuro su fondo scuro). Il colore testo va in CSS (`.glass-badge`: slate-700 light / slate-200 dark): nessuna lotta di utility.
- **Contatore pill su vetro bianco esplicito** («14 aperti» nell'Inbox): in dark `bg-white/65` + testo slate-600 (ora chiaro) = fondo quasi bianco col testo chiaro. Override scuro: fondo slate-200/12% + ring tenue → ~9,9:1.
- **Cerchietti numerati su brand-600** (passi guida Notion, badge «Attivo» nell'editor tema): in dark il testo bianco diventava slate-900 (2,7:1 su blu pieno). Classe `step-dot`: bianco pieno su brand-500, 4,6:1 in dark / 5,1:1 in light.

### Note di misura
- Lo scanner `getComputedStyle` non include i gradient di sfondo (aurora): le misure dirette dei pill su fondo aurora sono fuorvianti. I ratio riportati sono calcolati sui fondi effettivi (blend manuale alpha-compositing), verificati anche a occhio in screenshot dark.
- Le semantiche verde/ambra/rosso (SLA, priorità, esiti) mantengono la resa chiara con testo scuro in dark per decisione di design già registrata: contrasto interno 4,7–6:1, intatte.

### Verifiche
- Browser: Tools + Ticket in light e dark — zero badge sotto AA tra GlassStatus, GlassBadge, banner GlassNotice, pill di stato e contatori; `typecheck` ✓ · `build:local` ✓.

---

## [Icone nei banner di esito] — 2026-09-25 · l'esito non si legge solo col colore

### Aggiunto
- **`GlassNotice` con icona di stato**: info (i), success (check-circle), warning (triangle-alert) — il tipo di esito si riconosce senza affidarsi al colore (daltonismo, schermi monocromatici). Il ruolo ARIA segue il tone: `alert` per warning, `status` per il resto.
- **Banner del restore allineati**: esito, errore e dipendenze mancanti in `RestoreSection` passano dai banner hand-rolled a `GlassNotice`; l'errore di upload ha l'icona inline (testo, non banner).

### Verifiche
- Browser: banner warning del restore (triangle-alert ambra, role=alert) e banner info del check versione (i, role=status) con icona e colore corretti; `typecheck` ✓ · `build:local` ✓.

---

## [Pacchetti e Shield allineati al design system] — 2026-09-25 · stessa gerarchia di Tools

### Corretti
- **Header di pagina piccoli**: entrambe le pagine aprivano con h1 a text-lg (Pacchetti) o text-lg con icona piccola (Shield). Ora text-2xl + icona h-6 + sottotitolo, stesso pattern di Panoramica e Tools.
- **Pacchetti**: CTA «Salva modifiche / Crea pacchetto» e toggle «Attivo / Spento» passano su `GlassButton` (touch target 44px, focus ring coerente); l'header «Nuovo pacchetto» sale a text-base per stare nella scala tipografica.
- **Shield**: le tre sezioni (Cosa protegge, IP bannati, Eventi recenti) usano `GlassSectionHeader` con tinte semantiche (blu/red/amber) al posto dei `<p>` inline; «Sblocca» passa su `GlassButton glass`.

### Verifiche
- Browser: Pacchetti e Shield ricontrollate — header, stati e CTA ora identici a Tools; `typecheck` ✓ · `build:local` ✓.

---

## [Gerarchia visiva di Tools] — 2026-09-25 · un solo sistema per card, stati e CTA

### Corretti
- **Header di pagina mancante**: «Tema grafico» (text-lg) era di fatto l'h1 di Tools — le altre pagine admin usano text-2xl + icona. Ora la pagina apre con «🔧 Tools» + sottotitolo, stesso pattern di Panoramica.
- **Header di sezione incoerenti**: i pannelli Backup/Google/Email avevano icon-tile + h2, le tre card editoriali in fondo semplici `<p>`. Creato `GlassSectionHeader` (tile-icona + titolo + sottotitolo + area destra) e applicato a TUTTE le sezioni della pagina: la gerarchia si legge a colpo d'occhio.
- **CTA fuori sistema**: nessun pannello usava `GlassButton` — ogni bottone era hand-rolled con 4 stili diversi per la stessa azione. Ora tutte le CTA di Tools passano dai variant del design system (`primary` per l'azione principale, `glass` per le secondarie, `danger` per il restore) con dimensioni da `glassSizes`.
- **Touch target**: `GlassButton` senza min-h — con la revisione TUTTI i bottoni glass ≥ 44px (WCAG 2.5.5), verificato nel browser.
- **Stati duplicati**: `Status` era copiato-incollato in google-tools-panel ed email-tools-panel. Unificato in `GlassStatus` (verde = collegato, grigio = da fare); i banner di esito delle azioni in `GlassNotice` (info/success/warning).
- Import inutilizzati rimasti dopo l'unificazione (`Check` in google/email-tools-panel).

### Deciso
- **Componenti prima dei pixel**: invece di rincorrere le classi nelle singole card, il design system guadagna i tre pezzi mancanti (SectionHeader, Status, Notice) e i pannelli li consumano — la prossima sezione nasce già coerente.
- **Dark mode verificata, non toccata**: le card glass e i bottoni ereditano già le variabili del tema; lo screenshot in dark conferma contrasto e coerenza senza modifiche extra.

### Verifiche
- Browser: pagina completa in light e dark, tutti i bottoni a 44px, stati e CTA coerenti per variant.
- `typecheck` ✓ · `build:local` ✓.

---

## [Audit filtrabile + CSV dedicato al backup] — 2026-09-25 · trovare gli eventi, portarli via

### Aggiunto
- **Filtro per azione nella pagina Audit**: select popolato dalle azioni DAVVERO presenti nel log (`select distinct action`) — nessuna voce vuota nel menu. Form GET nativo: funziona anche senza JS, il filtro è condivisibile come URL (`/admin/audit?azione=backup.creato`). Con filtro attivo: contatore («1 evento di «Restore eseguito»») e link «Rimuovi filtro».
- **Etichette italiane per il ciclo backup**: `backup.creato` → «Backup creato», `restore.eseguito` → «Restore eseguito», `restore.errore` → «Restore annullato», ecc. — il log resta in inglese tecnico, la UI parla italiano. `restore.eseguito`/`restore.errore` hanno tinte dedicate (verde/rosso) e tutte le voci del ciclo prendono la tinta fucsia.
- **Export CSV dedicato alle voci di backup** (`/api/admin/audit-backup.csv`): solo il ciclo di vita del backup (`backup.*`, `restore.*`, `versione.check`) con date ISO — un export di conformità si ordina e si filtra meglio così. Stessa sessione-admin guard dell'export audit completo; il bottone «CSV backup» compare solo se esistono voci del ciclo nel log.
- **Lista azioni condivisa** (`lib/backup-audit.ts`): filtro pagina ed export CSV leggono la STESSA costante — le due viste non possono divergere.

### Verifiche
- Browser: filtro «Restore eseguito» → 1 evento con dettaglio per-tabella; CSV dedicato → 13 righe (solo backup/restore/versione, controllate per azione); senza filtro → 67 eventi, nessun counter.
- `typecheck` ✓ · `build:local` ✓.

---

## [Inbox di triage potenziate] — 2026-09-25 · canali sempre visibili, azioni complete sulla scheda

### Aggiunto
- **Azioni complete su ogni scheda** (`TicketCardActions`, modello Zendesk/Freshdesk): **Prendi in carico**, **Chiudi** (con conferma inline a due click) e **Nascondi** direttamente dalla lista, senza aprire il ticket. Regole anti-danno: «Chiudi» appare solo su ticket aperti NON in attesa di risposta del cliente (chiudere ora lo delude); «Prendi in carico» solo se il ticket non è già tuo; conferma inline per la chiusura; le azioni fermano la propagazione (la card non apre il ticket per errore).
- **I canali sono sempre visibili**: tab Email e WhatsApp in elenco anche a 0 ticket — un canale del sistema non può sembrare assente (prima: solo canali con ticket, il canale email spariva fino alla prima email). Sync email sempre disponibile in header, con tinta evidenziata quando il canale è vuoto (è il modo con cui entrano i ticket nuovi).
- **Classificazione più ricca nella scheda**: su ticket email il contatto mostra l'INDIRIZZO (a colpo d'occhio sai a chi risponderai), su chat il nome/telefono del lead; l'assegnatario è visibile in riga meta («· Daniele»).

### Corretti
- **«Chat web17» senza spazio**: il gap del flex non si applica ai text node — conteggio con spazio inscindibile (\u00A0). Stessa classe di difetto su Email/WhatsApp.
- **Event handlers su Server Component**: le azioni vivevano in un `div onClick` server-side — runtime error React; la gestione del click è interamente nel client component.
- **Touch target**: i bottoni azione passano a min-h-11 (44px) su mobile, min-h-9 su desktop (WCAG 2.5.5).
- Rimosso il vecchio bottone «nascondi» flottante nell'angolo (sostituito dalle azioni in scheda): niente più doppio controllo per la stessa azione.

### Verifiche
- Browser: claim reale verificato su DB (#69 assegnato → ripristinato), conferma chiusura → annulla, tab a 0 ticket cliccabili, mobile 390px senza overflow.
- `typecheck` ✓ · `build:local` ✓.

---

## [Ambrosio nel composer del nuovo ticket] — 2026-09-25 · l'AI scrive la prima bozza

### Aggiunto
- **«Ambrosio ti propone»** sotto l'editor di `/admin/tickets/new`: il bottone **«Fai scrivere Ambrosio»** genera la bozza della prima risposta partendo dall'oggetto del ticket (contesto) — Ambrosio usa le stesse fonti del chatbot pubblico (FAQ ufficiali + pacchetti attivi) via `ambrosioDraftAction` → `draftFaqAnswer`.
- **Frasi preimpostate = le 6 FAQ attive** come chip: click → la risposta ufficiale (prezzi veri del DB) entra nell'editor come punto di partenza, modificabile prima dell'invio.
- La bozza entra SEMPRE nell'editor, mai inviata diretta: l'agente rilegge e corregge (coerenza con il principio «prezzi veri, niente inventati» di Ambrosio).
- Stato: pending («Ambrosio scrive…»), errore gestito (chiave mancante/provider giù → messaggio azionabile), toast di conferma.

### Decisioni
- **Server action con ritorno dati, non redirect**: `ambrosioDraftAction` torna `{ok, draft}` e l'editor decide dove inserirlo — diverso da `draftFaqAnswerAction` (pagine AI) che ridirige con query string, perché qui il contenuto vive in un editor client-state.
- **L'oggetto si legge dal form per id** (`subjectInputId`): niente ref client da un server component — il contratto tra pagina e editor è un id, l'oggetto è sempre quello che l'agente vede.
- **Bozza in paragrafi**: il testo plano di Ambrosio viene convertito in `<p>` dentro l'editor, quindi è immediatamente formattabile con la toolbar (grassetto su una frase, link sul prezzo…).

### Verifiche
- Browser: chip → risposta ufficiale nell'editor (FormData coerente, 304 char), oggetto vuoto → messaggio «Scrivi prima l'oggetto», provider non configurato → errore gestito con bottone riabilitato, round-trip completo senza errori console.
- `typecheck` ✓ · `build:local` ✓.

---

## [Restore da backup] — 2026-09-25 · ripristino guidato per tabella con conferma esplicita

### Aggiunto
- **Ripristino dal file di backup** nella sezione «Backup e Aggiornamenti Versione»: upload del JSON → **piano leggibile** (per ogni tabella: righe nel file vs righe attuali, tabelle saltate con motivo) → selezione delle tabelle → **conferma esplicita scrivendo «RIPRISTINA»** → esecuzione transazionale.
- **Esecuzione in UNA transazione** (`executeRestore`): delete + insert per-tabella nell'ordine parents→children (leads → conversations → messages…); un errore = rollback totale, il database resta com'era. Le colonne sono ripulite coi nomi REALI del DB live (il file può venire da uno schema diverso: le colonne sconosciute si scartano, i valori passano SEMPRE via placeholder).
- **Log append-only protetti per-design**: `audit_log` e `backup_history` non sono mai ripristinabili (rule SQL anti-UPDATE/DELETE) — la storia non si riscrive; la UI lo dichiara invece di nasconderlo.
- **Sequence riallineata**: dopo il restore di `conversations`, `setval` porta `conversations_number_seq` al massimo ripristinato (senza, il primo ticket nuovo andrebbe in conflitto sull'unique).
- **Piano via rotta API autenticata** (`POST /api/admin/restore/plan`): il file NON viene salvato da nessuna parte e non passa da query string/redirect (un JSON da ~117 KB non ci sta negli header); resta in memoria del browser e rientra nel form di conferma come campo del POST. Fase 2 via server action con audit (`restore.eseguito` / `restore.errore`) e `revalidatePath("/", "layout")`.
- **Copertura backup completa**: aggiunte `ai_faq_usage` e `shield_events` all'export (erano fuori dalla lista delle 18 tabelle).

### Deciso
- **Sostituzione per-tabella, non merge**: un restore porta i dati di un momento passato — fondere con i dati attuali creerebbe orfani di FK e stati impossibili. L'operatore sceglie COSA sostituire; le tabelle non selezionate non vengono toccate.
- **Conferma con testo digitato invece di checkbox/m dismiss**: la casella non si riempie per sbaglio; il bottone resta disabilitato finché il testo non coincide esattamente. Il messaggio d'errore ribadisce che nessun dato è stato toccato.
- **Due fasi separate** (analizza → conferma): vedere il piano PRIMA di decidere è la differenza tra un restore e un azzardo; il piano mostra anche le tabelle nate dopo il backup (assenti dal file, intatte nel DB).

### Note operative
- Il restore non sostituisce i backup gestiti di Neon: è il gesto di emergenza quando serve tornare a uno stato noto con i dati in mano.
- **Testato e2e completo**: backup reale → analisi (19 tabelle) → conferma «RIPRISTINA» → restore di TUTTE le tabelle riuscito (leads:5, conversations:41, messages:70…), constraint FK tornati non-deferrable (0 residui), `conversations_number_seq` riallineata a 72, audit `restore.eseguito` per-tabella.
- **Due difetti emersi e corretti in test**: (1) i driver `pg` serializzano gli array JS come letterale Postgres `{a,b}` — per le colonne **jsonb** il parametro ora è sempre la stringa JSON con cast `$n::jsonb` (le circularità `leads ↔ callbacks` richiedono invece constraint **deferrabili al volo** dentro la transazione, rilasciati a fine restore).
- (2) con controlli FK differiti in coda, l'`ALTER TABLE` di ripristino fallisce («pending trigger events»): risolto con `set constraints all immediate` prima del DDL — una violazione emerge comunque dentro la transazione (rollback), la coda si svuota e l'ALTER passa.
- **Rollback verificato due volte**: file non valido (nessuna scrittura) e selezione vuota (guard lato client + azione: «il restore non è partito»).

---

## [Backup e Aggiornamenti Versione] — 2026-09-25 · export JSON + stato versioni in Tools

### Aggiunto
- **Sezione «Backup e Aggiornamenti Versione»** in `/admin/tools`, sotto il tema grafico: pannello con backup completo, versione corrente, promemoria e storico.
- **Export JSON completo** del database generato lato server: schema SQL + tutte le tabelle di business (lead, ticket, messaggi, callback, FAQ, pacchetti, impostazioni, audit, shield) in un unico file `backup-webagencycrema-<data>.json`. Niente credenziali nel file: la connection string resta nel server.
- **Rotta di download autenticata** (`/api/admin/backup/[id]`, stessa sessione admin): il contenuto si rigenera con i dati PIÙ FRESCI al momento dello scaricamento — la voce dello storico è il riferimento, non una copia congelata.
- **Storico backup** (migration 024: `backup_history`, append-only con rule anti-UPDATE/DELETE come `audit_log`): chi ha fatto il backup, quando, dimensione, conteggio righe per tabella. Soft-delete dall'elenco: la traccia resta nel DB, il promemoria non si spegne cancellando la voce.
- **Versione corrente**: app dal `package.json` letto a runtime (sempre quella deployata) + Next.js installato. «Verifica aggiornamenti» interroga npm registry e confronta la versione installata di Next con l'ultima pubblicata — solo INFORMATIVO: il codice si aggiorna da Git/Vercel, mai da un pannello (per design: nessun self-update server).
- **Promemoria backup** (blocco 7 del cron): se l'ultimo backup è più vecchio di N giorni (default 7, chiave `backup_reminder_days`, 0 = OFF) il team riceve email + Telegram con il link alla sezione. Il confronto è sull'ultimo backup MAI fatto (anche soft-deleted): cancellarlo dall'elenco non spegne l'avviso.
- **Audit completo**: `backup.creato` (con dimensione e conteggi), `backup.eliminato`, `backup.promemoria`, `versione.check` — chi ha fatto cosa, come per tutte le azioni admin.

### Deciso
- **Export JSON invece di dump SQL binario**: leggibile, versionabile, ripristinabile per tabella (le tabelle esistenti al momento dell'export — deploy progressivi e DB vecchi non rompono il backup). La repository di verità resta Neon: lo strumento aggiunge la copia di custodia dell'agenzia e il gesto operativo, non sostituisce i backup gestiti del provider.
- **Download rigenerato, non salvato sul server**: niente file sensibili su disco/Vercel (filesystem effimero), niente token di lunga durata nei redirect; l'id dello storico non espone nulla perché il contenuto si costruisce alla GET.
- **Check versione solo su Next**: è l'unica dipendenza che guida lo stack (l'app è privata, il suo package non è su npm); il confronto con npm registry ha timeout di 8s e degrada con messaggio onesto se offline.
- **Client/server split**: tipi importabili (`BackupEntry`) da `lib/maintenance.ts` che resta server-side; il pannello client non trascina `pg` nel bundle (stesso pattern email-tools/notion-config).

### Note operative
- Prima attivazione: eseguire migration 024 (`neon/migrations/024-backup-history.sql`). Senza tabella, il pannello resta vuoto e il backup parte comunque (lo storico è best-effort, il download no).
- Il cron blocco 7 eredita la protezione del tick (CRON_SECRET / Vercel Cron): nessuna superficie nuova.

---

## [Editor WordPress sul nuovo ticket] — 2026-09-25 · la prima risposta parte formattata

### Aggiunto
- **Blocco di testo in stile WordPress** su «Prima risposta» in `/admin/tickets/new`: toolbar (grassetto, corsivo, barrato, elenco puntato/numerato, citazione, codice, link, annulla/ripeti), tab **Visuale/Testo** come nel classic editor (in Testo si scrive HTML a mano), contatore parole, placeholder via CSS (`:empty::before`).
- **La formattazione arriva davvero al cliente**: `sendEmailViaTools` accetta `html` e invia multipart alternativo (testo piano + HTML in guscio email leggibile a 640px); i client mostrano l'HTML, il testo resta fallback per client testuali e filtri antispam.

### Decisioni
- **contentEditable + execCommand, zero dipendenze**: i comandi serviti (inline, liste, formatBlock) sono stabili sui browser in uso; un editor da 300 righe è più auditable di una libreria per una textarea formattata. Paste forzato in testo piano: la whitelist la applica comunque il server.
- **Sanitizer server-side whitelist-only** (`sanitizeEmailHtml`): tag ammessi in Set chiuso, attributi solo `href` su `a`, `href` solo http(s)/mailto (javascript:/data: = buttati), blocchi pericolosi (script/style/iframe/…) rimossi CON il contenuto. Il client non è fidato: l'editor produce HTML comodo, la sicurezza avviene in `createTicketAction`.
- **`htmlToEmailText`** converte l'HTML formattato in testo piano leggibile (elenchi → `- `, paragrafi → righe vuote): testo e HTML parlano sempre dello stesso contenuto.
- **Sincronizzazione tab→hidden**: il valore inviato cambia formato con la tab (Testo = sorgente letterale via `textContent`, Visuale = HTML whitelisted); i cambi tab sincronizzano con formato esplicito perché il closure vede ancora il `mode` precedente al commit React.

### Verifiche
- Browser: bold/link/liste via execCommand, round-trip Visuale→Testo→Visuale con HTML scritto a mano renderizzato, contatore parole, tab corrette.
- Sanitizer testato su payload ostile: script/onclick/style/javascript:/img rimossi, testo e link buoni conservati.
- `typecheck` ✓ · `build:local` ✓.

---

## [Email come canale ticket] — 2026-09-25 · il ciclo completo del CRM (case = ticket)

### Aggiunto
- **L'email entra nel ticketing**: le email in casella diventano ticket (canale `email`) via `ingestEmails` — dedup sul Message-ID (stessa email scaricata due volte non crea due ticket), coda `email_ingest` con stato di lavorazione.
- **Il filo del thread**: le risposte del cliente con oggetto «Re: [#N] …» finiscono DENTRO il ticket #N come messaggi (`messages.email_message_id`), non aprono ticket nuovi; il ticket torna «aperto» con SLA riarmato.
- **Risposta via SMTP reale**: rispondere a un ticket email invia l'email al cliente con oggetto «[#N] oggetto» e firma; esito in audit (`ticket.risposta_email` / `ticket.risposta_email_errore`).
- **Nuovo ticket via email** (il gesto da CRM): bottone «Nuovo ticket» nella inbox → `/admin/tickets/new` → il caso nasce con la prima risposta inviata via SMTP; il cliente risponde dalla sua casella e il ticket si alimenta da solo.
- **Cron**: blocco 6 del tick — polling email con dedup idempotente, disattivabile (`email_polling.enabled=false`); sync manuale con «Sincronizza email» nella inbox (esito in query string e audit).
- **Contesto nel dettaglio**: email del richiedente cliccabile e pillola «via email / via chat» nella barra contesto.
- Migration 023: `conversations.contact_email`, tabella `email_ingest` (dedup, errori, ticket_id), `messages.email_message_id` con indice.

### Deciso
- **Case = ticket, email = canale**: come in Zendesk/Freshdesk il caso è SEMPRE un ticket; l'email è solo il mezzo con cui il cliente lo alimenta. Il ticket email vive nelle stesse code, filtri, SLA e audit dei canali chat — nessuna logica parallela.
- **Dedup sul Message-ID** (header RFC 5322), non su flag IMAP: la casella resta intoccata (read-only), ri-eseguire il polling non duplica nulla, più caselle possono alimentare la stessa coda in futuro.

---

## [Strumento email] — 2026-09-25 · server SMTP/IMAP collegato da /admin/tools

### Aggiunto
- **Sezione «Posta elettronica»** in `/admin/tools`, sotto il Google Growth Kit: due card operative (Invio · SMTP, Ricezione · IMAP) con stato di configurazione, form di configurazione server e test di connessione live.
- **Preset provider** (in `email-tools-shared.ts`, client-safe): Personalizzato, Gmail/Google Workspace, Aruba, Register.it, Outlook/Microsoft 365, Zoho Mail — un click compila host e porte giuste (587 STARTTLS invio, 993 SSL ricezione). I provider italiani coprono i casi d'uso tipici dell'agenzia.
- **Credenziali cifrate**: la password va via form e muore nel save — cifrata AES-256-GCM (stessa `encryptKey` delle chiavi AI/Notion/Google), conservata in `content_settings` (`email_tools`), mai restituita al client che vede solo un hint mascherato (`in••••••rd`).
- **Test reale, non solo verify**: «Testa e invia» verifica SMTP (`transport.verify()`), INVIA una email di prova all'indirizzo indicato (default: l'email dell'agenzia) e apre+chiude IMAP — l'esito di entrambi compare nella pagina e nell'audit (`email-tools.test`).
- **Invio via `sendEmailViaTools`** e **ricezione via `fetchInbox`** (ultimi 10 messaggi INBOX, sola lettura) pronti per i flussi futuri (risposte email dei clienti nel ticketing, sequenze di outreach).

### Deciso
- **SMTP+IMAP con nodemailer/imapflow invece di Resend**: Resend (già usato per le notifiche) invia ma non riceve; lo strumento serve a COLLEGARE il server di posta dell'agenzia con le sue caselle reali (Aruba, Register…), quindi protocolli standard. Resend resta per le notifiche interne.
- **Client/server split** (`email-tools-shared.ts`): preset e tipi vivono in un file senza dipendenze server — il pannello client non trascina pg/nodemailer/imapflow nel bundle (stesso pattern dei temi; il build iniziale falliva con `Module not found: fs`).
- **Sola lettura su IMAP** (`readOnly: true`): il test e la lista non toccano flag né spostano messaggi — la casella reale resta intatta finché non esiste un flusso di ingest dedicato.

### Verifica
- Browser: pannello renderizzato sotto il Google kit, preset Aruba compila smtp.aruba.it:587 / imap.aruba.it:993 al click, campi credenziali con password type=password, form di test con destinatario opzionale.
- `npm run typecheck` ✓ · `npm run build:local` ✓
- Test di connessione eseguibile solo con credenziali reali: la logica è verificata (verify/send/mailboxOpen), il campanello suona davvero appena l'agenzia inserisce il suo account.

---

## [Inbox a due livelli] — 2026-09-25 · triage per canale + pagina ticket dedicata

### Aggiunto
- **Modello a due livelli stile Zendesk/Freshdesk**: la inbox (`/admin/tickets`) è una pagina di TRIAGE — si scandisce e si decide; la pagina `/admin/tickets/[id]` è il ticket COMPLETO a tutta pagina, con conversazione dominante e tutti gli strumenti (gestione, composer, lead, note). Separare i livelli restituisce la cognizione del ticket: l'inbox resta stabile mentre il dettaglio lavora.
- **Tab canali** nella inbox, data-driven da `conversations.channel` (migration 021): «Tutti i canali» + una tab per canale con conteggio (`countTicketsByChannel`, GROUP BY — un canale futuro compare da solo). `listTickets` accetta il filtro canale (validato contro i valori del DB, mai interpolato dal client).
- **Lista di triage a tutta larghezza**: righe compatte con numero stabile a sinistra, oggetto + badge attesa/SLA, canale · richiedente · messaggi · data su una riga, pill stato/priorità nascoste su mobile, freccia di affioramento al hover. Il gesto primario è APRIRE: la card intera è il link alla pagina dedicata.
- **Pagina dettaglio dedicata**: back-link «Torna alla inbox», header con permalink contestuale, gestione (priorità/stato/callback) su una riga, barra contesto, conversazione Live + composer, colonna strumenti (lead + note) sticky su xl a 300px.

### Modificato
- I vecchi link `/admin/tickets?t=…` ridirigono a `/admin/tickets/<id>`: nessun bookmark si rompe.
- Il «Nascondi ticket» in inbox appare solo al hover della card (in dettaglio non serve: c'è il back-link).
- Il dettaglio non è più annidato nella inbox: la pagina inbox è passata da ~550 a ~330 righe, il dettaglio vive in `/admin/tickets/[id]/page.tsx`.

### Deciso
- **Due livelli invece di list+detail sulla stessa pagina**: le tre versioni precedenti (lista 340px, coda 256px con dettaglio accanto) facevano competere triage e conversazione per lo stesso spazio — l'operatore perdeva il contesto cambiando ticket. Zendesk Agent Workspace separa esplicitamente «views» (code) e «ticket» (workspace): qui la stessa scelta, adattata al browser.
- **Canale come tab, non come colonna**: dividere le code per canale (chat/WhatsApp/email futuro) è il modello Freshdesk; l'utente ha chiesto esplicitamente la divisione per canale. La tab è data-driven perché WhatsApp arriverà senza modifiche UI.

### Verifica
- Browser desktop 1440px: inbox di triage (tab canali, 12 card, header bucket senza ripetizioni), dettaglio a tutta pagina (griglia 788+300px, chat 522px, 11 bolle).
- Flusso completo: inbox → click card → dettaglio → «Prendi in carico e rispondi» (focus composer) → back → inbox con filtri intatti.
- Mobile 390px: nessun overflow, strumenti impilati, composer raggiungibile.
- Ricerca preserva canale e filtro; redirect legacy ?t= verificato.
- `npm run typecheck` ✓ · `npm run build:local` ✓ · `git diff --check` ✓

---

## [Grafica ticketing] — 2026-09-24 · Prompt 1–7 di PROMPT-GRAFICA-TICKETING.md

### Aggiunto
- **Lista**: raggruppamento per data (Oggi/Ieri/Questa settimana/Prima) con intestazioni leggere sui dati già caricati, avatar assegnatario con iniziali e tinta stabile per nome (tratteggiato se non assegnato), selezione decisa (bordo pieno + barra di accento laterale), `tabular-nums` sui numeri.
- **Dettaglio**: barra contesto sotto l'header (richiedente cliccabile, provenienza, apertura, messaggi, SLA); `MessageBubble` unico con bolle asimmetriche e agente su brand tenue (testo scuro, legge meglio); skeleton di caricamento a bolle; empty state istruttivo.
- **Composer**: auto-resize fino a ~12 righe, contatore caratteri (4000) con avviso sopra il 90%, hint scorciatoie, ⌘/Ctrl+Invio invia da qualunque posizione.
- **Micro-interazioni** (Prompt 6, tutte sotto prefers-reduced-motion): fade+rise 150ms sui messaggi nuovi (solo post-mount: niente stroboscopio al polling), pop del badge «Attende risposta», puntino pulsante sui badge SLA scaduti.
- **Documenti**: `DESIGN-AUDIT.md` (inventario token, 7 difetti corretti, residui) e `UI-REVIEW-FINALE.md` (10 punti forti, 10 difetti residui con fix minimo, verdetto).

### Modificato
- **Semantica SLA**: gli stati «tutto ok» («entro SLA», «palla dal cliente», «attivo») passano da verde a neutro slate — il colore è riservato a ciò che richiede azione (ambra/rosso). Verde/ambra/rosso invariati per scadenze.
- **Coerenza**: `whitespace-nowrap` sui badge della coda stretta (niente più righe spezzate), `tabular-nums` su callback e audit, sidebar lead/note sticky su xl.

### Deciso
- **Nav orizzontale mantenuta** (Prompt 2): la sidebar verticale collassabile di Zendesk non regge 12 voci a 320px; la nav a due file esistente con pillola che scivola è già la shell corretta per questa scala. La «workspace shell» a 3 zone con scroll indipendente esiste ed è stata completata (sidebar sticky).
- **Bolle chat come classi semantiche** (`.bubble-visitor`/`.bubble-operator`): le superfici chiare esplicite non passano dai token e in dark diventavano illeggibili (1.01:1 misurato); l'override dark sui token porta cliente a 16.66:1 e agente a 12.03:1.

### Verifica
- Browser desktop 1440px: griglia 256px+832px, chat 522px visibile sopra la piega, raggruppamento e avatar a colpo d'occhio.
- Browser mobile 390px: dettaglio prima della coda, nessun overflow orizzontale, badge su una riga.
- Dark mode: bolle verificato con contrasto reale; light invariato dove non richiesto.
- Composer testato nel browser: auto-resize, contatore e reset funzionanti.
- `npm run typecheck` ✓ · `npm run build:local` ✓ · `git diff --check` ✓

---

## [Google Growth Kit] — 2026-09-24 · strumenti e configurazione Apple-style

### Aggiunto
- `/admin/tools` ora presenta Google Analytics 4, Tag Manager, Search Console e PageSpeed in card operative con stato, descrizione, link diretto e azione contestuale.
- Nuovo pannello «Configurazione avanzata» con campi GA4, GTM, token Search Console, Clarity e Google API key per PageSpeed.
- La Google API key viene cifrata server-side con lo stesso AES-256-GCM già usato per le chiavi AI/Notion; il browser vede solo un hint mascherato.
- I valori salvati nel DB diventano la configurazione runtime del tracking, sempre subordinato al consenso cookie.
- Test PageSpeed mobile eseguibile dal pannello, con risultato riportato nella pagina e audit dell'azione.
- Ristrutturata la sezione in «growth kit», strumenti locali e checklist di lancio, mantenendo i token Apple/Glass esistenti.

### Verifica
- `npm run typecheck` ✓
- `npm run build:local` ✓
- Browser: `/admin/tools` renderizza card, stati, form API key e checklist senza errori applicativi.

---

## [Accento tema] — 2026-09-24 · hover link e dettagli CTA

### Aggiunto
- Il picker «Colore accento» ora alimenta davvero il tema: il valore viene normalizzato in tripletto RGB sia nella preview live sia nel layout server-side.
- I link con hover brand adottano l'accento scelto al passaggio del mouse.
- I bottoni e i link CTA con superficie brand mostrano un ring/glow accentato, mantenendo invariati il colore primario e il contrasto del testo.
- Classic e Zendesk hanno fallback accent dedicati, quindi il comportamento è coerente anche senza personalizzazione.

### Verifica
- Preview live del picker verificata su Classic e Zendesk.
- Persistenza server-side verificata con `themeVars()`.
- `npm run typecheck` ✓
- `npm run build:local` ✓

---

## [Dark mode] — 2026-09-24 · terzo tema come override dei token

### Aggiunto
- **Modalità scura** selezionabile da `/admin/tools` accanto ai temi Classic e Zendesk Glossy: è una dimensione ortogonale (`light`/`dark`), non un terzo sistema di componenti.
- **Override token-only** in `globals.css`: neutri Slate, superfici, aurora, bordi e ombre vengono sostituiti tramite variabili CSS; i componenti non richiedono varianti dark dedicate.
- **Scala brand leggibile in scuro**: `adjustScaleForDark()` corregge la luminanza della scala primaria personalizzata mantenendo hue e saturazione.
- **Persistenza server-side** del modo in `content_settings.site_theme`, applicata dal layout su `<html data-theme data-mode>` senza flash; anche la `themeColor` del viewport segue la configurazione.
- **Anteprima live** nell'editor tema e supporto per entrambe le combinazioni Classic dark e Zendesk dark.

### Deciso
- La dark mode riusa i due temi esistenti: Classic mantiene il vetro e Zendesk mantiene la direzione Garden, mentre solo i token di superficie e contrasto cambiano.
- Le semantiche di stato (verde, ambra e rosso) restano invariate per non alterare il significato operativo dei ticket.

### Verifica
- `npm run typecheck` ✓
- `npm run build:local` ✓
- Verifica browser eseguita su Classic dark e Zendesk dark, inclusi contrasto, fondo aurora, card, navigazione e superfici.

---

## [Notion configurabile + Sistema di temi] — 2026-09-24 · PROMPT-NOTION-CONFIGURABILE.md e PROMPT-TEMI-GRAFICI.md

### Notion — l'integrazione diventa configurabile in tutto (Fasi 0–4)
- **Fase 0**: `REPORT-NOTION-AUDIT.md` — inventario di tutto ciò che era cablato (mapping 11 proprietà, titolo `«name · phone»`, sorgente, batch 20, sync solo manuale, nessuna coda/retry/log) e roadmap.
- **Migration 022**: `notion_settings.sync_config jsonb` (default = comportamento odierno, byte-identico) + **coda persistente `notion_sync_queue`** con `unique(entity, record_id)` → mai doppioni.
- **Motore di mapping** (`notion-config.ts`): tipi Notion (title/rich_text/select/multi_select/number/url/date/checkbox/email/phone_number), transform in whitelist (`mappa_sorgente`, `solo_http`, `iso8601`, troncamento `maxLen`), template titolo con placeholder e fallback (un render «solo separatori» conta come vuoto), `sanitizeSyncConfig` che scarta ogni input invalido. La config è l'unica source of truth: `NOTION_LEAD_PROPERTIES` resta come documentazione dei nomi di default.
- **Coda affidabile** (`notion-queue.ts`): enqueue non bloccante con payload precalcolato dal motore (la coda non rilegge il record), drain con rate limit Notion (≥350ms tra chiamate = 3 req/s), retry esponenziale, **gestione 429 con `Retry-After`**, errori permanenti (400/404) senza retry inutili. I fallimenti definitivi restano nel sync log con l'errore: niente buttato via. L'idempotenza resta su `leads.notion_synced_at`.
- **Trigger `on_create`** (default **off**, come il CONFIG): sia il lead dal widget (`/api/lead`) sia quello di Ambrosio (`salva_lead`) accodano il nuovo record se la config lo chiede — sempre non bloccante.
- **`/admin/notion` completo**: editor mapping (campo DB → proprietà, tipo, transform, righe aggiungibili), template titolo + fallback, mapping Sorgente, batch/retry, checkbox onCreate/onUpdate, **dry-run** (payload JSON che verrebbe inviato, senza chiamare l'API), **sync log** con entità, tentativi ed errore per record, bottoni per tickets/callbacks (Fase 4: spenti di default — nessuna chiamata API se non si attiva la config).

### Temi — Classic + Zendesk Glossy, colori personalizzabili (Prompt 1–3)
- **Motore di token** (`globals.css`): brand come tripletti rgb su `:root/[data-theme="classic"]` (valori copiati identici → **resa attuale invariata**), superfici vetro, fondo aurora, raggi e ombre parametrici. `tailwind.config.ts` legge i token con `<alpha-value>` (le opacità Tailwind tipo `bg-brand-600/90` continuano a funzionare e seguono il tema). Semantiche verde/ambra/rosso di stato NON personalizzabili (leggibilità).
- **Tema «Zendesk Glossy»**: solo override di token — fondi Garden piatti bianchi, bordi netti #d8dcde, testo kale #2f3941, raggi 10/8/4px, ombre quasi assenti, primary #1f73b7; tocco Glossy Apple (bordo-luce interno, bottone con highlight, blur 10px sui pannelli sticky, alone brand 7% nel fondo).
- **Sezione «Tema grafico» in `/admin/tools`**: selettore con mockup CSS puri, picker primario/accento, strip della scala 50–950 derivata (`brandScale()` HSL pura in `theme-shared.ts`, importabile client — pg resta fuori dal bundle), **avviso contrasto AA** (luminanza relativa calcolata in TS: bianco su #e67e22 → «2.85:1 < 4,5:1»), **anteprima live** via CSS vars su `documentElement`, salvataggio esplicito con `saveThemeAction` → `content_settings` key `site_theme` + `revalidatePath("/", "layout")`.
- **Root layout server-side**: `<html data-theme style=vars>` letto da `getSiteTheme()` (pattern `getSlaPolicy`, fallback degradato) → zero flash, il tema è UNO e globale (sito + admin).

### Deciso
- **Client/server split** (`notion-config-shared.ts`, `theme-shared.ts`): i componenti client importano solo tipi e funzioni pure — `db`/pg non entrano nel bundle browser (il build iniziale falliva con `Module not found: net`).
- **Bug fix scoperto dal test**: la mappa select veniva applicata due volte (transform, poi di nuovo in `selectValue` sul valore già tradotto) → il default `"*"` soprascriveva «Ambrosio AI». Ora la mappa si applica una sola volta.
- `PROMPT-AMBROSIO-AI.md`, `PROMPT-NOTION-CONFIGURABILE.md` e `PROMPT-TEMI-GRAFICI.md` sono ora tutti eseguiti e documentati: i tre file possono essere rimossi dalla repo (restano il CHANGELOG e i REPORT).

### Verifica
- Motore Notion testato con le funzioni reali: **payload default byte-identico** alle 11 proprietà odierne (criterio di «fatto» Fase 1), titolo custom, fallback, sanitize, scala colori ✓.
- Browser: login admin di test (poi rimosso), dry-run mostrato con il lead reale (titolo «Marco Bianchi · 349 …», Sorgente «Ambrosio AI», data ISO), tema Zendesk attivo all'istante su tutta la pagina, tema+arancione salvati e riapplicati server-side (verificato via curl su `/`), ritorno a Classic con colori default. Typecheck e build puliti.

---

## [Ambrosio Fase 5] — 2026-09-24 · Statistiche dei tool per lingua e canale

### Aggiunto
- **`getToolUsageStats`** (in `ai-tools.ts`): aggrega l'audit log (`actor='ambrosio@ai'`, azioni in whitelist, finestra configurabile default 30gg) con join su `conversations` per lingua e canale. Nessuna nuova tabella da tenere allineata: l'audit è già scritto da ogni azione eseguita ed è append-only, quindi le cifre sono **azioni confermate**, non falsabili dal modello.
- **Card «Azioni di Ambrosio»** in `/admin/ai` (sotto l'uso delle FAQ): riepilogo per funzione (Lead salvati / Callback fissate / Priorità alzate / Note al team / Handoff), ripartizione per lingua con bandierine e per canale (Chat web / WhatsApp). Empty state onesto: spiega cosa comparirà e perché le verifiche di sviluppo restano nell'audit completo.
- Loop di miglioramento continuo chiuso (Fase 5 del prompt): FAQ → conversioni (già presente) + azioni → lingua/canale (questa fase).

### Deciso
- **Audit log come fonte unica** invece di una tabella contatori: zero doppie scritture, immutabilità garantita dalle RULE anti-UPDATE/DELETE, e le azioni di verifica restano distinguibili per target. Contro: il join con `conversations` mostra la lingua/canale **attuale** della conversazione, non quella al momento dell'azione — accettato: è esattamente ciò che la dashboard deve mostrare («come si comporta Ambrosio per lingua/canale»), non un report forense.
- **Le righe audit orfane** (conversazione cancellata, es. ticket vuoti archiviati) contano nei totali come `it/web`: è il fallback conservativo, non un errore.

### Note operative
- Verificato con fixture minima (azioni di test + conversazioni en/de/whatsapp): aggregazione corretta per lingua, canale e funzione; il confronto col conteggio diretto dell'audit ha confermato che i numeri includono anche le azioni reali delle verifiche Fase 1 (append-only: restano come traccia onesta). Build isolata OK, typecheck pulito.
- **Traduzioni EN+DE seminate**: `scripts/seed-faq-translations.mjs` (idempotente, riconosce le FAQ per domanda normalizzata, fa merge delle lingue preservando en/de/es già presenti) scrive le traduzioni ufficiali inglese e tedesco delle 11 FAQ — fedeli all'italiano, prezzi invarianti (€800 / €1,500 / ab 800 € / 1.500 €), inviti alla call adattati senza promesse nuove. Rieseguire dopo ogni modifica a una risposta italiana.

**Roadmap Ambrosio completa** (F1 tool use, F2 follow-up, F3 multilingua, F4 WhatsApp-ready, F5 statistiche): `PROMPT-AMBROSIO-AI.md` è ora eliminabile — tutte le decisioni vivono qui nel CHANGELOG e in `REPORT-AMBROSIO-AI.md`.

---

## [Ambrosio Fase 4] — 2026-09-24 · Predisposizione WhatsApp (architettura, non attivazione)

### Aggiunto
- **Layer messaging** (`src/lib/messaging.ts`): interfaccia `ChannelAdapter` (`inbound`/`reply`), validazione canali a livello app, `adapterFor(channel)`. La web chat esiste come `webAdapter` (le route chat restano il percorso reale); WhatsApp è `whatsappAdapter` con l'implementazione reale della Cloud API già scritta ma **inerte** finché le credenziali non esistono.
- **`CHANNEL_POLICY` per canale** (vincoli WhatsApp pre-ingestiti): finestra customer care (web: illimitata; WA: **24h**), lunghezza massima in uscita (WA: 4096), markdown pesante (web: sì; WA: **no** — spogliato da `formatForChannel`), business-initiated (web: sì; WA: **no** — fuori finestra solo template Meta approvati, e il percorso non esiste ancora).
- **E.164 condiviso web+WhatsApp** (`toE164`): lo stesso numero al telefono è lo stesso cliente, qualunque canale abbia scritto. Ritorna null sui numeri non normalizzabili (meglio null che un dedup sbagliato). Colonna `leads.wa_phone` + indice parziale per il dedup futuro.
- **Opt-in separati** (privacy: due consensi distinti): `leads.consent` (essere richiamati) e `leads.whatsapp_opt_in` + `whatsapp_opt_in_at` (ricevere su quel canale).
- **`whatsapp_config`** (migration 021): phone_number_id, verify_token, token cifrato AES-256-GCM (stessa `encryptKey` delle chiavi AI), `enabled` default **false**.
- **Card «WhatsApp Business (predisposto)»** in Impostazioni: checklist di cosa è pronto e cosa manca (credenziali Meta, webhook), attivazione deliberatamente bloccata.
- **Il follow-up Fase 2 passa dal layer**: `sendLeadFollowup` ora interroga il canale e rispetta `canSendFollowup` — quando esisterà WhatsApp, il follow-up business-initiated sarà automaticamente bloccato lì dalla policy, senza toccare il cron.

### Deciso
- **Predisposizione, non attivazione** (regola del prompt): nessun webhook Meta, nessun credito speso, `enabled=false`. Collegare WhatsApp domani = creare l'account, inserire le credenziali, scrivere il webhook che chiama `adapterFor("whatsapp").inbound()` — zero modifiche al cervello di Ambrosio.
- **Validazione canali a livello app, non CHECK constraint**: aggiungere un canale futuro (es. Telegram) non richiederà una migration. Compensato da `isChannel()` su ogni ingresso.
- **L'adapter WA fallisce in silenzio senza credenziali** (`whatsapp_non_attivo`): impossibile spendere crediti o inviare messaggi per errore.

### Note operative
- Verificato: 20/20 test su policy, E.164, format per canale, gate follow-up e adapter WA inerte (con funzioni reali via tsx). Criterio di «fatto» del prompt: web chat indistinguibile da prima — tutte le 35 conversazioni esistenti sono `channel='web'`, un insert senza channel esplicito produce `web`, `whatsapp_config` parte `configured=false, enabled=false`.

---

## [Ambrosio Fase 3] — 2026-09-24 · Multilingua nativo (it/en/de/fr/es)

### Aggiunto
- **Rilevamento lingua** (`src/lib/language.ts`): punteggio su stopwords per lingua con margine netto sul secondo posto e soglia minima — sotto soglia, italiano. Solo 5 lingue gestite; il default conservativo evita di sbagliare lingua su testi ambigui o corti.
- **`conversations.language`** (migration 020, default `it`): rilevata dalla prima risposta non-italiana e **sticky** per tutto il thread — un "ok ok" a metà conversazione non riporta il cliente all'italiano.
- **Il divieto «Rispondi SOLO in italiano» è stato eliminato** dal prompt di sistema: ora Ambrosio risponde nella lingua del cliente, con le regole commerciali invariate in ogni lingua (prezzi e nomi pacchetti restano identici; mai inventare in nessuna lingua).
- **FAQ con traduzioni** (`ai_faqs.translations jsonb`, migration 020): l'italiano resta la fonte di verità; le traduzioni en/de/fr/es sono usate nel prompt se presenti (blocco "OFFICIAL Q&A" localizzato), altrimenti il modello parafrasa l'italiano nella lingua del cliente. Sanitizzazione lato server: solo chiavi ammesse, stringhe non vuote, max 2000 char.
- **Editor FAQ**: sezione «Traduzioni (opzionali)» con i 4 campi lingua e il pulsante **«Traduci con AI»** (`translateFaqAction` → `translateFaq`, JSON strict con estrazione da markdown fence, temperatura 0.2, prezzi NON convertiti di valuta). Bozze precompilate: il team verifica e salva — l'AI non pubblica. Badge 🌐 sulla FAQ tradotta.
- **Follow-up multilingue**: il messaggio del cron arriva nella lingua della conversazione (5 versioni scritte a mano, non tradotte al volo).

### Deciso
- **Euristiche conservative invece di librerie di detection**: 5 lingue note e un dominio di domande ristretto rendono sufficienti le stopwords; nessuna dipendenza nuova, comportamento ispezionabile. Falso italiano su testi ambigui è l'errore accettabile (il modello capisce comunque e risponde nella lingua giusta grazie all'istruzione di prompt).
- **Traduzioni FAQ opzionali e approvate dal team**: niente traduzione automatica in produzione — la bozza AI è un aiuto alla scrittura, non un canale. Coerente con la regola «niente allucinazioni commerciali».
- **Sticky language**: la lingua si rileva SOLO mentre la conversazione è italiana (default) e non si riconverte più; evita oscillazioni su messaggi misti.

### Note operative
- Verificato e2e con provider mock interno (poi rimosso): stessa domanda in 4 lingue → 4 risposte nelle 4 lingue, `language=en/de/fr/es` persistito su conversations, sticky confermata al secondo turno. FAQ con traduzione en iniettata nel blocco localizzato (confermato dal log del mock: scenario OFFICIAL Q&A). Fixture rimosse, Ambrosio rimessa OFF e senza chiavi.
- Nel «Prova dal vivo» non c'è lingua selezionabile: il test usa il blocco FAQ italiano (la lingua reale la decide il cliente in chat).

---

## [Ambrosio Fase 2] — 2026-09-24 · Follow-up unico ai lead spariti

### Aggiunto
- **Riattivazione lead nel cron** (blocco 5 di `/api/cron/tick`): il visitatore che ha lasciato un lead (consenso incluso) e poi è sparito riceve UN solo messaggio di Ambrosio nel thread della chat — lo ritrova riaprendo il widget. Testo caldo e senza pressione, con l'operatore del prossimo turno citato per nome ("Daniele del team può richiamarti…").
- **Criteri in AND** (tutti necessari): status `lead_captured` (nessun umano coinvolto), silenzio del **visitatore** > N ore dall'ultimo suo messaggio, ultimo messaggio del thread NON del bot (non interrompo una conversazione già seguita), `followup_sent_at is null`.
- **Impostazioni → «Follow-up ai lead spariti (Ambrosio)»**: ore di silenzio (default **ON 48h**, range 1–336, vuoto/0 = OFF), card dedicata con la stessa grafica delle altre automazioni; chiave `lead_followup_hours`; audit della configurazione.

### Deciso
- **Dedup esplicito con claim-first**: `conversations.followup_sent_at` (migration 019) viene marcato da `sendLeadFollowup` con UPDATE condizionata a `is null` — se due tick corrono in parallelo, uno solo vince; se l'insert del messaggio fallisce, il claim viene **rilasciato** (il peggior caso è un follow-up non partito, mai due messaggi: prima lo spam che il silenzio).
- **Il cron seleziona, la funzione marca**: la prima stesura marcava già nella query di selezione e poi tentava un secondo claim che falliva sempre (flag messo, messaggio mai inserito — beccato al primo test). La responsabilità unica del claim è nella funzione.
- **Ri-controllo a ridosso dell'invio**: tra la selezione e il claim il visitatore può essere tornato a scrivere; il follow-up parte solo se l'ultima parola è ancora sua. Se ha già risposto a un umano (status `operator`), mai.
- **Niente email/Telegram per il follow-up**: è un messaggio nel thread, non un avviso al team; il lead resta comunque visibile nella pipeline e il team viene notificato come sempre alla cattura del lead.

### Note operative
- Verificato con 4 fixture realistiche (target 50h, sotto soglia 10h, operator 60h, ultimo=bot 60h): 1 solo follow-up sul target, zero sugli altri; tick ripetuti → `leadFollowup: 1 → 0` (idempotente); audit `system | cron.lead-followup`. Fixture rimosse.

---

## [Ambrosio Fase 1] — 2026-09-24 · Tool use: Ambrosio agisce, non solo risponde

### Aggiunto
- **`src/lib/ai-tools.ts`**: whitelist di 5 funzioni che Ambrosio può chiamare in conversazione — `salva_lead`, `fissa_callback`, `aggiorna_ticket` (solo alzare), `nota_interna`, `handoff`. Protocollo testuale provider-agnostico: il modello emette un blocco `<tool>{"fn":...,"args":{...}}</tool>` in fondo alla risposta; il parser lo separa dal testo per il cliente, la route valida ed esegue. Funziona con tutti i 6 provider (niente tool-use nativo richiesto).
- **Validazione server-side di ogni input**: il telefono è validato dal server (E.164/nazionale via `extractPhone`), il consenso DEVE essere `true` perché il contatto sia salvato, gli slot callback passano per `slotToDate` (solo turni reali 9-13/15-19), la priorità è solo alzabile (rank bassa<normale<alta<urgente). Nessuna azione distruttiva esiste nella whitelist.
- **Audit `ambrosio@ai`**: ogni funzione eseguita finisce in `audit_log` con actor `ambrosio@ai` (`ambrosio.salva_lead`, `ambrosio.fissa_callback`, `ambrosio.aggiorna_ticket`, `ambrosio.nota_interna`, `ambrosio.handoff`) — distinta dalle azioni umane e da quelle del cron.
- **`Prova dal vivo` mostra l'azione**: se il modello richiede una funzione nel test, la query string del test la mostra (senza eseguirla: il test non ha conversazione dietro).

### Modificato
- `ambrosioReply` ora restituisce anche `cleanReply` e `toolCall`; la risposta persistita come messaggio bot è già pulita del blocco JSON (il cliente non vede mai il protocollo).
- La route `/api/chat/ai` esegue il tool DOPO la risposta al cliente; un `salva_lead` riuscito ora pone `leadSaved=true` nel payload (la chat sa che la qualificazione è chiusa). L'estrazione regex pre-esistente resta come rete di sicurezza a valle (il tool è il percorso primario, la regex il fallback) — nessun doppio salvataggio: il tool controlla `lead_id` già presente.
- `fissa_callback` richiede un lead con consenso già salvato sulla conversazione: senza consenso la callback è negata (privacy prima di tutto).

### Deciso
- **Parser testuale invece di tool-use nativo del provider**: la catena multi-provider include provider senza supporto `tools`; un protocollo unico testuale è verificabile e provider-agnostico. Contro: nessuna conferma strutturata dal provider. Mitigazione: validazione severa + rifiuto silenzioso di tutto ciò che non combacia.
- **Mai bloccante confermato anche per i tool**: un errore di esecuzione è loggato e la risposta testuale resta intatta (stessa filosofia del fallback provider e del tracking FAQ).
- **Nessuna migration**: `ticket_notes` (migration 003) accetta `author_email` testuale, quindi Ambrosio firma le note con `ambrosio@ai`; lo status `operator` esisteva già per l'handoff.

### Note operative
- Verifica e2e: 5 turni via `/api/chat/ai` con provider mock interno (route temporanea poi rimossa) → lead inglese salvato con consenso, callback "Domani alle 09:00" fissata, priorità normale→urgente, nota interna riepilogo, handoff al team. Tutte le azioni in audit; dati di test ripristinati; Ambrosio rimessa OFF come prima.
- Ambrosio resta **disattivata e senza chiavi**: i tool scattano solo quando è accesa.

---

## [Fase 2] — 2026-09-24 · Cron e automazioni temporali

### Aggiunto
- **`/api/cron/tick`** (protetto da `CRON_SECRET` o user-agent Vercel Cron; `vercel.json` con tick ogni 15 minuti): quattro automazioni temporali che scattano anche se nessuno apre l'admin.
- **SLA «scade presto»**: avviso quando mancano meno di 25 minuti alla scadenza del clock dell'agente (flag `sla_warned_at`).
- **SLA «scaduto»**: breach con avviso (flag `sla_breached_at`).
- **Callback mancate**: le `pending` con orario passato da oltre un'ora diventano `missed` + avviso — un impegno preso in chat non sparisce più nel silenzio.
- **Chiusura automatica opzionale**: configurabile in Impostazioni (giorni di silenzio del cliente; default **OFF** come da roadmap), eseguita dal cron con audit.
- **Banner «Da richiamare»** sulla dashboard: i lead con `ricontatta_il` arrivato (o passato) diventano promesse visibili da mantenere.

### Deciso
- **Idempotenza con flag persistenti, non con «visto di recente»**: `sla_warned_at`/`sla_breached_at` sulla riga del ticket; ri-eseguire il tick non duplica notifiche (verificato con tick consecutivi: 1→0→0). I flag si riarmano quando il clock si riarma (nuovo messaggio del cliente).
- **Il cron non inventa l'orario di lavoro**: la soglia «25 minuti» rende operativo ciò che il badge mostra già in lista; il calcolo in business hours resta Fase successiva (roadmap 4.x) e non è stato anticipato.
- **Le azioni della macchina sono distinte**: audit con `actor='system'` (`cron.sla-warn`, `cron.sla-breach`, `cron.callback-missed`, `cron.auto-close`) — verificato che compaiono separati da quelli umani.
- **Auto-close ripristinabile**: la riapertura automatica della Fase 1 riporta in coda un ticket chiuso dal cron se il cliente risponde — il ciclo si chiude.
- **Trigger `updated_at` e test**: la fixture del test auto-close ha dovuto disabilitare temporaneamente `conversations_touch` (il trigger rinnova `updated_at` a ogni UPDATE): è il comportamento corretto in produzione, dove il cron confronta con l'ultima attività reale.

### Note operative
- Su Vercel: configurare `CRON_SECRET` nelle env (Vercel invia il proprio user-agent, la chiave serve per l'invocazione manuale). In locale: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3200/api/cron/tick`.
- Le notifiche del cron usano gli stessi canali di sempre (Resend + Telegram): senza chiavi configurate le azioni avvengono comunque, solo l'avviso non parte.

---

## [Fase 1] — 2026-09-24 · Sanità del ciclo di vita

Implementata interamente e verificata nel browser (commit `1dd4794`).

### Aggiunto
- **Stati del ticket**: `waiting_customer` («In attesa cliente») e `on_hold` («In sospeso») si aggiungono ai 5 originali → il ciclo copre tutte le situazioni del benchmark.
- **Filtro «Da rispondere»** nella inbox con contatore dedicato: i ticket il cui ultimo messaggio è del cliente, in un click.
- **Riapertura automatica** (1.2): un messaggio del cliente su un ticket `closed` lo riporta attivo (`operator`), con clock SLA armati ed evento `system | ticket.riaperto` nell'audit.
- **SLA a tre orologi** (1.3): policy per priorità su due scadenze — «prossima risposta» (armata quando il cliente ha l'ultima parola) e «risoluzione» (dalla creazione). Il clock di primo contatto resta lo storico 2h/4h.
- **Editor policy SLA** in `/admin/settings` con validazione server e audit (`ticket.sla-policy`).
- **Notifica «il cliente attende»** (1.4): email (Resend) + Telegram con link al ticket quando l'ultimo messaggio è del cliente dopo una risposta umana.

### Deciso
- **La risposta dell'agente porta il ticket a «In attesa cliente»** (non più «In conversazione»): lo stato esplicito rende filtrabile ciò che il badge «attende risposta» deduceva solo dal `last_sender`. La vecchia label «In conversazione» resta disponibile a mano.
- **La palla decide i clock**: cliente scrive → clock agente armato con la policy della priorità; agente risponde → clock spento (non dobbiamo niente finché il cliente non riscrive). Prima stesura aveva la semantica invertita: corretta durante la verifica.
- **Dedup notifiche per fase di attesa** (`awaiting_notified_at`): messaggi consecutivi del cliente = un avviso solo; riarmo esclusivamente alla risposta umana. Scoperto in verifica che il primo schema rinotificava: fixato e riprovato con 4 messaggi di fila.
- **Notifica solo dopo la prima risposta umana**: prima di quella il flusso è del bot/Ambrosio — avvisare di notte per ogni «quanto costa?» sarebbe rumore.
- **Migration 017 additive** (`sla_next_reply_due`, `sla_resolve_due`, `awaiting_notified_at` + indice parziale): nessuna rottura, ticket esistenti validi con clock null.

### Note operative
- Le chiavi `TELEGRAM_BOT_TOKEN`, `RESEND_API_KEY`, `NOTIFY_EMAIL` in `.env.local` sono segnaposto: la logica è verificata, il campanello suona davvero appena inserite le credenziali.
- L'audit è append-only (RULE SQL): le voci delle verifiche fatte sul ticket #15/#42 restano nel log per progetto.

---

## [Fase 0] — 2026-09-23 · Audit e roadmap (commit `4618094`)

### Aggiunto
- `REPORT-STATO-ATTUALE.md` — inventario del ticketing: stack, 17 migration, 12 pagine admin, flussi, punti di forza, 12 fragilità.
- `GAP-ANALYSIS.md` — matrice benchmark Zendesk/Freshdesk (~60 voci): ~18 complete, ~14 parziali, ~28 assenti, con priorità e sforzo.
- `ROADMAP-UPGRADE.md` — 8 fasi incrementali con criterio di «fatto» verificabile per ogni voce.

### Deciso
- **Non riscrivere**: il repository contiene già un ticketing funzionante e ben costruito (regola operativa n. 1 del prompt di partenza).
- **Priorità P0** identificate: riapertura automatica, SLA «prossimo reply» con escalation, stato «in attesa cliente», notifica «attende risposta», macro con placeholder.
- **Fuori scala consapevole** (rileggere se il team cresce): organizzazioni/multi-brand, campi personalizzati, time tracking, ticket padre-figlio.
- **Feature flag** per i cambi invasivi; fasi 4–8 solo a conferma della precedente.

---

## Convenzioni per le prossime voci

- Una sezione per fase della roadmap, con sottosezioni **Aggiunto / Modificato / Deciso / Note operative** (solo quelle pertinenti).
- «Deciso» è il cuore del registro: annota il perché delle scelte, inclusi i ripensamenti — il perché si perde e non si recupera.
- Ogni voce cita la migration introdotta e il flag di configurazione, se esiste.
- Le date seguono l'ordine di consegna delle fasi, non i singoli commit.
