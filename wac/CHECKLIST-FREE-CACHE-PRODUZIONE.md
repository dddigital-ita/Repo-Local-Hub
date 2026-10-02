# CHECKLIST — Free cache: prova produzione-like e uso reale

> Prova eseguita il **01/10/2026** su build locale di produzione (`next start`
> con build webpack reale, DB E2E `wac_e2e`, chiavi Turnstile di TEST):
> **10/10 prove superate in 17,4 s** — 4 della cache (percorso completo con
> conferma a due fasi, multi-target, motore della purga) + 6 del captcha
> (suite gemella nella stessa config prodlike). Audit `cache.purga`
> verificato via psql dopo il run.

> Stessa prova **verde sul gemello Web Agency Salento** lo stesso giorno
> (`wac_e2e`, stessi tempi): l'impianto prodlike è identico nei due repo,
> cambia solo il nome del DB E2E. Questa checklist vale per entrambi
> sostituendo `wac_e2e` ↔ `was_e2e`.

> **Come si legge**: i comandi si danno dalla radice del repo. La prova NON
> tocca Neon produzione: il DB E2E è locale e disposable, le chiavi
> Cloudflare sono quelle di TEST ufficiali. Regola AGENTS.md resta valida:
> nessun ping a Neon (scale-to-zero).

> **Run del 01/10/2026 (sera)** — suite prodlike completa **16/16** in entrambi
> i repo (cache 4 + captcha 6 + **admin-skeleton 6**, la nuova sentinella di
> navigazione admin: login, hub reali senza skeleton appeso, salvataggi col
> TTL e tema intatti). Due lezioni del giorno, da prerequisiti permanenti:
>
> 1. **Reset DB SEMPRE prima di un run completo.** `audit_log` è append-only
>    per costruzione (RULE `audit_log_no_delete`): il seed delle spec NON può
>    cancellare le purghe dei run precedenti — «Mai purgata dal registro»
>    fallisce con la storia sporca anche con il seed verde. Solo
>    `scripts/e2e-db-reset.mjs` riparte davvero puliti.
> 2. **Verifica la porta dopo lo stop.** Un pid stantio può lasciare il
>    VECCHIO server in ascolto (bucket dei login ancora saturo): i «200»
>    dello start successivo sarebbero suoi. Controllare `lsof -iTCP:3105`
>    prima di lanciare la suite.

## Cosa prova (e cosa no)

- **Build reale**: `next build --webpack` + `next start` — lo stesso motore
  del deploy, non il dev server. Se gira qui, gira sul deploy.
- **Flusso admin vero su browser**: login → Tools → Free cache → 4 target →
  conferma → esito → audit → età della cache.
- **Conferma a due fasi**: senza «Prepara la purga» il bottone primario NON
  purga; il box di conferma cita ESATTAMENTE i target scelti.
