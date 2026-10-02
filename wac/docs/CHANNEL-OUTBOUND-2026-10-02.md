# Channel outbound — rationale (2026-10-02)

> Guard di sito `channel-outbound` — perimetro **Crema**.
> Fase 5, step 5.1 di `docs/PIANO-FASE-5-DESK.md`.
> Il gemello (Web Agency Salento) non ha l'outbound social:
> nessuna variante locale, nessuna copia cieca. I moduli puri
> entrano nel gemello solo allo step 5.4 (twin-sync).

## Il problema

Il desk era **inbound-only** sui social: il webhook (Meta) e il
polling (Telegram) portano i messaggi del cliente dentro il
ticket, ma l'operatore non poteva mai **partire** dal ticket
verso WhatsApp/Instagram/Messenger/Facebook. Aprire un ticket
era possibile solo via email (SMTP) — per un cliente che ha
scritto su WhatsApp, la prima risposta via email era fuori
posto.

## La scelta

Un solo gateway di uscita, a due livelli:

1. **`src/lib/channel-outbound-pure.ts`** — zero import.
   Payload Graph per canale (`buildGraphPayload`: WhatsApp
   `messaging_product` + `to` in cifre + `text.body`; Meta
   `recipient.id` + `message.text`), parse della risposta
   (`parseGraphResponse`: wamid WhatsApp in `messages[0].id`,
   `message_id` Meta), dettaglio errore (`graphErrorDetail`:
   `error_user_msg` è il testo pensato per l'operatore) e il
   dispatch Graph con **fetch iniettabile** (`dispatchGraphOutbound`,
   `AbortSignal.timeout(15_000)`). La convenzione del repo per
   i layer puri: le sentinelle unit importano questo modulo
   (Node ESM non risolve import relativi extensionless, quindi
   un modulo con `import './db'` non è testabile).
2. **`src/lib/channel-outbound.ts`** — thin layer con le
   dipendenze: `resolveOutboundAccount` (primo account abilitato
   di `channel_accounts`, token decifrato AES-256-GCM qui, mai
   in rotta), `dispatchOutbound` (Graph via il passo puro;
   Telegram via Bot API `telegram.ts` — il bot vive su
   `telegram_chats`, per scelta non in `channel_accounts`),
   mirror nel thread (`messages`, **idempotente** sulla UNIQUE
   parziale `(channel_account_id, provider_ref)` della migration
   040: uno stesso provider_ref non entra due volte, neanche a
   invio ritentato) e la facciata `sendOutbound` (adatta il
   testo al canale: WhatsApp `formatForChannel`, Meta slice a
   `META_TEXT_MAX`).

Il form «Nuovo ticket» (`/admin/tickets/new`) sceglie il canale:
**email / WhatsApp / Telegram** selezionabili; Instagram,
Messenger, Facebook e LinkedIn nel selettore **disabilitati**
(«— in arrivo», Fase 5) — il Graph payload per quei canali è
già pronto, manca il pannello account (step 5.2) e il composer
nel ticket (step 5.3). Il contatto si valida **per canale**
(email regex, `toE164` WhatsApp, chat id/@username Telegram).

### WhatsApp business-initiated: policy esplicita

Fuori dalla finestra di 24 ore, Meta accetta solo template
approvati. **Non blocchiamo l'invio** — la policy è del
chiamante: il form avvisa l'operatore (box amber), e se Meta
rifiuta (#131047 ecc.) l'errore dell'API torna sul ticket
(`?error=…`, banner `role=alert` in `[id]/page.tsx`) con la
bozza già salvata nel thread: l'operatore riprova dal composer
o passa a un template. Meglio un errore visibile che un
finto-successo o un invio silenziosamente troncato.

### Errore = bozza conservata

Se l'invio social fallisce, `createTicketAction` crea comunque
il ticket e inserisce il messaggio nel thread (senza
provider_ref), poi redirige con `?error=<errore API>`. Il caso
non si perde: il primo messaggio resta visibile nel filo, la
riprova passa dal composer del ticket (step 5.3).

## Test (guard `tests/channel-outbound.test.mjs`, 17 test)

- Costanti e `isOutboundChannel` (la lista dei canali è una
  regola, non una coincidenza).
- Payload per canale, incluse le rotte di rifiuto (`to`
  WhatsApp non normalizzabile → `null`, niente richiesta).
- Parse risposta e dettaglio errore dalle due forme Graph.
- Dispatch WhatsApp con **fetch mock**: URL pinned
  `{GRAPH_API}/{externalId}/messages`, Bearer del token
  dell'account, payload corretto; errore Graph → `graph_400:
  <error_user_msg>`; rete giù → errore leggibile, mai una
  throw; Telegram via Graph → `telegram_non_e_graph`.
- Source-scan: il thin layer re-esporta i puri, il mirror usa
  la UNIQUE parziale di 040, il form ha i canali disabilitati
  «in arrivo» e l'avviso business-initiated, il bug fix
  `bodyFromForm || htmlToEmailText(bodyHtmlRaw)` (dal commit
  eab3699 il form invia solo `bodyHtml`).

Le query su DB vivo (`resolveOutboundAccount`, Bot API Telegram,
mirror in `messages`) sono coperte dall'E2E, non dalle unit: la
convenzione dei panni puri.

## Futuro (documentato, non implementato)

- **Step 5.2** — pannello admin per `channel_accounts`
  (crea/rota token, `enabled`).
- **Step 5.3** — composer social nel ticket (solo canali con
  account abilitato; disabilitato se account spento).
- **Step 5.4** — twin-sync dei moduli puri verso il gemello
  (`future-candidates` → `files`).
- Outbound Facebook/Instagram/Messenger/LinkedIn: il payload è
  pronto, si sblocca con 5.2 (account + token).
