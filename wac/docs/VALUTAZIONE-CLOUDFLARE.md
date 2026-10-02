# Valutazione Cloudflare-proxy (ADR-007 §4)

Raccolta dati del **2026-10-02, notte (04:09–04:16 UTC)**, misurata da
`192.168.1.7` (Italia, rete residenziale). Strumenti: `scripts/ttfb-prod.mjs`
(pagine) + censimento one-off degli asset (JSON grezzi in
`docs/telemetria-ttfb/valutazione-cf-*`). Nessun cron/keepalive: misure
manuali, come da AGENTS.md.

## 1. Quanti asset Next.js serviti

| Metrica | Crema | Salento |
|---|---|---|
| Build `.next/static` (locale) | 160 file / 2,7 MB | 160 file / 2,7 MB |
| Asset unici per pagina (home/landing) | **20** (~890–912 KB) | **20** (~936–938 KB) |
| … di cui chunks / css / media | 13 (~663–691 KB) / 3 (~106 KB) / 4 (141 KB) | idem |
| Unione su TUTTA la superficie pubblica | **22 unici** (15 chunks, 3 css, 4 media) | **22 unici** (idem) |
| URL pubblici (sitemap) | 13 | 20 |
| HTML per pagina | home 156 KB · landing 58 KB | home 186 KB · landing 60 KB |

Header asset (live): `cache-control: public,max-age=31536000,immutable`,
`x-vercel-cache: HIT`, `age` presente → serviti dall'edge Vercel, non
dall'origine. TTFB asset: **54–57 ms a caldo** (HIT).

**Dato rilevante**: alla misura delle 04:13 UTC la home di Salento era
**19/20 asset in MISS** (`age: 0`, TTFB 180–381 ms): l'edge cache Vercel
Free **evictiona** su siti a basso traffico. La pagina successiva (misurata
un minuto dopo) era già di nuovo HIT. Crema: 20/20 HIT in entrambe le run.

## 2. TTFB attuale per regione

Run `valutazione-cf` e `valutazione-cf-verify` (5 campioni/pagina, a caldo,
senza cookie — pagine pubbliche):

| Sito | Pagina | TTFB mediana (2 run) | min–max | funzione (`x-vercel-id`) |
|---|---|---|---|---|
| Crema | `/` | **83 / 95 ms** | 74–1251 ms | **`iad1`** (20/20 campioni) |
| Crema | `/seo-crema` | **149 / 73 ms** | 69–1516 ms | **`iad1`** |
| Salento | `/` | **85 / 96 ms** | 77–2983 ms | `fra1` |
| Salento | `/seo-salento` | **81 / 81 ms** | 76–328 ms | `fra1` |

**⚠️ Anomalia da risolvere**: la funzione di Crema esegue a **iad1**
(Washington) — edge POP `fra1`, funzione `iad1` (`fra1::iad1::…`). Il
riquadro ESITO di [PIANO-PRESTAZIONI-2026-10-02.md](PIANO-PRESTAZIONI-2026-10-02.md)
dichiara «fra1 su entrambi i domini (Step 1 ✓)»: **in disaccordo con la
misura live**. Salento invece è `fra1::fra1` come atteso. Da verificare su
dashboard Vercel (Settings → Functions / regione del deploy): o il deploy ha
regredito la region, o l'ESITO era prematuro. `vercel.json` è `{}` (nessun
pin di regione).

Conseguenza misurabile: gli outlier da **1,25–1,52 s** su Crema coincidono
con `x-vercel-cache: REVALIDATED`/`STALE` — la rigenerazione ISR fa
edge(fra1) → funzione(iad1) → Neon(eu-central-1, Francoforte) → ritorno:
**doppio attraversamento oceanico**. A cache calda l'edge serve senza
invocare la funzione, hence i 83 ms mediani.

