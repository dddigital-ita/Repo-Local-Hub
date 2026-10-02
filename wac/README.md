# NOME_AGENZIA — sito hook «ricerca → chat → chiamata»

Lead generation per agenzia web a Crema. Sembra un motore di ricerca: ogni ricerca apre una chat
a **script fisso** (niente LLM al primo contatto) che qualifica il lead, lo salva su Supabase e
notifica l'operatore di turno, che richiama.

## Setup in 10 minuti

1. **Dipendenze**: `npm install`
2. **Database Neon**: progetto su console.neon.com → copia la connection string →
   incollala in `.env.local` come `DATABASE_URL` (modello in `.env.example`)
3. **Schema**: SQL Editor di Neon → incolla `neon/schema.sql` → Run
   (crea tabelle + inserisce Daniele e Michele come operatori)
4. **Admin**: `npm run admin:create tua@email.com "PasswordLunga"`
   poi aggiungi `ADMIN_SESSION_SECRET` (una stringa a caso lunga) in `.env.local`
5. **Notifiche** (opzionale ma consigliato): `RESEND_API_KEY` + `NOTIFY_EMAIL` +
   `EMAIL_FROM`, e bot Telegram con `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
   (+ `TELEGRAM_WEBHOOK_SECRET` per il canale bidirezionale, vedi sotto)
6. **Google**: `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_SEARCH_GSC_TOKEN`
7. **Avvia**: `npm run dev` → la barra di ricerca apre la chat; i lead finiscono su Neon
8. **Deploy**: push su GitHub → import su Vercel → stesse env (con dominio vero) → domina

Guida completa dominio + DNS + Google: **SETUP.md**.

## Come funziona l'hook

- Home + 10 landing SEO (contenuti unici, JSON-LD LocalBusiness + Service + FAQPage + BreadcrumbList).
- La barra cerca «finto»: ogni query → `/consulenza?q=` → splash «Sto cercando…» con i consulenti
  **veri** del team e i turni → la chat si apre da sola citando la ricerca.
- Chat = script deterministico in `src/lib/chat-script.ts` (servizio → urgenza → sito esistente →
  budget → nome → telefono → consenso GDPR). Nessun dato salvato prima del consenso.
- Lead su Supabase + email (Resend) + Telegram all'operatore. Se nessuno è in turno: callback
  con slot + email di conferma. Stato turno sempre visibile in chat.
- `/admin` (Supabase Auth): inbox conversazioni, pipeline lead + CSV, toggle disponibilità,
  strumenti Google con funnel 30 giorni.

## Telegram bidirezionale (Ambrosio sul bot)

Oltre alle notifiche one-way del team, il bot **risponde** a chi gli scrive: stesso
cervello di Ambrosio della web chat (`src/lib/ambrosio-turn.ts`), thread = ticket
nel CRM (`/admin/tickets`), handoff umano con le stesse regole. Setup:

1. Env: `TELEGRAM_BOT_TOKEN` (già in uso per le notifiche) + `TELEGRAM_WEBHOOK_SECRET`
   (`openssl rand -hex 32`);
2. Registra il webhook (serve HTTPS):
   `node scripts/telegram-webhook.mjs <BOT_TOKEN> https://tuodominio/api/telegram/webhook $SECRET`
