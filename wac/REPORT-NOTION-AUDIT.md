# REPORT — Audit integrazione Notion (FASE 0)

> Audit del 24/09/2026, come richiesto da `PROMPT-NOTION-CONFIGURABILE.md`. Nessuna modifica al codice in questa fase. Riferimenti: `src/lib/notion.ts` (190 righe), `src/app/admin/notion/page.tsx`, `src/app/admin/actions.ts` (save/test/sync), `neon/migrations/007-notion.sql`, schema `leads` (schema.sql + mig. 001/002/005/007/008/011/014/021).

## 1. Stato attuale (cosa c'è, e funziona)

**Settings e sicurezza (tutto intoccabile)**
- Tabella `notion_settings` (id=1 singleton): `enabled`, `api_key_enc` (AES-256-GCM via `encryptKey`/`decryptKey` di `lib/ai.ts`), `database_id`, `last_test_at`, `last_test_ok`. Default `enabled=false`: l'integrazione è "pronta, in attesa chiavi".
- Chiave mai riverlata nel form (placeholder `••• salvata cifrata — lascia vuoto per conservarla`), mai in log o response.
- Test di connessione con messaggi d'errore utili: 401 (chiave), 404 (database NON condiviso con l'integrazione — il classico inciampo Notion), rete.

**Sincronizzazione lead (rigida ma funzionante)**
- `syncLeadsNotionAction` (manuale, da bottone): prende fino a **20** lead con `notion_synced_at is null`, li pusha in sequenza, marca `notion_synced_at = now()` su successo, **si ferma al primo errore**.
- `pushLeadToNotion`: mapping cablato a 11 proprietà, titolo `«name · phone»`, sorgente mappata `ai → "Ambrosio AI"`, altrimenti `"Script chat"`, `source_page` solo se http, rich_text troncati a 1900, data ISO8601.
- Rate limit Notion (3 req/s): rispettato *per accidentalmente* (loop sequenziale con fetch da 10s timeout), non per progetto — nessuna gestione 429/`Retry-After`.

## 2. Cosa è cablato (inventario per voce del CONFIG)

| Voce CONFIG | Oggi | Dove sta il valore hardcoded |
|---|---|---|
| `entita` | Solo lead, solo manuale | `syncLeadsNotionAction` non è richiamabile da altro |
| `mapping_leads` | 11 proprietà fisse | `NOTION_LEAD_PROPERTIES` + corpo di `pushLeadToNotion` |
| Campi lead ignorati | `company`, `company_name`, `existing_site`, `temperature`, `ricontatta_il`, `hot`, `consent`, UTM, `callback_slot` | — (non sincronizzati, attivabili solo via codice) |
| `template_titolo` | `«name · phone»` | in `pushLeadToNotion` |
| `select_mapping` | Solo `Sorgente` | in `pushLeadToNotion` (ternario `ai`/`Script chat`) |
| `sincronizzazione.batch_max` | 20 | in `syncLeadsNotionAction` |
| `coda_persistente` | **No** | se il push fallisce, il lead riprova solo alla prossima sync manuale |
| `retry` | 1 tentativo, stop al primo errore | in `syncLeadsNotionAction` |
| `idempotenza` | `notion_synced_at` | già esiste (mig. 007) — ok |
| `on_update` | No | — |
| `errori.non_bloccante` | Sì (parziale) | l'action admin mostra l'errore, ma nessun log di sync persistente |
| `pii_nei_log` | n/d | nessun log di sync esiste |
| `dry_run` | No | — |
| `admin.editor_mapping` | No | la pagina mostra solo l'elenco statico `NOTION_LEAD_PROPERTIES` |

## 3. Gap e rischi

1. **Nessuna coda persistente**: un lead su cui il push fallisce resta `notion_synced_at is null` (ok, non perso), ma non c'è contatore tentativi né storico errori: se Notion è giù per un giorno, nessuno lo sa finché qualcuno non preme «Sincronizza».
2. **Nessuna gestione 429**: il loop sequenziale può superare 3 req/s su batch grandi; Notion risponde 429 e oggi l'action si ferma segnalandolo, senza riprovarci.
3. **Nessun sync log**: gli errori finiscono nel redirect `?test=ERRORE — …`, volatili.
4. **Mapping non estendibile**: aggiungere `company` a Notion = toccare il codice.
5. **Rate limit non progettato**: andrà gestito nel worker della coda (serializzatore + `Retry-After`).

## 4. Roadmap confermata (con criterio di "fatto")

- **FASE 1 — Motore di mapping**: migration 022 (colonne config su `notion_settings`, backward-compatible: `sync_config jsonb` con default = comportamento odierno, e `notion_sync_queue` pronta in Fase 2); adapter di tipi Notion (title/rich_text/select/url/date); transform (`mappa_sorgente`, `solo_http`, `iso8601`, troncamento); template titolo con placeholder e fallback; seed = valori del CONFIG. **Fatto quando**: con config di default, il payload generato per un lead è byte-identico a quello di oggi (verificato con dry-run).
- **FASE 2 — Coda affidabile**: tabella `notion_sync_queue` (entità, record_id, payload, tentativi, ultimo errore, prossima esecuzione); worker con rate limit rispettato (min 350ms tra chiamate), retry esponenziale, gestione 429 con `Retry-After`; trigger `on_create` opzionale (config, default **off** = comportamento odierno); sync manuale esistente portata sulla coda (drain). **Fatto quando**: con Notion spento la coda si riempie e non si svuota; appena acceso, si svuota; nessun lead spinto due volte.
- **FASE 3 — `/admin/notion` completo**: editor mapping (da `leads` → proprietà Notion, tipo, transform), template titolo, mapping select, batch/retry, **dry-run** (payload JSON senza chiamare l'API), sync log con esito per record. **Fatto quando**: cambiare una voce di config dalla pagina e vedere il dry-run rifletterla, senza toccare codice.
- **FASE 4 — Entità tickets/callbacks**: stesso motore, mapping proprio, **spente di default** (il CONFIG le dichiara `attiva: false`): nessuna chiamata API se non si attiva da config. **Fatto quando**: con `tickets.attiva=false` zero chiamate; attivandola, i ticket finiscono su Notion con il loro mapping.

Le regole operative valgono per tutte le fasi: non bloccante, mai DROP, chiave intatta, niente PII nei log, passi verificabili con typecheck/build.
