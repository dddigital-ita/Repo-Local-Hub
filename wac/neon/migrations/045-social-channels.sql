-- ═══════════════════════════════════════════════════════════════════
-- 045 SOCIAL CHANNELS — facebook e linkedin nel registry dei canali.
-- ═══════════════════════════════════════════════════════════════════
--
-- Contesto: la 040 ha creato channel_accounts con la lista della
-- Fase 4 (web/email/whatsapp/telegram/instagram/messenger). La
-- richiesta di portare Facebook e LinkedIn nel ticketing di ENTRAMBI
-- i gemelli estende la lista — ma la 040 è già applicata ovunque:
-- le migration già applicate NON si modificano a posteriori, si
-- aggiunge una nuova migration additiva.
--
-- Il vincolo si ricrea con la lista estesa (drop/add è l'unico modo
-- per cambiare un check in Postgres; la tabella è piccola e il vincolo
-- è solo a validazione, nessun indice coinvolto).
--
-- facebook: pagina Facebook — stesso ecosistema Meta di
--   messenger/instagram (X-Hub-Signature-256, payload
--   entries/messaging, external_id = entry[].id della pagina).
-- linkedin: Organization Social Action Notifications — firma
--   X-LI-Signature = hex(HMAC-SHA256("hmacsha256=" + corpo grezzo,
--   clientSecret)), validazione GET ?challengeCode=, external_id =
--   URN dell'organizzazione (urn:li:organization:<id>).
--
-- Il contratto di codice vive in src/lib/channel-registry.ts
-- (CHANNELS) — la sentinella tests/channel-registry.test.mjs
-- confronta l'UNIONE dei check delle migration con la lista.
-- Additiva e idempotente: rieseguirla non è un errore.

alter table channel_accounts drop constraint if exists channel_accounts_channel_check;
alter table channel_accounts add constraint channel_accounts_channel_check check (
  channel in ('web', 'email', 'whatsapp', 'telegram', 'instagram', 'messenger', 'facebook', 'linkedin')
);
