# USABILITY-TEST-PLAN — Ticketing system (inbox triage + pagina ticket)

> Piano di test di usabilità per il ticketing di Web Agency Crema, versione «due livelli»
> (commit `e3fdb3f`): inbox di triage per canale + pagina dedicata del ticket.
> Sessioni da 45 minuti, moderate, in presenza o su call con condivisione schermo.
> Riferimenti: *Rocket Surgery Made Easy* (Krug), *Measuring the User Experience* (Tullis & Albert).

---

## 1. Obiettivi e domande di ricerca

Il redesign presuppone che **separare triage e workspace restituisca la cognizione del ticket**.
Il test deve confutare o confermare questi presupposti:

| # | Domanda di ricerca | Cosa osservare |
|---|--------------------|----------------|
| RQ1 | Un agente trova in <10s i ticket che aspettano LA SUA risposta? | uso dei filtri «Da rispondere»/«Miei», lettura badge «Attende risposta», scansione lista |
| RQ2 | La divisione per canale è compresa senza spiegazione? | primo click sulla tab canali, commenti spontanei su «Chat web» vs «Tutti» (nota: con un solo canale attivo le tab sono «Tutti i canali» e «Chat web» — la tab WhatsApp esiste solo dopo il ticket di test, v. T5) |
| RQ3 | Il passaggio inbox → pagina ticket è percepito come naturale o come «uscita»? | esitazione al click sulla card, uso del back-link, perdita di orientamento |
| RQ4 | Nel workspace il flusso claim → risposta è un gesto o una caccia agli strumenti? | click su «Prendi in carico e rispondi», focus sul composer, tempi di prima battuta |
| RQ5 | Lo strumento resta usabile sotto pressione (5 ticket in arrivo, priorità contrastanti)? | errori di target, ordine di gestione, uso di note/priorità/callback |

**Criterio di successo complessivo**: ≥80% di task success sui task critici (T1, T2, T4), SUS ≥ 75.

---

## 2. Metodologia

- **Moderato + think-aloud**: l'agente verbalizza ciò che cerca e decide; il moderatore non aiuta mai prima dell'abbandono (regola Krug: nessun aiuto, solo «cosa ti aspetti che succeda?»).
- **In presenza** (ufficio) o **remoto** (call + condivisione schermo); in entrambi i casi lo schermo viene registrato (con consenso).
- **Ambiente reale**: `localhost:3200` con i dati di produzione di test (i ticket esistenti). Niente mock: i task devono produrre azioni vere su ticket di test creati ad hoc (vedi §6 preparazione).
- **Durata**: 45 min (5 intro · 30 task · 10 debrief).

---

## 3. Partecipanti

**Segmento unico: operatori del customer care.**

| Criterio | Dettaglio |
|----------|-----------|
| Necessario | usa o userà la inbox almeno 1 volta al giorno |
| Ideale | ha già usato Zendesk/Freshdesk/email per il supporto (per confronto spontaneo) |
| Da evitare | chi ha partecipato al design del ticketing |

