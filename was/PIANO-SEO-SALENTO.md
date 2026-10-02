# STEP 2 — Struttura sito, ricerca SEO locale e content plan (Web Agency Salento)

Output di pianificazione: nessun contenuto è stato ancora scritto nelle pagine. Da approvare.

---

## 1. Ricerca sui motori (snapshot 29/09/2026)

Query analizzate: *web agency Salento · agenzia web Salento · realizzazione siti web Salento · SEO Salento · siti web Lecce · web agency Lecce · siti web Gallipoli · siti web Otranto/Nardò/Maglie · siti web Brindisi · web agency Copertino · web marketing turismo Salento · quanto costa un sito web (contesto prezzi IT)*.

### 1.1 Scenario competitivo organico
| Competitor in SERP | Posizionamento | Note per il differenziazione |
| --- | --- | --- |
| **Salento Factory** (Lecce/Matino, 13+ anni) | domina «web agency Salento», «agenzia web Lecce», pagine locali Gallipoli/Taviano, Maglie/Casarano/Nardò, Brindisi, turismo | modello identico di landing locali: serve contenuto più specifico, non più generico |
| **kinGart, thinko, 650mb, Edv, MisterSito, Demonero, extra-web, Octopus** (Lecce) | presidia «realizzazione siti web Lecce», «web agency Lecce», e-commerce, SEO | SERP Lecce affollata: puntare su USP «risposta umana in giornata» + chat |
| **Honeysoup** | «web agency Salento» (pos. 4), posizionamento AI/branding | focus AI: noi restiamo su telefonia/umano |
| **freelance + marketplace** (ProntoPro, StarOfService, PagineBianche, addlance, Yelp) | riempiono Gallipoli, Copertino, long-tail | le pagine locali dedicate battono le directory |
| **DDDigital /agenzia-web-salento** (casa madre) | già in SERP (pos. 8) | coordinare: o resta pagina ponte verso il nuovo sito, o si differenzi il title. ⚠️ decisione richiesta |
| Web Lab24, Lumiaweb, Verbena, weareweb (Brindisi/Gallipoli, fuori zona) | vendono landing locali «a distanza» | vantaggio: noi siamo davvero del territorio |

### 1.2 Intenti di ricerca osservati
- **Commerciale transazionale** (priorità massima): «web agency/agenzia web + località», «realizzazione/creazione siti web + località», «preventivo sito web», «e-commerce + località».
- **Commerciale valutativo**: «quanto costa un sito web», «migliore web agency», confronti con recensioni (PAA Google: «Quanto costa una web agency?», «Chi si occupa di creare siti web?»).
- **Informazionale locale**: «SEO + località», «posizionamento Google + località», «web marketing turismo/B&B».
- **Turismo stagionale** (specifica del Salento, assente a Crema): hotel, B&B, case vacanza, ristoranti sulla rotta Gallipoli–Otranto–Santa Maria di Leuca: piccole strutture senza sito che venda dirette (vs Booking).

### 1.3 FAQ ricorrenti in SERP / PAA
«Quanto costa un sito web / una web agency?» · «Chi crea i siti web?» · «Quanto tempo serve?» · «Vale la pena un sito per una piccola azienda?» · «Come si sceglie una web agency?» → alimentano le FAQPage di ogni landing (schema FAQPage già supportato dal progetto).

### 1.4 Long-tail individuati
«sito web ristorante Gallipoli», «sito per B&B Otranto con prenotazioni», «chi fa e-commerce a Lecce», «restyling sito senza perdere posizioni + località», «consulente SEO Lecce in agenzia», «fotografo/studi professionali Lecce sito», «preventivo sito web Salento in chat», «agenzia web che risponde al telefono».

### 1.5 Rischio duplicazione / cannibalizzazione
- **Vs WebAgencyCrema**: SERP e territorio disgiunti, rischio nullo; vietato copiare testi/meta (già garantito: riscrittura integrale).
- **Vs dddigital.net/agenzia-web-salento**: stesso brand family → coordinare title/H1 e canonical; raccomandato trasformarla in pagina di reindirizzamento o ponte verso il nuovo dominio.
- **Tra pagine locali nostre**: una keyword per pagina (Salento = brand, Lecce = servizio generale, Gallipoli/Otranto/… = turismo/servizi specifici) con blocchi di contenuto realmente diversi (economie locali differenti: Lecce servizi/uffici, coast turismo, interno agroalimentare/artigianato).
- **Vs Salento Factory**: evitare gli stessi slug e gli stessi abbinamenti città→keyword; noi copriamo combinazioni non presidiate (es. Nardò+e-commerce, Copertino+siti, Maglie+SEO).

## 2. Struttura del nuovo sito

