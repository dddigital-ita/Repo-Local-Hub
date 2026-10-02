# Deploy su cPanel con Node.js App + PostgreSQL — Guida completa

> ⚠️ **REGOLA DI ORO — leggi prima di qualunque deploy**
> Il 28/09/2026 l'app è stata registrata sul **dominio principale** di un
> account cPanel condiviso: Passenger ha intercettato tutto il traffico e ha
> reso offline il sito WordPress in `public_html` (`www.dddigital.net`).
> Da quel giorno vale una regola sola:
>
> **L'app NON si deploya MAI sul dominio principale o su `public_html`.**
> **Destinazione unica ammessa: un SOTTODOMINIO dedicato** (es. `wac.dddigital.net`)
> **con docroot PROPRIO**, creato apposta in cPanel → Domains.
>
> Prima di qualunque registrazione su Setup Node.js App, esegui:
> ```
> node scripts/deploy-preflight.mjs https://wac.tuodominio.com
> ```
> Exit 0 = puoi procedere. Exit 1 = FERMO: destinazione vietata o non verificata.
>
> Le guardie a runtime — **boot guard in `server.js`** e **guardia nel wizard**
> (`src/lib/setup.ts`) — fanno l'ultimo controllo: se l'app finisse comunque in
> una docroot di WordPress, si rifiuta di partire/installare con un log chiaro
> sul pannello. Sono coperte dai test in `tests/deploy-guards.test.mjs`.

*Tempo richiesto: ~45 minuti la prima volta. Server: cPanel con «Setup Node.js App» (Passenger) e PostgreSQL. Istruzioni verificate con l'operatore FastComet (28/09/2026).*

