# ROADMAP — AUTONOMIA AMBROSIO

Tre livelli di gestione attivabili che lasciano sempre spazio all'essere umano, la sezione documenti che istruisce Ambrosio, e le proposte con preventivo in bozza. Implementata la **Macro FASE 1**; la **Macro FASE 2** estende canali, invio e apprendimento.

---

## MACRO FASE 1 — Ambrosio autonomo (IMPLEMENTATA, 2026-09-26)

### ① 3 livelli di gestione attivabili (`/admin/ai/autonomia`)
- **L1 · Contatto** — prende solo contatto e fissa la richiamata in 4 domande (servizio, tempi, sito esistente, contatti): nessun tool, il resto lo fa il team al richiamo.
- **L2 · Qualifica** — risponde in automatico con tetto mosse (default 4, 2–10): FAQ, pacchetti, salvataggio lead col consenso, callback, priorità, note, handoff. Al tetto: handoff automatico al team, mai una chat tenuta chiusa all'infinito.
- **L3 · Proposta** — eredita L2 e aggiunge il take-over SLA: superata la finestra di risposta, Ambrosio subentra nel thread (annuncio trasparente + nota interna), raccoglie le informazioni giuste e prepara una **proposta scritta con preventivo in BOZZA**.
- Tutti i livelli lasciano spazio all'umano: L1 finisce nella richiamata, L2 nel tetto mosse, L3 nella revisione della proposta.

### ② Più strumenti per istruire Ambrosio
- **Sezione Documenti** (`/admin/ai/documenti`): biblioteca (categoria, lingua, priorità) iniettata nel prompt come verità dell'agenzia, accanto a FAQ e pacchetti. Solo a L3 Ambrosio può citarne la fonte; a L1/L2 le usa in silenzio.
- **Nuovo tool `prepara_proposta`** (L3): item «Voce|prezzo» (max 8), bozza sempre in stato `draft`, audit con firma `ambrosio@ai`.
- Gate dei tool **per livello** in `runToolCall`: un tool fuori dalla lista del livello attivo non viene eseguito MAI, nemmeno se il modello lo chiama.

### ③ Ambrosio tra gli operatori (`/admin/operators`)
- Card dedicata con livello attivo, take-over SLA e **lista accessi** espandibile (7 accessi, check/spento) — lo stesso catalogo `accessList()` della scheda Autonomia: un solo posto decide cosa può fare.
- Link rapidi ad Autonomia e Documenti.

### Agganci tecnici
- Migration `028-ambrosio-autonomy.sql`: colonne autonomia su `ai_settings`, tabelle `ai_documents` e `ai_proposals`, `conversations.ai_takeover_at` (dedup take-over).
- Cron step 11: take-over SLA claim-then-announce (il claim è il lock; l'annuncio fallito rilascia).
- Route `/api/chat/ai`: gate livello + tetto mosse con handoff forzato e messaggio di consegna al team.
- Test: `tests/ambrosio-autonomy.test.mjs` (11 test, inclusa la coerenza statica gate/route/cron/migration). Suite completa 111/111, typecheck ✓, guard overlay ✓.

---

## MACRO FASE 2 — Canali, invio e apprendimento (prossimi passi)

1. **WhatsApp e voce per Ambrosio**: rispondere sui canali Fase 4 rispettando le finestre business-initiated; sintesi vocale per le richiamate L1.
2. **Invio proposte supervisionato**: PDF/email dalla scheda Proposte dopo l'approvazione, con tracking apertura e risposta cliente; la proposta diventa lead caldo automaticamente se accettata.
3. **Apprendimento continuo**: le domande non coperte alimentano bozze FAQ e documenti suggeriti (già in parte in Addestramento), con revisione umana a cadenza settimanale nel digest mattutino.
4. **Escalation a livelli per conversazione**: partire L1 e promuovere a L2/L3 a metà chat quando il cliente chiede prezzi o mostra urgenza (oggi il livello è globale per Ambrosio).
5. **Pannello delle mosse nel dettaglio ticket**: pill «3/4 mosse» live e storico dei take-over con esito della proposta.
