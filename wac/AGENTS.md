# Regole operative condivise

## Neon e Scale to Zero

- Mantieni il compute Neon di produzione sospendibile dopo 5 minuti di inattività.
- Non introdurre cron, keepalive, health check o probe che eseguano SQL o chiamino endpoint che interrogano Neon, salvo esigenza esplicita e approvata.
- Il pool PostgreSQL non deve avere ping applicativi periodici.
- Le configurazioni lette dal proxy devono conservare la cache CDN: manutenzione 10 minuti, SEO 1 ora, configurazione del TTL delle pagine pubbliche 60 secondi; il browser deve sempre rivalidare.
- Una modifica alla manutenzione può richiedere fino a 10 minuti. Se occorre immediatezza, aggiungere una vera invalidazione CDN: non diminuire la cache con un workaround.

## Siti gemelli

- WebAgencyCrema e Web Agency Salento condividono queste regole.
- Quando una modifica riguarda Neon, proxy, cron, pool o health check, applicarla e verificarla in entrambi i repository.
- Prima della consegna: test, typecheck e controllo del diff in entrambi i siti.

## Test: gemello-pari vs guard-di-sito

- La suite unit (`npm test`, glob `tests/*.test.mjs`) NON è identica nei due repo
  per scelta, non per dimenticanza. Due famiglie:
  - **Gemello-pari**: proteggono superfici condivise (admin, telemetria, infra E2E,
    animazioni pubbliche, strumento TTFB, tema grafico). Si portano byte-identici in entrambi i
  repo e si aggiornano sempre in coppia (es. `admin-perf-view`, `ttfb-prod`,
  `e2e-port-config`, `e2e-port-guard`,`get-side-effect.sentinel`, `framer-firstload.sentinel`,
  `hero-css-parity`, `channel-registry`, `integrations-registry`, `theme-parity`).
  - **Guard di sito**: proteggono feature, migration o testi di UN solo sito. Non
    si copiano: se la feature arriva anche nell'altro repo, si scrive la variante
    locale — mai la copia cieca.
- Inventario/whitelist/attesi dentro una sentinella sono PER-REPO: le differenze
  si dichiarano in un commento nel test (es. `framer-firstload.sentinel`: qui
  `toggle.tsx` dentro e `Chat.tsx` già migrata fuori; nel gemello il contrario).
- Le spec E2E (`tests/e2e/*.spec.ts`) non girano in `npm test`: seguono le config
  playwright (prodlike compreso) e il registro del README (ENTRAMBI i repo).

### Divergenze attuali (legittime, con motivo)

