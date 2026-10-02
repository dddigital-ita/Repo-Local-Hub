# CHECKLIST — Attivazione captcha Turnstile in produzione

> Verifica eseguita il 27/09/2026 su build locale di produzione (`next start`
> con build webpack reale, DB E2E, chiavi di TEST Cloudflare): **6/6 prove
> superate** — login, chat, lead E password-dimenticata funzionano col
> captcha attivo, il token viene generato dal widget invisibile e allegato
> ai form, la catena verso `challenges.cloudflare.com/turnstile/v0/siteverify`
> risponde (secret errata → `success:false`, `invalid-input-secret`).

> **Nota attivazione password-dimenticata**: se le chiavi sono state salvate
> nella scheda Cloudflare DOPO l'ultimo deploy, la pagina
> `/admin/password-dimenticata` la legge al volo (dati dal DB): nessun
> redeploy necessario. Solo se usi la via env, il cambio chiave richiede il
> riavvio dell'app.

> **Come si legge**: questa checklist è raggiungibile anche dall'app,
> in sola lettura e sempre sincrona col repo — Impostazioni → Cloudflare →
> «Apri la checklist di attivazione» (`/admin/settings/cloudflare/checklist`,
> riservata agli admin).

## Perché è sicuro attivarlo

- **Fail-open giudizioso**: se l'API Cloudflare è irraggiungibile, le
  richieste passano (mai clienti veri bloccati) — la prima difesa resta
  Shield (rate limit + ban automatico su DB).
- **Niente falsi ban**: un token mancante (timing dello script lazy) è un
  403 che NON finisce nel contatore violazioni di Shield.
- **Zero attrito**: il widget è invisibile per tipo di sitekey e non passa
  nessuna opzione `size` all'API (che la rifiuterebbe): nessuna interazione
  per le persone; il form aspetta il token al massimo 5s prima di inviare.
- **Secret protetta**: cifrata AES-256-GCM sul DB, mai restituita al client
  (solo hint mascherato); se esistono anche le env, quelle vincono.

## 0 · PRE-DEPLOY OBBLIGATORIO — suite prodlike

> **Nessun deploy senza questo passaggio verde.** La suite prodlike
> (`playwright.prodlike.config.ts`) gira contro un server **BUILD** avviato
> a mano, cioè con lo stesso motore del deploy (`next start` su `:3105`,
> chiavi Cloudflare di TEST) — non contro il dev server, che non
> riproduce né il Flight serializer né le cache di produzione. È la rete
> di sicurezza delle release: se una di queste prove fallisce, **il deploy
> non esce**, si corregge e si rilancia. Le tre spec coperte sono
> `prodlike-captcha`, `prodlike-cache` e `prodlike-admin-skeleton`.

```bash
scripts/prodlike-server.sh stop               # 1. stop   — chiude un eventuale server precedente
node scripts/e2e-db-reset.mjs                 # 2. reset  — DB E2E pulito
npm run build:local                           # 3. build  — build di produzione in .next-prod
sh -c 'set -a; . ./.env.e2e; set +a; \
  WAC_DIST_DIR=.next-prod nohup node node_modules/next/dist/bin/next start -p 3105 \
  </dev/null >/tmp/wac-prodlike-server.log 2>&1 & echo $! > /tmp/wac-prodlike.pid'
npx playwright test --config playwright.prodlike.config.ts   # 4/5. start + test
scripts/prodlike-server.sh stop               # chiusura (kill dal pid file)
```

(`scripts/prodlike-server.sh start` fa gli stessi passi 4 in un colpo:
double-fork, env da `.env.e2e`, `WAC_DIST_DIR=.next-prod`.)

| Passo | Cosa deve tornare | Se fallisce |
|-------|-------------------|--------------|
| stop | `prodlike server fermato` | — |
| reset | `e2e db pronto: …` + `0 in errore` | il DB è in uso: chiudi il dev server e rilancia |

> Il reset è **igienico, non un prerequisito**: le spec prodlike ripuliscono
> il proprio stato (l.audit incluso — è append-only, la pulizia avviene
> dentro una transazione che ne rimuove la regola e la rimette subito), quindi
> la suite si può rilanciare sullo stesso DB per iterare. Tienilo quando cambi
> i dati di seed, non per ripetere una corsa.
| build | `Compiled successfully` + nessun errore di tipo | **niente deploy**: il typecheck fa parte del gate |
| start | `prodlike server: 200 su :3105` | leggi `/tmp/wac-prodlike-server.log` |
| test | **18 passed, 0 failed** (3 spec) | **niente deploy**: correggi e rilancia la suite |

Cosa prova, in sintesi: `prodlike-captcha` monta il widget su login,
pagine pubbliche e password-dimenticata, genera il token, completa il
login su build, apre la chat e chiama `siteverify`; `prodlike-cache`
percorre login → Tools → Free cache → 4 target → conferma a due fasi →
purgata → audit; `prodlike-admin-skeleton` verifica che gli skeleton di
caricamento non rompano login, hub e salvataggi.

## 1. Creare le chiavi sul pannello Cloudflare (~5 min)

