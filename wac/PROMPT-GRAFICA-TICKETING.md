# Prompt — Upgrade grafico della GUI del Ticketing (livello Zendesk)

**Come usarlo:** incolla il blocco indicato nella **root del progetto WebAgencyCrema**
(`Progetti/01-Sviluppo/Web/Siti/WebAgencyCrema`) nel tuo agente AI (Buffy, Cursor, Claude, Codex…).
I prompt NON riscrivono il sistema: partono dall'analisi del codice esistente e migliorano
solo la **grafica e la GUI** (Next.js 15 + Tailwind + glassmorphism "aurora").
Ogni prompt è autonomo, ma l'ordine consigliato è quello in cui sono scritti (1 → 7).

**Regole valide per TUTTI i prompt (incollale sempre insieme al blocco scelto):**

> Regole operative (non negoziabili)
> 1. Prima di toccare un file, leggilo: capisci struttura, classi e convenzioni già usate
>    (glass-solid, aurora, status pills, `lib/tickets.ts` tone map, `ui.tsx`, `glass.tsx`).
> 2. Solo miglioramenti visivi e di UX: **nessuna modifica a schema DB, API, permessi, logica di stato**.
>    Se una funzione ti servisse, fermati e chiedi.
> 3. Nessuna breaking change: ogni componente esistente resta con lo stesso nome e le stesse props
>    (puoi aggiungere props opzionali).
> 4. Passi piccoli e verificabili: dopo ogni step lancia `npm run typecheck` e `npm run build`
>    e verifica in browser su `localhost:3000/admin/tickets` prima di proseguire.
> 5. Italiano nell'UI, commenti in italiano che spiegano il *perché*.
> 6. Accessibilità WCAG AA sempre: contrasto, focus visibili, aria-label, target ≥ 44px su mobile,
>    `prefers-reduced-motion` rispettato per ogni animazione che aggiungi.
> 7. Mobile-first: tutto ciò che progetti deve reggere da 320px di larghezza.
> 8. Non introdurre nuove dipendenze senza chiedere; usa Tailwind, framer-motion e lucide-react già presenti.

---

## PROMPT 1 — Audit grafico + Design System documentato (parti da qui)

```
Agisci come product designer senior specializzato in service desk B2B (Zendesk, Freshdesk,
Intercom) e come frontend engineer esperto di Tailwind CSS.

Contesto: questo progetto ha un admin Next.js 15 con design "Liquid Glass" (superfici
traslucide `.glass-solid` su fondo `.aurora`), palette brand blu (#3d72ec), font Geist Sans,
icone lucide-react, animazioni framer-motion. Il ticketing è in `/admin/tickets`.

Missione: FASE 0 di un upgrade grafico al livello Zendesk. NON riscrivere la UI:
1. **Audit visivo**: apri ogni pagina admin (panoramica, tickets, leads, callbacks, operators,
   settings…) e produci `DESIGN-AUDIT.md` con: screenshot-descrizioni dei punti deboli,
   incoerenze (spaziature, raggi, tonalità, pesi dei testi, usi duplicati di `ui.tsx` vs
   `glass.tsx`), gerarchie poco leggibili, stati mancanti (empty, loading, errore).
2. **Design token**: centralizza in `tailwind.config.ts` + CSS variables in `globals.css`
   una scala coerente già implicita nel codice: colori (brand + slate + semantiche
   success/warning/danger/info), spaziature, raggi (sm/md/lg/xl/3xl), ombre (glass set
   esistente), tipografia (h1/h2/body/caption/mono).
3. Sostituisci gradualmente i valori hardcoded con i token SOLO nelle pagine admin,
   senza cambiare l'aspetto: è un refactoring a resa visiva identica.

Fatto quando: `DESIGN-AUDIT.md` esiste, i token sono usati in `/admin/tickets`,
typecheck e build passano, la resa visiva è invariata.
```

## PROMPT 2 — Shell admin: layout a 3 colonne stile Zendesk

