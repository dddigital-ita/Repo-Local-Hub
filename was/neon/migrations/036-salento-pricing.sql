-- ═══════════════════════════════════════════════════════════════════
-- 036 SALENTO PRICING — listino allineato alle fasce del piano SEO
-- ═══════════════════════════════════════════════════════════════════
--
-- Le fasce commerciali di Web Agency Salento (PIANO-SEO-SALENTO.md e i
-- testi delle landing) sono: sito vetrina da 1.000 €, e-commerce da
-- 3.000 €, SEO da 350 €/mese. Il seed storico (migration 006, nato per
-- l'agenzia di Crema) propose 800/1.500/2.500 € e SEO 400 €/mese: le
-- card della home e le proposte di Ambrosio in chat leggevano cifre
-- incoerenti con le landing.
--
-- Update guardito: tocca SOLO le 4 righe seed per nome esatto; se
-- l'operatore ha rinominato o creato pacchetti propri, non vengono
-- toccati. Idempotente: rilanciarla è un no-op.

update packages set price_text = 'da 1.000 € una tantum'
where name = 'Sito Vetrina' and price_text = 'da 800 € una tantum';

update packages set price_text = 'da 3.000 € una tantum'
where name = 'E-commerce' and price_text = 'da 2.500 € una tantum';

update packages set price_text = 'da 350 €/mese'
where name = 'SEO Locale' and price_text = 'da 400 €/mese';

-- Il pacchetto «Sito Professionale» (da 1.500 €) resta: la fascia 1.000–3.000 €
-- delle landing lo copre e la Chat (chat-script) proposta già fasce coerenti.
