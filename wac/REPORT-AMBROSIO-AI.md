# REPORT AMBROSIO AI — Stato attuale, gap e roadmap (FASE 0)

> Audit del 24/09/2026 come richiesto da `PROMPT-AMBROSIO-AI.md`. Nessuna modifica al codice in questa fase. Riferimenti analizzati: `src/lib/ai.ts` (878 righe), `src/app/api/chat/ai/route.ts`, `src/app/api/chat/init|message`, `src/lib/lead-extract.ts`, `src/lib/chat-script.ts`, `src/lib/tickets.ts`, migration 004/005/011/015/016, `/admin/ai`.

## 1. Stato attuale di Ambrosio (cosa c'è e funziona)

**Architettura di chiamata**
- Catena multi-provider con fallback a 6 provider (Anthropic, OpenAI, Gemini, OpenRouter, Freebuff, custom OpenAI-compatible). Chiavi cifrate AES-256-GCM su DB (`ai_provider_keys`), primario selezionabile, fallback in ordine fisso. Ogni risposta registra `usedProvider` e `fallbacksTried`.
- Tre adattatori di chiamata: OpenAI-compatible, Anthropic Messages, Gemini generateContent. Timeout 20s, max_tokens 300.
- **Mai bloccante**: fallback a catena, tracking FAQ in try/catch, persistenza risposta in try/catch — la chat non si ferma mai per colpa di Ambrosio.

**Conoscenza nel prompt** (assemblata a ogni chiamata in `ambrosioReply`)
- Prompt di sistema personalizzabile (default con regole commerciali: fasce 800€/2.500€/400€-mese, turni Daniele 9-13 e Michele 15-19, regola del consenso esplicito).
- FAQ addestrative (`ai_faqs` con priorità): la risposta ufficiale vince sull'improvvisazione; tracking d'uso con matching Jaccard (soglia 0.38 calibrata) e statistiche di conversione a lead/callback.
- Pacchetti attivi dal DB (`packages`): i prezzi arrivano dal listino reale, mai inventati.

**Gate e flusso**
- `/api/chat/ai` risponde solo se: rate limit ok, Shield ok, `settings.enabled`, nessun umano in turno (verificato lato client in `Chat.tsx` con `aiAvailable`).
- Storico conversazione (8 turni) + contesto qualificazione già raccolto entrano nel prompt.
- Estrazione lead da testo libero (`lead-extract.ts`): telefono (regex it), nome («mi chiamo/sono»), consenso (sì esplicito). Salvataggio con `source='ai'` + notifica team.
- Persistenza risposta come messaggio `bot`: il visitatore la rilegge al refresh, l'agente la vede nel ticket.

**Governance**
- Audit di ogni azione admin; statistiche 30 giorni (conversazioni, risposte, notte/weekend, top domande, lead); suggerimenti FAQ dalle domande vere con bozza via AI.

## 2. Gap vs operatore AI commerciale (Intercom Fin, Zendesk AI)

| Capacità | Fin/Zendesk AI | Ambrosio oggi | Gap |
|---|---|---|---|
| Rispondere con conoscenza gestita | Sì | Sì (FAQ + pacchetti + regole) | — |
| **Eseguire azioni reali** (tool use) | Sì (refund, lookup, update) | **No**: nessun `tools` nei payload provider; nessuna funzione eseguibile. Estrazione lead è parsing regex post-risposta, non azione dell'AI | **P0** |
| Handoff intelligente all'umano | Routing per intent/skill | Nessuno: l'agente umano scopre il contesto leggendo il thread | P0 |
| Multilingua | Nativo | **Bloccato dal prompt**: «Rispondi SOLO in italiano» | **P0** |
| Memoria conversazione lunga | Trascritti completi | 8 turni + contesto qualificazione | P2 sufficiente |
| Proattività (follow-up) | Workflow attivi | **Assente**: nessun follow-up se il visitatore sparisce | P1 |
| Tasso di risoluzione misurato | Dashboard dedicata | Statistiche buone su FAQ/conversioni; mancano per funzioni/lingua/canale | P1 (cresce con le funzioni) |
| Guardrail | Policy engine | Regole nel prompt + validazioni esterne; nessun circuito esplicito tool→validazione→audit | P0 (con le funzioni) |

