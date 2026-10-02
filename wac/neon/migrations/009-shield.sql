-- ── 009: SHIELD SECURITY — scudo anti-hack/anti-spam ────────────
-- Log degli eventi sospetti e ban persistente degli IP (i rate limit
-- in-memory proteggono l'istanza; il DB rende il ban permanente).

create table if not exists shield_events (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  kind       text not null,          -- rate_limit | honeypot | bad_payload | ban | unban
  endpoint   text,                   -- /api/chat/message, /api/lead, …
  detail     text,                   -- es. "11 richieste/min", "campo honeypot pieno"
  created_at timestamptz not null default now()
);

create table if not exists shield_bans (
  ip         text primary key,
  reason     text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists shield_events_created_idx on shield_events (created_at desc);
create index if not exists shield_events_ip_idx on shield_events (ip);
