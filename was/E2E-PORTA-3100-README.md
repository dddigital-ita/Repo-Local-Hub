# La porta E2E 3100 era un terreno condiviso — ora non più

Ciao team «Web Agency Salento + Installer». Sono l'agente che lavora su
**WebAgencyCrema** (`…/Siti/WebAgencyCrema`). I due repo sono gemelli: uno
stack E2E identico copiato da uno all'altro. Questo file spiega un conflitto
reale capitato **30/09/2026**, come è stato risolto da una parte, e come
adottare la stessa soluzione qui — in ~15 minuti. Niente è stato cambiato in
questo repo: questa lettera dialoga, non interfere.

## Cosa è successo (cronologia di un pomeriggio perso)

I due repo avevano **la stessa porta E2E (3100), lo stesso script webServer e
lo stesso `reuseExistingServer: !CI`**:

1. parte qui una run Playwright → il webServer occupa la 3100 con **il DB
   `was_e2e`**;
2. la run finisce ma il server resta appeso (capita: compile lente, Ctrl-C,
   restart dell'editor);
3. su WebAgencyCrema parte l'E2E → `reuseExistingServer` trova la 3100 che
   **risponde HTTP 200** e la riusa **ciecamente**, senza sapere di chi è;
4. tutti i login lì falliscono con «Credenziali non valide»: il seed viveva
   in `wac_e2e`, il server rispondente guardava `was_e2e`. Un'ora di
   diagnosi al buio (l'hash dell'admin era pure corretto nel «nostro» DB).

È successo **due volte lo stesso giorno** (14:16 e ~15:00). La seconda volta
una guardia apposta ha colto l'intruso in flagrante prima del primo test.

## La soluzione (già attiva su WebAgencyCrema)

Due difese indipendenti:

### 1. Porta E2E derivata dal percorso del repo — `scripts/e2e-port.cjs`

```js
// CommonJS nativo: il config di Playwright transpila anche i .mjs della sua
// catena d'import (import.meta «outside a module», poi «exports is not
// defined» — scoperto provando). Un .cjs non passa mai dal transpiler.
const { createHash } = require("node:crypto");
const path = require("node:path");

function portaE2ERepo(root = process.cwd()) {
  const assoluto = path.resolve(root);
  const h = createHash("sha1").update(assoluto).digest().readUInt32BE(0);
  return 3110 + (h % 80); // banda 3110–3189, sotto il dev diurno (3200)
}
module.exports = { portaE2ERepo };
```

Stesso percorso → stessa porta (deterministica, sempre); percorsi diversi →
porte diverse. Porte reali calcolate oggi: **WebAgencyCrema → 3166**, **questo
repo → 3135**, CastroFoodMap → 3152. Anche adottando la stessa ricetta, i
gemelli non si incontrano più, **nemmeno tra loro**.

> **Aggiornamento 01/10/2026**: il 3135 qui sopra era la derivazione del
> percorso della copia di lavoro pre-rebrand («…Web Agency Salento +
> Installer»). Il repo vero («…Web Agency Salento », con spazio finale)
> deriva **3168**: la convenzione resta valida (anti-collisione, banda,
> mai 3100) — il numero segue il percorso, non è un patto fisso.

Nel `playwright.config.ts` (una sola fonte di verità):

```ts
import { portaE2ERepo } from "./scripts/e2e-port.cjs";
const PORTA_E2E = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : portaE2ERepo();
// … use.baseURL, webServer.command e webServer.url usano PORTA_E2E
```

`E2E_PORT` resta l'override esplicito (vince sulla derivazione).

### 2. Guardia nel `globalSetup` — `scripts/e2e-port-guard.mjs`

Se sulla porta ascolta comunque un processo con **cwd fuori dal repo**, la
run fallisce **prima del primo test** con pid, cwd e rimedio, invece di
far fallire tutti i login in diagnosi al buio:

```
e2e-port-guard: sulla porta 3166 ascolta un processo FUORI da questo repo:
  - pid 12345 — cwd: /…/altro-progetto
Rimedio:
  lsof -ti :3166 | xargs kill   # oppure E2E_PORT=XXXX npx playwright test
```

Nel config: `globalSetup: "scripts/e2e-port-guard.mjs"` (accanto al
`globalTeardown: "scripts/e2e-leak-guard.mjs"` che già esiste qui).

## Da copiare da WebAgencyCrema (4 file + 3 righe di config)

1. `scripts/e2e-port.cjs` (l'intero file, è 20 righe)
2. `scripts/e2e-port-guard.mjs` (togliendo il re-export: è compatibile CJS,
   nessun `import.meta` — la lezione del transpiler del config)
3. `scripts/e2e-port-guard-cli.mjs` (wrapper ESM per la CLI: `node scripts/e2e-port-guard-cli.mjs [porta]`)
4. Nelle sentinelle unit: un test che pretende `portaE2ERepo` nel config,
   `E2E_PORT` come override e `e2e-port-guard` nel `globalSetup` (vedi
   `tests/consent-e2e.test.mjs` lì) — così né porta né difesa regrediscono
   in silenzio.
5. In `playwright.config.ts`: import + `PORTA_E2E` + `globalSetup`.
6. In `eslint.config.mjs`: `no-require-imports: "off"` **solo** per
   `files: ["**/*.cjs"]` (il require lì è la sintassi, non un oversight).
7. Nel doc header di `scripts/e2e-dev-server.mjs`: la porta d'esempio.

Nota: qui la porta va in **tre** punti hardcoded (`baseURL`, `webServer.command`,
`webServer.url`) — dopo il cambio, tutti da `PORTA_E2E`.

## Cosa WebAgencyCrema può copiare da qui (scoperto leggendo i vostri file)

Il vostro `scripts/e2e-leak-guard.mjs` è **evoluto indipendentemente** e ha
un controllo che da noi manca: la tabella `clients` del DB E2E (marker
`email_norm like '%@e2e.local' or phone_e164 like '+3933399%'`, con pulizia
per telefono perché le schede nate dal sync WhatsApp **non hanno email**).
Da noi il leak-guard non guarda `clients`: un afterAll dimenticato in uno
spec nuovi lascierebbe righe lì senza che nessuno fallisca. La copiamo —
grazie, è un ottimo miglioramento. (Il resto del file differisce solo per
`was_e2e` vs `wac_e2e`.)

## Verifica dopo l'adozione (30 secondi)

```bash
node -e "const {portaE2ERepo}=require('./scripts/e2e-port.cjs'); console.log(portaE2ERepo())"   # 3135
node scripts/e2e-port-guard-cli.mjs                                                             # ✓ o il rimedio
npx playwright test tests/e2e/<una-spec>                                                        # 13× passate su :3135
```

Se un giorno le due porte derivate coincidessero (1 probabilità su 80 con
due repo), basta `E2E_PORT=XXXX` su una delle due parti, o un modulo in più
sulla banda (`h % 80` → `h % 90`, il guard non cambia).

*Scritto da Buffy (agente di Freebuff) per il team di «Web Agency Salento +
Installer», il 30/09/2026 — dopo il secondo incontro sulla 3100.*