Giudizio sintetico: Ambrosio è già **un ottimo risponditore** con governance rara anche in prodotti commerciali (fallback multi-provider, FAQ tracciate con conversioni, audit). Il salto di livello è farlo **agire** (Fase 1) e **parlare le lingue** (Fase 3), con la proattività che tiene la conversazione viva (Fase 2).

## 3. Assessment multilingua (cosa si rompe oggi con un cliente inglese)

1. **Il prompt vieta esplicitamente l'italiano-only**: «Rispondi SOLO in italiano». Un cliente che scrive «How much for an e-commerce?» riceverebbe comunque una risposta italiana (o un ennesimo modulo a bottoni in italiano).
2. **La qualificazione a bottoni è solo italiana**: etichette, edge case, chiusure (tutto in `chat-script.ts`, per design: niente LLM di giorno). Il cliente inglese di giorno naviga un modulo che non capisce.
3. **L'estrazione consenso non parla inglese**: `YES = /^(sì|si|ok|...)/` — «yes», «ja», «oui», «sí» non sono consenso. Peggio: «yes» non combacia né con YES né con NO → `null` → nessun lead salvato. **Lead persi in silenzio.**
4. **Nessuna colonna `language`**: la lingua parlata sparisce; le statistiche non possono disaggregare.
5. **FAQ monolingua**: nessun campo `translations`; anche se Ambrosio parlasse inglese, le risposte ufficiali resterebbero italiane (e il prompt le impone).
6. Nome/telefono: le regex nome accettano lettere latine accentate (ok per en/fr/es/de), il telefono copre già formati con +39 — sufficiente come base.

Conclusione: il multilingua **non è un'estensione** ma la rimozione di un vincolo esplicito + tre completamenti (consenso multilingua, colonna `language`, FAQ localizzate).

## 4. Assessment canali (dove il codice presuppone «solo web chat»)

