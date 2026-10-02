-- ═══════════════════════════════════════════════════════════════════
-- 038 CLIENT TYPE — il tipo di cliente come dato, non come congettura.
-- ═══════════════════════════════════════════════════════════════════
--
-- Contesto: il portafoglio clienti (025) nasce dai ticket via sync
-- Ambrosio, ma il TIPO del cliente (azienda / privato / ente pubblico)
-- finora viveva solo nella testa di chi chiamava. Serve filtrabile in
-- lista e scrivibile in scheda: una colonna, zero tabelle nuove.
--
-- Scelte guardite:
--   - NULL = «non classificato»: la sync NON congettura il tipo dai
--     ticket (company_name non basta: un libero professionista ha una
--     ditta). Il tipo lo scrive un essere umano in /admin/clients/[id],
--     il sync esistente non lo tocca (l'update «completa ma non
--     distrugge» non menziona client_type: resta com'è).
--   - I valori sono lo STESSO contratto di src/lib/clients-shared.ts
--     (CLIENT_TYPES): la sentinella in tests/client-type.test.mjs
--     confronta migration ↔ codice — cambiarne uno senza l'altro
--     rompe la suite prima che rompa la UI.
--   - Additiva e idempotente come tutte le migration del repo:
--     rieseguirla non è un errore, nessun dato cliente toccato.

alter table clients add column if not exists client_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_client_type_check'
  ) then
    alter table clients add constraint clients_client_type_check
      check (client_type in ('azienda', 'privato', 'ente_pubblico'));
  end if;
end
$$;