1. Vai su <https://dash.cloudflare.com> → account → **Turnstile**.
2. **Add site**:
   - Nome: `WebAgencyCrema — produzione`
   - **Domini**: `webagencycrema.com` (e `www.webagencycrema.com`; aggiungi
     anche l'eventuale dominio di staging)
   - Widget Mode: **Invisible** — l'invisibilità dipende dal TIPO di
     sitekey, il widget non passa alcuna opzione `size` all'API
3. Copia i due valori generati:
   - **Site Key** (pubblica, inizia con `0x…`)
   - **Secret Key** (inizia con `0x…`) — *Cloudflare la mostra una volta:
     tenerla pronta per il passo 3.*

## 2. Al deploy: NESSUNA variabile d'ambiente nuova da impostare

Le chiavi di produzione **non** vanno in `.env.local`/env del pannello:
si inseriscono dalla scheda Cloudflare (Impostazioni) dopo il deploy
(passo 3) e restano sul DB.
Le env attuali (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
con le chiavi di TEST `1x000…`) restano com'ere: **attenzione** — finché
quelle env esistono, hanno priorità sulle chiavi salvate nella scheda
Cloudflare (la scheda lo indica con il badge «chiavi da environment (prioritaria)»).

**Scelta consigliata (una delle due):**

- **Via A — tutto dalla scheda Cloudflare (consigliata)**: al deploy rimuovi le due
  variabili Turnstile dall'ambiente di produzione (`.env.local` sul server
  o env del pannello), poi inserisci le chiavi reali dalla scheda
  Cloudflare (passo 3).
  Da lì le cambi senza mai toccare di nuovo il server.
- **Via B — solo env**: inserisci le chiavi reali come variabili d'ambiente
  e non usare la scheda Cloudflare (resta comunque visibile a solo lettura).
  Ogni cambio chiave richiederà un riavvio/redeploy.

## 3. Inserire le chiavi reali dalla scheda Cloudflare (~1 min)

1. Entra in `/admin` → **Impostazioni** → **Cloudflare (Turnstile)**.
2. Card **«Chiavi Turnstile»**:
   - *Site key (pubblica)*: incolla la Site Key;
   - *Secret key*: incolla la Secret Key;
   - **Salva chiavi captcha** → compare «Chiavi captcha salvate» e il
     badge della fonte attiva diventa «chiavi da Cloudflare (DB)».
3. **Prova verifica** (bottone in scheda): chiama `siteverify` di
   Cloudflare con la secret appena salvata usando il token fittizio
   ufficiale — con chiavi reali il verde arriva dal rifiuto del solo
   token, con le chiavi di test dall'accettazione. Esito atteso: banner
   verde «OK — La catena verso siteverify è viva e la secret è
   valida.» Banner ambra → la secret è errata o rifiutata: correggila
   prima di considerare attivo il captcha. L'esito resta tracciato in
   Audit (`cloudflare.test`) e come «Ultimo test» nella card Cloudflare
   dell'hub Impostazioni.
4. Verifica il badge **Attivo** nella scheda e nello stato in alto
   (la diagnostica resta su **Shield Security**).

## 4. Verifiche post-attivazione (5 minuti, in quest'ordine)

| # | Cosa | Come | Esito atteso |
|---|------|------|--------------|
| 1 | Login team | `/admin/login` → credenziali | Entra in `/admin` (mai «Verifica anti-bot non riuscita») |
| 2 | **Prova verifica** | Scheda Cloudflare → bottone «Prova verifica» | Banner verde «OK — La catena verso siteverify è viva e la secret è valida.»; ambra → secret errata (vedi passo 3.3) |
| 3 | Login sbagliato | password volutamente errata | «Credenziali non valide» (il captcha NON interfere) |
| 4 | Chat | `/consulenza` → chat si apre | Greeting visibile, nessun 403 `captcha_failed` |
| 5 | Lead | chat → percorso completo → invio | Lead salvato, notifica parte |
| 6 | Password dimenticata | `/admin/password-dimenticata` → email qualsiasi | Conferma neutra «Se questa email corrisponde…» (mai errore captcha) |
| 7 | Firewall personale | se il tuo IP/VPN è bloccato da Cloudflare | Prova da rete diversa prima di aprire un ticket |
| 8 | Audit | `/admin` → Audit | `cloudflare.turnstile_save` e `cloudflare.test` presenti |

Se il passo 1 mostra «Verifica anti-bot non riuscita: ricarica la pagina e
riprova» ripetutamente: controlla sul pannello Cloudflare che il
**dominio** sia quello giusto (passo 1.2) — è l'unica causa tipica.

## 5. Riga di credito (opzionale ma carino)

Turnstile è gratuito e senza limiti; se vuoi, in Impostazioni → footer puoi
menzionare «protezione Cloudflare». Non è richiesto dal servizio.

## Prove ripetibili (locale, build reale)

I comandi sono quelli dello **step 0 (obbligatorio)** — la stessa corsa
serve come verifica ripetibile dopo una correzione, senza rimettere
mano alla checklist:

```bash
scripts/prodlike-server.sh stop               # stop
node scripts/e2e-db-reset.mjs                 # reset
npm run build:local                           # build
scripts/prodlike-server.sh start              # start
npx playwright test --config playwright.prodlike.config.ts   # test
scripts/prodlike-server.sh stop               # chiusura (kill dal pid file)
```

La spec `tests/e2e/prodlike-captcha.spec.ts` verifica: widget montato su
login, pagine pubbliche e password-dimenticata, token generato (poll su
`window.wacTurnstile`), login riuscito su build, apertura chat con init
passato, richiesta di reset con risposta neutra, e siteverify di Cloudflare
raggiungibile dal runtime (secret corrotta → errore esplicito). Insieme a
`prodlike-cache` e `prodlike-admin-skeleton` forma la suite dello step 0.

## Ripristino d'emergenza

Per **disattivare** il captcha (es. Cloudflare down per ore, mai successo ma
per scrupolo): Impostazioni → Cloudflare → **Rimuovi config DB**. Con le env
di produzione assenti (via A) il captcha si spegne e il sito torna a
Shield-only, senza redeploy. Per rimuovere anche le env (via B): togli le due
variabili e riavvia.
