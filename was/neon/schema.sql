-- ═══════════════════════════════════════════════════════════════
-- Schema Neon per WebAgencySalento
-- Come usarlo: copia TUTTO e incollalo nella SQL Console di Neon
-- (console.neon.zt → il tuo progetto → SQL Editor) → Run
-- ═══════════════════════════════════════════════════════════════

-- ── OPERATORS (team vero, turni) ──────────────────────────────
create table if not exists operators (
  id                 text primary key,            -- 'A' | 'B'
  first_name         text not null,
  phone              text not null,
  whatsapp           text,
  shift_start        int  not null default 9,     -- ora inizio turno (0–23)
  shift_end          int  not null default 13,    -- ora fine turno (esclusa)
  active             boolean not null default true,
  available_override boolean,                     -- toggle manuale da /admin (null = segui turno)
  created_at         timestamptz not null default now()
);

-- ── CONVERSATIONS ─────────────────────────────────────────────
create table if not exists conversations (
  id             uuid primary key default gen_random_uuid(),
  initial_query  text not null default '',
  source_page    text,
  status         text not null default 'bot',    -- bot | lead_captured | operator | callback_scheduled | closed
  operator_id    text references operators(id),
  lead_id        uuid,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  callback_slot  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── MESSAGES ──────────────────────────────────────────────────
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender          text not null,                 -- visitor | operator | system
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);

-- ── LEADS ─────────────────────────────────────────────────────
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  name            text not null,
  phone           text not null,
  service         text,
  urgency         text,
  existing_site   text,
  budget          text,
  consent         boolean not null default false,
  hot             boolean not null default false,
  status          text not null default 'nuovo', -- nuovo | contattato | chiuso
  notes           text,
  initial_query   text,
  source_page     text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  callback_slot   text,
  created_at      timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status, created_at);

-- ── ADMIN (login dashboard: email + password hash scrypt) ─────
create table if not exists admin_users (
  email        text primary key,
  password_hash text not null,                   -- scrypt: salt:hash (hex)
  created_at   timestamptz not null default now()
);

-- ── CONTENT (chip, script, FAQ — editor Fase 3) ───────────────
create table if not exists content_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── SEED: policy SLA per priorità (ore di calendario) ─────────
-- WEB AGENCY SALENTO: finestre tarate sui turni Lun–Ven 9–19, così le
-- ore notturne/weekend vengono assorbite senza violazioni finte. Gli
-- stessi valori sono impostabili dall'admin (/admin/settings/sla):
-- il seed entra SOLO se la chiave non esiste (mai sovrascritto il
-- salvataggio di un operatore su DB già in uso; rieseguire è no-op).
insert into content_settings (key, value)
values ('ticket_sla_policy', jsonb_build_object(
  'urgente', jsonb_build_object('nextReplyH', 2,  'resolveH', 16),
  'alta',    jsonb_build_object('nextReplyH', 4,  'resolveH', 40),
  'normale', jsonb_build_object('nextReplyH', 8,  'resolveH', 72),
  'bassa',   jsonb_build_object('nextReplyH', 24, 'resolveH', 120)
))
on conflict (key) do nothing;

-- ── updated_at automatico ─────────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists conversations_touch on conversations;
create trigger conversations_touch
  before update on conversations
  for each row execute function touch_updated_at();

-- ── SEED: team vero + admin ───────────────────────────────────
insert into operators (id, first_name, phone, shift_start, shift_end, active)
values
  ('A', 'Daniele', '+393200865907', 9, 14, true),
  ('B', 'Daniele', '+393200865907', 14, 19, true)
on conflict (id) do nothing;

-- Admin: creato via script "npm run admin:create" (hash scrypt) — vedi README.
-- ── FINE ──────────────────────────────────────────────────────