Gerarchia invariata (route dinamiche `[slug]`, footer, sticky call, chat, admin) — cambiano contenuti e slug:

```
/                                   Home (hook: barra ricerca → /consulenza?q=)
/consulenza                         Splash ricerca + chat qualifica (script fisso)
/{slug}                             Landing SEO (tabella §3) — 17 pagine
/privacy-policy · /cookie-policy    Legale (dati reali del titolare)
/admin · /setup · /maintenance      Area team / bootstrap / statica
sitemap.ts · robots.ts · /og        Generati dai contenuti (dinamici)
```

Design system, CMS (Neon + admin editor), tema, accessibilità, performance: **identici al sorgente**.

## 3. Content plan — 17 landing (keyword · slug · meta · H1 · CTA · schema)

Priorità: **P1** lancio · **P2** entro 30 gg · **P3** espansione.
Title ≤ 60 car., description 140–155 car. Schema su tutte: LocalBusiness(ref) + Service + FAQPage + BreadcrumbList. CTA condivisa: chat + WhatsApp/telefono Daniele + «richiamo in giornata».

| # | Pr. | Vecchia pagina (equivalente) | Nuova pagina → slug | Keyword primaria | Secondarie | Title | Meta description | H1 | Località | CTA specifica |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | P1 | agenzia-web-crema | **Web agency nel Salento** → `/web-agency-salento` | web agency Salento | agenzia web Salento, digital agency Salento | Web Agency Salento \| Siti web e SEO dal vivo | Web agency nel Salento con team vero in chat e al telefono: preventivo indicativo subito, richiamo in giornata. Lecce, Gallipoli, Otranto. | Web agency nel Salento: siti che portano telefonate | Salento (LE, BR) | Parla in chat col team |
| 2 | P1 | agenzia-web-crema (2ª) | **Web agency a Lecce** → `/web-agency-lecce` | web agency Lecce | agenzia web Lecce, digital marketing Lecce | Web Agency Lecce \| Siti, SEO e preventivo in chat | Web agency a Lecce: siti web, SEO locale ed e-commerce con risposta umana in giornata. Preventivo in 4 domande di chat. | Web agency a Lecce, al telefono e in chat | Lecce | Richiamo in giornata |
| 3 | P1 | creazione-siti-web-crema | **Realizzazione siti web Lecce** → `/realizzazione-siti-web-lecce` | realizzazione siti web Lecce | creazione siti web Lecce, siti internet Lecce | Realizzazione Siti Web Lecce \| Online in 7 giorni | Realizzazione siti web a Lecce in 7 giorni: testi, foto e SEO inclusi, prezzo scritto prima di iniziare. | Realizzazione siti web a Lecce, online in 7 giorni | Lecce | Preventivo in chat |
| 4 | P1 | — (nuova) | **Siti web Gallipoli** → `/siti-web-gallipoli` | siti web Gallipoli | web agency Gallipoli, sito ristorante Gallipoli | Siti Web Gallipoli \| Ristoranti, B&B e negozi | Siti web a Gallipoli per ristoranti, strutture ricettive e negozi del borgo: prenotazioni dirette, foto vere, SEO locale. | Siti web a Gallipoli: diretta col cliente, senza commissioni | Gallipoli | WhatsApp diretto |
| 5 | P1 | — (nuova) | **Siti web Otranto** → `/siti-web-otranto` | siti web Otranto | web agency Otranto, B&B Otranto sito | Siti Web Otranto \| B&B, case vacanza e ristoranti | Siti web a Otranto con prenotazione diretta per B&B e case vacanza: riduci le commissioni dei portali, resto visibile tutto l'anno. | Siti web a Otranto per vivere di turismo tutto l'anno | Otranto | Direct booking check |
| 6 | P1 | — (nuova) | **Siti web Nardò** → `/siti-web-nardo` | siti web Nardò | web agency Nardò, creazione sito Nardò | Siti Web Nardò \| Aziende e professionisti | Siti web a Nardò per aziende, studi e commercianti: preventivo in chat, consegna in 7 giorni, supporto al telefono. | Siti web a Nardò per aziende e professionisti | Nardò | Preventivo in chat |
| 7 | P1 | seo-crema | **SEO Salento** → `/seo-salento` | SEO Salento | SEO Lecce, posizionamento Google Salento | SEO Salento \| Posizionamento locale misurato | SEO nel Salento con report mensili chiari: keyword locali, schede Google ottimizzate e telefonate tracciate, niente promesse vuote. | SEO nel Salento: farsi trovare dove i clienti cercano | Salento | Audit in 10 giorni |
| 8 | P1 | preventivo-sito-web-crema | **Preventivo sito web** → `/preventivo-sito-web` | preventivo sito web Salento | quanto costa un sito web, prezzo sito web | Preventivo Sito Web \| Fasce e prezzi reali | Preventivo sito web in 4 domande di chat: fasce chiare, cosa è incluso, tempi di consegna scritti. Risposta in giornata. | Preventivo sito web, in chat e senza impegno | Salento | Calcola il preventivo |
| 9 | P2 | siti-web-ecommerce-crema | **E-commerce Lecce e Salento** → `/ecommerce-lecce-salento` | e-commerce Lecce | creare shop online Salento, ecommerce Puglia | E-commerce Lecce \| Negozi online gestibili | E-commerce a Lecce e nel Salento: catalogo, pagamenti e spedizioni configurati, formazione inclusa, nessuna royalty. | E-commerce a Lecce e nel Salento, senza impazzire | Lecce + Salento | Demo gestione 1 ora |
| 10 | P2 | posizionamento-google-crema | **Posizionamento Google** → `/posizionamento-google-salento` | posizionamento Google Salento | Google Maps Lecce, prima pagina Google | Posizionamento Google Salento \| Maps e ricerca | Posizionamento su Google per attività del Salento: Maps, recensioni vere e pagine che salgono nelle ricerche locali. Piano a 90 giorni. | Posizionamento Google: Maps + ricerca organica | Salento | Piano 90 giorni |
| 11 | P2 | restyling-sito-web-crema | **Restyling sito web** → `/restyling-sito-web-salento` | restyling sito web Salento | rifare sito web Lecce, migrazione senza perdite | Restyling Sito Web Salento \| Stessa URL, più clienti | Restyling del sito senza perdere il posizionamento: redirect mappati uno a uno, contenuti riscritti, online in 10 giorni. | Restyling sito web senza perdere posizioni | Salento | Analisi sito gratuita |
| 12 | P2 | consulente-digitale-crema | **Consulente digitale** → `/consulente-digitale-lecce` | consulente digitale Lecce | consulenza marketing digitale Salento | Consulente Digitale Lecce \| Piano in 2 pagine | Consulente digitale a Lecce: piano a 90 giorni scritto insieme, riunioni in sede, numeri misurati su GA4. Niente brogliadiri. | Consulente digitale a Lecce, da chiamare al telefono | Lecce | Prima consulenza |
| 13 | P2 | — (nuova, turismo) | **Siti web hotel e B&B** → `/siti-web-hotel-bb-salento` | siti web hotel Salento | sito B&B Salento, booking diretto | Siti Web Hotel e B&B Salento \| Booking diretto | Siti web per hotel, B&B e case vacanza nel Salento: motore di prenotazione diretta, multilingua, SEO turistica stagionale. | Siti web per hotel e B&B nel Salento | Costa salentina | Direct booking audit |
| 14 | P2 | — (nuova) | **Siti web Brindisi** → `/siti-web-brindisi` | siti web Brindisi | web agency Brindisi | Siti Web Brindisi \| Aziende, porti e industria | Siti web a Brindisi per aziende del porto, industria e servizi: preventivo in chat, siti veloci, supporto in italiano. | Siti web a Brindisi per aziende vere | Brindisi (BR) | Preventivo in chat |
| 15 | P3 | siti-web-cremona | **Siti web Maglie** → `/siti-web-maglie` | siti web Maglie | web agency Maglie, Grecìa Salentina | Siti Web Maglie \| dell'interno salentino | Siti web a Maglie e nella Grecìa Salentina: artigiani, agroalimentare e professionisti, con riunione da voi. | Siti web a Maglie e nell'interno del Salento | Maglie + Grecìa Salentina | Preventivo in chat |
| 16 | P3 | siti-web-lodi | **Siti web Copertino** → `/siti-web-copertino` | siti web Copertino | web agency Copertino | Siti Web Copertino \| Artigiani e studi | Siti web a Copertino per artigiani, studi e commercianti: sito in 7 giorni, scheda Google ottimizzata, supporto diretto. | Siti web a Copertino, con chi li costruisce | Copertino | Preventivo in chat |
| 17 | P3 | — (nuova) | **Siti per ristoranti** → `/siti-web-ristoranti-salento` | sito web ristorante Salento | sito ristorante Lecce, menu online | Siti Web Ristoranti Salento \| Menu e prenotazioni | Siti web per ristoranti del Salento: menu aggiornabile, prenotazioni, recensioni Google e foto che fanno venire fame. | Siti web per ristoranti del Salento | Salento | Menu demo |