```
Agisci come frontend engineer specializzato in workspace service desk.

Contesto: oggi `/admin/tickets` è un layout a 2 colonne (lista 340px + dettaglio) dentro un
contenitore max-w-6xl, con nav sticky sopra. Zendesk usa una "workspace shell": sidebar di
navigazione verticale fissa a sinistra, header contestuale, area di lavoro che riempie
tutto il viewport con pannelli interni scrollabili indipendenti.

Missione: trasforma la shell dell'admin in una workspace professionale, SENZA toccare logica:
1. Valuta e proponi (prima in un breve piano testuale, poi implementa): nav laterale
   verticale compatta (icone + label, collassabile) vs nav orizzontale attuale migliorata.
   Scegli la soluzione che rispetta la beachhead mobile (320px) e la coerenza col resto
   del sito pubblico.
2. Su `/admin/tickets` desktop: layout a 3 zone — lista ticket scrollabile a sinistra,
   dettaglio al centro, il pannello Lead/Note come colonna destra persistente
   (oggi è `xl:grid-cols-[1fr_300px]` dentro il dettaglio: rendila parte della griglia
   della shell così non "salta" cambiando ticket).
3. Header contestuale del ticket (numero, stato, priorità, azioni) sticky sopra il dettaglio.
4. Pannelli con scroll indipendente: altezza viewport piena, `scroll-thin`, lista e
   conversazione che scrollano da sole mentre header e composer restano fissi.
5. Le altre pagine admin restano nel layout attuale: la shell nuova è solo per i ticket.

Fatto quando: su desktop la vista ticket sembra Zendesk (3 zone stabili, niente salti di
layout selezionando ticket), su mobile resta lo stack verticale leggibile, build e
typecheck passano.
```

## PROMPT 3 — Lista ticket: leggibilità e scannabilità

```
Agisci come product designer esperto di interfacce ad alta densità informativa (Zendesk,
Linear, Superhuman).

Contesto: la lista ticket in `/admin/tickets` è una colonna di card glass (`rounded-2xl`)
con: numero mono, badge "Attende risposta", badge SLA, oggetto, meta (autore · n msg ·
data), pills stato + priorità + assegnatario, bottone nascondi in alto a destra.

Missione: porta la lista al livello di densità e chiarezza di Zendesk/Linear SENZA
cambiare i dati mostrati né le query:
1. Riduci il "rumore": gerarchia tipografica netta (oggetto dominante, meta secondari),
   allineamenti coerenti, una sola riga di pills con peso visivo calibrato
   (stato > priorità > assegnatario).
2. Stato selezione più chiaro: bordo brand + barra laterale di accento + sfondo bianco
   pieno sul ticket selezionato, hover più deciso sugli altri.
3. Badge SLA "In ritardo" con semantica rossa e puntino pulsante (rispettando
   prefers-reduced-motion); "Scade presto" ambra; "OK" neutro.
4. Avatar con iniziali colorate per l'assegnatario (hash del nome → tinta della palette
   esistente) al posto del testo "non assegnato": se vuoto, avatar tratteggiato con
   tooltip "Non assegnato".
5. Raggruppamento opzionale per data (Oggi / Ieri / Questa settimana / Prima) con
   intestazioni sticky leggere — solo CSS/JS client sui dati già caricati.
6. Micro-dettagli: transizione di selezione fluida, primo carattere dell'oggetto mai
   tagliato, numeri ticket tabulari (`tabular-nums`).

Fatto quando: a colpo d'occhio si capisce in <1s quali ticket attendono risposta e quali
sono in ritardo; la lista regge 60+ ticket senza stancare; build OK.
```

## PROMPT 4 — Vista dettaglio: conversazione e composer al livello Zendesk

