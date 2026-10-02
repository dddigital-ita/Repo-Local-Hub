-- Demo realistica Web Agency Salento: 6 ticket salentini con lead, messaggi,
-- callback e stati variati per valutare pipeline, SLA e report nell'admin.
-- Uso: psql -d webagencysalento -f scripts/demo-salento.sql
begin;

-- 1) Lead tiepido da Otranto (B&B), arrivato ieri, da contattare
insert into conversations (initial_query, source_page, status, priority, created_at)
values ('sito per B&B con prenotazioni', '/siti-web-otranto', 'lead_captured', 'normale', now() - interval '1 day')
returning id, number \gset t12_ -- lead_id si collega DOPO l'insert del lead (FK verso leads)
insert into messages (conversation_id, sender, body, created_at) values
  (:'t12_id', 'visitor', 'Gestisco un B&B a Otranto, vorrei un sito con calendario prenotazioni', now() - interval '1 day'),
  (:'t12_id', 'bot', 'Perfetto: quante camere gestisce la struttura?', now() - interval '1 day' + interval '1 minute'),
  (:'t12_id', 'visitor', '4 camere, aperto tutto l''anno', now() - interval '1 day' + interval '2 minutes'),
  (:'t12_id', 'bot', 'Ottimo, entro quando ti servirebbe online?', now() - interval '1 day' + interval '3 minutes'),
  (:'t12_id', 'visitor', 'prima della prossima stagione', now() - interval '1 day' + interval '4 minutes');
insert into leads (conversation_id, name, phone, service, urgency, existing_site, budget, consent, hot, status, temperature, initial_query, source_page, created_at)
values (:'t12_id', 'Anna De Luca', '+393409987654', 'sito web nuovo', 'entro 3 mesi', 'no', '1.000–3.000 €', true, false, 'nuovo', 'tiepido', 'sito per B&B con prenotazioni', '/siti-web-otranto', now() - interval '1 day')
returning id \gset l12_;
update conversations set lead_id = :'l12_id' where id = :'t12_id';

-- 2) Lead caldo Brindisi B2B, preso in carico da Daniele, prima risposta data
insert into conversations (initial_query, source_page, status, priority, assigned_to, first_response_at, created_at)
values ('portale richieste d''offerta B2B', '/siti-web-brindisi', 'lead_captured', 'alta', 'A', now() - interval '4 hours', now() - interval '5 hours')
returning id, number \gset t13_
insert into messages (conversation_id, sender, body, created_at) values
  (:'t13_id', 'visitor', 'Azienda di logistica a Brindisi, serve un portale con area riservata e richieste offerta', now() - interval '5 hours'),
  (:'t13_id', 'bot', 'Quanto è urgente il progetto?', now() - interval '5 hours' + interval '1 minute'),
  (:'t13_id', 'visitor', 'molto, entro fine mese', now() - interval '5 hours' + interval '2 minutes'),
  (:'t13_id', 'bot', 'Budget indicativo?', now() - interval '5 hours' + interval '3 minutes'),
  (:'t13_id', 'visitor', 'oltre 8.000 euro, lo so già', now() - interval '5 hours' + interval '4 minutes'),
  (:'t13_id', 'ai', 'Grazie! Daniele ha preso in carico la richiesta e ti richiama entro oggi.', now() - interval '4 hours');
insert into leads (conversation_id, name, phone, service, urgency, existing_site, budget, consent, hot, status, temperature, initial_query, source_page, company, company_name, created_at)
values (:'t13_id', 'Pietro Ferraro', '+393481122334', 'portale B2B', 'immediata', 'sì, datato', 'oltre 8.000 €', true, true, 'contattato', 'caldo', 'portale richieste d''offerta B2B', '/siti-web-brindisi', 'sì', 'Logistica Adriatica S.r.l.', now() - interval '5 hours')
returning id \gset l13_;
update conversations set lead_id = :'l13_id' where id = :'t13_id';

-- 3) Conversazione bot in corso (visitatore a metà qualifica), ristorante Gallipoli
insert into conversations (initial_query, source_page, status, priority, created_at)
values ('menu online e prenotazioni ristorante', '/siti-web-ristoranti-salento', 'bot', 'normale', now() - interval '20 minutes')
returning id, number \gset t14_
insert into messages (conversation_id, sender, body, created_at) values
  (:'t14_id', 'visitor', 'Ho un ristorante a Gallipoli, vorrei menu online e prenotazioni WhatsApp', now() - interval '20 minutes'),
  (:'t14_id', 'bot', 'Perfetto: sito nuovo o rifacimento?', now() - interval '19 minutes');

