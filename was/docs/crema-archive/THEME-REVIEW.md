# THEME-REVIEW — Revisione indipendente dei temi (Classic + Zendesk Glossy)

> Consulenza UX del 24/09/2026 (bonus prompt di `PROMPT-TEMI-GRAFICI.md`). Nessuna modifica al codice: solo revisione.
>
> **Metodo e copertura.** Walker automatico del contrasto (luminanza relativa WCAG, soglia 4.5:1 / 3:1 per large text) eseguito nel browser su **6 combinazioni** (Classic e Zendesk × blu `#3d72ec`, verde `#2e7d32`, bordeaux `#7b1e2b`) sulle pagine con più superficie: `/` (home), `/consulenza`, `/admin` (panoramica), `/admin/tickets` (lista + dettaglio + composer), `/admin/leads`, `/admin/callbacks`, `/admin/ai`, `/admin/notion`, `/admin/tools`, `/admin/settings`. Più verifica statica dei sorgenti per i punti di fuga. Nota: il pannello devtools di Next segnalava un warning residuo (`notify.js`) già corretto nel commit `5e86df0`.

## Verdetto generale

Il motore a token **funziona**: entrambi i temi sono coerenti su sito e admin, il cambio colore primario segue ovunque (link, bottoni, badge brand, focus ring, glow), e il tema Zendesk è riconoscibilmente Garden pur mantenendo i tocchi glossy. I difetti trovati sono **localizzati e non bloccanti**; nessuno richiede una riprogettazione.

---

## 1. Punti di fuga dei token (valori hardcoded che NON seguono il tema)

| # | Dove | Cosa | Gravità | Fix minimo |
|---|---|---|---|---|
| F1 | `src/app/layout.tsx:51` | `themeColor: "#2653df"` fisso nel viewport meta (colore barra browser mobile) | Bassa | Leggere il tema lato server e usare brand-600 derivato (la funzione esiste già: `brandScale(theme.primary)[600]`) |
| F2 | `src/app/og/route.tsx:31,49` | OG image con blu `#2653df` cablato | Bassa | Accettabile (immagine sociale, non UI); opzionale: passare il primary dalla query |
| F3 | `src/app/globals.css` (.glass-solid.ticket-waiting) | Bordo/alone arancio `rgb(253 186 116)` fisso | Nessuna per scelta | Documentato: è un semaforo funzionale («attende risposta»), NON brand — va bene così |
| F4 | Badge semantici (green/amber/red Tailwind) in 19 file admin | Colori di stato fissi | Nessuna per scelta | Corretto: leggibilità prima della personalizzazione. Da mantenere |
| F5 | `::selection` e scrollbar | Già tokenizzati ✓ | — | Nessuno |
| F6 | favicon / icon.svg | Non tokenizzabile (file statico) | Nessuna | Nessuno |

Nessun **consumatore di `--accent`**: la variabile accento viene iniettata ma nessuna regola CSS la usa. Il picker «Colore accento» quindi oggi non ha effetto visibile → o si collega (es. gradienti dei bottoni primari, link hover) o si nasconde l'input fino a quando non c'è un uso reale.

## 2. Contrasto AA — risultati per combinazione

### 2.1 Quello che funziona sempre (verde in tutte le 6 combinazioni)
- Testo principale `text-slate-900` su superfici vetro/piatte: **≥ 12:1**
- H1 e titoli: **≥ 15:1**
- Bottoni primari bianco-su-brand-600: blu **6.6:1** ✓, bordeaux **4.5:1** ✓ (al limite), verde **1.7:1** ✗ (vedi 2.3)
- Badge semantici (rosso su rosso-50, verde su verde-50): **≥ 4.5:1** in entrambi i temi ✓

### 2.2 Difetti REALI trovati (indipendenti dal colore scelto)

| # | Dove | Problema | Ratio misurato | Fix minimo consigliato |
|---|---|---|---|---|
| C1 | **Placeholder degli input** (`slate-400` su vetro bianco 55–78%) — cerca ticket, composer, tutti i form admin e pubblico | Il grigio `#94a3b8` su vetro semitrasparente scende sotto soglia | **2.56:1** (misurato su `bg-white/70` reale) | Passare i placeholder a `slate-500` (`#64748b` → ratio ~4.7:1 su bianco pieno; sul vetro 70% resta ≥ 4.5). Un solo cambio in `globals.css` con una classe `.placeholder-strong` oppure override `input::placeholder` |
| C2 | **Metadata secondari con `text-slate-400` su superfici bianche opache** — pagina AI (19 occorrenze in `/admin/ai`): «17 risposte · 2.1 per chat», «fatta 1 volta», intestazioni uppercase delle card statistiche | slate-400 è pensato per il vetro; su bianco **piatto** (Zendesk o glass-solid) crolla | **2.56:1** | Distinguere i due usi: su vetro ok per testo decorativo, ma per **dati numerici veri** (contatori, timestamp) usare `slate-500`. Fix mirato: cercare `text-[11px] text-slate-400` in `/admin/ai` e sostituire con `text-slate-500` (≈ 15 righe) |
| C3 | **Voce nav admin attiva** — il walker la segnala 1.18:1 contro il fondo aurora | **Falso positivo**: la pill attiva ha uno span `bg-white` pieno dietro il testo (verificato via elementFromPoint: ratio reale **17.85:1**). Da NON fixare | — | Nessuno (documentato per chi farà audit futuri) |

### 2.3 Il tema dei temi: il verde chiaro si mangia il bianco

