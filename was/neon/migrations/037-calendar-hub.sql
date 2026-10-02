-- ═══════════════════════════════════════════════════════════════════
-- 037 CALENDAR HUB — un'unica vista del tempo dell'agenzia.
-- ═══════════════════════════════════════════════════════════════════
--
-- Il problema: il tempo dell'agenzia vive in PEZZI sparsi — callbacks nel
-- DB (push verso Google), impegni personali dei colleghi SOLO nei loro
-- calendari (Google/Apple), SLA e ticket senza rappresentazione temporale.
-- Chi assegna il lavoro non vede il giorno; Ambrosio non può consultare
-- la disponibilità reale prima di proporre un orario.
--
-- La soluzione: CALENDAR_ITEMS, un archivio unico di "impegni agenzia"
-- con origine esplicita:
--   source='internal' → nato qui (callback fissata, appuntamento prenotato,
--                        blocco manuale, finestra SLA critica)
--   source='external' → caricato da un calendario esterno (Google esistente
--                        o feed iCalendar/ICS di Apple Calendar) via
--                        calendar_sources (pull periodico READ-ONLY)
-- Assegnatario: operator_id (persona) oppure assigned_ai=true (Ambrosio).
-- Privacy: gli impegni esterni hanno title_rl (title redacted/label) che
--   l'admin normale vede al posto del titolo vero; solo super admin vede
--   tutto. La disponibilità è pubblica dentro il team, il contenuto no.
--
-- Additiva e idempotente come tutte le migration del repo. Nessuna colonna
-- su tabelle esistenti: callbacks e gcal_sync_log restano dove sono.
--
-- EXPORT per WAC (WebAgencyCrema): gli item interni escono via feed
-- iCalendar (/api/calendar/ics) e JSON (/api/calendar/export) — il feed
-- può essere aggiunto come "calendario abbonato" ovunque.

-- ── SORGENTI ESTERNE (calendari letti in pull) ────────────────────
create table if not exists calendar_sources (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                 -- 'gcal' | 'ics'
  label         text not null,                 -- «Google agenzia», «Daniele (Apple)»
  operator_id   text references operators(id), -- di chi è il calendario
  url           text,                          -- per ics: https://…/basic.ics
  calendar_id   text,                          -- per gcal: id del calendario
  color         text not null default '#2F6BFF',
  visible       boolean not null default true, -- toggle rapido nella vista
  last_pull_at  timestamptz,
  last_status   text,                          -- ok | error
  last_error    text,
  created_at    timestamptz not null default now(),
  -- vincoli di dominio: un sorgente ha un URL o un calendar_id, mai nulla
  constraint calendar_sources_kind_chk check (kind in ('gcal','ics')),
  constraint calendar_sources_addr_chk check (
    (kind = 'ics' and url is not null) or (kind = 'gcal' and calendar_id is not null)
  )
);

-- ── ARCHIVIO UNICO DEGLI IMPEGNI ──────────────────────────────────
create table if not exists calendar_items (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid references calendar_sources(id) on delete cascade,
  source         text not null default 'internal', -- internal | external
  kind           text not null,                    -- callback | appointment | personal | block | sla
  title          text not null,                    -- titolo completo (super admin / interno)
  title_rl       text,                             -- titolo offuscato per l'admin normale (external)
  starts_at      timestamptz not null,
  ends_at        timestamptz,                      -- null = impegni senza durata (solo istante)
  all_day        boolean not null default false,
  operator_id    text references operators(id),    -- assegnatario umano
  assigned_ai    boolean not null default false,   -- true = l'impegno è di Ambrosio
  -- collegamenti facoltativi al mondo ticket/lead (per internal)
  conversation_id uuid references conversations(id) on delete set null,
  callback_id     uuid references callbacks(id) on delete cascade,
  lead_id         uuid references leads(id) on delete set null,
  notes          text,
  location       text,
  -- vita del pull per gli external (dedup e aggiornamenti)
  ext_uid        text,                             -- uid dell'evento esterno (ics UID / gcal event id)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint calendar_items_source_chk check (source in ('internal','external')),
  constraint calendar_items_kind_chk check (kind in ('callback','appointment','personal','block','sla')),
  constraint calendar_items_ext_unique unique (source_id, ext_uid)
);
create index if not exists calendar_items_window_idx on calendar_items (starts_at, ends_at);
create index if not exists calendar_items_operator_idx on calendar_items (operator_id, starts_at);
create index if not exists calendar_items_callback_idx on calendar_items (callback_id);

-- ── SFINATA DELLE IMPOSTAZIONI HUB (chiave in content_settings) ───
-- calendar_hub_config: { busy_private: true (offusca external per admin),
--   work_start: 9, work_end: 19, work_days: [1,2,3,4,5], slot_minutes: 30 }
-- Il seed entra solo se la chiave non esiste mai: niente sovrascritture.
-- export_token NON è qui: lo genera l'app al primo salvataggio dalla UI
-- (crypto.randomUUID lato server) — niente estensioni Postgres da abilitare.
insert into content_settings (key, value)
values ('calendar_hub_config', jsonb_build_object(
  'busy_private', true,
  'work_start', 9,
  'work_end', 19,
  'work_days', jsonb_build_array(1,2,3,4,5),
  'slot_minutes', 30
))
on conflict (key) do nothing;
