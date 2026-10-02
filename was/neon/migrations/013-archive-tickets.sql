-- ── 013: ARCHIVIAZIONE TICKET VUOTI/SPAM ────────────────────────
-- I ticket aperti senza messaggi o con query da 0–1 caratteri riempiono la
-- inbox di rumore. Soft-archive: hidden_by default dalla inbox, ripristinabili
-- con un click; mai cancellati (l'audit resta intatto).
alter table conversations add column if not exists archived_at timestamptz;
alter table conversations add column if not exists archived_by text;

create index if not exists conversations_archived_idx on conversations (archived_at);