Solo Crema:
- `channel-accounts-migration` — `channel_accounts` esiste in ENTRAMBI ma con migration diverse: qui 040 (lista Fase 4) + 045 (facebook/linkedin); nel gemello una sola 040 già completa (la 040 non esisteva in quel repo). Il registry (`src/lib/channel-registry.ts`), `scripts/channel-webhook-core.mjs` e la sentinella `tests/channel-registry.test.mjs` sono gemello-pari (twin-sync); la route `src/app/api/webhooks/[channel]/route.ts` è gemello-pari FUORI manifest — il twin-sync non accetta route (perimetro «pagine/route mai condivise»), la sentinella la tiene onesta con un guard di parità dedicato. La sentinella confronta l'UNIONE dei check SQL, quindi passa identica in entrambi.
- `client-type` — migration 038 `client_type` ↔ `clients-shared` ↔ select UI: Salento non ha la 038.
- `calendar-board` — adattatore board sullo schema 037 locale; il gemello usa calendar_sources: modelli dati diversi di proposito.
- `chat-prices` — prezzi catalogo↔landing con le CIFRE di Crema; gemella logica in Salento: `chat-pricing-coherence`.
- `golive-hardening` — variante Crema (migration 036 + GO-LIVE.md locale); gemella logica: `golive-parita` (Salento, 039).
- `backup-cloud` — inventario e restore dei backup Neon dal bucket cloud: gemello-pari `src/lib/backup-cloud-shared.ts` e `src/lib/restore-shared.ts` (manifest twin-sync, 27 file) + route `src/app/api/admin/cloud-backup/{list,plan}/route.ts`, `src/components/restore-section.tsx` e guard `tests/backup-cloud.test.mjs` (14 test), tutti byte-identici. Guard di sito: `src/lib/backup-cloud.ts` e il blocco backup di `src/lib/maintenance.ts` (kind string per sito: `webagencycrema-backup` qui, `webagencysalento-backup` nel gemello); `src/app/api/cron/tick/route.ts` resta route di sito (perimetro «pagine/route mai condivise»). Dedup del promemoria backup gemello-pari: `backupReminderDecidiPure` in `maintenance-shared.ts`, stato `backup_reminder_state` in content_settings, `markBackupReminderSent` chiamata dal cron tick di entrambi; `tests/maintenance.test.mjs` (19 test) è ora byte-identico in entrambi i repo (era guard di sito divergente).
- `social-oauth` — OAuth Meta (Facebook + Instagram Business) e LinkedIn: `src/lib/social-oauth.ts`, le 4 route `src/app/api/auth/{meta,linkedin}/{start,callback}/route.ts`, il pannello `src/components/social-channels-panel.tsx`, la pagina `src/app/admin/settings/social/page.tsx` (spostata da Tools a Impostazioni › Canali il 2026-10-02), il redirect di compatibilità `src/app/admin/tools/social/page.tsx` (pattern Google: `requireAdmin` + `permanentRedirect` 308 — mossa permanente, per i segnalibri vecchi) e la sezione `.env.example` sono guard di sito (perimetro «pagine/route mai condivise»); pill «N collegati»/«Da collegare» sulla card Canali social dell'hub Impostazioni (2026-10-02): `socialStatus` in `src/lib/settings-status.ts`, il reader `getSocialChannelsView` (chiave TTL `social_accounts`) in `src/lib/settings-status-server.ts`, la card + riepilogo hub in `src/app/admin/settings/page.tsx` e i test in `tests/settings-status.test.mjs` — tutti della stessa famiglia guard di sito (il gemello non ha social-oauth, quindi non ha né il reader né la pill). La sentinella `tests/get-side-effect.sentinel.test.mjs` resta gemello-pari (twin-sync) e whitelista i due callback col motivo (state CSRF httpOnly 10 min + upsert idempotente cifrato). Guard: `tests/social-oauth.test.mjs` + spec E2E `tests/e2e/canali-sociali-nav.spec.ts` (navigazione hub→card→scheda→back-link→⌘K→compatibilità `/admin/tools/social`) e `tests/e2e/social-oauth-flow.spec.ts` (flusso OAuth REALE: «Collega» → dialog provider con parametri verificati → consenso → callback → badge verde + `channel_accounts` cifrati; skip finché le app non sono configurate in `.env.e2e` — creazione app rinviata, serve login ai portali developer; gate admin e CSRF sempre attivi; entrambe fuori `npm test`, nel registro E2E di README di Crema). Nel gemello la feature non esiste.
- `listing-truncation` — decisione condivisa sulle liste `limit 200`, guard gemello-pari COME VARIANTI (le pagine divergono, non si copiano): qui predicato `totale > leads.length` (count globale, leads senza filtri) e via d'uscita `/api/admin/clients.csv`; gemella omonima in Salento: `counts.totale > leads.length` (leads segmentati `?company=`) e via d'uscita Notion/CSV per clients.
- `ticket-queue-row` — il componente esiste in entrambi con divergenze preservate (qui barra SLA Fase 2 + chip identità CRM `crm=`, nel gemello nessuna delle due): guard gemello-pari COME VARIANTI, gemella omonima in Salento (6 test: nessun test «identità CRM», che è divergenza di Crema).
- `ticketing-upgrade` — upgrade del desk (migration 046 per-repo: tabella `ticket_tags`, colonne `conversations.escalation_level/escalation_at/merged_into/merged_at`): regole pure in `src/lib/tickets-shared.ts` (`sanitizeTags`, `nextEscalationLevel`, `escalationLabel`, `canMerge`, `ESCALATION_TONE`, `TAG_TONE` — `tickets-shared.ts` NON entra nel manifest twin-sync), query layer in `src/lib/tickets.ts` (tag counts, vocabolario, filtro `?tag=`), 5 action in `src/app/admin/actions.ts` (tag, escalation, merge, anteprima merge, vocabolario), componenti `ticket-tag-editor.tsx` / `ticket-escalation-merge.tsx` / `ticket-tag-vocabulary-editor.tsx`, pagine `tickets/[id]` (pannelli + banner «ticket fuso»), `tickets` (pills tag nella toolbar), `settings/tag-vocabulary` + card hub Impostazioni, toast key in `admin-toaster.tsx`, guard `tests/ticketing-upgrade.test.mjs` (18 test) e rationale `docs/TICKETING-UPGRADE-2026-10-02.md`. Tutto guard di sito: la feature è di Crema, nel gemello non esiste (nessuna variante locale). Fase successiva DOCUMENTATA nel rationale, NON implementata: routing a regole (round-robin + min-load + preferenza canale) e CSAT in-app.
- `channel-outbound` — outbound multi-canale (Fase 5 step 5.1, `docs/PIANO-FASE-5-DESK.md`): il primo messaggio di un ticket può partire su WhatsApp (Graph API) o Telegram (Bot API) oltre che via email. Parte pura zero-import in `src/lib/channel-outbound-pure.ts` (payload Graph, parse risposta, `dispatchGraphOutbound` con fetch iniettabile); `src/lib/channel-outbound.ts` è il thin layer con dipendenze (re-export dei puri + `resolveOutboundAccount` su `channel_accounts`, mirror idempotente in `messages` con la UNIQUE parziale di 040, Bot API Telegram, facciata `sendOutbound`); `createTicketAction` in `src/app/admin/actions.ts` (selettore canale, contatto validato per canale, dispatch + errore API che torna all'operatore con bozza conservata), form `src/app/admin/tickets/new/page.tsx` (Instagram/Messenger/Facebook/LinkedIn disabilitati «— in arrivo», avviso business-initiated), banner errore in `src/app/admin/tickets/[id]/page.tsx`, guard `tests/channel-outbound.test.mjs` (17 test) e rationale `docs/CHANNEL-OUTBOUND-2026-10-02.md`. Tutto guard di sito: nel gemello non esiste (nessuna variante locale). I moduli puri entrano nel gemello solo allo step 5.4 (twin-sync).
- `onedrive-integrazione` — integrazione OneDrive (Microsoft Graph API, OAuth2 client-credentials: token endpoint `login.microsoftonline.com/{tenant}/oauth2/v2.0/token` + test reale `GET /v1.0/sites/root/drive`) e card iCal esposta nel registro integrazioni (la feature iCal esisteva già nel calendar hub 037: qui si aggiunge la card + reader di stato). `src/lib/onedrive.ts` (credenziali AES-256-GCM in `content_settings['onedrive_config']` campo `credsEnc`, `parseOneDriveCredentials`, `oneDriveAccessToken`, `testOneDriveConnection`) e la pagina `src/app/admin/settings/onedrive/page.tsx` sono byte-identici nei due repo — come `drive.ts` e la sua pagina: logica di fatto condivisa, fuori manifest (il perimetro «pagine mai condivise» vale per twin-sync, non per le copie manuali); le action `saveOneDriveAction`/`testOneDriveAction` vivono in `src/app/admin/actions.ts` (per-repo, file già divergente per altre feature). Il reader `onedrive:` di `src/lib/integrations-status.ts` è identico nei due repo; il reader `ical:` DIVERGE col modello calendario (famiglia `calendar-board`: qui sorgenti `icalUrls` in `calendar_hub_config` + item `origin='ical'` + feed con `exportTokenHash`; nel gemello sorgenti in tabella `calendar_sources` (kind='ics', toggle `visible`) + item `source='external'`/`ext_uid` + feed `/api/calendar/export` con `export_token` via `getHubConfig`) — `integrations-status.ts` esce quindi dai file comuni. Registry `src/lib/integrations-registry.ts` e sentinella `tests/integrations-registry.test.mjs` restano gemello-pari (byte-identici; la sentinella impone def ↔ reader in ENTRAMBI i repo, quindi il gemello non può restare senza reader).
- `google-growth-kit` — Google growth kit (le 4 skill `google-reviews`, `google-analytics`, `google-workspace-cli`, `seo-google`) consolidato in UNICA pagina in Impostazioni › Integrazioni (`/admin/settings/google`, sorella di drive/onedrive): card grafiche con report e collegamenti ai servizi più il pannello di configurazione esistente (GA4/GTM/GSC/Clarity IDs, PageSpeed API key, credenziali OAuth GSC, test reali). L'esecuzione delle skill resta via agente/terminale: la pagina è superficie grafica (link + report), nessuno script server-side. `/admin/tools/google` diventa redirect di compatibilità. Byte-identici per repo (copia manuale fuori manifest, come drive/onedrive): `src/app/admin/settings/google/page.tsx`, `src/app/admin/tools/google/page.tsx`, `src/lib/integrations-registry.ts` (def `google` → `/admin/settings/google`), `src/lib/tools-status-server.ts` (google esce da `getToolsStatuses` — lo legge il layer integrazioni), `src/lib/overview-status.ts`, `src/app/admin/tools/manuale/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/seo/page.tsx`. Divergenze preservate (guard di sito pre-esistenti): `src/app/admin/tools/page.tsx` (card Google rimossa in entrambi; il gemello tiene cachePurgeStatus/Gauge), `src/lib/admin-destinations.ts` (entry manuale google rimossa — la fornisce `integrationDestinations()`), `src/app/admin/actions.ts` (redirect aggiornati per-repo), `src/components/google-tools-panel.tsx` (placeholder dominio), `src/lib/google-tools.ts` (URL fallback), `src/lib/integrations-status.ts` (modello calendario — famiglia calendar-board; reader `google:` identico).

Solo Salento:
- `chat-pricing-coherence` — ramo scriptato `preventivo_subito` del chat-script (testo di Salento).
- `golive-parita` — variante Salento della famiglia golive.
- `listing-truncation` — variante Salento della famiglia (guard omonimo, non byte-identico): predicato `counts.totale > leads.length` coi segmenti `?company=`; clients esporta via Notion/CSV (Crema: route `clients.csv`).
- `ticket-queue-row` — variante Salento della famiglia (guard omonimo, 6 test vs 7): la chip CRM è divergenza Crema, nessun test locale; `ticket-bulk-bar` vive in `components/tickets/`.
- `vercel.json` — config di deployment, non di codice condiviso: Salento ha il config completo (region fra1, redirect `was.ddigital.net` → `www.webagencysalento.com`, security headers); Crema ha `{}`. Divergenza di deployment lasciata così il 2026-10-02: le header di sicurezza valgono per l'hosting di Salento, su Crema decide il suo deployment (da rivalutare se si vuole parità di header).

### Come leggere i conteggi

Verificati 2026-10-02 (sera, porting Fase 3): Crema 584 · Salento 556 · 381 file comuni byte-identici; delta guard di sito 28 (= 584 − 556; prima del porting: Salento 525, delta 59). Nuova sentinella gemello-pari `tests/integrations-registry.test.mjs` (6 test in ENTRAMBI i repo: defs ↔ reader READERS di `integrations-status.ts` ↔ palette ⌘K di `admin-destinations.ts`; manifest twin-sync 23 → 24 file; +6 test per lato, delta guard di sito invariato a 57). Attenzione operativa: il sentinel va creato nel gemello via `twin-sync --apply` (e il manifest aggiornato a mano in entrambi, non essendo auto-gestito) — altrimenti `npm test` pieno fallisce con ENOENT nel gemello. Aggiornamento notte precedente: Canali social spostato Tools → Impostazioni › Canali (guard social-oauth aggiornato, test invariati; il +1 era il test ADR-007 della sessione precedente); perf-target: +2 file nel manifest twin-sync (`perf-target-shared.ts`, `perf-target-store.ts`), guard `tests/perf-target.test.mjs` +9 test. Switch iOS della manutenzione (`src/components/maintenance-panel.tsx`, role=switch + knob framer-motion): resta file comune byte-identico (modifica applicata identicamente in entrambi i repo); le whitelist framer delle sentinelle (`framer-firstload.sentinel` e `bundle-watch`, inventari per-repo) aggiornate in coppia col nuovo import admin; `tests/maintenance.test.mjs` (guard di sito già divergente) corretto in entrambi con la stessa logica: asserzione obsoleta `/confirming/` → `role="switch"` + `aria-checked` + catena dei click. Aggiornamento pomeridiano: pill Canali social nell'hub Impostazioni (`socialStatus` puro + reader `social_accounts` + card/riepilogo + test): guard di sito della famiglia social-oauth, +1 test solo qui (Crema 583 → 584) e 3 file comuni in meno (settings-status.ts, settings-status-server.ts, tests/settings-status.test.mjs). Aggiornamento Fase 3 (2026-10-02, porting nel gemello su decisione dell'utente): `page-cache-ttl` e `perf-target` escono dalla lista «Solo Crema» — feature ora in ENTRAMBI i repo con rotta `/api/page-cache/config`, pannelli `page-cache-ttl-panel.tsx`/`perf-target-panel.tsx`, action `savePageCacheTtl`/`savePerfTarget`, pagina `/admin/tools/perf` e guard byte-identici (12 + 9 test); copia manuale fuori manifest: il perimetro «pagine/route mai condivise» vale per twin-sync, non per le transizioni guard→gemello-pari. Manifest twin-sync 24 → 27 file (`maintenance-shared.ts`, `restore-shared.ts`, `backup-cloud-shared.ts`). Salento +31 test: page-cache +12 (nuovo), perf-target +9 (nuovo), backup-cloud 9 → 14 (allineato), maintenance 14 → 19 (allineato col dedup). Infrastruttura ri-allineata per la regola «Neon, proxy, cron, pool → entrambi»: pool `db.ts` (idleTimeoutMillis 30 s, connectionTimeoutMillis 10 s, keepAlive: true), `neon.ts` (bucket `backups`, retention 14 giorni), `proxy.ts` con `purgeProxyCaches` (svuota anche la cache del TTL pagine) e `loadPageCache` (cache in-process 30 s; `s-maxage`/`vercel-cdn-cache-control` su home e landing canoniche, browser sempre must-revalidate) — il proxy diverge ancora solo per il nome del sito nel logo e il commento storico della purga. `vercel.json` resta divergente per deployment (vedi «Solo Salento»).
(verifica con `cmp` per ciascuno; `e2e-registry` allineato col registro nel
README di ENTRAMBI; strumento aggiornamenti per dominio gemello-pari,
import «per gemello» con anteprima diff incluso). Il delta è la somma dei guard di sito sopra,
non una mancanza di parità. La garanzia non è il conteggio: è che i file comuni
restino identici e che ogni nuovo divergente entri in questa lista col suo
motivo. Quando un guard viene allineato o ne nasce uno di sito, aggiorna questa
sezione in ENTRAMBI i repo.