-- 4) Lead coperto da callback fissata per oggi pomeriggio, agriturismo a Nardò
insert into conversations (initial_query, source_page, status, priority, created_at)
values ('sito agriturismo con vendita olio', '/siti-web-nardo', 'callback_scheduled', 'normale', now() - interval '2 days')
returning id, number \gset t15_
insert into messages (conversation_id, sender, body, created_at) values
  (:'t15_id', 'visitor', 'Agriturismo a Nardò, sito con vendita diretta di olio e vino', now() - interval '2 days'),
  (:'t15_id', 'bot', 'Chiama il numero del sito oppure fissiamo un richiamo: quando preferisci?', now() - interval '2 days' + interval '1 minute'),
  (:'t15_id', 'visitor', 'richiamatemi oggi pomeriggio dopo le 15', now() - interval '2 days' + interval '2 minutes');
insert into leads (conversation_id, name, phone, service, urgency, budget, consent, hot, status, temperature, initial_query, source_page, created_at)
values (:'t15_id', 'Serena Greco', '+393664445566', 'sito web nuovo', 'entro 1 mese', '3.000–5.000 €', true, false, 'nuovo', 'tiepido', 'sito agriturismo con vendita olio', '/siti-web-nardo', now() - interval '2 days')
returning id \gset l15_
insert into callbacks (conversation_id, lead_id, scheduled_at, slot_label, status, notes)
values (:'t15_id', :'l15_id', date_trunc('day', now()) + interval '16 hours', 'Oggi ~16:00', 'pending', 'Vendita diretta olio/vino, interessata anche a Google Business.')
returning id \gset cb15_
update leads set callback_id = :'cb15_id' where id = :'l15_id';

-- 5) Lead più vecchio con preventivo inviato (per la pipeline storica), Copertino
insert into conversations (initial_query, source_page, status, priority, assigned_to, first_response_at, created_at, closed_at)
values ('sito per falegnameria con portfolio', '/siti-web-copertino', 'lead_captured', 'normale', 'A', now() - interval '8 days', now() - interval '9 days', now() - interval '6 days')
returning id, number \gset t16_
insert into messages (conversation_id, sender, body, created_at) values
  (:'t16_id', 'visitor', 'Sono un falegname a Copertino, vorrei mostrare i miei lavori', now() - interval '9 days'),
  (:'t16_id', 'bot', 'Sito vetrina con portfolio delle opere: budget?', now() - interval '9 days' + interval '1 minute'),
  (:'t16_id', 'visitor', 'circa 1.500 euro', now() - interval '9 days' + interval '2 minutes'),
  (:'t16_id', 'ai', 'Richiesta presa in carico da Daniele: preventivo consegnato.', now() - interval '8 days');
insert into leads (conversation_id, name, phone, service, urgency, budget, consent, hot, status, temperature, initial_query, source_page, company, company_name, created_at)
values (:'t16_id', 'Giuseppe Rizzo', '+393201231234', 'sito web nuovo', 'entro 1 mese', '1.000–3.000 €', true, false, 'preventivo_inviato', 'caldo', 'sito per falegnameria con portfolio', '/siti-web-copertino', 'sì', 'Falegnameria Rizzo', now() - interval '9 days')
returning id \gset l16_;
update conversations set lead_id = :'l16_id' where id = :'t16_id';

-- 6) Conversazione vaga (non qualificata) per provare i filtri dell'inbox
insert into conversations (initial_query, source_page, status, priority, created_at)
values ('quanto costa tanto in generale', '/web-agency-salento', 'bot', 'normale', now() - interval '3 hours')
returning id, number \gset t17_
insert into messages (conversation_id, sender, body, created_at) values
  (:'t17_id', 'visitor', 'quanto costa tanto in generale', now() - interval '3 hours'),
  (:'t17_id', 'bot', 'Dipende dal servizio: sito, e-commerce o SEO?', now() - interval '3 hours' + interval '1 minute');

commit;
