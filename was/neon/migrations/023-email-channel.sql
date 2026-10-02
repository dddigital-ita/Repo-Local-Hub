-- ── 023: EMAIL COME CANALE DEI TICKET ─────────────────────────────
-- Le email in ricezione diventano ticket (canale 'email') e le risposte
-- degli agenti partono via SMTP con oggetto «[#N] …»: il ciclo del CRM
-- completo — caso = ticket, canale = email (Zendesk/Freshdesk).
-- Tutto additivo: le conversazioni esistenti restano 'web'.

-- 1. Email del richiedente: il canale email ne ha bisogno per rispondere.
--    (web ha il lead/telefono, email ha l'indirizzo del mittente.)
alter table conversations add column if not exists contact_email text;

-- 2. Coda di ingest: ogni email scaricata dalla casella agenzia.
--    message_id (header RFC 5322) è la chiave di dedup: la stessa email
--    scaricata due volte NON crea due ticket. processed_at resta null
--    finché l'email non è stata trasformata in ticket o risposta.
create table if not exists email_ingest (
  message_id   text primary key,
  mailbox      text not null default 'INBOX',
  from_address text not null,
  from_name    text,
  subject      text,
  body_text    text,
  received_at  timestamptz,
  processed_at timestamptz,
  ticket_id    uuid,
  error        text
);

create index if not exists email_ingest_unprocessed_idx
  on email_ingest (processed_at) where processed_at is null;

-- 3. Mappatura messaggio → header Message-ID: quando un agente risponde
--    da un ticket via SMTP, l'eventuale risposta del cliente riporta
--    In-Reply-To/References che punta qui → la mail finisce nel ticket
--    giusto invece di aprirne uno nuovo.
alter table messages add column if not exists email_message_id text;
create index if not exists messages_email_message_id_idx on messages (email_message_id);
