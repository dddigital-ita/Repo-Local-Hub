-- Tracciamento uso FAQ: quante volte Ambrosio usa ogni risposta ufficiale
-- e quante di quelle conversazioni hanno generato lead o callback.
create table if not exists ai_faq_usage (
  id              uuid primary key default gen_random_uuid(),
  faq_id          uuid not null references ai_faqs(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists ai_faq_usage_faq_idx on ai_faq_usage (faq_id, created_at);
create index if not exists ai_faq_usage_conv_idx on ai_faq_usage (conversation_id);
