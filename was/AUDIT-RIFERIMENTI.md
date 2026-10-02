# STEP 1 — Audit riferimenti da sostituire (WebAgencyCrema → Web Agency Salento)

Sorgente: `../WebAgencyCrema` (Next.js 16, Neon/Postgres, hook «ricerca → chat → chiamata»).
Destinazione: questo workspace (`Web Agency Salento + Installer`, attualmente vuoto).
Nessuna modifica a codice o contenuti è stata eseguita: questo documento è la mappa di ciò che verrà toccato dopo l'approvazione.

---

## 1. Conteggio riferimenti trovati

| Pattern | Occorrenze in `src/`, `scripts/`, `neon/` |
| --- | --- |
| `crema` (case-insensitive) | **213** |
| `webagencycrema` (dominio/email) | 9 file |
| Nomi team (`Michele`, `Daniele`) | 14 file |
| Altri riferimenti geografici (`Milano`, `via Bergamo`, `piazza Duomo`, `Cremasco`, `Bergamo`) | in `site.ts` e `page.tsx` |

## 2. Configurazione centrale — IL punto di partenza

`src/lib/site.ts` è già il file giusto: quasi tutto il brand passa da qui via env + default.

| Campo attuale (Crema) | Valore nuovo proposto | Stato |
| --- | --- | --- |
| `site.name` = "Web Agency Crema" | **Web Agency Salento** | ✅ deciso |
| `site.legalName` = "Web Agency Crema S.r.l." | "Web Agency Salento" (+ forma societaria) | ⚠️ forma societaria da confermare |
| `site.url` = webagencycrema.com | es. `https://www.webagencysalento.com` | ⚠️ dominio da confermare |
| `site.phone` = **Michele** +39 320 279 2782 | **Daniele +39 320 086 5907** (telefono principale richiesto) | ✅ deciso |
| `site.phoneSecondary` = Daniele +39 320 086 5907 | secondo numero team | ⚠️ da fornire |
| `site.email` = info@webagencycrema.com | es. info@webagencysalento.com | ⚠️ da confermare |
| `site.vat` / `site.address` = placeholder | sede reale (Lecce? Castro? altro) + P.IVA | ⚠️ da fornire |
| `PROVINCE_INFO`: crema / cremona / lodi | **lecce / gallipoli / brindisi / otranto / nardò / maglie / copertino** (+ descrizioni locali ORIGINALI) | ✅ struttura decisa, testi da scrivere |
| `LANDINGS` (10 landing testi Crema) | 17 landing nuove (v. PIANO-SEO-SALENTO.md) | ✅ piano pronto |
| `SEARCH_CHIPS` (4 chip hero) | adattate al Salento | ✅ |
| `privacyController` (D. De Donnantonio, Castro LE, dddigital.net) | invariato — resta la casa madre | ✅ probabile, da confermare |
| `PRODUCTION_DOMAIN` | webagencysalento.com | ⚠️ da confermare |

Regola già presente nel codice da PRESERVARE: i numeri «000» delle env non finiscono mai sul sito pubblico (`safePhone()`), l'indirizzo placeholder non finisce nel JSON-LD. Da mantenere identico.

## 3. Audit file-per-file (cosa cambia nello STEP 1 esecutivo)

