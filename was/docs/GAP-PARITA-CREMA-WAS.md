# GAP-PARITA-CREMA-WAS — audit di parità funzionale col gemello

> **AGGIORNAMENTO 0.7.0 (01/10/2026)** — chiusi i gap B principali:
> CSS pubblico uniformato, backup-cloud, admin-telemetry + ADR-005,
> golive, cache unificata (scelta: modello Crema), twin-sync manifest +
> sentinella come blocco del drift. Restano aperti: desk Ambrosio UI +
> bulk bar, riconciliazione calendar-hub-shared, reverse-port in Crema
> dei moduli solo-Salento (§4) — proposti come 0.7.1/0.8.0.
>
> **AGGIORNAMENTO 0.7.1 (01/10/2026)** — desk Ambrosio UI atterrato
> (pannello, auto-pilota manuale, esclusione follow-up, follow-up ora,
> chip attribuzione, migrations 041+042): la voce 2 della proposta d'ordine
> è chiusa. Il bulk bar c'era già (0.5.7, variante con «tutti» che accende
> le checkbox). Restano: calendar-hub-shared, reverse-port (§4).
>
> **VERIFICA PARITÀ (01/10/2026)** — reverse-port (§4) completato:
> i 4 moduli solo-Salento sono in Crema con test e commit separati —
> ricerca onesta + canali condivisi (76b9421), troncamento onesto
> (dd65aee), TicketQueueRow (b3f6d8d), calendar-board (baabbc4);
> suite gemella 459/459. La prova produzione-like del tool Free cache
> (+ captcha) è verde su ENTRAMBI i gemelli con impianto identico al
> byte (server doppio fork :3105, config Playwright, spec, .env.e2e —
> cambia solo was_e2e/wac_e2e): **10/10 in 17,4 s per repo**, audit
> `cache.purga` riverificato via psql su entrambi. L'impianto prodlike
> diventa così lui stesso un contratto di parità, documentato nella
> CHECKLIST-FREE-CACHE-PRODUZIONE.md gemellata (3c12737 qui, b790920
> a Crema).
>
> **CHIUSURA TOTALE (01/10/2026)** — anche calendar-hub-shared è parità:
> il layer puro (week-math, slot liberi, parsing iCal, writer ICS) è
> contratto twin-sync (14 file identici) con test gemellati; le estensioni
> di Salento (LOCATION, eventi senza DTEND, brand ICS parametrico, freeSlots
> configurabile) sono superset additivi nel file condiviso, default = Crema.
> Il writer inline e il parser inline di Salento sono giubilati; la board
> usa la stessa week-math. Il blocco di coerenza statica del test vive nei
> blocchi per-repo (invarianti locali vere: qui anti-doublebook e audit
> nell hub, a Crema cron pull e gate L2/L3). **Il GAP di parità è chiuso:
> nessun capo residuo — il drift futuro è bloccato dal contratto (14 file)
> e dalle sentinelle in suite.**

> **Perché esiste**: l'utente segnala «temi grafici non aggiornati e cose
> mancanti rispetto a Crema». Questo dossier misura la distanza REALE tra
> i due repo (audited 30/09/2026) e classifica ogni divergenza, così il
> recupero diventa una routine twin-sync come per porta e CI.
>
> **Gemello audited**: `../WebAgencyCrema` (online). Risultato di sintesi:
> l'albero delle PAGINE è quasi identico (solo `/admin/tools/golive` solo
> gemello, `/admin/logout` solo qui) e i file del SISTEMA TEMI sono
> **identici al byte**. I gap veri stanno in moduli lib e CSS di feature.

## 1. I temi: diagnosi precisa

**Il sistema temi è in parità totale** — `theme.ts`, `theme-shared.ts`,
`theme-editor.tsx`, `/admin/tools/theme`, `tailwind.config.ts`: identici
al byte, compreso il fix «Contrasto AA --on-brand» del gemello (già qui).

Quindi «temi non aggiornati» significa due cose diverse, entrambe
risolvibili:

1. **Valori salvati nel DB**: i temi si configurano dall'admin
   (`/admin/tools/theme`) e vivono nel DB. Il sito gemello online ha
   valori scelti dopo il nostro clone. → Recupero: leggere le variabili
   CSS renderizzate dal sito gemello live (curl + `:root`) o ricopiare i
   valori dall'admin loro, e riapplicarli QUI adattati al brand Salento.
