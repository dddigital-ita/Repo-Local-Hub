# Valutazione redesign sezione /admin/tickets

> Richiesta: valutare un «cambio completo» della sezione ticket. Metodo
> (design-brief): le decisioni passate del progetto sono **prove**, non
> rumore — prima si legge cosa esiste e perché, poi si giudica. Skill
> applicate: design-brief, dashboard-brief, design-principles,
> web-component-design, architecture-patterns, version-control-strategy.

---

## ⚠️ Revisione post-screenshot (30/09, versione 0.5.2)

Rivista **dopo gli screenshot reali** di inbox e dashboard (sessione admin
dev). Onestà prima dell'orgoglio: **uno dei 4 punti era sbagliato** e un
secondo era sovrastimato. Il codice lo diceva, io non avevo guardato il
rendering:

- **Punto 2 (pill SLA) — RITIRATO.** La pill «in ritardo» ESISTE GIÀ sulle
  righe (screenshot: #28, #10, #13… con pill rossa). E l'assenza
  dell'ambra è una decisione documentata in codice:
  «sla.label !== "entro SLA"» — la pill appare SOLO se dice qualcosa
  ([page.tsx:327-332](../src/app/admin/tickets/page.tsx#L327-L332)).
  Proporre «aggiungere la pill SLA» era proporre ciò che c'è già.
- **Punto 1 (link dashboard) — DOWNGRADE a nice-to-have.** Il link nel
  sottotitolo è visibile nello screenshot e la dashboard è già
  **nella palette ⌘K** (test «le nuove destinazioni sono nella palette
  ⌘K»). Un terzo bottone nell'header violerebbe la regola documentata
  «UNA sola CTA primaria» e affollerebbe un header già bilanciato.
- **Punto 3 (età relativa) — CONFERMATO ma marginale.** Le righe mostrano
  la data assoluta («30 set, 05:59») e i bucket OGGI/ieri raggruppano;
  l'età relativa («3gg») sarebbe leggermente più scansionabile. Nice-to-have.
- **Punto 4 (estrarre TicketQueueRow) — CONFERMATO.** È l'unico
  intervento con valore netto: salute del codice, zero cambiamento visivo,
  riuso da clients/[id].

### Verdetto revisionato

**Non procedere con i 4 restyling.** La sezione, vista a schermo, è più
matura di quanto la prima stesura suggerisse: inbox scansionabile con SLA
visibile, dashboard eccellente e già scopribile, convenzioni coerenti. I
due interventi che restano sensati, SOLO se ne senti il bisogno:

1. **Estrarre TicketQueueRow** (punto 4) — refactoring puro, nessun
   cambiamento visivo, E2E come rete di sicurezza. Vale per la manutenibilità.
   ✅ **ESEGUITO** (commit `5bc60a1`, 0.5.2): riga in
   [src/components/tickets/TicketQueueRow.tsx](../src/components/tickets/TicketQueueRow.tsx),
   page.tsx 475 → 352 righe, screenshot prima/dopo identici, suite 339/339,
   E2E ticket 5/5 + 13/13 su DB throwaway. Riuso pronto da
   /admin/clients/[id].
2. **Età relativa sulla riga** (punto 3) — solo se Daniele/Michele la
   chiedono; un cambiamento visivo si giustifica con un utilizzatore che
   lo chiede, non con un documento. ✅ **ESEGUITA su richiesta** (commit
   `759f579`): la regola vive in tickets-shared.ts (zero import, unit
   test dedicato), la riga mostra la forma breve accanto alla data
   assoluta (che resta, con title).

Il «cambio completo» resta respinto per le prove qui sotto, che gli
screenshot rafforzano (la dashboard implementata segue il brief quasi
1:1: 5 KPI, barre CSS senza librerie, filtri via URL).

---

## Verdetto (design-brief — Problem Statement)

**NO al cambio completo. SÌ a un restyling mirato di 4 punti**, se i
problemi che seguono ti riconoscono. Non è conservatorismo: è che il
«completo» distruggerebbe decisioni documentate che il codice difende con
test e sentinelle, e la sezione è **il percorso che fa vivere il sito** —
il flusso chat → ticket → cliente è coperto da E2E dedicati.

### Cosa chiede il problem statement vero

Un «cambio completo» non è un problema: è una soluzione senza problema
dichiarato. La domanda giusta (design-brief §Problem): *cosa non funziona
oggi per Daniele e Michele quando fanno triage?* Se la risposta è
«l'estetica», la sezione segue già il design system (glass, pill, notice);
se è «troppi click», si aggiorna la coda, non si rifà tutto.

### Le prove contro il completo

1. **Il brief della dashboard esiste ed è già implementato**
   ([dashboard-ticket-brief.md](dashboard-ticket-brief.md), §Verdetto): la
   lettura aggregata vive in `/admin/tickets/dashboard` *proprio per non
   sporcare la inbox*, che ha principio documentato «UN solo numero qui:
   l'azione dovuta» (commento in [page.tsx:129-133](../src/app/admin/tickets/page.tsx#L129-L133)).
   Un redesign che rimette grafici e KPI in inbox viola quel principio.
2. **Il dominio è già estratto**: `src/lib/tickets.ts` (918 righe) ha
   status, priorità, canali, policy SLA per priorità (`SLA_POLICY_DEFAULT`
   + override in content_settings), tier, filtri SQL. La pagina non è il
   sistema: è una vista. Rifarla non cambia la logica — cambia solo dove
   la si guarda.
3. **Tre spec E2E** (`tickets-inbox`, `tickets-dashboard`,
   `tickets-pagination`) + test unitari blindano comportamenti sottili
   (coda in catena con optimistic UI, gating ruoli, autoclose). Il costo
   reale di un completo è **riscrivere le asserzioni**, non il markup.
4. **Nessuna chart library per scelta**: budget bundle sorvegliato
   (sentinella 180 kB) e framer-motion già espulso dal first-load
   pubblico. Un redesign «moderno» che introduce recharts/3D in admin è
   una regression architetturale (web3d-integration-patterns si applica a
   esperienze 3D: qui non c'è alcun caso d'uso — niente di visivo da
   mostrare in 3D, e caricarlo in admin violerebbe il budget).
5. **Le convenzioni sono cotte**: `qs()` per filtri via URL (niente stato
   client), `STATUS_LABEL`/`CHANNEL_LABEL_IT` per le etichette (nessun
   token interno mostrato), pattern Panoramica per header, glass.tsx per i
   componenti. La coerenza tra le stanze admin È il design system.

---

## Principi per decidere (design-principles)

In ordine di priorità — ciascuno con il contro-esempio cheeva vietato:

1. **Il triage prima dell'estetica** — ogni riga risponde «cosa faccio
   adesso?» prima di «come stiamo?». *Contro-esempio vietato*: KPI card in
   inbox, sparkline sulle righe, grafici fuori dalla dashboard.
2. **Un numero, un posto** — le aggregazioni vivono in dashboard, l'azione
   in inbox. *Contro-esempio vietato*: «18 aperti» ripetuto in header, tab
   e righe (fuori da così: il commento in codice lo testimonia).
3. **Il dominio decide il markup** — status/priorità/canali arrivano da
   `tickets.ts` con le loro mappe di etichette e toni; mai letterali nella
   vista. *Contro-esempio vietato*: `t.status === "on_hold"` nel JSX per
   decidere un colore.
4. **URL è lo stato** — filtri, pagina e canale vivono nella querystring
   (`qs()`): refresh, link condiviso e ⌘K non si perdono. *Contro-esempio
   vietato*: `useState` per il canale attivo.
5. **Zero dipendenze nuove in admin** — barre CSS e tabelle bastano a
   questa scala (2 operatori, decine di ticket/settimana). *Contro-esempio
   vietato*: chart library, 3D, editor WYSIWYG.

---

## I 4 restyling che valgono (dashboard-brief + web-component-design)

Non un rewrite: quattro interventi difendibili uno a uno, ognuno con il
problema reale che risolve.

### 1. Il link alla dashboard è un'impercettibile (dashboard-brief §Filters)

Il discovery della dashboard oggi è **testo sottolineato nel sottotitolo**
([page.tsx:136-139](../src/app/admin/tickets/page.tsx#L136-L139)):
`text-slate-500` dentro una frase — chi fa triage non lo vede mai.
**Correzione**: un bottone a vetro nell'header accanto a «Nuovo ticket»
(`GlassLinkButton`, icona `BarChart3` — l'icona è già importata in
dashboard), con `variant="glass"` per non creare una seconda CTA primaria
(il conflitto «due blu affiancati» è già documentato in codice).

### 2. SLA non visibile a colpo d'occhio in coda (dashboard-brief §KPI)

La riga inbox mostra `slaTier` ma il tier è usato per l'ordinamento/logica;
il colore di pericolo vive solo nel dettaglio. **Correzione**: pill SLA
compatta sulla riga (rosso/ambra/verde in base a `slaTier`) con `title`
che spiega il target della priorità (`SLA_POLICY`). È la stessa semantica
dell'agenda SLA (test: «rosso per la scadenza violata, ambra per il carico
entro SLA») — zero regole nuove, solo esposizione.

### 3. La coda non parla di «quanto è vecchio» (dashboard-brief §Chart 4)

L'aging esiste in dashboard ma la coda lo nasconde. **Correzione**:
seconda riga della card con l'età in forma compatta («3gg», «2h») accanto
al canale — è la stessa informazione dell'ordinamento, resa leggibile
senza tabella.

### 4. Componenti riga estratti (web-component-design §Component API)

`page.tsx` inbox è 475 righe con la riga-ticket inline (~60 righe di JSX
annidato). **Correzione**: estrarre `TicketQueueRow` in
`src/components/tickets/` con props tipizzate (ticket, `channelMeta`, tier
SLA già calcolati server-side) — la pagina respira e la riga diventa
riusabile da `/admin/clients/[id]` (che mostra i ticket del cliente).
Nessun `forwardRef`, niente context: una riga server-rendered basta (il
pattern skill «single responsibility» qui si applica al JSX, non a un
design system generico).

### Cosa NON fare (esplicitamente)

- **Niente viste Kanban** per status: 7 stati × poche decine di ticket =
  pareti vuote; il drag-and-drop in server component è contro-natura e
  l'autoclose/waiting_customer non sono gesti da colonna.
- **Niente split-view inbox/detail**: la pagina dettaglio ha 300 righe di
  strumenti di triage (claim, priorità, note, callback); in un pannello
  laterale diventano un cassetto. Su mobile il flusso lista→dettaglio è
  già la scelta giusta.
- **Niente riorganizzazione dei percorsi**: `/admin/tickets` (inbox),
  `/dashboard` (aggregati), `/[id]` (dettaglio) mappano esattamente i tre
  verbi del triage: scegliere, misurare, risolvere. Le E2E li coprono così.

---

## Architettura: dove andrebbe toccato, se si tocca (architecture-patterns)

La struttura attuale è già esagonale nella sostanza: `lib/tickets.ts` è il
core di dominio (nessun import React), le pagine sono adapter, il DB sta di
etro tramite `db()`. I due debiti veri, se mai:

- **`getTicketDashboard` fa 15+ query in sequenza** (una funzione, 300+
  righe di SQL): è un use-case monolitico ma **misurato e testato** —
  spezzarlo in service per priorità è pulizia, non urgenza. Non farlo nel
  stesso PR di un restyling UI.
- **`ticketFilterSql` costruisce SQL con stringhe**: è centralizzato,
  whitelist-ato e testato — va bene così; un query-builder non aggiungerebbe
  sicurezza, solo indirezione.

Il test del confine giusto (architecture-patterns §Testing): ogni funzione
di `tickets.ts` è verificabile senza HTTP; le pagine no, e per quello ci
sono le E2E. Confine rispettato.

## Versionamento del cambiamento (version-control-strategy)

Se si procede con i 4 punti: **un branch per intervento** (non un mega-PR),
in quest'ordine di rischio crescente:

1. `tickets-dashboard-link` (1 file, zero test toccati)
2. `tickets-row-sla-pill` (1 file + snapshot E2E dell'inbox da aggiornare)
3. `tickets-row-age` (idem)
4. `tickets-row-component` (estração + entrambe le E2E inbox/clients)

Ogni step: suite unitaria + E2E verdi prima del merge, bump **minor** (la
versione del progetto è 0.5.1: nuovo componente = minor; niente breaking —
nessuna prop pubblica cambia). Changelog nel messaggio di commit, come le
convenzioni del repo (messaggi italiani, footer Codebuff). Le versioni
`was-0.5.x-backup` taggate restano il punto di rollback.

---

## Quality check della valutazione

- [x] Ogni proposta di cambiamento risolve un problema **evidenziato nel
      codice o nel brief esistente** (non presunto)
- [x] Il «completo» è stato valutato e respinto con prove, non gusti
- [x] I vincoli non negoziabili (budget bundle, E2E, principi in codice)
      sono citati alla fonte
- [x] Il piano alternativo è sequenziabile, committabile e rollback-abile
- [x] Nessuna dipendenza nuova proposta; nessun 3D/graph in admin

---

## Registro esecuzione (0.5.2)

| Fase | Stato | Commit | Note |
|---|---|---|---|
| 0 — Baseline verde | ✅ | — | suite 339/339, E2E ticket verdi, rollback su `was-0.5.2-backup` |
| 1 — Estrazione TicketQueueRow | ✅ | `5bc60a1` | markup identico, page.tsx −130 righe, screenshot prima/dopo uguali, E2E 5/5+13/13 |
| 2 — Età relativa | ✅ | `759f579` | forma breve («7h», «3gg») accanto alla data assoluta; regola in tickets-shared.ts con 6 unit test; E2E inbox 6/6 e clients 4/4 (voce portata dal riuso) |
| 3 — Link dashboard in header | ✅ | `759f579` | GlassLinkButton sempre variant="glass" (mai primaria, invariante CTA coperto da test); il link testuale resta nel sottotitolo |
| 4 — Bump/tag | ✅ | `b80cda2` | 0.5.3 taggata `was-0.5.3-backup` dopo la release: suite 350/350, E2E completa 83/83 su server fresco |

---

## Revisione post-confronto: WhatsApp contestuale nella inbox (30/09, 0.5.3)

Domanda: portare il bottone WhatsApp contestuale anche nella inbox
(oggi vive solo nella scheda cliente)? Metodo: confronto visivo delle tre
varianti su mockup (come per la revisione post-screenshot) + evidenze
sul DB dev, NON gusto.

**Evidenze:**

- Su 22 conversazioni aperte in dev, **0** hanno `wa_phone`: la riga
  inbox mostrerebbe zero bottoni — complessità in anticipo sul bisogno;
- Il dettaglio ticket ha GIÀ il bottone (pannello lead, [page.tsx:236]
  (../src/app/admin/tickets/[id]/page.tsx#L236)) e la scheda cliente lo
  porta dove il contesto è «lavorare questo cliente»: il gesto esiste a
  una click di distanza;
- Il costo tecnico è trascurabile (un `l.wa_phone` in TICKET_SELECT e la
  prop `whatsappLink` già pronta in TicketQueueRow) — non è il punto:
  il punto è il rapporto valore/rumore della riga.

**Varianti valutate sul mockup:**

1. **Pill nella riga stato** (dove la mette la scheda cliente) —
   RESPINTA: la riga stato è la zona già più affollata (stato + SLA +
   priorità); con WhatsApp diventa un muro di pill e l'emerald del
   bottone compete col verde dello stato (la stessa collisione di colori
   che la gerarchia CTA corregge a livello header);
2. **Icona compatta nella colonna azioni** («variante C») — TENIBILE:
   vive dove già si agisce («Prendi in carico» + menu ⋯), non tocca la
   lettura, target ≥ 40px, solo sui ticket con wa_phone;
3. **Status quo** — la riga resta minima e scansionabile.

**Decisione: STATUS QUO, variante C RINVIATA** (non respinta).

Il valore del bottone in riga è proporzionale a quanto spesso `wa_phone`
esiste: finché il canale WhatsApp è a 0, la inbox non guadagnerebbe
nulla e la riga porterebbe solo un ramo condizionale permanente. Quando
il canale partirà davvero e il triage chiederà il gesto rapido, la
variante C è il tratto minimo con cui implementarla: `l.wa_phone` in
`TICKET_SELECT`, `whatsappLink` passata dalla inbox (la prop esiste
GIÀ in TicketQueueRow dalla scheda cliente — commit 2cfc477), un test
E2E sul bottone contestuale. Trigger di riapertura: prime conversazioni
WhatsApp reali in produzione (il canale smette di essere a 0).

> **ESECUZIONE (30/09, 0.5.3):** la variante C è stata implementata su
> richiesta esplicita — `l.wa_phone` in `TICKET_SELECT`/`TicketRow`,
> helper `waTicketHref` promosso in tickets-shared (un solo costruttore,
> unit test), prop `whatsappStyle` ("pill" per la scheda cliente:
> rendering invariato; "icon" per la inbox: icona 36px in colonna azioni
> prima di «Prendi in carico»), E2E inbox 7/7 (bottone solo sulla riga
> con wa_phone, mai in pill) e clients 7/7 (nessuna regressione).
> Verificata sul rendering reale con un ticket WhatsApp di prova.

---

## Registro esecuzione (0.5.4)

| Fase | Stato | Commit | Note |
|---|---|---|---|
| 0 — Baseline verde | ✅ | — | suite unitaria verde, lint e tsc puliti, albero pulito su `main` |
| 1 — Variante C WhatsApp in inbox | ✅ | `8f03b26` | icona 36px emerald in colonna azioni solo sui ticket con `wa_phone`; `waTicketHref` unico costruttore (tickets-shared, 4 unit test); E2E inbox 7 test, clients 7/7 |
| 2 — Free Cache in Tools | ✅ | `c52c1c0` + `99fe380` | strumento /admin/tools/cache: svuota cache sito/app, purga selettiva per target e audit aging; 21 unit test dedicati; nessun conflitto con le aree ticket |
| 3 — Verifica in vivo | ✅ | — | walkthrough mobile inbox WhatsApp (390×844): meta mono-riga senza separatori orfani, tap-target ≥36px; ciclo di risposta su #33: badge «Attende risposta» → via, SLA «palla dal cliente», clock fermo (`sla_next_reply_due=NULL`), audit «ticket.risposta» |
| 4 — Bump/tag | ✅ | (questo commit) | 0.5.4 taggata `was-0.5.4-backup` dopo la release: unit 375/375, E2E completa 84/84 su DB ricreato (con in più il ciclo per-file 16/16, scripts/e2e-release-cycle.sh) |

---

## Capitolo porta E2E e canale vuoto (30/09, post-0.5.4)

### La porta contesa, poi convenzione per repo

Il pomeriggio del 30/09 la release è morta a metà **cinque volte**: server E2E
ucciso da SIGTERM durante le run (~exit 143 del webServer, senza crash nel
log). Diagnosi a posteriori: la porta 3100 era **terreno condiviso con il repo gemello
WebAgencyCrema** (stesso stack E2E copiato, stesso `reuseExistingServer: !CI`)
e le due automazioni si scambiavano la banda per propria — il gemello ha poi
documentato il caso gemello: server riusato ciecamente col DB sbagliato
(login «Credenziali non valide» al buio, due volte la stessa giornata).

Soluzione adottata qui, in convenzione con il gemello (due difese
indipendenti + sentinelle):

- **Porta derivata dal percorso** (`4122f70`): `scripts/e2e-port.cjs`,
  `3110 + sha1(path) % 80` (banda 3110–3189) — WebAgencyCrema → 3166,
  questo repo → **3135** *(aggiornamento 01/10: dal percorso reale deriva
  3168 — il 3135 era la derivazione del percorso della copia pre-rebrand)*;
  override esplicito `WAC_E2E_PORT` (deviazione
  dichiarata: prefisso per repo al posto del loro `E2E_PORT`). Il .cjs è
  CJS nativo per scelta: il config di Playwright traspira i .mjs della sua
  catena d'import (lezione del gemello, che ci ha risparmiato un'ora di
  debug) — e `eslint.config.mjs` spegne `no-require-imports` per `**/*.cjs`.
- **Guard come globalSetup** (`bf790a5`): `scripts/e2e-port-guard.mjs`
  ispeziona i processi in LISTEN sulla porta e fallisce la run PRIMA del
  primo test se il cwd è fuori dal repo (pid + rimedio nel messaggio);
  CLI con wrapper ESM per il controllo a mano. Prova integrale: intruso
  reale (http server con cwd=/tmp) → run morta in ~1s col messaggio del
  guard; senza intruso, run verde.
- **Sentinelle** (`758dfd6`): `tests/e2e-port-config.test.mjs` — fonte
  unica nei TRE punti d'uso del config (baseURL, webServer.command,
  webServer.url), nessun `localhost:3100` residuo, guard agganciato al
  globalSetup, porta 3135 deterministica in banda. E `tests/e2e-port-guard.test.mjs`
  (5 test con processi REALI: nostro/estraneo/CLI). Header di
  `e2e-dev-server.mjs` aggiornato con la porta d'esempio vera.
- **Corrispondenza col gemello**: `E2E-PORTA-3100-README.md` (la loro
  lettera) e `E2E-PORTA-3100-RISPOSTA.md` (la nostra risposta, tabella
  d'adozione punto per punto + deviazioni dichiarate). Entrambe untracked
  di proposito: corrispondenza tra agenti, non codice.

Lezione del pomeriggio: il riuso cieco non era l'unico vettore — le run
lunghe morivano per SIGTERM incrociati di chi considerava la porta sua.
La porta derivata toglie il problema alla radice; il guard rende il caso
residuo rumoroso al primo test. Il ciclo per-file con retry
(`scripts/e2e-release-cycle.sh`, nato la stessa sera) resta la rete di
salvataggio per kill esterni qualunque.

### Il fallback silenzioso del canale a zero (scoperto pulendo la demo)

Pulendo lo scenario demo WhatsApp (Giovanna/Carlo/Sara fuori dal DB dev,
una transazione, zero orfani), la verifica `?channel=whatsapp` ha mostrato
**le 22 chat web sotto l'URL del canale vuoto**, nessuna tab attiva. Causa:
la validazione `channelParam in channelCounts` degradava a «tutti» perché
il GROUP BY non ha chiavi per canali a 0 righe — la tab permanente c'era,
la validazione no. **Mascherato dai ticket demo**: finché il canale aveva
righe il filtro funzionava e il difetto era invisibile.

- **Fix 1 — validazione** (`f7b3c21`): i canali permanenti restano validi
  anche a count 0 → l'URL dice la verità e la lista mostra l'empty state;
  canale sconosciuto degrada ESPLICITAMENTE in «tutti». Spec
  `tickets-channel-empty.spec.ts` (5 test: tab attiva via aria-current,
  «Coda · whatsapp», empty state, zero card altrui, contrasto senza
  filtro, filtro web, sconosciuto→tutti). Registrata nel README
  (sentinella del registro verde).
- **Fix 2 — fonte unica** (`29f5336`): `KNOWN_CHANNELS` + `mergeChannelCounts`
  promossi in `tickets-shared.ts` (regole pure, zero import — il test su
  `tickets.ts` falliva perché quel modulo importa `./db` senza estensione,
  irrisolvibile da Node puro: è il confine architetturale del repo);
  `countTicketsByChannel` usa il merge (i permanenti a 0 anche senza DB);
  la pagina elimina la costante locale e importa dal dominio — validazione,
  tab e conteggi leggono la STESSA lista.

Stato dopo i due fix: `?channel=whatsapp` a zero → tab «WhatsApp 0» attiva,
empty state, zero card; i non-noti mantengono l'ordinamento per volume.
Unit 391/391 (7 nuovi sui canali), E2E canale-vuoto+inbox 12/12, lint e
tsc puliti, verificato live sul dev.

---

## Registro esecuzione (0.5.5)

La narrazione del pomeriggio (porta contesa, intruso reale, bug del canale
a zero) è nel capitolo precedente; qui solo la tabella di release.

| Fase | Stato | Commit | Note |
|---|---|---|---|
| 0 — Baseline verde | ✅ | — | unit 391/391, lint e tsc puliti, albero pulito su `main` |
| 1 — Porta E2E unica per repo | ✅ | `4122f70` | 3110+sha1(path)%80: questo repo 3135, gemello 3166; override `WAC_E2E_PORT`; eslint ok sui .cjs |
| 2 — Port-guard come globalSetup | ✅ | `bf790a5` | la run muore al primo test se sulla porta ascolta un altro repo; intruso reale respinto in ~1s; 5 test con processi veri |
| 3 — Sentinelle porta/config | ✅ | `758dfd6` | fonte unica nei 3 punti d'uso, niente 3100 residuo, guard agganciato, 3135 deterministica |
| 4 — Canale a 0: validazione | ✅ | `f7b3c21` | `?channel=` vuoto → tab attiva + empty state (mai «tutti» silenzioso); spec dedicata 5 test, nel registro README |
| 5 — Canale a 0: fonte unica | ✅ | `29f5336` | `KNOWN_CHANNELS`+`mergeChannelCounts` in tickets-shared (7 unit test); tab e conteggi dalla stessa lista |
| 6 — Registro del capitolo | ✅ | `1130043` | questo documento: evidenze, hash verificati, lezioni |
| 7 — Bump/tag | ✅ | (questo commit) | 0.5.5 taggata `was-0.5.5-backup`: unit 391/391, E2E completa **89/89** in run unica su DB ricreato (port-guard attivo in globalSetup), leak-guard 8 tabelle |

---

## Registro esecuzione (0.5.6)

| Fase | Stato | Commit | Note |
|---|---|---|---|
| 0 — Baseline verde | ✅ | — | unit 394/394, lint e tsc puliti, albero pulito su `main` |
| 1 — Ricerca onesta (wildcard LIKE letterali) | ✅ | `d049c5c` | `likeContains` in tickets-shared: `% _ \\` dell'utente letteralizzati su inbox e portafoglio; numero del ticket = uguaglianza esatta; 3 unit + spec search-edges 6 test (prefisso anti-collisione deterministico) |
| 2 — Tratto mobile inbox | ✅ | `2a71bbd` | overflow header 87px → 0 (via `shrink-0`, wrap onesto); icona WhatsApp nella card mobile (spostata per viewport, `active:` per touch); spec tickets-mobile 4 test (overflow, tap-target ≥36px, invarianti desktop); consenso cookie preimpostato nel contesto (il banner fixed intercetta i tap mobile) |
| 3 — Bump/tag | ✅ | (questo commit) | 0.5.6 taggata `was-0.5.6-backup` dopo la release: unit 394/394, E2E completa **99/99** in run unica su DB ricreato (port-guard in globalSetup, leak-guard 8 tabelle) |

---

## Fix CI da lezione del gemello (0.5.7, 30/09)

Il gemello individua con precisione lo stesso pattern anche qui, con un
aggravante: il nostro workflow portava il **copy-paste non rinominato**
`DATABASE_URL: …wac_e2e…` (il DB del GEMELLO) al posto di `was_e2e` — lo
step reset crea `was_e2e`, Next sarebbe puntato a un DB inesistente:
split-brain, la stessa famiglia del riuso cieco sulla 3100.

- **Causa (identica al gemello)**: il workflow passava `E2E_PGPASSWORD`
  ma non `E2E_DATABASE_URL`; spec E2E e leak-guard costruiscono il DSN
  d'ufficio SOLO quando la URL manca — e il DSN costruito in CI usa
  l'utente del runner (senza credenziali) → rifiuto alla prima query.
- **Fix** (workflow `overlay-guard.yml`): `E2E_DATABASE_URL` esplicita su
  ENTRAMBI gli step (reset + test), con `was_e2e` al posto di `wac_e2e`;
  verificata localmente la precedenza (il leak-guard onora la URL
  esplicita prima del DSN d'ufficio).
- **Nessun cambio di codice**: script e spec erano già corretti — era
  solo l'ambiente CI a non dare loro la variabile giusta.