Ticketing upgrade (2026-10-02, guard di sito `ticketing-upgrade`): +7 file solo Crema (migration 046, 3 componenti, 2 pagine, guard test, rationale) — Crema 584 → 591, delta guard di sito 28 → 35; +18 test solo Crema (`tests/ticketing-upgrade.test.mjs`).

Channel-outbound (2026-10-02, guard di sito `channel-outbound`, Fase 5 step 5.1): +4 file solo Crema (`src/lib/channel-outbound-pure.ts`, `src/lib/channel-outbound.ts`, `tests/channel-outbound.test.mjs`, `docs/CHANNEL-OUTBOUND-2026-10-02.md`) — Crema 591 → 595, delta guard di sito 35 → 39; +17 test solo Crema (`tests/channel-outbound.test.mjs`).

OneDrive + iCal nel registro integrazioni (2026-10-02, famiglia `onedrive-integrazione`): +2 file per repo (`src/lib/onedrive.ts`, `src/app/admin/settings/onedrive/page.tsx` — byte-identici, copiati fuori manifest come drive.ts); `src/lib/integrations-status.ts` esce dai comuni (reader `ical:` diverso per modello calendario — famiglia calendar-board) e guadagna il reader `onedrive:` identico — Crema 595 → 597, Salento 556 → 558, comuni 381 → 382, delta guard di sito invariato a 39 (stesso +2 per lato).

