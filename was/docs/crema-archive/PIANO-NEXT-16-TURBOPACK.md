# PIANO MIGRAZIONE NEXT 16 + TURBOPACK

> Stato: **GO FIRMATO — main su Next 16.3.6** (2026-09-27): Passo 2 completato e fuso
> da `upgrade/next-16` (fast-forward a `0abd0d0`), deploy pronto su webpack con
> Turbopack dietro comando. In corso il Passo 3 (staging). **Baseline payload reale
> main: 238,4 kB gzip (15.5.26 webpack) — misura unica `scripts/measure-payload.mjs`.**
> Confronto apples-to-apples: 16.3.6 webpack **197,3 kB (−17%)**, Turbopack ~270 kB
> (+13% sul vero baseline, non +80% come suggerito dal vecchio confronto
> metrica-vs-misura). Dati del trial 15.5 in §2; numeri della 16 nel CHANGELOG
> «Next 16.3.6 su branch dedicato» e «Baseline 15.5.26 misurato».

---

## 1. Cosa è stato già fatto (fase 0 — questa preparazione)

| Debito Next 16 | Stato prima | Azione |
|---|---|---|
| `next lint` rimosso in 16 | `"lint": "next lint"` SENZA config ESLint né dipendenza: il linter non girava mai | **ESLint 9 + `eslint-config-next@15.5.4`** con config flat `eslint.config.mjs`, script `"lint": "eslint ."`, preset core-web-vitals + typescript, convenzione `_` per i parametri volutamente inutilizzati, fixture del guard overlay escluse |
| Debito lint accumulato (mai girato) | 15 errori + 26 warning | **Azzerato**: 5 `<a>` interni convertiti a `<Link>` (consent, cookie-policy, consulenza, configurazione AI), 8 apostrofi escapati, `useQuickFaq` rinominato `applyQuickFaq` (nome "use" che non è un hook: violazione rules-of-hooks), 26 import/variabili morti rimossi |
| `legacyBehavior` su `<Link>` | assente dal codice | nulla da fare ✓ |
| AMP | assente | nulla da fare ✓ |
| `quality` su `next/image` fuori default | assente | nulla da fare ✓ |
| Flag experimental deprecati in config | nessuno | nulla da fare ✓ (config `next.config.ts` minimal, commentata, già pronta) |
| Supervisione regressioni | lint solo locale | **lint aggiunto a CI** (`.github/workflows/overlay-guard.yml`, prima del guard e dei test) e al **pre-push hook** |

Verifiche post-fase 0: `npm run lint` pulito (0 errori, 0 warning) · typecheck ✓ ·
128/128 test ✓ · pre-push hook eseguito manualmente: verde.

---

## 2. I numeri del trial Turbopack (perché il deploy resta su webpack per ora)

Benchmark su Apple M4 Pro (12 core), entrambi i bundler con cache persistente a regime:

| Metrica | Webpack | Turbopack beta |
|---|---|---|
| Build a freddo (guard incluso) | 19,7s | 13,6s (−31%) |
| Build a caldo | 16s | 13s (−19%) |
| **First Load JS condiviso** | **102 kB** | **198 kB** (182 kB JS) — ~+80% |
| Route table (65 route, static/dynamic split) | — | identica ✓ |
| Output servito + valori calcolati a schermo | — | identici ✓ |
| `WAC_DIST_DIR` (distDir custom) | ✓ | ✓ rispettato (verificato su FS) |

Conclusione del trial: il **+80% di JS condiviso** è un regresso su ogni visitatore,
per risparmiare 3 secondi di build. Il deploy resta su webpack fino a Next 16.

---

## 3. Il percorso: quattro passi, ognuno verificabile

### Passo 1 — Upgrade 15.5.4 → ultima 15.x — ✅ COMPLETATO 2026-09-27
Eseguito: `next@15.5.26` (ultima 15.x stabile) + `npm audit fix` non-forzato
(sharp 0.35.4 aggiornato; residuo 6 vulnerabilità tutte dentro next/postcss,
solo risolvibili con la 16 = Passo 2). Verifiche: lint 0/0, typecheck ✓,
128/128 test, guard ✓, build:local ✓ (103 kB), `next start` prod con le rotte
chiave 200, boot dev webpack 200, **zero deprecation warning** in build e dev.
Soddisfatto il criterio d'uscita.

