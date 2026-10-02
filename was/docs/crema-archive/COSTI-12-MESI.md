# COSTI A 12 MESI — Piano attuale vs Extra vs Vercel Hobby vs Vercel Pro

*29/09/2026. Scenario: 3 WordPress da tenere su FastComet + **3 progetti Node** da installare
(WAC oggi, 2 futuri). Prezzi FastComet da sito/ricerca 09/2026 — le promozioni iniciali
differiscono dai rinnovi: **verifica il tuo rinnovo esatto in cloud.fastcomet.com → Billing**.*

---

## Il fatto chiave che semplifica tutto

**Vercel si paga per SEAT (utente che deploya), non per progetto: un solo account Pro ospita
progetti illimitati.** 3 progetti Node = $20/mese *totali*, non $60. Su FastComet invece ogni
risorsa è un tetto condiviso: i 3 progetti Node su shared = NPROC esaurito, come visto.

## Tabella comparativa (12 mesi)

| | **A. Piano attuale così com'è** | **B. Upgrade «Extra»** | **C. Attuale + Vercel Hobby ×3** | **D. Attuale + Vercel Pro** |
|---|---|---|---|---|
| Hosting (rinnovo ~) | ~$120-180/anno (la tua fattura) | ~$180-300/anno (rinnovo Extra ~$15-25/mese) | invariato | invariato |
| App Node (3 progetti) | ❌ impossibili (NPROC 50) | ⚠️ 1 regge, 2-3 no (NPROC 100) | $0 | **$240/anno** ($20/mese tot, progetti illimitati) |
| Database Node | Postgres locale incluso | Postgres locale incluso | Neon Free ($0) | Neon Free ($0) |
| Cron 15 min | nativo | nativo | esterno (cron-job.org o cPanel, $0) | incluso nativo |
| Banda app | condivisa col server | condivisa | 100 GB/mese per progetto | 1 TB/mese incluso + $20 credito |
| Isolamento incidenti | ❌ zero (provato il 28/09) | ❌ zero | ✅ totale | ✅ totale |
| Rollback deploy | manuale/fragile | manuale/fragile | 1 click | 1 click |
| ToS commerciale | — | — | ⚠️ zona grigia (uso non-commerciale) | ✅ pulito |
| **Totale 12 mesi (incr.)** | **n/d — non è una soluzione** | **~$180-300/anno EXTRA** | **~$0 EXTRA** | **~$240/anno EXTRA** |

*Rinnovi FastComet: range $9.95-24.95/mese da Starter a Extra (fonte: ricerche 09/2026,
promozioni iniziali più basse). Il piano Extra offre: Unlimited Websites, 40GB NVMe, NPROC 100.*

## Scenario per scenario, onesto

**A — «Resto così»**: non è un'opzione per 3 progetti Node. Il 28/09 l'account ha esaurito i
processi con UNA app. Costo reale: downtime (~11,5 h già sostenute) + ticket + tempo. Scartata.

**B — Extra ($240-300/anno in più)**: raddoppia il tetto (100 processi) ma resta **shared**:
3 WP + 3 app Node su 100 processi = di nuovo al limite nei primi deploy (npm da Passenger
genera decine di processi temporanei: i fault di ieri hanno piccato 636). E l'architettura
non cambia: un'app malata abbatte i WordPress. Paghi di più per lo stesso rischio.

**C — Vercel Hobby ×3 ($0 extra)**: la scelta «partiamo e vediamo». 3 progetti separati,
Neon free per i DB, cron esterno gratis. Contro: ToS Vercel vietano l'uso commerciale su
Hobby — per un sito che genera lead è zona grigia: sostenibile finché il volume è basso,
ma è un debito da sanare.

**D — Vercel Pro ($240/anno extra)**: stesso costo dell'upgrade Extra, architettura opposta:
progetti illimitati isolati, ToS puliti per uso commerciale, cron nativi, analytics, 1 TB
banda, preview deployment per ogni modifica. Per 3+ progetti Node è il miglior rapporto
custodia/rischio/costo.

## Raccomandazione

1. **Oggi**: Vercel **Hobby** per WAC (costo zero, partiamo subito, volume lead basso).
2. **Al primo segnale di business vero** (lead stabili, secondo progetto in arrivo):
   upgrade a **Pro sullo stesso account** — $20/mese per TUTTI i progetti, migrazione
   trasparente (stessi repo, zero downtime).
3. **FastComet resta com'è**: 3 WordPress sotto LiteSpeed con 3 GB RAM liberi. Nessun
   upgrade Extra finché non saranno i WP stessi a toccare i limiti (oggi: 134 MB su 3 GB).
4. **Se mai servirà «tutto in un pannello»**: la risposta sarà un VPS (~$10-20/mese, limiti
   propri, root), non un altro shared.

## Costi nascosti da tenere a mente

- **Migrazione DB**: il Postgres attuale su cPanel (localhost) va portato su Neon —
  `pg_dump`/restore, un'ora una tantum, zero costi.
- **DNS**: `wac.dddigital.net` (e i futuri) = un record CNAME verso `cname.vercel-dns.com`
  nel DNS del dominio: gratis, e cPanel non vede nulla (impossibile replicare il 28/09).
- **Tempo**: su Vercel ogni nuovo progetto = import repo + env + dominio (~30 min); su
  cPanel erano 2-4 ore con wizard, upload, memory limit e rischi LVE.
- **Monitoraggio esterno** (consigliato): UptimeRobot free su tutti i domini, $0.
