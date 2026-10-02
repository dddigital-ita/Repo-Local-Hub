-- ── 033: GOOGLE CALENDAR — APPUNTAMENTI SINCRONIZZATI ────────────
-- Il calendario Google dell'agenzia diventa la vetrina degli impegni:
-- ogni callback (da widget, dal team o da Ambrosio) genera un evento
-- nel calendario configurato. La config vive in content_settings sotto
-- la chiave gcal_config: credenziali service account CIFRATE (AES-256-GCM,
-- stessissima scuola di Drive e delle chiavi di Ambrosio), calendar_id,
-- toggle di attivazione e mirror sull'entità Notion correlata.
--
-- Zero dati sensibili: il JSON della chiave non tocca il DB in chiaro e
-- la UI non lo mostra mai. Nessun default pericoloso: senza config la
-- sync semplicemente non parte (maiché rompere le callback).
--
-- Aggiuntivo puro: nessuna colonna su tabelle esistenti, nessun dato perso.

create table if not exists gcal_sync_log (
  id            uuid primary key default gen_random_uuid(),
  callback_id   uuid,                        -- non FK: la callback può essere cancellata, il log resta
  action        text not null,               -- create | update | delete | skip | error
  event_id      text,                        -- id evento Google (se noto)
  detail        text,
  created_at    timestamptz not null default now()
);
create index if not exists gcal_sync_log_callback_idx on gcal_sync_log (callback_id, created_at desc);
