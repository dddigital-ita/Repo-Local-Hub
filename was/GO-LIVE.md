# GO-LIVE — online tra 3 ore (Web Agency Salento)

*Checklist temporizzata, pronta da eseguire nell'ordine. Riferimenti completi:
[NOTE-INSTALLAZIONE-WAS.md](NOTE-INSTALLAZIONE-WAS.md) (differenze vs guida
universale), [CHECKLIST-CAPTCHA-PRODUZIONE.md](CHECKLIST-CAPTCHA-PRODUZIONE.md)
(Turnstile). Dominio canonico: **www.webagencysalento.com** —
`was.dddigital.net` fa redirect 308 e non va indicizzato.*

## Cosa è già pronto (stato del 01/10/2026)

- ✅ **Online su Vercel** con dominio canonico `www.webagencysalento.com`
  (redirect 308 da `was.dddigital.net`, vedi `vercel.json`).
- ✅ **DB Neon** `webagencysalento`: schema + migration additive
  (`neon/schema.sql` + `npm run db:migrate`), DSN pooled su Vercel.
- ✅ **Turnstile produzione** (via A della checklist): chiavi reali dalla
  scheda Impostazioni → Cloudflare, nessuna env in produzione.
- ✅ **Cron /api/cron/tick** ogni 15 minuti: Vercel Cron (User-Agent
  dedicato) o Bearer `CRON_SECRET` da FastComet — entrambi validati.
- ✅ Wizard `/setup` escluso su Vercel: admin creato con `npm run admin:create`.

## T–3:00 → T–2:15 · Preflight e build

0. **Obbligatorio**: la destinazione è SEMPRE il dominio canonico
   `https://www.webagencysalento.com` (mai `dddigital.net`, mai l'apex).
   Verifica:
   ```
   node scripts/deploy-preflight.mjs https://www.webagencysalento.com
   ```
   Deve stampare «PREFLIGHT OK». Se fallisce: FERMO, vedi
   NOTE-INSTALLAZIONE-WAS §1.
1. `npm ci` se node_modules non è aggiornato, poi **`npm run build`** in
   locale: la build deve passare pulita prima di ogni push su main
   (Vercel pubblica il branch).
2. Typecheck e suite: `npx tsc --noEmit && npm test`. Le spec E2E
   toccate: `npx playwright test tests/e2e/<spec>.spec.ts`.

## T–2:15 → T–1:30 · Variabili d'ambiente (Vercel)

3. Le tre variabili minime su Vercel (progetto `webagencysalento`):
   - `DATABASE_URL` = stringa **pooled** Neon + `?sslmode=require`;
   - `NEXT_PUBLIC_SITE_URL` = `https://www.webagencysalento.com`;
   - `CRON_SECRET` = random ≥32 caratteri, MAI riusato da un altro sito.
4. Env opzionali per funzioni nuove (notify, Telegram, storage):
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_ENDPOINT_URL_S3`
     del branch Neon: attivano il **backup cloud giornaliero** (senza,
     resta spento e l'allarme della rete di sicurezza lo dirà).
5. Redeploy dopo ogni cambio env (le `NEXT_PUBLIC_*` viaggiano nel build).

## T–1:30 → T–0:45 · Verifiche sito

6. `https://www.webagencysalento.com/api/health` →
   `{"status":"ok","database":"ok"}`.
7. `node scripts/verify-deploy.mjs https://www.webagencysalento.com` →
   6/6 (home, consulenza, sitemap, robots, health, marker hero — con
   hero spento 5/6 è normale).
8. GDPR: banner cookie alla prima visita; privacy e cookie policy dal
   footer; consenso registrato.
9. Ricerca → chat: una ricerca sulla home apre `/consulenza?q=`, la chat
   qualifica e il lead compare in `/admin/tickets`.
10. Landing SEO (es. `/agenzia-web-lecce`): CTA e JSON-LD a posto,
    contenuti del Salento (mai riferimenti Crema).
11. Turnstile: login admin ok; un «Prova verifica» dall'hub captcha;
    audit con `cloudflare.*`.

## T–0:45 → T–0:15 · SEO e tracciamento

12. `/sitemap.xml` e `/robots.txt` citano SOLO `www.webagencysalento.com`.
13. Google Search Console: proprietà verificata + sitemap inviata
    (token da `/admin/tools/google`).
14. GA4/GTM: eventi `search_start` e `lead_saved` in DebugView.
15. Redirect 308 di `was.dddigital.net` attivo (curl -I → 308 verso www).

## T–0:15 · Ultimi 15 minuti

16. Svuota la cache dal tool **Free cache** (`/admin/tools/cache`) se hai
    appena cambiato contenuti via DB/import.
17. Ricontrolla `/admin` (login ok) e che `/setup` resti 404 su Vercel.
18. Annuncia il go-live: il primo lead che arriva è la prova che tutto
    funziona.

## Dopo il go-live (primi 7 giorni)

- **Backup cloud attivo**: al primo tick dopo la mezzanotte Roma il DB
  finisce su Neon Object Storage (bucket `backups`, retention 14, sha256
  verificato). Se tace 2 giorni, l'allarme suona via Telegram/email:
  configurare le credenziali notify per riceverlo.
- Cron ogni 15 min per SLA/follow-up/Ambrosio (NOTE-INSTALLAZIONE-WAS §5).
- Resend per le notifiche email: chiave `re_...` in env.
- Guarda in GA4 quale CTA converte di più: è il dato che decide dove
  rafforzare.
