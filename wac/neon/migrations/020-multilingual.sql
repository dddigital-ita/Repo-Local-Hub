-- ── 020: MULTILINGUA (Ambrosio Fase 3) ──────────────────────────
-- La lingua del cliente si rileva dalla prima risposta e resta per
-- tutta la conversazione (default 'it': zero impatto sul flusso in
-- italiano). Le FAQ ufficiali possono avere traduzioni opzionali in
-- jsonb: l'italiano resta la fonte di verità, le traduzioni sono
-- usate nel prompt solo se presenti e approvate dal team.
-- Le chiavi ammesse sono solo en/de/fr/es: la validazione è a livello
-- app (saveAiFaq sanitizza l'oggetto prima di salvarlo).

alter table conversations add column if not exists language text not null default 'it';
alter table ai_faqs add column if not exists translations jsonb;

-- Indice parziale: le conversazioni non-italiane sono poche, il cron
-- (follow-up) e le statistiche le cercano per lingua.
create index if not exists conversations_language_idx
  on conversations (language)
  where language <> 'it';
