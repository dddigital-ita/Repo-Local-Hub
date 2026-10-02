# POST-MORTEM — Incidente del 28/09/2026: outage di dddigital.net

*Scritto il 29/09/2026. Stato: **incidente CHIUSO il 29/09 ore ~14:15** — verifica esterna completa superata (vedi sotto); resta solo la conferma del supporto FastComet sui limiti LVE e la questione DNS separata di casadellearti.net. **Update 29/09 ~17:50: l'app è online su Vercel** (`wac.dddigital.net`), tutte le verifiche di deploy superate — vedi sezione [Esito](#esito-app-migrata-su-vercel--neon-2909-1750) in fondo.*

### Verifica finale esterna (29/09 ore 14:15)

| Check | Esito |
|---|---|
| `dddigital.net` | 200, marker WordPress presenti ✅ |
| `www.dddigital.net` | 200 dopo redirect ✅ |
| PHP (`/wp-login.php`) | 302 (WordPress esegue) ✅ |
| `crm.dddigital.net` | 401 Basic Auth = protezione voluta, sito vivo ✅ |
| Script `_____wac-*.php` | 404 = bonificati ✅ |
| Cartelle Node in home | cancellate ✅ |
| `casadellearti.net` | NXDOMAIN: dominio non puntato nel DNS — **non riconducibile all'incidente** (nessun tocco a DNS); da verificare col registrar ⚠️ |

---

## Sommario (TL;DR)

Il 28/09/2026 alle ~23:30 (ora italiana) l'app **WebAgencyCrema** (Node.js/Next) è stata
deployata sull'account cPanel FastComet `dddigita` **registrando l'app sul dominio
principale**, dove risiede il sito WordPress di produzione `dddigital.net`. Passenger ha
intercettato tutto il traffico del dominio, mettendo offline il WordPress. Durante
l'installazione sono finiti nella home dell'account anche script PHP di supporto e
cartelle dell'app. La mattina del 29/09 il tentativo di usare il terminale ha rivelato un
secondo danno collaterale: **processi Node orfani** hanno esaurito i limiti CloudLinux
(PMEM/processi), bloccando anche PHP (503) e il terminale cPanel.

