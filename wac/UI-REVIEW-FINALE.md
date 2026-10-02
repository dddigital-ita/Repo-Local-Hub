# UI-REVIEW-FINALE — Revisione indipendente della GUI del ticketing

> Consulenza UX del 24/09/2026 (bonus prompt di `PROMPT-GRAFICA-TICKETING.md`).
> Confronto con Zendesk Agent Workspace e Freshdesk. Nessuna modifica al codice: solo revisione.
> Metodologia: heuristics di Nielsen + verifica nel browser a 1440px e 390px.

## 1. Dieci punti forti mantenuti

1. **Conversazione al centro**: la griglia a 3 zone (coda 256px / dettaglio / sidebar 260px) replica la gerarchia dell'Agent Workspace; la chat domina e gestione/lead/note non la spostano.
2. **Densità della coda calibrata**: oggetto dominante, meta su una riga, pill in fondo, avatar assegnatario con tinta stabile per nome — in <1s si capisce cosa attende risposta.
3. **Semantica del colore coerente**: arancio = attende risposta, rosso + puntino pulsante = SLA scaduto, ambra = scade presto; il neutro per «tutto ok» riserva il colore all'azione (più rigoroso di molte installazioni Zendesk).
4. **Raggruppamento temporale** Oggi/Ieri/Questa settimana/Prima con intestazioni leggere: navigazione visiva della coda senza query aggiuntive.
5. **Stato di sistema sempre visibile**: «Live · aggiornamento ogni 4s», skeleton in caricamento, empty state istruttivo sulla chat, toast su ogni azione.
6. **Claim in un gesto**: «Prendi in carico e rispondi» assegna e porta il cursore sul composer — il flusso più frequente dell'agente è un click (parità con il macro-click di Freshdesk).
7. **Barra contesto** sotto l'header: richiedente cliccabile, provenienza, apertura, messaggi, SLA — l'agente non scorre mai per ricordarsi chi ha davanti.
8. **Composer professionale**: auto-resize fino a ~12 righe, contatore caratteri, hint scorciatoie, risposte rapide configurabili, Invio/Shift+Invio convenzionali.
9. **Accessibilità solida**: focus ring uniforme, `aria-current` su lista e filtri, role="log" sulla chat, target ≥44px, prefers-reduced-motion rispettato su ogni animazione introdotta.
10. **Theming a token**: due temi × light/dark senza varianti di componente; le semantiche di stato restano invariate tra temi (decisione corretta: il significato operativo non si tocca).

## 2. Dieci difetti residui (per impatto) con fix minimo

1. **Nessuna gestione批量 (bulk actions)** — Impossibile archiviare/assegnare più ticket insieme; con 60+ ticket l'operatore agisce uno a uno. *Fix minimo*: checkbox sulle card + barra azioni contestuale sopra la coda (client-only, azioni esistenti in loop).
2. **Ricerca senza scorciatoia da tastiera** — Niente `/` o ⌘K per arrivare alla ricerca; Zendesk si vive da tastiera. *Fix minimo*: keydown globale che focusa `#ticket-search` su `/`.
3. **Preview notifiche browser assenti** — Il polling 4s aggiorna la chat ma non il titolo/favicon: un agente su altro tab non vede arrivare messaggi. *Fix minimo*: `document.title = "(n) Inbox"` quando un nuovo messaggio visitatore arriva mentre il tab è nascosto.
4. **Le note interne non hanno il mittente pronunciato** — L'autore è in caption piccola; in team affollato conviene un prefisso bold. *Fix minimo*: autore in `font-semibold` prima del corpo.
5. **Filtri non persistono nell'URL della ricerca** — La ricerca preserva `f`, ma i filtri resettano `t`: cambiare filtro perde il ticket selezionato se fuori dal nuovo filtro (comportamento intenzionale ma non segnalato). *Fix minimo*: micro-copy o toast «ticket fuori da questo filtro».
6. **Skeleton senza metrica di tempo** — Se l'API della chat rallenta, lo skeleton non dice nulla. *Fix minimo*: dopo 3s mostrare «Ancora carico…» (un solo stato extra).
7. **Composer: niente bozza persistente** — Cambiare ticket mentre si scrive perde il testo. *Fix minimo*: bozza in `sessionStorage` per `conversationId` (client-only, 5 righe).
8. **Empty state della coda senza via d'uscita** — Dice «prova un altro filtro» ma non linka i filtri. *Fix minimo*: bottone «Vai a Tutti» precompilato.
9. **Audit delle note in sidebar non ordinato per rilevanza** — L'ordine cronologico va bene, ma le note di sistema (audit) intercalate pesano quanto quelle umane. *Fix minimo*: toggle «solo note del team».
10. **Dark mode: ring delle bolle potrebbe essere più contrastato** — A 0.45 di opacità brand-500 il ring agente in dark è percepibile ma tenue. *Fix minimo*: 0.6. (Estetica, non usabilità.)

## 3. Verdetto

Il ticketing oggi regge il confronto con Zendesk/Freshdesk su gerarchia, densità, feedback e accessibilità per il caso d'uso reale (team di 2 operatori, lead generation B2B locale). Il gap strutturale che separa da un service desk completo è solo uno: **le azioni batch e la navigazione da tastiera** (punti 1 e 2) — che sono funzione, non grafica, e restano fuori dal perimetro di questa serie di prompt.
