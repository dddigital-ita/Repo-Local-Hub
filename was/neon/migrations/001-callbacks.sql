-- ── CALLBACKS (richiami fissati dalla chat, fuori turno) ─────────
create table if not exists callbacks (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  lead_id         uuid references leads(id),
  operator_id     text references operators(id),
  scheduled_at    timestamptz not null,
  slot_label      text,
  status          text not null default 'pending',  -- pending | done | missed
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists callbacks_status_idx on callbacks (status, scheduled_at);

alter table leads add column if not exists callback_id uuid references callbacks(id);
