# REPORT STATO ATTUALE — Ticketing System WebAgencyCrema

> Audit FASE 0 · 24 settembre 2026 · analisi del repository così com'è, senza modifiche al codice.

## 1. Inquadramento

Il progetto non è un help desk generico: è il sito lead-generation dell'agenzia (Next.js 15 App Router, React 19, Tailwind 3, Postgres Neon) **con un ticketing system cresciuto dentro**, organicamente, a partire dalla chat di qualificazione. Il ciclo vitale è:

```
Visita → ricerca (barra «finta») → chat script fisso (no LLM) → lead qualificato
      → conversazione = ticket (numero, priorità, assegnatario, SLA)
      → risposta agente da /admin/tickets (o take-over live)
      → callback fissata → lead «contattato» → chiusura
```

Fuori turno subentra **Ambrosio**, operatore AI multi-provider (Anthropic/OpenAI/Gemini/OpenRouter/Freebuff/custom) con fallback a catena, FAQ addestrative e tracking d'uso con conversioni a callback.

## 2. Stack tecnico

| Layer | Tecnologia | Note |
|---|---|---|
| Framework | Next.js 15.5.4 (App Router), React 19 | Server Components + Server Actions |
| DB | Postgres (Neon), `pg` pool max 5 | Degradazione elegante: senza `DATABASE_URL` il sito funziona senza persistenza |
| Styling | Tailwind 3 + glassmorphism custom | Estetica Apple curata, `prefers-reduced-motion` rispettato |
| Auth | Email+password scrypt, cookie HMAC httpOnly 12h | Anti-enumerazione via scrypt «equalizzato» |
| Email | Resend | Notifiche lead + conferme callback (best-effort) |
| Telegram | Bot API | Notifiche multi-chat + allarmi Shield |
| AI | 6 provider, chiavi AES-256-GCM su DB | Prompt di sistema editabile, FAQ con priorità |
| Sicurezza | Shield (ban IP su DB), rate limit, Turnstile, honeypot | 3 violazioni/10 min → ban 24h |

## 3. Schema dati (17 migration incrementali, tutte backward-compatible)

**Core ticketing**
- `conversations` — il ticket: numero serial univoco, `initial_query`, `source_page`, UTM, status (`bot|lead_captured|operator|callback_scheduled|closed`), `priority` (`bassa|normale|alta|urgente`), `assigned_to→operators`, `first_response_at` (SLA), `closed_at/closed_by`, `archived_at/archived_by` (soft-delete), trigger `touch_updated_at`
- `messages` — thread: `sender` (`visitor|operator|bot|system`), `author` (nome agente, mig. 011), indice su `(conversation_id, created_at)`
- `ticket_notes` — note interne private + audit «umano» delle azioni (chi ha fatto cosa, scritto nel ticket)

**Persone e turni**
- `operators` — team reale (A=Daniele 9-13, B=Michele 15-19), turni orari, `available_override`
- `admin_users` — `operator_id` collega l'account admin all'identità nel team, `display_name`
- `leads` — qualifica completa (servizio, urgenza, sito esistente, budget, azienda+nome ditta mig. 014, temperatura, `ricontatta_il`, `notion_synced_at`)

**Processi**
- `callbacks` — richiami fissati con slot, stato `pending|done|missed`
- `audit_log` — append-only con RULE SQL anti-UPDATE/DELETE: chi/cosa/quando per ogni azione admin
- `shield_events` / `shield_bans` — sicurezza con ban persistente
- `ai_settings` (riga singola) + chiavi provider cifrate, `ai_faqs` (domanda/risposta/priorità/attiva), `ai_faq_usage` (matching per similarità Jaccard, conversioni a chat/lead/callback)

**Contenuti**
- `packages` — listino proposto da Ambrosio; `content_settings` — risposte rapide del ticketing (JSON editabile)

## 4. Moduli dell'area admin (12 pagine)

| Pagina | Cosa fa |
|---|---|
| `/admin` | KPI 30 giorni: ticket aperti, SLA breach, funnel, lead hot |
| `/admin/tickets` | **Il cuore**: filtri (Aperti/Miei/Collega/Tutti) con contatori live, ricerca, badge «attende risposta» con ordinamento prioritario, dettaglio con timeline polling 4s, risposta, note interne, callback, assegnazione, priorità, stato, archiviazione spam |
| `/admin/leads` | Pipeline lead: temperatura, note, ricontatto, CSV, Notion |
| `/admin/callbacks` | Richiami con fatti/mancato, richiama-ora, eliminazione |
| `/admin/operators` | Turni e disponibilità |
| `/admin/ai` | Ambrosio: on/off, provider multipli con card e primario, prompt, FAQ con suggerimenti raggruppati dalle domande reali + bozza risposta via AI, statistiche uso FAQ → appuntamenti |
| `/admin/notion` | Sync lead su Notion (test connessione incluso) |
| `/admin/shield` | Eventi sicurezza + sblocco IP |
| `/admin/audit` | Log completo, export CSV |
| `/admin/tools` | Strumenti Google (GA4/GTM/GSC) |
| `/admin/settings` | Risposte rapide del ticketing |
| `/admin/packages` | Listino con duplica/toggle |

