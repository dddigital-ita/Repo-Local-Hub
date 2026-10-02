# GAP ANALYSIS — Ticketing vs benchmark Zendesk/Freshdesk

> Legenda: **Stato** = Assente / Parziale / Completa · **Priorità**: P0 = indispendsabile per l'uso professionale quotidiano, P1 = alto valore, P2 = completamento. **Sforzo** = giornate di lavoro stimate (S ≤1g, M 2–3g, L 4g+).

## Workspace agente (UX)

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Layout a 3 colonne (code \| lista \| dettaglio) | Parziale | Lista+dettaglio a 2 colonne; le «code» sono una segmented control sopra | Colonna code con viste salvate e conteggi multipli | P2 | M |
| Tema chiaro/scuro brandabile | Assente | Solo chiaro, nessun `darkMode` in Tailwind config | Toggle + token scuri | P2 | M |
| Desktop-first usabile da mobile | Completa | Overflow-x gestito, layout colonna su mobile | — | — | — |
| Accessibilità WCAG AA | Parziale | Label, aria-current, focus visibili, reduced-motion; da verificare contrasti glass e tab order completo su pagina ticket | Audit axe + fix puntuali | P1 | S |
| Empty state e skeleton | Parziale | Empty state testuali semplici; niente skeleton di caricamento | Skeleton per lista e chat | P2 | S |

## Ciclo di vita del ticket

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Status completi | Parziale | `bot → lead_captured → operator → callback_scheduled → closed` | Mancano «In attesa cliente» e «In sospeso» (oggi deducibili solo dal badge, non filtrabili come stato) | P0 | S |
| Riapertura automatica da risposta cliente | **Assente** | Un messaggio su ticket `closed` non cambia lo stato | Trigger su insert messaggio visitor | P0 | S |
| Priorità 4 livelli | Completa | `bassa/normale/alta/urgente` con tone map | — | — | — |
| Tipi (Domanda/Incidente/…) | Assente | — | Colonna + select + filtro | P1 | S |
| Campi personalizzati per tipo/brand | Assente | — | Schema EAV o jsonb + builder admin | P2 | L |
| Tag con autocompletamento | Assente | — | Tabella tags + join + UI | P1 | M |

## Conversazione

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Thread pubblico + note interne distinte | Completa | Messaggi `operator` vs `ticket_notes` mostrate in pannello separato | — | — | — |
| Editor rich text/markdown | Parziale | Textarea plain (max 4000 char) | Rendering markdown lato visualizzazione | P2 | M |
| Allegati drag&drop | Assente | — | Storage (Vercel Blob/S3), limiti tipo/dimensione, UI | P1 | M |
| Timeline completa eventi | Parziale | Azioni agente in `ticket_notes` («🛠 email — stato → chiuso»); mancano eventi automatici (riapertura, macro, merge) | Eventi di sistema strutturati | P1 | M |
| Risposta via email dalla vista ticket | Assente | Notifiche solo outbound (Resend) | Inbound email → ticket (provider email + parsing threading) | P2 | L |

## Azioni sui ticket

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Modifica rapida inline dalla lista | Parziale | Dettaglio completo; dalla lista solo click-through | Select stato/priorità inline nelle card | P1 | S |
| Azioni bulk (stato, priorità, assegnatario) | Assente | — | Checkbox + barra azioni | P1 | M |
| Merge di ticket | Assente | — | Merge messaggi + redirect + audit | P2 | M |
| Split/forward, link tra ticket | Assente | — | Colonna `related_ticket_id` + UI | P2 | M |
| Ticket padre-figlio in cascata | Assente | — | Raro nel contesto agenzia: declassato | P2 | L |
| Soft delete con cestino e ripristino | Completa | `archived_at/archived_by` + banner ripristino + riattivazione automatica se il visitatore scrive | — | — | — |

