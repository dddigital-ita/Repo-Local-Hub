-- ═══════════════════════════════════════════════════════════════════
-- 040 CHANNEL ACCOUNTS — l'infrastruttura per OGNI canale chat/social.
-- ═══════════════════════════════════════════════════════════════════
--
-- VARIANTE SALENTO (gemello di WebAgencyCrema): in questo repo la
-- 040 non esisteva ancora, quindi nasce GIÀ con la lista social
-- completa (facebook/linkedin inclusi). In Crema la stessa
-- infrastruttura arriva in due passi: 040 (lista Fase 4) + 045
-- (facebook/linkedin). Il risultato è lo stesso contratto — e la
-- sentinella gemello-pari tests/channel-registry.test.mjs lo
-- verifica confrontando l'UNIONE dei check SQL con la lista di
-- src/lib/channel-registry.ts (file gemello-pari, twin-sync).
--
-- Contesto: il ticketing parla già web/email/whatsapp/telegram (canale
-- telegram con la SUA tabella telegram_chats e il SUO webhook dedicato).
-- Ogni canale social nuovo finora voleva: tabella credenziali propria,
-- webhook dedicato, parse ad hoc. La generalizzazione (stessa scelta
-- architetturale della Fase 4 del desk di Crema):
--
--   channel_accounts = UNA tabella per le credenziali/identità di OGNI
--   account su OGNI canale (la pagina Instagram dell'agenzia, il bot
--   Telegram, il numero WhatsApp Business, la casella email, la pagina
--   Facebook, l'organizzazione LinkedIn…).
--
--   messages.provider_ref = l'id del messaggio LATO PROVIDER (update_id
--   Telegram, wamid WhatsApp, ig_mid Meta, notificationId LinkedIn):
--   l'idempotenza dei webhook si fa con una UNIQUE e una SELECT, non
--   con tabelle dedup per canale.
--
-- Scelte guardate:
--   - channel è TEXT con check sulla lista VIVA (web/email/whatsapp/
--     telegram) + aperta ai social: il contratto di codice vive in
--     src/lib/channel-registry.ts (CHANNELS) — la sentinella unit
--     tests/channel-registry.test.mjs confronta migration ↔ codice,
--     stessa ricetta di 038/client_type.
--   - credentials jsonb cifrato a livello applicativo (encryptKey di
--     ai.ts, AES-256-GCM): il DB NON vede il token in chiaro — stessa
--     scelta di telegram_chats.bot_token_enc. Qui il jsonb è il
--     contenitore, la cifratura resta nel layer lib.
--   - UNIQUE (channel, external_id): due account sullo stesso canale
--     (due numeri WhatsApp, due pagine) sono due righe.
--   - enabled: spegnere un canale senza cancellarlo (le conversazioni
--     restano, come per 025).
--   - provider_ref: TEXT NULL (i messaggi storici non lo hanno) con
--     index parziale + UNIQUE per (channel_account_id, provider_ref):
--     idempotenza del webhook a colpo di ON CONFLICT.
--   - Additiva e idempotente: rieseguirla non è un errore, nessun dato
--     esistente toccato. Il backfill dei telegram_chats esistenti è nel
--     layer lib (channel-registry.ts syncChannelAccountsFromLegacy) e
--     gira all'avvio del webhook, non qui: migration = struttura.
--
-- Canali social:
--   - facebook: pagina Facebook — stesso ecosistema Meta di
--     messenger/instagram (X-Hub-Signature-256, payload
--     entries/messaging, external_id = entry[].id della pagina).
--   - linkedin: Organization Social Action Notifications — firma
--     X-LI-Signature = hex(HMAC-SHA256("hmacsha256=" + corpo grezzo,
--     clientSecret)), validazione GET ?challengeCode=, external_id =
--     URN dell'organizzazione (urn:li:organization:<id>).
--
-- NOTA retrocompatibilità: telegram_chats resta (il canale telegram
-- continua a funzionare com'è); la sincronizzazione account lo
-- rispecchia in channel_accounts senza duplicare credenziali (il
-- token resta lì).

create table if not exists channel_accounts (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null,
  external_id  text not null,
  label        text,
  credentials  jsonb not null default '{}'::jsonb,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint channel_accounts_channel_check check (
    channel in ('web', 'email', 'whatsapp', 'telegram', 'instagram', 'messenger', 'facebook', 'linkedin')
  ),
  constraint channel_accounts_channel_external_unique unique (channel, external_id)
);

create index if not exists channel_accounts_channel_idx on channel_accounts (channel) where enabled;

-- L'idempotenza dei webhook: il messaggio del provider, una volta sola.
alter table messages add column if not exists channel_account_id uuid references channel_accounts(id) on delete set null;
alter table messages add column if not exists provider_ref text;

create unique index if not exists messages_provider_ref_unique
  on messages (channel_account_id, provider_ref)
  where channel_account_id is not null and provider_ref is not null;

create index if not exists messages_channel_account_idx
  on messages (channel_account_id) where channel_account_id is not null;
