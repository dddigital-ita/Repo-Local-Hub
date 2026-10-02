# Ticketing Upgrade — tag, escalation, merge (migration 046)

> Rationale di design (struttura decision/context/options/evidence/
> reasoning/trade-offs/validation) per le tre feature implementate
> il 2026-10-02, più il piano della fase successiva (smistamento
> a regole + CSAT in-app) — documentato, NON implementato, per
> decisione esplicita.

## Scope

Implementato ora (per decisione utente): **tag + escalation + merge**.
Documentato per la fase successiva: **motore di routing** (round-robin
+ min-load + preferenza canale) e **CSAT in-app**.

---

## 1. Tag e vocabolario canonico

### Decision

Tag applicabili a un ticket (max 12, max 30 caratteri, kebab-case),
con un vocabolario canonico configurabile in Impostazioni → Vocabolario
dei tag (max 30 voci) che alimenta una datalist nell'editor dei tag.
Filtro `?tag=` nella inbox con pills nella toolbar.

### Context

La inbox aveva solo i canali come dimensione di organizzazione. Con
l'apertura di più fronti (preventivi, bug, commerciale) serviva una
categorizzazione leggera che non diventasse un campo libero caotico —
i tag sono etichette, non frasi.

### Options considered

1. **Campo libero senza vocabolario** — semplice, ma «preventivo»,
   «Preventivo», «preventivi» diventano tre tag diversi: il filtro
   perde senso e la ricerca futura degrada.
2. **Tassonomia fissa (categorie a scelta obbligata)** — rigida:
   ogni nuova categoria è una migration/una release. Scartata: il
   team è piccolo e i fronti cambiano in settimane.
3. **Vocabolario canonico + tag liberi** (scelta) — la datalist
   guida, ma l'agente può scrivere fuori vocabolario.

### Evidence

- GAP-ANALYSIS: categorizzazione assente dalla checklist
  «Azioni di Apertura e Smistamento» del brief.
- Lezione dalla bug del 30/09 (canale vuoto collassava in
  «tutti»): le dimensioni di filtro devono essere valide anche
  a zero (il filtro `?tag=` ignora i tag sconosciuti, non
  collassa).

### Reasoning

Un **solo** normalizzatore puro (`sanitizeTags`) per ticket e
vocabolario: due normalizzatori che divergono avrebbero prodotto
«preventivo immediato» (vocabolario) vs «preventivo-immediato»
(ticket), rompendo il filtro `?tag=`. La regola vive in
`tickets-shared.ts` (zero import, testata direttamente) perché
la usano sia il server (actions) sia il client (tag editor).
Il vocabolario è **vuoto di default** (a differenza delle risposte
rapide): i tag sono convenzione del team, non best practice
universale — prescriverli sarebbe rumore.

### Trade-offs

- La datalist non impedisce tag fuori vocabolario: è un aiuto,
  non un muro. Accettato — la coerenza la fa il normalizzatore,
  non il vincolo.
- 12 tag per ticket è un muro morbido: una card di chip oltre
  quel numero non si scansiona più.

### Validation plan

- `tests/ticketing-upgrade.test.mjs` (guard di sito): normalizzazione,
  dedup, cap, costanti, wiring delle action.
- E2E manuale: applicare tag → filtrare in inbox → verificare che
  un tag del vocabolario combaci con quello applicato.

---

## 2. Escalation a livelli

### Decision

Livello di escalation 0..3 su ogni ticket, con escalation_at timbrata.
Il pannello sul dettaglio sale di un livello per click; al livello 3
il pulsante scompare (non esiste un «oltre»).

### Context

Il desk oggi ha un solo livello: chi prende il ticket lo risolve o
lo lascia. Quando il problema serve competenze specifiche (tecniche,
amministrative) non c'era modo di segnalarlo né di misurarlo.

### Options considered

1. **Stato «escalato» booleano** — perde l'informazione: L1→L2 e
   L2→L3 sono passaggi diversi (il secondo è già grave).
2. **Campo testo libero** — non aggregabile, non filtrabile.
3. **Livelli numerici 0..3 con toni dedicati** (scelta).

### Evidence

- Brief §1: «Escalation: trasferimento a un livello di supporto
  superiore».
- Brief §2: la gestione richiede passaggi di mano, non solo stati.

### Reasoning

Il **viola** (non il rosso) per i livelli 1–2: il rosso è già
della priorità urgente — escalation dice «passaggio di mano»,
non «allarme»; due segnali diversi non condividono il colore.
`escalationLabel` dice «Livello 1» per 0: il livello base è lo
stato normale, non un fallimento. La regola è pura
(`nextEscalationLevel`) e la action la usa **prima** di scrivere:
il livello non lo decide la UI, la difende anche il server
(no-op silenzioso al massimo).

### Trade-offs

- Max 3 livelli: più livelli non si leggono più in un chip e
  significano processo troppo profondo per un team piccolo.
- L'escalation non cambia l'assegnatario: il passaggio di mano
  resta un'azione umana (assegnazione separata). Escalation è
  segnale, routing è azione.

### Validation plan

- Guard test: scala 0→1→2→3→null, non-lancia su input sporco.
- Audit nella timeline: ogni passaggio timbra livello e data.