**Home** (`/`): H1 «Cerchi una web agency nel Salento? Scrivilo nella barra, ti rispondiamo davvero.» — badge sede, areaServita Lecce+Gallipoli+Brindisi nel footer, chip ricerca adattate («Sito web in 7 giorni», «Preventivo e-commerce», «SEO locale», «Restyling sito»).

## 4. Architettura interna e schema markup

- **Internal linking**: home → 6 landing P1; ogni landing → home + 2–3 landing correlate (es. Gallipoli ↔ ristoranti ↔ hotel/B&B; Lecce ↔ realizzazione ↔ e-commerce; Nardò ↔ Maglie ↔ Copertino «interno salentino»); breadcrumb LocalBusiness>Service su tutte; footer: colonna «Servizi» (P1 servizi) + colonna «Zone» (Lecce, Gallipoli, Otranto, Brindisi, Nardò…).
- **Schema markup**: `LocalBusiness` (layout) con areaServed = [Salento, Lecce, Gallipoli, Brindisi, Otranto, Nardò, Maglie, Copertino] · `Service`+`FAQPage`+`BreadcrumbList` per landing (già implementati nel sorgente: si popola solo il contenuto) · aggiunta consigliata `AggregateRating` SOLO con recensioni vere raccolte.
- **URL**: senza «crema», tutti in italiano, un'unica parola-chiave per slug (tabella §3); redirect interni non necessari (DB nuovo).

