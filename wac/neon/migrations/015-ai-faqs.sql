-- ── 015: FAQ ADDESTRATIVE PER AMBROSIO ──────────────────────────
-- Le domande vere dei clienti (block "cosa chiede la gente") diventano
-- istruzioni: per ognuna l'agenzia scrive la risposta vincente che
-- Ambrosio deve dare. Iniettate nel prompt di sistema in ordine di
-- priorità: le prime sono quelle che chiudono l'appuntamento.
create table if not exists ai_faqs (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  priority    int not null default 50,     -- 1 = prima (più importante)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_faqs_order_idx on ai_faqs (active, priority, created_at);
