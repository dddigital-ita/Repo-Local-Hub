-- ── 011: CHIAVI MULTI-PROVIDER PER AMBROSIO (fallback automatico) ──
-- Ambrosio può usare più intelligenze artificiali (Claude, OpenAI, Gemini,
-- OpenRouter, CodeX/Freebuff, provider custom). Se il provider primario
-- risponde errore o ha token esauriti, passa al successivo senza bloccare
-- la chat. Le chiavi restano cifrate AES-256-GCM come le altre.

create table if not exists ai_provider_keys (
  provider     text primary key,           -- anthropic | openai | gemini | openrouter | freebuff | custom
  api_key_enc  text not null,              -- cifrata AES-256-GCM
  model        text,                       -- modello opzionale specifico per questo provider
  base_url     text,                       -- solo per provider custom
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now()
);
