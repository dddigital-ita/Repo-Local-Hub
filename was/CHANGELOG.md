# CHANGELOG — Web Agency Salento + Installer

Registro cronologico delle release: cosa cambia per chi usa il sito e
l'admin, non l'elenco dei commit. Il dettaglio per area (evidenze, hash,
lezioni) vive in [docs/tickets-redesign-assessment.md](docs/tickets-redesign-assessment.md);
ogni release è taggata `was-X.Y.Z-backup` (tag e commit solo locali, mai push automatici).

## [0.9.1] — 2026-10-02 · Release congiunta: editor emoji con «Ripristina predefinite»

Release congiunta con Crema (0.9.1). L'editor delle emoji
della chat (Impostazioni › Canali › Emoji della chat)
guadagna il pulsante «Ripristina predefinite» (icona
`RotateCcw`): un click riempie le righe con il canone —
prop `defaults` dalla Server Component (sostituisce il
vecchio conteggio `defaultCount`; cap `max` preservato, il
client non importa il layer DB). Nel catalogo le label
italiane sono ora visibili sotto ogni emoji (celle più
larghe, label non più `sr-only`) e il tooltip mostra label
più tag. Feature condivisa: i tre file sono byte-identici
in entrambi i repo, nessuna variante di sito. Il set
salvato resta la fonte del picker pubblico; con zero emoji
salvate il composer torna sulle predefinite.

### Verifica di release
- Pre-flight in ENTRAMBI i gemelli: 557/557 test (Salento) e 620/620 (Crema), `tsc --noEmit` pulito, `twin-sync --check` 27/27 file identici.
- Tag `was-0.9.1-backup` (Salento) e `v0.9.1` (Crema); deploy automatico Vercel su push di `main`.

## [0.9.0] — 2026-10-02 · Release congiunta: Google kit e OneDrive in Integrazioni, Velocità di nuovo SSR

Release congiunta con Crema (0.9.0). Su questo sito: Google growth
kit (reviews, analytics, workspace cli, SEO) e OneDrive (Microsoft
Graph, OAuth2 client-credentials) consolidati in Impostazioni ›
Integrazioni; i pannelli della sezione Velocità (target di risposta
e TTL cache pagine) sono importati direttamente — `next/dynamic`
(React.lazy) è rotto su Next 16.3.6 + React 19.3.0 (il Flight
serializer non serializza l'elemento lazy: pannello vuoto in SSR),
esperimento abbandonato e revertito; card «Emoji della chat»
spostata da Ticketing a Canali nell'hub Impostazioni. Desk upgrade
(tag, escalation, merge), outbound multi-canale e OAuth social sono
feature di Crema: su questo sito non esistono (guard di sito, nessuna
variante locale).

### Verifica di release
- Pre-flight in ENTRAMBI i gemelli: 556/556 test (Salento) e 619/619 (Crema), `tsc --noEmit` pulito, `twin-sync --check` 27/27 file identici.
- Navigazione admin verificata su build reale (playwright.prodlike.config.ts, server :3105): 18/18 — incluso «NAVIGAZIONE emoji chat» e «TELEMETRIA».
- Tag `was-0.9.0-backup` (Salento) e `v0.9.0` (Crema); deploy automatico Vercel su push di `main`.

## [0.8.1] — 2026-10-02 · Release congiunta dei gemelli: bump di versione

I due siti tornano alla stessa versione (0.8.0 → 0.8.1) con un solo
gesto: la versione dell'app (letta a runtime dal `package.json`, Admin
→ Tools → Backup, card «App v…») segue il commit su Git — è il deploy
che aggiorna il pannello, non viceversa. Nessun cambio di codice:
`package.json`, questo registro e `AGENTS.md` (storico e conteggi) in
entrambi i repo.

### Verifica di release
- Pre-flight in ENTRAMBI i gemelli: 556/556 test (Salento) e 584/584
  (Crema), `tsc --noEmit` pulito, `twin-sync --check` 27/27 file
  identici.
