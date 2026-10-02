-- ── 021: PREDISPOSIZIONE WHATSAPP (Ambrosio Fase 4) ─────────────
-- Architettura a canali: la web chat diventa il primo adapter, WhatsApp
-- Business sarà plug-in futuro (webhook + pagina admin) senza toccare il
-- cervello di Ambrosio. Tutto additivo: nessun dato perso, nessun default
-- che cambia comportamento esistente.

-- 1. Canale della conversazione: 'web' per tutto l'esistente.
alter table conversations add column if not exists channel text not null default 'web';
-- I canali previsti ('web','whatsapp') sono validati a livello app dal
-- layer messaging (CHANNELS); niente check constraint per evitare future
-- migration su ogni nuovo canale.

create index if not exists conversations_channel_idx on conversations (channel);

-- 2. Opt-in WhatsApp sui lead: consenso al contatto (leads.consent) e
-- opt-in al CANALE sono DUE cose distinte e tracciate separatamente.
alter table leads add column if not exists whatsapp_opt_in boolean;
alter table leads add column if not exists whatsapp_opt_in_at timestamptz;
alter table leads add column if not exists wa_phone text; -- E.164 normalizzato condiviso web+WA (dedup per telefono)

-- Stesso numero al telefono = stesso cliente: dedup lead per E.164.
create index if not exists leads_wa_phone_idx on leads (wa_phone) where wa_phone is not null;

-- 3. Configurazione WhatsApp (token, phone_number_id, verify_token):
-- stessa cifratura AES-256-GCM delle chiavi AI, tabella dedicata pronta
-- per la pagina admin (disabilitata finché non c'è l'account Meta).
create table if not exists whatsapp_config (
  id               int primary key default 1 check (id = 1),
  phone_number_id  text,
  verify_token     text,
  waba_token_enc   text,          -- token accesso cifrato (AES-256-GCM)
  enabled          boolean not null default false,
  updated_at       timestamptz not null default now()
);
