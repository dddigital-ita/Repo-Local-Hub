-- ── 017: FASE 1 TICKETING — SLA A TRE OROLOGI + NOTIFICHE ───────
-- (1.3) Oltre al clock «prima risposta» (first_response_at) il ticket
-- guadagna due scadenze: prossima risposta attesa (se l'ultimo messaggio
-- è dell'agente) e risoluzione. Null = orologio fermo/irrilevante.
-- (1.4) awaiting_notified_at evita notifiche duplicate: una sola
-- «il cliente attende una risposta» per fase di attesa.
alter table conversations
  add column if not exists sla_next_reply_due timestamptz,
  add column if not exists sla_resolve_due timestamptz,
  add column if not exists awaiting_notified_at timestamptz;

create index if not exists conversations_sla_due_idx
  on conversations (sla_next_reply_due)
  where sla_next_reply_due is not null;
