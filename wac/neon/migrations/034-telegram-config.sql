-- ── 034: CONFIGURAZIONE TELEGRAM DA ADMIN ─────────────────────────
-- Token, chat del team e secret del webhook si gestiscono dalla scheda
-- admin (stesso modello di whatsapp_config: riga unica, segreti cifrati
-- AES-256-GCM con la chiave delle API AI). Finché la riga è vuota o
-- disabilitata, il canale usa le variabili d'ambiente (comportamento
-- attuale: nessuna installazione si rompe).

create table if not exists telegram_config (
  id                 int primary key default 1 check (id = 1),
  bot_token_enc      text,      -- token del bot, cifrato
  team_chat_ids      text,      -- CSV delle chat che ricevono notifiche/digest
  webhook_secret_enc text,      -- secret del webhook bidirezionale, cifrato
  enabled            boolean not null default false,
  updated_at         timestamptz not null default now()
);
