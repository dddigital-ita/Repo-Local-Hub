-- ── 025: PORTAFOGLIO CLIENTI (gestito da Ambrosio) ───────────────
-- Il cliente è la PERSONA/azienda riconosciuta dai ticket: Ambrosio
-- ricompone automaticamente l'identità (nome, telefono, email, ditta)
-- dai dati già raccolti in qualificazione e su ogni canale (chat web,
-- email, WhatsApp), senza doppioni. Nessun dato viene COPIATO: le
-- schede collegano i ticket esistenti (fonte di verità resta il ticket).
-- Tutto additivo: senza migration il portafoglio resta vuoto e il sito
-- funziona identico a prima (convenzione «degradato ma vivo»).

-- 1. La scheda cliente. Riferimenti SOFT (ticket_id/lead_id testuali):
--    cancellare un ticket non deve mai cancellare il cliente.
create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- Identità: telefono/email in forma normalizzata = chiavi di dedup.
  phone_e164    text,                 -- E.164 (messaging.toE164)
  email_norm    text,                 -- email minuscola
  company_name  text,
  contact_email text,                 -- email così com'era (per mailto:)
  notes         text,                 -- nota libera dell'agente
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  synced_at     timestamptz,          -- ultimo passaggio di Ambrosio
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Dedup: uno stesso numero/email NON crea due clienti.
create unique index if not exists clients_phone_key
  on clients (phone_e164) where phone_e164 is not null;
create unique index if not exists clients_email_key
  on clients (email_norm) where email_norm is not null;
create index if not exists clients_last_seen_idx on clients (last_seen_at desc);

-- 2. Roster dei ticket visti dal sync (niente scansione infinita: ogni
--    ticket nuovo viene processato UNA volta, la UPDATE atomica è il lock
--    anche se due tick corrono in parallelo).
create table if not exists client_conversations (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  synced_at       timestamptz not null default now()
);

create index if not exists client_conversations_client_idx
  on client_conversations (client_id);
