-- ── 026: SCHEMA_MIGRATIONS (tracciamento delle migration) ─────
-- Il runner `npm run db:migrate` registra qui ogni migration applicata:
-- il report smette di DEDURRE lo stato dai messaggi di errore di Postgres
-- («already exists») e diventa ESATTO. La tabella nasce PRIMA delle
-- migration che traccia: al primo giro il runner esegue comunque tutti i
-- file (idempotenti) e fa il backfill delle righe, dai giri successivi
-- salta i file già tracciati.
-- Migration additiva: senza la tabella il runner usa la strategia
-- precedente (deduzione dall'errore) e il sito funziona identico a prima.

create table if not exists schema_migrations (
  filename    text primary key,              -- es. '025-clients.sql'
  checksum    text not null,                 -- sha256 del file: rileva modifiche retroattive
  applied_at  timestamptz not null default now(),
  runner      text not null default 'db-migrate-all'  -- chi l'ha registrata
);

comment on table schema_migrations is
  'Tracciamento migration: una riga per file .sql applicato da npm run db:migrate. Il checksum rileva file modificati dopo l''applicazione.';
