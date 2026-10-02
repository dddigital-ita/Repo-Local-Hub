-- ── 024: STORICO BACKUP (strumento Backup e Aggiornamenti Versione) ──
-- Ogni export JSON avviato da /admin/tools → sezione «Backup e Aggiornamenti
-- Versione» registra qui una riga: da chi, quando, quante entità. La tabella
-- è una STORIA: niente UPDATE né DELETE (rule append-only come audit_log);
-- l'eliminazione dal pannello nasconde la riga (deleted_at) senza perdere la
-- traccia. Un backup è comunque un export firmato: la fonte resta Neon.
create table if not exists backup_history (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  text not null,
  size_bytes  integer not null default 0,
  counts      jsonb not null default '{}'::jsonb,
  deleted_at  timestamptz
);

create index if not exists backup_history_created_idx
  on backup_history (created_at desc) where deleted_at is null;

-- L'eliminazione dall'elenco non deve riscrivere la storia: soft-delete only.
create rule backup_no_update as on update to backup_history do instead nothing;
create rule backup_no_delete as on delete to backup_history do instead nothing;

-- L'elenco può restare leggibile per sempre: ~1 riga per export, nessun
-- volume da gestire. Ogni riga è di ~200 byte: 1000 backup = 200 KB.