- Tag `was-0.8.1-backup` (Salento) e `v0.8.1` (Crema); deploy
  automatico Vercel su push di `main`.

## [0.8.0 — telemetria] — 2026-10-02 · TTFB produzione (prima/dopo): la home esce dal render dinamico

Prima misura pubblica con lo strumento esteso (`--insieme
pubbliche`): home e landing su entrambi i domini, 5 campioni
per pagina, prima del deploy (00:32Z) e dopo (01:00Z).
Esito su questo sito:

- **Home** (`/`): mediana **136ms → 104ms** (−24%). Prima
  era render dinamico per visitatore (MISS, `no-store`);
  ora la cache CDN fra1 serve la pagina: `x-vercel-cache`
  HIT in 4 campioni su 5 (il quinto STALE = rigenerazione
  ISR in background, stale-while-revalidate) e header
  `cache-control: public, max-age=0, must-revalidate`.
- **Landing** (`/seo-salento`): mediana 79ms → 105ms, stabile
  nel rumore (min 71ms contro 74ms prima); era già statica,
  ora esplicita ISR `revalidate = 600`. HIT su tutti i
  campioni tranne uno STALE.
- Primo campione post-deploy: picco 3031ms (STALE più prima
  rigenerazione a freddo), poi subito sotto i 110ms —
  comportamento atteso a deploy fresco, non un regresso.
- Crema: al momento della misura il suo deploy 0.8.0 era
  ancora bloccato su Vercel (identità dei commit non mappata
  su GitHub), quindi la sua home risulta invariata
  (541ms → 542ms, MISS); la misura dopo il suo deploy vive
  nel CHANGELOG di Crema.

Dati: `docs/TELEMETRIA-TTFB.md` (confronto prima→dopo) e
`docs/telemetria-ttfb/post-0-8-0-crema+salento-*.json`.

## [0.8.0] — 2026-10-02 · Free cache: rendering e data fetching su App Router (stesso codice di Crema)

La home e le landing tornano ISR. Prima la decisione A/B dell'hero
leggeva `headers()` (cookie di richiesta): con qualunque header
dinamico la pagina usciva dalla cache CDN e si renderizzava per
ogni visitatore. Ora il bucket lo decide il browser.

- **Cancellò A/B client** (nuovo `src/components/hero-ab-gate.tsx`,
  gemello-pari con Crema): legge/assegna il cookie first-party
  `wac_ab` in `useEffect` e sceglie hero statico vs animato.
  Primo render = coorte vuota: markup identico alla prerender,
  nessuna hydration mismatch. L'impression GA4 (`AbViewTracker`)
  monta dopo la decisione, così `hero_variant` è la variante VERA.
- **Home ISR** (`src/app/page.tsx`): via `headers()`, `abDecision`
  e `cohortFromCookieHeader`; `revalidate = 300` (già presente)
  ora è effettivo — TTFB da render dinamico a ~50 ms CDN.
- **Contesto A/B** (`HeroVariantContext`/`useHeroVariant`): la
  variante arriva a `SearchBar` senza prop drill; `search_start`
  continua a riportare `hero_variant` sull'home. `/consulenza`
  e `/[slug]` (fuori dal gate) non la inviano, come prima.
- **Landing ISR** (`src/app/[slug]/page.tsx`): aggiunto
  `export const revalidate = 600` — testi/SEO cambiano raramente
  e l'admin purga con `revalidatePath("/", "layout")`.
- **Rendering**: restano Server Components App Router (SSG/ISR per
  dati che cambiano raramente); SSR solo dove serve davvero
  (`/consulenza` legge i searchParams). Nessuna `fetch` nel percorso
  di render pubblico (i dati arrivano dal pool via lib).