Google growth kit in Impostazioni › Integrazioni (2026-10-02, famiglia `google-growth-kit`): il kit lascia l'hub Tools (card, entry ⌘K manuale e stato rimossi) e vive in `/admin/settings/google` — nuova pagina byte-identica per repo (copia manuale fuori manifest) e `/admin/tools/google` ridotto a redirect (da divergente torna byte-identico) — Crema 597 → 598, Salento 558 → 559, comuni 382 → 384, delta guard di sito invariato a 39.

Release 0.8.1 (2026-10-02): bump di versione congiunto dei gemelli
(`package.json` 0.8.0 → 0.8.1, CHANGELOG per sito, questo file);
nessun file aggiunto o rimosso — i conteggi sopra restano validi
(Crema 598 · Salento 559 · 384 comuni, delta guard di sito 39).

Legacy redirect canali social (2026-10-02, guard `social-oauth`):
+1 file solo Crema (`src/app/admin/tools/social/page.tsx`:
`requireAdmin` + `permanentRedirect` 308 → `/admin/settings/social`,
compatibilità per i segnalibri vecchi; copertura E2E nel serial
`canali-sociali-nav.spec.ts`) — Crema 598 → 599, Salento 559, delta
guard di sito 39 → 40.

Sezione Velocità, pannelli importati direttamente (2026-10-02,
famiglia `perf-lazy-loading`, comune): i due pannelli client di
`/admin/tools/perf` (target di risposta + TTL cache pagine) sono
importati DIRETTAMENTE dalla Server Component — il lazy loading
con `next/dynamic` (React.lazy) è stato provato e ABANDONATO su
questo stack (Next 16.3.6 + React 19.3.0): il Flight serializer
non sa serializzare l'elemento lazy — nella Server Component il
payload RSC manda il nodo come null (pannello vuoto in SSR,
boundary Suspense completata con un div vuoto: la prodlike
TELEMETRIA sul confronto prima/dopo falliva sul build reale) e
il wrapper Client Component con `ssr:false` lascia i pannelli
fuori dal server con errori «destination stream closed early».
Il lazy non serviva nemmeno: i pannelli sono piccoli
(react/lucide/glass, nessuna chart) e Next.js fa già
code-splitting per rotta — il loro chunk entra nel bundle di
`/admin/tools/perf` e solo lì. Col revert cade anche la barra
animata `loading-bar.tsx` (era il fallback `loading` del
dynamic, sweep CSS in admin.css) e `experimental.extensionAlias`
in `next.config.ts` (serviva solo agli `import("….js")` dei
pannelli lazy) — Crema 600 → 599, Salento 560 → 559, comuni
385 → 384, delta guard di sito invariato a 40.

