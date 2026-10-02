# ROADMAP UPGRADE — Dal ticketing attuale al livello Zendesk

> Principi: mai breaking change (migration incrementali idempotenti, come le 17 esistenti), feature flag per le funzioni invasive, sistema sempre funzionante a fine fase, verifica (typecheck + build + prova browser) prima di passare alla fase successiva, decisioni documentate in CHANGELOG.md.

## Panoramica

| Fase | Tema | Esito misurabile | Sforzo |
|---|---|---|---|
| 1 | Sanità del ciclo di vita | Nessun messaggio cliente senza risposta tracciata | 2–3 g |
| 2 | Notifiche e cron | Ogni evento critico suona un campanello; gli impegni vengono aggiti | 2 g |
| 3 | Produttività agente | Tempi di risposta medi più corti (macro, bulk, scorciatoie) | 2–3 g |
| 4 | Organizzazione della coda | Tag, tipi, paginazione, viste salvate | 3 g |
| 5 | Sicurezza e ruoli | 2FA, ruoli, IP in audit, GDPR procedures | 2 g |
| 6 | Esperienza realtime e UX | SSE, skeleton, dark mode, audit accessibilità | 3 g |
| 7 | Analytics e CSAT | Dashboard con tempi medi, report per agente, CSAT | 2 g |
| 8 (opzionale) | Omnicanale e API | Email inbound, widget embeddabile, REST API | a domanda |

Le fasi 1–3 sono il «nozionale Zendesk minimo»: senza quelle il resto è decorazione. Le fasi 4–7 migliorano scala e controllo. La 8 solo se emerge domanda reale.

---

## FASE 1 — Sanità del ciclo di vita (P0)

**Obiettivo**: chiudere i buchi neri del ciclo del ticket. Criterio di «fatto» verificabile in coda a ogni voce.

### 1.1 Stati «in attesa cliente» e «in sospeso»
- Migration: aggiungere `waiting_customer` e `on_hold` a `TICKET_STATUSES` (nessuna colonna nuova: lo status è testo; serve solo mapping label/tone + azioni).
- «In attesa cliente» **automatico**: quando l'agente risponde, lo stato diventa `waiting_customer` invece di restare `operator` (il badge «attende risposta» esistente lo deduce già dal `last_sender`: lo stato esplicito rende il dato filtrabile e coerente).
- Filtro di lista dedicato «Da rispondere» accanto agli attuali.
- **Fatto quando**: un ticket risposto appare «in attesa cliente», il filtro lo esclude, la risposta del cliente lo riporta in «Da rispondere».

### 1.2 Riapertura automatica
- Su insert di messaggio `visitor` su ticket `closed`: status → `waiting_customer`, `closed_at/closed_by = null`, evento in timeline + audit.
- **Fatto quando**: rispondere a un ticket chiuso lo riporta in coda con badge «riaperto».

### 1.3 SLA a tre orologi
- Migration: `conversations.sla_next_reply_due timestamptz`, `sla_resolve_due timestamptz` (calcolate da policy per priorità).
- Policy per priorità in `content_settings` (editabili da /admin/settings): es. urgente 1h/4h, alta 2h/8h, normale 4h/24h, bassa 8h/48h.
- Calcolo dei due clock su ogni cambio di stato/messaggio; tier badge esteso (risposto/attende/scade presto/in ritardo) sui tre orologi.
- **Fatto quando**: la lista mostra quale ticket sta per scadere su quale orologio, per priorità.

### 1.4 Notifica «ticket attende risposta»
- Il caso «ultimo messaggio = visitor, non chiuso» oltre soglia di pazienza (es. 15 min) → email+Telegram all'assegnatario (o a tutti se non assegnato). Riuso `notify.ts`.
- Dédup: una notifica per evento, segnata in una tabellina (o colonna `notified_at`).
- **Fatto quando**: un messaggio cliente di notte arriva sul telefono di Daniele/Michele.

---

## FASE 2 — Cron e automazioni temporali (P0/P1)

**Obiettivo**: il sistema agisce anche quando nessuno apre l'admin.

