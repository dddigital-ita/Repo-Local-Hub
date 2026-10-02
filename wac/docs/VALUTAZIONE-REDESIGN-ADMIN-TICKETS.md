# Valutazione /admin/tickets — sette lenti, un verdetto

> Valutazione del 30/09/2026 su richiesta esplicita: «admin/tickets, valutare cambio
> completo» attraverso le lenti dashboard-brief, design-brief, design-principles,
> web-component-design, web3d-integration-patterns, architecture-patterns,
> version-control-strategy. Metodologia: inventario del codice reale (pagine,
> componenti, lib, test, storia git), difetti noti (UI-REVIEW-FINALE, GAP-ANALYSIS,
> ROADMAP-UPGRADE), verifica delle scelte già prese e documentate.
> Nessuna modifica al codice: solo valutazione e piano.

---

## 0 · Inventario reale (su cui le sette lenti lavorano)

| Pezzo | Stato | Note |
|---|---|---|
| `/admin/tickets` (inbox) | 475 righe | Coda 3 zone, polling 4s, filtri via query string, raggruppamento temporale |
| `/admin/tickets/dashboard` | 588 righe | Lettura aggregata nata da [docs/dashboard-ticket-brief.md](dashboard-ticket-brief.md), barre CSS (zero chart lib), confronto periodo precedente |
| `/admin/tickets/[id]` | 300 righe | Thread + note + azioni; la scheda cliente ([/admin/clients/[id]](../src/app/admin/clients/[id]/page.tsx)) esiste come livello parallelo |
| `lib/tickets.ts` | 918 righe | Motore: SLA, priorità, stati, LAST_SENDER_SQL, AWAITING_SQL |
| E2E | 3 spec | tickets-inbox, tickets-dashboard, tickets-pagination (Playwright, DB disposable) |
| Difetti noti | 10 in UI-REVIEW | Il maggiore: niente bulk actions né navigazione da tastiera; 8 minori con fix minimo già indicato |

Punto di partenza: la sezione NON è un progetto da rifare, è un prodotto maturo
con una revisione UX indipendente alle spalle e 3 spec E2E che la proteggono.

---

## 1 · dashboard-brief — «Il brief è già scritto e già implementato»

Il brief (Business Question, audience, refresh, sources, tool) esiste: è
`docs/dashboard-ticket-brief.md`, con verdetto «SÌ, pagina leggera senza librerie»
e 5 KPI + 5 chart + filtri via query string. La pagina 588 righe lo implementa:
le scelte contestate del brief (niente recharts, dashboard SEPARATA dalla inbox,
«UN solo numero qui») sono state prese e rispettate.

**Verdetto: OK.** Le uniche voci del brief rimaste aperte sono di dati, non di
dashboard (contatore riaperture: colonna assente, da non promettere — il brief lo
dice già). L'evoluzione giusta è aggiungere al brief il ciclo del portafoglio
(la coorte per tipo di `clientsTypeTimelinePure` esiste e testata), NON riprogettare.

## 2 · design-brief — «Il problema è definito; la richiesta di cambio no»

Un redesign ha senso solo con un problema dichiarato. Quelli documentati sono
tutti con fix minimi noti (bulk actions, `/` per la ricerca, titolo tab, bozza
composer, empty state). Nessuno richiede «cambio completo»: sommano ~2 giorni
di lavoro a piccoli step. Un redesign completo non risponderebbe a NESSUN
problema elencato: violerebbe il principio stesso del brief (partire dal
problema, non dalla soluzione).

**Verdetto: NO al redesign, SÌ ai fix minimi elencati come batch unico.**

## 3 · design-principles — «I principi esistono e il redesign li violerebbe»

I principi impliciti del progetto (dichiarati nel codice e nelle revisioni) sono:
«UN solo numero qui: l'azione dovuta» (inbox), «il colore è riservato all'azione»,
«il primo gesto in un click», «la verità nel DB, la pagina stampa». Un cambio
completo romperebbe tutti e quattro. I principi suggeriscono invece la regola di
decisione: **ogni modifica deve passare la prova del difetto** — si tocca se e
solo se c'è un difetto documentato (la lista c'è: UI-REVIEW §2).

**Verdetto: ribadire i principi, non riscriverli.** Proposta: portare i 4 principi
in un commento d'intestazione di `src/app/admin/tickets/page.tsx` (dove oggi
vive solo «UN solo numero») così sono leggibili da chiunque modifichi la pagina.

## 4 · web-component-design — «La composizione è sana; il debito è localizzato»

I pattern del progetto sono già moderni: server components per i dati, componenti
client solo dove serve interattività (7 componenti `ticket-*`), nessun prop
drilling profondo, ARIA presente, theming a token, framer-motion CONFINATO ai 4
componenti admin (sentinella in bundle-watch: le pagine tickets non ne importano).
La pagina inbox a 475 righe è densa ma leggibile; il debito vero è un altro:
la logica di raggruppamento temporale e di azione per-card vive nella pagina
anziché in componenti dedicati.

