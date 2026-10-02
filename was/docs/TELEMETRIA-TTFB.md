# Telemetria TTFB produzione — admin e pagine pubbliche (prima/dopo)

Report di `scripts/ttfb-prod.mjs` (piano prestazioni 2026-10-02): ogni run è una sezione
con la stessa tabella e le sezioni nuove stanno in CIMA; `--confronta` aggiunge il Δ fra
le due fasi più recenti. Il cookie di sessione non compare mai in questo file.

---

## Confronto [pre-0.8.0] → [s-maxage-idle-90s] (02/10/26, 10:25)

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 541ms | **2000ms** | +1459ms | +270% |
| `/seo-crema` | 74ms | **350ms** | +276ms | +373% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 136ms | **464ms** | +328ms | +241% |
| `/seo-salento` | 79ms | **78ms** | -1ms | -1% |

## [s-maxage-idle-90s] 02/10/26, 10:25 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 1, attesa iniziale 90s (misurazione a freddo). Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 2000ms | **2000ms** | 2000ms | 2000ms | 1 | `iad1` | `HIT` |
| `/seo-crema` | 350ms | **350ms** | 350ms | 350ms | 1 | `iad1` | `STALE` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 464ms | **464ms** | 464ms | 464ms | 1 | `fra1` | `HIT` |
| `/seo-salento` | 78ms | **78ms** | 78ms | 78ms | 1 | `fra1` | `HIT` |

## [s-maxage-caldo] 02/10/26, 10:23 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 78ms | **88ms** | 3136ms | 695ms | 5 | `iad1` | `STALE` |
| `/seo-crema` | 74ms | **82ms** | 99ms | 84ms | 5 | `iad1` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 68ms | **83ms** | 1959ms | 459ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 64ms | **73ms** | 132ms | 92ms | 5 | `fra1` | `HIT` |

## Confronto [pre-0.8.0] → [post-0.8.0] (02/10/26, 03:00)

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 541ms | **542ms** | +1ms | 0% |
| `/seo-crema` | 74ms | **84ms** | +10ms | +14% |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | PRIMA mediana | DOPO mediana | Δ | Δ% |
|---|---|---|---|---|
| `/` | 136ms | **104ms** | -32ms | -24% |
| `/seo-salento` | 79ms | **105ms** | +26ms | +33% |

## [post-0.8.0] 02/10/26, 03:00 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 505ms | **542ms** | 2723ms | 969ms | 5 | `iad1` | `MISS` |
| `/seo-crema` | 77ms | **84ms** | 88ms | 83ms | 5 | `d79xw-1790902825219-4641c1ba957f` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 86ms | **104ms** | 3031ms | 686ms | 5 | `fra1` | `HIT` |
| `/seo-salento` | 71ms | **105ms** | 127ms | 101ms | 5 | `fra1` | `HIT` |

## [pre-0.8.0] 02/10/26, 02:32 — WebAgencyCrema + Web Agency Salento

Campioni per pagina: 5, a caldo. Misurato da `192.168.1.7`. Cookie di sessione: no.

### WebAgencyCrema — https://www.webagencycrema.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 518ms | **541ms** | 1424ms | 716ms | 5 | `iad1` | `MISS` |
| `/seo-crema` | 72ms | **74ms** | 88ms | 76ms | 5 | `rvvfc-1790901178602-a52d9e99fc18` | `HIT` |

### Web Agency Salento — https://www.webagencysalento.com

| Pagina | min | mediana | max | media | n | funzione (x-vercel-id) | x-vercel-cache |
|---|---|---|---|---|---|---|---|
| `/` | 110ms | **136ms** | 385ms | 205ms | 5 | `fra1` | `MISS` |
| `/seo-salento` | 71ms | **79ms** | 89ms | 80ms | 5 | `cfwnz-1790901182561-7df7876c7c41` | `HIT` |