**Ripristino**: rimosso l'app dal pannello, restore della home da Backuply (backup delle
8:53 UTC del 28/09, 12 ore prima del danno), riavvio di PHP; pulizia dei file Node in corso.
**Prevenzione**: tre guardie nel codice + preflight + test, vedi [Misure adottate](#misure-adottate).

---

## Impatto

- **Sito principale `www.dddigital.net` offline** dalle ~23:30 del 28/09 alle ~11:00 del
  29/09 (**~11,5 ore**): i visitatori vedevano l'app Node (200 ma contenuto sbagliato) o
  errori, non il WordPress.
- **Area admin WordPress irraggiungibile** la mattina del 29/09 (503 su `/wp-login.php`)
  fino allo sblocco dei limiti LVE: le pagine in cache LiteSpeed continuavano a rispondere,
  mascherando parzialmente il problema.
- **Altri due siti sull'account** (`casadellearti.net`, `crm.dddigital.net`): non
  compromessi; i loro database MySQL non sono stati toccati (l'app usa PostgreSQL).
  (`casadellearti.net` non risolve nel DNS pubblico anche indipendentemente
  dall'incidente: questione registrar/DNS separata, da verificare.)
- **Nessuna perdita di dati WordPress**: il restore ha riportato i file allo stato delle
  8:53 UTC; contenuti pubblicati nelle 12 ore precedenti al backup da verificare
  (media upload e articoli del 28 pomeriggio).
- **Costo reputazionale**: sito vetrina dell'agenzia offline per mezza notte e mattina.

---

## Causa principale

**Registro dell'app Node sul dominio principale** in cPanel → Setup Node.js App
(Application URL = `dddigital.net`), dove la docroot è `public_html` con dentro WordPress.
Passenger, ricevuta quella registrazione, intercetta **tutte** le richieste del dominio e
le passa all'app Node: il WordPress restava sui dischi ma non riceveva più traffico.

La procedura di deploy dell'epoca (DEPLOY-CPANEL.md v0.5.0) **non vietava esplicitamente**
il dominio principale, **non prevedeva un controllo preventivo** sulla destinazione e
**non includeva una verifica post-deploy** che il WordPress principale fosse rimasto online.

**Fattori contribuenti:**

1. Account hosting **condiviso** tra più siti (3 WordPress + app Node): nessuna separazione.
2. Script PHP di supporto (`_____wac-kill.php`, `_____wac-npm.php`, `_____wac-move.php`)
   caricati in `public_html` per operare da web quando il terminale era scomodo: **esecuzione
   codice remota non autenticata** finché non cancellati — fortuna che nessuno li ha trovati.
3. **Processi Node orfani** dopo la rimozione dell'app: hanno consumato il budget
   PMEM/processi CloudLinux fino a bloccare PHP e terminale (secondo outage, ~mattina del 29/09).
4. Nessun monitoraggio esterno che avvisasse dell'outage notturno: scoperto per via
   incidentale la mattina dopo.

**Dati LVE CloudLinux (29/09, dal pannello Resource Usage):**

| Risorsa | Uso | Limite | Esito |
|---|---|---|---|
| PMEM | 134 MB | 3 GB | ok — la memoria NON è mai stata il problema |
| CPU (SPEED) | ~0% | 300% | ok |
| Entry Processes | 3 | 30 | ok |
| **NPROC (n. processi)** | **49** | **50** | **saturo (98%)** |

Fault **Nproc** ininterrotti dalle 01:34 del 29/09 (picco 636): l'account nega processi
nuovi da stanotte. **Il collo di bottiglia del piano è il numero di processi (50), non la
memoria.** Un'app Node su Passenger ne consuma tipicamente 10-15 da sola: con 3 WordPress,
una app è già al limite, 2-3 app sono insostenibili sul piano attuale. **Decisione
derivata: le app Node vivono fuori da questo account (Vercel), cPanel resta ai WordPress.**

---

## Timeline (ora italiana)

| Quando | Evento |
|---|---|
| 28/09 ~10:53 | Ultimo backup Backuply prima del danno (8:53 UTC) |
| 28/09 23:30 | Deploy: app Node registrata sul dominio principale; outage di `dddigital.net` |
| 29/09 ~09:00 | Scoperta dell'outage; analisi e apertura incidente |
| 29/09 ~10:00 | Rimozione dell'app da Setup Node.js App; avvio restore Backuply (solo file, no DB) |
| 29/09 ~11:07 | Restore completato: home torna 200 (ultima modifica sul disco 11:07) |
| 29/09 ~11:20 | Verifica esterna: `www` → 301 WordPress (OK), `dddigital.net` → 200 |
| 29/09 ~11:45 | `www` → **503**: processi Node orfani hanno esaurito i limiti LVE; PHP e terminale bloccati |
| 29/09 ~12:30 | Diagnosi CloudLinux (`cagefs_enter: Unable to fork`); aperto ticket FastComet |
| 29/09 13:30 | File Manager di nuovo operativo; individuati script `_____wac-*.php` in `public_html` e cartelle app in home |
| 29/09 in corso | Cancellazione file Node; attesa intervento supporto su processi/limiti |

---

## Cosa ha funzionato / cosa no

**A nostro favore:**
- Backuply aveva **60 backup** con l'ultimo utile 12 ore prima del danno.
- I **database MySQL dei WordPress non toccati** (l'app usa PostgreSQL su un DB dedicato).
- Il ripristino file-only ha evitato di perdere contenuti DB (commenti, articoli, ordini).
- Il sito in cache LiteSpeed ha continuato a servire le pagine pubbliche durante il blocco PHP.

**Contro:**
- Nessun **preflight** prima del deploy: la registrazione sul dominio principale è passata.
- Nessun **check post-deploy** sul sito principale: l'outage notturno non è stato colto subito.
- Gli script `_____wac-*.php` in `public_html` sono rimasti esposti per ore.
- Il **terminale** è diventato inutilizzabile proprio quando serviva (limiti LVE): la
  bonifica dei processi è passata inevitabilmente dal supporto.
- Il deploy è avvenuto di sera su un account condiviso con siti di produzione: la finestra
  giusta sarebbe stata di giorno, con verifica immediata.

---

## Ripristino (cosa è stato fatto)

1. **Rimozione app** da Setup Node.js App (pannello).
2. **Restore selettivo Backuply** del 28/09 8:53 UTC: solo file della home, **database
   esclusi** (intatti e già corretti).
3. **Verifica esterna**: 301 WordPress su `www`, 200 sulla home.
4. **Ticket FastComet** per kill dei processi Node orfani e controllo limiti LVE.
5. **Pulizia file** (File Manager, non terminale):
   - `public_html`: `_____wac-kill.php`, `_____wac-npm.php`, `_____wac-move.php`, `_____llms.txt`;
   - home: `_____webagencycrema/` (progetto Node completo con `.env.local`),
     `_____nodevenv/`, `_____.npm/`.
   - **Non toccati**: i tre WordPress (`public_html`, `casadellearti.net/`,
     `crm.dddigital.net/`), `.wp-cli/`, `.wp-toolkit/`, `_____cl.selector/`, `.htaccess`, DB.
6. **Da definire col supporto**: conferma kill processi, lettura dei fault LVE, eventuale
   adeguamento piano. L'eliminazione del database PostgreSQL dell'app è **rimandata di una
   settimana** dopo la chiusura: nessuna urga, consuma solo spazio.

---

## Misure adottate

Nel progetto (tutte implementate e **coperte da test** in `tests/deploy-guards.test.mjs`,
12/12 verdi; suite wizard 39/39):

| Misura | File | Cosa fa |
|---|---|---|
| **Preflight di destinazione** | `scripts/deploy-preflight.mjs` | Blocca il deploy su dominio principale (`DEPLOY_PRIMARY_DOMAINS`) e su qualunque WordPress rilevato via HTTP (marker wp-content/wp-json/generator, xmlrpc 200/405). Exit 1 = non deployare. |
| **Boot guard** | `server.js` | L'app **si rifiuta di avviarsi** in `public_html`/`htdocs` o in una docroot con ≥ 2 marker WordPress (wp-config.php, wp-admin/…). Override solo consapevole: `WAC_ALLOW_ANY_DOCROOT=1`. Testato con fixture reali. |
| **Guardia wizard** | `src/lib/setup.ts` → `docrootGuard()` | `runInstall` rifiuta l'installazione prima di scrivere un solo file, stessi criteri. |
| **Verifica post-deploy WP** | `scripts/verify-deploy.mjs --wp=URL` | Dopo ogni deploy controlla che il WordPress principale risponda (200/301); 5xx/errore = deploy fallito. |
| **Guida riscritta** | `DEPLOY-CPANEL.md` | Regola d'oro in testa (sottodominio dedicato, mai `public_html`), dati FastComet dell'operatore (localhost:5432, prefisso cPanel DB), checklist post-install con verifica WP principale, troubleshooting. |
| **GO-LIVE allineata** | `GO-LIVE.md` | Preflight come step 0; verifica WP principale come step 15-bis. |

**Da fare (prossime 2 settimane):**

- [ ] Monitoraggio esterno (es. UptimeRobot free su `dddigital.net` + `wac.dddigital.net`):
      alert email se non-200. Costo zero, avrebbe tagliato l'outage a minuti.
- [ ] **Cancellare gli script di emergenza** dalla checklist di fine deploy: nessun
      `_____wac-*.php` deve sopravvivere al go-live (aggiungere al GO-LIVE.md).
- [x] **Decisione presa (29/09, dai dati LVE)**: cPanel = solo i 3 WordPress; ogni app
      Node = un progetto Vercel (sottodominio solo nel DNS, CNAME). Niente nuove app su
      cPanel col piano attuale; eventuale ritorno solo dopo upgrade piano documentato
      (migrazione documentata in DEPLOY-CPANEL.md Parte 7).
      **Conferma supporto FastComet (29/09)**: «The NPROC limit for your account is 50 and
      cannot be increased since you are on a shared server» — upgrade «Extra» offerto
      (100 processi): scartato, il tetto resterebbe condiviso e le app Node su
      shared hosting non scalano coi progetti futuri.
- [ ] Backup WordPress **testato nel ripristino** almeno una volta (il restore di questa
      settimana conta: verificare però anche un restore MySQL completo su staging).

---

## Lezioni (le tre che contano)

1. **Su un account condiviso, la docroot del dominio principale è territorio sacro.**
   Qualunque app nuova vive in un sottodominio con docroot propria, sempre, senza eccezioni.
2. **La procedura scritta non basta: servono guardie nel codice.** Il preflight, la boot
   guard e la guardia del wizard esistono perché un errore umano alle 23:30 non possa più
   metter offline tre siti. E i test impediscono che le guardie regrediscano.
3. **Ogni deploy su produzione finisce con una verifica esterna** del sito principale e una
   pulizia degli artefatti temporanei (script PHP, env, lock). Ciò che resta dopo un deploy
   è superficie d'attacco o spazzatura che esplode la notte dopo.

---

## Esito: app migrata su Vercel + Neon (29/09, ~17:50)

Decisione post-incidente (vedi [COSTI-12-MESI.md](COSTI-12-MESI.md)): l'app non riparte
mai da cPanel — limiti LVE non alzabili su shared («NPROC limit is 50 and cannot be
increased», supporto FastComet) — quindi deploy su **Vercel Hobby** con DB **Neon**
(eu-central-1) e dominio `wac.dddigital.net` via solo DNS (cPanel tocca nulla).

Verifiche del 29/09 ore ~17:50, **tutte superate**:

| Check | Esito |
|---|---|
| DNS `wac.dddigital.net` | CNAME → `cname.vercel-dns.com` (Google + Cloudflare concordi), nessun record A FastComet ✅ |
| `https://wac.dddigital.net` | 200, SSL valido, `server: Vercel` ✅ |
| `dddigital.net` / `www` (WordPress) | 200 / 301 regolare, intatto ✅ |
| `/api/health` (entrambi gli URL) | `status: ok`, `database: ok` ✅ |
| Migration Neon | 37/37 tracciate in `schema_migrations` (32 dal setup + 5 applicate il 29/09: flash-notes, telegram-channel, google-calendar, telegram-config, service-kind) ✅ |
| Account admin | 1 super admin + 2 admin creati su Neon (credenziali consegnate all'utente, non nei documenti); `admin@localhost` mai esistito su Neon ✅ |
| `scripts/verify-deploy.mjs` con `--wp` | home/consulenza/sitemap/robots/health + marker DB + WP 200 ✅ |
| `/api/cron/tick` senza chiave | 401 unauthorized ✅ |
| `/api/cron/tick` con `CRON_SECRET` | 200, tutti i contatori a zero (DB pulito), idempotente ✅ |
| Cartelle Node in home cPanel | rimosse (resta solo `.cl.selector`, legittimo CloudLinux) ✅ |

**Nota operativa**: su Hobby Vercel il cron integrato scende a 1 esecuzione/giorno, quindi
le automazioni (SLA, follow-up, digest, email polling) richiedono un cron esterno che chiama
`https://wac.dddigital.net/api/cron/tick` con header `Authorization: Bearer <CRON_SECRET>`
(cron-job.org gratuito, ogni 15 minuti). Il secret sta nelle env Vercel, non nei documenti.

**Nota operativa per il DB**: il `.env.local` di sviluppo punta al **Postgres locale**
(`localhost:5432`, scelto da `scripts/setup-localhost.mjs`); il DSN di produzione Neon resta
nel commento «vecchio DSN» dello stesso file. Qualunque comando di manutenzione su Neon va
lanciato con override esplicito (`DATABASE_URL="<dsn Neon>" npm run db:migrate`), altrimenti
opera sul DB di sviluppo senza avvisare — è successo in questa sessione: il primo giro di
creazione admin è finito nel locale ed è stato ripristinato.
