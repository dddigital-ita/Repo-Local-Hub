-- ═══════════════════════════════════════════════════════════════════
-- 035 SERVICE KIND — Ambrosio vende anche SERVIZI, oltre ai pacchetti.
-- ═════════════════════════════════════════════════════════════════════
--
-- Contesto: la colonna `kind` distingue i due cataloghi sullo stesso
-- archivio `packages` (zero tabelle nuove, zero breaking change):
--   kind = 'package' → pacchetti sito (listino preventivi: Sito Vetrina…)
--   kind = 'service' → servizi professionali (fotografo, video, assistenza…)
-- Tutto l'ecosistema (Notion "Servizio", titoli gcal, notify, proposte L3)
-- eredita gratis: legge gli stessi campi name/price_text/includes.
--
-- Additiva e idempotente: come tutte le migration del repo, rieseguirla
-- non è un errore (guardo in danno: nessun dato cliente viene toccato).
-- I 4 seed sono GUARDITI: entrano SOLO se la tabella è ancora senza kind
-- (mai su archivi già in uso, dove l'operatore ha i suoi dati).

-- 1) Colonna: default 'package' così le righe esistenti restano pacchetti.
alter table packages add column if not exists kind text not null default 'package';

-- 2) Contratto di dominio: il tipo non può che essere uno dei due.
--    (La vecchia constraint di colonna non esiste: la ricreo solo se assente,
--    via DO block perché Postgres non ha ADD CONSTRAINT IF NOT EXISTS.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'packages_kind_check'
  ) then
    alter table packages add constraint packages_kind_check
      check (kind in ('package', 'service'));
  end if;
end $$;

-- 3) Indice per le letture per catalogo (home e prompt filtrano per kind).
create index if not exists packages_kind_idx on packages (kind, sort_order);

-- 4) Seed guardito dei 4 servizi richiesti dall'agenzia: solo se l'archivio
--    non ha ancora nessuna riga con kind='service' (idempotente e sicuro:
--    mai duplicati, mai sovrascritti i dati dell'operatore).
insert into packages (name, tagline, price_text, includes, sort_order, active, kind)
select * from (values
  ('Servizio Fotografico', 'Shooting professionale per sito e social: le foto giuste vendono più di mille parole.', 'da 350 €', array['mezza giornata in sede', '30 foto ritoccate', 'uso commerciale incluso'], 10, true, 'service'),
  ('Servizio Video', 'Video corporate e reel verticali: raccontare l''azienda in 60 secondi.', 'da 500 €', array['video fino a 60 secondi', 'sottotitoli e format social', '2 revisioni incluse'], 20, true, 'service'),
  ('Assistenza Tecnica', 'Cura mensile del sito: aggiornamenti, backup verificati e controlli di sicurezza.', 'da 49 €/mese', array['aggiornamenti core e plugin', 'backup mensile verificato', 'report di stato via email'], 30, true, 'service'),
  ('Assistenza Tecnica SOS Web', 'Il sito è giù o è stato hackerato? Intervento prioritario entro 4 ore lavorative.', 'da 120 € a intervento', array['diagnosi rapida', 'ripristino da backup o riparazione', 'consulenza post-intervento'], 40, true, 'service')
) as s(name, tagline, price_text, includes, sort_order, active, kind)
where not exists (select 1 from packages where kind = 'service');