### 2.1 Cron su Vercel (o endpoint protetto con chiave)
- `/api/cron/tick` (GET, protetto da `CRON_SECRET`, idempotente):
  1. SLA: warning 75%/90% → notifica; breach → notifica + evento timeline.
  2. Callback `pending` con `scheduled_at` passata da oltre X ore → `missed` + notifica.
  3. Lead con `ricontatta_il` arrivato → compito in evidenza (banner dashboard).
  4. Ticket `waiting_customer` senza risposta da N giorni → chiusura automatica configurabile (default: off).
- **Fatto quando**: le tre automazioni scattano in prova (slot finto) senza doppie notifiche al retry.

### 2.2 Audit delle automazioni
- Ogni azione automatica in `audit_log` con `actor = 'system'`.
- **Fatto quando**: nella pagina Audit si vedono le azioni del cron distinte da quelle umane.

---

## FASE 3 — Produttività agente (P0)

**Obiettivo**: rispondere più veloce con meno click.

### 3.1 Macro con placeholder e azioni combinate
- Evoluzione delle risposte rapide (oggi 8 frasi piatte in content_settings):
  - macro con placeholder `{nome}`, `{servizio}`, `{budget}`, `{slot_callback}`;
  - azione combinata opzionale: rispondi + cambia stato (es. «rispondi e metti in attesa cliente»), già coerente con 1.1;
  - editor macro in /admin/settings (stessa UX di oggi, più campi).
- **Fatto quando**: selezionare la macro inserisce il testo con il nome vero del cliente e applica lo stato.

### 3.2 Azioni bulk e inline
- Checkbox sulle card della lista + barra azioni (stato, priorità, assegnatario, archivia) con audit per ticket.
- Select stato/priorità inline direttamente sulla card (senza aprire il dettaglio).
- **Fatto quando**: 10 spam si archiviano in un gesto.

### 3.3 Command palette e scorciatoie
- ⌘K: cerca ticket, vai a pagina, azioni rapide sul ticket aperto (r=risolvi, w=attesa cliente, n=nota).
- Routed su Server Actions esistenti; niente nuovo backend.
- **Fatto quando**: un ticket si gestisce da tastiera senza mouse.

### 3.4 Storico del cliente
- Nel pannello lead del ticket: «altri ticket di questo cliente» (stesso telefono) cliccabili.
- **Fatto quando**: il contesto del rapporto è a un click.

---

## FASE 4 — Organizzazione della coda (P1)

### 4.1 Paginazione server-side a cursore
- `updated_at` come cursore; «carica altri» in fondo; ricerca full-text `tsvector` sui messaggi (migration GIN index) con fallback LIKE.
- **Fatto quando**: 500 ticket sono navigabili senza degrado.

### 4.2 Tag
- Migration: `tags (id, label unique, color)` + `ticket_tags (ticket_id, tag_id)`; autocompletamento sugli input; filtro per tag; gestione tag in /admin/settings.
- **Fatto quando**: «vip» o «ristoranti» si applica, si filtra e si vede in lista.

### 4.3 Tipi di ticket
- Colonna `type` (`domanda|incidente|problema|attivita`) + select + filtro; preset visuale.
- **Fatto quando**: si filtra «incidenti aperti».

### 4.4 Viste salvate
- Filtri combinabili (stato+priorità+tag+tipo+query) salvati per utente su jsonb; menu «Le mie viste».
- **Fatto quando**: la vista «da rispondere urgente» si richiama dal menu.

---

## FASE 5 — Sicurezza, ruoli, GDPR (P1)

### 5.1 Ruoli
- Migration: `admin_users.role` (`admin|agente|light`); light = vede solo i ticket dove è menzionato, solo note interne di proprio ambito, no impostazioni.
- Guardie centralizzate in `lib/admin.ts` (`requireRole`).
- **Fatto quando**: un collaboratore esterno può seguire i propri ticket senza vedere il resto.

