# DESIGN-AUDIT — Grafica del ticketing (Prompt 1 di PROMPT-GRAFICA-TICKETING.md)

> Audit del 24/09/2026. Copre `/admin/tickets` e le pagine admin connesse. Il lavoro grafico
> precedente aveva già centralizzato i token (v. sezione 2): questo audit verifica la copertura,
> elenca le incoerenze trovate e documenta cosa è stato corretto in questa passata.

## 1. Inventario del design system esistente

**Token già centralizzati** (motore temi, sessione precedente):
- `globals.css`: brand come tripletti RGB su `:root/[data-theme="classic"]` + override `[data-theme="zendesk"]` + dimensione dark `[data-mode="dark"]`; superfici vetro (`--surface-*`), aurora, raggi (`--radius-*`), ombre (`--shadow-*`), accento (`--accent`).
- `tailwind.config.ts`: `brand-*`, `slate-*`, `white`, `black` leggono i token con `<alpha-value>` → ogni utility Tailwind (`bg-brand-600/90`) segue tema e dark senza varianti dedicate.
- Componenti base: `glass.tsx` (GlassCard/GlassButton, vetro) e `ui.tsx` (Card/Badge/Button, solidi). Tone map di stato/priorità/SLA in `lib/tickets.ts`.

**Conclusione Prompt 1 (token)**: la centralizzazione richiesta esiste già e copre colori, raggi, ombre e superfici. Le spaziature restano sulla scala Tailwind standard (4/8/12/16/24) senza token dedicati: coerenza verificata nelle pagine toccate, non serve un layer ulteriore.

## 2. Difetti trovati e corretti in questa passata

| # | Difetto | Gravità | Correzione |
|---|---------|---------|------------|
| 1 | **SLA «tutto ok» in verde**: `entro SLA`, `palla dal cliente`, `attivo` usavano il verde del successo → il colore di attenzione perdeva significato (nessuna gerarchia cromatica: verde ovunque = niente verde) | Media | Tone neutro `slate` per gli stati ok (Zendesk: colore riservato a ciò che richiede azione); verde/ambra/rosso solo su «scade presto», «in ritardo», «scaduto» (`lib/tickets.ts`) |
| 2 | **Badge «Attende risposta» su 2 righe** nella coda stretta 256px (wrapping del testo nel pill) | Media | `whitespace-nowrap` + icona `shrink-0` su badge SLA e attesa |
| 3 | **Bolle chat illeggibili in dark**: `bg-white`/`bg-brand-50` non passano dai token → in scuro fondo quasi bianco con testo chiaro (contrasto misurato **1.01:1** cliente, **1.25:1** agente) | Alta | Classi semantiche `.bubble-visitor`/`.bubble-operator` con override dark sui token (`--surface-white`, `--brand-900/55` + testo `--ink`); contrasto dark misurato dopo fix: **16.66:1** e **12.03:1** |
| 4 | **Testo bolla agente su brand pieno**: il blocco `bg-brand-600` + bianco stancava su messaggi lunghi (leggibilità Zendesk: testo scuro su superficie chiara) | Media | Bolla agente su `brand-50` con testo `slate-900` e ring tenue (light), vetro brand profondo (dark) |
| 5 | **Nessun raggruppamento temporale**: coda lunga senza ancore visive | Bassa | Intestazioni sticky «Oggi / Ieri / Questa settimana / Prima» sui dati già caricati (solo CSS, niente query nuove); disattivate in ricerca |
| 6 | **Selezione poco decisa**: bordo brand-300 su vetro, poco distinguibile dall'hover | Bassa | Bordo `brand-400` + fondo pieno bianco + barra di accento laterale `brand-600` |
| 7 | **Numeri non tabulari**: numero ticket e conteggi si sfalsano in colonna | Bassa | `tabular-nums` su numero ticket, conteggio messaggi, orari callback e audit |

## 3. Difetti residui (da valutare in fasi successive)

1. **`ui.tsx` vs `glass.tsx` coesistono**: le tabelle dense (leads, audit) usano ancora `Card` solida, il ticketing usa il vetro. Decisione già presa nel Prompt 7 della sessione precedente: glass nell'admin, solidi dove la densità conta. Non è un difetto, è una scelta da documentare — fatta qui.
2. **Pagina panoramica**: KPI con tinte `bg-*-500/90` cablate direttamente in pagina (`/admin/page.tsx`) invece che in tone map: coerenti col resto ma da centralizzare se crescono.
3. **Skeleton solo sulla chat**: le altre sezioni del dettaglio (lead, note) non hanno stati di caricamento — accettabile perché server-rendered; da introdurre solo se passeranno a fetch client-side.
4. **Focus ring**: uniforme (`outline-brand-600`) ovunque, verificato su liste, composer e azioni. Nessun `outline: none` senza sostituto.

## 4. Criterio di «fatto» del Prompt 1

- Audit documentato: questo file. ✓
- Token usati in `/admin/tickets`: sì (ereditati + bolle migrate a classi semantiche token-based). ✓
- Typecheck e build passano: verificati a fine passata. ✓
- Resa visiva light invariata dove non richiesto: le modifiche cambiano solo gli elementi elencati (tone SLA, bolle, selezione); il resto della pagina è intatto. ✓
