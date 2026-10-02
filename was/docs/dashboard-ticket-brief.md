# Dashboard Brief: Monitoraggio Ticket

**Business Question:** «Stiamo rispettando gli SLA promessi e dove si accumula il volume dei ticket — per canale, per operatore, per priorità?»
**Audience:** Operations (i 2 agenti Daniele/Michele) + titolare/super admin (lettura aggregata)
**Refresh Rate:** On-load (`force-dynamic`, stesso pattern delle pagine admin) — nessun cron necessario
**Data Sources:** PostgreSQL (Neon): `conversations`, `messages`, `operators`, `leads`
**BI Tool:** Custom — React Server Component inline (nessuna chart library nel progetto, budget bundle sorvegliato da `scripts/check-bundle-budget.mjs`)

---

## Verdetto: merita la pagina `/admin/tickets/dashboard`?

**SÌ — ma come pagina «leggera» senza librerie di chart.** Le ragioni, validate sul codice:

1. **La inbox ha un principio documentato da non violare**: «UN solo numero qui: l'azione dovuta» (commento in `src/app/admin/tickets/page.tsx`). Aggiungerci trend e aggregati sporcherebbe lo strumento di triage, che è fatto per scansionare e decidere.
2. **`/admin` (Panoramica) è funnel-wide, non ticket-deep**: porta lead, callback, portafoglio clienti. La profondità ticket (tempi di risposta, aging, carico per operatore) non sta lì.
3. **Routing senza conflitti**: il segmento statico `/admin/tickets/dashboard` convive con `/admin/tickets/[id]` (Next risolve i segmenti statici prima dei dinamici).
4. **Zero migration necessarie** (verificato su `neon/schema.sql` + migrations 003/013/017/021/023): tutti i campi servono già esistono.
5. **Anti-over-engineering**: con 2 operatori e decine di ticket/settimana, una suite di grafici sarebbe rumore. La forma giusta è: 5 KPI card + barre CSS (niente recharts/d3) + tabelle. Un file pagina + un gruppo di query in `lib/tickets.ts`.

---

## Sezione 1: Metriche chiave (KPI Cards)

| Metrica | Definizione | Data Source | Confronto |
|---|---|---|---|
| Ticket aperti | `status NOT IN ('closed','on_hold') AND archived_at IS NULL` | conversations | vs. 7gg prima |
| Da rispondere adesso | Aperto, non bot, ultimo messaggio = `visitor` (stessa logica di `AWAITING_SQL` in `lib/tickets.ts`) | conversations + messages | vs. istante precedente; sub: «il più vecchio aspetta da Xh» |
| Media prima risposta (7gg) | `AVG(first_response_at - created_at)` sui ticket con prima risposta negli ultimi 7 giorni | conversations | vs. target 2h (`SLA_TARGET_H`) |
| Risolti (7gg) | `closed_at` negli ultimi 7 giorni | conversations | vs. 7gg prima |
| Violazioni SLA (7gg) | Ticket non bot con `(first_response_at - created_at) > 2h` OPPURE `first_response_at IS NULL AND created_at < now() - 2h` | conversations | vs. settimana prima |

5 card: entro il limite 3–6 della brief. La sub della card 2 («il più vecchio aspetta da Xh») è il numero che fa alzare dal letto: senza, il totale non dice l'urgenza.

## Sezione 2: Grafici e visualizzazioni

### Chart 1: Volume ticket per giorno (ultimi 30gg)

