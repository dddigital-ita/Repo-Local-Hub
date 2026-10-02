-- ── 003: TICKETING SYSTEM + AGENTI MULTIPLI ────────────────────
-- Le conversazioni diventano ticket assegnabili; ogni agente vede
-- i propri ticket e quelli dei colleghi (collaborazione piena).

-- 1. Gli account admin si collegano agli operatori (identità nel team)
alter table admin_users add column if not exists operator_id text references operators(id);
alter table admin_users add column if not exists display_name text;

-- 2. Il ticket estende la conversazione
alter table conversations add column if not exists number serial;
alter table conversations add column if not exists priority text not null default 'normale';  -- bassa | normale | alta | urgente
alter table conversations add column if not exists assigned_to text references operators(id);
alter table conversations add column if not exists first_response_at timestamptz;
alter table conversations add column if not exists closed_at timestamptz;
alter table conversations add column if not exists closed_by text references operators(id);

-- numero leggibile per i ticket pre-esistenti (per le nuove fa la serial)
update conversations set number = r.n from (select id, row_number() over (order by created_at) as n from conversations where number is null) r where conversations.id = r.id;
create unique index if not exists conversations_number_idx on conversations (number);

-- 3. Indici per la inbox dei ticket
create index if not exists conversations_assigned_idx on conversations (assigned_to, status);
create index if not exists conversations_status_idx on conversations (status, updated_at desc);

-- 4. Nota interna sul ticket (visibile solo agli agenti, mai al cliente)
create table if not exists ticket_notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_email    text not null,
  body            text not null,
  created_at      timestamptz not null default now()
);