## 5. Flussi e automazioni esistenti

1. **Chat → ticket**: ogni ricerca apre una conversazione; query spam (<2 caratteri) nasce archiviata e si riattiva se il visitatore scrive davvero (zero falsi positivi permanenti).
2. **Take-over umano**: la risposta dell'agente ferma lo SLA (`first_response_at`), auto-assegna il ticket e riporta lo stato a `operator`; polling leggero (4s) mostra i messaggi nuovi al visitatore.
3. **Fuori turno**: Ambrosio risponde (se attiva), estrae nome+telefono+consenso dal testo libero, salva il lead con `source='ai'` e notifica il team; le FAQ ufficiali entrano nel prompt e l'uso viene tracciato con conversioni.
4. **Lead catturato fuori turno dallo script**: notifica email+Telegram all'operatore di turno, callback con slot realistici se nessuno c'è.
5. **Sicurezza a strati**: rate limit per endpoint, Shield con ban automatico su DB, Turnstile opzionale, honeypot sui form, credenziali AI cifrate.

## 6. Punti di forza (da non toccare)

- **Degradazione elegante ovunque**: senza DB/AI/email il sito resta in piedi — convenzione costante e sensata.
- **Collaborazione a 2 agenti** pensata davvero: filtri «miei/collega», `canWorkOn` aperto, audit di ogni azione sia in `audit_log` sia (leggibile) in `ticket_notes`.
- **Ordinamento «attende risposta»** in cima a ogni filtro + badge: il dato che conta in inbox c'è già.
- **Migration incrementali e idempotenti** (17, mai un DROP con dati).
- **Accessibilità non casuale**: label sr-only, `aria-current`, focus visibili, regione log, reduced-motion.
- **Ambrosio con governance**: audit di ogni azione, tracking FAQ→conversioni, mai bloccante per la chat.
- Audit log **immutabile a livello DB**.

## 7. Fragilità e debito tecnico

| # | Fragilità | Impatto |
|---|---|---|
| F1 | **Polling, non realtime**: dettaglio ticket a 4s, take-over visitatore via polling; niente SSE/WebSocket | Ritardo percepito, carico inutile su Neon |
| F2 | **SLA a un solo orologio**: solo «prima risposta» calcolata per età del ticket; nessun «prossimo reply», nessuna escalation, non considera orari lavorativi/festivi | Un ticket risposto una volta può dormire per giorni senza allarme |
| F3 | **Nessuna notifica per i messaggi successivi**: email/Telegram solo sul lead nuovo; un visitatore che scrive di notte con Ambrosio spenta non sveglia nessuno | Lead persi silenziosamente |
| F4 | **Riapertura assente**: se il visitatore risponde a un ticket `closed`, nulla lo riporta attivo (il messaggio resta nel thread ma il ticket sembra chiuso) | Richieste perse nella lista «aperti» |
| F5 | **Nessun test automatizzato**: zero file `*.test.*`; le verifiche sono manuali (typecheck + browser) | Regressioni possibili a ogni rilascio |
| F6 | **Rate limit in-memory**: validi per istanza; con più istanze serverless si aggirano (il ban Shield su DB copre solo dopo 3 violazioni) | protezione parziale su deploy multi-istanza |
| F7 | **Ricerca LIKE senza indice full-text**: `ilike %term%` su 4 colonne + subquery per `last_sender` ripetuta in 4 punti | Scala male con il volume |
| F8 | **File non tracciati nel repo**: `scripts/_mock-ai.mjs` (mock AI usato per i test), `src/lib/_patch_lead.py` (residuo), `PROMPT-TICKETING-SYSTEM.md` | Ignoti per i collaboratori; il mock è utile e andrebbe versionato o rimosso |
| F9 | **`page.tsx` tickets a 405 righe monolitico**: lista + dettaglio + pannello lead in un solo Server Component | Manutenibilità, riutilizzo |
| F10 | **Sessione admin senza rotazione/revoca**: cookie HMAC valido 12h non revocabile (niente tabella sessioni) | Logout solo client-side; cambio password non invalida le sessioni |
| F11 | **Nessun limite di dimensione sul prompt AI**: lo storico (8 turni) + FAQ + pacchetti entrano senza budget di token | Costi e latenza imprevedibili |
| F12 | **README disallineato**: parla ancora di «Supabase» in più punti; non cita Ambrosio, Shield, ticketing | Onboarding fuorviante |

## 8. Convenzioni osservate (vincoli per l'upgrade)

- Italiano ovunque nell'UI; commenti di codice in italiano che spiegano il *perché*.
- Server Actions con validazione difensiva (`requireAdmin`, controlli tipo, `revalidatePath` mirati).
- Niente ORM: SQL diretto, query commentate.
- UI: glassmorphism, pillcole di stato con tone map centralizzate in `lib/tickets.ts`, icone `lucide-react`.
- Toast feedback centralizzato (`admin-toaster` con chiavi per azione).
