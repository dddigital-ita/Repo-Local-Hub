# DECISIONE — Strumento "Backup e aggiornamenti" v2 (2026-10-01)

> Toolkit decisionale (decision-toolkit) per la revisione dello strumento di
> backup/aggiornamenti interno. Contesto misurato nel repo oggi, non ipotesi.

## 1. Contesto — cosa esiste già

**Backup (solido):**
- CLI `npm run backup`: dump PostgreSQL completo + `git archive` del codice
  del ref + `MANIFEST.json` (sha256, dimensioni, istruzioni restore). Redact
  del DSN, gestione pg_dump server/client.
- Admin `/admin/tools/backup`: export JSON completo del DB, backup cloud S3
  (retention 14 giorni, allarme se manca il giornaliero), promemoria, storico,
  restore.
- `seo-backups.ts`: backup automatico delle configurazioni SEO.

**Aggiornamenti (il gap):**
- Solo un "Verifica aggiornamenti" che legge le versioni di Next/React. Nessun
  concetto di aggiornamento per DOMINIO (temi, hero, Ambrosio, tools…), nessun
  changelog interno, nessun export/import selettivo, nessun rollback per area.

**Superfici per dominio già esistenti nel codice:**
| Dominio | Stato (config/contenuti) | Dove vive |
|---|---|---|
| Temi grafici | `content_settings.site_theme` (+mode, primary/accent) | `theme.ts` / `theme-shared.ts` |
| Hero | `content_settings.site_hero` (template, testi, A/B) | `hero.ts` / `hero-shared.ts` |
| Ambrosio AI | `ai_settings` (provider, chiavi, prompt, FAQ) | migrations 004/011/015/028/029 |
| Risposte rapide / chat | tabelle dedicate (012, script chat) | — |
| Tools & settings | svariate tabelle config (SLA, canali, calendario…) | migrations 006–043 |
| Ticketing (futuro) | tickets + SLA clocks (003, 017) | — |

**Vincoli di piattaforma (AGENTS.md):** il codice segue Git/Vercel (il pannello
non aggiorna codice); i gemelli condividono le funzioni per contratto
(twin-sync, 9 file) ma MAI contenuti/pagine/admin; niente cron verso Neon.

## 2. First principles — il problema reale

1. **Quale problema risolve?** Oggi un errore su un dominio (es. prompt di
   Ambrosio, tema, hero) costringe a rifare a mano o a perdere tempo: non c'è
   snapshot per-area, né storico leggibile, né rollback puntuale.
2. **Posso risolverlo io?** Sì: i dati sono tutti in Postgres, le superfici
   sono già mappate in lib dedicati.
3. **È la soluzione migliore?** Un sistema di "release di configurazione" per
   dominio, con export/import JSON e rollback, usa ciò che esiste (JSON export,
   audit_log, content_settings) invece di inventare un nuovo store.
4. **Assunzioni?** Che i domini restino confinati nelle tabelle note; che
   l'export selettivo sia usato anche fra gemelli (attenzione: testi diversi).
5. **Da zero oggi?** Sì, stesso disegno: dominio → snapshot → changelog →
   rollback, tutto dentro l'admin esistente.

## 3. Le opzioni (trade-off navigation)

| | **A. Snapshot per dominio** | **B. Release bundle totale** | **C. Export/import fra gemelli** |
|---|---|---|---|
| Cosa | "Aggiorna e salva" per area (temi, hero, Ambrosio, tools, settings, ticketing): snapshot JSON + changelog + ripristino a punto | Una "release" interna che cattura TUTTI i domini in una versione numerata | Come A, ma l'export nasce per essere importato nell'altro sito (fix di release) |
| Pro | Risponde subito al bisogno; granularità; rollback sicuro per area | Un solo numero di versione; storico lineare; vicino alla mentalità "release" | Copre il caso «esportare solo una fix di tools»; riuso gemello-pari |
| Contro | Non dà UNA versione complessiva | Export monolitico: poco utile per fix puntuali; rischio di ripristini ampissimi | Richiede filtri sui contenuti di sito (testi, cifre) per non inquinare il gemello |
| Sforzo | Medio | Medio-basso | Medio-alto (sopra A) |