### 3.1 Brand / asset visivi
| File | Riferimento attuale | Azione |
| --- | --- | --- |
| `public/brand/logo-crema.svg` (lockup header) | "WebAgency Crema" | Nuovo lockup **"WebAgency Salento"**: il logo è un sistema multi-città generato da `~/logo-webagency/genera.py` (lista `CITTA`). Aggiungo "Salento" alla lista e genero gli SVG, oppure edito l'SVG di consegna. Da fare **fuori/dentro** il progetto solo su approvazione. |
| `public/brand/logo-crema-primario.svg`, `simbolo.svg` | variante primaria + simbolo | Simbolo INVARIATO (due anelli incastrati), solo lockup testuale nuovo |
| `public/brand/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | favicon Crema | Rigenerati dal brandpack (/favicon/salento) — manca la voce "salento" nel brandpack: va generata |
| `src/app/icon.svg` | favicon SVG con id `favcremam` | Nuovo favicon Salento (stesso disegno) |
| `public/site.webmanifest` | name "WebAgency Crema", short "WebAgency CR" | "Web Agency Salento" / "WebAgency Salento" |
| `public/team/` | vuoto | foto team da fornire |

### 3.2 Config e lib (testi brand + dati)
| File | Riferimenti | Azione |
| --- | --- | --- |
| `src/lib/site.ts` | brand, dominio, email, telefono, PROVINCE_INFO, LANDINGS, CHIPS | **Riscrittura completa** con valori Salento + config centralizzata (sezione 2) |
| `src/lib/seo.ts` (`DEFAULT_SEO_CONFIG`) | homeTitle/description/keywords "Agenzia web a Crema" | Nuovi default SEO Salento |
| `src/lib/hero-shared.ts` (`DEFAULT_HERO`) | eyebrow "Agenzia web con sede a Crema", title "web agency a Crema?" | Testi hero Salento |
| `src/lib/ai.ts` | system prompt Ambrosio "agenzia web a Crema (CR) guidata da Daniele e Michele"; prompt strumenti "di Web Agency Crema"; istruzioni contesto "Crema e provincia" | Prompt Ambrosio riscritti per il Salento (team da definire) |
| `src/lib/chat-script.ts` | `ChatContext.agencyName` (deriva da site), default operatori Marco/Giulia | Default operatori = team reale Salento (da fornire) |
| `src/lib/digest.ts` | firma digest "Crema" | Firma Salento |
| `src/lib/password-reset.ts` | email reset brandizzata Crema | Brand Salento |
| `src/lib/telegram-ingest.ts` | messaggio benvenuto "…Crema" | Brand Salento |
| `src/lib/email-tools.ts` | placeholder/firma "Crema" | Brand Salento |
| `src/lib/google-tools.ts` | default URL `https://www.webagencycrema.com`, esempi sc-domain | Nuovo dominio |
| `src/lib/maintenance.ts` | `kind: "webagencycrema-backup"` (2 occorrenze) | `webagencysalento-backup` — **attenzione**: cambia il formato dei backup esistenti, ok su DB nuovo |
| `src/lib/hero.ts`, `theme.ts`, `packages.ts`, ecc. | puliti | Nessuna modifica |

### 3.3 App router (pagine pubbliche)
| File | Riferimenti | Azione |
| --- | --- | --- |
| `src/app/layout.tsx` | metadata default "Agenzia web a Crema" (2×), appleWebApp title, JSON-LD LocalBusiness: `addressLocality: "Crema"`, `postalCode 26013`, `areaServed: [Crema, Cremona, Lodi]` | Metadata Salento + JSON-LD Lecce/areaServed Salento. **Indirizzo reale necessario** (il placeholder è escluso dal markup per design) |
| `src/app/page.tsx` | H1 "web agency a Crema?", badge "sede a Crema", flipbox "Daniele e Michele… piazza Duomo", metadata | Home riscritta (contenuti originali Salento, piazza Duomo leccese ha senso ma testo NUOVO) |
| `src/app/og/route.tsx` | fallback title "…Crema", riga "Crema, Cremona, Lodi" | OG Salento |
| `src/app/maintenance/page.tsx` | "Agenzia web · Crema" | "Agenzia web · Salento" |
| `src/proxy.ts` (pagina manutenzione statica) | logo "W", "Agenzia web · Crema" | Logo/nome Salento |
| `src/app/sitemap.ts`, `robots.ts` | generano da LANDINGS/site | Si aggiornano da soli una volta riscritto `site.ts` |
| `src/app/consulenza`, `privacy-policy`, `cookie-policy`, `not-found` | nessun riferimento hardcoded Crema | Solo verifica |

### 3.4 Componenti
| File | Riferimenti | Azione |
| --- | --- | --- |
| `src/components/site-header.tsx` | `Image src="/brand/logo-crema.svg"` alt "WebAgency Crema" | Nuovo path logo + alt |
| `src/components/footer.tsx` | colonna Zone (Crema/Cremona/Lodi hard-coded), filtro `l.city === "crema"`, "Crema (CR) · da sempre nel territorio" | Zone Salento + filtro `lecce` |
| `src/components/hero-editor.tsx`, `seo-landing-editor.tsx`, `seo-gsc-panel.tsx` | label/placeholder con "Crema" | Testi admin |
| `src/components/google-tools-panel.tsx` | placeholder `webagencycrema.com` | Nuovo dominio |
| `src/components/email-tools-panel.tsx` | placeholder `info@webagencycrema.it` | Nuova email |
| `src/components/sticky-call.tsx`, `chat/*` | leggono da site/operators | Nessuna modifica diretta |

