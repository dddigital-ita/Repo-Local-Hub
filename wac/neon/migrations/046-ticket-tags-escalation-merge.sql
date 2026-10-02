-- ═══════════════════════════════════════════════════════════════════
-- 046 TICK TAGS + ESCALATION + MERGE — fase 1 dell'upgrade del
-- ticketing (brief 3 sezioni: inbound, gestione, chiusura).
-- ═══════════════════════════════════════════════════════════════════
--
-- Contesto: mancavano categorizzazione, escalation e merge — le
-- tre azioni di «lavorazione» che il desk chiede da Zendesk.
-- Routing a regole (round-robin/min-load/canale) e CSAT in-app
-- sono DOCUMENTATI nel piano della fase successiva
-- (docs/TICKETING-UPGRADE-2026-10-02.md), NON implementati qui.
--
-- ticket_tags: tabella di giunzione (un ticket ha N tag, un tag
--   sta su N ticket). Il vocabolario canonico vive in
--   content_settings (chiave ticket_tag_vocabulary, JSON array):
--   i tag LIBERI restano ammessi — il vocabolario suggerisce e
--   normalizza, non è un vincolo (un tag urgente non aspetta che
--   qualcuno lo registri nelle impostazioni).
-- escalation_level: 0 = nessuna escalation (livello 1, base);
--   1..3 = escalation salita. escalation_at: quando è salita
--   l'ultima volta (visibile nel dettaglio, utile in audit).
-- merged_into / merged_at: merge dei duplicati. Il ticket fuso
--   RESTA leggibile (storico completo: messaggi, note, audit) ma
--   esce dalle liste (ogni SELECT di lista filtra
--   merged_into is null) — non si cancella nulla, la fusione è
--   reversibile a mano con un update. Auto-riferimento escluso dal
--   check; la guardia applicativa è canMerge (tickets-shared.ts).
--
-- Additiva e idempotente: rieseguirla non è un errore.

create table if not exists ticket_tags (
  conversation_id uuid not null references conversations(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag)
);

-- Il filtro inbox per tag (?tag=) cerca PER TAG: l'indice rende
-- la ricerca un index lookup invece di una scansione.
create index if not exists ticket_tags_tag_idx on ticket_tags (tag);

alter table conversations add column if not exists escalation_level int not null default 0;
alter table conversations add column if not exists escalation_at timestamptz;
alter table conversations add column if not exists merged_into uuid references conversations(id);
alter table conversations add column if not exists merged_at timestamptz;

-- Vincolo di dominio: 0 (base) … 3 (escalation massima). Il
-- default 0 rende la colonna compatibile con i ticket esistenti.
alter table conversations drop constraint if exists conversations_escalation_level_check;
alter table conversations add constraint conversations_escalation_level_check
  check (escalation_level between 0 and 3);

-- Nessun ticket può fondere in sé stesso (guardia di dominio;
-- la guardia applicativa canMerge la replica in pure).
alter table conversations drop constraint if exists conversations_merged_self_check;
alter table conversations add constraint conversations_merged_self_check
  check (merged_into is null or merged_into <> id);

-- Indice parziale: serve a «tutti i ticket fusi in X» (solo le
-- righe fuse hanno merged_into non nullo).
create index if not exists conversations_merged_into_idx
  on conversations (merged_into) where merged_into is not null;
