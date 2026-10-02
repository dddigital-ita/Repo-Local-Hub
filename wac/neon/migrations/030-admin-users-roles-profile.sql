-- ── 030: UTENTI DELL'APP: RUOLI (super_admin | admin) + AREA PERSONALE ──
-- Estende admin_users senza rompere niente: le colonne nuove sono NULLABLE
-- con DEFAULT NEUTRO, quindi il login esistente e tutte le pagine /admin
-- continuano a funzionare identico prima e dopo il deploy del codice.
--
-- Ruoli:
--   super_admin — gestisce il sito e gli altri utenti: crea/disattiva/cancella
--                 account, assegna ruoli, resetta le password, vede l'area
--                 «Utenti» di /admin. Il PRIMO account esistente (il più
--                 antico per created_at) viene promosso automaticamente:
--                 nessuna password in chiaro, nessun seed nel repo.
--   admin       — accede a /admin come oggi e gestisce la propria Area
--                 personale (/admin/profilo) con i campi personali.
--
-- Area personale: i campi anagrafici vivono sull'account (niente seconda
-- tabella da sincronizzare). NOT NULL DEFAULT '' così ogni utente esistente
-- ha già una riga coerente e l'UPDATE è un semplice set dei campi editati.
alter table admin_users add column if not exists role           text not null default 'admin'
  check (role in ('super_admin', 'admin'));
alter table admin_users add column if not exists active         boolean not null default true;
alter table admin_users add column if not exists first_name     text not null default '';
alter table admin_users add column if not exists last_name      text not null default '';
alter table admin_users add column if not exists vat_number     text not null default '';  -- partita IVA
alter table admin_users add column if not exists fiscal_code    text not null default '';  -- codice fiscale
alter table admin_users add column if not exists phone          text not null default '';
alter table admin_users add column if not exists address        text not null default '';  -- via e numero
alter table admin_users add column if not exists city           text not null default '';
alter table admin_users add column if not exists province       text not null default '';  -- sigla (es. CR)
alter table admin_users add column if not exists postal_code    text not null default '';
alter table admin_users add column if not exists bio            text not null default '';  -- nota libera

-- Promozione del primo account: super admin. Deterministica (created_at,
-- poi email per stabilità), idempotente (la prima promozione vince).
update admin_users
set role = 'super_admin'
where email = (
  select email from admin_users order by created_at asc, email asc limit 1
)
and not exists (select 1 from admin_users where role = 'super_admin');