### 5.2 2FA TOTP
- Colonna `totp_secret` (cifrata) + enrolment in /admin/settings + sfida al login (con ricordami su questo dispositivo 30gg).
- **Fatto quando**: il login senza codice TOTP fallisce.

### 5.3 Audit più ricco + GDPR
- `audit_log.ip` (migration add column, retroattivo dove noto); endpoint admin GDPR: export dati cliente (per telefono/email) e cancellazione/anonimizzazione con doppia conferma e audit.
- **Fatto quando**: un'richiesta GDPR si esaudisce in 2 minuti.

### 5.4 Igiene repo
- Versionare `scripts/_mock-ai.mjs` con README (strumento di test legittimo) o eliminarlo; rimuovere `src/lib/_patch_lead.py`; rimuovere `.DS_Store` dal tracking; aggiornare README (Supabase→Neon, Ambrosio, Shield, ticketing) e creare CHANGELOG.md.
- **Fatto quando**: `git status` pulito e README vero.

---

## FASE 6 — Realtime e UX (P1/P2)

### 6.1 SSE per lista e chat
- Endpoint `/api/admin/stream` (EventSource): eventi `message`, `ticket_update`, `counters`. Riutilizza il polling come fallback automatico.
- **Fatto quando**: la lista e la chat si aggiornano da sole in <1s, con fallback al polling se SSE cade.

### 6.2 Accessibilità AA completa
- Audit con axe su tutte le pagine admin + fix contrasti glass, tab order pagina ticket, focus management su cambio ticket selezionato, skeleton di caricamento.
- **Fatto quando**: Lighthouse a11y ≥ 95 su /admin/tickets e nessun errore axe.

### 6.3 Dark mode
- Token scuri + toggle persistito (respetta `prefers-color-scheme` di default).
- **Fatto quando**: le 12 pagine admin sono leggibili in scuro senza contrasti sotto AA.

---

## FASE 7 — Analytics e CSAT (P1)

### 7.1 Dashboard di servizio
- Primo tempo di risposta medio, tempo di risoluzione medio, backlog per stato, trend settimanale, compliance SLA %, report per agente e per canale (chat/AI).
- **Fatto quando**: la dashboard risponde a «quanto siamo bravi a rispondere?» senza SQL.

### 7.2 CSAT
- A chiusura: email al cliente con link valutazione (1–5 + commento, token firmato); report per agente.
- **Fatto quando**: la valutazione arriva e si aggrega nel report.

---

## FASE 8 — Omnicanale e API (P2, a domanda)

- **Email inbound**: indirizzo dedicato (es. help@…) → parse inbound (Resend Inbound) → thread matching per numero ticket nel subject → ticket. Feature flag `EMAIL_CHANNEL=on`.
- **Widget embeddabile**: bundle IIFE della chat con chiave per dominio, per installarla su siti clienti.
- **REST API minima**: read tickets/messages con API key, OpenAPI 3.1 generato dagli endpoint.
- **Webhook in uscita**: firma HMAC + retry esponenziale + log in audit.

---

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Il cambio di stato automatico (1.1) sconvolge abitudini dei 2 agenti | Feature flag `TICKET_WAITING_STATE=off` di default; abilitazione dopo prova concordata |
| Il cron Vercel non gira in locale | Endpoint invocabile a mano per test; fallback: niente automazioni (sistema resta funzionante) |
| SSE su serverless (Vercel) ha limiti di durata | Fallback polling già esistente resta in piedi; SSE è accelerazione, non dipendenza |
| Migration su tabelle vive | Solo ADD COLUMN/CREATE TABLE IF NOT EXISTS, idempotenti, come le 17 esistenti; mai DROP |
| Scope creep (il benchmark è enorme) | Le fasi 4–8 partono solo a conferma della precedente; P2 su richiesta esplicita |

## Cosa NON fare (consapevolmente)

- Organizzazioni/multi-brand, campi personalizzati, time tracking, ticket padre-figlio: fuori scala per un'agenzia a 2 agenti; li rileggeremo se il team cresce.
- Riscritture dello stack: escluse per regola operativa n. 1.