```
Agisci come frontend engineer esperto di UX di conversazioni (Zendesk Agent Workspace,
Intercom).

Contesto: il dettaglio ticket ha header con azioni, `TicketChat` (timeline messaggi con
polling 4s, bolle, separatori di data), `ReplyComposer` (textarea + risposte rapide),
note interne in colonna. Design glass su aurora.

Missione: rendi la conversazione il cuore della pagina, come in Zendesk:
1. Bolle messaggi più leggibili: larghezza massima ~72ch, bordi asimmetrici
   (coda verso il mittente), cliente a sinistra su bianco pieno, agente a destra su
   brand-50, note interne/intereazioni di sistema distinte (giallo tenue con icona
   StickyNote, corsivo per audit) — già parzialmente presente: consolidalo in un
   componente `MessageBubble` unico riusabile.
2. Composer professionale: textarea auto-resize con massimo, barra strumenti sopra
   (risposte rapide in popover invece che lista piatta, contatore caratteri), bottone
   invio principale + hint scorciatoia da tastiera (⌘/Ctrl+Invio se facile senza
   toccare la logica di submit), stato "salvataggio…" o "inviato" con toast esistente.
3. Barra "contesto ticket" sotto l'header: richiedente, canale, SLA, assegnatario in
   una riga compatta con separatori, così l'agente non scorre per ricordarsi chi sta
   parlando.
4. Skeleton di caricamento della chat (bolle grigie animate) invece dell'attuale stato
   loading, e transizione morbida al cambio ticket selezionato.
5. Empty state curato quando il ticket non ha messaggi (icona, testo, suggerimento).

Fatto quando: inviare una risposta sembra veloce e sicuro, la conversazione è leggibile
a colpo d'occhio con 30+ messaggi, typecheck e build passano, nessuna API toccata.
```

## PROMPT 5 — Dark mode professionale per tutto l'admin

```
Agisci come design engineer esperto di theming con Tailwind CSS.

Contesto: l'admin è light-only. Il fondo aurora e le superfici glass usano bianchi
semplificati in CSS (globals.css: `.glass`, `.glass-solid`, `.glass-strong`, `.aurora`)
e classi Tailwind (text-slate-900, bg-white/70…) sparse nei componenti.

Missione: aggiungi il tema scuro all'INTERA area admin (non al sito pubblico), classe su
`<html>`, preferenza salvata in localStorage + rispetto di `prefers-color-scheme`, toggle
nella nav admin:
1. Definisci la palette scura nei token (Prompt 1): fondi blu-notte coerenti col brand
   (es. #0b1220 famiglia), superfici glass scure (glass su scuro = bianco 6–10% + bordo
   bianco 10–14%), testo slate-100/300, semantiche con contrasto AA verificato.
2. Aggiorna `.aurora` e le varianti glass con le versioni dark in globals.css
   (@media o classe .dark — scegli e documenta).
3. Passa i componenti admin (nav, liste, card, form, composer, chat, tabelle leads/
   callbacks/operators/audit) alle classi dark:. Procedi pagina per pagina con build
   verificata, ticket per primo.
4. Screenshot-mental-check delle transizioni: niente "flash bianco" al cambio tema
   (script inline anti-FOUC nel layout admin).
5. I badge di stato/priorità/SLA devono restare identificabili in dark: se serve,
   varianti dark dedicate nelle tone map di `lib/tickets.ts` (solo colori, nessun testo).

Fatto quando: toggle funziona e persiste, tutto l'admin è leggibile in dark (nessun
bianco accecante, nessun grigio illeggibile), il light è identico a prima, build OK.
```

## PROMPT 6 — Micro-interazioni e feedback: la UI "viva" ma seria

