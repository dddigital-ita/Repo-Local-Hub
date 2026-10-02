-- ── 018: CRON — DEDUP NOTIFICHE SLA ─────────────────────────────
-- Il cron gira a intervalli regolari: senza flag persistente un ticket
-- scaduto rinotificherebbe a ogni tick. Un flag per soglia, si riarmano
-- quando il clock dell'agente si riarma (nuovo messaggio del cliente).
alter table conversations
  add column if not exists sla_warned_at timestamptz,
  add column if not exists sla_breached_at timestamptz;