- **Il modello dati è già quasi neutrale** (`conversations`/`messages` senza riferimenti al canale): un webhook WhatsApp scriverebbe nello stesso thread senza migration dolorose. Manca solo `channel` per distinguerlo e `whatsapp_opt_in` per il consenso di canale.
- **Presunzioni web-chat sparse nel testo** (da astrarre, non da riscrivere): `chat-script.ts` propone link `wa.me` dell'operatore (inversione: oggi la chat web manda verso WhatsApp, domani WhatsApp sarà essa stessa il canale); `getClosing`/`getClosingActions` restituiscono azioni click (tel:, wa.me) che su WhatsApp non sono cliccabili allo stesso modo.
- **Nessun layer `messaging`**: le route API gestiscono direttamente request/response HTTP; il modello canonico del messaggio c'è già, l'interfaccia adapter no.
- **Turni e SLA sono timezone-hardcoded Europe/Rome** (corretto per l'agenzia, da tenere anche multicanale — il prompt lo vieta giustamente).
- **Rate limit e Shield per-IP**: su WhatsApp l'IP sarà del webhook Meta, non del cliente — il rate limiting per canale andrà ripensato alla连接 reale (non ora).

Conclusione: la predisposizione WhatsApp (Fase 4 del prompt) è **economica** perché il modello messaggio è già unico: migration additiva + adapter interface + policy constants, zero modifiche al cervello.

## 5. Roadmap in fasi (con «fatto quando»)

**FASE 1 — Ambrosio a funzioni (tool use)** *· il salto da chatbot a operatore*
- Whitelist di 5 funzioni con validazione server e audit: `salva_lead` (E.164, consenso obbligatorio), `fissa_callback` (solo slot reali sui turni, con consenso), `aggiorna_ticket` (solo alzare priorità), `nota_interna` (riepilogo per il team), `handoff` (segnala take-over al primo turno utile).
- Implementazione: parametri `tools` per OpenAI-compatible/Anthropic/Gemini dove supportati; **parser JSON robusto su risposta testuale** come via comune (funziona su tutti i provider, anche senza tool support nativo) — il prompt lo chiede esplicitamente come fallback.
- Ogni chiamata: validazione input → esecuzione → audit `ambrosio.tool` → fallimento silenzioso (la risposta testuale parte comunque).
- **Fatto quando**: in «Prova dal vivo» Ambrosio salva un lead reale con telefono E.164, fissa una callback su slot vero, lascia nota interna visibile in `/admin/tickets`, e ogni azione compare in `/admin/audit` — e un input invalidato viene rifiutato senza rompere la risposta.

**FASE 2 — Proattività automatica** *(molto è già fatto: ereditiamo dalla Fase 2 del ticketing)*
- Già in produzione dal ticketing: notifica «ticket attende risposta» con dedup, riapertura automatica, reminder callback mancate (cron). **Da fare solo il follow-up di riattivazione lead**: visitatore sparisce dopo aver chiesto prezzi → un solo messaggio di follow-up, dedup esplicito (`lead_followup_at`), inviato tramite il cron esistente, mai su canali dove non è lecito.
- **Fatto quando**: un lead caldo sparisce → riceve UN follow-up, mai due (verificato con doppio tick).

**FASE 3 — Multilingua nativo**
- Prompt: via la riga «SOLO in italiano», istruzione «rispondi nella lingua del cliente, default italiano».
- `conversations.language` (default `it`), rilevata dalla prima risposta libera (euristica A-Z + conferma dal contenuto).
- `lead-extract` multilingua: yes/ja/oui/sí = consenso valido solo esplicito; niente/null = rifiuto o nulla.
- `ai_faqs.translations jsonb` (`{"en": ...}`), risposta italiana come fonte di verità; editor con «traduci con AI» in bozza, il team approva.
- **Fatto quando**: «How much for an e-commerce site?» → risposta in inglese con fasce reali, lead salvato con consenso tracciato, conversazione marcata `en`.

**FASE 4 — Predisposizione WhatsApp (architettura, non il canale)**
- `conversations.channel` (default `web`, check constraint), `leads.whatsapp_opt_in` + `opt_in_at`; policy per canale come costanti (finestra 24h, lunghezza, niente markdown pesante); interfaccia adapter `messaging` con la web chat come primo adapter; schema credenziali pronto (AES-256-GCM come le chiavi AI) con pagina admin disabilitata.
- **Fatto quando**: build pulito, web chat indistinguibile da oggi, webhook collegabile in futuro senza toccare il cervello di Ambrosio.

**FASE 5 — Miglioramento continuo**
- Statistiche per funzione (callback fissate, priorità alzate, lead salvati) **per lingua e per canale**; loop domande→FAQ→traduzioni end-to-end.
- **Fatto quando**: la pagina AI disaggrega per lingua e le FAQ tradotte entrano nel flusso dei suggerimenti.

## 6. Rischi e regole confermate

- **Mai bloccante**: ogni funzione/lingua/canale fallisce in silenzio, la risposta testuale è sacra (già convenzione del progetto, resta la regola n.1).
- **Consenso prima di tutto**: nessun contatto, nessuna callback, nessun follow-up senza sì esplicito; su WhatsApp opt-in canale ≠ consenso contatto (due campi, due tracciature).
- **Zero allucinazioni commerciali in ogni lingua**: prezzi solo da `packages`, turni reali 9-13/15-19 Europe/Rome non tradotti né negoziabili.
- **Niente azioni distruttive**: la whitelist non contiene delete/close/update di dati esistenti; `aggiorna_ticket` solo alza la priorità.
- Non si tocca: chain multi-provider, Shield, rate limit, script diurno a bottoni (che resta italiano: è l'interfaccia del team, non di Ambrosio — i visitatori di giorno con testo libero passeranno ad Ambrosio dove utile).
