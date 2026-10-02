-- ── 006: PACCHETTI COMMERCIALI PROPOSTI DA AMBROSIO ─────────────
-- L'agenzia definisce i pacchetti vendibili; Ambrosio li conosce e
-- li propone in chat quando il cliente valuta un preventivo.

create table if not exists packages (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tagline       text,                          -- frase di vendita in chat
  price_text    text not null,                 -- es. "da 800 € una tantum"
  includes      text[],                        -- cosa comprende (elenco breve)
  sort_order    integer not null default 0,    -- ordine di proposta
  active        boolean not null default true, -- visible a Ambrosio e nelle card
  created_at    timestamptz not null default now()
);

-- Pacchetti di esempio (disattivabili da /admin/packages): editabili,
-- non rischiano di bloccare nulla se mai toccati.
-- WEB AGENCY SALENTO: fasce allineate alle landing (vetrina da 1.000 €,
-- e-commerce da 3.000 €, SEO da 350 €/mese — vedi migration 036 per i DB
-- che hanno già il seed storico con i prezzi di Crema).
insert into packages (name, tagline, price_text, includes, sort_order)
select * from (values
  ('Sito Vetrina', 'Il biglietto da visita online, pronto in 7 giorni.', 'da 1.000 € una tantum',
   array['fino a 5 pagine', 'design responsive', 'SEO base e Google Business Profile'], 10),
  ('Sito Professionale', 'Per studi e attività che vogliono farsi trovare.', 'da 1.500 € una tantum',
   array['fino a 10 pagine', 'testi curati e fotografie', 'SEO locale completa'], 20),
  ('E-commerce', 'Vendi online, gestisci tutto da un pannello semplice.', 'da 3.000 € una tantum',
   array['catalogo e carrello', 'pagamenti Stripe/PayPal', 'formazione alla gestione'], 30),
  ('SEO Locale', 'Primo su Google nella tua zona, mese dopo mese.', 'da 350 €/mese',
   array['posizionamento locale', 'contenuti ogni mese', 'report mensile trasparente'], 40)
) v
where not exists (select 1 from packages);
