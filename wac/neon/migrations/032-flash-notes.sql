-- ── 032: NOTE UNA TANTUM LATO SERVER (es. password temporanea del reset) ──
-- La password temporanea NON viaggia più nell'URL (?temp=… finiva nella
-- cronologia del browser e nei referer): la server action la stipa qui,
-- cifrata AES-256-GCM, e la pagina la RIVENDICA una sola volta.
--  - il valore è cifrato con ADMIN_SESSION_SECRET: chi legge il DB (o un
--    backup) non ottiene nulla;
--  - claim con DELETE atomico: una seconda lettura non trova nulla;
--  - TTL 10 minuti: lo sweep in lib/note.ts cancella le scadute (indice
--    semplice su expires_at: un predicato con now() non è IMMUTABLE, quindi
--    un index parziale qui non è ammesso da Postgres).
create table if not exists flash_notes (
  id          uuid primary key default gen_random_uuid(),
  note_enc    text not null,                        -- AES-256-GCM (chiave da ADMIN_SESSION_SECRET)
  created_by  text not null,                        -- email dell'attore (informazione, non autorizzazione)
  audience    jsonb not null,                       -- chi può rivendicare la nota (array JSON; claim con ?|)
  expires_at  timestamptz not null,                 -- 10 minuti dalla scrittura
  created_at  timestamptz not null default now()
);
create index if not exists flash_notes_expiry_idx on flash_notes (expires_at);