- **Campionamento**: 5 partecipanti (trovano ~85% dei problemi di usabilità a livello di prodotto; con team di 2 operatori reali, si aggiungono 3 colleghi dell'agenzia come simulatori).
- **Reclutamento**: i 2 operatori reali (Daniele, Michele) + 3 colleghi non-tech con affinità al ruolo. Sessioni individuali, mai di gruppo.
- **Incentivo**: niente (colleghi interni), ma il debrief dei risultati è condiviso con loro — il feedback torna visibile.

---

## 4. Task (scenari realistici, in ordine crescente di difficoltà)

Ogni task parte dalla inbox (`/admin/tickets`). I ticket di test vengono creati prima della sessione (§6).

**Elementi citati verificati in pagina** (commit `e3fdb3f`, resa del 25/09): tab canali «Tutti i canali» / «Chat web», filtri «Aperti · Da rispondere · Miei · Collega · Tutti», badge «Attende risposta», SLA «entro SLA / scade presto / scaduto / in ritardo / attivo / in sospeso / palla dal cliente», banner «N ticket nascosti (vuoti o spam)» con bottone «Ripristina», bottone «Prendi in carico e rispondi», select «Priorità» (Bassa/Normale/Alta/Urgente) e «Stato» (In sospeso, ecc.), «Fissa callback: tra 1h / tra 3h / domani», composer «Rispondi al cliente…», pannelli «Lead» e «Note interne» con «Aggiungi nota», back-link «Torna alla inbox», empty state «Nessun ticket in questa coda» con bottone «Vai a Tutti».

### T1 — Trova e apri il ticket da gestire (critico, 2 min)
> «È lunedì mattina. Dai un'occhiata alla coda e apri il ticket che secondo te devi gestire per primo.»

- **Success**: apre una pagina ticket il cui ultimo messaggio è del cliente (badge «Attende risposta» o filtro «Da rispondere»).
- **Osserva**: quanto ci mette a pronunciare il criterio di scelta (urgenza? SLA? canale?).

### T2 — Prendi in carico e rispondi (critico, 4 min)
> «Questo cliente aspetta una risposta da oltre un giorno. Rispondigli in modo professionale.»

- **Success**: ticket assegnato all'operatore E risposta inviata (visibile nella conversazione), entro 4 min.
- **Osserva**: uso di «Prendi in carico e rispondi» vs assegnazione manuale + composer; uso delle risposte rapide; esitazione su Invio.

### T3 — Gestisci la priorità e sospendi (2 min)
> «Questo caso va rimandato a domani: metti il ticket in sospeso e alza la priorità così il collega lo vede appena rientra.»

- **Success**: stato «In sospeso» (voce della select «Stato») + priorità «Alta» (select «Priorità») — entrambi persistiti (verificabili nell'audit).
- **Osserva**: trova la gestione senza scroll? confonde stato e priorità? nota il badge «Aperto/Chiuso» accanto?
- **Attenzione dati**: usare un ticket di test, non di produzione — lo stato è un'azione reale che notifica il team.

### T4 — Non perdere il contesto (critico, 3 min)
> «Mentre sei dentro il ticket, ti accorgi che serve una info dal lead. Guarda i suoi dati e lascia una nota interna per il team.»

- **Success**: nota aggiunta, con l'agente che non ha perso il filo della conversazione (nessun ritorno accidentale alla inbox).
- **Osserva**: se la nota vive nella colonna destra, la trova? la sidebar sticky aiuta o distrae?

### T5 — Cambia canale mentale (1 min)
> «Ora controlla solo i ticket arrivati da WhatsApp.»

**Nota per il moderatore (non leggere al partecipante)**: oggi esiste solo il canale «Chat web», quindi la tab WhatsApp **non appare** — le tab derivano dai canali con ticket nel DB (`countTicketsByChannel`). Lo scenario si può eseguire solo DOPO aver creato un ticket di test con `channel='whatsapp'` (§6). Se eseguito così:
- **Success**: arriva alla tab «WhatsApp», la apre e interpreta correttamente la lista (1 ticket di test) o lo stato vuoto.
- **Osserva**: la tab è scopribile? riconosce il canale dal badge «WhatsApp» nella riga del ticket?
Se il ticket di test NON è stato creato, saltare il task e segnarlo «non eseguito — tab assente»: è un dato comunque utile (la divisione per canale è invisibile finché esiste un solo canale, scelta documentata nel CHANGELOG).

### T6 — Recupera un ticket nascosto (2 min)
> «Un cliente giura di aver aperto un ticket ieri ma non lo vedete: forse è finito tra gli nascosti. Recuperalo.»

- **Success**: apre il banner «N ticket nascosti (vuoti o spam)» (in cima alla lista), clicca «Ripristina» su un ticket, lo ritrova in coda dopo l'aggiornamento.
- **Osserva**: banner notato spontaneamente in T1? se no, quanto lo cerca?
- **Dato reale**: oggi il banner mostra «24 ticket nascosti» ma la lista ne espone i primi 8; in fondo compare «Altri N non mostrati: ripristinali dalla ricerca». Se il partecipante cerca un ticket oltre i primi 8, annotare l'inciampo (il messaggio rimanda alla ricerca, che però non copre gli archiviati — limite noto da segnalare nel report).

### T7 — Triage sotto pressione (stress, 5 min)
> «Sono arrivati 5 ticket insieme, in ordine casuale. Decidi in 5 minuti quali gestire ora, quali mettere in sospeso e quali assegnare al collega.»

- **Success**: decisioni prese su tutti e 5 (non serve eseguirle tutte), con criterio verbalizzato.
- **Osserva**: usa la lista per decidere o apre ogni ticket? ordine di scorrimento (urgenza? SLA? fila?).

### Metriche per task

| Metrica | Come |
|---------|------|
| Task success binario | sì/no/parziale (con assist = parziale) |
| Time on task | dal "vai" al completamento (cronometro o editing video) |
| SEQ (Single Ease Question) | dopo ogni task: «Quanto è stato facile da 1 (difficilissimo) a 7 (facilissimo)?» |
| Errori/inciampi | click persi, ritorno indietro, esitazioni >5s, uso dell'aiuto |
| Probe spontanei | citazioni testuali dei commenti (positivi e negativi) |

**Globali a fine sessione**: SUS (10 item, compilato dal partecipante), 1 domanda aperta: «Se potessi cambiare una sola cosa, quale?»

---

## 5. Guida alla moderazione

### Script d'apertura (5 min)

> «Grazie per il tempo. Sto testando il nuovo sistema ticket, non te: quello che faccio osservare può funzionare male, e i difetti che trovi sono esattamente ciò che cerco. Non ci sono risposte giuste. Cerca di pensare ad alta voce: cosa cerchi, cosa ti aspetti che succeda, cosa ti sorprende. Se tacci, non ti interrompo. Posso chiederti "cosa stai pensando adesso?", non è una critica. Il test usa dati veri ma su ticket di prova: puoi agire liberamente. Registriamo lo schermo solo per l'analisi. Va bene? Iniziamo.»

### Consegna dei task

- Leggi lo scenario **dalla pagina scritta, a voce uguale ogni volta** (coerenza tra sessioni).
- Se il partecipante chiede «devo…?», rispondi: «Tu cosa faresti?».
- **Regola dei 3 stadi di aiuto**: ① silenzio (lascia lottare, max 90s), ② nudge («cosa ti aspetti di trovare qui?»), ③ soccorso (mostra la via, ma il task va segnato *assist*, non *success*).
- Se il partecipante sbaglia canale/filtro: non correggere, annotare e lasciare esplorare.

### Sondaggi durante (a scandire, senza guidare)

- «Cosa ti dice questa schermata?» (a primo impatto inbox)
- «Cosa ti aspetti che succeda se premi qui?» (prima di claim/callback/nascondi)
- «Cosa manca qui, se manca qualcosa?» (nel workspace del ticket)

### Debrief (10 min)

1. «Ripercorriamo: qual è stato il momento più confuso?»
2. «Confronto: come lo faresti oggi, senza questo strumento?» (email/telefono)
3. Compila SUS davanti al moderatore.
4. «Una sola cosa da cambiare: quale?»
5. Ringrazia e spiega cosa succederà ai risultati.

---

## 6. Preparazione e pilot

### Checklist pilot (1 sessione di prova con un collega, la mattina stessa)

- [ ] Ticket di test creati: 1 «attende risposta» urgente con lead completo (T1/T2), 1 già aperto con priorità da cambiare (T3), 1 con note da aggiungere (T4), 1 con `channel='whatsapp'` (T5 — senza questo, la tab WhatsApp non esiste: v. nota al task), 5 ticket misti per lo stress test (T7). Nascosti ce ne sono già 24 (T6)
- [ ] Sessione operatore di test separata da quella reale (non sporcare i dati di produzione: login di test, v. sessione `buffy-test`)
- [ ] Registrare in scorecard i valori pre-test (priorità/stato/assegnatario) dei ticket usati per T2/T3, per ripristinarli dopo
- [ ] Registrazione schermo funzionante (test 30s e riascolto)
- [ ] Ambiente stabile: build verificata, polling chat attivo, no dev server che ricompila a metà task (i click durante il Fast Refresh non navigano — visto in verifica del 25/09)
- [ ] Moduli stampati/aperti: scorecard per task, scheda note, SUS
- [ ] Piano B se il DB non risponde: screenshot statici per T5/T6 (solo fallback, da dichiarare nel report)

### Dati da registrare per sessione

| File | Contenuto |
|------|-----------|
| `session-<n>.mp4` | schermo + audio |
| `scorecard-<n>.md` | tabella task × (success, tempo, SEQ, errori osservati) |
| `notes-<n>.md` | probe spontanei, citazioni, comportamenti inattesi (formato: `mm:ss — cosa — interpretazione`) |

---

## 7. Piano di analisi

1. **Stesso giorno della sessione**: trascrivere scorecard + top-3 citazioni (la memoria dei dettagli muore in 24h).
2. **Matrice problemi × partecipanti**: ogni problema con severità 0–4 (Nielsen) × frequenza (quanti l'hanno incontrato). Priorità = severità × frequenza.
3. **Metriche aggregate**: tasso di successo per task (target: ≥80% sui critici), mediane dei tempi, media SEQ (target ≥5), SUS (target ≥75).
4. **Confronto con le presunzioni**: RQ1–RQ5 risposta per risposta, con l'evidenza (timecode video).
5. **Output**: rapporto di 2 pagine — top-5 problemi con fix minimo consigliato + punti forti da non toccare — allegato a `CHANGELOG.md` come le altre decisioni di progetto.
6. **Ciclo**: i fix P0 entrano nel prossimo sprint del ticketing; i task critici falliti vengono ri-testati con 2 partecipanti nuovi (regola: fix verificato, non ritenuto).

---

## 8. Ruoli

| Ruolo | Chi |
|-------|-----|
| Moderatore | Buffy (questa sessione) o Daniele |
| Osservatore/prendinote | Michele o chi non modera |
| Partecipanti | 2 operatori + 3 colleghi simulatori |
| Decisione sui fix | Daniele (owner prodotto) |

---

*Creato come strumento operativo: stampare §5 (script) e §4 (task) per la sessione; il resto resta qui come riferimento.*
