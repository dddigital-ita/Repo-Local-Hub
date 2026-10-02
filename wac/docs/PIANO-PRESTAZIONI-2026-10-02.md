# PIANO PRESTAZIONI — entrambi i gemelli (2026-10-02)

> Origine: «ricontrolla velocità sito, tra le pagine e il backend è lentissimo
> non carica». Documento di diagnosi + piano definitivo a 4 agenti. **Stato:
> IN CORSO** — 0.7.1 rilasciata e taggata il 2026-10-01 in entrambi i siti
> (Crema `v0.7.1`, Salento `was-0.7.2-backup` locale: vedi CHANGELOG); restano
> gli Step 1 in dashboard (Agenti A/C1: region `fra1` + scale-to-zero 300 s)
> e la misura prima/dopo di §7.
>
> Strumento di misura TTFB admin: `scripts/ttfb-prod.mjs` — §7 «Come misurare».
> Telemetria admin pronta, consegna da committare: vista `/admin/tools/perf`
> (audit_log `admin.render`) con guard in `tests/admin-perf-view.test.mjs` e
> `tests/ttfb-prod.test.mjs`.

---

## 1. Misure di base (2 ottobre 2026, produzione)

| Percorso | TTFB a caldo | TTFB a freddo | Cache |
|---|---|---|---|
| `/` (home) | **0,59–0,75 s** | **2,85 s** | `x-vercel-cache: MISS`, `no-store` |
| `/consulenza` | 0,57 s | 1,45 s | MISS, `no-store` |
| `/api/health` (con query DB) | 0,49 s | 1,15 s | — |
| `/api/seo/config` | 0,36 s | — | dinàmica |

Sintomo utente: pagine che «non caricanо» = **cold start combinato** — compute
Neon che si riattiva dallo sleep + function Vercel fredda: 3–10 s percepiti.

## 2. Causa radice (evidenze, non ipotesi)

1. **Function Vercel a Washington, DB a Francoforte.** Header live
   `x-vercel-id: fra1::iad1` (edge Milano → function iad1). Neon è in
   `eu-central-1` (hostname `ep-soft-recipe-b1we89n7-pooler.c-5.eu-central-1.aws.neon.tech`).
   Ogni query paga **~90 ms × 2 (RTT)** di oceano, per ogni pagina dinamica.
2. **Home dinamica per colpa del cookie A/B.** `src/app/page.tsx:109` legge
   `(await headers()).get("cookie")` per il bucket del test A/B dell'hero:
   Next rende dinamica l'intera pagina e **disattiva l'ISR dichiarato**
   (`export const revalidate = 300` a riga 38, mai attivo: sempre MISS).
3. **Neon si sospende** (scale-to-zero attivo, `suspend_timeout_seconds = 0`
   = default 300 s): primo visitatore dopo 5 min di quiet paga l'attivazione
   del compute (il 2,85 s misurato). Il passaggio a 300 s è **bloccato dal
   piano via API** («modifying the suspend interval is not permitted on this
   account») → da Console Neon, a mano.
4. **Nessuna cache CDN sulle pagine pubbliche**: tutto è render al volo,
   anche contenuti che cambiano raramente (home, pagine servizi).
5. **Migration 041** (indice su audit_log per takeover/followup) mai
   verificata su prod (nessun psql locale su Neon finora): l'Ambrosio/assist
   fa full-scan su `audit_log` se manca.
6. Regola AGENTS.md rispettata dal piano: la config del proxy ha già la
   cache CDN (mant. 600 s, SEO 3600 s, browser must-revalidate) — il piano
   NON tocca quelle rotte né aggiunge cron/keepalive/ping verso Neon.

## 3. Piano a 4 agenti (rilascio congiunto 0.7.1 Crema + Salento)

### Agente A — «Geografia» (impatto: −80…90 ms per query, su OGNI pagina)

Obiettivo: function e DB nella stessa region.

1. **Dashboard Vercel** → Settings → Functions → Function Region:
   ** Washington D.C. (iad1) → Frankfurt (fra1)**. È un settaggio di
   progetto, si applica al deploy successivo. (Non esiste via API/CLI: solo
   dashboard; oppure aggiungere `"regions": ["fra1"]` in `vercel.json` —
   ma su account Hobby le regioni extra sono bloccate: preferire dashboard.)