- **Manifest twin-sync**: `hero-ab-gate.tsx` e `search-bar.tsx`
  entrano nei file identici per contratto (strumenti, zero testi
  di sito: i default per sito restano in `lib/hero-shared.ts`).

Conseguenze: home e landing servite dalla cache CDN fra1, non
render per visitatore; il test A/B funziona identico (bucket 50/50
stabile per coorte, cookie first-party 180 giorni). Release
congiunta con Crema (stessa region function, stesso ISR):
verifica `node scripts/twin-sync.mjs --check` in entrambi i repo.

## [0.8.0] — 2026-10-02 · Facebook e LinkedIn entrano nel ticketing (stesso codice di Crema)

Il desk parlava già web/email/whatsapp/telegram e, con la
Fase 4, Instagram/Messenger (Meta). Mancavano all'appello
due social che i clienti chiedono: la pagina Facebook e
LinkedIn. Ora il registry dei canali (CHANNELS) li include,
con il loro adapter — Facebook sulla stessa Messenger
Platform (X-Hub-Signature-256, payload entries/messaging),
LinkedIn con il SUO schema (firma X-LI-Signature =
hex(HMAC-SHA256("hmacsha256=" + corpo grezzo, clientSecret))
e validazione GET ?challengeCode= con challengeResponse).

- **Registry** (`src/lib/channel-registry.ts`, gemello-pari):
  `facebook` e `linkedin` in CHANNELS/CHANNEL_META, adapter
  LinkedIn (firma X-LI-Signature, external_id = URN
  organizzazione) e Facebook via metaAdapter; gli adapter
  espongono `externalIdFrom(payload)` — il webhook non ha
  più if per provider: ogni canale dice come ricavare
  l'account ricevente dal proprio payload.