**Raccomandazione: A + C come estensione (A1).** Il dominio è l'unità minima
giusta (è così che lavorate: "aggiorno l'hero", "cambio i prezzi in chat"); la
release totale è la SOMMA degli snapshot di dominio, non l'unità base. L'export
selettivo («solo fix tools») deriva naturalmente da A: lo stesso JSON per
dominio diventa l'artefatto da importare nell'altro gemello, con una whitelist
di campi "gemello-pari" per non portare testi/cifre di sito.

## 4. Bias check (compilato onesto)

- ☐ FOMO — «tutti hanno versioning»? No: il bisogno nasce da incidenti reali (prompt/prezzi).
- ☑ Sunk cost — non deve pilotare: il pannello attuale resta, si estende.
- ☐ Authority — nessun vendor di turno: si usa Postgres + JSON, zero dipendenze.
- ☐ Shiny object — niente "release pipeline" finti: il codice resta su Git.
- ☑ Optimism — rischio reale: gli import fra gemelli possono sporcare contenuti → whitelist.

## 5. Scenario matrix (12 mesi)

| Scenario | Probabilità | Esito senza strumento | Esito con A1 |
|---|---|---|---|
| Prompt Ambrosio rovinato da una modifica | media | rifare a mano dal ricordo | ripristino snapshot con 2 click |
| Tema/hero sballati dopo esperimento | media | screenshot e memoria | rollback al punto prima |
| Fix prezzi da applicare identica sui due siti | alta | copia/incolla manuale fra admin | export dominio → import nel gemello (whitelist) |
| Auditor chiede "chi ha cambiato cosa e quando" | alta | audit_log generico | changelog per dominio + snapshot firmati |

## 6. Pre-mortem

Immagina marzo 2026: lo strumento è fallito. Perché?
1. **Gli import fra gemelli hanno sovrascritto testi di sito** → mitigazione: whitelist campi + diff mostrato PRIMA di confermare.
2. **Gli snapshot sono troppi e nessuno li pulisce** → mitigazione: retention per dominio (es. 20) + etichetta "punto di release".
3. **Doppione con il backup completo** → mitigazione: uno snapshot di dominio È un pezzo dell'export JSON già esistente, stessa firma/sha, nessun formato nuovo.
4. **Nessuno capisce quale snapshot è "la release"** → mitigazione: tag/nome esplicito (`tools-fix-2026-03-05`) e riga nel changelog interno.

## 7. Domande aperte (le decido con te prima di implementare)

1. Unità base: dominio (consigliato) o release numerata totale?
2. I domini richiesti: temi, hero, Ambrosio AI, tools, settings, risposte rapide; ticketing come stub attivabile?
3. Export fra gemelli: sì con whitelist (consigliato) o solo locale?
4. Rollback: ripristino a snapshot scelti (consigliato) o solo undo dell'ultimo?
5. Dove: estendo `/admin/tools/backup` o nuova scheda `/admin/tools/updates`?

## 8. 10-10-10 e sintesi

- 10 minuti: estendere il pannello non rompe nulla (work in corso dietro feature flag).
- 10 mesi: storico per dominio usato nei go-live e negli audit.
- 10 anni: la "release interna" sarà la memoria delle decisioni di configurazione.**Sintesi**: estendere il pannello Backup con una sezione "Aggiornamenti per
dominio": snapshot JSON per area + changelog interno + rollback; export
selettivo con whitelist per il gemello; release totale = insieme di snapshotetichettati. Il wizard interattivo (`docs/decisione-updates-backup.html`)
percorre gli stessi nove step e registra le tue scelte.

## 9. Decisione registrata (2026-10-01, con l'utente)

- **Unità base: dominio** — snapshot per area; una "release" è un'etichetta
  sull'insieme al punto corrente, non un formato nuovo.
- **Domini v1**: Ambrosio AI · Temi + Hero · Tools + Impostazioni ·
  Ticketing come stub predisposto (si attiva quando la feature arriva).
- **Export fra gemelli: sì, con whitelist** dei campi gemello-pari; l'import
  mostra il diff prima di confermare.
- **Collocazione: /admin/tools/backup** si estende (hub unico recovery +
  release); il codice segue Git/Vercel come oggi.

Fasi di consegna: 1) snapshot+changelog+rollback dei domini · 2) export/import
fra gemelli con whitelist · 3) etichette di release + stub ticketing attivo.