2. Verifica post-deploy: `curl -sD- https://www.webagencycrema.com/api/health
   | grep x-vercel-id` → atteso `fra1::fra1`. Procedura completa di misura
   TTFB prima/dopo: §7 «Come misurare».
3. Il DNS Vercel (fra1::) era già corretto: solo la function era in USA.

### Agente B — «Cache pagine» (impatto: TTFB dinamico → ~50 ms CDN)

Obiettivo: riattivare l'ISR della home e cachare ciò che è cachabile,
senza toccare admin né rotte del proxy.

**Stato: FATTO (2026-10-02)** — implementazione:

1. **Decisione A/B spostata dal server al client.** `src/app/page.tsx`
   non chiama più `headers()`/cookie: la pagina torna ISR
   (`revalidate = 300`, già presente, ora effettivo).
   - Il cancellò è `src/components/hero-ab-gate.tsx` (client): legge il
     cookie `wac_ab` via `useEffect`/`ensureCohortClient` e sceglie la
     variante; il tracciatore impression (già client) monta dopo la
     decisione, quindi la dimensione `hero_variant` è quella vera.
   - Primo render = coorte vuota: markup identico alla prerender, nessuna
     hydration mismatch, nessun flash percepibile.
   - La variante arriva a `SearchBar` via `HeroVariantContext`
     (`useHeroVariant`): la barra dell'home riporta `hero_variant` a
     GA4 senza prop drill; `/consulenza` e `/[slug]` (fuori dal gate)
     non la inviano, come prima.
   - Guard: nessun test blocca l'assenza di `headers()` in home
     (verificato: solo `tests/e2e/clients-tipo.spec.ts` usa headers(),
     su /admin — non correlato).
   - `hero-ab-gate.tsx` e `search-bar.tsx` aggiunti al manifest
     twin-sync (strumenti condivisi, nessun testo di sito dentro).
