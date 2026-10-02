-- ── 019: FOLLOW-UP UNICO AI LEAD SPARITI (Ambrosio Fase 2) ──────
-- Il visitatore chiede prezzi, lascia un lead, poi sparisce. Il cron
-- lascia UN solo messaggio di follow-up nel thread della chat (che il
-- visitatore ritrova riaprendo il widget) e un avviso al team.
-- Dedup esplicito: conversations.followup_sent_at resta null finché
-- il follow-up non parte; la sua UPDATE atomica è il dedup.
alter table conversations add column if not exists followup_sent_at timestamptz;

-- Il cron cerca solo le righe ancora senza follow-up: indice parziale.
create index if not exists conversations_followup_idx
  on conversations (updated_at)
  where followup_sent_at is null;
