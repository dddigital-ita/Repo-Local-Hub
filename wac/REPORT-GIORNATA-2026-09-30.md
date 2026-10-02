# Report di fine giornata — 30/09/2026

> Documento per il team, non committato. 65 commit su `main` tra i due thread
> di lavoro (identità DDDigital + thread parallelo performance). Tutti i
> workflow CI verdi, produzione allineata, due release pubblicate.

## 🚀 Rilasci

- **v0.6.4 → v0.6.5** (`46405a5`): il tool **Free cache** definitivo — purga
  a target, età della cache in scheda, E2E prodlike del flusso admin
  (login, quattro target, conferma a due fasi, audit verificato riga per
  riga). Tag `v0.6.4` e `v0.6.5` pubblicati su GitHub; backup completo
  pre-rilascio (`backups/wac-v0.6.5-20260930-181218`) e post-rilascio
  (`backups/wac-v0.6.5-20260930-201631`) con checksum verificati.
- **v0.6.6** (`1cb2cca`, thread parallelo): la serie **performance admin** —
  auth una volta per richiesta (memoizzazione `loadAdminRow`),
  `content_settings` deduplicato, telemetria dei tempi di rendering in
  audit — in produzione e CI-verde.
- **Anomalia di produzione risolta**: wac.dddigital.net serviva una build
  del 28/09 (deployment verdi in dashboard ma mai promossi, schema
  compatibile con un Instant Rollback attivo). Diagnosticato con sonde
  esterne (webhook 404 HTML con `x-matched-path: /404`, `clients.csv` e
  pagine nate dopo il 28/09 assenti), risolto con la promozione manuale
  dalla dashboard Vercel, riverificato end-to-end (webhook JSON, 401 sul
  CSV, verify-deploy 7/7).

## 🤖 Pannello Ambrosio: da sola lettura a comandabile

Il desk guadagna le scritture che servivano al team, con tre regole
formalizzate in **ADR-006** — *l'audit dice il passato, il flag decide il
futuro, la dedup è sacra*:

- **Auto-pilota manuale** (`eb35957`): cede o riprende il filo con
  conferma esplicita, scrive la stessa impronta del cron
  (`ai_takeover_at`) col lock anti-corsa `archived_at is null`; zero
  migration.
- **Esclusione del follow-up** (`140dd97`): flag `followup_disabled_at`
  (migration 042) rispettato DUE volte dal cron (selezione candidati E
  claim) — disattivare non tocca mai l'impronta `followup_sent_at`:
  nessun riarmo occulto del messaggio unico.
- **«Invia follow-up ora»** (`7b3606d`): pipeline del cron riusata (policy
  di canale, testo multilingua, release su fallimento); scavalca solo il
  flag, MAI la dedup — UN follow-up per ticket da chiunque parta. Blocchi
  di regola → 409 RFC 7807 col motivo nel pannello; audit
  `ambrosio.desk.followup_now` col nome dell'operatore.
- **Attribuzione in inbox** (`140dd97`, badge `eb5e3d2`): la chip dice
  «a mano» o «SLA» leggendo l'audit («ultimo evento `autopilota_*` del
  ticket», indice della migration 041 con cast `c.id::text`); la card KPI
  mostra la ripartizione; badge BellOff per i ticket esclusi, vivo anche
  senza chip (parla del futuro, non del presente).

Sentinelle: `tests/desk-autopilota.test.mjs` (16) e
`tests/takeover-origin.test.mjs` (7) — il contratto scrittore/lettore tra
pannello, cron e inbox è sorvegliato in suite.

## 🤝 Twin-sync: le funzioni dei gemelli restano gemelle

**Contratto + strumento + sentinella** (`ca24c3f`, brief in
`docs/BRIEF-FUNZIONI-CONDIVISE.md`):

- `twin-sync.json`: manifest di 9 file condivisi per contratto — solo
  moduli puri e strumenti; **mai contenuti, pagine o file admin**
  (proprietari futuri diversi).