### Dati specifici FastComet (da operatore, 28/09/2026)
- Pannello via **https://cloud.fastcomet.com** → Databases → **PostgreSQL Databases**
- Database, utente e permessi si creano lì; gestione visiva tabelle con **phpPgAdmin** (stessa sezione)
- Parametri di connessione per l'app:
  - Hostname: **`localhost`** · Porta: **`5432`**
  - Username/Password: quelli creati in cPanel
  - Database name: il nome **completo con prefisso cPanel** (es. `dddigita_wacapp` — il prefisso è il nome utente dell'account)
- Nella connection string del wizard quindi:
  `postgresql://dddigita_utentedb:PASSWORD@localhost:5432/dddigita_wacapp`

---

## PARTE 0 — Cosa prepari PRIMA (solo pannello, ~15 min)

### A. Database PostgreSQL
1. cPanel → **Databases → PostgreSQL Database Wizard**
2. Nome database (es. `utente_wacapp`) → **Create Database**
   - ⚠️ NON toccare i database MySQL esistenti dell'account: sono dei WordPress.
     L'app usa solo PostgreSQL e il suo DB dedicato creato qui.
3. Nome utente + password FORTE (annotale!) → **Create User**
4. **All Privileges** all'utente sul database → **Next** → fine
5. (Solo se il server ha PostgreSQL < 13) phpPgAdmin → query: `CREATE EXTENSION pgcrypto;`
   — il wizard lo tenta da solo e ti dice solo se proprio non ce la fa.

### B. Sottodominio dedicato (obbligatorio)
1. cPanel → **Domains** → **Create A New Domain** (o Subdomains)
2. Sottodominio: **`wac.tuodominio.com`** — MAI il dominio principale
3. **Document root**: la cartella proposta dall'utente, p.es.
   `/home/UTENTE/wac-tuodominio-com` — verificare che **NON sia `public_html`**
   né dentro `public_html`
4. **Nota anti-incidente**: se il dominio principale ha già WordPress alla root,
   creare un sottodominio con docroot dedicato non tocca nulla del sito
   esistente: PHP continua a girare sul dominio principale, Node sul
   sottodominio. Mai mescolarli nella stessa cartella.

> **Convenzione di naming** — un sottodominio PER PROGETTO, col nome del
> progetto, mai un generico `app.`: i progetti futuri avranno il loro
> (`progetto2.tuodominio.com`, `progetto3.…`), ognuno con docroot propria e
> la propria app Node registrata in cPanel. Mai due progetti sullo stesso
> sottodominio, mai il riuso di una docroot esistente.

### C. Node.js App — SOLO DOPO il preflight
1. Esegui il preflight (deve dare exit 0; se il DNS non risolve ancora,
   crea prima il sottodominio e riprova tra qualche minuto):
   ```
   node scripts/deploy-preflight.mjs https://wac.tuodominio.com
   ```
2. cPanel → **Software → Setup Node.js App** → **Create Application**
3. **Application URL: il SOTTODOMINIO** creato al punto B
   (mai il dominio principale: è la voce che ha causato l'incidente)
4. Node.js version: **la più recente disponibile** (idealmente 20+; Next 16 vuole Node ≥ 20.9)
5. Application mode: **Production**
6. Application root: la cartella del sottodominio (es. `wac-tuodominio-com`)
7. Application startup file: **`server.js`** ← punto d'ingresso già preparato
8. **Create**. Non avviare ancora: manca il codice.

---

## PARTE 1 — Caricamento del codice

### Via Git (consigliato)
Nel pannello: **Files → Git™ Version Control** → Clone: URL del repo →
la cartella **del sottodominio** (es. `wac-tuodominio-com`).
(Se il repo è privato, aggiungi prima la deploy key che cPanel ti mostra.)

### Via file manager / FTP (alternativa)
Carica lo zip del progetto (SENZA `node_modules` e SENZA `.next`) nella cartella
del sottodominio ed estrailo.

> ⚠️ La cartella di destinazione è **solo quella del sottodominio**.
> Se per errore ti trovi a caricare in `public_html`, FERMATI: quello è il
> dominio dei WordPress.

---

## PARTE 2 — Installazione delle dipendenze

1. Torna su **Setup Node.js App** → la tua app
2. Pannello in alto: **Run NPM Install** (usa il Node giusto e le env dell'app)
3. Attendi (~2-4 min)

---

## PARTE 3 — Build

Il pannello non esegue `npm run build`. Due opzioni:

### Opzione A — dal terminale del pannello (se la voce "Terminal" esiste)
```
source /home/UTENTE/nodevenv/wac-tuodominio-com/20/bin/activate && cd /home/UTENTE/wac-tuodominio-com
npm run build
```
(`UTENTE` e `20` cambiano: il comando esatto completo lo mostra il pannello sopra "Enter virtual environment")

### Opzione B — build in locale, upload della .next
Sul tuo computer:
```
npm ci && npm run build
```
Poi carica via FTP/File Manager: `.next/`, `public/`, `package.json`, `server.js`,
`neon/`, `src/` (necessaria: la build la referenzia), `next.config.ts` — la
cartella `.next` è quella che manca all'appello sul server.
**Destinazione: solo la cartella del sottodominio.**

> Nota: se il pannello dà memory limit error durante `npm run build`, usa l'opzione B (build locale) — è la più affidabile su hosting condivisi.

---

## PARTE 4 — Il wizard d'installazione (stile WordPress)

1. Da Setup Node.js App: **Start** (o Restart) dell'applicazione
2. Apri `https://wac.tuodominio.com/setup`
3. **Passo 1**: leggi e clicca "Iniziamo"
4. **Passo 2 — Database**: incolla la connection string
   `postgresql://utente_db:password@localhost:5432/nome_database`
   → **Verifica la connessione** (vedrai versione PostgreSQL, database e utente)
5. **Passo 3**: indirizzo sito (`https://wac.tuodominio.com`), email e password del super admin
6. **Passo 4**: **Avvia l'installazione** — guarda il log:
   - ✚ migration applicate / ✓ già a posto (idempotenti: nessun rischio se rilanci)
   - Super admin creato (ruolo super_admin, attivo)
   - `.env.local` scritto con `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `ADMIN_SESSION_SECRET`
   - Lock di completamento scritto
7. **Setup Node.js App → Restart** (obbligatorio: Next deve leggere le env nuove)

### Cosa fa il wizard (tecnicamente)
- Testa il DSN con timeout 8s e messaggi d'errore tradotti (28P01 = password errata, 3D000 = db inesistente, …)
- Esegue le 32 migration di `neon/migrations/` con statement-splitter compatibile `do $$…$$`, tracciamento `schema_migrations` e backfill per i `CREATE RULE` senza IF NOT EXISTS (010, 024) — stessa logica di `npm run db:migrate`
- Crea il super admin con `hashPassword` (scrypt) di `src/lib/admin.ts`
- Scrive `.env.local` (chmod 600 best effort) e conserva un eventuale `ADMIN_SESSION_SECRET` preesistente
- Scrive `setup_lock` su DB + `.setup-completed` su disco → il layout di `/setup` fa 404 per sempre

### Reinstallare / ripartire da zero
- Nuovo DB o stessa macchina: cancella `setup_lock` (phpPgAdmin: `DROP TABLE setup_lock;`) e il file `.setup-completed` nella root → il wizard torna raggiungibile e le migration, essendo tracciate, non vengono rieseguite dove già a posto.

---

## PARTE 5 — DNS e HTTPS

1. cPanel → **Domains**: verifica che `wac.tuodominio.com` sia assegnato alla
   **cartella del sottodominio** (docroot proprio) — MAI a `public_html`
2. Se il dominio è registrato altrove: puntalo ai nameserver dell'hosting, oppure record
   `A app → IP del server` (l'IP è in cPanel, scheda General Information)
3. cPanel → **SSL/TLS Status** → **Run AutoSSL**: certificato Let's Encrypt automatico
4. Attendi propagazione DNS (da 5 min a qualche ora)

---

## PARTE 6 — Verifiche post-installazione

Apri in ordine:
- [ ] `https://wac.tuodominio.com` — home con hero dal database
- [ ] `https://wac.tuodominio.com/api/health` — `{"status":"ok","database":"ok"}`
- [ ] `https://wac.tuodominio.com/admin` — login col super admin
- [ ] `https://wac.tuodominio.com/setup` — deve dare **404** (wizard chiuso)
- [ ] Chat: invia un messaggio di prova → il lead finisce nella dashboard
- [ ] `/sitemap.xml` e `/robots.txt` — citano il sottodominio vero
- [ ] **`https://www.tuodominio.com` — il sito WordPress PRINCIPALE funziona ancora** ← verifica obbligatoria: è esattamente il check che il 28/09 mancava
- [ ] Gli altri due WordPress su eventuali sottocartelle/domini aggiuntivi funzionano ancora

Script di verifica completo del repo (per l'app):
```
node scripts/verify-deploy.mjs https://wac.tuodominio.com
```

---

## PARTE 7 — Dopo essere online

### Email di notifica (Resend)
Il wizard le lascia a commento in `.env.local`. Quando hai la chiave `re_...`:
- via pannello: Setup Node.js App → Environment Variables (aggiungile lì, così sopravvivono a un eventuale re-install), oppure
- via file manager: modifica `.env.local` → decommenta RESEND_API_KEY, NOTIFY_EMAIL, EMAIL_FROM → Restart

### Cron (SLA, follow-up lead, Ambrosio)
Vercel non c'è più: chiama l'endpoint del cron ogni 15 minuti.
- cPanel → **Advanced → Cron Jobs** → Every 15 minutes:
```
curl -s https://wac.tuodominio.com/api/cron/tick > /dev/null
```
(Se la rotta la proteggi con un token, aggiungi l'header giusto — vedi `src/app/api/cron/tick/route.ts`.)

### Backup
Il progetto ha `npm run backup` (`scripts/backup-full.mjs`). Su cPanel programma un cron giornaliero:
```
cd /home/UTENTE/wac-tuodominio-com && /home/UTENTE/nodevenv/wac-tuodominio-com/20/bin/npm run backup
```

### Ritorno a Vercel (se un giorno cambi idea)
La connection string PostgreSQL resta la stessa: basta portare il DB (pg_dump/restore) o lasciarlo dov'è se il tuo hosting espone Postgres pubblicamente — e puntare `DATABASE_URL` al nuovo host.

---

## Risoluzione problemi

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| **Il sito WordPress principale non risponde dopo il deploy** | app registrata sul dominio principale (l'errore del 28/09) | Setup Node.js App → **elimina l'app**; il restore WordPress non serve se i file sono intatti |
| **Log dell'app: «AVVIO RIFIUTATO — cartella vietata / WordPress»** | boot guard di `server.js`: l'app è registrata in `public_html` o in una docroot WP | NON forzare: sposta l'app in un sottodominio dedicato (Parte 0). Forzatura solo consapevole: env `WAC_ALLOW_ANY_DOCROOT=1` |
| **Wizard: «Installazione rifiutata: docroot non sicura»** | guardia del wizard (stessa regola, lato installazione) | come sopra: sottodominio dedicato prima di rilanciare `/setup` |
| 503 o pagina Passenger default | app non parte | log: Setup Node.js App → **Log** (in alto a destra); spesso è build mancante o Node versione sbagliata |
| Preflight fallisce su ENOTFOUND | sottodominio non ancora creato / DNS in propagazione | crea il sottodominio in cPanel → Domains, attendi e rilancia |
| `/setup` dà 404 subito | wizard già completato | voluto: vedi «Reinstallare» sopra |
| probe DB fallisce con 28P01 | password utente DB errata | ricrea l'utente col Wizard |
| probe DB fallisce con 3D000 | nome database errato | verifica col pannello |
| «gen_random_uuid non disponibile» | PostgreSQL < 13 senza pgcrypto | phpPgAdmin → `CREATE EXTENSION pgcrypto;` |
| Migration in errore su «rule» | file 010/024 su schema preesistente | innocuo: il wizard li registra (backfill) e prosegue |
| Home senza hero / admin dice DB non configurato | restart non fatto dopo il wizard | Setup Node.js App → Restart |
| 413 su upload o timeout | limiti hosting condiviso | valuta i limiti del piano; per file pesanti usa storage esterno |
