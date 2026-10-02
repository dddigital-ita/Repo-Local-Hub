# Web Agency Salento — sito hook «ricerca → chat → chiamata»

Lead generation per web agency nel Salento. Sembra un motore di ricerca: ogni ricerca apre una chat
a **script fisso** (niente LLM al primo contatto) che qualifica il lead, lo salva su Postgres (Neon)
e notifica l'operatore di turno, che richiama.

Progetto gemello di WebAgencyCrema: stessa architettura, stesso design system, contenuti e dati
completamente originali per il territorio salentino.

## Setup in 10 minuti

1. **Dipendenze**: `npm install`
2. **Database Neon**: progetto NUOVO su console.neon.com → copia la connection string →
   incollala in `.env.local` come `DATABASE_URL` (modello in `.env.example`)
3. **Schema**: SQL Editor di Neon → incolla `neon/schema.sql` → Run
   (crea tabelle + inserisce Daniele come operatore)
4. **Admin**: `npm run admin:create tua@email.com "PasswordLunga"`
   poi aggiungi `ADMIN_SESSION_SECRET` (una stringa a caso lunga) in `.env.local`
5. **Notifiche** (opzionale ma consigliato): `RESEND_API_KEY` + `NOTIFY_EMAIL` +
   `EMAIL_FROM`, e bot Telegram con `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
   (+ `TELEGRAM_WEBHOOK_SECRET` per il canale bidirezionale)
6. **Google**: `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_SEARCH_GSC_TOKEN`
   (proprietà NUOVE per il dominio Salento)
7. **Avvia**: `npm run dev` → la barra di ricerca apre la chat; i lead finiscono su Neon
8. **Deploy**: DOMINIO DEFINITIVO DA CONFERMARE — niente DNS, pubblicazioni o repository
   remoti senza esplicita conferma del cliente.

## Stato rebrand (Step 3, 2026-09-29)

- Brand, logo (lockup «WebAgency Salento» dal brand system), favicon, manifest: ✅
- Config centrale `src/lib/site.ts` con 17 landing SEO originali: ✅
- Riferimenti Crema/Michele rimossi da codice, test, seed e script: ✅
- Dati aziendali da fornire (vedi `AUDIT-RIFERIMENTI.md` §4): dominio definitivo, sede + P.IVA,
  ragione sociale, email, secondo operatore del team, social, prove/numeri reali,
  GA4/GSC/Telegram nuovi, DB Neon separato.
- Piano editoriale SEO: `PIANO-SEO-SALENTO.md`.

## Come funziona l'hook

- Home + 17 landing SEO (contenuti unici, JSON-LD LocalBusiness + Service + FAQPage + BreadcrumbList).
- La barra cerca «finto»: ogni query → `/consulenza?q=` → splash «Sto cercando…» con i consulenti
  **veri** del team e i turni → la chat si apre da sola citando la ricerca.
- Chat = script deterministico in `src/lib/chat-script.ts` (servizio → urgenza → sito esistente →
  budget → nome → telefono → consenso GDPR). Nessun dato salvato prima del consenso.
- Lead su Postgres (Neon) + email (Resend) + Telegram all'operatore. Se nessuno è in turno: callback
  con slot + email di conferma. Stato turno sempre visibile in chat.
- `/admin`: inbox conversazioni, pipeline lead + CSV, toggle disponibilità,
  strumenti Google con funnel 30 giorni.

## Telegram bidirezionale (Ambrosio sul bot)

Oltre alle notifiche one-way del team, il bot **risponde** a chi gli scrive: stesso
cervello di Ambrosio della web chat (`src/lib/ambrosio-turn.ts`), thread = ticket
nel CRM (`/admin/tickets`), handoff umano con le stesse regole. Setup:

1. Env: `TELEGRAM_BOT_TOKEN` (bot nuovo per il Salento) + `TELEGRAM_WEBHOOK_SECRET`
   (`openssl rand -hex 32`);
2. Registra il webhook (serve HTTPS):
   `node scripts/telegram-webhook.mjs <BOT_TOKEN> https://tuodominio/api/telegram/webhook $SECRET`
