# Telemetria TTFB produzione — admin (prima/dopo lo Step 1)

Report di `scripts/ttfb-prod.mjs` (piano prestazioni 2026-10-02): ogni run è una sezione
con la stessa tabella e le sezioni nuove stanno in CIMA; `--confronta` aggiunge il Δ fra
le due fasi più recenti. Il cookie di sessione non compare mai in questo file.

---

## Confronto [s-maxage-caldo] → [s-maxage-idle-90s] (02/10/26, 10:17)

_Impatto del TTL: 90s di inattività sono oltre i 60s di Crema (TTL scaduto → origin) ma dentro i 300s di Salento. Caldo: 5 campioni/pagina; idle: 1 campione/pagina (prima richiesta dopo l'attesa)._

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 95ms | **1315ms** | +1220ms | +1284% |
| `/seo-crema` | 80ms | **215ms** | +135ms | +169% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 83ms | **484ms** | +401ms | +483% |
| `/seo-salento` | 77ms | **76ms** | -1ms | -1% |

## Confronto [pre-0.8.0] → [s-maxage-idle-90s] (02/10/26, 10:17)

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 498ms | **1315ms** | +817ms | +164% |
| `/seo-crema` | 69ms | **215ms** | +146ms | +212% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 122ms | **484ms** | +362ms | +297% |
| `/seo-salento` | 78ms | **76ms** | -2ms | -3% |

## [s-maxage-idle-90s] 02/10/26, 10:17 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 1, attesa iniziale 90s (misurazione a freddo). Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 1315ms | **1315ms** | 1315ms | 1315ms | 1 | `iad1` | `HIT` |
| `/seo-crema` | 215ms | **215ms** | 215ms | 215ms | 1 | `iad1` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 484ms | **484ms** | 484ms | 484ms | 1 | `fra1` | `STALE` |
| `/seo-salento` | 76ms | **76ms** | 76ms | 76ms | 1 | `fra1` | `STALE` |

## [s-maxage-caldo] 02/10/26, 10:14 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 83ms | **95ms** | 1227ms | 319ms | 5 | `iad1` | `STALE` |
| `/seo-crema` | 76ms | **80ms** | 93ms | 82ms | 5 | `iad1` | `STALE` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 80ms | **83ms** | 392ms | 159ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 72ms | **77ms** | 84ms | 77ms | 5 | `fra1` | `HIT` |

## Confronto [pre-0.8.0] → [post-0.8.1-verifica] (02/10/26, 08:34)

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 498ms | **81ms** | -417ms | -84% |
| `/seo-crema` | 69ms | **81ms** | +12ms | +17% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 122ms | **88ms** | -34ms | -28% |
| `/seo-salento` | 78ms | **89ms** | +11ms | +14% |

## [post-0.8.1-verifica] 02/10/26, 08:34 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 72ms | **81ms** | 1485ms | 363ms | 5 | `iad1` | `HIT` |
| `/seo-crema` | 74ms | **81ms** | 206ms | 104ms | 5 | `iad1` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 85ms | **88ms** | 898ms | 251ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 77ms | **89ms** | 95ms | 87ms | 5 | `fra1` | `HIT` |

## [post-0.8.1] 02/10/26, 08:33 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 75ms | **87ms** | 2762ms | 620ms | 5 | `c8vzs-1790922796449-6e9f8a8f7ff7` | `HIT` |
| `/seo-crema` | 74ms | **90ms** | 394ms | 150ms | 5 | `679tb-1790922800694-6bd120590015` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 75ms | **201ms** | 3743ms | 862ms | 5 | `n5dsq-1790922802866-3207275b5c23` | `HIT` |
| `/seo-salento` | 74ms | **97ms** | 275ms | 133ms | 5 | `fra1` | `HIT` |

## [valutazione-cf-verify] 02/10/26, 06:14 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 74ms | **95ms** | 248ms | 123ms | 5 | `iad1` | `STALE` |
| `/seo-crema` | 69ms | **73ms** | 82ms | 75ms | 5 | `iad1` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 77ms | **96ms** | 251ms | 123ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 76ms | **81ms** | 105ms | 88ms | 5 | `fra1` | `HIT` |

## [valutazione-cf] 02/10/26, 06:09 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 78ms | **83ms** | 1251ms | 315ms | 5 | `iad1` | `HIT` |
| `/seo-crema` | 82ms | **149ms** | 1516ms | 414ms | 5 | `iad1` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 81ms | **85ms** | 2983ms | 668ms | 5 | `72bnb-1790914188696-336d3be77d83` | `HIT` |
| `/seo-salento` | 76ms | **81ms** | 328ms | 136ms | 5 | `fra1` | `HIT` |

## Confronto [pre-0.8.0] → [post-0.8.0-crema] (02/10/26, 03:03)

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 498ms | **84ms** | -414ms | -83% |
| `/seo-crema` | 69ms | **83ms** | +14ms | +20% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 122ms | **81ms** | -41ms | -34% |
| `/seo-salento` | 78ms | **81ms** | +3ms | +4% |

## [post-0.8.0-crema] 02/10/26, 03:03 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 82ms | **84ms** | 478ms | 162ms | 5 | `vwks8-1790903032267-a6f76ccf18ed` | `HIT` |
| `/seo-crema` | 79ms | **83ms** | 92ms | 85ms | 5 | `mpvfb-1790903034038-7fa84c620852` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 75ms | **81ms** | 329ms | 130ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 76ms | **81ms** | 91ms | 82ms | 5 | `fra1` | `HIT` |

## [pre-0.8.0] 02/10/26, 02:32 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 479ms | **498ms** | 2383ms | 870ms | 5 | `iad1` | `MISS` |
| `/seo-crema` | 64ms | **69ms** | 197ms | 101ms | 5 | `xcl2l-1790901147762-1165642ec963` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 111ms | **122ms** | 1184ms | 350ms | 5 | `fra1` | `MISS` |
| `/seo-salento` | 66ms | **78ms** | 88ms | 76ms | 5 | `mt8zx-1790901152569-c7ada8cc1f44` | `HIT` |

## [prodlike-prima] 01/10/26, 22:07 — WebAgencyCrema

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: sì (mai nel report).

### WebAgencyCrema — http://localhost:3105

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/admin` | 14ms | **15ms** | 56ms | 24ms | 5 | `—` | `—` |
| `/admin/settings` | 13ms | **17ms** | 18ms | 16ms | 5 | `—` | `—` |
| `/admin/tools` | 11ms | **14ms** | 16ms | 14ms | 5 | `—` | `—` |