2. **CSS di feature parallele** (vedi §2): il gemello ha animazioni
   search-bar in CSS puro che qui non esistono; la pagina «sembra» più
   aggiornata. → Porting del blocco CSS + componenti.

## 2. Divergenze misurate (moduli con lo stesso nome)

| Modulo | Righe diverse | Classe | Cosa contiene la divergenza |
|---|---|---|---|
| `src/lib/site.ts` | 1209 | **A — brand** | Contenuti/SEO Salento vs Crema: lasciare |
| `src/lib/chat-script.ts` | 94 | **A — brand** | Città (Lecce vs Crema) e turni operatori: lasciare |
| `src/app/globals.css` | 172 | **B — sync-lag misto** | LORO: animazioni search-bar/search-chips in CSS puro («dieta bundle»). NOSTRI: `.no-scrollbar`, logo-variants, `hero-rise`. Da riconciliare prendendo il loro blocco search-bar |
| `src/lib/calendar-hub.ts` | 760 | **B — sync-lag** | Il gemello ha anche `calendar-hub-shared.ts` (mancante qui): evoluzione calendario da valutare |
| `src/lib/clients.ts` | 200 | **C — evoluzioni parallele** | Qui: likeContains, troncamento onesto. Loro: dominio tipo cliente. Convivono, da riconciliare a mano |
| `src/lib/tickets.ts` | 194 | **C — evoluzioni parallele** | Qui: ricerca onesta, mobile, wa_phone. Loro: bulk bar + desk Ambrosio. Convivono |
| `src/lib/ai-tools.ts` | 174 | **B — da audit** | Da discriminare: feature loro vs rebrand |
| `src/lib/admin.ts` | 116 | **B — da audit** | idem |
| `maintenance*`, `setup.ts`, `ai.ts`, resto | ≤46 | **B — da audit** | Divergenze piccole, audit rapido per classe |

## 3. Moduli SOLO nel gemello (qui assenti)

| Modulo/feature | Valore | Nota |
|---|---|---|
| `backup-cloud.ts` | **Backup su cloud** — feature operativa vera | Candidato porting |
| `admin-telemetry.ts` | Telemetria admin | Da valutare |
| `cache-purge.ts` + `cache-shared.ts` | Cache lato gemello | Noi abbiamo `cache-flush-*` (Free Cache, altro agente): confrontare i due modelli prima di toccare |
| `channel-registry.ts` | Registro canali | Probabilmente la stessa lezione dei nostri KNOWN_CHANNELS, refattorizzata: valutare il riuso |
| `desk-ambrosio.ts` + `ticket-desk-ambrosio.tsx` + `ticket-bulk-bar.tsx` | **Inbox evoluta**: selezione bulk + scrivania Ambrosio | Qui è appena arrivata `desk-autopilota-shared.ts` (lib, senza UI): il gemello mostra la UI target |
| `/admin/tools/golive` | Checklist go-live nello strumento | Utile per il deploy WAS: porting probabile |

## 4. Solo qui (il gemello NON ce li ha)

`TicketQueueRow` (riga condivisa + icona WhatsApp + mobile), `calendar-board`,
`logout-form` (fix logout fantasma), `cache-flush-panel` (Free Cache),
ricerca onesta (likeContains), troncamento onesto, port-guard + lettere
E2E-PORTA. — **Non è tutto da recuperare**: anche il gemello può copiare da qui.

## 5. Il metodo («come posso fare»)

Routine twin-sync, uguale a quella già usata per porta E2E e CI:

1. **Diff per feature** (mai file-blind): si porta la parte
   logica/CSS/feature, mai i contenuti brand.
2. **Rebrand al volo**: ogni stringa citante città/contatti/divisioni si
   adatta a Salento durante il porting.
3. **Test subito**: ogni feature portata arriva con la sua spec/unit come
   nel repo d'origine (o di più).
4. **Batteria + commit separato per feature**, registrato nel CHANGELOG.
5. **Riproccio con il gemello**: cosa qui-sole si propone a loro (come
   fatto con porta e CI).

## 6. Proposta di ordine

1. **Temi**: sincronizzare i valori DB col sito gemello live + portare il
   blocco search-bar CSS (chiude l'esempio dell'utente).
2. **Inbox gemello**: bulk bar + desk Ambrosio (la `desk-autopilota-shared`
   appena atterrata ne è la base; il gemello è il riferimento UI).
3. **backup-cloud** (+ eventualmente telemetry): operatività.
4. **calendar-hub + channel-registry**: riconciliazione più corposa, da fare
   con calma e test.
