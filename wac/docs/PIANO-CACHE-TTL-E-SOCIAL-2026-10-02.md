# Piano — Cache TTL dinamica, OAuth social, Ambrosio fuori turno (2026-10-02)

Tre richieste, un ordine: la leva di velocità si misura subito (slider TTL), i canali social si
configurano con OAuth (Meta + LinkedIn), la chat social entra nel ticketing con Ambrosio fuori
turno. Ogni sezione chiude con le proprie verifiche.

## 1. Slider TTL cache pagine pubbliche (barra «Velocità dell'admin»)

### Decisione architetturale (chiusa)

`export const revalidate` (home 300 s, landing 600 s) è una **costante a build time** e
`next.config.ts` non ha `use cache` né esperimenti: il TTL **non** può essere un revalidate
runtime. Scelta: **rotta config interna + proxy** (lo stesso pattern di manutenzione e SEO,
conforme ad AGENTS.md):

- `src/lib/page-cache-shared.ts` — modulo **PURO** (gemello-pari, nel manifest twin-sync):
  `PAGE_CACHE_KEY = "page_cache_ttl"`, range **60–86 400 s** (1 min – 24 h), default **300 s**
  (l'ISR odierno di home), `sanitizePageCacheConfig` (non-numeri/fori di range ricadono sul
  default, arrotonda a secondi interi).
- `src/lib/page-cache-store.ts` — lettura da `content_settings` (**zero migration**), degrada
  al default se il DB manca (stessa disciplina di maintenance-store).
- `src/app/api/page-cache/config/route.ts` — GET JSON `force-dynamic`; header come le altre
  config: `cache-control: public, max-age=0, must-revalidate` + `vercel-cdn-cache-control:
  max-age=60` (cache CDN di **1 minuto**: il cambio TTL deve arrivare al proxy in fretta;
  AGENTS.md aggiornato in entrambi i repo).
- `src/proxy.ts` — legge la config via rotta interna (`cache: no-store`, timeout 1,5 s,
  cache in-process **30 s**; errore → default 300, mai un blocco) e, su **GET HTML di `/` e
  degli slug canonici** (lista `LANDINGS` di `site.ts`, già importata dal proxy), imposta:
  `cache-control: public, max-age=0, must-revalidate, s-maxage=<ttl>` +
  `vercel-cdn-cache-control: max-age=<ttl>`.
  - `max-age=0, must-revalidate` per il browser: la disciplina del repo («il browser deve
    sempre rivalidare») resta intatta; il browser già oggi non cachea le ISR (emetterebbero
    `s-maxage` senza `max-age`).
  - `s-maxage=<ttl>` è la leva vera: la CDN Vercel tiene la pagina `ttl` secondi. Più TTL =
    più HIT = TTFB più basso; il costo è freschezza (fino a `ttl` di stallo — il tradeoff è
    dichiarato nel pannello).
  - Gli slug **personalizzati** (slugOverride SEO) e le pagine statiche (policy, consulenza,
    setup) **non** prendono l'header: restano sul comportamento attuale. Le risposte 404 di
    singoli segmenti non vengono toccate.
- `savePageCacheTtl` in `src/app/admin/actions.ts` — `requireAdmin()` → upsert
  `content_settings` → `logAudit(email, "cache.ttl", PAGE_CACHE_KEY, "<vecchio>→<nuovo>s")` →
  `revalidatePath("/admin/tools/perf")`.
- UI: `src/components/page-cache-ttl-panel.tsx` (client, stile maintenance-panel) montato su
  `/admin/tools/perf` — slider + valore leggibile + spiegazione del tradeoff + avviso che il
  cambio è pubblico entro ~30 s e le voci CDN calde scadono col TTL precedente (immediatezza:
  Tools → Free cache).
- Test: `tests/page-cache.test.mjs` (**guard di sito** — asserta il wiring Crema: proxy,
  actions, pagina perf, route).

### Limiti dichiarati e verifica

- Il proxy gira **prima** del render e le sue response header si applicano alla risposta
  finale (capacità documentata di NextResponse in Next 16). **Verifica empirica obbligatoria**
  dopo l'implementazione: `next build && next start` + `curl -sI /` — l'header deve mostrare
  `s-maxage=<ttl>`; poi in produzione `scripts/ttfb-prod.mjs --fase <nome> --insieme
  pubbliche` (mediana + `x-vercel-cache` HIT). Se l'ISR sovrascrivesse l'header del proxy,
  il piano torna qui e si valuta la fallback (pagina `force-dynamic` + header dal proxy).
- Il cambio TTL vale per le **nuove** risposte d'origine: le voci CDN già calde scadono col
  vecchio TTL (massimo ~TTL precedente). Non è un workaround di cache: per immediatezza esiste
  la purga CDN vera (purgeSiteCache, già nel repo).
- Neon resta sospendibile: nessun cron/keepalive/probe nuovo; la config la legge il proxy solo
  a richiesta reale, con cache in-process.

## 2. OAuth Meta (Facebook + Instagram)