- **Core puro** (`scripts/channel-webhook-core.mjs`,
  gemello-pari): `signLinkedInBody`/`verifyLinkedInSignature`
  (hex nudo nell'header, prefisso solo nel string-to-sign),
  `signLinkedInChallenge` (validazione endpoint entro 3s),
  `parseLinkedInInbound` (batch `events`; entra solo ciò che
  ha testo — il like non è un messaggio; provider_ref =
  notificationId, la chiave di dedup documentata),
  `metaExternalId`/`linkedinExternalId`.
- **Migration 040** (`neon/migrations/040-channel-accounts.sql`):
  UNA migration già completa (facebook/linkedin inclusi) —
  in Crema la stessa lista arriva con la 045 perché la 040
  di lì esisteva già con la sola lista Fase 4. La sentinella
  gemello-pari `tests/channel-registry.test.mjs` confronta
  l'UNIONE dei check SQL: passa identica in entrambi i repo.
- **Webhook** (`src/app/api/webhooks/[channel]/route.ts`,
  gemello-pari): GET `?challengeCode=` su
  /api/webhooks/linkedin risponde `{ challengeCode,
  challengeResponse }` col secret cifrato dell'account
  linkedin abilitato; POST verifica firma sul corpo grezzo,
  dedup per (channel_account_id, provider_ref) e fila la
  conversazione nel canale giusto.
- **Ticketing**: inbox data-driven (GROUP BY) — le tab dei
  social compaiono da sole quando arrivano conversazioni,
  `?channel=facebook|linkedin` filtra e CHANNEL_LABEL_IT
  etichetta anche telegram/instagram/messenger/facebook/
  linkedin nella dashboard. Rispondere DA questi canale
  (outbound) resta Fase 5: oggi è lettura + conversazione.

Nota operativa: provisioning di un social = riga in
`channel_accounts` (channel, external_id,
credentials.secretEnc cifrato, enabled) POI registrazione
webhook — per LinkedIn senza un account abilitato la
challenge fallisce e LinkedIn blocca l'endpoint dopo 3
validazioni. Suite al verde (506).

## [0.7.2] — 2026-10-01 · Le pagine admin smettono di pagare il round-trip (stesso codice di Crema 0.7.1)

La navigazione admin pagava 18–44 query a pagina (function Vercel a
Washington, Neon a Francoforte: ~180 ms di round-trip per query) —
l'hub Tools arrivava a ~30 s. Stessa cura di Crema, stesso contenuto al
byte (i layer admin sono fuori dal manifest twin-sync, qui è reverse-sync
manuale): query per navigazione Impostazioni ~18→4, Tools ~21→6,
Panoramica ~44→10.

- **Fan-out integrations eliminato**: getIntegrationStatus esegue SOLO il
  reader richiesto (CACHED_SINGLE, cache() per chiave a identità stabile);
  l'hub Tools non esegue più il registro due volte (otto reader) per due pill.
- **I tre layer di stato sono cache() di React**: Impostazioni, Tools e
  Integrazioni deduplicano le letture nella STESSA richiesta (la Panoramica
  non le paga più doppie).
- **TTL 60 s per le config** (db-config-cache.ts): read-through in-process
  con single-flight, nessuna cache negativa, pulizia al passaggio — niente
  cron né keepalive verso Neon. Le chiavi con bump (SLA, emoji, risposte
  rapide) restano nello snapshot per-richiesta di tickets.ts.
- **Skeleton di navigazione**: loading.tsx glass con aria-busy + keyframes
  wac-pulse in admin.css, disattivato sotto prefers-reduced-motion.
- **Migration 044** (additiva, idempotente): indice audit_log (action,
  created_at desc) per le letture «ultimo evento per azione».
- **Sentinelle**: le 5 stesse di Crema in admin-perf.test.mjs (no fan-out,
  cache per richiesta, TTL 60 s, skeleton, migration 044) — suite al verde
  (444).

Nota operativa: la 044 va applicata su Neon (db:migrate) e i passaggi
dashboard del piano performance (region Vercel fra1, scale-to-zero Neon
300 s su entrambi i branch) restano manuali, in ENTRAMBI i gemelli.

## 2026-10-01 · Verifica produzione-like del tool Free cache (fuori release)

Prove contro un server di BUILD (`next start` su `.next-prod`, DB E2E
locale `was_e2e`, chiavi Turnstile di TEST — nessun tocco a Neon): il
percorso completo dell'admin (4 target, conferma a due fasi, esito con i
target effettivi), la multi-target con mutua esclusione, il motore della
purga (la home risponde dopo il revalidate) e l'onestà dell'età letta
dall'audit — **4/4 in 17,4 s, insieme alle 6 prove captcha della stessa
config (10/10)**. Audit `cache.purga` riverificato via psql: attore
`cacheprodlike@e2e.local`, «Solo l'admin» e multi-target «Solo la home,
Solo l'admin».

- Stesso impianto e stesso esito sul gemello (script, config e spec
  identiche al byte, cambia solo il nome del DB E2E): la parità della
  verifica è registrata nel [GAP di parità](docs/GAP-PARITA-CREMA-WAS.md).
- Nuova `CHECKLIST-FREE-CACHE-PRODUZIONE.md` gemellata nei due repo
  (`3c12737` qui, `b790920` a Crema): comandi esatti, tempi del run,
  verifica audit, risoluzione problemi e uso reale in produzione.
- Nessun cambio di codice: nessun tag, nessun deploy necessario.

## [0.7.1] — 2026-10-01 · Il desk Ambrosio arriva in scheda ticket

Il primo passo del piano 0.7.x: la scrivania AI del gemello (Fase 3 del
ridisegno ticketing) atterra qui, col bulk bar già presente da 0.5.7.