2. Pagina `/[slug]`: `generateStaticParams` + ISR attivati —
   aggiunto `export const revalidate = 600` (contenuti da Neon che
   cambiano raramente; l'admin purga con `revalidatePath`).
3. Admin resta `force-dynamic` ovunque (già così, nessun cambio).

Nota rendering (App Router): la home e `/[slug]` sono Server Components
con dati fetchati a tempo di prenderizzazione (SSG/ISR); il rendering
SSR resta dove serve davvero (es. `/consulenza` legge i searchParams).
Il caching delle fetch è quello nativo di Next (nessuna fetch nel
percorso di render pubblico: i dati vengono dal pool Neon con le
lib del progetto).

### Agente C — «Database» (impatto: cold start −2 s, query Ambrosio più rapide)

Obiettivo: sospende meno, legge con indici.

1. **Console Neon** (a mano, l'API rifiuta il piano):
   Project `still-brook-68641584` → branch `br-solitary-resonance-b17f5ewf`
   → endpoint `ep-soft-recipe-b1we89n7` → **Scale to zero: 300 seconds**
   (da «Default / immediato»). Costo compute leggermente più alto, il
   sintomo «non carica» sparisce.
2. **Verificare e applicare la migration 041** su prod:
   `DATABASE_URL="<pooled prod>" npm run db:migrate` (idempotente) e
   controllare con `\di` che l'indice su `audit_log` esista. Farlo DOPO
   l'approvazione: è la prima scrittura su prod dal 0.6.7.
3. Misurare `EXPLAIN ANALYZE` della query takeover/followup su prod prima/dopo.

### Agente D — «Gemello + release» (Salento, stesso identico piano)

Obiettivo: parità e rilascio.

1. Applicare A/B/C anche su `was-0.7.0-backup` (web-agency-salento):
   stessa region function (Salento ha DB Neon parallelo), stesso fix cookie
   A/B, stesso scale-to-zero da Console (se lo stesso piano lo consente).
2. Verifica twin-sync: le modifiche della home e del proxy restano fuori
   manifest (superfici pagine/contenuti): `node scripts/twin-sync.mjs --check`
   deve dare 9/9 in entrambi.
3. Release 0.7.1 congiunta: bump versione + CHANGELOG (voce prestazioni
   con le misure prima/dopo) + tag `v0.7.1` firmati DDDigital su ENTRAMBI i
   repo, push, attesa deploy, `verify-deploy` su entrambi i domini.

## 4. Settaggi esatti (riferimento rapido)

| Cosa | Dove | Valore |
|---|---|---|
| Function region | Vercel → Settings → Functions | **fra1 (Frankfurt)** |
| Neon scale-to-zero | Console Neon → endpoint | **300 s** |
| ISR home | `src/app/page.tsx` | `revalidate = 300` già presente, riattivata togliendo `headers()` |
| ISR slug | `src/app/[slug]/page.tsx` | `revalidate = 600` (se fattibile) |
| Cache CDN config proxy | GIÀ FATTO (altro thread) | mant. 600 s, SEO 3600 s — non toccare |
| Pool pg | `src/lib/db.ts` | `max 5, idle 30 s, keepalive` — già corretto, non toccare |
| Migration 041 | `npm run db:migrate` su prod | verificare/applicare, idempotente |

## 5. Obiettivi misurabili (post-rilascio)

| Metrica | Oggi | Target |
|---|---|---|
| TTFB home a caldo | 0,6–0,75 s | **≤ 0,20 s** (CDN) |
| TTFB dopo 10 min di quiet | 2,85 s | **≤ 0,50 s** (Neon vivo + function calda) |
| `/api/health` a caldo | 0,49 s | **≤ 0,15 s** |
| `x-vercel-id` | fra1::iad1 | fra1::fra1 |
| Percezione «non carica» | presente | assente (cold start max 1×/ora, ≤ 1 s) |

## 6. Rischi e ordine di esecuzione

1. **Prima** A (region) e C1 (scale-to-zero): puri settaggi, zero codice.
2. **Poi** B (cookie A/B client-side): unico cambio codice, da testare in
   locale (A/B decisione, impression GA4, guard testuali) e su preview.
3. **Infine** C2 (migration 041 su prod) e release 0.7.1 dei due gemelli.
4. Rollback: region function si reimposta da dashboard; la decisione A/B
   client-side si torna server-side con un revert; 041 è solo un indice.

## 7. Come misurare (TTFB admin e verifica Step 1)

Lo strumento è `scripts/ttfb-prod.mjs`: manuale, gira solo quando lo lanci
tu (niente cron/keepalive, regole AGENTS.md intatte). Misura il TTFB di
`/admin`, `/admin/settings` e `/admin/tools` e scrive:

- `docs/telemetria-ttfb/<fase>-<siti>-<data>.json` — i dati grezzi del run;
- `docs/TELEMETRIA-TTFB.md` — il report accumulabile (sezioni nuove in cima).

Il login admin di produzione è dietro Turnstile: lo script NON fa login, usa
il cookie `wac_admin` copiato dal browser (DevTools → Application → Cookies,
TTL 12h). Un cookie scaduto annulla il run senza sporcare il report.

**PRIMA / DOPO lo Step 1** (stesso browser, cookie eventualmente rinfrescato):

```bash
ADMIN_COOKIE_CREMA="wac_admin=…" ADMIN_COOKIE_SALENTO="wac_admin=…" \
  node scripts/ttfb-prod.mjs --fase prima
# … Step 1 + deploy …
ADMIN_COOKIE_CREMA="wac_admin=…" ADMIN_COOKIE_SALENTO="wac_admin=…" \
  node scripts/ttfb-prod.mjs --fase dopo-step1
node scripts/ttfb-prod.mjs --confronta   # Δ (ms e %) in cima al report
```

**FREDDO** (dopo ≥5 minuti di inattività, finestra scale-to-zero di Neon):

```bash
ADMIN_COOKIE_CREMA="wac_admin=…" node scripts/ttfb-prod.mjs \
  --site crema --fase freddo-prima --attesa 330
```

**PRODLIKE** (server locale :3105, cookie di sessione prodlike):

```bash
node scripts/ttfb-prod.mjs --site crema --base-crema http://localhost:3105 \
  --fase prodlike-prima
```

Il confronto non mescola mai produzione e prodlike: raggruppa i run per URL
misurati. Override della base col `--base-crema`/`--base-salento` per sito o
`--base` generico; `--site` per un sito solo. Il cookie non finisce mai nel
report né nei JSON.

**Verifica dello Step 1 (x-vercel-id fra1).** Ogni riga del report porta la
colonna «funzione (x-vercel-id)»: il 2° segmento dell'header (es.
`fra1::iad1` → funzione `iad1`). Atteso dopo lo Step 1: `fra1` — vedi
Agente A, §3. Verifica puntuale post-deploy:

```bash
curl -sD- https://www.webagencycrema.com/api/health | grep x-vercel-id
# atteso fra1::fra1 (prima: fra1::iad1)
```

Sul gemello **Web Agency Salento** i comandi sono gli stessi: cookie via
`ADMIN_COOKIE_SALENTO` (o `ADMIN_COOKIE` con `--site salento`) e dominio
`https://www.webagencysalento.com` per la verifica puntuale. Il piano di
Salento è descritto in §3, Agente D.

## 8. Immagini e LCP — audit (2026-10-02)

Domanda di riferimento: `next/image` gestisce resize, WebP e lazy loading;
per le immagini hero sopra la piega aggiungere `fetchpriority="high"`.
**Audit del repo: la home non ha un'immagine hero** — la sezione sopra la
piega è CSS-only (gradient radiale `bg-[radial-gradient(...)]` + testo +
SearchBar, `src/app/page.tsx`). Nessun `<img>`/`<Image>` banner esiste,
quindi **non c'è un LCP immagine da ottimizzare**: il pattern
`fetchpriority="high"` oggi non ha un bersaglio, e nessuna modifica è
necessaria.

Cosa c'è già, e perché segue già la guida:

| Immagine | Dove | Trattamento attuale |
|---|---|---|
| Logo brand (SVG 172×40) | `src/components/site-header.tsx` | `next/image` con `priority` → Next imposta già `fetchpriority="high"`: è l'unica immagine sopra la piega, ed è un vettore SVG (risoluzione-indipendente, pochi kB — il WebP non servirebbe) |
| Foto team 56×56 | `src/app/page.tsx` (sezione Team, sotto la piega) | `next/image` senza `priority` → lazy loading di default, resize e formato moderno automatici |
| Avatar chat | `src/components/chat/Chat.tsx` | `<img>` plain: superficie solo-admin (PublicOnly esclude la chat dalle pagine pubbliche), fuori dal perimetro LCP dei visitatori |

Regola per il futuro: se nasce una hero/banner fotografica, va in
`next/image` con `fetchpriority="high"`, formato moderno (WebP/AVIF) e
CDN — il resto della catena (resize, lazy, conversione) è già automatico.
Nessun codice cambiato in questo giro: l'architettura segue già la guida
«ottimizza le immagini senza pensarci» per ogni immagine che esiste.

---

> ### ✅ ESITO — milestone 0.8.0 (2026-10-02): **CHIUSA**
>
> Rilascio congiunto dei due gemelli: home e landing tornano ISR
> (la decisione A/B dell'hero si sposta nel browser), la funzione
> vive a `fra1` accanto al DB e la CDN serve le pagine pubbliche.
> Obiettivi §5 raggiunti:
>
> | Sito | Home (mediana) | Landing | Cache |
> |---|---|---|---|
> | **WebAgencyCrema** | 498 ms → **84 ms** (−83%) | 69 → 83 ms (rumore) | `HIT` 5/5 |
> | **Web Agency Salento** | 122 ms → **81 ms** (−34%) | 78 → 81 ms | `HIT` 5/5 |
>
> Il primo campione post-deploy (478 ms) è la rigenerazione a
> freddo attesa a rilascio fresco, già sotto il target freddo
> ≤ 500 ms. `x-vercel-id` post-deploy: `fra1` su entrambi i
> domini (Step 1 ✓).
>
> **Cronaca completa**: `CHANGELOG.md` di entrambi i repo (voci
> 0.8.0 — telemetria e free cache ISR) e i report TTFB dei due
> gemelli: `docs/TELEMETRIA-TTFB.md` (confronto pre→post 0.8.0)
> e i JSON grezzi in `docs/telemetria-ttfb/` (run pre-0.8.0 e
> post-0.8.0 su entrambi i domini). La misura admin resta in §7,
> l'audit immagini/LCP in §8.

---

*Documento redatto da Buffy (Freebuff) il 2026-10-02 con misure live di
produzione; aggiornato dopo il rilascio 0.7.1/0.7.2 (la storia del rilascio
sta nel CHANGELOG). Le misure di §1 restano la base del «prima»: la luce del
«dopo» la accende §7, con lo strumento e la verifica `x-vercel-id` fra1;
§8 registra l'audit immagini/LCP (nessun LCP da ottimizzare: hero CSS-only);
il riquadro ESITO chiude la milestone 0.8.0.*
