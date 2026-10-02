-- ── 028: AUTONOMIA AMBROSIO — 3 LIVELLI, DOCUMENTI, PROPOSTE ──
-- Il richiesto «dai ad Ambrosio la lista degli accessi» NON è una tabella di
-- permessi: è una CODA DI QUALIFICAZIONE. L1 parla di se stesso e della
-- quali-bottoni (nessun accessorio necessario); L2 usa i tool che la whitelist
-- per-livello ammette; L3 eredita tutto e aggiunge prepara_proposta.
-- Dentro ai_settings: livello attivo, tetto mosse L2, take-over SLA (L3).
create table if not exists ai_settings (
  id            int primary key default 1 check (id = 1),
  enabled       boolean not null default false,
  provider      text not null default 'anthropic',
  model         text,
  api_key_enc   text,
  base_url      text,
  system_prompt text,
  temperature   numeric not null default 0.4,
  autonomy_level       smallint not null default 1 check (autonomy_level between 1 and 3),
  autonomy_moves_cap   int not null default 4,
  autonomy_takeover_sl boolean not null default true,
  autonomy_takeover_docs text,
  updated_at    timestamptz not null default now()
);

insert into ai_settings (id) values (1) on conflict (id) do nothing;

-- Su DB PRE-ESISTENTI il create table if not exists sopra è un no-op: le
-- colonne di autonomia vanno aggiunte esplicitamente (idempotente). Prima
-- versione della migration le aveva SOLO nel create: su ogni DB con
-- ai_settings già creata non arrivavano mai (bug scoperto in playtest).
alter table ai_settings add column if not exists autonomy_level       smallint not null default 1;
alter table ai_settings add column if not exists autonomy_moves_cap   int not null default 4;
alter table ai_settings add column if not exists autonomy_takeover_sl boolean not null default true;
alter table ai_settings add column if not exists autonomy_takeover_docs text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_settings_autonomy_level_check' and conrelid = 'ai_settings'::regclass) then
    alter table ai_settings add constraint ai_settings_autonomy_level_check check (autonomy_level between 1 and 3);
  end if;
end $$;

-- Istruzione documentale: la biblioteca di Ambrosio (L3 la cita «secondo il
-- documento X»; L2 non la cita mai per non nominare pagine che il cliente
-- non può leggere). Colonne comuni a entrambi per la UI e la sanitizzazione.
create table if not exists ai_documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 150),
  body        text not null check (length(btrim(body)) between 1 and 8000),
  category    text not null default 'operativo'
                check (category in ('operativo','commerciale','tecnico','procedura')),
  lang        text not null default 'it' check (lang in ('it','en','de','fr','es')),
  priority    int not null default 10,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_documents_active_idx on ai_documents (active, priority, lang);

-- Proposte/preventivi scritti da Ambrosio (L3): sempre BOZZA, mai inviate da
-- sole. La proposta buona non è quella salvata, è quella accettata dal team.
create table if not exists ai_proposals (
  id             uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  title          text not null check (length(btrim(title)) between 1 and 150),
  body           text not null check (length(btrim(body)) between 1 and 12000),
  items          jsonb not null default '[]'::jsonb,
  status         text not null default 'draft' check (status in ('draft','approved','sent','won','lost')),
  extras         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ai_proposals_list_idx on ai_proposals (status, created_at desc);

-- Take-over SLA (step 11 del tick): DEDUP esplicito, convenzione del progetto.
alter table conversations add column if not exists ai_takeover_at timestamptz;
