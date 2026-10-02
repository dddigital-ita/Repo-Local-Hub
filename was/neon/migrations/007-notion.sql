-- ── 007: NOTION — collegamento API per future integrazioni ──────
-- Stessa tabella-settings già usata per Ambrosio (id = 1, chiave cifrata).
-- La sincronizzazione lead verso un database Notion si attiverà quando
-- l'agenzia creerà l'integrazione e il database su notion.so.

create table if not exists notion_settings (
  id            integer primary key default 1,
  enabled       boolean not null default false,
  api_key_enc   text,                            -- secret integrazione (ntn_…), AES-256-GCM
  database_id   text,                            -- id del database Notion che riceve i lead
  last_test_at  timestamptz,                     -- ultimo test di connessione riuscito
  last_test_ok  boolean,
  updated_at    timestamptz not null default now()
);

-- Tracciamento: quando il lead è stato spinto su Notion (per sync selettiva)
alter table leads add column if not exists notion_synced_at timestamptz;
