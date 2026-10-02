# Brief — Condivisione funzioni tra i progetti gemelli

> Valutazione della richiesta: «mantenere le funzioni aggiornate allo stesso
> modo tra i progetti gemelli, senza spostare contenuti, pagine o file admin».
> Formato: design brief (Contesto → Problema → Perimetro → Opzioni →
> Raccomandazione → Processo → Decisioni aperte).

## 1. Contesto

Due progetti gemelli con lo stesso stack (Next.js + Neon + Vercel) e testi
diversi, destinati a **proprietari diversi**:

- `WebAgencyCrema` (questo repo) · gemello: `Web Agency Salento + Installer`
- Il gemello è già citato nella storia del repo: conflitto porta 3100
  (risolto con la porta E2E derivata per repo), stesso stack copiato.

**Vincolo assoluto**: niente spostamenti di contenuti, pagine o file admin.
Le schede clienti, i testi pubblici, i contenuti editoriali e le pagine
restano proprietà esclusiva di ciascun progetto. Si condividono solo
**funzioni e strumenti** — la logica, non la sostanza.

## 2. Il problema (misurato oggi, non ipotetico)

Drift attuale su 10 file candidati (diff diretto tra i due checkout):

| Stato | File |
|---|---|
| UGUALI (per fortuna, non per garanzia) | `scripts/backup-full.mjs`, `scripts/db-migrate-all.mjs`, `scripts/verify-deploy.mjs` |
| DIVERGE (piccolo) | `scripts/e2e-port.cjs` (costanti d'ambiente: dev 3200 vs 3400), `scripts/e2e-port-guard*` |
| DIVERGE (sostanziale) | `src/lib/clients-shared.ts` — 203 righe di differenza: il gemello non ha l'intera sezione client-type (038) |
| SOLO NOSTRO (mai portato) | `src/lib/desk-autopilota-shared.ts`, `src/lib/takeover-shared.ts`, `scripts/channel-webhook-core.mjs` |

Il caso `clients-shared` è la dimostrazione del problema: il modulo «puro»
nato per essere testabile senza DB si è evoluto in un repo e l'altro è
rimasto indietro — le sentinelle verdi in entrambi i repo non impediscono
che i due prodotti divergano.

## 3. Perimetro della condivisione

**IN** (candidati allineati):
- Moduli puri senza import (`*-shared.ts`, `channel-webhook-core.mjs`,
  `e2e-port.cjs`) — la lezione del post-mortem: la logica che deve restare
  vera vive separata dal guscio.
- Strumenti operativi (`scripts/backup-full.mjs`, `db-migrate-all.mjs`,
  `verify-deploy.mjs`, `e2e-port-guard*`) — con i punti di configurazione
  per-repo isolati (costanti d'ambiente, liste di route da verificare).
- Migration additive che introducono colonne/tabelle usate da moduli
  condivisi (041, 042: già uguali perché i moduli erano solo nostri —
  il prossimo sync le porterà).

**OUT** (mai condivisi):
- `src/app/**` (pagine e route: layout, testi, contenuti admin)
- Contenuti del DB, lead, clienti, note
- Testi, brand, domini, env con segreti
- Pagina/pannello singoli anche se "uguali": la UI è su comando — le
  funzioni sottostanti si condividono, la pagina no.

## 4. Opzioni valutate

### Opzione A — Package npm privato (`@dddigital/wac-shared`)

I moduli condivisi diventano una libreria installata da entrambi i repo.

- Pro: versione semantica, dipendenza esplicita, impossibile il drift
  silenzioso (aggiorni = bump).
- Contro: richiede un registry privato (npm org a pagamento o GitHub
  Packages) e un ciclo release→install per ogni modifica; per due repo
  è un'infrastruttura sproporzionata; il flusso «copiata e modifica
  nell'altro» diventa «publish e npm ci». Costo operativo reale.
- Verdetto: **prematura** oggi. Diventa la scelta naturale se i gemelli
  diventano 4+ o se le funzioni condivise crescono oltre ~10 moduli.

### Opzione B — Repo unico monorepo con `packages/shared`

Un solo repo, due app + un package condiviso.

- Pro: deduplicazione vera, un solo git, import Diretti.
- Contro: i proprietari FUTURI diversi rendono un unico repo un problema
  contrattuale e d'accesso (chi possiede il repo possiede entrambi i
  prodotti); la separazione è esplicitamente nel perimetro del cliente.
- Verdetto: **scartata** — il vincolo d'ownership lo esclude.

### Opzione C — Cartella/file condivisi via script di sync (consigliata)

La fonte della verità vive in UN repo (per convenzione: il più avanti);
un `scripts/twin-sync.mjs` con **manifest esplicito** (`twin-sync.json`,
committed in entrambi i repo) copia i file IN perimetro verso il gemello
con verifica hash, e una sentinella (`tests/twin-sync.test.mjs`) fa
fallire la suite se i file del manifest divergono.

- Pro: zero infrastruttura; il manifest è la documentazione; il test
  rompe la suite PRIMA che il drift arrivi in produzione; funziona già
  con due checkout fratelli sullo stesso disco (il caso attuale).
- Contro: richiede che entrambi i checkout siano raggiungibili (lo sono:
  stessa cartella progetti); la direzione è manuale (chi aggiorna sceglie
  da dove); non c'è versioning separato (il commit d'origine è nel
  manifest, la storia vive nei due git).