---

## 3. Merge di duplicati

### Decision

Un ticket vivo si fonde in un altro (destinazione per **numero** o
per id). Il sorgente resta nel DB (chat e note restano leggibili)
ma esce da ogni lista; il suo dettaglio mostra un banner
«Ticket fuso in #N» con link alla destinazione. Guardia `canMerge`:
mai sé-stessi, mai sorgente già fuso, mai destinazione già fusa.
I ticket chiusi **possono** fondersi.

### Context

Lo stesso cliente apre due ticket per lo stesso problema (da due
canali, o per doppio invio). Rispondere a entrambi è ridondante e
spacca il filo della conversazione.

### Options considered

1. **Cancellare il duplicato** — perde la cronologia: note e chat
   del duplicato svaniscono, e l'audit dice poco.
2. **«Duplicato di» come link senza fusione** — i due ticket restano
   vivi in inbox: l'operatore deve comunque gestirli due volte.
3. **Merge soft** (scelta): sorgente marcato, destinazione assorbe
   l'attenzione, cronologia preservata.

### Evidence

- Brief §2: «Unione (Merge): fusione di due o più ticket duplicati
  aperti dallo stesso utente per lo stesso identico problema, così
  da evitare risposte ridondanti».
- Zendesk/Linear (riferimenti del brief) usano il merge soft con
  ticket sorgente reindirizzato.

### Reasoning

La destinazione si cerca **per numero**: è ciò che l'agente legge
in inbox e condivide a voce, non un UUID. L'anteprima di sola
lettura (`lookupTicketForMerge`) mostra numero, query, stato e
priorità della destinazione **prima** di confermare: chi decide
se il problema è «lo stesso identico» è l'agente, non un'euristica
— un merge sbagliato è più costoso di un click in più. I ticket
chiusi possono fondersi perché il caso tipico è il duplice aperto
per errore che si chiude nel ticket già risolto.

### Trade-offs

- Il merge NON sposta chat e note nella destinazione (restano nel
  sorgente, leggibili dal banner): spostare messaggi tra thread
  rompe l'integrità del ledger delle conversazioni. Accettato:
  la cronologia resta divisa ma raggiungibile.
- Nessun merge multiplo in blocco: un click, un ticket, un audit.

### Validation plan

- Guard test: `canMerge` su tutte le combinazioni di via libera.
- Wiring test: la guardia precede la scrittura di `merged_into`.
- E2E manuale: fondere → verificare banner, uscita dalla lista,
  audit nella timeline di entrambi.

---

## Fase successiva (documentata, non implementata)

### Routing a regole (smistamento automatico)

**Motore**: regole valutate in ordine su creazione del ticket:
1. **Round-robin** per reparto/competenza (chi tocca dopo l'ultimo
   assegnato del reparto).
2. **Min-load** (meno ticket aperti tra gli idonei).
3. **Preferenza di canale** (l'operatore che preferisce il canale
   di arrivo, es. WhatsApp).

**Forma**: tabella di regole in `content_settings` (come il
vocabolario dei tag), valutata da un modulo puro
(`routing-pure.ts`) testabile direttamente; l'assegnazione resta
sovrascribibile dall'agente (la regola propone, l'uomo dispone).
**Perché non ora**: le regole hanno senso con dati di carico reali
(operatori attivi, volumi per canale) — con volumi da zero, round-
robin e min-load sono indistinguibili dall'assegnazione manuale.
Prima i volumi, poi l'automazione.

### CSAT in-app

**Consegna**: sondaggio **in-app** (non via email): dopo la
risoluzione, al cliente che torna nella chat/thread viene proposta
la valutazione (1–5) con nota opzionale. Aggregato sul dashboard
ticketing.
**Perché in-app**: il cliente ha già il contesto aperto — non serve
un'email che il cliente potrebbe non riaprire; niente nuovo canale
di consegna da sorvegliare (deliverability, spam).
**Perché non ora**: serve il percorso cliente post-risoluzione
(thread riaperto, stato «risolto» visibile al visitatore) che non
esiste ancora — un sondaggio senza quel percorso non trova il suo
momento.

---

## File dell'upgrade (guard di sito — Crema)

- `neon/migrations/046-ticket-tags-escalation-merge.sql`
- `src/lib/tickets-shared.ts` — regole pure (esteso)
- `src/lib/tickets.ts` — query layer (tag counts, vocabulary, filtro)
- `src/app/admin/actions.ts` — 5 azioni (tag, escalation, merge,
  anteprima merge, vocabolario)
- `src/components/ticket-tag-editor.tsx` — editor chip + datalist
- `src/components/ticket-escalation-merge.tsx` — pannelli escalation + merge
- `src/app/admin/tickets/[id]/page.tsx` — pannelli + banner fuso
- `src/app/admin/tickets/page.tsx` — filtro `?tag=` + pills
- `src/app/admin/settings/tag-vocabulary/page.tsx` +
  `src/components/ticket-tag-vocabulary-editor.tsx` — vocabolario
- `src/app/admin/settings/page.tsx` — card hub vocabolario
- `src/components/admin-toaster.tsx` — toast dei nuovi salvataggi
- `tests/ticketing-upgrade.test.mjs` — guard (18 test)
