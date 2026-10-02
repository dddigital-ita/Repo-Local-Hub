/**
 * Config centrale del sito. I dati "societari" veri si impostano in .env
 * (vedi .env.example): qui c'è la struttura e i default di produzione.
 */

/** Numeri VERI del team: i placeholder «000» delle env non devono mai
 *  raggiungere il sito pubblico (header, footer, sticky, JSON-LD). */
const REAL_PHONE = "+393202792782"; // Michele (anche WhatsApp)
const REAL_PHONE_SECONDARY = "+393200865907"; // Daniele (turno mattina, uso interno)

/** La env vale solo se è un numero plausibile: «+390000000000» o «000…» → default reale. */
function safePhone(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v || /0{6,}/.test(v) || v.replace(/\D/g, "").length < 9) return fallback;
  return v;
}

export const site = {
  name: process.env.NEXT_PUBLIC_AGENCY_NAME || "Web Agency Crema",
  legalName: process.env.NEXT_PUBLIC_AGENCY_LEGAL_NAME || "Web Agency Crema S.r.l.",
  // In sviluppo .env.local imposta http://localhost:3000; in produzione Vercel
  // imposterà https://www.webagencycrema.com
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://www.webagencycrema.com",
  // Telefono PRINCIPALE del sito: Michele (lato commerciale, turno 15-19).
  // È il numero che risponde su WhatsApp: footer, sticky mobile, landing
  // e JSON-LD LocalBusiness. In header c'è SOLO il bottone WhatsApp.
  phone: safePhone(process.env.NEXT_PUBLIC_AGENCY_PHONE, REAL_PHONE),
  email: process.env.NEXT_PUBLIC_AGENCY_EMAIL || "info@webagencycrema.com",
  // Indirizzo e P.IVA restano configurabili (li usa la privacy policy),
  // ma NON sono più mostrati nel footer pubblico.
  vat: process.env.NEXT_PUBLIC_AGENCY_VAT || "P.IVA 00000000000",
  address: process.env.NEXT_PUBLIC_AGENCY_ADDRESS || "Via Example 1, 26013 Crema (CR)",
  // Il secondo numero del team (Daniele, turni mattina) resta per uso interno
  // (notifiche, turni): il sito pubblico espone solo il principale.
  phoneSecondary: safePhone(process.env.NEXT_PUBLIC_AGENCY_PHONE_SECONDARY, REAL_PHONE_SECONDARY),
  /**
   * Titolare del trattamento: la casa madre (questo sito è a branch by DDDigital).
   * Usato da privacy policy e cookie policy.
   */
  privacyController: {
    name: "Daniele De Donnantonio",
    address: "Via Mameli 1, 73030 Castro (LE) — Italia",
    website: "https://dddigital.net",
    email: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "info@dddigital.net",
  },
  /** Alias per le parti del sito che chiedono «email privacy» (chat, policy). */
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "info@dddigital.net",
};

/**
 * Numeri e link di contatto PRINCIPALI del sito (Michele). Un solo posto da
 * cui leggere: header, footer, sticky, landing e JSON-LD così restano
 * allineati per forza — e se il numero cambia si tocca solo qui.
 */
export const contacts = (() => {
  const digits = site.phone.replace(/\D/g, "");
  const pretty = digits.startsWith("39") && digits.length === 12 ? digits.slice(2) : digits;
  return {
    phone: site.phone,
    phoneDisplay: `+39 ${pretty.slice(0, 3)} ${pretty.slice(3, 6)} ${pretty.slice(6)}`,
    telHref: `tel:${site.phone}`,
    /** wa.me per WhatsApp: solo cifre, senza «+» e senza prefisso tel:. */
    whatsapp: `https://wa.me/${digits}`,
    whatsappIntl: digits,
  };
})();

export const PRODUCTION_DOMAIN = "webagencycrema.com";

export const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID || "";
export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || "";

export const PROVINCE_INFO: Record<string, { name: string; province: string; blurb: string }> = {
  crema: {
    name: "Crema",
    province: "CR",
    blurb:
      "Crema è il nostro quartier generale: lavoriamo con negozi del centro storico, attività di via " +
      "Bergamo e studi professionali di tutta la provincia. Ci vediamo volentieri faccia a faccia, " +
      "in sede o da voi.",
  },
  cremona: {
    name: "Cremona",
    province: "CR",
    blurb:
      "Seguiamo già diverse aziende cremonesi del comparto alimentare e meccanico: sappiamo cosa " +
      "significa vendere a clienti che prima passano in fiera a Cremona e poi cercano su Google.",
  },
  lodi: {
    name: "Lodi",
    province: "LO",
    blurb:
      "Da Lodi ci arrivano molte richieste di e-commerce B2B e siti per studi tecnici: distanza " +
      "breve, chiamate in orario di ufficio e consegne rapide.",
  },
};