- **Pannello Ambrosio nella scheda** (`aed0105`): riepilogo del filo,
  risposta suggerita (iniettata nel composer: l'operatore edita e firma,
  l'AI non invia mai), classifica. Prompt rebrandati Salento; la scheda
  cliente del desk usa lo schema locale (senza client_type/client_meta).
- **Auto-pilota manuale**: il toggle attiva/disattiva il take-over
  scrivendo la STESSA impronta del cron (`ai_takeover_at`) col lock
  anti-corsa `archived_at is null` — chi attiva lo sa, l'audit
  (`ambrosio.desk.autopilota_*`) distingue la mano dal SLA.
- **Esclusione del follow-up** (migration 042): `followup_disabled_at`
  ferma il cron due volte (selezione E claim); riattivare rimette a null,
  nessun riarmo occulto; il badge BellOff in inbox parla del futuro anche
  senza chip.
- **«Invia follow-up ora»**: la pipeline del cron in modalità manuale —
  scavalca SOLO l'esclusione, MAI la dedup: UN follow-up per ticket da
  chiunque parta; blocchi di regola = 409 RFC 7807 nel pannello.
- **Attribuzione in inbox**: chip «a mano» / «SLA» / follow-up + ripartizione
  nel KPI, letta dall'audit con l'indice della **migration 041**
  (`audit_log (target, action, created_at desc)`); TICKET_SELECT porta le
  impronte; `countTickets` aggiunge `ambrosio`/`ambrosioManuale`.
- **Varianti Salento preservate**: la riga estratta `TicketQueueRow` rende
  chip e badge (la pagina passa la prop `ambrosio`); la barra bulk resta
  quella nostra col «tutti» che accende le checkbox; le evoluzioni calendar
  (cerca_slot/prenota su getFreeSlots) restano intoccate.
- **Sentinelle**: desk-autopilota (piani SQL, esiti, verdetto followup-now,
  guard) e takeover-origin (regola d'attribuzione, badge, migration 041
  additiva) — guard adattati alla variante TicketQueueRow.

Nota operativa: le migration 041+042 vanno applicate su Neon (`npm run
db:migrate`) prima del deploy; sono additive e idempotenti.

## [0.7.0] — 2026-10-01 · Twin-sync: parità col gemello e blocco del drift

La release della parità: le funzioni mancanti del gemello atterrate qui, il
tool di blocco della divergenza adottato da entrambi, cache unificata sul
modello Crema. Il dettaglio resta in [docs/GAP-PARITA-CREMA-WAS.md](docs/GAP-PARITA-CREMA-WAS.md).

- **CSS pubblico uniformato** (`a627f2e`): search-bar/search-chips,
  hero-sequence e card-in con stesse classi e stessi ritmi del gemello;
  login-card esce dall'inventario framer (sentinella aggiornata) — il login
  admin non tira più framer-motion nel client. Chiude il gap «temi grafici
  non aggiornati» percepito: il sistema temi era già in parità, le
  animazioni di feature no.
- **Backup cloud** (`8be8066`): a ogni tick il cron deposuna su Neon Object
  Storage una copia restoreabile (gzip + sha256 verificato alla rilettura),
  retention 14, allarme Telegram/email se tace 2 giorni (dedup giornaliero).
  Dipendenza `@aws-sdk/client-s3`; spento senza credenziali storage.
- **Performance ADR-005 + telemetria** (`1ceea66`): `loadAdminRow`
  memoizzato con `cache()` (3-4 SELECT di auth per navigazione → UNA, con
  recupero socket-morto e rigetti `session.rejected`), snapshot
  content_settings per richiesta con bump di versione nelle action (SLA,
  emoji, risposte rapide), telemetria `admin.render` nel layout. Sentinelle:
  admin-perf, route-get-purity (canario adattato alla variante Salento:
  logout via server action).
- **Runbook go-live + SLA nel seed** (`c4c076c`): `/admin/tools/golive`
  legge GO-LIVE.md dal repo (variante Salento: Vercel + dominio canonico);
  migration 039 seeda `ticket_sla_policy` in modo idempotente — la cura era
  nata da un difetto visto QUI e mai atterrata in questo repo.
- **Twin-sync become legge** (`008d1cb`): manifest `twin-sync.json` (9 file
  identici per contratto), script di sync e sentinella in suite che fallisce
  se un file diverge. Fix passati: regex env `[A-Z_0-9]` in backup-full e
  db-migrate-all (la lezione `AWS_ENDPOINT_URL_S3` del gemello).
- **Free cache unificata** (`5c08778`): modello Crema (cache-purge +
  cache-shared + pannello a conferma a due fasi, costo dichiarato, età della
  cache dall'audit) al posto di cache-flush; resta l'aggiunta Salento della
  purga del proxy. Spec E2E `prodlike-cache` nella config dedicata.

Nota onesta di scope: restano da fare per la parità TOTALE (proposta 0.7.1/0.8.0):
desk Ambrosio UI + bulk bar (API e lib già presenti), riconciliazione
`calendar-hub-shared`, reverse-port in Crema dei moduli solo-Salento
(ricerca onesta, troncamento onesto, TicketQueueRow, calendar-board).

## [0.5.7] — 2026-09-30 · Fix CI da lezione del gemello

- CI (`overlay-guard.yml`): `E2E_DATABASE_URL` esplicita su entrambi gli
  step (reset + test). Prima: solo `E2E_PGPASSWORD` → spec e leak-guard
  costruivano un DSN senza credenziali (utente del runner → rifiuto).
- Corretto il copy-paste non rinominato: `DATABASE_URL` puntava a
  `wac_e2e` (il DB del GEMELLO WebAgencyCrema) invece di `was_e2e` —
  l'app sarebbe partita su un DB inesistente (split-brain).
- Nessun cambio di codice: script e spec erano già corretti; era solo
  l'ambiente CI a non dare loro la variabile giusta.

## [0.5.6] — 2026-09-30 · Ricerca onesta e inbox mobile

- Ricerca (inbox + portafoglio): i wildcard `% _ \` dell'utente sono
  LETTERALI (helper `likeContains` in tickets-shared) — «100%» trova
  «100%», non «1000…»; il numero del ticket resta uguaglianza esatta.
- Inbox su mobile (390×844): zero scroll orizzontale (wrap onesto della
  fila azioni header) e icona WhatsApp nella card (tap-target ≥36px).
- Banner cookie mobile: barra sottile (~52px) al posto del pannello che
  copriva il 25–30% del viewport e intercettava i tap sulle card.
- Nuove spec: `tickets-search-edges` (6), `tickets-mobile` (4),
  `consent-mobile-bar` (3).

## [0.5.5] — 2026-09-30 · Porta E2E unica per repo e guard

- Porta E2E derivata dal percorso (3110+sha1%80: gemello 3166; questo
  repo 3168 dal percorso reale — il 3135 citato in origine era la
  derivazione del percorso della copia pre-rebrand) — fine della 3100
  contesa col repo gemello.
- `e2e-port-guard` come globalSetup: la run fallisce subito se sulla
  porta ascolta un processo di un altro repo (prova integrale con
  intruso reale); CLI dedicata.
- Sentinelle unit su porta e config; canale a 0 conversazioni nella
  inbox: tab attiva + empty state (mai fallback silenzioso a «tutti»).

## [0.5.4] — 2026-09-30 · Variante C WhatsApp e Free Cache

- WhatsApp contestuale nella inbox come icona (variante C): solo sui
  ticket con `wa_phone`, `waTicketHref` unico costruttore.
- Free Cache in Tools: svuota cache sito/app, purga selettiva, audit
  aging (dell'agente gemello in parallelo).

## [0.5.3] — 2026-09-30 · Redesign inbox ticket (fasi 1–3)

- Riga coda estratta in `TicketQueueRow` (riuso da scheda cliente),
  età relativa («3gg»), link Dashboard in header sempre secondario.

Pre-0.5.3: vedi `git log` e il registro nel assessment (catalogo
servizi Ambrosio, go-live, modalità manutenzione).
