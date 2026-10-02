-- ── 031: RESET PASSWORD SELF-SERVICE (password dimenticata) ──
-- Il token NON si salva mai in chiaro: nel DB va solo il suo SHA-256.
-- Chi legge il DB (o un backup) non può usare i token: servono in memoria.
-- Uso SINGOLO: used_at non null rende il token morto dopo il primo click.
create table if not exists password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,                        -- copia dell'email target
  token_hash  text not null unique,                 -- sha256 hex del token
  expires_at  timestamptz not null,                 -- 1 ora dalla richiesta
  used_at     timestamptz,
  created_ip  text,                                 -- chi l'ha chiesto (audit)
  created_at  timestamptz not null default now()
);
create index if not exists password_reset_email_idx on password_reset_tokens (email, created_at);
