-- ── 004: OPERATORE AI (Ambrosio) ────────────────────────────────
-- Riga singola di configurazione: provider, modello, chiave (cifrata),
-- prompt di sistema, on/off. Editabile da /admin/ai senza toccare il codice.

create table if not exists ai_settings (
  id            int primary key default 1 check (id = 1),
  enabled       boolean not null default false,
  provider      text not null default 'anthropic', -- anthropic | openai | openrouter | custom
  model         text,
  api_key_enc   text,                              -- AES-256-GCM (chiave da ADMIN_SESSION_SECRET)
  base_url      text,                              -- solo provider "custom" (OpenAI-compatible)
  system_prompt text,
  temperature   numeric not null default 0.4,
  updated_at    timestamptz not null default now()
);

insert into ai_settings (id) values (1) on conflict (id) do nothing;
