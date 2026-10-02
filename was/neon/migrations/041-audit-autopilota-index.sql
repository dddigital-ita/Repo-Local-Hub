-- ═══════════════════════════════════════════════════════════════════
-- 041 AUDIT AUTOPILOTA — l'indice che distingue il takeover MANUALE
-- dal take-over SLA del cron.
-- ═══════════════════════════════════════════════════════════════════
--
-- Contesto: il toggle manuale dell'auto-pilota (pannello Ambrosio) lascia
-- audit ambrosio.desk.autopilota_on/off con target = id conversazione; il
-- cron SLA invece scrive SOLO la colonna conversations.ai_takeover_at.
-- La regola di attribuzione è «l'ultimo evento autopilota_* del ticket»:
-- la inbox e il KPI la valutano PER OGNI RIGA della coda, quindi la
-- subquery su audit_log serve con un indice che parte da (target, action):
-- senza, ogni caricamento della inbox scansionerebbe tutto il log.
--
-- Additiva e idempotente: nessuna colonna nuova, nessun backfill — gli
-- eventi esistono già da quando il toggle è vivo (audit_log è append-only
-- dalla 010, quindi la storia non si riscrive).

create index if not exists audit_log_target_action_idx
  on audit_log (target, action, created_at desc);