- **Multi-target**: la conferma deve coprire ENTRAMBI i target scelti
  («Solo la home, Solo l'admin»), con mutua esclusione «Tutto il sito» ↔
  target singoli.
- **Onestà dell'età**: su audit senza purghe la scheda dice «Mai purgata dal
  registro»; dopo la purga diventa «Ultima purga: oggi» leggendo l'audit
  (pagina force-dynamic, zero polling).
- **NON copre**: la purga su Neon produzione (per design). Il motore
  `revalidate` è però lo stesso che usa il deploy, e il test 4 verifica che
  la home risponda 200 dopo la purga.

## Prerequisiti

- Postgres locale su `:5432`, `psql` nel PATH.
- `.env.e2e` presente (DB `wac_e2e` + chiavi Turnstile TEST) — mai valori di
  produzione dentro.
- Dipendenze installate (`npm ci`) e porta `:3105` libera.

## 1. Reset del DB E2E (~20 s)

```bash
node scripts/e2e-db-reset.mjs
```

Esito atteso (run di oggi): drop+create di `wac_e2e`, poi
`riepilogo: 43 applicate adesso · 0 già tracciate … 0 in errore` e
`e2e db pronto: postgresql://localhost:5432/wac_e2e`.
*(Sul gemello: 44 migration, `wac_e2e`.)*

## 2. Build di produzione in dist dedicata (~1–2 min)

```bash
sh -c 'set -a; . ./.env.e2e; set +a; npm run build:local'
```

Esito atteso: overlay-guard silenzioso, `next build --webpack` che scrive in
`.next-prod` (via `WAC_DIST_DIR`), tabella delle route senza errori.
Il source di `.env.e2e` dà alla build la SITE KEY di TEST (il widget deve
montarsi anche in produzione-like).

## 3. Avvio del server con doppio fork (~5 s)

```bash
bash scripts/prodlike-server.sh start
```

Esito atteso: `prodlike server: 200 su :3105` — lo script attende davvero il
200 su `/admin/login` prima di uscire.

Dettagli che contano:

- log: `/tmp/wac-prodlike-server.log` — pid: `/tmp/wac-prodlike.pid`;
- legge `.env.e2e` con `setdefault` (se un valore manca, lo imposta lui);
- lancia `node node_modules/next/dist/bin/next start -p 3105` su `.next-prod`.
- **Perché il doppio fork**: un `next start` figlio diretto della shell
  muore alla chiusura del terminale (i tentativi con `&`/`nohup`/`disown`
  hanno dato HTTP 000). Lo script stacca il processo e sopravvive.

## 4. Prova Playwright prodlike (~20 s)

```bash
npx playwright test --config playwright.prodlike.config.ts
```

Esito del run di oggi (workers 1, chromium, 17,4 s):

| # | Prova | Tempo |
|---|-------|-------|
| 1 | cache · seed: admin di test e audit senza `cache.purga` | 87 ms |
| 2 | cache · PERCORSO COMPLETO: login → scheda → 4 target → conferma → purga → audit → età «oggi» | 3,6 s |
| 3 | cache · MULTI-TARGET: home + admin insieme, conferma che li copre ENTRAMBI | 3,5 s |
| 4 | cache · il motore della purga funziona davvero: la home risponde dopo il revalidate | 21 ms |
| 5 | captcha · seed utente di test | 46 ms |
| 6 | captcha · LOGIN: widget montato, token allegato, accesso riuscito su build | 2,3 s |
| 7 | captcha · CHAT: apertura con captcha attivo (chat-init passa la verifica) | 3,0 s |
| 8 | captcha · LEAD: widget globale sulle pagine pubbliche | 2,0 s |
| 9 | captcha · PASSWORD DIMENTICATA: richiesta pubblica che passa | 2,2 s |
| 10 | captcha · siteverify raggiungibile dal runtime (secret errata → errore Cloudflare) | 121 ms |

`10 passed` — solo con `--config playwright.prodlike.config.ts`: le due spec
prodlike sono FUORI dalla routine E2E quotidiana.

## 5. Verifica audit dal DB (la prova che resta)

```bash
psql postgresql://localhost:5432/wac_e2e -c \
  "select actor, action, target, detail from audit_log
   where action = 'cache.purga' order by created_at desc limit 3;"
```

Risultato del run di oggi (identico sul gemello, colonna `actor` in entrambi):

```
          actor          |   action    |           target
-------------------------+-------------+----------------------------
 cacheprodlike@e2e.local | cache.purga | Solo la home, Solo l'admin
 cacheprodlike@e2e.local | cache.purga | Solo l'admin
```

`detail` = «verifica prodlike del tool Free cache» (il motivo scritto nel
form). L'audit è no-update/no-delete per regole: la riga è prova vera.

## 6. Chiusura

```bash
bash scripts/prodlike-server.sh stop
lsof -i :3105 -sTCP:LISTEN   # deve restare vuoto
```

Esito atteso: `prodlike server fermato`, porta libera.

## 7. La routine E2E standard (quella di ogni giorno, non prodlike)

Distinzione: questa è la suite di routine contro un **dev server** (`next
dev`) che Playwright avvia da solo — non serve il passo 3 di questa
checklist. La porta NON è la 3105: è derivata dal percorso del repo
(`3110 + sha1(cwd) % 80`, banda 3110–3189 — ogni repo la sua) e il DB E2E
è lo stesso `wac_e2e`/`was_e2e` disposable. Le due spec prodlike sono
ESCLUSE dalla routine per config (`testIgnore`). Durata attesa: 5–8 minuti
(114 test, workers 1).

| | Salento | Crema |
|---|---|---|
| Porta E2E (derivata dal percorso) | 3168 | 3166 |
| DB E2E | `wac_e2e` | `was_e2e` |
| Ultimo run certificato | 114/114 in 5,8 min (01/10/2026, post-0.7.1) | 94/94 in 4,9 min (01/10/2026, post-reverse-port) + unit 459/459 |

⚠️ Due insidie concrete, entrambe verificate il 01/10: lanciato direttamente
nella shell del tool, `npx playwright test` muore alla chiusura del
terminale → doppio fork come al passo 3; e la porta è calcolata con
`process.cwd()`, quindi ogni comando (sonda della porta compresa) va dato
COL `cd` nel repo — altrimenti si controlla la porta di un altro albero,
o di nessuno.

**0. Reset del DB E2E** (in CI lo fa il job; in locale allinealo a mano):

```bash
cd "$(git rev-parse --show-toplevel)" && node scripts/e2e-db-reset.mjs
```

**1. Lancio con doppio fork** (stesso impianto del passo 3, ma per la
suite intera; il log e il pid finiscono in /tmp):

```bash
cd "$(git rev-parse --show-toplevel)" && python3 - <<'PYEOF'
import os, subprocess, sys
if os.fork() > 0: sys.exit(0)
os.setsid()
if os.fork() > 0: sys.exit(0)
env = dict(os.environ)
for line in open('.env.e2e'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env.setdefault(k, v)
with open('/tmp/e2e-routine.log', 'wb') as out:
    p = subprocess.Popen(['npx', 'playwright', 'test'], env=env,
                         stdout=out, stderr=out, stdin=subprocess.DEVNULL,
                         cwd=os.getcwd())
open('/tmp/e2e-routine.pid', 'w').write(str(p.pid))
PYEOF
echo "run E2E avviata: pid $(cat /tmp/e2e-routine.pid)"
```

**2. Monitor** (sonda ogni 2–3 minuti; la run scrive il test corrente nel
log, quindi è sempre chiaro dov è):

```bash
kill -0 $(cat /tmp/e2e-routine.pid) 2>/dev/null && echo RUN VIVA || echo RUN FINITA
tail -5 /tmp/e2e-routine.log
```

**3. Esito e igiene**: la riga finale deve essere `N passed` (riferimento:
`114 passed (5.8m)` del run post-0.7.1) seguita dal verdict del leak-guard
(`nessuna riga di prova residua nel DB condiviso`); poi porta libera e
file di lavoro puliti:

```bash
lsof -i :3168 -sTCP:LISTEN   # vuoto: nessun listener residuo
rm -f /tmp/e2e-routine.pid /tmp/e2e-routine.log
```

**Il lock E2E (da 01/10):** la run acquisisce da sola il semaforo
(`/tmp/wac-e2e-lock-<porta>.json`, via `globalSetup`): se un'altra run è
viva sulla porta/DB questa si rifiuta di partire SUBITO, col pid e il
rimedio — fine delle run intrecciate (caso 01/10: due agenti attivi, reset
di wac_e2e a metà di qualcuno). Lock di una run morta = STANTIO: la
prossima run lo rimuove da sola. Server orfani (il wrapper sopravvive alla
run e tiene la porta) vengono RILEVATI con avviso e pid. Stato a mano:

```bash
node scripts/e2e-lock-cli.mjs   # LIBERO · OCCUPATO (chi, pid, da quanto) · STANTIO
```

Se un test fallisce: il trace è `retain-on-failure` (cartella
`e2e-artifacts/`), il log della run ha il punto esatto. Rumore INNOCUO nel
log del server: i warning Cloudflare sulla rimozione dei widget Turnstile
tra pagine (`Cannot find Widget cf-chl-widget-…`, `Nothing to remove…`).

Il vecchio rumore dei `unhandledRejection` DOM (`Transition was aborted
because of timeout in DOM update`) è stato corretto alla fonte il 01/10
(`28c8d39` qui, `1a62ec0` a Crema): era il watchdog di Chromium della View
Transitions API che abortiva l'animazione sui render lenti e la promessa
rifiutata finiva non gestita; ora il rifiuto è consumato e la navigazione
resta regolare. Log atteso oggi: NESSUN `unhandledRejection`. Se uno
riappare — spec con la firma nuova o crescente — non è più rumore da
tollerare: è un segnale da indagare (partire da `view-transitions.tsx`).

## Risoluzione problemi

- **Server morto / HTTP 000**: si è usato `next start` diretto invece dello
  script — il processo figlio della shell viene ucciso. Solo
  `scripts/prodlike-server.sh start`.
- **Porta 3105 occupata**: `scripts/prodlike-server.sh stop`, altrimenti
  identifica il processo con `lsof` prima di toccare nulla.
- **Esiti stantii**: `.next-prod` è una build; dopo ogni modifica al codice
  rifai il passo 2 (la dist è rigenerabile, mai commitarla).
- **Query audit che fallisce**: la colonna è `actor` (non `actor_email`) in
  ENTRAMBI i gemelli.
- **DB in stato strano**: è disposable — riesegui il passo 1 e riparti
  pulito. Mai operazioni di reset fuori dal locale.

## Prova reale su produzione (dopo il deploy, ~1 min)

Impostazioni → **Tools → Free cache** → scegli i target → scrivi il motivo →
**Prepara la purga** → **Sì, svuota: …** → notice «Cache svuotata (…)» e
«Ultima purga: oggi». Traccia in Audit: riga `cache.purga` con attore,
target e motivo. In emergenza (sito bloccato dopo un deploy): purga
«Tutto il sito» dalla stessa scheda — è il motivo per cui il tool esiste.

## File dell'impianto

| File | Ruolo |
|------|-------|
| `scripts/e2e-db-reset.mjs` | drop+create DB E2E + tutte le migration |
| `scripts/prodlike-server.sh` | start/stop doppio fork su :3105 (log e pid in /tmp) |
| `playwright.prodlike.config.ts` | baseURL :3105, testMatch `prodlike-*`, workers 1 |
| `tests/e2e/prodlike-cache.spec.ts` | le 4 prove cache di questa checklist |
| `tests/e2e/prodlike-captcha.spec.ts` | le 6 prove captcha della stessa config |
| `.env.e2e` | DB E2E + chiavi Turnstile TEST (mai produzione) |
| `playwright.config.ts` | la routine E2E standard (porta dal percorso, prodlike escluse) |
| `scripts/e2e-dev-server.mjs` | il dev server E2E che il webServer di Playwright avvia |
| `scripts/e2e-port-guard.mjs` | globalSetup: fallisce se sulla porta ascolta un altro repo |
| `scripts/e2e-leak-guard.mjs` | globalTeardown: fallisce se resta una riga di prova nel DB |
