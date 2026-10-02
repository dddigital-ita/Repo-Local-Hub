-- ── 005: SORGENTE LEAD (script vs Ambrosio) ─────────────────────
-- I lead raccolti da Ambrosio fuori turno si distinguono da quelli
-- dello script a bottoni: servirà per misurare il valore reale dell'AI.

alter table leads add column if not exists source text not null default 'script';
-- 'script' = qualificazione a bottoni · 'ai' = raccolto da Ambrosio