## SLA ed escalation

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Policy per priorità | Parziale | Un solo target globale (2h) + tier visuale in lista | Policy per priorità con soglie separate | P0 | S |
| Primo tempo di risposta | Completa | `first_response_at` + badge tier + KPI breach in dashboard | — | — | — |
| Prossimo reply / risoluzione | Assente | Nessun clock su reply successivi né su risoluzione | Calcolo su `last_sender`+stato, warning 75/90%, badge breach | P0 | M |
| Orari lavorativi e festivi | Assente | SLA conta ore calendariali | Tabella orari + calcolo business hours | P1 | M |
| Warning, breach, notifica, escalation | Assente | Nessuna notifica SLA; breach solo conteggio dashboard | Notifica email/Telegram a soglia | P0 | M |

## Code, viste e routing

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Code con contatori live | Parziale | Contatori a render di pagina (non «live», ma il flusso è così) | — | — | — |
| Viste salvate personali/condivise | Assente | 4 filtri fissi | jsonb filtri per utente | P2 | M |
| Colonne e ordinamento personalizzabili | Assente | Ordinamento fisso (attende risposta → updated_at) | Sort param + persistenza | P2 | M |
| Paginazione server-side | Parziale | `limit 60` senza pagination; a volume crescente i ticket vecchi spariscono | Cursor-based | P1 | S |
| Assegnazione round robin/skill-based | Assente | Assegnazione manuale + auto a chi risponde per primo | Round robin basta per 2 agenti | P2 | S |

## Produttività agente

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Macro/risposte rapide con placeholder | Parziale | 8 risposte rapide fisse globali, senza placeholder né azioni combinate | Placeholder `{nome}` + azioni combinate (rispondi+stato) | P0 | S |
| Scorciatoie da tastiera / command palette | Assente | Nessun handler tastiera nell'admin | ⌘K palette + shortcut (r=risolvi, n=nota) | P1 | M |
| Time tracking | Assente | — | Per 2 agenti è rumore: declassato | P2 | M |
| Notifiche in-app/email/browser per evento | Parziale | Email+Telegram su lead nuovo; nulla su «ticket attende risposta», SLA, callback imminente | Centro notifiche per evento con preferenze | P0 | M |
| Presenza/stato agente | Parziale | Disponibilità on/off manuale + turni; nessuno stato «occupato/away» né presence realtime | — | P2 | S |

## Automazioni

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Trigger a evento con condizioni | Assente | Logica hardcoded (riattivazione spam, auto-assegnazione, cambio stato) | Motore semplice: tabella regole con condizioni jsonb | P2 | L |
| Automazioni temporali | Assente | Nessun cron: le callback «pending» scadute non vengono marcate | Vercel Cron: SLA escalation + callback scadute + reminder lead `ricontatta_il` | P1 | M |
| Webhook in uscita con firma HMAC | Assente | — | Utile per integrazioni future | P2 | M |
| Log esecuzione regole | Assente | (coperto da audit_log quando esisteranno le regole) | — | P2 | S |

## Omnicanale

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Email inbound → ticket | Assente | — | Inbound parse (Resend Inbound o servizio) | P2 | L |
| Widget web embeddabile brandabile | Parziale | La chat è nativa del sito ma non esportabile come widget/embed su siti terzi | Bundle embed + chiave widget | P2 | L |
| Canali esterni via webhook | Assente | — | — | P2 | M |

## Clienti e organizzazioni

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Scheda cliente con storico | Parziale | Pannello lead nel ticket (qualifica, note, telefono); manca vista storico ticket del cliente | Vista «tutti i ticket di questo lead» | P1 | S |
| Organizzazioni con membri/domini/SLA | Assente | Solo campo azienda/nome ditta sul lead (mig. 014) | Modello organizzazioni per B2B ricorrente | P2 | L |
| Ruolo «light agent» | Assente | Un solo ruolo admin (niente role column) | Ruoli: admin / agente / light | P1 | M |