export interface LandingContent {
  slug: string;
  h1: string;
  /** Title ≤ 60 caratteri, description unica per il meta. */
  title: string;
  description: string;
  /** Keyword principale e secondarie (usate in H2, FAQ e JSON-LD). */
  keyword: string;
  keywords: string[];
  city: string; // chiave di PROVINCE_INFO
  /** Breadcrumb: [{ nome, url }] */
  breadcrumb: { name: string; href: string }[];
  /** 300–500 parole UNICHE: apro con la domanda reale del cliente, poi contesto locale, poi metodo. */
  intro: string[];
  services: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  proof: string;
  serviceType: string; // per schema.org Service
}

const L = (s: string) => s.replace(/\s+/g, " ").trim();

export const LANDINGS: LandingContent[] = [
  {
    slug: "agenzia-web-crema",
    h1: "Agenzia web a Crema: siti che portano telefonate",
    title: "Agenzia web Crema | Siti e SEO dal vivo",
    description:
      "Agenzia web a Crema con team in sede: parli in chat, ricevi il preventivo in giornata e ti richiamiamo in orario di ufficio.",
    keyword: "agenzia web Crema",
    keywords: ["agenzia web Crema", "web agency Crema", "siti internet Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Agenzia web Crema", href: "/agenzia-web-crema" },
    ],
    intro: [
      L(`"Mi serve un'agenzia web a Crema che mi risponda davvero" — la frase che sentiamo più spesso.
      Nelle campagne che fatte male trovi chat bot che girano in tondo e preventivi che arrivano dopo due
      settimane. Noi facciamo l'inverso: cerchi, scrivi in chat, e una persona vera ti richiama in giornata.`),
      L(`Siamo una squadra piccola apposta: designer, sviluppatore e chi fa SEO è la stessa persona che
      risponde al telefono. Le riunioni sono 10 minuti davanti a un caffè in piazza Duomo, non call da
      un'ora. I clienti che abbiamo a Crema — ristoranti del centro, artigiani, studi medici — arrivano
      per il sito e restano per la consulenza: il nostro fatturato di repetition è oltre il 70%.`),
      L(`Il metodo è semplice: prima capiamo quanti clienti vuoi in più al mese, poi scegliamo insieme
      il canale (sito nuovo, Google, e-commerce) e misuriamo tutto su GA4. Se un intervento non porta
      richieste, ti diciamo di non farlo. Prefersimo perdere un progetto che vendere orari inutili.`),
    ],
    services: [
      { title: "Siti vetrina in 7 giorni", text: "Struttura chiara, testi scritti da noi, online in una settimana con foto vere." },
      { title: "SEO locale", text: "Google Maps, scheda Business e pagine che si posizionano per le ricerche di Crema e provincia." },
      { title: "E-commerce", text: "Negozi online con pagamenti, spedizioni e gestione ordini semplificata." },
      { title: "Assenza di vincoli", text: "Il sito resta tuo: hosting e dominio intestati a te, nessun riscatto." },
    ],
    faq: [
      {
        q: "Siete un'agenzia con sede a Crema o lavorate da remoto?",
        a: "Sede in centro a Crema: ci si può venire a trovare, e per i progetti locali preferiamo una riunione iniziale di persona.",
      },
      {
        q: "Quanto costa un progetto con la vostra agenzia?",
        a: "I siti vetrina partono da 800 €, l'e-commerce da 2.500 €. La chat ti dà il preventivo indicativo in 4 domande.",
      },
      {
        q: "Quanti progetti seguite allo stesso tempo?",
        a: "Al massimo 6: è il motivo per cui consegniamo in tempi e rispondiamo velocemente al telefono.",
      },
      {
        q: "Posso aggiornare io il sito dopo la consegna?",
        a: "Sì: consegniamo un pannello di editing e un video di formazione di 30 minuti registrato per te.",
      },
      {
        q: "Seguite anche clienti fuori provincia?",
        a: "Volentieri, ma le riunioni diventano in video: i progetti da 10 minuti in sede restano il nostro punto di forza.",
      },
    ],
    proof:
      "Oltre 40 progetti consegnati dal 2021 a Crema e provincia, con clienti che oggi puntano il nostro numero sul vetro del negozio.",
    serviceType: "Agenzia web",
  },
  {
    slug: "creazione-siti-web-crema",
    h1: "Creazione siti web a Crema: online in 7 giorni",
    title: "Creazione siti web Crema | Online in 7 giorni",
    description:
      "Creazione siti web a Crema in 7 giorni: struttura, testi e foto gestiti da noi, chat diretta col team e prezzo chiaro prima di iniziare.",
    keyword: "creazione siti web Crema",
    keywords: ["creazione siti web Crema", "realizzazione siti web Crema", "chi fa siti web a Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Creazione siti web Crema", href: "/creazione-siti-web-crema" },
    ],
    intro: [
      L(`Cerchi la creazione di un sito web a Crema e hai già chiesto tre preventivi tutti diversi?
      È normale: molti preventivi contano "ore di consulenza" che poi non vedi. Noi facciamo il
      contrario: prezzo invariato per progetto, elenco di cosa è incluso e data di consegna scritta
      nel contratto.`),
      L(`I nostri 7 giorni sono veri: giorno 1 la call di scoperta, giorni 2–3 struttura e testi,
      giorni 4–5 design e sviluppo, giorno 6 le tue correzioni, giorno 7 pubblica. Se una cosa non
      entra nei 7 giorni te lo diciamo prima di firmare, non dopo tre settimane di silenzio.`),
      L(`Per la creazione usiamo foto fatte da te o da un fotografo amico (40 € l'ora, scontato per
      i nostri clienti), mai stock generici: i clienti di Crema riconoscono il tuo negozio nelle foto
      e si fidano di più. Il sito è tuo: dominio e hosting a tuo nome.`),
    ],
    services: [
      { title: "Sito vetrina 7 giorni", text: "5 pagine, form contatti, recensioni Google incorporate e SEO base inclusa." },
      { title: "Siti con prenotazioni", text: "Per studi, saloni e ristoranti: calendario appuntamenti e promemoria WhatsApp." },
      { title: "Landing di campagna", text: "Una pagina per una campagna specifica, pronta in 48 ore, con tracciamento GA4." },
      { title: "Formazione inclusa", text: "Video di 30 minuti su come aggiornare i contenuti da solo." },
    ],
    faq: [
      {
        q: "Cosa succede se non ho i contenuti pronti?",
        a: "Li scriviamo noi partendo da un'intervista di 20 minuti: testi e struttura sono inclusi nel prezzo.",
      },
      {
        q: "Il dominio lo devo comprare io?",
        a: "Te lo intestiamo a te in fase di registrazione: 12 €/anno circa, pagati direttamente al registrar.",
      },
      {
        q: "Posso vedere il sito prima che sia pubblicato?",
        a: "Sì: anteprima online dal giorno 3 e un ciclo di correzioni incluso in giorno 6.",
      },
      {
        q: "Come funzionano i pagamenti?",
        a: "50% all'avvio e 50% alla pubblicazione, fattura elettronica, nessuna penale se consegniamo in ritardo.",
      },
      {
        q: "E se dopo un anno volessi cambiare agenzia?",
        a: "Ti consegniamo file, accessi e backup: cambiare non deve costarti il sito.",
      },
    ],
    proof:
      "Tempo medio di pubblicazione negli ultimi 12 mesi: 8,5 giorni dal primo contatto, contratto incluso.",
    serviceType: "Creazione siti web",
  },
  {
    slug: "siti-web-ecommerce-crema",
    h1: "E-commerce a Crema: vendi online senza impazzire",
    title: "E-commerce Crema | Negozi online gestibili",
    description:
      "Realizziamo e-commerce per le aziende di Crema: catalogo, spedizioni e pagamenti configurati, formazione alla gestione inclusa nel prezzo.",
    keyword: "e-commerce Crema",
    keywords: ["e-commerce Crema", "negozi online Crema", "creare shop online Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "E-commerce Crema", href: "/siti-web-ecommerce-crema" },
    ],
    intro: [
      L(`Un e-commerce a Crema ha un vantaggio che a Milano non esiste: la clientela di zona ordina e
      passa a ritirare in negozio. Progettiamo i tuoi negozi online partendo da questo: ritiro in
      sede, consegna in giornata nel Cremasco, pagamenti con carta o in contrassegno.`),
      L(`Costruiamo su piattaforme gestibili: cataloghi da 30 a 3.000 prodotti, varianti, listini B2B
      con prezzi riservati, sconti per quantità. La gestione quotidiana la impari in un'ora di
      formazione registrata: aggiungere un prodotto deve richiedere due minuti, non un ticket.`),
      L(`Gli ordini arrivano con email e notifica Telegram; le spedizioni si etichettano con un click
      tramite i corrieri italiani. E se un giorno vuoi vendere all'estero, la struttura resta quella:
      si aggiungono lingue e vetrine di zona senza rifare tutto.`),
    ],
    services: [
      { title: "Shop B2C", text: "Catalogo, carrello, pagamenti Stripe/PayPal, spedizioni con tariffe reali." },
      { title: "Portali B2B", text: "Listini riservati, minimi d'ordine, ordini ripetibili in un click." },
      { title: "Ritiro in negozio", text: "Consegna locale in giornata nel Cremasco configurata di default." },
      { title: "Feed Google Shopping", text: "I tuoi prodotti su Google con foto, prezzi e disponibilità sincronizzati." },
    ],
    faq: [
      {
        q: "Quanto costa un e-commerce vostro?",
        a: "Da 3.000 € per un catalogo base fino a 8.000 € per configurazioni B2B: il preventivo della chat divide le fasce subito.",
      },
      {
        q: "Quanto tempo serve per andare online?",
        a: "3–4 settimane: una settimana di struttura, due di catalogo e prove di ordine, una di formazione e avvio.",
      },
      {
        q: "Quante commissioni pago sul venduto?",
        a: "Solo quelle del gestore pagamenti (da 1,5%): nessuna royalty mensile all'agenzia.",
      },
      {
        q: "Posso importare il catalogo che ho già in Excel?",
        a: "Sì: facciamo l'import per te la prima volta e ti consegniamo il file modello per gli aggiornamenti.",
      },
      {
        q: "Gestite anche le foto dei prodotti?",
        a: "Su fondo bianco sì, con shooting in sede: 30 prodotti al giorno, listino chiaro prima di partire.",
      },
    ],
    proof:
      "Il negozio di ceramiche che abbiamo aperto a marzo fattura online il 22% del totale: ordini medi superiori al negozio fisico.",
    serviceType: "E-commerce",
  },
  {
    slug: "seo-crema",
    h1: "SEO a Crema: farsi trovare in zona",
    title: "SEO Crema | Posizionamento locale misurato",
    description:
      "SEO a Crema con report mensili chiari: keyword locali, schede Google ottimizzate e contenuti che portano telefonate vere.",
    keyword: "SEO Crema",
    keywords: ["SEO Crema", "consulente SEO Crema", "ottimizzazione sito Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "SEO Crema", href: "/seo-crema" },
    ],
    intro: [
      L(`La SEO a Crema è una corsa in 10 piste piccole, non in una gigante: "dentista Crema",
      "fabbro Ricengo", "agrimensore Crema". Chi ottimizza per parole generiche perde; chi mappa le
      ricerche locali porta in ufficio telefonate che arrivano a 3 minuti di macchina.`),
      L(`Il nostro lavoro parte da un audit di 40 pagine: tecnica, testi, scheda Google Business e
      recensioni. Poi un piano mensile con 3 interventi per volta, misurati su GA4 e Search Console.
      Il report è una pagina: posizioni, clic, richieste arrivate dal sito. Niente grafici decorativi.`),
      L(`Non vendiamo posizioni in prima pagina (nessuno può garantirla): vendiamo un metodo che in
      12 mesi ha portato medie di +180% di richieste locali nei clienti seguiti con costanza. Se
      dopo 4 mesi i numeri non girano, ti diciamo di fermare il contratto.`),
    ],
    services: [
      { title: "Audit SEO completo", text: "Tecnica, contenuti e reputazione locale: 40 pagine analizzate in 10 giorni." },
      { title: "Google Business Profile", text: "Ottimizzazione scheda, categorie, foto e gestione recensioni." },
      { title: "Contenuti locali", text: "Pagine di servizio per le frazioni e le ricerche della tua zona." },
      { title: "Report mensili", text: "Una pagina: posizioni, clic, telefonate tracciate. Lettura in 3 minuti." },
    ],
    faq: [
      {
        q: "Quanto tempo serve per vedere risultati?",
        a: "Prime variazioni in 6–8 settimane, risultati stabili dopo 4–6 mesi di lavoro continuo.",
      },
      {
        q: "Quanto costa la consulenza SEO mensile?",
        a: "Da 400 € al mese per le attività locali: SEO Locale, niente contratti oltre 12 mesi.",
      },
      {
        q: "Fate anche i contenuti o solo l'ottimizzazione?",
        a: "Entrambi: scriviamo noi le pagine locali, tu le approvi in un giro di revisione.",
      },
      {
        q: "Serve ridisegnare il sito per fare SEO?",
        a: "No: se il sito è decente si lavora sui contenuti. Ti diciamo quando il ridisegno è davvero necessario.",
      },
      {
        q: "Misurate anche le telefonate?",
        a: "Sì: con tracciamento GA4 sulle chiamate dal sito e numeri di verifica sui clienti più esigenti.",
      },
    ],
    proof:
      "12 mesi di contratti SEO attivi su 14 progetti locali: media di +180% di richieste dal sito, dati GA4 in mano al cliente.",
    serviceType: "SEO",
  },
  {
    slug: "posizionamento-google-crema",
    h1: "Posizionamento su Google a Crema: Maps + ricerca",
    title: "Posizionamento Google Crema | Maps e ricerca",
    description:
      "Posizionamento su Google per attività di Crema: scheda Business, recensioni e pagine che salgono nella ricerca locale.",
    keyword: "posizionamento Google Crema",
    keywords: ["posizionamento Google Crema", "prima pagina Google Crema", "Google Maps Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Posizionamento Google Crema", href: "/posizionamento-google-crema" },
    ],
    intro: [
      L(`Il posizionamento su Google a Crema si gioca su due tavoli insieme: i risultati della Maps
      (il "3-pack" con le stelle) e la ricerca organica. Molte agenzie lavorano solo su uno: noi
      facciamo entrambi, perché il cliente cerca dove capita, non dove ti conviene.`),
      L(`Sulla Maps si vince con recensioni vere e costanti, categorie corrette, foto aggiornate e
      post periodici. Nella ricerca si vince con pagine che rispondono alle domande della zona, siti
      veloci e dati strutturati. Costruiamo un piano di 90 giorni con obiettivi misurabili: quante
      parole in prima pagina, quanti clic, quante chiamate.`),
      L(`Ogni settimana guardiamo Search Console insieme in un report di una pagina: se una pagina
      non sale, la cambiamo; se sale ma non chiama, la riscriviamo. Il posizionamento non è uno
      scatto, è un allenamento: chi smette al secondo mese, ricomincia da capo a settembre.`),
    ],
    services: [
      { title: "Ottimizzazione Maps", text: "Categorie, orari, foto e post settimanali per il 3-pack locale." },
      { title: "Piano recensioni", text: "Sistema semplice per raccogliere recensioni vere dai clienti soddisfatti." },
      { title: "Pagine di zona", text: "Contenuti dedicati alle ricerche dei comuni del Cremasco." },
      { title: "Monitoraggio 90 giorni", text: "Obiettivi scritti, report settimanali, correzioni a vista." },
    ],
    faq: [
      {
        q: "Posso arrivare primo su Google a Crema?",
        a: "Sulle ricerche locali specifiche spesso sì, in 3–6 mesi; su parole generali dipende dalla concorrenza. Mai promesse alla cieca.",
      },
      {
        q: "Compro qualche posizione con gli annunci?",
        a: "Gli annunci sono un canale separato: li gestiamo se ti serve traffico immediato mentre la SEO cresce.",
      },
      {
        q: "Le recensioni le compro?",
        a: "No, è illegale e Google lo banna: ti diamo un sistema per averle vere dai clienti contenti.",
      },
      {
        q: "Cosa succede se smetto di lavorare con voi?",
        a: "Le posizioni calano lentamente, non spariscono: e ti consegniamo tutto il lavoro fatto in documenti tuoi.",
      },
      {
        q: "Seguite anche i comuni attorno a Crema?",
        a: "Sì: Ricengo, Offanengo, Ivrea di Crema... ogni comune ha ricerche sue che valgono clienti.",
      },
    ],
    proof:
      "Il 3-pack di Maps è il 44% dei clic nelle ricerche locali: per i nostri clienti di Crema è la prima fonte di telefonate.",
    serviceType: "Posizionamento Google",
  },
  {
    slug: "restyling-sito-web-crema",
    h1: "Restyling sito web a Crema: stesso sito, più clienti",
    title: "Restyling sito web Crema | Più clienti, stessa URL",
    description:
      "Restyling del tuo sito a Crema senza perdere il posizionamento: migrazione sicura, contenuti rifatti, tempi da 10 giorni.",
    keyword: "restyling sito web Crema",
    keywords: ["restyling sito web Crema", "rifare sito web Crema", "aggiornare sito Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Restyling sito web Crema", href: "/restyling-sito-web-crema" },
    ],
    intro: [
      L(`Il restyling del sito web a Crema fallisce in un modo preciso: sito nuovo bello, posizionamento
      azzerato perché le vecchie pagine sono sparite. Noi migriamo con la mappa dei redirect: ogni
      vecchio indirizzo trova casa nuova, e Google lo sa in giornata.`),
      L(`Prima di rifare, valutiamo: se il sito ha 5 pagine e contenuti vecchi di 8 anni, conviene
      rifare da capo in 7 giorni. Se ha 60 pagine indicizzate che portano traffico, il restyling è
      chirurgico: cambiamo struttura, teniamo le URL che rendono. Ti mostriamo i dati prima di
      decidere, insieme.`),
      L(`Il restyling medio dura 10 giorni lavorativi: 2 di analisi e mappa, 4 di contenuti e design,
      2 di sviluppo, 2 di prove e migrazione. Il sito vecchio resta visibile fino all'ultimo momento:
      nessun "sotto costruzione" per settimane.`),
    ],
    services: [
      { title: "Migrazione senza perdite", text: "Redirect 301 mappati uno a uno, Search Console aggiornata." },
      { title: "Contenuti rifatti", text: "Testi riscritti per le ricerche di oggi, non quelle del 2015." },
      { title: "Velocità recuperata", text: "Da 6 secondi a 1,5 secondi di caricamento sui telefoni." },
      { title: "GA4 e monitoraggio", text: "Ripuliamo i tracciamenti e ti fai vedere chi arriva e cosa cerca." },
    ],
    faq: [
      {
        q: "Perdo il posizionamento se rifaccio il sito?",
        a: "Con la mappa dei redirect no: i clienti migrati negli ultimi 12 mesi hanno tenuto il 95% del traffico.",
      },
      {
        q: "Meglio restyling o sito nuovo?",
        a: "Dipende da quanto il sito attuale vale su Google: guardiamo i dati insieme e ti diciamo la verità.",
      },
      {
        q: "Quanto costa un restyling?",
        a: "Da 800 € per siti piccoli a 2.500 € per strutture da 20+ pagine: il preventivo della chat entra nel dettaglio.",
      },
      {
        q: "Il sito resta offline durante il lavoro?",
        a: "Mai: lavori sul sito vecchio finché il nuovo non è pronto su dominio di prova.",
      },
      {
        q: "Rifate anche i contenuti?",
        a: "Sì: testi, foto e struttura li ripensiamo noi partendo dalle ricerche che portano clienti oggi.",
      },
    ],
    proof:
      "Ultimo restyling consegnato: da 6,2 secondi a 1,4 secondi di caricamento e +61% di richieste in due mesi.",
    serviceType: "Restyling sito web",
  },
  {
    slug: "consulente-digitale-crema",
    h1: "Consulente digitale a Crema, da chiamare al telefono",
    title: "Consulente digitale Crema | Parli con persone vere",
    description:
      "Consulenza digitale a Crema senza fronzoli: un piano di 90 giorni scritto insieme, riunioni in sede e numeri misurati su GA4.",
    keyword: "consulente digitale Crema",
    keywords: ["consulente digitale Crema", "consulenza marketing digitale Crema", "web consultant Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Consulente digitale Crema", href: "/consulente-digitale-crema" },
    ],
    intro: [
      L(`Cercavi un consulente digitale a Crema e ti sono arrivati brogliadiri da 40 slide? Qui il
      consulente si chiama con nome e cognome, ti risponde al telefono e scrive il piano su due
      pagine: cosa facciamo nei primi 90 giorni, quanto costa, come si misura.`),
      L(`La consulenza parte da una domanda: quanti clienti in più vuoi al mese e da quale canale?
      Se la risposta è "più telefonate dai clienti locali", il piano è SEO locale + sito che converte
      + Google Business. Se è "vendere fuori provincia", il piano cambia: campagne e contenuti
      diversi, tempi diversi. Non vendiamo lo stesso pacchetto a tutti.`),
      L(`Ci vediamo una volta al mese in sede o da te: un'ora, con i numeri davanti, decisioni prese
      sul posto. Tra le riunioni ti scriviamo su Telegram o WhatsApp: risposta in giornata, non
      "ti ricontattiamo entro 5 giorni lavorativi".`),
    ],
    services: [
      { title: "Piano 90 giorni", text: "Obiettivi, canali, budget e misurazioni scritti su due pagine." },
      { title: "Riunione mensile", text: "Un'ora con i dati, in sede o da te, decisioni prese sul posto." },
      { title: "Telegram diretto", text: "Domanda veloce → risposta in giornata, senza ticket." },
      { title: "Audit iniziale", text: "Sito, Google, concorrenti locali: cosa funziona e cosa perdiamo." },
    ],
    faq: [
      {
        q: "Consulenza una tantum o contratto mensile?",
        a: "Entrambi: audit e piano da 400 € una tantum, poi si decide mese per mese se continuare.",
      },
      {
        q: "Che differenza c'è col marketing digitale di agenzia?",
        a: "Nessuna: il consulente che ti segue lavora dentro l'agenzia, con gli stessi sviluppatori e designer.",
      },
      {
        q: "Seguite anche le piattaforme social?",
        a: "Sì, ma solo se il piano dice che servono: non facciamo post per abitudine.",
      },
      {
        q: "Come misuriamo se funziona?",
        a: "GA4 e Search Console: richieste arrivate, chiamate, preventivi. Numeri tuoi, accessi tuoi.",
      },
      {
        q: "Serve cambiare sito per iniziare la consulenza?",
        a: "No: se il sito regge, si lavora sui canali. Ti diciamo quando il sito è il collo di bottiglia.",
      },
    ],
    proof:
      "Riunioni mensili in sede dal 2021 con una dozzina di aziende del Cremasco: il piano resta su due pagine, sempre.",
    serviceType: "Consulenza digitale",
  },
  {
    slug: "preventivo-sito-web-crema",
    h1: "Preventivo sito web a Crema in 4 domande",
    title: "Preventivo sito web Crema | In chat, subito",
    description:
      "Preventivo per un sito web a Crema in 4 domande di chat: prezzo indicativo subito, richiamo in giornata se ti interessa.",
    keyword: "preventivo sito web Crema",
    keywords: ["preventivo sito web Crema", "quanto costa un sito web Crema", "prezzo sito Crema"],
    city: "crema",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Preventivo sito web Crema", href: "/preventivo-sito-web-crema" },
    ],
    intro: [
      L(`Vuoi un preventivo per un sito web a Crema senza passare da tre telefonate? Qui funziona così:
      scrivi cosa cerchi nella barra, rispondi a 4 domande da 10 secondi e vedi subito la fascia di
      prezzo. Se ti torna, ti richiamiamo in giornata con il numero definitivo.`),
      L(`Le fasce sono due e mezza: vetrina 800–1.500 €, e-commerce 2.500–8.000 €, progetti con
      integrazioni su misura sopra. Nel prezzo sono inclusi testi, SEO base, formazione e il primo
      anno di manutenzione tecnica. Non ci sono costi "sorpresa": le cose fuori preventivo si
      quottano prima di farle, mai dopo.`),
      L(`Il preventivo vale 30 giorni e resta scritto: cosa è incluso, quando consegna, come si paga.
      Se un altro preventivo è più basso, ti diciamo cosa non c'è dentro — spesso sono i testi, la
      velocità o la SEO. A volte conviene comunque: ti diciamo anche questo.`),
    ],
    services: [
      { title: "Fascia vetrina", text: "800–1.500 €: 5 pagine, testi, SEO base, online in 7 giorni." },
      { title: "Fascia e-commerce", text: "3.000–8.000 €: catalogo, pagamenti, spedizioni, formazione." },
      { title: "Fascia su misura", text: "Integrazioni, portali B2B, automazioni: preventivo dedicato in 48 ore." },
      { title: "Preventivo scritto", text: "Vale 30 giorni: cosa è incluso, quando consegna, come si paga." },
    ],
    faq: [
      {
        q: "Quanto costa in media un sito a Crema?",
        a: "Per le PMI locali tra 800 e 3.000 €: sotto quel prezzo mancano quasi sempre testi e SEO.",
      },
      {
        q: "Il preventivo impegna a qualcosa?",
        a: "No: è scritto e vale 30 giorni, decidi tu con calma e nessuno ti richiama se non lo chiedi.",
      },
      {
        q: "Ci sono costi annuali?",
        a: "Dominio (~12 €) e hosting (~100–200 €/anno): restano intestati a te, li gestisci come vuoi.",
      },
      {
        q: "Perché i prezzi dei concorrenti variano tanto?",
        a: "Perché contano cose diverse: testi scritti, velocità, SEO e formazione sono le voci che spariscono nei preventivi bassi.",
      },
      {
        q: "Posso pagare a rate?",
        a: "Sì: 50% all'avvio, 25% all'anteprima, 25% alla pubblicazione senza interessi.",
      },
    ],
    proof:
      "Preventivi consegnati entro 24 ore nel 2025: 100%. Tempo medio di risposta alla chat: 4 minuti in orario di ufficio.",
    serviceType: "Preventivo sito web",
  },
  {
    slug: "siti-web-cremona",
    h1: "Siti web a Cremona, dal team di Crema",
    title: "Siti web Cremona | Team a 40 minuti",
    description:
      "Siti web per aziende di Cremona: progettazione in video o in sede, consegna in 7 giorni e supporto in italiano vero.",
    keyword: "siti web Cremona",
    keywords: ["siti web Cremona", "web agency Cremona", "creazione sito Cremona"],
    city: "cremona",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Cremona", href: "/siti-web-cremona" },
    ],
    intro: [
      L(`I siti web a Cremona hanno un pubblico particolare: aziende del torrone e della meccanica,
      negozi del centro storico, studi che seguono tutta la provincia. Il cliente cremonese cerca
      prima in Maps e poi chiede al commerciale: il sito deve reggere entrambi i momenti.`),
      L(`Da Crema siamo a 40 minuti da Cremona: la riunione d'avvio la facciamo da voi, in sala
      riunioni o al bar sotto l'ufficio. Il sito si costruisce in 7 giorni con anteprima online
      dal terzo giorno, e le chiamate di supporto le risponde chi ha fatto il sito, non un
      call center.`),
      L(`Per i clienti di Cremona il pacchetto tipico è sito vetrina + scheda Google Business
      ottimizzata + pagine di servizio per le frazioni: Casalmaggiore, Soresina, Crema stessa per
      chi vende in doppia zona. Il tracciamento GA4 parte dal primo giorno, così le decisioni si
      prendono sui numeri.`),
    ],
    services: [
      { title: "Riunione a Cremona", text: "Avvio progetti da voi, in sede: 1 ora e si parte." },
      { title: "Siti in 7 giorni", text: "Struttura, testi e foto gestiti da noi, anteprima online dal giorno 3." },
      { title: "Pagine di zona", text: "Contenuti per Casalmaggiore, Soresina e i comuni della provincia." },
      { title: "Supporto diretto", text: "Telefono e chat rispondono a chi ha costruito il sito." },
    ],
    faq: [
      {
        q: "Venite a Cremona per le riunioni?",
        a: "Sì: la riunione d'avvio si fa da voi, le successive volentieri in video o al telefono.",
      },
      {
        q: "Quanto costa un sito per un'azienda di Cremona?",
        a: "Le stesse fasce di Crema: vetrina 800–1.500 €, e-commerce 2.500–8.000 €.",
      },
      {
        q: "Seguite anche la SEO a Cremona?",
        a: "Sì: le ricerche di Cremona hanno una concorrenza diversa da Crema, si lavora con un piano dedicato.",
      },
      {
        q: "Chi mantiene il sito dopo la consegna?",
        a: "Noi: manutenzione tecnica inclusa il primo anno, aggiornamenti contenuti a chiamata.",
      },
      {
        q: "Avete clienti in provincia di Cremona?",
        a: "Sì: alimentare, meccanica e negozi del centro. Chiedici i riferimenti, te li diamo.",
      },
    ],
    proof:
      "Prima azienda cremonese seguita dal 2022: oggi il sito porta il 60% delle richieste del commerciale.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-lodi",
    h1: "Siti web a Lodi: velocità e supporto in italiano",
    title: "Siti web Lodi | Consegna in 7 giorni",
    description:
      "Siti web per attività di Lodi e provincia: preventivo in chat, consegna in 7 giorni, supporto al telefono con chi l'ha costruito.",
    keyword: "siti web Lodi",
    keywords: ["siti web Lodi", "web agency Lodi", "creazione sito web Lodi"],
    city: "lodi",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Lodi", href: "/siti-web-lodi" },
    ],
    intro: [
      L(`A Lodi i siti web che funzionano sono quelli che caricano in un secondo e rispondono al
      telefono: clienti di zona, studio e artigianato, agricoltura di pianura che vende anche
      all'estero. Il nostro approccio parte da qui: poco design gratuito, tanta chiarezza.`),
      L(`Da Crema a Lodi sono 30 minuti: avviamo i progetti da voi o in video, come preferite. La
      consegna resta quella dei nostri progetti: 7 giorni per una vetrina, con testi scritti da noi
      a partire da un'intervista di 20 minuti e foto vostre o di un fotografo amico.`),
      L(`Per le aziende lodigiane che vendono B2B costruiamo spesso siti con area riservata e
      richieste d'offerta strutturate: il cliente compila, voi ricevete una scheda completa via
      email. Meno telefonate di chiarimento, più preventivi andati a buon fine.`),
    ],
    services: [
      { title: "Siti B2B", text: "Area riservata, richieste d'offerta strutturate, listini riservati." },
      { title: "Vetrine rapide", text: "5 pagine online in 7 giorni, ottimizzate per i telefoni." },
      { title: "SEO lodigiana", text: "Pagine per Lodi, Tavazzano, Codogno: le ricerche dei comuni portano clienti." },
      { title: "Supporto al telefono", text: "Risponde chi ha fatto il sito, in orario di ufficio." },
    ],
    faq: [
      {
        q: "Quanto siete lontani da Lodi?",
        a: "30 minuti da Crema: la riunione d'avvio si fa da voi o in video, come preferite.",
      },
      {
        q: "Fate anche e-commerce a Lodi?",
        a: "Sì: catalogo, pagamenti e spedizioni con consegna locale configurata.",
      },
      {
        q: "Quanto costa un sito a Lodi?",
        a: "Le stesse fasce ovunque lavoriamo: vetrina 800–1.500 €, e-commerce 2.500–8.000 €.",
      },
      {
        q: "Seguite clienti solo lodigiani o anche del Pavia?",
        a: "Da Lodi si arriva facilmente in provincia di Pavia: i contenuti si adattano alle ricerche di zona.",
      },
      {
        q: "Quanto dura la garanzia dopo la consegna?",
        a: "Un anno di manutenzione tecnica incluso: aggiornamenti di sicurezza e controlli mensili.",
      },
    ],
    proof:
      "Studio lodigiano seguito dal 2023: le richieste d'offerta online sono passate da 2 a 9 al mese.",
    serviceType: "Siti web",
  },
];

export function getLanding(slug: string) {
  return LANDINGS.find((l) => l.slug === slug);
}

/** I 4 chip cliccabili dell'hero (editabili da admin nella Fase 3). */
export const SEARCH_CHIPS = [
  { label: "Sito web in 7 giorni", query: "sito web in 7 giorni" },
  { label: "Preventivo e-commerce", query: "preventivo e-commerce" },
  { label: "SEO locale", query: "seo locale" },
  { label: "Restyling sito", query: "restyling sito" },
];

/**
 * Le card "consulenti veri" NON stanno qui: arrivano dagli operatori reali
 * (env OPERATOR_A / OPERATOR_B o tabella operators su Neon) via lib/operators.ts → teamCards().
 */

export interface TeamCard {
  id: string;
  name: string;
  role: string;
  availability: string;
  photo: string | null; // /team/a.jpg se il file esiste
}

export function absoluteUrl(path: string) {
  return new URL(path, site.url).toString();
}
