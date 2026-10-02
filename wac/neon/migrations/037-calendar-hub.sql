-- ── 037: CALENDAR HUB — un solo calendario per ogni impegno del team ──
-- Difetto sul vivo: gli impegni vivono in tre posti che non si parlano
-- (callback del gestionale, calendario Google dell'agenzia, agenda
-- personale di Daniele e Michele). Chi deve decidere «quando facciamo
-- l'installazione?» deve aprire tre schede e incrociarli a mano.
--
-- CURA: calendar_items, tabella UNIFICATA di proiezione (non fonte):
--   kind = 'callback'     → specchio di callbacks (provenienza gestionale)
--   kind = 'personal'     → impegni personali degli operatori (solo qui)
--   kind = 'busy'         → tempo occupato letto DAI PROVIDER (Google/CalDAV
--                           via iCal): non si edita, si aggiorna col pull
-- Provenienza del dato in `origin` (callback | google | ical | manual),
-- idempotenza per pull con (origin, external_id) unico: ripassare lo
-- stesso evento non crea doppioni.
--
-- Il PUSH verso Google resta quello di 033 (gcal_sync_log): questa
-- tabella legge il calendario, non lo sostituisce.
--
-- Config in content_settings key 'calendar_hub_config':
--   { icalUrls: [{label, url, enabled}], pullEnabled, exportTokenHash }
-- exportTokenHash: sha256 del token per i feed /api/calendar/feed (mai il
-- token in chiaro nel DB).

create table if not exists calendar_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                 -- callback | personal | busy
  origin      text not null default 'manual',-- callback | google | ical | manual
  external_id text,                          -- id evento provider (dedup pull)
  operator_id text references operators(id), -- chi è coinvolto (se noto)
  callback_id uuid references callbacks(id), -- specchio del gestionale (se callback)
  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  all_day     boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Dedup del pull: stesso evento esterno = stessa riga (upsert).
create unique index if not exists calendar_items_origin_ext_idx
  on calendar_items (origin, external_id) where external_id is not null;
-- Le viste del calendario filtrano sempre per tempo.
create index if not exists calendar_items_window_idx on calendar_items (starts_at, ends_at);

-- Config (come gcal_config, sla-policy ecc.: content_settings è la casa
-- delle configurazioni). Default: pull SPENTO (niente sorprese finché
-- l'admin non configura le sorgenti), nessuna sorgente iCal.
insert into content_settings (key, value, updated_at)
values ('calendar_hub_config', '{"pullEnabled": false, "icalUrls": []}'::jsonb, now())
on conflict (key) do nothing;