Header pagine (live, entrambi i siti): `cache-control: public, max-age=0,
must-revalidate`, `etag`, `x-vercel-cache: HIT/STALE`, `age` → la cache edge
Vercel funziona a livello di piattaforma (ISR) **anche senza `s-maxage`**.
Nota: il repo HEAD imposta `s-maxage` + `vercel-cdn-cache-control` sul proxy
([src/proxy.ts:287-289](src/proxy.ts#L287-L289), commit `b87241c`), ma in
produzione l'header non c'è → **il deploy live è più vecchio di HEAD** (da
verificare/rideployare).

## 3. Stima dell'offload sull'origine Vercel

**Oggi l'origine (function + Neon) vede già quasi nulla del pubblico:**

- **Pagine**: edge cache Vercel assorbe il 100% dei colpi misurati
  (20/20 campioni HIT/STALE). L'origine è invocata solo per:
  - rigenerazioni ISR: al più **288/giorno** la home (TTL 300 s) e
    **144/giorno** per landing (TTL 600 s) — e solo al primo hit dopo il
    TTL, non a ogni visita; con traffico rado sono molte meno;
  - miss/partenze a freddo (post-deploy, post-eviction);
  - purge da `revalidatePath` delle scritture admin.
- **Asset**: a regime **zero** richieste in origine (immutable, HIT edge);
  solo le finestre fredde (Salento: ~20 fetch per partenza a freddo).
- **Sempre in origine** (per design, non cachabili): `/admin`
  (`force-dynamic`), `/api/*` (webhook, chat ingest, admin API) — traffico
  operatori/provider, piccolo.

**Cosa porterebbe Cloudflare proxy, con gli header attuali:**

- **HTML: offload ≈ 0.** CF rispetta `max-age=0` e **non caccherebbe** le
  pagine: diventerebbe un relay puro (+1 hop, ~+10–50 ms) senza togliere
  nulla a Vercel. Per offload HTML servono **CF Cache Rules** (cache
  HTML a TTL) **oppure il deploy del `s-maxage`** già nel repo (lecito:
  agisce solo sulla CDN, il browser continua a `must-revalidate`).
- **Asset**: CF terrebbe caldi gli immutable nei suoi POP (~300 vs gli edge
  node Vercel Free) → le finestre fredde di Salento passerebbero da
  200–381 ms a ~50–80 ms da Italia. Guadagno reale ma **solo sui primi
  colpi dopo un'eviction**.
- **Protezione**: CF nasconde l'IP d'origine e assorbe abuso/DDoS —
  beneficio non misurabile in TTFB ma reale, gratuito sul piano Free.

**Il guadagno più grande NON è Cloudflare**: è la **regione della funzione
Crema (iad1 → fra1)** — −80/90 ms su ogni rigenerazione/render freddo e
fine dei picchi 1,2–1,5 s, con un cambio di setting su Vercel (o un pin in
`vercel.json`). Costa zero e toglie più latenza di qualsiasi offload CDN a
questo traffico.

## Verdetto

A questo traffico (siti piccoli, edge Vercel che assorbe tutto il pubblico
misurato), **Cloudflare proxy ha offload marginale sull'origine**: le pagine
sono già HIT su edge Vercel e gli asset sono immutable e serviti a 54–57 ms
quando l'edge è caldo. CF si giustifica solo se: (a) cresce il traffico fino
a saturare/evictionare l'edge Free, (b) serve protezione abuso/DDoS, (c)
Salento resta a basso traffico con asset cronicamente freddi. Prima di
qualsiasi layer CDN: **fix della regione funzione (iad1→fra1) e deploy del
`s-maxage` già scritto** — poi rivalutare con `scripts/ttfb-prod.mjs`.

Vincoli se si adotta CF (da ADR-007 §4 + AGENTS.md): bypass totale su
`/admin` (il proxy manda già `must-revalidate`), **invalidazione CDN vera**
per le modifiche di manutenzione (mai abbassare i TTL come workaround: la
manutenzione può richiedere 10 minuti), browser sempre in rivalidazione
(`max-age=0` non si tocca).
