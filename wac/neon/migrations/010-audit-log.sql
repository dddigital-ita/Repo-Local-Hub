-- ── 010: LOG DI AUDIT AMMINISTRATIVO ─────────────────────────────
-- Chi ha fatto cosa su lead, ticket, pacchetti, operatori, callback,
-- impostazioni AI/Notion e Shield. Append-only: niente UPDATE/DELETE.
-- I vecchi eventi ticket restano anche in ticket_notes (visibilità nel
-- ticket); da qui in poi la fonte completa è audit_log.

create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,                -- email dell'agente
  action     text not null,                -- es. 'lead.status'
  target     text,                         -- id o etichetta dell'oggetto toccato
  detail     text,                         -- valore/dettaglio libero
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_actor_idx   on audit_log (actor, created_at desc);

-- Append-only: il DB rifiuta modifiche e cancellazioni dirette
create rule audit_log_no_update as on update to audit_log do instead nothing;
create rule audit_log_no_delete as on delete to audit_log do instead nothing;