- **Chart type:** Barre (CSS, colonne div per giorno) — sovrapposte per canale
- **Why this chart type:** serie temporale discreta a granularità giornaliera; con volumi bassi (0–20/giorno) le barre leggono meglio di una linea
- **X-axis:** giorno (`date_trunc('day', created_at)`) · **Y-axis:** numero ticket creati
- **Breakdown/colour:** per `channel` (web / email / whatsapp — stessi colori delle tab della inbox)
- **Data source:** conversations · **Filters:** nessuno (tutti i canali, anche archiviati contati a parte)
- **Key insight to surface:** un canale nuovo che cresce (es. email dopo l'attivazione casella) prima che sia colto dalla coda

### Chart 2: Distribuzione tempi di prima risposta (30gg)

- **Chart type:** Barre orizzontali a bucket: ≤1h / 1–2h / 2–4h / >4h / mai risposto
- **Why this chart type:** distribuzione su soglie (le soglie SLA sono fisse: 2h target, 4h ritardo) — il bucket «2–4h» è esattamente la zona di pericolo
- **Rows:** bucket · **Values:** numero ticket · **Data source:** conversations
- **Key insight to surface:** quanta parte della coda cade oltre i 2h promessi — il numero da difendere settimana per settimana

### Chart 3: Carico per operatore

- **Chart type:** Barre orizzontali (2 righe: Daniele, Michele) + barra «Non assegnati»
- **Why this chart type:** confronto tra categorie poche e fisse
- **Rows:** `assigned_to` → `operators.first_name` · **Values:** ticket aperti · **Breakdown:** da rispondere vs. totale
- **Data source:** conversations + operators
- **Key insight to surface:** squilibrio A/B e peso del bacino «non assegnati» (da prendere in carico)

### Chart 4: Aging del backlog aperto

- **Chart type:** Tabella a bucket di età: <24h / 1–3gg / 3–7gg / >7gg
- **Why this chart type:** l'età è categorica per decisione (chi toccare prima), non continua
- **Rows:** bucket di `created_at` sui ticket aperti · **Values:** conteggio + link alla inbox pre-filtrata
- **Key insight to surface:** i ticket zombie (>7gg aperti) che la coda ordinata per urgenza nasconde in fondo

### Chart 5: Mix canale e priorità (tabella compatta)

- **Chart type:** Tabella: canale × (totale 30gg, % sul totale, da rispondere) — righe priorità sotto
- **Why this chart type:** valori pochi e percettivamente testuali; un pie chart qui sarebbe decorazione
- **Key insight to surface:** il canale email ha bisogno di «Sincronizza» o muore silenziosamente (0 email = nessuno si accorge)

## Sezione 3: Filtri e controlli

| Filtro | Tipo | Default | Opzioni |
|---|---|---|---|
| Periodo | Select | Ultime 30 giorni | 7 / 30 / 90 giorni |
| Canale | Dropdown (tab, come la inbox) | Tutti | web / email / whatsapp |
| Operatore | Dropdown | Tutti | Daniele / Michele / Non assegnati |
| Priorità | Multi-select | Tutte | bassa / normale / alta / urgente |

Tutti via query string (`?days=30&channel=…`) — stesso pattern `qs()` della inbox, niente stato client. Nessun filtro richiede configurazione IT.

## Sezione 4: Layout raccomandato

```
[RIGA 1 — KPI Cards]: Aperti | Da rispondere (+età max) | Media 1ª risposta | Risolti 7gg | Violazioni SLA
[RIGA 2 — Grafico full width]: Volume/giorno per canale (30gg)
[RIGA 3 — Due affiancati]: Distribuzione 1ª risposta | Carico per operatore
[RIGA 4 — Tabella full width]: Aging backlog + Mix canale/priorità
[RIGA 5 — Link di uscita]: → Inbox pre-filtrata «Da rispondere»
```

Gerarchia: sintesi → trend → distribuzione → dettaglio. L'uscita finale trasforma la lettura in azione (stesso gesto «Vai a Tutti» della inbox vuota).

## Sezione 5: Requisiti dati

| Campo derivato | Logica | Tabelle |
|---|---|---|
| response_minutes | `EXTRACT(EPOCH FROM (first_response_at - created_at))/60` | conversations |
| resolve_minutes | `EXTRACT(EPOCH FROM (closed_at - created_at))/60` | conversations |
| is_awaiting | ultimo `messages.sender = 'visitor'` e status attivo (riusare `LAST_SENDER_SQL`) | conversations + messages |
| breach_flag | response_minutes > 120 oppure mai risposto con età > 120 min | conversations |

**Campi mancanti / caveat (onesti):**
- ⚠️ **Nessun contatore di riapertura**: un ticket riaperto non è tracciato (niente colonna); la metrica «riaperti» NON è specificabile — da non promettere.
- ⚠️ **Policy SLA storica**: `content_settings` (chiave `ticket_sla_policy`) può cambiare nel tempo; i breach storici calcolati sui default 2h/4h sono un'approssimazione se la policy è stata modificata. Accettabile a questa scala, da documentare nella pagina.
- ✅ Tutti gli altri campi esistono già (migrations 003, 013, 017, 021, 023 verificate).

## Sezione 6: Accesso e ownership

- **Dashboard owner:** _da assegnare (titolare agenzia)_
- **Chi può modificare:** super admin
- **Chi può vedere:** tutti gli admin autenticati (stesso `requireAdmin()` delle altre pagine)
- **Cadenza di revisione:** trimestrale — o quando cambia il team (nuovo operatore = nuova riga nei grafici di carico)

## Quality checks

- [x] Ogni chart ha un «key insight to surface»
- [x] 5 KPI card (entro 3–6)
- [x] Tipi di chart giustificati contro la forma dei dati
- [x] Layout: sintesi → dettaglio
- [x] Requisiti dati validati sullo schema reale (con 2 caveat espliciti)
- [x] Filtri via URL, senza configurazione
