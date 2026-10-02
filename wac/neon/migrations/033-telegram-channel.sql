-- ── 033: TELEGRAM COME CANALE BIDIREZIONALE ───────────────────────
-- Fino a oggi Telegram era solo in USCITA (notify.ts: lead, SLA, Shield,
-- backup). Da qui il bot risponde ANCHE ai messaggi che gli arrivano:
-- chi scrive al bot parla con Ambrosio, stesso cervello della web chat.
-- Tutto additivo: le conversazioni esistenti restano 'web'/'email'.

-- 1. Indirizzo di contatto generico del canale: per email è l'indirizzo
--    del mittente, per Telegram è il chat id (o @username). La risposta
--    operatore legge QUESTA colonna, non fa assunzioni sul canale.
alter table conversations add column if not exists contact_handle text;

-- 2. Registry delle chat Telegram che hanno interagito col bot: dati
--    già previsti dalle API Telegram (getUpdates), conservati qui per
--    rispondere senza toccare l'env e per la pagina admin futura.
create table if not exists telegram_chats (
  chat_id     text primary key,
  kind        text,            -- private | group | supergroup | channel
  title       text,            -- nome/chat title (update.message.chat)
  username    text,
  last_in_at  timestamptz,     -- ultimo messaggio inbound ricevuto
  last_out_at timestamptz,     -- ultima risposta inviata dal bot
  created_at  timestamptz not null default now()
);

-- 3. Ingest con dedup, stessa forma di email_ingest (migration 023):
--    update_id è la chiave che Telegram garantisce monotona e unica.
create table if not exists telegram_updates (
  update_id   bigint primary key,
  payload     jsonb,
  received_at timestamptz not null default now()
);
