-- ═══════════════════════════════════════════════════════════════════
-- 039 CLIENT META — il «no» dell'operatore è un dato, non un disturbo.
-- ═══════════════════════════════════════════════════════════════════
--
-- Contesto: le ditte citate nei lead dei clienti «azienda senza ditta»
-- diventano SUGGERIMENTI in scheda (banner con Salva/Rigetta). Ma senza
-- memoria del rigetto, la proposta riparte al sync successivo: un «no»
-- che non resta tale è un dispetto, non un flusso.
--
-- jsonb per chiave (non colonna): il prossimo metadato di scheda entra
-- senza un'altra migration. Colonne in own table, non su clients: il
-- backup/restore del portafoglio (025) copia clients, non questa
-- plumbing — e le guardie esistenti non si toccano.
--
-- Additiva e idempotente come tutte le migration del repo.

create table if not exists client_meta (
  client_id uuid primary key references clients(id) on delete cascade,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