E2E flusso OAuth REALE (2026-10-02, guard `social-oauth`):
spec seriale `tests/e2e/social-oauth-flow.spec.ts` (seed admin
→ gate admin sempre attivo su start (GET 405, POST 30x login)
→ flusso Meta REALE col dialog `facebook.com/v…/dialog/oauth`
verificato (client_id, redirect_uri, state, scope) → consenso
best-effort/operatore → callback → banner + badge verde + righe
nuove in `channel_accounts` cifrate → flusso LinkedIn REALE
(organizzazioni `urn:li:organization:`) → CSRF al callback
senza cookie = `state_non_valido`, nessuna upsert) + blocco
social in `.env.e2e` (redirect URI
`http://localhost:3166/api/auth/{meta,linkedin}/callback`;
variabili app vuote finché non si creano le app Meta/LinkedIn
nei portali developer) + riga nel registro E2E di `README.md`
di Crema. Le spec E2E non entrano nei totali (stessa regola di
`canali-sociali-nav.spec.ts`): Crema 599 · Salento 559 · comuni
384, delta guard di sito invariato a 40. Nel gemello la feature
non esiste: nessun file, solo questo AGENTS.md.

Release 0.9.0 (2026-10-02): bump di versione congiunto dei gemelli (`package.json` 0.8.1 → 0.9.0, CHANGELOG per sito, questo file); commit dell'intero batch di lavoro pendente (Crema 52 file · gemello 26 file) e deploy Vercel su push di `main` in entrambi i repo. Migration 044/045/046 applicate al Neon di produzione PRIMA del push (il DB era fermo a 042; 046 è il ticketing upgrade, guard di sito Crema). I conteggi sopra restano validi: Crema 599 · Salento 559 · 384 comuni, delta guard di sito 40.

Release 0.9.1 (2026-10-02): bump di versione congiunto dei gemelli (`package.json` 0.9.0 → 0.9.1, CHANGELOG per sito, questo file) con feature condivisa — editor emoji della chat: pulsante «Ripristina predefinite» (canone come prop `defaults` dalla Server Component, cap `max` preservato, `defaultCount` rimossa), label italiane visibili nel catalogo, tooltip con tag. I 3 file (`src/components/chat-emoji-editor.tsx`, `src/app/admin/settings/emoji-chat/page.tsx`, `tests/chat-emoji.test.mjs`) sono byte-identici nei due repo (copia manuale fuori manifest — twin-sync resta 27/27). Commit, tag (`v0.9.1` Crema · `was-0.9.1-backup` Salento) e deploy Vercel su push di `main`. Nessun file aggiunto o rimosso — i conteggi sopra restano validi: Crema 599 · Salento 559 · 384 comuni, delta guard di sito 40 (test totali: Crema 620/620 · Salento 557/557).
