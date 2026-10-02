# Setup Supabase + Deploy Vercel — WebAgencyCrema

*Segui questi passi in ordine. ~15 minuti la prima volta.*

---

## PARTE 1 — Neon (database Postgres dei lead)

Ho scelto Neon al posto di Supabase: Postgres standard, gratis, si porta dove vuoi.

1. Vai su **https://console.neon.com** → Sign up (con GitHub, 1 min)
2. **Create project**:
   - Name: `webagencycrema`
   - Postgres version: 16 (default)
   - Region: **EU (Frankfurt)** — GDPR
3. Apparirà un pannello **Connection string**: copiala (quella "pooled" se c'è)
   - Assomiglia a: `postgresql://user:pass@ep-xxx.eu-central-2.aws.neon.tech/neondb?sslmode=require`
4. **SQL Editor** nel menu a sinistra → incolla TUTTO `neon/schema.sql` → **Run**
   (crea tabelle + operatori Daniele e Michele già inseriti)
5. **Crea il tuo utente admin**: nel terminale, dalla cartella del progetto:
   ```
   npm run admin:create tua@email.com "UnaPasswordLunga"
   ```
6. Incolla a me la connection string (o mettila tu in `.env.local` in `DATABASE_URL`)
   e riavvio: chat che salva lead, dashboard /admin e CSV funzionano subito.

---

## PARTE 2 — Deploy Vercel + dominio webagencycrema.com

### A. Acquisto dominio (~10 €/anno)
Consiglio: **Vercel Marketplace** (zero-config DNS) oppure **Cloudflare/Namecheap**.
- Nome esatto: `webagencycrema.com` (compra anche `.it` se libera, per difesa del brand)
- Attiva **rinnovo automatico** e **privacy WHOIS** (di solito inclusi)

### B. Push su GitHub
Il commit iniziale lo faccio io (fatto, vedi sotto). Poi:
1. Crea repo vuoto su GitHub (nome: `webagencycrema`)
2. `git remote add origin git@github.com:TUOUTENTE/webagencycrema.git`
3. `git push -u origin main`

### C. Import su Vercel
1. Account su vercel.com (Sign up con GitHub)
2. Add New… → Project → **Import** la repo
3. Framework: Next.js (rilevato da solo) — **non toccare build settings**
4. **Environment Variables**: copia ESATTAMENTE quelle di `.env.local`, con una differenza:

   | Variabile | Valore in produzione |
   |---|---|
   | NEXT_PUBLIC_SITE_URL | `https://www.webagencycrema.com` |
   | DATABASE_URL | connection string Neon (stessa di locale) |
   | ADMIN_SESSION_SECRET | stringa lunga a caso |
   | tutte le altre | identiche a `.env.local` |

5. Deploy → attendi ~2 min → verifica l'URL `*.vercel.app` che funziona tutto

### D. Dominio su Vercel
1. Project → Settings → Domains → Add → `webagencycrema.com`
2. Aggiungi anche `www.webagencycrema.com` (Vercel propone il redirect)
3. Se il dominio è **stato comprato su Vercel**: DNS automatico, nulla da fare
4. Se è su altro registrar, Vercel mostra i record DNS da impostare:
   ```
   A     @      76.76.21.21
   CNAME www    cname.vercel-dns.com
   ```
   (i valori ESATTI li mostra Vercel: usa quelli)
5. Attendi propagazione DNS (da 5 min a 4 ore) — HTTPS arriva da solo (Let's Encrypt)

### E. Verifiche post-deploy (le faccio io quando vuoi)
- [ ] `https://www.webagencycrema.com` risponde 200
- [ ] `/sitemap.xml` e `/robots.txt` funzionano e citano il dominio vero
- [ ] Sorgente pagina: canonical + og:url con il dominio vero
- [ ] Chat end-to-end: lead salvato su Supabase + notifica email
- [ ] `/admin` login OK e inbox vede le conversazioni
- [ ] LCP < 2,5s su mobile (PageSpeed)

### F. Subito dopo il deploy — Google
1. **Search Console**: aggiungi la proprietà `https://www.webagencycrema.com`
   - Verifica con il meta token in `NEXT_PUBLIC_SEARCH_GSC_TOKEN` (o file HTML in /public)
   - Invia la sitemap: `sitemap.xml`
2. **GA4**: crea la proprietà, prendi l'ID `G-…` → env `NEXT_PUBLIC_GA4_ID` → redeploy
3. **GTM** (se lo usi): container ID `GTM-…` → env `NEXT_PUBLIC_GTM_ID` → redeploy
4. **Google Business Profile**: crea il profilo dell'agenzia a Crema, categoria
   "Agenzia di marketing web", sito = webagencycrema.com. È IL fattore #1 per
   posizionarsi su "agenzia web Crema" nella Maps. Fai verificarti con video/posta.

---

## PARTE 3 — Team vero (già pronta nel codice)

Ho tolto i nomi finti dal codice: gli operatori ora arrivano da `.env.local`.
Basta riempire queste due righe (nome, telefono, inizio turno, fine turno):

```
OPERATOR_A=Maria,+393331234567,9,13
OPERATOR_B=Luca,+393337654321,15,19
```

WhatsApp diverso dal telefono: aggiungi una 5ª posizione `...,9,13,+393331234567`

**Dammi i nomi e telefoni reali** (o modificali tu in `.env.local`) e riavvio il server:
in home e in chat spariranno "Operatore A/B" e compariranno le persone vere.

*Foto profilo: mettile in `public/team/` come `a.jpg` e `b.jpg` — il layout le usa
automaticamente (se mancano resta l'avatar con l'emoji).*


## Ambrosio — operatore AI fuori turno

Risponde ai clienti in chat quando Daniele e Michele sono offline (notte inclusa).
Configurazione in `/admin/ai` (niente env da toccare):

1. Scegli il provider: **Claude (Anthropic)**, **OpenAI**, **OpenRouter** o **Custom** (qualsiasi endpoint OpenAI-compatible, es. Ollama/Groq).
2. Incolla la chiave API (viene cifrata AES-256-GCM e salvata su Neon — mai lato client).
3. Modello: default `claude-sonnet-4-5` (Claude) / `gpt-4o-mini` (OpenAI); modificabile a mano.
4. Regole e personalità: nel prompt di sistema (precompilato, editabile: fasce prezzo, turni, tono).
5. Spunta "Attiva Ambrosio fuori turno" → Salva → usa "Prova dal vivo" per un test reale.

Comportamento: la qualificazione a bottoni resta deterministica (come da brief);
Ambrosio risponde solo su testo libero fuori script e sulla chat libera dopo la
qualificazione, solo quando nessun umano è in turno. Le sue risposte finiscono
nella conversazione (sender `bot`) e l'operatore le rilegge nel ticket.
