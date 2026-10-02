# REPORT — Ciclo containing block e attivazione del portafoglio clienti

> Riepilogo del 26/09/2026. Due filoni chiusi nello stesso giorno: il **ciclo completo** del bug
> «containing block» (dal fix della command palette al presidio automatico su build, push e CI)
> e l'**attivazione del portafoglio Clienti** gestito da Ambrosio (migration 025 applicata,
> sync provata nel browser, scheda dettaglio verificata end-to-end). Tutto è già committato:
> questo documento è la mappa, non la novità.

---

## 1. Il ciclo containing block — quattro commit, quattro livelli di presidio

**Il bug (diagnosi in `8e5c7ba`).** L'overlay della command palette ⌘K scuriva solo la banda
sotto la nav: la pagina restava brillante e cliccabile dietro la modale. Causa per specifica CSS:
la palette era montata nella nav, dentro `.glass-strong` che ha `backdrop-filter` — e un antenato
con `backdrop-filter` (come `filter` o `transform`) diventa **containing block** dei discendenti
`position: fixed`. L'overlay «fixed inset-0» si dimensionava sulla nav, non sul viewport.
Fix: `createPortal` su `document.body`, il pattern canonico React. Verificato nel DOM
(parent = BODY, rect = viewport esatto) e a video su desktop e mobile 390px.

| Commit | Livello | Cosa fa |
|---|---|---|
| `8e5c7ba` | **Fix** | Palette su portale; overlay di nuovo viewport-sized |
| `0dea258` | **Audit** | I 5 overlay `fixed` dell'app mappati: solo la palette era esposta. Sentinella scritta dove nasce il rischio (blocco Liquid Glass di `globals.css`) |
| `18a8c81` | **Build** | Guard statico `scripts/overlay-guard.mjs`: fallisce la build se un `fixed` è raggiungibile da una superficie glass senza portale |
| `fe158a9` | **Push + CI** | Hook pre-push versionato (`githooks/pre-push`, attivo via `postinstall`) e workflow GitHub Actions (`.github/workflows/overlay-guard.yml`) con guard → typecheck → test |
| `0837d79` | **Invariante** | Test del layer toast: viewport-anchored su ogni rotta admin, validato per mutazione |

**Il guard, come lavora.** Analisi statica con il compilatore TypeScript già in repo: mappa le
superfici a rischio (classi CSS con `backdrop-filter`/`filter`/`will-change` + utility Tailwind
`backdrop-blur*`), ricostruisce il grafo dei componenti renderizzati (import interni, children
passati come props) e segnala ogni `fixed` raggiungibile senza `createPortal`, con file:riga,
percorso root → superficie e rimando al fix di riferimento. Limiti dichiarati in testa allo
script (className dinamiche, JSX non risolto, aliasing di createPortal da import esterni).

**Prova che blocca davvero.** Canary con violazione iniettata: build fallita (exit 1 con report),
push bloccato dal hook su remote bare temporaneo; canary rimossa → build e push verdi.
Suite dedicata: 6 test su fixture (import denominato/default, literal in `cn()`, esenzione portale)
+ 5 sul presidio del perimetro (hook eseguibile, postinstall, ordine step CI).

**Verifica browser dei toast** (gli overlay più esposti alle superfici glass): sweep di 29 rotte
admin — layer `fixed` viewport-anchored su tutte, pillola centrata, nessun caso reale da
correggere. L'invariante è ora un test (`0837d79`), non solo una verifica fatta una volta.

---

## 2. Il portafoglio Clienti — da migration assente a scheda viva

**Il problema.** La pagina `/admin/clients` falliva con `relation "clients" does not exist`:
la migration 025 non era mai stata applicata al DB di sviluppo locale (le migration del repo
non hanno tracciamento: si applica a mano, e questa era rimasta indietro).

**L'allineamento, poi lo strumento.** Applicate tutte le 26 migration in ordine con il runner
esistente `db-migrate.mjs` (24 OK; 010 e 024 «già applicate» — le `CREATE RULE` senza
`IF NOT EXISTS` falliscono alla duplicazione, ed è la prova che erano lì). Dal problema nasce
lo strumento: **`npm run db:migrate`** (`2140b04`) applica tutte le migration in ordine con
report per file, e con **`schema_migrations`** (`98e8a7a`) il report diventa **esatto** —
tabella di tracciamento con checksum sha256, skip dei file già tracciati (seconda corsa in
~1s), backfill automatico dei DB vecchi, warning ⚠ DRIFT se un file cambia dopo l'applicazione.

**La sync di Ambrosio, provata nel browser.** «Sincronizza ora» → **4 clienti riconciliati**
dai ticket esistenti (Marco, Marco Rossi, Marco Bianchi, Giulia): identità ricomposta da lead
e canali, telefono E.164 come chiave di dedup, budget dichiarati sommati con la regola del
massimo («~3000 € dichiarati» per Giulia).

**La scheda dettaglio, verificata end-to-end** (Giulia):
- identità composta da Ambrosio con canali e budget coerenti coi messaggi reali;
- azioni verificate nel DOM: `tel:+393339876543`, `https://wa.me/393339876543`, e il link
  **Ticket (1)** che apre il #21 «verifica tre» con conversazione e lead coerenti —
  la fonte di verità resta il ticket, la scheda lo apre senza modificarlo;
- **nota salvata end-to-end**: scritta in UI, verificata sul DB (update + audit + revalidate)
  e ri-visibile dopo il reload; nota di prova poi rimossa (RESET 1).

---

## 3. Strumenti lasciati al repo

| Strumento | Comando | Cosa risolve |
|---|---|---|
| Guard overlay | `npm run guard:overlays` (automatico in build/push/CI) | Il bug containing block non rientra |
| Invariante toast | `npm test` (tests/toast-layer.test.mjs) | Il layer toast resta viewport-anchored |
| Allineamento DB | `npm run db:migrate` (+ `--dry-run`) | Le migration si applicano con un comando, con report esatto |
| Tracciamento | tabella `schema_migrations` | Stato migration sempre noto, con checksum anti-drift |

**Stato della suite al 26/09 sera:** 58/58 test ✓ · typecheck ✓ · guard verde su 168 file ·
working tree pulito.

## 4. Cosa resta aperto (nessun blocco)

- **Remote GitHub assente**: il workflow CI è pronto ma inattivo finché il repo non viene
  pubblicato; il pre-push hook invece è già attivo in locale. Al primo push: verificare che
  il workflow parta.
- **Canali email/WhatsApp del portafoglio**: la sync riconcilia già tutti i canali, ma le
  schede verificate nel browser nascono tutte da chat web — il percorso email (contact_email,
  header `email_ingest`) è coperto dai test del layer dati, non ancora da una verifica browser.
- **Identità git**: i commit usano l'identità autocompilata da hostname; configurare
  `user.name`/`user.email` prima di pubblicare.
