-- 038 — Migrazione dei valori legacy del questionario chat (30/09/2026)
--
-- Fino al fix 1d915ce lo script chat salvava value interni nei lead:
--   company       = 'sì' | 'no'  (azienda | professionista)
--   existing_site = 'no'         (→ «no, da zero»)
-- I lead storici vanno letti dagli operatori: i value diventano parole,
-- e il VALORE D'ORIGINE resta tracciato in audit_log (append-only: una
-- riga per lead toccato, con prima/dopo). Esatto-match voluto: il testo
-- libero già leggibile (es. existing_site = 'sì, datato') NON viene
-- toccato, così la migration è prevedibile e mai distruttiva.
--
-- Idempotente: alla seconda corsa le WHERE non trovano righe e non
-- scrive nulla (né update né audit).

-- ── company: 'sì' → 'azienda' ──────────────────────────────────────
insert into audit_log (actor, action, target, detail)
select 'migration:038', 'lead.company.legacy', l.id::text,
       'company: «' || l.company || '» → «azienda» (origin: chat pre-1d915ce)'
from leads l
where l.company = 'sì';

update leads set company = 'azienda' where company = 'sì';

-- ── company: 'no' → 'professionista' ───────────────────────────────
insert into audit_log (actor, action, target, detail)
select 'migration:038', 'lead.company.legacy', l.id::text,
       'company: «' || l.company || '» → «professionista» (origin: chat pre-1d915ce)'
from leads l
where l.company = 'no';

update leads set company = 'professionista' where company = 'no';

-- ── existing_site: 'no' → 'no, da zero' ────────────────────────────
insert into audit_log (actor, action, target, detail)
select 'migration:038', 'lead.existing_site.legacy', l.id::text,
       'existing_site: «' || l.existing_site || '» → «no, da zero» (origin: chat pre-1d915ce)'
from leads l
where l.existing_site = 'no';

update leads set existing_site = 'no, da zero' where existing_site = 'no';