3. In sviluppo locale senza HTTPS: `TELEGRAM_POLLING=1` (il cron legge gli update
   con getUpdates; webhook e polling non convivono, l'env è una scelta esplicita).

Chi scrive al bot parla con Ambrosio fuori turno; con un umano in turno il messaggio
entra nel ticket e suona il campanello «cliente attende». Comandi: `/start` `/stato`
`/umano` `/stop`.

## Script utili

- `npm run dev` / `npm run build` / `npm run typecheck` / `npm test` / `npm run lint`
- `npm run admin:create` — primo utente admin
- `npm run db:migrate` — migrazioni Neon
- `npm run setup:local` — Postgres locale via Docker
- `npm run backup` — backup completo configurazioni

## Test

**Unit** (`npm test`, node --test su `tests/*.test.mjs`): dominio puro e sentinelle di coerenza
(sorgenti letti e verificati senza HTTP).

**E2E** (`npx playwright test`, Playwright su `tests/e2e/*.spec.ts`): flussi reali dal browser
contro il DB disposable `was_e2e` (server su :3100 via `scripts/e2e-dev-server.mjs`, ambiente
`.env.e2e`). Ogni spec semina righe marcate `/e2e-*` o `*@e2e.local` e le rimuove in afterAll:
`scripts/e2e-leak-guard.mjs` fallisce la run se qualcosa resta.

Registro delle spec E2E (la sentinella `tests/e2e-registry.test.mjs` fallisce se una spec manca
da questa lista o se la lista punta a file inesistenti):

| Spec | Copre |
|---|---|
| `backup-restore.spec.ts` | Difese RBAC su backup / restore / reset password |
| `callbacks-admin.spec.ts` | Coda callback `/admin/callbacks` (slot, email di conferma) |
| `chat-lead.spec.ts` | Chat lead-gen: qualificazione, consenso, salvataggio lead |
| `admin-listing-truncation.spec.ts` | Troncamento onesto nelle liste (leads/clients): notice «primi 200 su N» quando il KPI supera il limite, mai allarmi falsi su liste filtrate/non troncate |
| `clients.spec.ts` | Portafoglio clienti: filtri (aperti, budget), scheda `TicketQueueRow` con WhatsApp contestuale, nota persistente, sync Ambrosio da ticket nuovo |
| `consent-mobile-bar.spec.ts` | Banner cookie su mobile: barra sottile (<80px) con bottoni inline ≥40px, flusso di consenso intatto, banner completo invariato da `sm:` |
| `consent.spec.ts` | Consenso cookie GDPR |
| `lead-company-segments.spec.ts` | Segmento «tipo cliente» coeso tra dashboard, CSV ed export |
| `leads-admin.spec.ts` | Pipeline lead `/admin/leads` |
| `logout-prefetch.spec.ts` | Regressione footgun logout/prefetch |
| `manutenzione.spec.ts` | Modalità manutenzione |
| `password-reset.spec.ts` | Recupero password self-service |
| `prodlike-admin-skeleton.spec.ts` | Navigazione admin contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105): login, hub reali senza skeleton appeso, salvataggi (risposte rapide col TTL, tema) intatti, navigazione schede (card «Emoji della chat» in Canali, back-link, ⌘K) |
| `prodlike-cache.spec.ts` | Free cache contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105): 4 target, conferma a due fasi, audit e età della cache |
| `prodlike-captcha.spec.ts` | Captcha contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105) |
| `servizi.spec.ts` | Catalogo servizi (pacchetti) |
| `tickets-bulk.spec.ts` | Azioni bulk sulla coda `/admin/tickets` (parità gemello): checkbox+barra, «tutti» nell'header, selezione legata alla coda visibile, claim con/ senza operatore, guardie archive/close coi conteggi onesti e clock SLA fermi |
| `tickets-channel-empty.spec.ts` | Canale vuoto nella inbox `/admin/tickets`: tab attiva a 0 conversazioni, empty state (mai fallback silenzioso a «tutti»), filtro web funzionante, canale sconosciuto degrada esplicitamente |
| `tickets-search-edges.spec.ts` | Ricerca inbox: casi limite — wildcard `%`/`_` LETTERALI (100% → «100%», non «1000»), numero del ticket ESATTO, termine bianco inerte, zero risultati → empty state |
| `tickets-dashboard.spec.ts` | Dashboard ticket `/admin/tickets/dashboard` (KPI, filtri, uscite) |
| `tickets-inbox.spec.ts` | Inbox ticket `/admin/tickets` (CTA, filtri, card mobile, età, bottone Dashboard) |
| `tickets-mobile.spec.ts` | Inbox su 390×844: ZERO overflow orizzontale (header wrap), icona WhatsApp visibile e tappabile nelle card (≥36px, target=_blank), invarianti desktop 1280×800 |
| `tickets-pagination.spec.ts` | Paginazione coda ticket (URL come stato) |
| `turnstile-shield.spec.ts` | Captcha Turnstile + violazioni Shield |
| `utenti.spec.ts` | Ruoli utenti, Area personale |

Fuori dalla routine: solo `prodlike-admin-skeleton.spec.ts`, `prodlike-captcha.spec.ts` e `prodlike-cache.spec.ts` (in tabella, esclusi dalla config standard
via `testIgnore` — girano a mano contro un server di build).

**Routine di guardia prima di ogni commit che tocca aree admin:** suite unitaria + le spec E2E
delle aree toccate (es. ticket → `tickets-*` e `clients`; portafoglio → `clients`). Prima di un
bump/tag: la suite E2E completa.

## Modificare lo script chat

Tutto il testo della qualificazione è in `src/lib/chat-script.ts`: domande, bottoni, edge case
(«quanto costa?», «parlo con una persona»), informativa breve GDPR. Si modifica senza toccare
il controller della chat.

## Modificare contenuti e landing

Le landing vivono in `src/lib/site.ts` (`LANDINGS`): title, description, keyword, intro, servizi,
FAQ, proof e città di riferimento. L'admin (editor SEO) può sovrascrivere tutto da interfaccia,
con history delle versioni.