### Passo 2 — 15.x → 16 su branch dedicato — ✅ COMPLETATO 2026-09-27 (branch `upgrade/next-16`, non fuso)
Eseguito: `next@16.3.6` + `@next/third-parties@16.3.6` (React 19.3.0 ok). La tabella
**First Load JS non esiste più in 16**: creato `scripts/measure-payload.mjs` (payload
gzip reale servito = sostituto permanente della metrica, base della sorveglianza del
Passo 4). Numeri misurati (home `/`, gzip): **Turbopack 16 ≈ 270 kB** (239 JS + 16 CSS
+ 16 HTML) contro **webpack 16 ≈ 198 kB** (166 JS) — il gap di ottimizzazione non è
chiuso ma il **paracadute `--webpack` funziona su 16**, quindi l'upgrade NON è più
bloccato dal bundle: si parte col deploy su webpack e si migra a Turbopack quando il
divario si chiude (o si accettano i 270 kB in cambio di build a caldo da 6s, compile
572ms: la cache persistente è arrivata). Route table identica (65) su entrambi.
Porting: flat config nativa di eslint-config 16, 10 errori dalle nuove regole React
Compiler (3 file corretti in modo meccanico — purity e ref nel render —, pattern di
mount preesistenti abbassati a warning tracciati con baseline = 10), deprecation
warning nuove (middleware→proxy, Edge→Node) schedulate, `jsx: react-jsx` mandatory.
Bonus sicurezza: **le 6 advisory postcss dentro next sono chiuse** (audit residuo: 3
advisory in `@hono/node-server`, ortogonali a Next). Verifiche: lint 0 errori,
typecheck ✓, 128/128 test ✓, guard ✓, build Turbopack E webpack ✓, `next start` 200
su home/consulenza/health.
2. **Attese documentate**:
   - `next build` ora gira su **Turbopack di default**: il First Load salverà a ~198 kB
     (trial) — accettabile SOLO se la 16 stable ha chiuso il gap di ottimizzazione
     bundle; misurare PRIMA di giudicare (`npm run build` e confronto con la tabella §2).
   - `next lint` non esiste più: già migrato (fase 0), nessuna azione.
   - La lint automatica in build è rimossa in 16: nessun impatto (non ne dipendiamo).
   - `next/image`: `quality` accetta solo 75 di default — qui non usato, verificare che
     non compaia nei warning.
   - View Transitions: la 16 porta il flag `viewTransition` sperimentale di Next; il repo
     usa l'API nativa del browser via `<ViewTransitions />` — NON migrare: l'API nativa
     resta la via più robusta (convenzione «next.config.puro»).
3. **Criterio di uscita**: lint + typecheck + 128 test + guard + build:local verdi;
   smoke `next start` con le rotte §Passo 1; confronto bundle annotato nel CHANGELOG.
4. Se il gap bundle non è chiuso: valutare `build --webpack` (flag ancora disponibile
   in 16) come paracadute, mantenendo Turbopack in dev.

### Passo 3 — Staging su Next 16 con bundler webpack, Turbopack quando i numeri lo dicono — IN CORSO (go firmato 2026-09-27, main fuso)
1. ✅ `upgrade/next-16` fuso su main (fast-forward a `0abd0d0`) dopo gate completo:
   lint 0 errori, typecheck, 128/128 test, guard, `build:local` exit 0. Gli script
   portano la strategia: `build`/`build:local`/`dev` su **webpack** (paracadute
   divenuto default), `build:turbo`/`dev:turbo` per Turbopack (build a caldo da 6s
   quando il gap JS si chiude).
2. Progetto su Vercel: il repo è locale senza remote — collegare GitHub (SETUP.md
   PARTE 2.B–C) o usare Vercel CLI. Env da SETUP.md PARTE 2.C. `vercel.json` contiene
   solo i cron e NON tocca la build: Vercel eredita `npm run build`, che ora include
   `--webpack`.
3. Primo deploy = **staging** (dominio NON collegato): verificare con
   `node scripts/verify-deploy.mjs https://<deployment>.vercel.app` (rotte chiave,
   health con DB, marker hero) e `node scripts/measure-payload.mjs https://<url>`
   (atteso ~198 kB gzip).
4. Go produzione: collegare `webagencycrema.com` e osservare il cron `/api/cron/tick`
   (*/15 su vercel.json) per un ciclo completo.
5. Switch Turbopack dietro scelta deliberata: il vero prezzo è **+13% (32 kB)** sul
   baseline reale di 238,4 kB — non il +80% del confronto sbagliato. Togliere
   `--webpack` da build/start, misurare con measure-payload e confrontare prima
   di pubblicare.
6. Rollback: ripristinare `--webpack` esplicito, o revert del commit di switch.

### Passo 4 — Dopo la migrazione (backlog, non bloccante)
- Rimuovere la convenzione «script separati» e riunificare i comandi.
- Valutare `turbopackFileSystemCacheForDev` (default true) e eventuali `turbopack.*`
  di configurazione solo a bisogno reale.
- Sorveglianza bundle: **`scripts/measure-payload.mjs` è pronto** (sostituto della
  tabella First Load rimossa in 16); da inserire in CI a ogni release una volta che
  il deploy è attivo.

---

## 4. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| Regressione bundle con Turbopack default | **Misurato al Passo 2**: Turbopack 16 ≈ 270 kB vs webpack 16 ≈ 198 kB (gap non chiuso ma accettabile col paracadute); `scripts/measure-payload.mjs` misura a ogni rilascio |
| Ordine CSS diverso (doc Turbopack) | CSS globale unico in `globals.css`: verificato senza impatti; i test di contrasto/sentinelle leggono il sorgente, non l'output |
| Precisión decimale CSS (Lightning CSS, 5 vs 10 cifre) | Le animazioni del design system non dipendono da precisione critica; verifica visiva nel browser al Passo 2 |
| Breaking change non coperti da questo piano | Il codemod ufficiale + i deprecation warning già silenziosi in 15.5 (nessuno emerso nei build del trial) |
| Hook pre-push blocca il push durante l'upgrade | `git push --no-verify` documentato nel sorgente dell'hook, per emergenza cosciente |

## 5. Cosa NON fare

- Non attivare flag sperimentali di Turbopack (module fragments, scope hoisting custom)
  finché non c'è un problema misurato — la config resta pura.
- Non migrare le View Transitions al flag Next: l'API nativa è una scelta deliberata.
- Non saltare il Passo 1: l'ultima 15.x è il trampolino con i warning più parlanti.
