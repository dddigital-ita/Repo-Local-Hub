-- ── 029: LOG DEI PROVIDER AI (osservabilità catena di fallback) ──
-- Ogni risposta di Ambrosio registra CHI ha risposto (used_provider) e CHI
-- è stato provato e fallito prima (fallbacks_tried, in ordine di tentativo).
-- Serve per vedere sul vivo: quanto spesso il primario muore, con che errore,
-- e se il fallback regge la chat. Best-effort: un errore qui non deve MAI
-- rompere la chat (stessa filosofia di ai_faq_usage).
create table if not exists ai_provider_log (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references conversations(id) on delete set null,
  used_provider    text not null,
  fallbacks_tried  jsonb not null default '[]'::jsonb,
  used_model       text,
  latency_ms       int,
  created_at       timestamptz not null default now()
);
create index if not exists ai_provider_log_recent_idx on ai_provider_log (created_at desc);
create index if not exists ai_provider_log_conv_idx on ai_provider_log (conversation_id);