## 5. Differenziazione dei contenuti (anti-doorway)

Ogni landing locale conterrà: economia locale specifica (turismo/costi/ stagionalità a Gallipoli-Otranto; servizi e studi a Lecce; porto/industria a Brindisi; agroalimentare/artigianato interno), FAQ locali diverse (5 per pagina, nessuna copiata), proof onesta (senza cifre finché il cliente non fornisce i dati §4 audit), riferimenti geografici reali (piazze, vie, rotte turistiche) e CTA coerente col servizio. Minimo 300–350 parole uniche per pagina: nessun template con sola città sostituita.

## 6. Tabella di stato «vecchia → nuova» (tracker di produzione)

| Vecchia pagina Crema | Nuova pagina Salento | Keyword | Località | Stato |
| --- | --- | --- | --- | --- |
| Home | Home | web agency Salento | Salento | 📝 da riscrivere |
| (—) | /web-agency-salento | web agency Salento | Salento | 📝 nuova |
| /agenzia-web-crema | /web-agency-lecce | web agency Lecce | Lecce | 📝 |
| /creazione-siti-web-crema | /realizzazione-siti-web-lecce | realizzazione siti web Lecce | Lecce | 📝 |
| (—) | /siti-web-gallipoli | siti web Gallipoli | Gallipoli | 📝 nuova |
| (—) | /siti-web-otranto | siti web Otranto | Otranto | 📝 nuova |
| (—) | /siti-web-nardo | siti web Nardò | Nardò | 📝 nuova |
| /seo-crema | /seo-salento | SEO Salento | Salento | 📝 |
| /preventivo-sito-web-crema | /preventivo-sito-web | preventivo sito web | Salento | 📝 |
| /siti-web-ecommerce-crema | /ecommerce-lecce-salento | e-commerce Lecce | Lecce+Salento | 📝 |
| /posizionamento-google-crema | /posizionamento-google-salento | posizionamento Google | Salento | 📝 |
| /restyling-sito-web-crema | /restyling-sito-web-salento | restyling sito web | Salento | 📝 |
| /consulente-digitale-crema | /consulente-digitale-lecce | consulente digitale Lecce | Lecce | 📝 |
| (—) | /siti-web-hotel-bb-salento | siti web hotel Salento | Costa | 📝 nuova |
| (—) | /siti-web-brindisi | siti web Brindisi | Brindisi | 📝 nuova |
| /siti-web-cremona | /siti-web-maglie | siti web Maglie | Maglie | 📝 |
| /siti-web-lodi | /siti-web-copertino | siti web Copertino | Copertino | 📝 |
| (—) | /siti-web-ristoranti-salento | sito ristorante Salento | Salento | 📝 nuova |

Legenda stati: 📝 da scrivere · ✍️ in bozza · ✅ pubblicata (nessuna ✅: non è stato ancora modificato nulla).

## 7. Cosa serve decidere/fornire per procedere (bloccanti e non)

1. Approvazione del piano (slug, priorità P1, home) → sblocca STEP 3.
2. Dominio definitivo + email → placeholder chiari finché non arriva.
3. Team turni Salento (secondo operatore oltre a Daniele?) → seed DB + home + chat.
4. Indirizzo sede + P.IVA → JSON-LD e privacy policy.
5. Prove/numeri reali → altrimenti proof senza cifre.
6. Destinazione pagina dddigital.net/agenzia-web-salento → evitare cannibalizzazione.
