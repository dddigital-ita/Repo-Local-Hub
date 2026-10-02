-- ── 022: NOTION CONFIGURABILE (FASE 1 + FASE 2) ──────────────────
-- 1) Config di sincronizzazione su notion_settings: jsonb con DEFAULT
--    che riproduce ESATTAMENTE il comportamento odierno (stesso mapping,
--    stesso titolo, stesso batch): chi ha già il database Notion con le
--    colonne odierne non cambia nulla. Nessun DROP, mai.
-- 2) Coda persistente: se il push fallisce, il record resta in coda con
--    i tentativi e l'ultimo errore visibili, e riparte da solo al drain.

alter table notion_settings
  add column if not exists sync_config jsonb;

-- Valore di default = spec del CONFIG, sezione mapping_leads:
-- le 11 proprietà odierne con gli stessi nomi esatti, trasformazioni
-- identiche. Il codice usa coalesce(sync_config, default): chi non ha
-- mai toccato la config non vede alcuna differenza.
update notion_settings
  set sync_config = coalesce(sync_config, '{
    "entities": {
      "leads":     { "enabled": true,  "trigger": ["manual"],          "priority": "alta"  },
      "tickets":   { "enabled": false, "trigger": ["manual"],          "priority": "media" },
      "callbacks": { "enabled": false, "trigger": ["manual"],          "priority": "media" }
    },
    "leadMapping": [
      { "from": "name",          "to": "Nome",             "type": "title" },
      { "from": "phone",         "to": "Telefono",         "type": "rich_text", "maxLen": 1900 },
      { "from": "service",       "to": "Servizio",         "type": "select" },
      { "from": "urgency",       "to": "Urgenza",          "type": "select" },
      { "from": "budget",        "to": "Budget",           "type": "select" },
      { "from": "status",        "to": "Stato",            "type": "select" },
      { "from": "source",        "to": "Sorgente",         "type": "select", "transform": "mappa_sorgente" },
      { "from": "initial_query", "to": "Ricerca iniziale", "type": "rich_text", "maxLen": 1900 },
      { "from": "source_page",   "to": "Pagina origine",   "type": "url", "transform": "solo_http" },
      { "from": "notes",         "to": "Note",             "type": "rich_text", "maxLen": 1900 },
      { "from": "created_at",    "to": "Creato",           "type": "date", "transform": "iso8601" }
    ],
    "titleTemplate": "{{name}} · {{phone}}",
    "titleFallback": "Lead {{id}}",
    "selectMapping": { "Sorgente": { "ai": "Ambrosio AI", "*": "Script chat" } },
    "sync": {
      "batchMax": 20,
      "onCreate": false,
      "onUpdate": false,
      "retryAttempts": 3,
      "retryBaseMs": 2000
    }
  }')
  where id = 1;

-- Coda persistente: un record per tentativo di push. entity identifica
-- il tipo (lead/ticket/callback); record_id la chiave primaria; il
-- payload è calcolato dal motore di mapping al momento dell'enqueue
-- (così il worker non rilegge il lead: idempotente anche se il record
-- cambia mentre è in coda). attempts/last_error/next_run_at alimentano
-- il retry esponenziale e il sync log della pagina admin.
create table if not exists notion_sync_queue (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null check (entity in ('lead', 'ticket', 'callback')),
  record_id     uuid not null,
  payload       jsonb not null,
  attempts      integer not null default 0,
  last_error    text,
  last_error_at timestamptz,
  next_run_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (entity, record_id)
);
create index if not exists notion_sync_queue_due_idx
  on notion_sync_queue (next_run_at)
  where last_error_at is null or attempts < 3;