- Mitigazioni: il manifest registra `source-repo` e `last-sync-commit`;
  il sync accetta `--from` per invertire la direzione; i punti di
  configurazione per-repo restano OUT del manifest (es. la costante dev
  in `e2e-port.cjs`).

### Opzione D — Git subtree/submodule del folder condiviso

- Pro: git nativo.
- Contro: subtree va gestito a mano con comandi oscuri; submodule con
  lock di versione è complicato per i non-specialisti e rompe il flusso
  serverless (Vercel build da submodule è fragile).
- Verdetto: **scartata** per complessità operativa rispetto al beneficio.

## 5. Raccomandazione

**Opzione C (script di sync + manifest + sentinella)**, con l'impegno
esplicito di migrare all'Opzione A quando (e se) i gemelli crescono:
il manifest `twin-sync.json` è già il 90% dell'elenco dei file del
futuro package.

Struttura proposta:

```
twin-sync.json              # il manifesto: file condivisi, direzione, ultimo commit
scripts/twin-sync.mjs       # check (--check), apply (--apply), dry-run di default
tests/twin-sync.test.mjs    # sentinella: i file del manifest devono coincidere
```

Regola del gruppo variante per-repo: i file condivisi possono avere
**blocchi marcati** `// twin-sync: per-repo` … `// /twin-sync` che il
sync NON sovrascrive (la costante della porta dev è il primo esempio).

## 6. Processo operativo (quando deciso)

1. Modifica la funzione condivisa NEL repo sorgente, commit + push.
2. `node scripts/twin-sync.mjs --apply` dall'altro repo (o `--from`).
3. La sentinella di entrambi i repo conferma l'allineamento; suite verdi.
4. Se una funzione nuova va condivisa: si aggiunge al manifest IN ENTRAMBI
   i repo nello stesso commit.

Il sync NON è automatico: decide il team, nel commit. L'automazione
(sentinel) serve solo a rendere la divergenza visibile.

## 7. Decisioni aperte per il committente

1. **Direzione**: questo repo come fonte della verità (è avanti: ha i
   moduli nuovi)? O bidirezionale con per-file ownership?
2. **Primo sync**: portare i moduli nuovi (client-type, desk-autopilota,
   takeover, channel-webhook-core) nel gemello ora, o solo preparare lo
   strumento e decidere il contenuto dopo?
3. **La porta dev**: unificare la costante (condiviso pieno) o marcarla
   per-repo (ogni repo il suo ambiente)?

## 8. Esito (30/09/2026)

Scelte applicate (best judgment, annotato): direzione **Crema → Salento**
(con `--from` per il contrario); **strumento + primo sync completo**;
costanti **per-repo** in blocchi marcati. Il primo giro ha rivelato che il
drift era **bidirezionale**: il gemello aveva un parser budget migliore
(suffisso «k», adottato) e un loader CLI più robusto (adottato), noi la
sezione client-type (portata lì). Il manifest gira su 9 file; le due
sentinelle rendono la divergenza visibile in suite in entrambi i repo.
`channel-webhook-core.mjs` resta candidato (`future-candidates`) finché
il gemello non adotta anche il canale social.