3. In sviluppo locale senza HTTPS: `TELEGRAM_POLLING=1` (il cron legge gli update
   con getUpdates; webhook e polling non convivono, l'env è una scelta esplicita).

Chi scrive al bot parla con Ambrosio fuori turno; con un umano in turno il messaggio
entra nel ticket e suona il campanello «cliente attende». Comandi: `/start` `/stato`
`/umano` `/stop`. Migration: `neon/migrations/033-telegram-channel.sql`.

## Cosa c'è in ogni fase

- **Fase 1 (questa consegna)**: tutto il sopra + GA4/GTM post-consenso, sitemap, robots, OG dinamica.
- **Fase 2**: take-over realtime operatore (Supabase Realtime sul canale della conversazione),
  notifica «l'operatore sta scrivendo», scheduling callback nel DB con promemoria.
- **Fase 3**: editor contenuti (chip, script, FAQ) dalla tabella `content_settings`, chip sostituite
  con le query reali di Search Console, report funnel avanzato, Clarity.

## Modificare lo script chat

Tutto il testo della qualificazione è in `src/lib/chat-script.ts`: domande, bottoni, edge case
(«quanto costa?», «parlo con una persona»), informativa breve GDPR. Si modifica senza toccare
il controller della chat.

## Test

**Unit** (`npm test`, node --test su `tests/*.test.mjs`): dominio puro e sentinelle di coerenza
(sorgenti letti e verificati senza HTTP).

**E2E** (`npx playwright test`, Playwright su `tests/e2e/*.spec.ts`): flussi reali dal browser
contro il DB disposable `wac_e2e` (server sulla porta derivata dal percorso via `scripts/e2e-dev-server.mjs`,
ambiente `.env.e2e`). Ogni spec semina righe marcate `/e2e-*` o `*@e2e.local` e le rimuove in afterAll:
`scripts/e2e-leak-guard.mjs` fallisce la run se qualcosa resta.

Registro delle spec E2E (la sentinella `tests/e2e-registry.test.mjs` fallisce se una spec manca
da questa lista o se la lista punta a file inesistenti):

| Spec | Copre |
|---|---|
| `backup-restore.spec.ts` | Difese RBAC su backup / restore / reset password |
| `callbacks-admin.spec.ts` | Coda callback `/admin/callbacks` (slot, email di conferma) |
| `canali-sociali-nav.spec.ts` | Navigazione Canali social: hub Impostazioni → card → scheda, back-link, ⌘K, compatibilità `/admin/tools/social` |
| `chat-lead.spec.ts` | Chat lead-gen: qualificazione, consenso, salvataggio lead |
| `clients-tipo.spec.ts` | Tipo cliente: filtro, CSV segmentato, aziende senza ditta |
| `consent.spec.ts` | Consenso cookie GDPR |
| `leads-admin.spec.ts` | Pipeline lead `/admin/leads` (note persistenti) |
| `manutenzione.spec.ts` | Modalità manutenzione |
| `password-reset.spec.ts` | Recupero password self-service |
| `prodlike-admin-skeleton.spec.ts` | Navigazione admin contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105): login, hub reali senza skeleton appeso, salvataggi (risposte rapide col TTL, tema) intatti, navigazione schede (card «Emoji della chat» in Canali, back-link, ⌘K) |
| `prodlike-cache.spec.ts` | Free cache contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105): 4 target, conferma a due fasi, audit e età della cache |
| `prodlike-captcha.spec.ts` | Captcha contro server di BUILD — FUORI dalla routine (solo `--config playwright.prodlike.config.ts`, :3105) |
| `servizi.spec.ts` | Catalogo servizi (pacchetti) |
| `social-oauth-flow.spec.ts` | Flusso OAuth REALE Meta/LinkedIn: «Collega» → dialog provider (parametri verificati) → consenso → callback → badge verde + channel_accounts cifrati (skip finché le app non sono configurate in `.env.e2e`; gate admin e CSRF sempre attivi) |
| `tickets-dashboard.spec.ts` | Dashboard ticket `/admin/tickets/dashboard` (KPI, filtri, uscite) |
| `tickets-inbox.spec.ts` | Inbox ticket `/admin/tickets` (CTA, filtri, card mobile, età, bottone Dashboard) |
| `tickets-pagination.spec.ts` | Paginazione coda ticket (URL come stato) |
| `turnstile-shield.spec.ts` | Captcha Turnstile su scheda Cloudflare + violazioni Shield |
| `utenti.spec.ts` | Ruoli utenti, Area personale |

Fuori dalla routine: solo `prodlike-admin-skeleton.spec.ts`, `prodlike-captcha.spec.ts` e
`prodlike-cache.spec.ts` (in tabella, esclusi dalla config standard via `testIgnore` — girano
a mano contro un server di build).

**Routine di guardia prima di ogni commit che tocca aree admin:** suite unitaria + le spec E2E
delle aree toccate (es. ticket → `tickets-*`; chat/pubblico → `chat-lead`, `consent`). Prima di un
bump/tag: almeno una spec admin e una pubblica.
