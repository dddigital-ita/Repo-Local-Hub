-- ── 036: SLA NEL SEED — la policy SLA esiste dal primo avvio ──────────
-- Difetto visto su altro sito (Web Agency Salento): la policy SLA viveva
-- SOLO nel codice (SLA_POLICY_DEFAULT); su content_settings la riga non
-- c'era finché qualcuno non saliva su /admin/settings/sla e salvava. Il
-- team che guarda la pagina «SLA» la trova VUOTA e crede che non ci sia
-- nessuna policy attiva; l'audit dei tempi parte dai default invisibili.
--
-- Cura: seed idempotente della policy di default (stessa del codice) su
-- content_settings. La pagina SLA la mostra CONFIGURATA dal primo avvio,
-- editabile come sempre: salvare qui sovrascrive, il fallback del codice
-- resta la rete di sicurezza per i default mancanti (getSlaPolicy fa il
-- merge chiave per chiave).
--
-- I valori rispecchiano SLA_POLICY_DEFAULT in src/lib/tickets.ts:
--   urgente: prima risposta 1h, risoluzione 4h
--   alta:    2h / 8h
--   normale: 4h / 24h
--   bassa:   8h / 48h
insert into content_settings (key, value, updated_at)
values (
  'ticket_sla_policy',
  '{"urgente":{"nextReplyH":1,"resolveH":4},"alta":{"nextReplyH":2,"resolveH":8},"normale":{"nextReplyH":4,"resolveH":24},"bassa":{"nextReplyH":8,"resolveH":48}}'::jsonb,
  now()
)
on conflict (key) do nothing;  -- mai sovrascrivere una policy già personalizzata
