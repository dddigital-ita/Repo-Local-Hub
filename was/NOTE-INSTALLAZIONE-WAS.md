# NOTE-INSTALLAZIONE-WAS — differenze rispetto alla guida universale

> **Per chi installa (Codex)**: parti dalla **Guida universale di
> pubblicazione DDDigital** (passi 1–7 restano validi: repo GitHub →
> Neon → Vercel → FastComet DNS → cron → verifiche). Questa nota elenca
> **SOLO ciò che cambia per Web Agency Salento (WAS)**. In caso di
> conflitto, vince questa nota per gli ambiti che copre.
>
> **Aggiornamento 01/10/2026 — dominio canonico per la SEO**: il sito è
> online su **`https://www.webagencysalento.com`** (CNAME `www` →
> valore Vercel, apex e MX/posta di `webagencysalento.com` intatti).
> `was.dddigital.net` resta collegato a Vercel ma fa **redirect 308** verso
> `www` (vedi `vercel.json`): non va indicizzato. Dove questa nota dice
> «`was.dddigital.net`» leggi il dominio canonico `www.webagencysalento.com`;
> la tabella del §1 descrive l'impostazione iniziale, ora superata.
> Il wizard `/setup` è **escluso su Vercel** (`setupState()` in
> `src/lib/setup.ts` restituisce «completed» se `process.env.VERCEL`): l'admin
> si crea con `npm run admin:create` e lo schema con `neon/schema.sql` +
> `npm run db:migrate`. Da riparare prima di riattivarlo.
>
> **Convenzione naming dddigital**: questo sito è **WAS**. Un eventuale
> sito specchio per Bari sarà **WAB**, e così via: ogni città ha repo,
> progetto Neon, progetto Vercel e dominio propri. Nessuna risorsa
> condivisa.

## 1. Dominio: sottodominio, NON dominio proprietario

La guida assume un dominio proprio (`<slug>.com` con www + apex e
redirect 308). **WAS no**: vive su un sottodominio del dominio
principale dell'account.

| Guida universale | WAS |
|---|---|
| Domini Vercel: `www.<slug>.com` (primario) + `<slug>.com` | **Solo `was.dddigital.net`** (niente `www.was.…`, niente apex) |
| DNS FastComet: zona propria, A radice + CNAME www, redirect 308 | **Un solo record**: CNAME `was` → `cname.vercel-dns.com` (o il record esatto che Vercel mostra al collegamento del dominio) |
| MX/ns da non toccare per il nuovo dominio | **Mai toccare NULLA di `dddigital.net`**: record radice, www, MX, posta, nameserver. Si aggiunge SOLO il record del sottodominio `was` |

Il guardia-fottole resta nel repo: `scripts/deploy-preflight.mjs`
**rifiuta** qualsiasi destinazione che sia il dominio principale o senza
i marker attesi. Eseguirlo SEMPRE prima di dichiarare il deploy valido.

## 2. Neon: progetto `webagencysalento`

- Project name: **`webagencysalento`** (leggibile, allineato al sito).
- **`DATABASE_URL` su Vercel = stringa POOLED** con `?sslmode=require`
  (come da guida).
- Le migration del repo (`neon/migrations/`, additive e idempotenti)
  sono **additive sopra uno schema di base** che su un progetto Neon
  vergine va applicato prima, poi le migration:
  ```bash
  export DATABASE_URL="<stringa DIRETTA di Neon, non pooled>"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f neon/schema.sql   # base
  npm run db:migrate                # poi migration (prima: -- --dry-run)
  ```
  (la variabile da ambiente vince su `.env.local`: il comando colpisce
  esattamente il DB indicato — verificato in `db-migrate-all.mjs`).
- **Vietato**: `scripts/e2e-db-reset.mjs` (fa DROP del database: è solo
  per l'E2E locale) e `scripts/db-migrate-neon.sh` (serve per un altro
  scenario: copia Neon → server Passenger, non per l'installazione).

## 3. Turnstile: dominio giusto, mai il principale

La checklist [CHECKLIST-CAPTCHA-PRODUZIONE.md](CHECKLIST-CAPTCHA-PRODUZIONE.md)
è già aggiornata per WAS; i punti che contano:

- Sito Cloudflare: «**WebAgencySalento — produzione**».
- **Domini: `www.webagencysalento.com`** (e `was.dddigital.net`, che
  fa solo redirect) — **NON aggiungere
  `dddigital.net`** (il captcha coprirebbe il sito principale).
- Nessuna env Turnstile in produzione: si usi la **via A** della
  checklist (env di test rimosse, chiavi reali dalla scheda
  Impostazioni → Cloudflare, sempre modificabili senza redeploy).

## 4. Variabili Vercel (3, come la guida)

| Nome | Valore |
|---|---|
| `DATABASE_URL` | stringa pooled Neon di `webagencysalento` + `?sslmode=require` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.webagencysalento.com` (già così in `.env.example`) |
| `CRON_SECRET` | nuovo, random, ≥32 caratteri — **non riusare** quello di un altro sito |

Nota email: `NEXT_PUBLIC_AGENCY_EMAIL` in `.env.example` è marcata
«DA CONFERMARE» — decidere l'indirizzo (posta ospitata su FastComet per
dddigital.net) **prima** del go-live.

## 5. Cron `/api/cron/tick` — già validato su questo codice

Ogni 15 minuti, come da guida. Il route accetta **entrambi** i percorsi
(verificati in locale su build di produzione):

- **Vercel Cron**: riconosce lo User-Agent `vercel-cron/1.0` — basta
  configurarlo dalla dashboard, nessuna chiave da passare.
- **Cron manuale (es. da FastComet)**: `Authorization: Bearer
  $CRON_SECRET` — il segreto DEVE essere identico alla variabile Vercel.

Test rapido dopo il deploy:
```bash
curl -s https://www.webagencysalento.com/api/health     # {"status":"ok","database":"ok",…}
curl -s https://www.webagencysalento.com/api/cron/tick  # atteso 401 senza chiave
```

## 6. Verifiche post-install (in quest'ordine)

1. `node scripts/deploy-preflight.mjs https://www.webagencysalento.com` → deve
   **passare** (dominio ≠ dominio principale vietato, nessun WordPress).
2. `node scripts/verify-deploy.mjs https://www.webagencysalento.com` → 6/6
   (home, consulenza, sitemap, robots, health, marker hero). Il marker
   `data-template=` compare **solo con l'hero animato acceso** dall'admin
   (default spento, vedi `src/app/page.tsx`): con hero spento 5/6 è normale.
3. Checklist captcha, passo 4 (login, prova verifica, chat, lead,
   password dimenticata, audit `cloudflare.*`).
4. Un giro dell'admin: login, inbox ticket, leads — su DB di produzione.

## 7. Vietativi (riepilogo)

- Mai toccare DNS, nameserver, posta o WordPress di `dddigital.net`:
  solo il record del sottodominio `was`.
- Mai `e2e-db-reset` o strumenti di test contro il Neon di produzione.
- Mai segreti in chiaro in guide/chat/repo; mai riusare il `CRON_SECRET`
  di un altro sito.
- Mai nomi del gemello (webagencycrema) in risorse nuove: tutto ciò che
  si crea dice **WAS / webagencysalento / www.webagencysalento.com**.
- Mai toccare apex, MX, SPF/DKIM di `webagencysalento.com`: solo il
  record `www`.