## Knowledge base e CSAT

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| KB pubblica con ricerca | Parziale | FAQ pagina singola per SEO + FAQ di Ambrosio (private, con priorità e uso tracciato) | Estrazione FAQ → articoli pubblici riutilizzabili | P2 | M |
| Suggerimenti KB all'agente | Parziale | Il form FAQ suggerisce le domande reali raggruppate (unico caso vero nel benchmark già coperto!) | Suggerimento FAQ durante la risposta | P2 | S |
| CSAT alla risoluzione | Assente | — | Email/richiesta valutazione a chiusura + report | P1 | M |

## Analytics

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Dashboard KPI | Parziale | Volumi, funnel, SLA breach 30gg; mancano backlog, primo tempo medio, risoluzione media | Misure medie + trend | P1 | S |
| Report per agente/canale con export | Parziale | CSV lead e audit; nessun report per agente | Raggruppamento per agente/canale | P2 | M |
| Statistiche uso AI | Completa | Uso FAQ → chat/lead/appuntamenti con tasso di conversione | — | — | — |

## Admin, sicurezza, API

| Funzionalità | Stato | Evidenza attuale | Gap | Priorità | Sforzo |
|---|---|---|---|---|---|
| Ruoli e permessi granulari | Assente | Singolo livello admin; collaborazione totale by design (2 persone) | Colonna role + guardie | P1 | M |
| Gruppi/team, multi-brand | Assente | Un solo brand, 2 agenti: fuori scala reale | Da rivalutare se l'agenzia cresce | P2 | L |
| Audit log completo | Completa | `audit_log` append-only enforced da RULE + CSV export | Aggiungere IP (oggi assente) | P1 | S |
| 2FA | Assente | Password scrypt + rate limit + Shield | TOTP a 2 agenti: raccomandato ma sobrio | P1 | S |
| Rate limiting | Completa | Per endpoint + Shield ban persistente | In-memory: dichiarare il limite multi-istanza | P2 | S |
| GDPR export/cancellazione | Parziale | Informativa in chat, retention 24 mesi dichiarata; niente procedura di export/erase del cliente | Endpoint admin di export/erase | P1 | S |
| Ricerca full-text con operatori | Parziale | LIKE su query/nome/telefono/#numero | tsvector su messaggi + `stato:aperto` parsing | P1 | M |
| Realtime sulle code | Parziale | Polling 4s (dettaglio) / refresh navigazione (lista) | SSE per lista e chat | P1 | M |
| REST API documentata + API key | Assente | Solo endpoint interni | Minima API read + chiave per integrazioni | P2 | M |

---

## Sintesi: i 10 gap che pesano di più (priorità × impatto quotidiano)

1. **Riapertura automatica** dei ticket chiusi quando il cliente risponde (P0, S) — richieste perse oggi.
2. **SLA «prossimo reply» + escalation con notifica** (P0, M) — un ticket risposto una volta dorme senza allarmi.
3. **Stato «in attesa cliente»** esplicito e filtrabile (P0, S).
4. **Notifica email/Telegram su «ticket attende risposta»** (P0, S) — l'evento più importante della inbox oggi non suona nessun campanello.
5. **Macro con placeholder e azioni combinate** (P0, S) — evoluzione naturale delle risposte rapide esistenti.
6. **Paginazione server-side** (P1, S) — la lista si taglia a 60.
7. **Azione bulk + edit inline dalla lista** (P1, M).
8. **Cron per callback scadute, reminder lead e SLA** (P1, M) — gli impegni presi non vengono aggitti se nessuno apre l'admin.
9. **Tag, tipi e viste salvate** (P1, M+M) — organizzazione oltre i 4 filtri fissi.
10. **Ruoli (light agent) + 2FA TOTP + IP nell'audit** (P1, M+S+S) — dossier sicurezza sobrio e realistico per un team di 2.

**Copertura di partenza**: su ~60 voci del benchmark, ~18 complete, ~14 parziali, ~28 assenti. La strada più corta al livello Zendesk per QUESTA agenzia non è «tutto»: è chiudere i gap P0 (giornata lavorativa di ticketing senza buchi neri), poi P1 puntati, lasciando P2 a domanda reale (email inbound, KB pubblica, organizzazioni, API).