**Verdetto: NO al cambio, SÌ a un refactoring contenuto** (estrarre
`ticket-queue-group.tsx` e `ticket-card.tsx` SOLO se si toccano quei punti per
i fix; refactoring without cause è costo puro). Nulla che giustifichi una
libreria componenti dedicata o un design system nuovo: il vocabolario
glass-solid/pill/tone è già coerente in tutto l'admin.

## 5 · web3d-integration-patterns — «Non applicabile, e la sua lezione è già applicata»

La sezione ticketing non ha né avrà 3D/scroll-driven experience: la lente non è
pertinente al dominio. Ma la sua lezione ARCHITETTURALE centrale vale al 100% ed è
GIÀ stata paginata dal progetto: «un solo motore per proprietà, mai due librerie
che animano la stessa cosa» — è esattamente la decisione framer-motion (dieta
v0.6.1: CSS nativo nel pubblico, framer solo nei 4 componenti admin). Inoltre il
vettore flight RSC scoperto misura ciò che la skill chiama «render loop
invisibile» (costo che la metrica standard non vede).

**Verdetto: NON APPLICABILE al dominio; lezione architetturale già assorbita.**

## 6 · architecture-patterns — «L'architettura è già hexagonal-ish dove conta»

La separazione esiste e funziona: `lib/tickets.ts` (dominio + regole: SLA,
stati, priorità, SQL condiviso) / route + server actions (adapters) / pagine RSC
(view). Le regole pure vivono in `*-shared.ts` testate da node senza DB —
l'equivalente esatto degli in-memory adapters della skill (calendar-hub-shared,
clients-shared, tickets-shared). Il cron tick è non-bloccante e idempotente.
Il debito architetturale reale: alcune regole (es. AWAITING_SQL, raggruppamento
coda) sono stringhe SQL dentro il dominio invece di funzioni pure su righe —
accettabile a questa scala.

**Verdetto: architettura sana. Guardie già in piedi** (sentinelle, leak-guard,
route-get-purity). Non migrare a Clean Architecture formale: a questa scala
sarebbe cerimonia, non valore.

## 7 · version-control-strategy — «La strategia c'è: semver + release notes + backup»

Semver sul ticketing (0.6.3), tag annotati, GitHub Release con note aggregate,
backup zip per release, CHANGELOG tenuto, sentinelle di test come guardie di
regressione. L'E2E protegge inbox/dashboard/paginazione. Applicando la lente
restano DUE miglioramenti reali: (a) le milestone/label GitHub per associare
PR e issue alle fasi della ROADMAP (oggi 0 merge PR tracciati); (b) per le
prossime release, un workflow che crea automaticamente la draft release al push
del tag (proposta già avanzata oggi, non ancora implementata).

**Verdetto: strategia matura; due automazioni possibili, non necessarie.**

---

## Verdetto complessivo

**Nessun cambio completo.** Su sette lenti: unadice (dashboard-brief) trova il
brief già fatto e implementato; cinque (design-brief, design-principles,
web-component-design, architecture-patterns, version-control-strategy) trovano
maturità e advisano evoluzioni mirate; una (web3d) non è pertinente e lascia
solo una lezione già pagata dal progetto. Un redesign totale distruggerebbe:
10 punti forti verificati da revisione indipendente, 3 spec E2E, principi
prodotti da inciampi reali, per risolvere… nessun difetto elencato.

## Piano consigliato (in ordine, ognuno piccolo e a basso rischio)

1. **Batch di fix minimi** della UI-REVIEW §2 (.bulk, `/` ricerca, titolo tab,
   bozza composer, empty state, nota autore, skeleton 3s) — ~2 giorni, tutti
   copribili con estensione delle 3 spec E2E esistenti.
2. **Bulk actions** (il punto 1 della revisione, «funzione non grafica») — il
   UNICO cambio strutturale che vale il costo, perché risponde a un difetto
   documentato con impatto operativo (60+ ticket a mano).
3. **Tipi di ticket** (ROADMAP 4.3, già P1 in GAP-ANALYSIS) — colonna + select +
   filtro, pattern identico a client_type appena fatto (migration, costante
   tipizzata, sentinella).
4. **Coorte portafoglio nel dashboard brief** — aggiungere chart 6 alla
   dashboard riusando `clientsTypeTimelinePure` (barre CSS, zero librerie).
5. **Principi nel codice** — commento d'intestazione a page.tsx (mezz'ora).
6. **Automazione release** — workflow che apre la draft release al push del tag.

Cosa NON fare: redesign grafico totale, design system dedicato, Clean
Architecture formale, libreria di chart, 3D (ovviamente).
