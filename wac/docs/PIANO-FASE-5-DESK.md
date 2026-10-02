# Piano Fase 5 — Outbound social e API REST (desk ticketing)

> Documento di pianificazione, non committato. Fondamenta già in produzione
> (Fasi 1–4 + ADR-001..006): il registry dei canali (`channel-registry.ts`),
> `channel_accounts` (040) con credenziali cifrate, la pipeline webhook
> idempotente (ADR-003), i panni puri verificati dalle sentinelle. La Fase 5
> chiude il cerchio: i canali social diventano BIDIREZIONALI e il desk
> diventa consumabile da fuori, con contratto OpenAPI.

## Obiettivo in una frase

Un operatore risponde dal ticket anche su Instagram/Messenger (oggi solo
inbound), e un'integrazione esterna autorizzata crea/legge/aggiorna ticket
via REST senza sessione admin — con lo stesso audit e la stessa firma
webhook che già sorvegliano la casa.

---

## Percorso 1 — Outbound social (Graph API)

### Che cosa esiste già (non si rifà)

- `channel_accounts` (040): credenziali cifrate AES-256-GCM
  (`credentials.secretEnc`), `external_id` = page/IG id, `enabled`.
- Adapter Meta in registry: firma webhook completa, parse inbound
  normalizzato (`parseMetaInbound`).
- Precedente storico: WhatsApp/Telegram outbound già vivi in
  `messaging.ts` con `adapterFor(channel)` e `canSendFollowup(channel)`
  come policy — la ricetta del contrato esiste.

### Decisioni di design (proposte)

1. **Un solo gateway outbound**: `src/lib/channel-outbound.ts` con
   `sendOutbound(account, conversationId, text)` — risolve il thread dal
   `(channel, contact_handle)`, sceglie l'endpoint Graph dal canale
   (Instagram `/{ig-id}/messages`, Messenger `/{page-id}/messages`),
   invia col token dell'account (`credentials.tokenEnc`), inserisce il
   messaggio nel thread col mirror di `telegram_chats` (provider_ref =
   mid Graph, idempotente con la UNIQUE già in 040).
2. **Riuso del dedup**: l'outbound social entra in `messages` con la
   stessa UNIQUE `(channel_account_id, provider_ref)` dell'inbound —
   niente tabelle nuove.
3. **Il composer resta l'unico punto di scrittura**: la route del desk
   (`POST /api/admin/tickets/[id]/reply`) estende l'adapter già esistente
   col caso social; l'operatore firma sempre lui. Le azioni AI non
   scrivono sul social (ADR-006 intatto).
4. **Credenziali per-account, non globali**: il pannello di configurazione
   social (scheda `channel_accounts`) arriva in questa fase — oggi la
   riga si crea solo via SQL/registry.

### Fasi interne

| Step | Contenuto | Criterio di accettazione |
|---|---|---|
| 5.1 ✅ FATTO 2026-10-02 | `channel-outbound-pure.ts` (puri zero-import: payload Graph, parse risposta, dispatch con fetch iniettabile) + `channel-outbound.ts` (thin layer: `resolveOutboundAccount`, mirror idempotente, Bot API Telegram, facciata `sendOutbound`) + guard `tests/channel-outbound.test.mjs` (17 test) + rationale `docs/CHANNEL-OUTBOUND-2026-10-02.md`; il form «Nuovo ticket» sceglie il canale (email/WhatsApp/Telegram, Meta e LinkedIn «in arrivo»), `createTicketAction` invia dal canale scelto | sentinella unit verde (17/17), provider_ref idempotente provata (ON CONFLICT sulla UNIQUE parziale di 040) |
| 5.2 | Config pannello admin per `channel_accounts` (crea/rota token, enabled) | leak-guard E2E sorveglia che le credenziali cifrate non escano |
| 5.3 | Composer social nel ticket (solo canali abilitati, disabilitato se account spento) | E2E: risposta → Graph mockato → riga nel thread → audit |
| 5.4 | tw sync dei moduli puri verso il gemello (`future-candidates` → `files`) | twin-sync --check verde in entrambi |

---

## Percorso 2 — API REST con OpenAPI

### Che cosa serve prima di tutto: l'autenticazione

L'admin è sessione cookie: non è un contratto per integrazioni. La Fase 5
 introduce **API key per progetto esterno** (migration 043):

