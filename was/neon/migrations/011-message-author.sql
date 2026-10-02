-- ── 011: AUTORE DELLE RISPOSTE OPERATORE ────────────────────────
-- Con due agenti in collaborazione serve vedere CHI ha scritto ogni
-- risposta nella chat del ticket (colonna opzionale: i vecchi messaggi
-- restano validi con author = null).
alter table messages add column if not exists author text;