### 3.5 Admin / API / scripts / DB
| File | Riferimenti | Azione |
| --- | --- | --- |
| `src/app/admin/actions.ts` (3×) | firma email "Web Agency Crema" | Firma Salento |
| `src/app/admin/clients/[id]/page.tsx` | template WhatsApp "della Web Agency Crema" | Brand Salento |
| `src/app/admin/utenti/page.tsx` | placeholder `nome@webagencycrema.com` | Nuova email |
| `src/app/api/admin/backup/[id]/route.ts` | filename `backup-webagencycrema-…` | `backup-webagencysalento-…` |
| `scripts/setup-localhost.mjs` | DB_NAME `webagencycrema`, log "WebAgencyCrema" | `webagencysalento` |
| `scripts/demo-reset.mjs`, `demo-tickets.mjs` | dati demo brandizzati Crema | Rigenerati per Salento |
| `neon/schema.sql` | commento "Schema Neon per WebAgencyCrema"; seed operatori: Daniele 9–13 (…5907), Michele 15–19 (…782) | Commento nuovo + **seed operatori da definire** (chi presidia i turni per il Salento?) |
| `package.json` | `name: "crema-web-agency"` | `salento-web-agency` |
| `.env.example` | placeholder dominio/NOME_AGENZIA | Placeholder Salento |
| `README.md`, doc vari (SETUP, GO-LIVE…) | riferimenti Crema/Vercel | Aggiornati in coda |

## 4. Dati aziendali da FORNIRE (non inventati — bloccanti per il go-live)

1. **Dominio futuro** — proposto `webagencysalento.com` (da verificare disponibilità; alternativa `.it`).
2. **Sede / indirizzo** completo con CAP (per JSON-LD, privacy policy) — Lecce? Castro? altro?
3. **Ragione sociale e P.IVA** del soggetto che factura.
4. **Email** pubblica e email notifiche (dominio da verificare su Resend).
5. **Team e turni**: chi risponde in chat/telefono oltre a Daniele? Nome, telefono, orari, eventuale WhatsApp, foto (`/team/`). Oggi la home cita "Daniele e Michele": per il Salento il secondo nome è da decidere.
6. **Social**: Instagram/Facebook/LinkedIn da collegare (oggi solo WhatsApp in `sameAs`).
7. **Numeri/prove reali** per landing e proof (progetti consegnati, anni, risultati SEO): il codice attuale contiene numeri di Crema che NON verranno copiati; senza dati useremo formulazioni oneste senza cifre.
8. **GA4 / GTM / Search Console / bot Telegram NUOVI** per il dominio Salento (non riusare quelli di Crema).
9. **Database Neon separato** per il nuovo progetto (mai condividere il DB di Crema).
10. **Pagina esistente dddigital.net/agenzia-web-salento**: definire se resta (differenziare titoli) per evitare cannibalizzazione col nuovo dominio.

## 5. Cosa resta INVARIATO (richiesta: riusare architettura, non contenuti)

- Hook «ricerca → chat a script fisso → chiamata», turni operatori, callback, GDPR (consenso prima di salvare).
- Admin completo: inbox, pipeline lead, tickets, SEO editor, hero editor, theme editor, backup, Google kit.
- Design system (aurora, glass, dark mode, motion), accessibilità AA documentata, ISR, sitemap/robots/OG dinamica.
- Schema markup già presente: LocalBusiness + Service + FAQPage + BreadcrumbList (si aggiorna solo il contenuto).
- Stack: Next 16, Tailwind, Neon, Resend, Telegram, Playwright test.

## 6. Piano di esecuzione STEP 1 (da approvare)

1. Copia del codice sorgente in questo workspace, **esclusi**: `node_modules`, `.next*`, `.git`, `.env*` (veri), `backups/`.
2. `git init` nuovo repository locale (niente push senza conferma).
3. Sostituzione brand secondo la mappa §2–3, con `site.ts` come unica fonte di verità.
4. Logo: generazione lockup/favicon "Salento" dal brand system e sostituzione asset in `public/brand` + favicon + manifest.
5. `npm install` + `typecheck` + `test` + `lint` per verificare che tutto regga.
6. Report con elenco file toccati e dati mancanti (§4).