- `scripts/twin-sync.mjs`: dry-run di default, `--check` (exit 1 se
  diverge), `--apply` (preserva i blocchi «per-repo» della destinazione:
  le costanti d'ambiente di ogni repo), `--from` per invertire.
- `tests/twin-sync.test.mjs`: la suite fallisce se un file contrattuale
  diverge senza sync — il drift non può più passare in silenzio.
- Il primo giro ha misurato drift **bidirezionale** e l'ha chiuso
  prendendo il meglio di entrambi: dal gemello il parser budget col
  suffisso «k» («5-8k €» = 8.000) e il loader CLI self-locating; verso il
  gemello la sezione client-type (038) e i moduli puri nuovi.
- Opzioni valutate: package npm privato (prematuro, è l'evoluzione se i
  gemelli crescono), monorepo (escluso dall'ownership), subtree/submodule
  (costo operativo). Le decisioni applicate sono annotate nel brief §8.

## 🟢 CI: da mai partito a sorveglianza completa

Il workflow «Overlay guard» era scritto «pronto per quando verrà
pubblicato su GitHub»: la prima giornata di push veri l'ha messo alla
prova e ha beccato tre difetti in ordine di profondità, curati in giornata
(ciclo sempre: log veri → cura come contratto → smoke locale → push):

1. **DSN E2E senza credenziali** (`eb35957` rosso → cura `0500780`): bene
   col Postgres locale in trust auth, rifiutato dal servizio CI —
   leak-guard e spec manutenzione ora ricevono `E2E_DATABASE_URL`
   completo, default «postgres se c'è password» allineato alla
   convenzione viva, `ADMIN_SESSION_SECRET` E2E esplicito (lezione
   post-mortem: in locale arriva da `.env.local`).
2. **Spec stantia** (`03f8143`): password-reset inseguiva il
   `GET /admin/logout` innocuo del 29/09 (cottura anti-prefetch «Esci») —
   ora usa il POST reale della nav via fetch.
3. **Actions su Node 20 deprecated** (`a4e24b5` + `a9616f0`): checkout,
   setup-node e upload-artifact a v7, runtime nativo Node 24 — zero
   annotazioni di deprecazione (resta solo l'avviso informativo GitHub su
   ubuntu-latest → Ubuntu 26).

**Serie finale: 5 commit consecutivi × 2 workflow, tutti verdi**
(Overlay guard ~13-14 min con E2E completo 94 passed e Postgres effimero;
Bundle watch ~1-2 min), su tre onde di lavoro diverse.

## 📦 Stato di chiusura

| Fronte | Stato |
|---|---|
| origin/main | Allineata, tree pulito, nessun lavoro in sospeso |
| Neon | 44 migration tracciate (038–042), locale = produzione, verificate via information_schema |
| Produzione | Build 0.6.6 servita, webhook omnicanale attivi, CI-verde |
| Documentazione | ADR-001..006 (il gemello ha firmato ADR-005), CHANGELOG completo di giornata |
| Backup | `wac-v0.6.5-20260930-201631` post-rilascio, checksum verificati |
| E2E port | Conflitto 3100 chiuso: porta derivata per repo (Crema 3166, gemello 3135), guard attivo |

## Aperti per domani (nessun blocco)

1. **Canali social nel gemello**: `channel-webhook-core.mjs` e
   `channel-registry.ts` sono in `future-candidates` del manifest — si
   sincronizzano quando il gemello adotta l'infrastruttura social.
2. **Pin degli SHA** delle actions al posto dei tag major (supply chain).
3. **Fase 5 del desk** (pianificata): outbound social via
   `channel_accounts` + API REST con OpenAPI — ADR-001 e il registry sono
   le fondamenta pronte.
4. **Eventuale package npm privato** (`@dddigital/wac-shared`): solo se i
   gemelli diventano 4+ o i moduli condivisi superano ~10 file — il
   manifest twin-sync è già il 90% dell'elenco.
