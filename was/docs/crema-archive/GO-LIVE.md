# GO-LIVE — online tra 3 ore

*Checklist temporizzata, pronta da eseguire nell'ordine. Riferimenti completi: `DEPLOY-CPANEL.md` (deploy), `SETUP.md` (variabili ambiente).*

## Cosa è già pronto nel codice (fatto oggi)

- ✅ **Numero del sito = Michele** (`+393202792782`, anche WhatsApp) — header con SOLO il bottone WhatsApp in alto a destra; telefono nel footer, nello sticky mobile, nell'hero, nelle landing e nelle CTA finali. Se il numero cambia: `NEXT_PUBLIC_AGENCY_PHONE` in env (i placeholder «000» vengono ignorati dal codice).
- ✅ **Footer**: via e P.IVA eliminate; contatti diretti (tel + WhatsApp + email + orari), link rapido alla chat e brand line «a branch by DDDigital».
- ✅ **CTA extra**: WhatsApp nel hero, nella CTA finale e nelle landing; sticky mobile con due bottoni (WhatsApp + Chiama).
- ✅ **Flipbox** «Perché i clienti ci chiamano» (3 schede, retro al hover/tap, ok con reduced-motion).
- ✅ **FAQ home**: +2 domande (contatto diretto, zone servite), JSON-LD FAQ aggiornato di conseguenza.
- ✅ **JSON-LD LocalBusiness**: `sameAs` → wa.me del numero principale.

## T–3:00 → T–2:15 · Preflight, build e caricamento

0. **Obbligatorio, lezione del 28/09/2026**: la destinazione è SEMPRE un
   sottodominio dedicato (es. `wac.tuodominio.com`), MAI il dominio principale o
   `public_html` (lì vivono i WordPress). Verifica:
   ```
   node scripts/deploy-preflight.mjs https://wac.tuodominio.com
   ```
   Deve stampare "PREFLIGHT OK". Se fallisce: FERMO, vedi DEPLOY-CPANEL Parte 0.
1. `npm ci` se node_modules non è aggiornato, poi **`npm run build`** in locale (su cPanel la memoria spesso non basta: è la via consigliata, vedi DEPLOY-CPANEL Parte 3B).
2. Carica via FTP/File Manager su cPanel nella cartella **del sottodominio**: `.next/`, `public/`, `package.json`, `server.js`, `neon/`, `src/`, `next.config.ts`.
3. Setup Node.js App → **Run NPM Install** (se node_modules non è già completo sul server).

## T–2:15 → T–1:30 · Variabili d'ambiente e avvio

4. Setup Node.js App → Environment Variables (o `.env.local`):
   - `NEXT_PUBLIC_SITE_URL=https://wac.tuodominio.com`
   - `NEXT_PUBLIC_AGENCY_PHONE=+393202792782` (già il default nel codice: impostarla è ridondante ma sicura)
   - `DATABASE_URL=postgresql://utente:password@localhost:5432/nome_db` (se non passa dal wizard)
5. **Start/Restart** dell'app dall'ambiente pannello.
6. Se il DB è già a posto, `/setup` deve dare **404** (wizard chiuso). Se è prima installazione: segui `DEPLOY-CPANEL.md` Parte 4 e chiudi il wizard con il lock.

## T–1:30 → T–0:45 · Verifiche sito

7. `https://dominio/api/health` → `{"status":"ok","database":"ok"}`.
8. Header: in alto a destra **solo WhatsApp** (`https://wa.me/393202792782`); il telefono sta nel footer e nelle CTA.
9. GDPR: il **banner cookie** compare alla prima visita («Accetta tutti» / «Solo necessari»); privacy policy col titolare DDDigital (Daniele De Donnantonio) e cookie policy raggiungibili da footer e banner.
9. Footer: niente via, niente P.IVA, c'è «a branch by DDDigital», i tre contatti sono cliccabili.
10. Flipbox: hover desktop scopre il retro; su mobile il primo tap fa lo stesso (focus).
11. Sticky mobile: scrolla >300px → compaiono i due bottoni.
12. Landing (es. `/agenzia-web-crema`): CTA «Parla ora con una persona vera» con barra + WhatsApp + telefono.
13. Chat: messaggio di prova → il lead compare in `/admin/tickets`.

## T–0:45 → T–0:15 · SEO e tracciamento

14. `node scripts/verify-deploy.mjs https://wac.tuodominio.com` (script pronto del repo).
15. `/sitemap.xml` e `/robots.txt` citano il sottodominio vero.
15-bis. **Il sito WordPress principale (`www.tuodominio.com`) risponde ancora**: è la verifica che il 28/09 mancava e che ha evitato l'outage. Se non risponde: Setup Node.js App → elimina l'app e vedi DEPLOY-CPANEL Risoluzione problemi riga 1.
16. Google Search Console: verifica proprietà + invia la sitemap (token da `/admin/tools/google`).
17. Google Business Profile: il telefono della scheda deve coincidere col numero del sito.
18. GA4: controlla che arrivino gli eventi `call_click` e `whatsapp_click` (DebugView).
19. Prova il numero con un telefono reale: la chiamata parte e WhatsApp apre la chat.

## T–0:15 · Ultimi 15 minuti

20. Svuota la cache se usi una CDN/proxy.
21. Ricontrolla `/admin` (login ok) e che `/setup` resti 404.
22. Annuncia il go-live: il primo lead che arriva è la prova che tutto funziona.

## Dopo il go-live (primi 7 giorni)

- Cron ogni 15 min per SLA/follow-up/Ambrosio (DEPLOY-CPANEL Parte 7).
- Resend per le notifiche email: chiave `re_...` in env.
- Backup: `npm run backup` via cron giornaliero.
- Guarda in GA4 quale CTA converte di più (hero vs sticky vs finale): è il dato che decide dove rafforzare.