Flusso authorization code completo (l'app Meta Developer è pronta — mancano solo le env):

- `src/app/api/auth/meta/start` → 302 a
  `https://www.facebook.com/v23.0/dialog/oauth?client_id=…&redirect_uri=…&state=…&scope=pages_show_list,pages_manage_metadata,instagram_basic,pages_messaging`
  (`state` CSRF in cookie `httpOnly` `meta_oauth_state`, 10 min).
- `src/app/api/auth/meta/callback?code&state` → verifica `state` →
  `POST graph/oauth/access_token` (code → token utente breve) →
  `GET oauth/access_token?grant_type=fb_exchange_token` (**token utente 60 giorni**) →
  `GET me/accounts?fields=id,name,access_token,instagram_business_account` → per ogni pagina:
  upsert `channel_accounts`:
  - `facebook`: `external_id` = id pagina, `credentials` = `{ secretEnc: <app secret>,
    accessTokenEnc: <token pagina>, userTokenEnc: <token utente 60gg>, expiresAt }`
  - `instagram`: `external_id` = id IG Business Account, `credentials` =
    `{ secretEnc, accessTokenEnc: <token pagina> }` (il token pagina è quello valido per le
    API IG Business).
- Cifratura: `encryptKey`/`decryptKey` esistenti (AES-256-GCM, chiave da `ADMIN_SESSION_SECRET`,
  formato `ivB64.tagB64.encB64`) — **nessun token in chiaro a riposo**.
- Il webhook omnicanale (`/api/webhooks/[channel]`) **già** verifica `X-Hub-Signature-256` con
  `credentials.secretEnc` e trova l'account per `external_id`: l'OAuth popola esattamente il
  contratto che il registry (`src/lib/channel-registry.ts`) si aspetta. Zero modifiche al
  core webhook.
- Env da aggiungere a `.env.example`: `META_APP_ID`, `META_APP_SECRET`. Redirect URI da
  registrare nell'app Meta: `https://www.webagencycrema.com/api/auth/meta/callback`.
- Pannello admin (Impostazioni → Canali › Canali social): stato degli account (`channel_accounts` dove
  `channel IN ('instagram','messenger','facebook')`) + pulsante «Collega con Meta».

## 3. OAuth LinkedIn

- `src/app/api/auth/linkedin/start` → 302 a
  `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=…&redirect_uri=…&state=…&scope=w_identity`
  (stesso cookie `state`).
- `src/app/api/auth/linkedin/callback` → `POST oauth/v2/accessToken`
  (grant_type=authorization_code) → `GET /v2/organizations?role=ADMINISTRATOR` (Bearer) →
  URN organizzazione → upsert `channel_accounts` (`linkedin`, `external_id` =
  `urn:li:organization:<id>`, `credentials` = `{ secretEnc: <client secret>,
    accessTokenEnc: <token> }`).
- **Messaging spento**: `w_organization_social` richiede l'approvazione Marketing Developer
  Platform — l'identità si configura ora, l'invio si attiva solo dopo approvazione (nessun
  codice di invio finché non c'è il via).
- Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`. Redirect URI da registrare:
  `https://www.webagencycrema.com/api/auth/linkedin/callback`.
- Il webhook LinkedIn esiste già (`X-LI-Signature` HMAC-SHA256 col client secret, challenge
  `?challengeCode=`): anche qui l'OAuth popola il contratto esistente.

## 4. Ambrosio fuori turno sui social (chat gestita dal ticketing)

Scelta utente: **risposta automatica fuori turno**, come il bot Telegram. Cambia la **decisione
3 del Percorso 1** del piano Fase 5 («Le azioni AI non scrivono sul social») — il piano va
aggiornato; ADR-006 (audit/flag/dedup) non è toccato.

- **Routing** (estende il webhook omnicanale, come `telegram-ingest.ts` fa per Telegram):
  messaggio inbound → se un operatore umano è **in turno** (service window, `lib/messaging.ts`)
  → ticket con notifica (comportamento attuale, immutato); **fuori turno** → `handleAmbrosioTurn`
  (cervello per-turno già esistente: autonomia, tool call, persistenza come messaggio `bot`) →
  risposta sul canale.
- **Disclosure obbligatoria**: ogni risposta automatica porta il prefisso canonico
  «Risposta automatica AI — una persona ti risponderà in orario d'ufficio» (costante condivisa,
  un solo posto dove cambia il wording).
- **Gate di go-live**: `content_settings` chiave `social_autopilot` `{ enabled: false }` —
  **default SPENTO**. Si accende solo dopo: (a) disclosure approvata, (b) valutazione AIA,
  (c) DPIA GDPR. Finché spento, fuori turno = ticket come oggi.
- **Governance** (prima del go-live, non opzionale): valutazione AIA — lo skill /aia-generation
  non può girare in full (manca il practice governance config), si fa manuale con lo schema
  default dello skill (dominio, rischi, misure, supervisione umana) — e DPIA GDPR (base
  legale, minimizzazione, retention delle conversazioni social, diritti degli interessati).
- Test: estensione della sentinella channel-registry (guard di parità della route) + test unit
  del routing puro (in-turno vs fuori-turno) se il routing diventa una funzione pura testabile.

## 5. Ordine di lavoro e verifiche

1. **TTL** (shared, store, route, proxy, action, slider, test) → `tsc --noEmit`, `npm test`,
   verifica header locale (`next build && next start` + curl), twin-sync.
2. **Twin-sync**: `page-cache-shared.ts` + `page-cache-store.ts` nel manifest
   `twin-sync.json` (19 → 21 file), copia byte-identica nel gemello, `cmp` di verifica;
   `AGENTS.md` in **entrambi** i repo (cache pagine 1 minuto nella regola delle config +
   nuova guard `page-cache-ttl` nell'inventario divergenze + conteggi).
3. **OAuth Meta + LinkedIn** (route start/callback, storage cifrato, pannello canali,
   `.env.example`) → typecheck + test.
4. **Ambrosio fuori turno** (routing webhook, disclosure, gate `social_autopilot`) +
   aggiornamento `docs/PIANO-FASE-5-DESK.md` + valutazione AIA manuale.
5. Docs finali: questa piano (esito), `docs/TELEMETRIA-TTFB.md` solo dopo misura reale con
   `ttfb-prod.mjs`.
