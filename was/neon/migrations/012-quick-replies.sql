-- ── 012: RISPOSTE RAPIDE DEL TICKETING (editabili da /admin/settings) ──
-- Tre frasi pronte che gli agenti cliccano invece di riscrivere. Seed
-- idempotente: il valore reale resta quello salvato dagli agenti.
insert into content_settings (key, value)
values ('ticket_quick_replies', '["Perfetto, ti richiamo entro un''ora.","Le preparo un preventivo su misura: le servono dettagli sul progetto?","Grazie del tempo, le scritturo l''email con tutti i dettagli."]')

on conflict (key) do nothing;