```
Agisci come motion designer per interfacce B2B (riferimenti: Linear, Zendesk, Raycast).

Contesto: già presenti — framer-motion nella nav (pillola scivola), view transitions tra
pagine, aloni aurora animati, search glow. Il ticketing usa transizioni Tailwind semplici.

Missione: porta la vista ticket a una qualità di feedback tattile al livello Zendesk/Linear,
senza mai disturbare (cap: nessuna animazione > 400ms, tutte sotto prefers-reduced-motion off):
1. Selezione ticket nella lista: il bordo/accento passa fluido; il dettaglio entra con
   fade+slide leggero (view transition o framer, coerente col resto).
2. Cambio stato/priorità: la pillola interessata pulsa una volta con il colore della
   semantica (verde/ambra) al successo dell'azione server.
3. Nuovo messaggio in chat: il messaggio entra con fade+rise 150ms; il badge
   "Attende risposta" appare con un pop morbido e il favicon/titolo pagina segnalano
   il conteggio se tecnico-fattibile client-side senza API nuove.
4. Bottone invio: stato di caricamento coerente (spinner inline), micro-bounce al successo.
5. Hover states su TUTTE le aree cliccabili della vista ticket con durata uniforme
   (150–200ms) e curva coerente (ease-out).
6. Toast di conferma già esistenti: uniforma posizioni e durate in tutta l'admin.

Fatto quando: l'interfaccia risponde a ogni azione con feedback visibile, nessuna
animazione gratuita, prefers-reduced-motion rispettato ovunque, build OK.
```

## PROMPT 7 — Le altre pagine admin: coerenza totale (leads, callbacks, operators, audit, settings)

```
Agisci come product designer + frontend engineer.

Contesto: dopo l'upgrade della vista ticket (Prompt 1–6), le altre pagine admin sono
rimaste al design precedente: tabelle e card con stili misti tra `ui.tsx` (Card, Badge,
Button) e `glass.tsx`.

Missione: allinea tutte le pagine admin al nuovo design system, senza toccare logica:
1. Sostituisci i componenti base misti con i componenti del design system (una scelta
   unica: glass ovunque nell'admin, o Card solide — decidi in base a leggibilità delle
   tabelle dense e documenta).
2. Tabelle (leads, callbacks, operators, audit): header sticky, righe con hover,
   allineamento numerico tabular, pills di stato coerenti col ticketing, empty state
   illustrato leggero, azioni di riga raggruppate.
3. Form admin (settings, SLA editor, quick replies, AI): campi con label sopra, helper
   text, stati di errore visivi uniformi, bottoni primari/secondari coerenti.
4. Pagina panoramica `/admin`: card KPI con gerarchia chiara (numero grande, trend,
   contesto), griglia responsiva coerente con la shell.
5. Mobile: ogni pagina deve reggere a 320px — tabelle che diventano card impilate se
   necessario, azioni sempre raggiungibili (min 44px).

Fatto quando: passando da una pagina all'altra dell'admin non si percepiscono cambi di
stile; tutte le pagine sono utilizzabili su mobile; typecheck e build passano.
```

---

## Bonus — Prompt "revisione finale" da lanciare a fine lavoro

```
Agisci come consulente UX valutatore indipendente.
Confronta la GUI attuale del ticketing con i pattern di Zendesk Agent Workspace e
Freshdesk: navigazione, densità, gerarchia, feedback, accessibilità, mobile.
Produci `UI-REVIEW-FINALE.md` con: 10 punti forti mantenuti, 10 difetti residui
ordinati per impatto, e per ognuno il fix minimo consigliato. NON implementare nulla:
solo la revisione.
```

## Note di coordinamento con la roadmap esistente

- Questi prompt coprono e anticipano la **Fase 6 "Esperienza realtime e UX"**
  di `ROADMAP-UPGRADE.md` (skeleton, dark mode, audit accessibilità): se la roadmap
  è già in esecuzione, esegui i prompt grafici DENTRO quella fase per non duplicare lavoro.
- Il Prompt 5 (dark mode) è quello più invasivo: fallo dopo il Prompt 1 (token),
  altrimenti raddoppi il lavoro.
- I prompt sono pensati per NON collidere con le fasi funzionali (1–5, 7–8): nessuno
  tocca DB, API o permessi; se durante l'esecuzione serve toccarli, il prompt lo vieta
  esplicitamente e chiede conferma.