Il difetto più serio è **sistemico**, non di pagina: con un primario chiaro (verde `#2e7d32`), la scala derivata produce brand-600 **quasi luminoso** (`rgb(28,233,38)`) perché la curva lightness attuale (600 = 51%) è calibrata per il blu, che ha una luminanza percettiva molto più bassa dell' verde a parità di HSL lightness.

| Colore scelto | brand-600 derivato | Bianco su brand-600 | AA? |
|---|---|---|---|
| Blu `#3d72ec` | `rgb(38,83,223)` | **6.61** | ✓ |
| Bordeaux `#7b1e2b` | `rgb(233,28,56)` | **4.48** | ⚠ al limite (4.48 vs 4.5 — sotto per un soffio) |
| Verde `#2e7d32` | `rgb(28,233,38)` | **1.65** | ✗ grave |

Conseguenze concrete con il verde: bottone «Invia» con testo bianco illeggibile, link brand invisibili su bianco, focus ring sbiadito.

**Fix minimo consigliato (uno dei due, a scelta):**
1. **Scurimento percettivo in `brandScale()`** (consigliato): dopo il calcolo HSL, applicare una correzione di luminanza relativa WCAG: finché `relativeLuminance(step600) > 0.18`, scurire la lightness di 4 punti e ricalcolare. ~10 righe in `theme-shared.ts`, migliora OGNI colore chiaro che l'utente sceglierà (giallo, ciano, verde chiaro). Il bordeaux tornerebbe sopra 4.5, il verde scenderebbe a un verde scuro leggibile.
2. **Avviso bloccante nell'editor**: oggi l'avviso contrasto in `/admin/tools` compara bianco vs **primary**; farlo comparare bianco vs **brand-600 derivato** (che è ciò che usa il bottone) e, sotto 4.5, mostrare «Questo colore non è usabile: il testo bianco dei bottoni sarebbe illeggibile» e disabilitare «Salva tema» finché non si sceglie un tono più scuro o si preme «Ripristina».

La 1 risolve alla radice, la 2 mette al sicuro il caso residuo; si possono fare entrambe in mezz'ora.

## 3. Elementi che restano «brutti» nei due temi

| # | Tema | Dove | Difetto | Fix minimo |
|---|---|---|---|---|
| B1 | Zendesk | Lista ticket, card con bordo arancio «attende risposta» (screenshot verificato) | L'alone `0 0 0 3px arancio/0.3` è nato per il vetro: su fondo Garden piatto sembra un'ombra colorata stonata, non un highlight | In `[data-theme="zendesk"] .glass-solid.ticket-waiting`: rimuovere l'alone a 3px e tenere solo bordo arancio 1.5px + sfondo `#fff8f1` tenuissimo |
| B2 | Zendesk | Chat bolle visitatore (`bg-slate-100/90`) | Il grigio freddo Tailwind combatte con il fondo grigio-caldo Garden (#f8f9f9): la bolla sembra «sporca» | In zendesk: bolla visitatore su `#f0f1f2` (grigio Garden) con bordo `#d8dcde` |
| B3 | Zendesk | Bottoni pill (`rounded-full`) | Il raggio pill 9999px sopravvive al tema (scelta condivisa), ma su Garden i bottoni Garden sono rettangolari 8px: la miscela «card quadrate + bottoni ovale» è visibile nella lista ticket | Se si vuole Garden pieno: `[data-theme="zendesk"] { --radius-btn: 8px }` è già pronto ma i componenti usano `rounded-full` hardcoded (glass.tsx). Fix: sostituire `rounded-full` con `rounded-btn` nei 4 componenti glass (tocco minimo, 1 file) |
| B4 | Classic | Pagina AI, card statistiche | Le 19 occorrenze di `text-slate-400` danno un aspetto «sbiadito» complessivo (oltre al contrasto C2) | Stessa cura del punto C2: slate-500 per i dati, slate-400 solo per etichette decorative |
| B5 | Entrambi | Bordo tabella CSV export, selettori datati (`select` nativi) in config Notion | I select nativi non ricevono i token (freccia di sistema, sfondo bianco OS) | Accettabile; se si vuole coerenza: `appearance-none` + chevron SVG custom nel componente editor Notion |
| B6 | Zendesk | Composer risposta ticket | Il bordo-luce interno gloss (inset bianco) su un input di testo grande sembra un alone non richiesto | In zendesk: togliere l'inset dagli input testuali (solo bordo) |

## 4. Cosa NON va toccato (verde, verificato)

- Le semantiche di stato verde/ambra/rosso: corrette e coerenti nei due temi, contrasti sempre ≥ 4.5.
- Il bordo arancio «attende risposta»: semantica funzionale, non brand (F3).
- L'invarianta resa Classic con colori default: confermata identica (confronto title/h1/bottoni pre-post refactoring).
- La scelta `color-scheme: light` su entrambi i temi: coerente fino a quando non esiste la dark mode.

## 5. Priorità consigliata

1. **C1 + C2** (contrasto placeholder + slate-400 su dati): due search-and-replace mirati, impatto immediato su accessibilità reale.
2. **§2.3.1** (scurimento percettivo in `brandScale`): protegge da OGNI colore chiaro futuro.
3. **B1 + B2** (ritocchi Zendesk su alone arancio e bolle chat): sono i due dettagli che tradiscono di più il tema.
4. **B3** (raggio bottoni in zendesk): decisione di gusto da prendere consapevolmente (pill vs Garden).
5. F1 (themeColor dinamico) e la sorte del picker accento: nice-to-have.
