# ADR — Registro delle decisioni architetturali

> Decisioni del ridisegno ticketing «desk» (piano approvato il 30/09/2026,
> valutazione in [tickets-redesign-assessment.md](tickets-redesign-assessment.md)
> e brief in [dashboard-ticket-brief.md](dashboard-ticket-brief.md)). Ogni ADR
> è committata con il codice che la realizza: i riferimenti puntano ai commit
> e ai file veri. Status: tutte **Accettate**. Il formato segue lo standard
> ADR (Contesto → Decisione → Alternative → Conseguenze/Trade-off).
>
> **Registro gemello**: questo documento è l'adattamento per Web Agency Salento
> di `docs/ADR.md` di WebAgencyCrema — le decisioni sono condivise, i
> riferimenti a file e commit sono di questo repo. Divergenze dichiarate:
> ADR-001 (la migration 040 è l'unica, già completa dei social — in Crema
> 040 + 045), ADR-006 (indice locale 044), ADR-007 (header di cache sulle
> rotte di config del proxy; nessun slider TTL pagine: feature di Crema).

Indice: [ADR-001](#adr-001-adapter-registry-per-i-canali) ·
[ADR-002](#adr-002-identità-cliente-unificata-per-telefono-e-mail) ·
[ADR-003](#adr-003-webhook-idempotenti-con-firma-per-account) ·
[ADR-004](#adr-004-ambrosio-come-superficie-di-tool-non-copilota-cieco) ·
[ADR-005](#adr-005-lauth-admin-una-volta-per-richiesta) ·
[ADR-006](#adr-006-laudit-dice-il-passato-il-flag-decide-il-futuro-la-dedup-è-sacra) ·
[ADR-007](#adr-007-isr-e-ssg-prima-di-ssr-cache-header-espliciti-cdn-come-proxy)

---

## ADR-007: ISR e SSG prima di SSR, cache header espliciti, CDN come proxy

**Status**: Accettata · **File**: [src/app/page.tsx](../src/app/page.tsx), [src/app/[slug]/page.tsx](../src/app/[slug]/page.tsx), [src/proxy.ts](../src/proxy.ts) · **Riferimento**: [PIANO-PRESTAZIONI-2026-10-02.md](PIANO-PRESTAZIONI-2026-10-02.md) (Agente B, documento congiunto dei due gemelli) · **Rilascio**: `9861260` (0.8.0 — ISR live)

### Contesto

Appunto di progetto (2026-10-02) sulla strategia di rendering:
«abusa di ISR e SSG; evita il SSR quando i dati non cambiano a
ogni secondo; imposta Cache-Control correttamente su route API e
Server Actions; valuta una CDN (strumento interno/proxy o
Cloudflare come proxy) che salvi JS, CSS e immagini nella sua rete
globale, azzerando il carico sul server». Stato reale del progetto
alla data: deploy su Vercel (evidenza live: header `x-vercel-id`
in §2 del piano prestazioni, verifica con `scripts/verify-deploy.mjs`);
l'ISR è attivo su home e `/[slug]` dal rilascio 0.8.0 (Agente B del
piano prestazioni, `9861260`); la cache CDN delle pagine pubbliche è
l'**edge cache Vercel** (Free cache ISR, header `x-vercel-cache:
HIT`) — il proxy Next (`src/proxy.ts`) in questo repo **non** porta
header `s-maxage` sulle pagine: gestisce manutenzione, redirect 301
e slug di landing rinominate.

### Decisione

1. **ISR/SSG di default per le superfici pubbliche** che non cambiano
   al secondo: home `revalidate = 300`, `/[slug]` `revalidate = 600`
   (contenuti da Neon che cambiano raramente; l'admin purga con
   `revalidatePath`). Il SSR resta solo dove i dati sono veri a
   ogni richiesta (es. `/consulenza` legge i searchParams).
2. **Admin `force-dynamic` ovunque**: le decisioni del desk devono
   essere vere al click (ADR-005); nessuna cache su superfici
   autenticate.
3. **Cache-Control esplicito, un punto solo: le rotte di config del
   proxy.** In questo repo gli unici header di cache espliciti vivono
   sulle due rotte che il proxy legge — `/api/maintenance/config`
   (CDN 600 s) e `/api/seo/config` (CDN 3600 s) — con la coppia
   `cache-control: public, max-age=0, must-revalidate` (il browser
   rivalida sempre) + `vercel-cdn-cache-control` (la copia CDN vive
   per il TTL). Le pagine pubbliche non hanno header dal proxy: la
   freschezza è l'ISR (`revalidate` + `revalidatePath` dell'admin),
   la cache è l'edge Vercel. Route API e Server Actions: nessun
   header di cache su risposte autenticate o di scrittura; gli asset
   fingerprintati di Next sono già `immutable` a livello di piattaforma.
4. **CDN come proxy: valutazione aperta, non azione.** Il principio
   dell'appunto (asset serviti dalla rete globale, carico sull'origine
   azzerato) è già coperto dall'edge cache Vercel (Free cache ISR,
   header `x-vercel-cache`) per le risposte. Una CDN a dominio
   (Cloudflare proxy) si valuta solo con evidenza: misura TTFB con
   `scripts/ttfb-prod.mjs` e rivaluta se l'edge Vercel non basta.
   Vincoli se si adotta: bypass totale su `/admin` (pagine
   `force-dynamic`; la pagina di manutenzione del proxy manda già
   `no-store` + `retry-after`), invalidazione CDN vera per le
   modifiche di manutenzione (mai abbassare i TTL come workaround:
   il toggle manutenzione può richiedere fino a 10 minuti ad arrivare
   in pubblico via CDN della rotta di config).

### Alternative considerate

- **SSR ovunque**: TTFB a freddo 2,85 s sulla home (misure §1 del
  piano prestazioni, cold start Neon + function) — scartato per le
  superfici pubbliche.
- **Cache lunga sul browser** (`max-age` alto): le pagine pubbliche
  cambiano con le scritture dell'admin (`revalidatePath`) — il
  browser deve rivalidare; immutable solo per gli asset fingerprintati.
- **Cloudflare proxy subito**: deploy su Vercel con edge cache già
  attiva; aggiungere un layer CDN prima di avere evidenza di
  saturazione è costo senza beneficio misurabile — resta evoluzione
  documentata, non azione.

### Conseguenze

- **Positive**: la policy di rendering è scritta una volta sola; chi
  tocca rendering o cache ha il riferimento operativo (questo ADR +
  §4 del piano prestazioni per i valori).
- **Negative**: una regola in più da ricordare prima di aggiungere
  `headers()`/`force-dynamic` a una pagina pubblica (la storia della
  home A/B: un solo `headers()` aveva disattivato l'ISR dichiarato —
  §2 del piano prestazioni).
- **Trade-off**: freschezza vs cache — scelto ISR con
  `revalidatePath` per le scritture dell'admin; il browser rivalida
  sempre, l'edge serve la copia a TTL.

## ADR-001: Adapter registry per i canali

**Status**: Accettata · **Commit**: `9861260` (rilascio 0.8.0) · **File**: [neon/migrations/040-channel-accounts.sql](../neon/migrations/040-channel-accounts.sql), [src/lib/channel-registry.ts](../src/lib/channel-registry.ts), [scripts/channel-webhook-core.mjs](../scripts/channel-webhook-core.mjs)

### Contesto

Il ticketing parlava già quattro canali (web, email IMAP, WhatsApp,
Telegram) e, con la Fase 4, Instagram/Messenger (Meta). Mancavano
all'appello due social che i clienti chiedono: la pagina Facebook e
LinkedIn. Ogni canale portava la SUA tabella di credenziali, il SUO
webhook dedicato e parsing ad hoc: il piano «diventerà un ticketing
che gestisce i social e qualsiasi canale chat» su quella traiettoria
significava N tabelle, N webhook, N dedup. Inoltre `telegram_chats`
mostrava il modello «giusto» (credenziali cifrate AES-256-GCM a
livello applicativo) ma non generalizzabile.

### Decisione

1. **`channel_accounts`** (040): UNA tabella per le credenziali/identità di
   ogni account su ogni canale — `UNIQUE (channel, external_id)` (più account
   per canale), `credentials` jsonb cifrato a riposo (stessa ricetta
   `telegram_chats`), `enabled` per spegnere senza cancellare. In questo
   repo la 040 è l'**unica** migration della famiglia: nasce già completa
   dei social (facebook, instagram, linkedin) — in Crema la stessa
   decisione arriva in due tempi (040 lista Fase 4, poi 045
   facebook/linkedin).
2. **`ChannelAdapter`** in `channel-registry.ts`: `verifySignature(rawBody,
   headers)` + `parseInbound(payload)` → `InboundMessage[]`. Un canale nuovo
   = un adapter + una riga nel check SQL: la coda, la scheda e la sync
   clienti non sanno nemmeno che è arrivato.
3. **La logica testabile vive in un modulo puro**
   (`scripts/channel-webhook-core.mjs`, zero import): firma HMAC, parser
   Meta e Telegram eseguiti nativamente da `node --test`. Lezione
   architetturale registrata due volte (config Playwright transpilato come
   CJS, alias `@/` invisibili a Node): il core non passa da nessun loader.
4. **Delegazione, non big-bang**: i canali vivi restano dove sono
   (telegram-ingest, email-tools, messaging); l'adapter li DELEGA.
   `telegram_chats` resta la fonte del token e viene rispecchiata come
   account sintetico.

### Alternative considerate

- **Una route webhook per provider** (schema attuale esteso): copy-paste di
  guardie/dedup/thread per ogni social, e la historia dei bug si ripete per
  canale invece di correggersi una volta. Scartata per costo operativo.
- **Tabella dedup per canale** (`telegram_updates`, `meta_events`, …): N
  tabelle e N pulizie al posto di una UNIQUE — superato da `provider_ref`
  (vedi ADR-003).
- **Microservizio ingest separato**: infrastruttura Vercel monolitica
  (RSC + server actions) non ne ha bisogno; over-engineering per scale
  ipotetiche.

### Conseguenze

- **Positive**: canale nuovo ≈ 100 righe di adapter; dedup e firma una volta
  sola; sentinella unit migration ↔ codice (`tests/channel-registry.test.mjs`,
  gemello-pari) impedisce che DB e registry divergano.
- **Negative**: un livello d'indirizzamento in più (lookup account prima
  della verifica firma); il mirror telegram è compatibilità, non pulizia —
  andrà assorbito in Fase 5.
- **Trade-off**: coerenza del modello vs velocità d'integrazione dei canali
  esistenti — scelto il modello, pagando il mirror transitorio.

---

## ADR-002: Identità cliente unificata per telefono e email

**Status**: Accettata · **File**: [src/lib/clients.ts](../src/lib/clients.ts), [src/lib/clients-shared.ts](../src/lib/clients-shared.ts) · **Gemello-pari**: `clients-shared.ts` è nel manifest twin-sync; il codice è presente dal clone iniziale (`13c798b`, 2026-09-29) — la decisione è nata con il gemello e qui è allineata per contratto

### Contesto

Il sync portafoglio (025) derivava l'identità del cliente da lead (chat/WhatsApp)
e `contact_email` (email). L'arrivo dei social pone la domanda: chi è «il
cliente» quando scrive da Instagram senza email né telefono? E come si evita
che la stessa persona diventi tre schede da tre canali?

### Decisione

La chiave d'identità è una **priorità fissa** (`ticketIdentity` + funzioni
pure di `clients-shared.ts`, tutte testate):

1. **telefono E.164** (`toE164Pure`: raw con o senza `+39` → stesso numero) —
   l'identità più stabile, vince sempre;
2. **email normalizzata** (`normEmailPure`) — `contact_email` del canale
   prima, `cited_email` (email citata nel testo dei messaggi) come rete di
   sicurezza, mai come vincitrice sul canale;
3. **handle del provider** (chat id, wa id, ig id) come `contact_handle`
   del FILO — identifica la conversazione, NON la scheda cliente: il merge
   verso `clients` avviene quando un identificatore forte (1. o 2.) esiste.

L'upsert è **«completa ma non distrugge»**: un campo nuovo riempie un buco,
un campo assente non cancella ciò che si sapeva (il nome del primo canale
che l'ha detto resta).

### Alternative considerate

- **Una scheda per (canale, handle)**: semplice ma isole — lo storico del
  cliente si frammenta esattamente ciò che un CRM non deve fare. Scartata.
- **Identità social-first** (handle → scheda): davanti ai social puro, ma
  il telefono resta l'identità commerciale reale in Italia B2B (chiamate,
  WhatsApp, fatture); l'handle social è volatile (cambia account).
- **Cited_email come identità primaria**: la rete di sicurezza perde il suo
  scopo se diventa la via principale (spoofable, ambigua nel testo).

### Conseguenze

- **Positive**: lo stesso numero su canali diversi è UN cliente con tutta
  la sua storia (verificato in E2E: WA + web → una scheda, nome intatto);
  la scheda del sync WhatsApp senza email esiste ed è pulizia per telefono
  (leak-guard sorveglia il caso).
- **Negative**: gli handle social restano fuori dalla chiave fino a quando
  l'utente non dà un telefono/email — schede «temporanee» possibili.
- **Trade-off**: stabilità dell'identità vs completezza dei dati — scelto
  la stabilità, con il prompt di qualificazione (già esistente) che raccoglie
  il telefono come primo gesto.

---

## ADR-003: Webhook idempotenti con firma per account

**Status**: Accettata · **Commit**: `9861260` (rilascio 0.8.0) · **File**: [src/app/api/webhooks/[channel]/route.ts](../src/app/api/webhooks/[channel]/route.ts) (gemello-pari fuori manifest: identica nel gemello)

### Contesto

I provider ritentano per ore su qualunque risposta non-2xx, e i webhook social
arrivano **con firma HMAC sul corpo grezzo** (Meta `X-Hub-Signature-256`,
Telegram secret token). Il webhook Telegram esistente aveva già le tre
guardie giuste (secret costante-time, dedup `update_id`, 200 a pipeline
partita) ma come codice per-canale.

### Decisione

1. **Firma sull'account**: il secret vive in `channel_accounts.credentials`
   cifrato; la verifica è HMAC-SHA256 sul corpo **grezzo** (mai riparsare
   prima) con confronto in tempo costante, header normalizzato per adapter.
   Senza secret configurato la verifica è impossibile → rifiuta (fail-closed).
2. **Idempotenza da schema**: `UNIQUE (channel_account_id, provider_ref)`
   su `messages` (040). Il webhook fa SELECT di dedup, poi INSERT con
   `ON CONFLICT … DO NOTHING` **ripetendo il WHERE dell'indice parziale**
   (Postgres non matcha un indice parziale senza il predicato — beccato in
   E2E).
3. **Contratto di risposta**: 404 canale non nel registry, 403 firma,
   200 + `{accepted, duplicated}` a pipeline accettata. Mai 5xx per errori
   del payload: il provider non deve ritentare un problema nostro.
4. **Thread**: `(channel, contact_handle)` con conversazione aperta →
   messaggio nel filo; altrimenti nuovo ticket `status='bot'` (stessa
   semantica di telegram-ingest: lo SLA non è armato finché non c'è un umano).
5. **Audit `webhook.*`** per ogni giro con esito, actor `system`.

### Alternative considerate

- **Verifica post-parse del JSON**: comodo per trovare l'account nel payload
  ma l'HMAC sul JSON riparsato può divergere (spazi, ordine chiavi) — il
  raw body è la materia della firma, sempre.
- **Coda di elaborazione (queue)**: disaccoppia ingest da pipeline, ma su
  Vercel serverless il costo operativo (worker, visibility timeout) non è
  giustificato dal volume reale; la idempotenza da schema è il 90% del
  beneficio senza il 100% dei costi.
- **Fail-open senza secret** (accetta e logga): un webhook senza firma è
  un endpoint pubblico di scrittura nel CRM — scartato per sicurezza.

### Conseguenze

- **Positive**: ritenti dei provider sono gratuiti (duplicated); la stessa
  route copre i social futuri; l'audit rende l'ingresso ispezionabile.
- **Negative**: la dedup pre-SELECT + INSERT non è atomica su race estreme
  (due POST simultanei): la UNIQUE protegge l'insert ma il primo messaggio
  può già aver aperto il ticket — tollerabile (il filo converge).
- **Trade-off**: semplicità serverless vs throughput — sotto le decine di
  messaggi/secondo la scelta regge; la queue resta l'evoluzione naturale
  se i social decollano.

---

## ADR-004: Ambrosio come superficie di tool, non copilota cieco

**Status**: Accettata · **Commit**: `aed0105` (rilascio 0.7.1 `cf6ee0b`) · **File**: [src/components/ticket-desk-ambrosio.tsx](../src/components/ticket-desk-ambrosio.tsx), [src/lib/desk-ambrosio.ts](../src/lib/desk-ambrosio.ts), [src/app/api/admin/tickets/[id]/ambrosio/route.ts](../src/app/api/admin/tickets/[id]/ambrosio/route.ts)

### Contesto

Ambrosio già agisce sul ticketing (tool-call in chat, follow-up, take-over
SLA di livello 3) ma il DESK non gli dava spazio: l'operatore vedeva le
conseguenze (note di sistema, messaggi «da Ambrosio») senza potergli
chiedere nulla né capire cosa stesse facendo. Il piano del desk chiedeva
«Ambrosio AI deve essere presente in questa schermata».

### Decisione

1. **Tre tool di lettura** nel pannello della scheda (Fase 3):
   `riepilogo` (il filo in 5 punti), `risposta_suggerita` (bozza),
   `classifica` (priorità/stato proposti). Stessa catena provider e
   fallback di Ambrosio live, conoscenza dalle FAQ ufficiali (mai prezzi
   inventati), contesto costruito dal DB (`getDeskContext`: filo, lead,
   scheda cliente, impronte AI reali).
2. **La risposta suggerita si INIETTA nel composer** (`#reply-<id>` con
   evento `input` per i draft salvati): l'operatore edita e invia lui.
   L'AI non ha alcuna action di invio: il gesto finale è umano per
   costruzione UI, non per policy documentata.
3. **Le scritture restano dove sono**: il take-over SLA e il follow-up
   automatici restano nel cron (L3, config autonomia). Il pannello li
   MOSTRA (auto-pilota = impronte reali `ai_takeover_at`/`followup_sent_at`,
   non una promessa) ma non li attiva da lì.
4. **Audit totale**: ogni chiamata pannello è `ambrosio.desk.<azione>`
   con l'operatore richiedente e il provider usato — anche le fallite.
   Degrado onesto: AI spenta → 503 RFC 7807 con motivo leggibile nel
   pannello, mai un 500 secco.

### Alternative considerate

- **Auto-pilota dal pannello** (bottone «prendi il controllo»): utile ma
  mescola i due modelli (tool su richiesta vs autonomia schedulata) prima
  di capire come si usano insieme; resta candidato evolutivo.
- **Chat con Ambrosio nella scheda**: un secondo canale di conversazione
  dentro il primo — il pannello a tool è più prevedibile e già coperto
  dall'audit.
- **Generazione automatica del riepilogo** (server-side, cached): costa
  token su ogni aggiornamento anche quando nessuno guarda; su richiesta
  l'operatore paga (attenzione) solo ciò che usa.

### Conseguenze

- **Positive**: Ambrosio è presente dove il piano lo voleva, con vincoli
  di sicurezza già collaudati (whitelist, audit, provider chain); il
  degrado senza chiavi AI è parte del contratto, non un errore.
- **Negative**: la classifica è proposta, non azione — l'operatore deve
  comunque applicarla a mano (due gesti invece di uno).
- **Trade-off**: controllo umano vs velocità — scelto il controllo; il
  tool «applica classifica» esiste come evoluzione naturale se il tasso
  di accettazione delle proposte lo giustifica (misurabile dall'audit).

---

## ADR-005: L'auth admin una volta per richiesta

**Status**: Accettata · **Commit**: `1ceea66` · **File**: [src/lib/admin.ts](../src/lib/admin.ts), [src/lib/users.ts](../src/lib/users.ts), [src/app/admin/layout.tsx](../src/app/admin/layout.tsx) · **Sentinella**: [tests/admin-perf.test.mjs](../tests/admin-perf.test.mjs)

### Contesto

Le pagine di backend erano lente al caricamento e al cambio pagina, e la
Free cache non poteva nulla: ogni pagina /admin è `force-dynamic` (le
decisioni del desk devono essere vere al click), quindi non esiste cache
da svuotare. Il costo reale era altrove: una navigazione eseguiva
**3-4 SELECT identiche su Neon** PRIMA delle query della pagina —
`requireAdmin()` della pagina + `getAdminUser()` del layout + il secondo
`getAdminUser()` dentro `getAppUser()` (per il ruolo in nav), tutte letture
della stessa riga `admin_users` con round-trip su database remoto. Sul
dettaglio ticket la chat faceva polling ogni 4s e ogni rinfrescata RSC
ripagava l'intero pedaggio d'auth: il caricamento sembrava lento «perché
sì», non per le pagine.

### Decisione

1. **`loadAdminRow` memoizzato con `cache()` di React** (lib/admin.ts): la
   riga `admin_users` dell'email di sessione si legge UNA volta per
   richiesta HTTP; i chiamanti multipli (`getAdminUser` della guardia,
   quello del layout, quello dentro `getAppUser`) si dividono la stessa
   Promise. L'ambito resta la singola richiesta: richieste diverse
   riverificano impronta e attivazione sul DB — la semantica di revoca
   (password cambiata, account disattivato, utente cancellato) è identica
   a prima.
2. **Il recupero dal socket morto vive nel loader**: stessa regex dei
   transienti che c'era in `getAdminUser` (blip Neon: proxy che chiude gli
   idle, «select 1» di risveglio, secondo tentativo). Una proprietà del
   loader invece che un percorso ripetuto a mano: anche il secondo
   chiamante di una richiesta ne eredita il beneficio.
3. **Contratto `{ ok, rows | reason }`**: il loader distingue «verificato
   e assente» dal fallimento infrastrutturale e restituisce il motivo dei
   rigetti (`db_non_configurato`, `db_errore_non_transient:…`,
   `db_persistente:…`) che `getAdminUser` registra in audit come sempre —
   stessa telemetria `session.rejected`, una query sola.
4. **`getAppUser` non raddoppia l'identità**: chiama `getAdminUser()` (ora
   deduplicato) e paga solo la sua `select *` completa — il layout con
   area personale passa da 3 letture d'auth a 2 query totali.

### Alternative considerate

- **Sessione in cache cross-request** (TTL di minuti): stravolge la
  rivocabilità immediata che è la sostanza del fingerprint su DB; rigettare
  un account disattivato «subito» è un requisito, non un lusso. Scartata.
- **Togliere `getAdminUser` dal layout** (usare solo requireAdmin): cambia
  il contratto della nav per risparmiare poco — con la memoizzazione il
  costo extra è zero e i due ruoli restano espliciti.
- **Abilitare Cache Components / PPR sull'admin**: le pagine del desk sono
  per natura dinamiche (contatori SLA, takeover, polling); il guadagno
  sarebbe stato marginale e il progetto non ha `cacheComponents: true`.
  La Free cache resta il tool per le superfici pubbliche.

### Conseguenze

- **Positive**: ogni navigazione admin risparmia 2-3 round-trip su Neon;
  il polling del dettaglio ticket non paga più l'auth quattro volte;
  il percorso di recupero dal blip è unico, non duplicato.
- **Negative**: il contratto del loader è un po' più ricco di una semplice
  query (convenzione `{ ok, rows | reason }` da rispettare); un'annotazione
  in più da conoscere per chi tocca l'auth.
- **Trade-off**: memoizzazione per richiesta vs zero dedup — scelto il
  richiest-scope: è il solo livello che non tocca la semantica di revoca.
  La sentinella [tests/admin-perf.test.mjs](../tests/admin-perf.test.mjs)
  impedisce che qualcuno riporti la query dentro `getAdminUser`.

### Estensione 2026-10-01: content_settings una query per richiesta

Lo stesso schema si applica alle tre chiavi lette più spesso
(`ticket_sla_policy`, `chat_emoji_picker`, `ticket_quick_replies` in
[src/lib/tickets.ts](../src/lib/tickets.ts)): un unico `select key, value
where key = any(...)` memoizzato (`memoizedSnapshot`) al posto di tre query
che nella stessa pagina si ripetevano (la inbox con la SLA policy, la scheda
con le risposte rapide, il sito pubblico con le emoji). La chiave della
memoizzazione è la **versione del processo**: le action che scrivono queste
chiavi (`saveSlaPolicy`, `saveChatEmojis`, `saveQuickReplies` in
[src/app/admin/actions.ts](../src/app/admin/actions.ts)) la incrementano
con `bumpContentSettingsVersion()` dopo l'upsert, così il render della STESSA
richiesta (quello che segue `revalidatePath`) rilegge fresco invece di
rispettare lo snapshot — niente valori stanti a video dopo il salvataggio.
Il contratto è pinnato dalla stessa sentinella. Nello stesso commit
(`293ff6a`) nasce anche la migration 044 (vedi ADR-006, nota locale).

---

## ADR-006: L'audit dice il passato, il flag decide il futuro, la dedup è sacra

**Status**: Accettata · **Commit**: `aed0105` (rilascio 0.7.1 `cf6ee0b`) · **File**: [src/lib/desk-autopilota-shared.ts](../src/lib/desk-autopilota-shared.ts), [src/lib/takeover-shared.ts](../src/lib/takeover-shared.ts), [src/lib/desk-ambrosio.ts](../src/lib/desk-ambrosio.ts), [src/lib/ai-tools.ts](../src/lib/ai-tools.ts), [neon/migrations/041-audit-autopilota-index.sql](../neon/migrations/041-audit-autopilota-index.sql), [neon/migrations/042-followup-disabled.sql](../neon/migrations/042-followup-disabled.sql) · **Sentinelle**: [tests/desk-autopilota.test.mjs](../tests/desk-autopilota.test.mjs), [tests/takeover-origin.test.mjs](../tests/takeover-origin.test.mjs)

> Nota locale: in questo repo il pannello di lettura (ADR-004) e le
> scritture di questa ADR sono arrivati insieme in `aed0105`; in Crema
> sono commit separati. Le regole valgono comunque per ogni futura
> scrittura che tocca il pannello o il cron.

### Contesto

ADR-004 aveva chiuso il pannello Ambrosio alla sola lettura: il take-over SLA
restava nel cron e il pannello lo mostrava. L'uso reale ha chiesto il passo
successivo — il team vuole POTER prendere (o lasciare) il filo a mano, escludere
il follow-up su un singolo ticket e farlo partire subito. Tre azioni di
scrittura su una macchina che già scrive da sola: senza regole condivise,
takeover manuale e cron si contendono la stessa colonna, "disattivare" diventa
cancellare un'impronta (riarmando l'automatismo) e nessuno sa più CHI ha
preso il filo.

### Decisione

Tre regole, una per domanda:

1. **L'audit dice il PASSATO.** Chi ha preso il filo non si indovina dalla
   colonna (`ai_takeover_at` è identica per cron e operatore): si legge dalla
   storia append-only — «l'ultimo evento `ambrosio.desk.autopilota_on/off`
   del ticket» decide manuale vs SLA (copre anche on → off → ri-claim del
   cron; i takeover pre-toggle restano etichettati SLA: è la verità dei
   dati). La lookup per riga della inbox esige l'indice
   `(target, action, created_at desc)` della 041 e il cast `c.id::text`
   (target è TEXT, id è UUID — beccato a runtime). La chip «a mano»/«SLA»
   e la ripartizione nel KPI rendono l'attribuzione visibile dove si decide.
2. **Il flag decide il FUTURO.** Escludere il follow-up NON tocca
   `followup_sent_at` (l'impronta è storia: cancellarla riarma il cron): la
   042 aggiunge `followup_disabled_at`, che il cron rispetta DUE volte
   (selezione candidati E claim — anti-corsa col toggle). È colonna, non
   query sull'audit: un filtro di selezione ha bisogno di una condizione
   O(1), l'audit si legge per attribuire, non per filtrare in caliente.
3. **La dedup è SACRA.** UN follow-up per ticket, da chiunque parta: il
   ramo manuale («invia follow-up ora») scavalca solo il flag di esclusione
   — quello ferma l'automatismo, non la mano dell'operatore — MAI
   `followup_sent_at`. Stesso contratto per il takeover: il pannello e il
   cron scrivono la STESSA impronta. L'audit registra comunque la differenza:
   `ambrosio.desk.followup_now` con l'operatore, distinto da
   `cron.lead-followup` di sistema.

Il meccanismo di custodia: i piani puri (`desk-autopilota-shared.ts`,
`takeover-shared.ts`, zero import, verificati da `node --test` senza DB) e
le sentinelle che incrociano scrittore e lettore — se il toggle cambia un'
azione d'audit, la suite rompe prima che l'attribuzione in inbox tacca.

**Nota locale (indice 044)**: in questo repo la
[044-audit-action-index.sql](../neon/migrations/044-audit-action-index.sql)
(stesso commit `293ff6a` dell'estensione ADR-005) aggiunge
`(action, created_at desc)`: la 041 parte da `target` e non serve alle
letture «ultimo evento per azione» degli hub strumenti (stato backup, ultima
purga cache, test Turnstile, ultimo sync Notion); senza 044 ogni
caricamento degli hub paga una scansione del log che cresce nel tempo.
Additiva e idempotente, come le altre.

### Alternative considerate

- **Attribuire con il flag**: una colonna `takeover_manual` accanto a
  `ai_takeover_at` sarebbe più veloce da leggere, ma duplica la verità —
  l'audit esiste già, è append-only e porta CHI l'ha fatto; una colonna in
  più va sincronizzata e può mentire. Scartata.
- **"Disattivare" = cancellare `followup_sent_at`**: immediato e sbagliato —
  la dedup è l'anti-spam del cliente; cancellarla riarma il cron e un bug
  di timing invia il secondo messaggio. Scartata su presenza umana.
- **Segnalare l'esclusione solo nella scheda**: l'operatore della inbox
  sarebbe rimasto all'oscuro della promessa (niente follow-up a venire) —
  da qui il badge accanto alla chip, vivo anche SENZA chip (il badge parla
  del futuro, la chip del presente).
- **Permessi distinti per le azioni di scrittura**: oggi l'admin è unico
  per progetto; distinguere «chi può attivare l'auto-pilota» è prevenzione
  per il giorno in cui gli operatori saranno ruoli diversi — l'audit ha
  già tutte le informazioni per farlo.

### Conseguenze

- **Positive**: ogni impronta di Ambrosio sulla coda è attribuibile a CHI
  l'ha messa (cron o operatore, con nome); niente riarmi occulti; le
  sentinelle rendono la divergenza tra toggle, cron e inbox impossibile in
  suite; Neon ha già indice (041) e colonna (042) al loro posto.
- **Negative**: tre regole da conoscere prima di toccare il pannello o il
  cron (questo ADR è la reference); l'attribuzione dipende dall'audit che
  NON si può pulire — un test che scrive audit su produzione inquina
  l'attribuzione per sempre (append-only è anche questo).
- **Trade-off**: verità unica vs costo d'indirizzamento — la scrittura
  passa dal piano puro e la lettura dall'audit con indice; si paga una
  subquery per riga della coda (O(log n) con l'indice) per non duplicare
  mai lo stato.

---

## Registro delle revisioni

| Data | Evento |
|---|---|
| 2026-10-02 | ADR-007 creata per il gemello: policy di rendering — ISR/SSG prima di SSR, header di cache espliciti sulle rotte di config del proxy (manutenzione 600 s, SEO 3600 s), CDN come proxy (Cloudflare) valutazione aperta — dall'appunto di progetto sui rendering strategy; ISR live dal rilascio 0.8.0 (`9861260`). Il documento è l'adattamento gemello di `docs/ADR.md` di WebAgencyCrema (stesse decisioni, riferimenti di questo repo) |
| 2026-10-02 | ADR-001 e ADR-003 registrate per questo repo: adapter registry e webhook idempotenti — Fase 4 (Meta) e i social mancanti (facebook, linkedin) in un colpo solo: la migration 040 è l'unica, già completa (`9861260`; in Crema la stessa decisione è 040 + 045) |
| 2026-10-02 | ADR-002 registrata per questo repo: identità cliente unificata — `clients-shared.ts` gemello-pari via twin-sync, presente dal clone iniziale (`13c798b`, 2026-09-29) |
| 2026-10-01 | ADR-006: audit come fonte del passato, flag per il futuro, dedup sacra — toggle manuale, attribuzione in inbox, esclusione del follow-up e «follow-up ora» (`aed0105`, release 0.7.1 `cf6ee0b`); nota locale: indice 044 `(action, created_at desc)` per le letture per-azione degli hub (`293ff6a`) |
| 2026-10-01 | ADR-004: Ambrosio come superficie di tool — pannello nella scheda ticket (`aed0105`, 0.7.1) |
| 2026-10-01 | ADR-005 esteso: anche content_settings (SLA policy, emoji chat, risposte rapide) una query sola per richiesta, con bump di versione nelle action di scrittura (`293ff6a`) |
| 2026-10-01 | ADR-005: memoizzazione auth admin per richiesta (`loadAdminRow` con `cache()` di React) — il caricamento /admin non paga più 3-4 SELECT d'auth per navigazione (`1ceea66`) |
| 2026-09-30 | ADR-001..004 estratte dal piano desk approvato; Fasi 1-4 realizzate, Fase 5 (outbound social + API REST OpenAPI) pianificata (valutazione in [tickets-redesign-assessment.md](tickets-redesign-assessment.md)) |