```
api_keys (id, name, key_hash sha256, scopes text[], created_at,
          last_used_at, revoked_at)
```

- La chiave **grezza si vede una volta sola** (come i token GitHub): nel DB
  solo l'hash. Header `Authorization: Bearer wac_...`.
- **Scopes granulari**: `tickets:read`, `tickets:write`, `leads:read`,
  `audit:read` — il principio di ADR-001 (registry) qui diventa
  perimetro dell'API.
- **Audit**: ogni chiamata REST finisce in `audit_log` con
  `actor = "api:<nome>"` — lo stesso registro append-only del resto della
  casa: l'integrazione non è un cittadino speciale.

### Endpoint della prima versione (v1)

| Metodo | Percorso | Scope | Note |
|---|---|---|---|
| GET | `/api/rest/v1/tickets` | tickets:read | lista paginata con filtri inbox (stato, canale, SLA) |
| GET | `/api/rest/v1/tickets/{id}` | tickets:read | dettaglio con filo e impronte AI |
| POST | `/api/rest/v1/tickets/{id}/reply` | tickets:write | risposta firmata dall'integrazione (audit `api.*`) |
| POST | `/api/rest/v1/tickets` | tickets:write | apertura programmata (lead già qualificato) |
| GET | `/api/rest/v1/leads` | leads:read | portafoglio lead con filtri esistenti |

Errori RFC 7807 come il resto del CRM (type, title, status, detail) — lo
schema è già la casa. Rate limit semplice per chiave (sliding window in
memoria), 429 con `Retry-After`.

### OpenAPI come contratto, non come documento

- `src/app/api/rest/v1/openapi.json` generato **da una costante TS**
  (`src/lib/rest-contract.ts`) che definisce percorsi, scopes e schemi —
  il runtime valida le richieste CONTRO lo stesso oggetto che pubblica la
  spec: la doc non può divergere dal comportamento (stessa lezione delle
  sentinelle schema↔codice).
- Pagina `/api/rest/v1/docs` (o `/admin/api`) che rende la spec per il
  proprietario/integratore.
- Sentinella: ogni route REST dichiarata nel contratto deve esistere nel
  filesystem e viceversa (tests/rest-contract.test.mjs).

### Fasi interne

| Step | Contenuto | Criterio |
|---|---|---|
| 5.5 | Migration 043 `api_keys` + lib auth/scopes + audit | sentinella: chiave revocata rifiutata subito (come le sessioni admin) |
| 5.6 | `rest-contract.ts` + endpoint v1 + RFC 7807 | E2E: chiave valida → 200, scopes mancanti → 403, revocata → 401 |
| 5.7 | openapi.json generato + docs + sentinella contratto | spec = comportamento, provato in suite |
| 5.8 | CHANGELOG + ADR-007 (API keys vs sessioni; perché Bearer hash) | — |

---

## Non-goals (espliciti)

- **Webhook in uscita** verso i sistemi del cliente: è la fase dopo
  (5.9+), quando ci sarà la prima integrazione vera che lo chiede.
- **OAuth flows per i provider**: i token arrivano da Meta Business
  Manager e si incollano nel pannello — niente OAuth-in-app finché il
  numero di account lo giustifica.
- **Bulk export**: il CSV esiste già per il portafoglio; l'API paginata è
  il contratto, non lo streaming.
- **Gemello**: i moduli puri di outbound e il contratto REST passano nel
  gemello via twin-sync quando ce li chiede — non in anticipo.

## Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Token Graph scaduti al primo invio | il pannello mostra `last_used_at`/scadenza; errore dedotto nel 503 RFC 7807 con rimedio leggibile |
| Le API key diventano la seconda porta d'ingresso | scopes minimi per default, revoca immediata (stessa semantica delle sessioni), audit append-only, rate limit |
| La doc OpenAPI diverge dal codice | la spec GENERA dal runtime stesso + sentinella filesystem |
| Peso di 2 percorsi in parallelo | 5.1–5.4 prima, poi 5.5–5.8: nessuno step tocca l'altro |

## Sequenza proposta

**5.1 → 5.2 → 5.3 → 5.4 → 5.5 → 5.6 → 5.7 → 5.8**, con la release 0.7.0 al
termine del percorso 1 e la 0.8.0 a fine percorso 2 (versionamento
semantico del ticketing: le fasi sono le milestone, come da CHANGELOG).
