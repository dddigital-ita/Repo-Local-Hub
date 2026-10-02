-- ── 014: colonna ditta + nome ditta sui lead ──────────────────────
-- La chat ora chiede se il visitatore è professionale o azienda e, in
-- caso di azienda, kaptura il nome della ditta prima di passare a nome
-- e telefono. Queste colonna salvano company (sì/no) e company_name.
alter table leads add column if not exists company text;
alter table leads add column if not exists company_name text;
