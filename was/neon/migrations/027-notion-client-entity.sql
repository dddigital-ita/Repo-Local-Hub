-- ── 027: NOTION — ENTITÀ CLIENT + IDEMPOTENZA DEL PORTAFOGLIO ──────
-- Il sync del portafoglio Clienti incoda le schede su Notion con
-- entity='client', ma il vincolo nato con la 022 conosceva solo
-- lead/ticket/callback: ogni enqueue finiva scartato
-- (notion_sync_queue_entity_check) e il log registrava il fallimento.
-- Il ramo di mapping per i client esisteva già nel motore (notion-queue):
-- qui il database si allinea all'intenzione.
--
-- Additivo e idempotente come le altre migration: si ricrea il vincolo
-- in una transazione (il CHECK non si allarga in place), la colonna di
-- marcatura segue il pattern notion_synced_at dei lead (007).
begin;

alter table notion_sync_queue drop constraint if exists notion_sync_queue_entity_check;

alter table notion_sync_queue add constraint notion_sync_queue_entity_check
  check (entity in ('lead', 'ticket', 'callback', 'client'));

commit;

-- Marcatura anti-doppioni: il drain della coda crea pagine nuove (non
-- fa update), quindi dopo la consegna il client va marcato come i lead
-- — altrimenti ogni giro di sync ri-accodava la scheda e il workspace
-- si riempiva di copie. null = ancora da consegnare.
alter table clients add column if not exists notion_synced_at timestamptz;
