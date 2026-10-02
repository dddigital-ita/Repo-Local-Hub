/**
 * Config centrale del sito. I dati "societari" veri si impostano in .env
 * (vedi .env.example): qui c'è la struttura e i default di produzione.
 *
 * WEB AGENCY SALENTO — nota: i dati segnalati «DA CONFERMARE» non sono
 * inventati e vanno sostituiti appena il cliente fornisce dominio, sede,
 * ragione sociale e team definitivi.
 */

/** Numeri VERI del team: i placeholder «000» delle env non devono mai
 *  raggiungere il sito pubblico (header, footer, sticky, JSON-LD). */
const REAL_PHONE = "+393200865907"; // Daniele — telefono PRINCIPALE del sito (anche WhatsApp)
// Secondo numero: nessun altro operatore deciso per il Salento → finché il
// team non è definito il fallback è lo stesso numero principale (mai numeri finti).
const REAL_PHONE_SECONDARY = REAL_PHONE;

/** La env vale solo se è un numero plausibile: «+390000000000» o «000…» → default reale. */
function safePhone(raw: string | undefined, fallback: string): string {
  const v = raw?.trim();
  if (!v || /0{6,}/.test(v) || v.replace(/\D/g, "").length < 9) return fallback;
  return v;
}

export const site = {
  name: process.env.NEXT_PUBLIC_AGENCY_NAME || "Web Agency Salento",
  legalName: process.env.NEXT_PUBLIC_AGENCY_LEGAL_NAME || "Web Agency Salento", // DA CONFERMARE forma societaria
  // In sviluppo .env.local imposta http://localhost:3000; in produzione qui
  // arriva il dominio definitivo. DA CONFERMARE: webagencysalento.com
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://www.webagencysalento.com",
  // Telefono PRINCIPALE del sito: Daniele. È il numero che risponde su
  // WhatsApp: footer, sticky mobile, landing e JSON-LD LocalBusiness.
  phone: safePhone(process.env.NEXT_PUBLIC_AGENCY_PHONE, REAL_PHONE),
  // DA CONFERMARE: casella dedicata sul dominio definitivo.
  email: process.env.NEXT_PUBLIC_AGENCY_EMAIL || "info@webagencysalento.com",
  // Indirizzo e P.IVA restano configurabili (li usa la privacy policy) e
  // NON sono mostrati nel footer pubblico. Placeholder con «Example»:
  // finché resta così, l'indirizzo è escluso dal JSON-LD pubblico.
  vat: process.env.NEXT_PUBLIC_AGENCY_VAT || "P.IVA 00000000000", // DA FORNIRE
  address: process.env.NEXT_PUBLIC_AGENCY_ADDRESS || "Via Example 1, 73000 Lecce (LE)", // DA FORNIRE
  // Il secondo numero del team resta per uso interno (notifiche, turni):
  // il sito pubblico espone solo il principale.
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
 * Numeri e link di contatto PRINCIPALI del sito (Daniele). Un solo posto da
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

// DA CONFERMARE insieme al dominio definitivo.
export const PRODUCTION_DOMAIN = "webagencysalento.com";

export const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID || "";
export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || "";

/** Aree servite: città chiave del Salento e del brindisino. */
export const PROVINCE_INFO: Record<string, { name: string; province: string; blurb: string }> = {
  lecce: {
    name: "Lecce",
    province: "LE",
    blurb:
      "Lecce è la nostra base: barocco in centro, poli scientifici ed economici, studi professionali " +
      "e commercianti che conoscono i clienti di persona. Il sito deve dire quello che la vetrina " +
      "non riesce a dire: apriamo la chat, ci presentiamo e lavoriamo da qui o da voi.",
  },
  gallipoli: {
    name: "Gallipoli",
    province: "LE",
    blurb:
      "A Gallipoli il calendario conta doppio: la stagione estiva decide l'anno di un ristorante o " +
      "di una struttura ricettiva. Costruiamo siti che raccolgono prenotazioni dirette a giugno e " +
      "restano utili a novembre, quando la clientela di zona torna al negozio e al mercato.",
  },
  brindisi: {
    name: "Brindisi",
    province: "BR",
    blurb:
      "Brindisi vive di porto, industria e servizi: aziende che vendono ad altre aziende e hanno " +
      "bisogno di siti precisi, veloci e in italiano corretto. Ci arriviamo in un'ora di strada e " +
      "le riunioni d'avvio le teniamo nei vostri uffici.",
  },
  otranto: {
    name: "Otranto",
    province: "LE",
    blurb:
      "Otranto non è solo agosto: B&B e case vacanza che restano visibili tutto l'anno riempiono " +
      "anche le settimane di maggio e settembre. I nostri siti puntano sulla prenotazione diretta, " +
      "senza commissioni sui portali, e su foto vere della vostra struttura.",
  },
  nardo: {
    name: "Nardò",
    province: "LE",
    blurb:
      "Nardò unisce agricoltura di qualità, cantieri del turismo e piccole industrie: clienti che " +
      "decidono dopo una telefonata, non dopo un form. Preferiamo sentirci al telefono, capire " +
      "l'obiettivo e scrivere il sito attorno a quello.",
  },
  maglie: {
    name: "Maglie",
    province: "LE",
    blurb:
      "Maglie è il crocevia dell'interno: artigiani, agroalimentare, negozi di via e una clientela " +
      "che arriva dai comuni vicini. Le pagine del sito parlano anche della Grecìa Salentina, perché " +
      "chi cerca da quelle parti cerca persone del posto, non call center.",
  },
  copertino: {
    name: "Copertino",
    province: "LE",
    blurb:
      "A Copertino, a due passi da Lecce, lavorano artigiani e professionisti che si sostentano di " +
      "passaparola: il sito serve a far arrivare quelle stesse raccomandazioni su Google, con " +
      "recensioni vere e un numero da chiamare che risponde.",
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
    slug: "web-agency-salento",
    h1: "Web agency nel Salento: siti che portano telefonate",
    title: "Web Agency Salento | Siti web e SEO dal vivo",
    description:
      "Web agency nel Salento con team vero in chat e al telefono: preventivo indicativo subito, richiamo in giornata. Lecce, Gallipoli, Otranto e tutta la provincia.",
    keyword: "web agency Salento",
    keywords: ["web agency Salento", "agenzia web Salento", "digital agency Salento"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Web agency Salento", href: "/web-agency-salento" },
    ],
    intro: [
      L(`«Mi serve una web agency nel Salento che mi risponda davvero» — è la frase con cui comincia
      metà delle chat che apriamo. In una terra dove i rapporti si costruiscono in piazza e al bar,
      l'idea di affidare il sito a un form che sparisce nel nulla spaventa. Per questo qui il sito
      funziona al contrario: scrivi nella barra cosa cerchi, si apre una conversazione con una
      persona che ha nome e cognome, e se preferisci la voce ti richiamiamo in giornata.`),
      L(`Siamo del posto e conosciamo il territorio: le attività di Lecce che vivono di clientela
      fedele, i ristoranti della costa che fanno l'anno in tre mesi, le aziende del brindisino che
      vendono ad altre aziende, gli artigiani dell'interno che lavorano a parole passate. Ogni
      realtà ha bisogno di un sito diverso, e il nostro lavoro comincia dal capire la tua: quanti
      clienti vuoi in più, da dove arrivano, cosa ti ferma oggi.`),
      L(`Il metodo è misurato: obiettivo scritto, canale scelto insieme, tutto tracciato su GA4.
      Se un intervento non porta richieste te lo diciamo, anche quando significare rinunciare al
      progetto. Preferiamo un cliente che ripassa l'anno dopo a un contratto firmato per abitudine.`),
    ],
    services: [
      { title: "Siti vetrina in 7 giorni", text: "Struttura chiara, testi scritti da noi, online in una settimana con le tue foto vere." },
      { title: "SEO locale", text: "Schede Google e pagine che si posizionano per le ricerche di Lecce, Gallipoli, Brindisi e dell'interno." },
      { title: "E-commerce", text: "Negozi online con pagamenti, spedizioni e gestione quotidiana spiegata in un'ora." },
      { title: "Nessun vincolo", text: "Dominio e hosting intestati a te: il sito resta tuo anche se un giorno cambi strumento." },
    ],
    faq: [
      {
        q: "Dove avete sede nel Salento?",
        a: "Operiamo da Lecce e incontriamo i clienti in sede o da voi: costa salentina, brindisino e interno compreso. La prima riunione la preferiamo faccia a faccia.",
      },
      {
        q: "Quanto costa un progetto con la vostra web agency?",
        a: "Le fasce partono da 1.000 € per un sito vetrina e da 3.000 € per un e-commerce. La chat ti dà l'indicazione in 4 domande, il preventivo scritto arriva entro 24 ore.",
      },
      {
        q: "Rispondete davvero al telefono o usate un centralino?",
        a: "Risponde chi costruisce il sito, in orario di ufficio. Fuori orario la chat prende il messaggio e ti richiamiamo al primo turno utile.",
      },
      {
        q: "Seguite anche le attività turistiche stagionali?",
        a: "Sì: B&B, case vacanza e ristoranti sono una parte grande del nostro lavoro, con l'obiettivo di vendere diretti senza dipendere dai portali.",
      },
      {
        q: "Quanti progetti seguite allo stesso tempo?",
        a: "Pochi, di proposito: è il motivo per cui consegniamo nei tempi e al telefono risponde sempre lo stesso numero.",
      },
    ],
    proof:
      "Ogni progetto comincia con una chat e finisce con un sito intestato a te: preventivo scritto entro 24 ore e data di consegna nel contratto.",
    serviceType: "Web agency",
  },
  {
    slug: "web-agency-lecce",
    h1: "Web agency a Lecce, al telefono e in chat",
    title: "Web Agency Lecce | Siti, SEO e preventivo in chat",
    description:
      "Web agency a Lecce: siti web, SEO locale ed e-commerce con risposta umana in giornata. Preventivo indicativo in 4 domande di chat, richiamo in orario di ufficio.",
    keyword: "web agency Lecce",
    keywords: ["web agency Lecce", "agenzia web Lecce", "digital marketing Lecce"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Web agency Lecce", href: "/web-agency-lecce" },
    ],
    intro: [
      L(`Cercare una web agency a Lecce restituisce decine di nomi tutti uguali. Il criterio vero
      per scegliere, in città, è un altro: quando hai una domanda, quanto ci mettono a rispondere?
      Noi abbiamo costruito il sito intorno a questa domanda: la barra di ricerca apre una chat
      con il team, in quattro risposte hai la fascia di prezzo e se ti torna ti richiamiamo
      in giornata.`),
      L(`Lecce ha un tessuto particolare: studi professionali e medici del centro, commercianti
      delle vie dello shopping, attività che vivono del movimento dell'università e dei poli,
      artigiani delle zone artigianali. Qui un sito non serve a fare bella figura alla fiera:
      serve a trasformare la raccomandazione in una telefonata. Per questo mettiamo il numero
      in alto, il WhatsApp a un tap e recensioni vere in homepage.`),
      L(`Il rapporto che proponiamo è da città piccola, anche se i strumenti sono da agenzia:
      riunioni in sede in centro o da voi, telefono che risponde, GA4 configurato dal primo
      giorno così le decisioni si prendono sui numeri e non sui gusti. E se un canale non
      funziona, ti diciamo di smettere invece di venderti altro.`),
    ],
    services: [
      { title: "Siti che convertono", text: "Numero sempre visibile, recensioni in vista, caricamento in un secondo sul telefono." },
      { title: "SEO locale leccese", text: "Pagine per le ricerche dei quartieri e dei comuni della provincia di Lecce." },
      { title: "E-commerce", text: "Vendite online con ritiro in negozio, pagamenti e spedizioni configurati." },
      { title: "Supporto umano", text: "WhatsApp e telefono rispondono a chi ha costruito il sito, non a un call center." },
    ],
    faq: [
      {
        q: "Avete ufficio a Lecce dove poter venire?",
        a: "Sì: le riunioni si tengono in sede o presso di te, come preferisci. Per i progetti locali la prima visita è faccia a faccia.",
      },
      {
        q: "Quanto costa un sito web a Lecce?",
        a: "Sito vetrina da 1.000 €, e-commerce da 3.000 €: nel prezzo entrano testi, SEO base, formazione e il primo anno di manutenzione tecnica.",
      },
      {
        q: "Quanto tempo passa dalla richiesta alla pubblicazione?",
        a: "Per una vetrina, 7 giorni lavorativi dall'ok al contratto. L'anteprima online la vedi dal terzo giorno.",
      },
      {
        q: "Seguite anche i comuni intorno a Lecce?",
        a: "Sì: Copertino, Monteroni, Cavallino, San Cesario e tutta la cintura: ogni comune ha ricerche sue che valgono clienti.",
      },
      {
        q: "Il sito resta mio se poi smettiamo?",
        a: "Sempre: dominio, hosting e file sono intestati a te, con backup e accessi consegnati.",
      },
    ],
    proof:
      "Il numero che vedi sul sito è quello di chi lavora al tuo progetto: stesso numero in chat, al telefono e su WhatsApp.",
    serviceType: "Web agency",
  },
  {
    slug: "realizzazione-siti-web-lecce",
    h1: "Realizzazione siti web a Lecce, online in 7 giorni",
    title: "Realizzazione Siti Web Lecce | Online in 7 giorni",
    description:
      "Realizzazione siti web a Lecce in 7 giorni: struttura, testi e foto gestiti da noi, prezzo scritto prima di iniziare e anteprima online dal terzo giorno.",
    keyword: "realizzazione siti web Lecce",
    keywords: ["realizzazione siti web Lecce", "creazione siti web Lecce", "siti internet Lecce"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Realizzazione siti web Lecce", href: "/realizzazione-siti-web-lecce" },
    ],
    intro: [
      L(`La realizzazione di un sito web a Lecce attraversa sempre lo stesso vicolo cieco: tre
      preventivi, tre cifre, nessuna spiegazione. Noi preferiamo fare il passivo del progetto
      prima di cominciarlo: cosa è incluso, cosa no, quanto dura, quanto costa. Il prezzo resta
      quello scritto, e se una richiesta esce dal perimetro te la quotiamo prima di farla,
      mai a fattura fatta.`),
      L(`I 7 giorni sono un metodo, non uno slogan: primo giorno la conversazione di scoperta,
      secondi e terzi struttura e testi scritti a partire da un'intervista di venti minuti,
      quarti e quinti design e sviluppo, sesto le tue correzioni, settimo pubblicazione. Se
      qualcosa non ci sta nei tempi te lo diciamo prima di firmare: nessuna sorpresa dopo
      tre settimane di silenzio.`),
      L(`Le foto sono delle tue attività, non da catalogo: il negozio di via, il banco dell'officina,
      la sala del ristorante. Chi ti cerca da Lecce riconosce i luoghi e si fidа. Il sito nasce
      veloce sul telefono (dove arriva il 70% delle visite locali), con il numero cliccabile
      e Google Maps incorporata.`),
    ],
    services: [
      { title: "Sito vetrina 7 giorni", text: "Cinque pagine, form contatti, recensioni Google e SEO base inclusi." },
      { title: "Siti con prenotazioni", text: "Per studi, saloni e ristoranti: calendario appuntamenti e promemoria via WhatsApp." },
      { title: "Landing di campagna", text: "Una pagina per una promozione specifica, pronta in 48 ore e tracciata su GA4." },
      { title: "Formazione inclusa", text: "Mezz'ora registrata su come aggiornare i contenuti da solo, senza chiamare nessuno." },
    ],
    faq: [
      {
        q: "E se non ho i contenuti pronti?",
        a: "Li scriviamo noi con un'intervista di 20 minuti: testi e struttura sono nel prezzo, non sono un extra.",
      },
      {
        q: "Il dominio come funziona?",
        a: "Lo registriamo intestato a te: paghi il registrar direttamente (12 € l'anno circa) e resta tuo per sempre.",
      },
      {
        q: "Posso vedere il sito prima che vada online?",
        a: "Sì: anteprima su dominio di prova dal giorno 3 e un giro di correzioni incluso al giorno 6.",
      },
      {
        q: "Come si paga?",
        a: "Metà all'avvio e metà alla pubblicazione, fattura elettronica. Se consegniamo in ritardo per nostre cause, non ci sono penali per te.",
      },
      {
        q: "Cosa succede dopo un anno?",
        a: "La manutenzione tecnica del primo anno è inclusa: aggiornamenti di sicurezza e controlli mensili. Poi decidi con calma.",
      },
    ],
    proof:
      "Anteprima online dal terzo giorno e consegna scritta nel contratto: il sito si vede prima di pagarlo tutto.",
    serviceType: "Creazione siti web",
  },
  {
    slug: "siti-web-gallipoli",
    h1: "Siti web a Gallipoli: diretta col cliente, senza commissioni",
    title: "Siti Web Gallipoli | Ristoranti, B&B e negozi",
    description:
      "Siti web a Gallipoli per ristoranti, strutture ricettive e negozi del borgo e del lungomare: prenotazioni dirette, foto vere, SEO locale in stagione e fuori.",
    keyword: "siti web Gallipoli",
    keywords: ["siti web Gallipoli", "web agency Gallipoli", "sito ristorante Gallipoli"],
    city: "gallipoli",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Gallipoli", href: "/siti-web-gallipoli" },
    ],
    intro: [
      L(`Un sito web a Gallipoli gioca su due pubblici che si alternano: il turista che decide
      dall'alto a giugno dove cenare e dormire, e il gallipolese che nel resto dell'anno cerca
      il pescivendolo, il meccanico, il barbiere. Un buon sito serve entrambi: vetrina in
      italiano (e lingue per l'estate) per chi arriva, numero e mappa per chi resta.`),
      L(`Per ristoranti e strutture ricettive la matematica è semplice: ogni prenotazione che
      passa da un portale costa una commissione. Il sito che costruiamo porta la prenotazione
      diretta: bottone WhatsApp, form con data e numero di persone, recensioni Google in vista
      e foto fatte sul posto. Chi lavora nel centro storico sa bene quanto vale un cliente
      che torna perché l'ha trovato da solo.`),
      L(`Fuori stagione il sito continua a lavorare: pagine che restano indicizzate per le ricerche
      di chi organizza le vacanze a febbraio, e servizi per la clientela di zona. La struttura è
      pensata per essere aggiornata in due minuti: cambia il menu, cambiano i prezzi, il sito
      segue senza chiamare nessuno.`),
    ],
    services: [
      { title: "Prenotazione diretta", text: "WhatsApp e form con data, ora e coperti: la prenotazione arriva a te, senza commissioni." },
      { title: "Menu aggiornabile", text: "Prezzi e piatti modificati da solo in due minuti, anche dal telefono." },
      { title: "Multilingua d'estate", text: "Inglese e seconda lingua per le settimane della stagione, attivate quando servono." },
      { title: "SEO locale", text: "Ricerche «ristorante Gallipoli», «B&B centro storico», «dove mangiare» presidiate tutto l'anno." },
    ],
    faq: [
      {
        q: "Serve un sito se sono già su Booking e Tripadvisor?",
        a: "Sì: i portali portano clienti ma prendono una commissione e possiedono il cliente. Il tuo sito vende diretto e resta tuo.",
      },
      {
        q: "Quanto costa un sito per un ristorante a Gallipoli?",
        a: "Le fasce vanno da 1.000 € per la vetrina con menu e prenotazioni a 3.000 € e oltre per strutture ricettive con calendario camere.",
      },
      {
        q: "In quanto tempo posso essere online, se è stagione?",
        a: "7 giorni lavorativi per una vetrina. Se parti a giugno, la priorità aumenta e l'anteprima arriva dal terzo giorno.",
      },
      {
        q: "Chi fa le foto?",
        a: "Puoi usare le tue, oppure ti mettiamo in contatto con un fotografo del territorio: niente foto stock che il cliente non riconosce.",
      },
      {
        q: "Il sito funziona anche fuori stagione?",
        a: "Sì: le pagine restano indicizzate tutto l'anno e raccolgono le ricerche di chi pianifica la vacanza con mesi di anticipo.",
      },
    ],
    proof:
      "Il sito a Gallipoli si misura in prenotazioni dirette: bottone WhatsApp, recensioni in vista e menu sempre aggiornato.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-otranto",
    h1: "Siti web a Otranto per vivere di turismo tutto l'anno",
    title: "Siti Web Otranto | B&B, case vacanza e ristoranti",
    description:
      "Siti web a Otranto con prenotazione diretta per B&B e case vacanza: meno commissioni sui portali, visibilità a maggio e settembre, foto vere della struttura.",
    keyword: "siti web Otranto",
    keywords: ["siti web Otranto", "web agency Otranto", "sito B&B Otranto"],
    city: "otranto",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Otranto", href: "/siti-web-otranto" },
    ],
    intro: [
      L(`A Otranto la stagione si allunga ogni anno, ma i portali di prenotazione prendono la loro
      parte su ogni notte venduta. Il sito che costruiamo per B&B e case vacanza ha un obiettivo
      preciso: farti vendere dirette. Calendario disponibilità, richiesta con date e numero di
      ospiti, pagamento della caparra dove serve, e la chat WhatsApp che il turista preferisce
      a qualsiasi form.`),
      L(`Il secondo obiettivo è la bassa stagione: chi cerca «dove dormire a Otranto» a marzo o
      «weekend a Otranto» a ottobre trova poche strutture aggiornate. Un sito curato con foto
      vere, prezzi chiari e recensioni prese quelle settimane diventa visibile proprio quando
      la concorrenza dorme. È lì che si guadagnano i weekend di maggio.`),
      L(`Gestiamo anche i dettagli che a fine stagione fanno la differenza: schede Google con
      orari e foto aggiornate, risposte alle recensioni, pagine dedicate ai servizi (colazione,
      parcheggio, distanza dal mare). Il tutto aggiornabile da solo, dal telefono, in due minuti:
      perché a gestire una struttura il tempo non avanza.`),
    ],
    services: [
      { title: "Direct booking", text: "Calendario, richieste di disponibilità e caparre: la prenotazione resta tua." },
      { title: "Foto della struttura", text: "Camere, colazione, vista: niente foto generiche, il cliente deve riconoscere la casa." },
      { title: "Prezzi e stagioni", text: "Listini per periodo aggiornabili in autonomia, senza ticket." },
      { title: "Google Business curato", text: "Scheda completa, foto stagionali e recensioni a cui rispondere con metodo." },
    ],
    faq: [
      {
        q: "Il sito sostituisce i portali di prenotazione?",
        a: "Li affianca: i portali fanno scoperta, il tuo sito chiude diretto. Ogni notte venduta senza commissione è margine in più.",
      },
      {
        q: "Quanto costa un sito per un B&B a Otranto?",
        a: "Da 1.000 € per la vetrina con calendario richieste, oltre 3.000 € con gestione multi-camera e pagamenti.",
      },
      {
        q: "Devo aggiornare io le disponibilità?",
        a: "Nel modo più semplice: due minuti dal telefono. Se usi già un gestionale, valutiamo il collegamento.",
      },
      {
        q: "Funziona anche per case vacanza senza reception?",
        a: "Sì: anzi, è il caso tipico. Check-in self service descritto bene, orari chiari e WhatsApp per l'arrivo.",
      },
      {
        q: "Quanto dura la messa online?",
        a: "7 giorni lavorativi per la vetrina, con anteprima dal terzo. In vista della stagione diamo priorità ai progetti del territorio.",
      },
    ],
    proof:
      "Ogni notte venduta dal tuo sito è una notte senza commissione: direct booking, foto vere e recensioni in vista.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-nardo",
    h1: "Siti web a Nardò per aziende e professionisti",
    title: "Siti Web Nardò | Aziende e professionisti del territorio",
    description:
      "Siti web a Nardò per aziende, studi e commercianti: preventivo in chat in 4 domande, consegna in 7 giorni, supporto al telefono con chi l'ha costruito.",
    keyword: "siti web Nardò",
    keywords: ["siti web Nardò", "web agency Nardò", "creazione sito Nardò"],
    city: "nardo",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Nardò", href: "/siti-web-nardo" },
    ],
    intro: [
      L(`Nardò è una città che lavora: aziende agricole di qualità, piccole industrie, commercianti
      del centro, studi professionali che seguono tutta la parte sud della provincia. Qui il sito
      web non è un biglietto da visita elettronico: è lo strumento che risponde alle domande dei
      clienti prima che chiamino, e porta la telefonata giusta all'ora giusta.`),
      L(`Il metodo non cambia rispetto a come si lavora in città: prima una conversazione per
      capire l'obiettivo — più preventivi, più richieste per il mostruoso canale del passaparola,
      primi posti su Google per le ricerche dei comuni vicini — poi il progetto scritto con
      tempi e prezzo. Sette giorni per una vetrina, anteprima dal terzo, correzioni incluse.`),
      L(`Per le aziende che vendono ad altre aziende costruiamo siti con catalogo scaricabile,
      richieste d'offerta strutturate e area riservata. Per i negozi e gli studi, schede Google
      curate e recensioni in vista. In entrambi i casi: niente vino vecchio in bottiglia nuova,
      solo quello che porta clienti misurabile.`),
    ],
    services: [
      { title: "Siti B2B", text: "Cataloghi, richieste d'offerta e aree riservate per chi vende ad altre aziende." },
      { title: "Vetrine rapide", text: "Cinque pagine online in 7 giorni, ottimizzate per il telefono." },
      { title: "SEO dell'interno", text: "Nardò, Galatone, Seclì, Aradeo: le ricerche dei comuni vicini presidiate una a una." },
      { title: "Supporto diretto", text: "Al telefono risponde chi ha fatto il sito, in orario di ufficio." },
    ],
    faq: [
      {
        q: "Venite a Nardò per le riunioni?",
        a: "Sì: la riunione d'avvio da voi, le successive in video o al telefono come preferite.",
      },
      {
        q: "Quanto costa un sito a Nardò?",
        a: "Stesse fasce ovunque: vetrina da 1.000 €, e-commerce da 3.000 €. Preventivo scritto entro 24 ore.",
      },
      {
        q: "Seguite anche aziende agricole?",
        a: "Sì: vendita diretta, agriturismi e filiere corti hanno esigenze specifiche che conosciamo bene.",
      },
      {
        q: "Chi mantiene il sito dopo la consegna?",
        a: "Noi: primo anno di manutenzione tecnica incluso, aggiornamenti dei contenuti a chiamata o fatti da te con la formazione registrata.",
      },
      {
        q: "E se volessi anche la scheda Google?",
        a: "La facciamo noi: categoria giuste, foto, orari e un metodo per raccogliere recensioni vere dai clienti.",
      },
    ],
    proof:
      "La riunione d'avvio la teniamo da voi a Nardò: un'ora, obiettivi scritti e il progetto parte il giorno dopo.",
    serviceType: "Siti web",
  },
  {
    slug: "seo-salento",
    h1: "SEO nel Salento: farsi trovare dove i clienti cercano",
    title: "SEO Salento | Posizionamento locale misurato",
    description:
      "SEO nel Salento con report mensili di una pagina: keyword locali, schede Google ottimizzate e telefonate tracciate. Niente promesse di prima pagina.",
    keyword: "SEO Salento",
    keywords: ["SEO Salento", "SEO Lecce", "posizionamento Google Salento"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "SEO Salento", href: "/seo-salento" },
    ],
    intro: [
      L(`La SEO nel Salento è una gara su tante piste piccole: «dentista Lecce», «pizzeria
      Gallipoli», «agrimensore Maglie», «B&B Otranto con parcheggio». Chi ottimizza per parole
      generiche perde contro i portali nazionali; chi mappa le ricerche del proprio comune porta
      in azienda telefonate che arrivano a dieci minuti di macchina.`),
      L(`Il lavoro parte da un audit: tecnica del sito, testi, schede Google Business, recensioni,
      concorrenti locali. Poi un piano mensile con tre interventi per volta, misurati su GA4 e
      Search Console. Il report è una pagina: posizioni, clic, richieste arrivate. Se un numero
      non si può misurare, non lo scriviamo.`),
      L(`Non vendiamo posizioni in prima pagina — nessuno può garantirla e chi la promette mente.
      Vendiamo un metodo costante che nei progetti seguiti con continuità porta le richieste
      locali a crescere. Se dopo quattro mesi i numeri non girano, ti consigliamo di fermare
      il contratto: meglio un cliente che torna che un rinnovo imposto.`),
    ],
    services: [
      { title: "Audit SEO completo", text: "Tecnica, contenuti e reputazione locale: il quadro in 10 giorni." },
      { title: "Google Business Profile", text: "Categorie, foto, orari e gestione delle recensioni con metodo." },
      { title: "Contenuti locali", text: "Pagine di servizio per comuni e frazioni: una pagina per ogni ricerca che vale clienti." },
      { title: "Report mensili", text: "Una pagina, tre minuti di lettura: posizioni, clic, telefonate tracciate." },
    ],
    faq: [
      {
        q: "Quanto tempo serve per vedere risultati?",
        a: "Prime variazioni in 6–8 settimane, situazione stabile dopo 4–6 mesi di lavoro continuo. Chi promette meno, non lavora davvero.",
      },
      {
        q: "Quanto costa la consulenza SEO?",
        a: "Da 350 € al mese per le attività locali. Niente contratti oltre 12 mesi: il rinnovo si merita, non si firma per inerzia.",
      },
      {
        q: "Fate anche i contenuti o solo l'ottimizzazione?",
        a: "Entrambi: scriviamo le pagine locali partendo dalle ricerche vere, tu approvi in un giro di revisione.",
      },
      {
        q: "Devo rifare il sito per fare SEO?",
        a: "Se il sito regge, no: si lavora sui contenuti e sulla scheda Google. Ti diciamo quando il ridisegno è davvero necessario.",
      },
      {
        q: "Misurate anche le telefonate?",
        a: "Sì: tracciamento GA4 sulle chiamate dal sito e, per chi vuole numeri netti, numeri dedicati alle pagine.",
      },
    ],
    proof:
      "Report mensile di una pagina, numeri verificabili su GA4 e Search Console: la SEO si misura, non si racconta.",
    serviceType: "SEO",
  },
  {
    slug: "preventivo-sito-web",
    h1: "Preventivo sito web, in chat e senza impegno",
    title: "Preventivo Sito Web | Fasce e prezzi reali",
    description:
      "Preventivo sito web in 4 domande di chat: fasce chiare, cosa è incluso, tempi di consegna scritti. Risposta umana in giornata se vuoi procedere.",
    keyword: "preventivo sito web Salento",
    keywords: ["preventivo sito web", "quanto costa un sito web", "prezzo sito web"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Preventivo sito web", href: "/preventivo-sito-web" },
    ],
    intro: [
      L(`Vuoi un preventivo per un sito web senza passare da tre telefonate e una presentazione
      commerciale? Qui funziona così: scrivi nella barra cosa cerchi, rispondi a quattro domande
      da dieci secondi e vedi subito la fascia di prezzo. Se ti torna, una persona vera ti
      richiama in giornata con il numero definitivo e la data di consegna.`),
      L(`Le fasce sono due e mezza: vetrina 1.000–2.000 €, e-commerce 3.000–8.000 €, progetti con
      integrazioni su misura sopra. Nel prezzo sono inclusi testi scritti da noi, SEO base,
      formazione registrata e il primo anno di manutenzione tecnica. Le cose fuori preventivo
      si quottano prima di farle, mai dopo: è scritto, non è una promessa a voce.`),
      L(`Il preventivo vale 30 giorni e resta valido così com'è: cosa è incluso, quando consegniamo,
      come si paga. Se un preventivo più basso ti ha chiamato prima, confronta cosa c'è dentro:
      quasi sempre mancano i testi, la velocità, la SEO o la formazione. A volte conviene
      comunque: te lo diciamo anche questo, senza brutti giochi.`),
    ],
    services: [
      { title: "Fascia vetrina", text: "1.000–2.000 €: cinque pagine, testi, SEO base, online in 7 giorni." },
      { title: "Fascia e-commerce", text: "3.000–8.000 €: catalogo, pagamenti, spedizioni e formazione alla gestione." },
      { title: "Fascia su misura", text: "Portali, integrazioni e automazioni: preventivo dedicato entro 48 ore." },
      { title: "Preventivo scritto", text: "Vale 30 giorni: incluso, consegna, pagamenti. Nessun costo a sorpresa." },
    ],
    faq: [
      {
        q: "Quanto costa in media un sito per una piccola azienda?",
        a: "Tra 1.000 e 3.000 € per una vetrina seria. Sotto quella cifra controlla cosa manca: quasi sempre testi e SEO.",
      },
      {
        q: "Il preventivo mi impegna a qualcosa?",
        a: "No: è scritto, vale 30 giorni e nessuno ti richiama se non lo chiedi tu.",
      },
      {
        q: "Ci sono costi annuali oltre al sito?",
        a: "Dominio (12 € circa l'anno) e hosting (100–200 € l'anno), entrambi intestati a te e pagabili direttamente.",
      },
      {
        q: "Perché i prezzi dei concorrenti variano tanto?",
        a: "Perché contano cose diverse: nei preventivi bassi spariscono i testi scritti, la velocità, la SEO e la formazione.",
      },
      {
        q: "Posso pagare a rate?",
        a: "Sì: metà all'avvio e metà alla pubblicazione, senza interessi. Per progetti più grandi si concorda un piano.",
      },
    ],
    proof:
      "Quattro domande di chat per la fascia di prezzo, preventivo scritto entro 24 ore: senza form che sparisce nel nulla.",
    serviceType: "Preventivo sito web",
  },
  {
    slug: "ecommerce-lecce-salento",
    h1: "E-commerce a Lecce e nel Salento, senza impazzire",
    title: "E-commerce Lecce | Negozi online gestibili",
    description:
      "E-commerce a Lecce e nel Salento: catalogo, pagamenti e spedizioni configurati, formazione alla gestione inclusa, nessuna royalty all'agenzia sul venduto.",
    keyword: "e-commerce Lecce",
    keywords: ["e-commerce Lecce", "creare shop online Salento", "ecommerce Puglia"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "E-commerce Lecce e Salento", href: "/ecommerce-lecce-salento" },
    ],
    intro: [
      L(`Un e-commerce in provincia di Lecce ha un vantaggio che nelle grandi città non esiste:
      il ritiro in negozio e la consegna in giornata. Costruiamo i negozi online partendo da
      questo: ritiro in sede per il cliente di zona, corriere per il resto d'Italia, pagamenti
      con carta, PayPal o contrassegno. E per chi vende prodotti del territorio, la racconta:
      foto vere, descrizioni scritte bene, la storia che il turista poi porta a casa.`),
      L(`La piattaforma resta gestibile da chi non è un tecnico: cataloghi da trenta a tremila
      prodotti, varianti per taglia e colore, listini riservati per i clienti B2B, sconti per
      quantità. La gestione quotidiana la impari in un'ora di formazione registrata: aggiungere
      un prodotto deve richiedere due minuti, non un ticket all'agenzia.`),
      L(`Gli ordini arrivano con email e notifica, le etichette di spedizione si generano con un
      click, i feed per Google Shopping tengono prezzi e disponibilità sincronizzati. Nessuna
      royalty mensile sul fatturato: la commissione resta solo quella del gestore dei pagamenti.
      E se un domani vendi all'estero, la struttura regge: si aggiungono lingue e mercati
      senza rifare tutto.`),
    ],
    services: [
      { title: "Shop B2C", text: "Catalogo, carrello, pagamenti e spedizioni con tariffe reali dei corrieri." },
      { title: "Portali B2B", text: "Listini riservati, minimi d'ordine, ordini ripetibili in un click." },
      { title: "Ritiro in negozio", text: "Consegna locale e ritiro in sede configurati di default." },
      { title: "Google Shopping", text: "Feed prodotti con foto, prezzi e disponibilità sempre aggiornati." },
    ],
    faq: [
      {
        q: "Quanto costa un e-commerce?",
        a: "Da 3.000 € per un catalogo essenziale fino a 8.000 € per configurazioni B2B: la chat divide le fasce in quattro domande.",
      },
      {
        q: "In quanto tempo è online?",
        a: "3–4 settimane: struttura, catalogo e prove d'ordine, formazione finale. Il negozio prova resta visibile a te dal primo giorno.",
      },
      {
        q: "Quanto pago sul venduto?",
        a: "Solo la commissione del gestore pagamenti (da 1,5%): nessuna royalty all'agenzia, mensile o percentuale.",
      },
      {
        q: "Ho il catalogo in Excel, si può importare?",
        a: "Sì: facciamo la prima importazione noi e ti consegniamo il file modello per gli aggiornamenti futuri.",
      },
      {
        q: "Chi fotografa i prodotti?",
        a: "Su fondo bianco lo facciamo noi in sede con listino chiaro: trenta prodotti al giorno circa.",
      },
    ],
    proof:
      "Nessuna royalty sul venduto: paghi la realizzazione e la commissione del gestore pagamenti, il margine resta tuo.",
    serviceType: "E-commerce",
  },
  {
    slug: "posizionamento-google-salento",
    h1: "Posizionamento Google: Maps + ricerca organica",
    title: "Posizionamento Google Salento | Maps e ricerca",
    description:
      "Posizionamento su Google per attività del Salento: scheda Business curata, recensioni vere e pagine che salgono nelle ricerche locali. Piano a 90 giorni.",
    keyword: "posizionamento Google Salento",
    keywords: ["posizionamento Google Salento", "Google Maps Lecce", "prima pagina Google"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Posizionamento Google Salento", href: "/posizionamento-google-salento" },
    ],
    intro: [
      L(`Il posizionamento su Google si gioca su due tavoli insieme: la mappa con i risultati
      locali — il pacco di tre schede con le stelle — e la ricerca organica. Molte agenzie
      lavorano solo su uno dei due; noi facciamo entrambi, perché il cliente cerca dove capita:
      la Maps mentre è in strada, la ricerca mentre confronta da casa.`),
      L(`Sulla Maps si vince con recensioni vere e costanti, categorie corrette, foto aggiornate
      e post periodici. Nella ricerca si vince con pagine che rispondono alle domande della
      zona, siti veloci e dati strutturati che Google capisce. Il piano dura 90 giorni con
      obiettivi scritti: quante parole in prima pagina, quanti clic, quante telefonate.`),
      L(`Ogni settimana guardiamo i numeri insieme, in un report di una pagina. Se una pagina non
      sale, la cambiamo; se sale ma non fa chiamare, la riscriviamo. Il posizionamento non è
      uno scatto, è un allenamento: chi smette al secondo mese riparte da capo nella stagione
      successiva. Chi continua, dopo un anno non paga più pubblicità per le ricerche locali.`),
    ],
    services: [
      { title: "Ottimizzazione Maps", text: "Categorie, orari, foto e post periodici per il 3-pack locale." },
      { title: "Piano recensioni", text: "Un sistema semplice per raccogliere recensioni vere dai clienti contenti." },
      { title: "Pagine di zona", text: "Contenuti dedicati alle ricerche dei comuni del Salento, una per una." },
      { title: "Monitoraggio 90 giorni", text: "Obiettivi scritti, report settimanali, correzioni a vista." },
    ],
    faq: [
      {
        q: "Posso arrivare primo su Google nel mio comune?",
        a: "Sulle ricerche locali specifiche spesso sì in 3–6 mesi; sulle parole generali dipende dalla concorrenza. Mai promesse alla cieca.",
      },
      {
        q: "Compro delle posizioni con gli annunci?",
        a: "Gli annunci sono un canale separato: li gestiamo solo se serve traffico immediato mentre la SEO cresce.",
      },
      {
        q: "Le recensioni si possono comprare?",
        a: "No, è illegale e Google lo banna: ti diamo un metodo per averle vere, dai clienti davvero serviti.",
      },
      {
        q: "Cosa succede se smettiamo?",
        a: "Le posizioni calano lentamente, non spariscono dall'oggi al domani. E il lavoro fatto resta in documenti tuoi.",
      },
      {
        q: "Seguite tutti i comuni del Salento?",
        a: "Sì: ogni comune ha ricerche sue che valgono clienti, da Gallipoli a Maglie, da Nardò a Otranto.",
      },
    ],
    proof:
      "Il piano è a 90 giorni con obiettivi scritti: parole in prima pagina, clic e telefonate misurate ogni settimana.",
    serviceType: "Posizionamento Google",
  },
  {
    slug: "restyling-sito-web-salento",
    h1: "Restyling sito web senza perdere posizioni",
    title: "Restyling Sito Web Salento | Stessa URL, più clienti",
    description:
      "Restyling del sito senza perdere il posizionamento: redirect mappati uno a uno, contenuti riscritti per le ricerche di oggi, online in 10 giorni.",
    keyword: "restyling sito web Salento",
    keywords: ["restyling sito web", "rifare sito web Lecce", "aggiornare sito"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Restyling sito web Salento", href: "/restyling-sito-web-salento" },
    ],
    intro: [
      L(`Il restyling di un sito fallisce sempre allo stesso modo: sito nuovo bello, posizionamento
      azzerato perché le vecchie pagine sono sparite senza lasciare indirizzo. Noi migriamo con
      la mappa dei redirect: ogni vecchio URL trova la sua nuova casa e Google lo scopre in
      giornata, non tra sei mesi quando i clienti sono finiti altrove.`),
      L(`Prima di rifare si valuta: con cinque pagine e contenuti fermi da otto anni conviene
      ripartire in 7 giorni; con sessanta pagine indicizzate che portano traffico il restyling
      è chirurgico — cambia la struttura, restano le URL che rendono. I dati di Search Console
      li guardiamo insieme prima di decidere: la decisione non è questione di gusto.`),
      L(`Il restyling medio dura dieci giorni lavorativi: due di analisi e mappa, quattro di
      contenuti e design, due di sviluppo, due di prove e migrazione. Il sito vecchio resta
      online fino all'ultimo momento: nessun «sito in manutenzione» per settimane, nessun
      cliente perso nel mentre.`),
    ],
    services: [
      { title: "Migrazione senza perdite", text: "Redirect 301 mappati uno a uno e Search Console aggiornata." },
      { title: "Contenuti riscritti", text: "Testi rifatti per le ricerche di oggi, non per quelle di dieci anni fa." },
      { title: "Velocità recuperata", text: "Dai 6 secondi al secondo e mezzo di caricamento sul telefono." },
      { title: "Tracciamento ripulito", text: "GA4 e strumenti Google rimessi in ordine: sai chi arriva e cosa cerca." },
    ],
    faq: [
      {
        q: "Perdo il posizionamento se rifaccio il sito?",
        a: "Con la mappa dei redirect il traffico si tiene: è la prima cosa che progettiamo, prima ancora del design.",
      },
      {
        q: "Meglio restyling o sito nuovo?",
        a: "Dipende da quanto vale oggi il sito su Google: guardiamo i dati insieme e ti diciamo la verità, anche quando conviene non fare nulla.",
      },
      {
        q: "Quanto costa un restyling?",
        a: "Da 1.000 € per siti piccoli a 3.000 € per strutture con più di venti pagine: la chat stima la fascia subito.",
      },
      {
        q: "Il sito resta offline durante i lavori?",
        a: "Mai: lavori sul vecchio finché il nuovo non è pronto su dominio di prova. Lo scambio avviene in un'ora.",
      },
      {
        q: "Rifate anche i contenuti?",
        a: "Sì: testi, foto e struttura li ripensiamo partendo dalle ricerche che portano clienti oggi.",
      },
    ],
    proof:
      "Il sito vecchio resta online fino allo scambio: nessun «torniamo presto», nessun cliente perso durante i lavori.",
    serviceType: "Restyling sito web",
  },
  {
    slug: "consulente-digitale-lecce",
    h1: "Consulente digitale a Lecce, da chiamare al telefono",
    title: "Consulente Digitale Lecce | Piano in 2 pagine",
    description:
      "Consulente digitale a Lecce: piano a 90 giorni scritto insieme, riunioni in sede, numeri misurati su GA4. Risposta in giornata, niente brogliadiri.",
    keyword: "consulente digitale Lecce",
    keywords: ["consulente digitale Lecce", "consulenza marketing digitale Salento"],
    city: "lecce",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Consulente digitale Lecce", href: "/consulente-digitale-lecce" },
    ],
    intro: [
      L(`Cercavi un consulente digitale e ti è arrivato un brogliadire da quaranta slide? Qui il
      consulente ha nome e cognome, risponde al telefono e scrive il piano su due pagine: cosa
      facciamo nei primi 90 giorni, quanto costa, come si misura. Il resto — presentazioni,
      parole inglesi, grafici colorati — non serve a vendere più nulla.`),
      L(`La consulenza parte da una domanda: quanti clienti in più vuoi al mese, e da quale
      canale? Se la risposta è «più telefonate dai clienti della provincia», il piano è SEO
      locale, sito che converte e scheda Google curata. Se è «vendere fuori regione», cambiano
      contenuti, tempi e canali. Non esiste il pacchetto uguale per tutti: esiste il tuo
      obiettivo, e il piano che lo serve.`),
      L(`Ci vediamo una volta al mese, in sede o da te: un'ora con i numeri davanti e decisioni
      prese sul posto. Tra le riunioni scrivi su WhatsApp e risponde in giornata una persona,
      non un «ti ricontattiamo entro cinque giorni lavorativi». Quando un canale non funziona,
      te lo diciamo: fermarlo è consigli, non mancanza di entusiasmo.`),
    ],
    services: [
      { title: "Piano 90 giorni", text: "Obiettivi, canali, budget e misure scritti su due pagine." },
      { title: "Riunione mensile", text: "Un'ora con i dati, in sede o da te, decisioni prese sul posto." },
      { title: "WhatsApp diretto", text: "Domanda veloce, risposta in giornata: senza ticket né portali." },
      { title: "Audit iniziale", text: "Sito, scheda Google, concorrenti locali: cosa funziona e cosa stiamo perdendo." },
    ],
    faq: [
      {
        q: "Consulenza una tantum o contratto mensile?",
        a: "Entrambi: audit e piano una tantum, poi si decide mese per mese se continuare. Nessun vincolo annuale.",
      },
      {
        q: "Che differenza c'è con il marketing di un'agenzia?",
        a: "Nessuna divisione: il consulente lavora dentro l'agenzia, con gli stessi sviluppatori e designer che poi realizzano.",
      },
      {
        q: "Seguite anche i social?",
        a: "Solo se il piano dice che servono: non facciamo post per abitudine né vendete followers.",
      },
      {
        q: "Come capisco se funziona?",
        a: "GA4 e Search Console: richieste arrivate, chiamate, preventivi. Numeri tuoi, accessi tuoi, report di una pagina.",
      },
      {
        q: "Devo rifare il sito per iniziare?",
        a: "No: se il sito regge si lavora sui canali. Ti diciamo quando il sito è il collo di bottiglia, e solo allora.",
      },
    ],
    proof:
      "Il piano resta su due pagine, sempre: obiettivi, canali, budget e misure. Il resto è esecuzione e numeri.",
    serviceType: "Consulenza digitale",
  },
  {
    slug: "siti-web-hotel-bb-salento",
    h1: "Siti web per hotel e B&B nel Salento",
    title: "Siti Web Hotel e B&B Salento | Booking diretto",
    description:
      "Siti web per hotel, B&B e case vacanza nel Salento: motore di richieste diretto, multilingua, SEO turistica stagionale. Meno commissioni, più dirette.",
    keyword: "siti web hotel Salento",
    keywords: ["sito B&B Salento", "sito hotel Puglia", "booking diretto"],
    city: "gallipoli",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web hotel e B&B Salento", href: "/siti-web-hotel-bb-salento" },
    ],
    intro: [
      L(`Nella ricettività salentina il margine si decide a fine stagione: quante notti sono
      passate dai portali e quante direttamente. Il sito che costruiamo per hotel, B&B e case
      vacanza ha un solo indicatore: le dirette. Richiesta di disponibilità con date e ospiti,
      caparra dove serve, WhatsApp per l'ultimo dubbio, recensioni Google in prima pagina
      del sito e foto che raccontano la casa vera, non la stock photo.`),
      L(`La stagionalità si affronta con i contenuti: pagine per eventi, per le spiagge vicine,
      per i weekend di maggio e ottobre, in italiano e inglese (seconda lingua a piacere).
      Chi pianifica la vacanza a febbraio cerca testi che rispondano, non cataloghi: ogni
      pagina è un'occasione di prenotazione diretta per settimane in cui la concorrenza
      non si fa trovare.`),
      L(`Per gli hotel con gestionale valutiamo il collegamento con il channel manager che usi
      già; per i B&B basta il calendario aggiornato in due minuti dal telefono. In entrambi
      i casi la scheda Google segue: foto stagionali, orari del check-in, risposte alle
      recensioni. La stagione si vince anche nell'immagine che resta dopo l'augusto.`),
    ],
    services: [
      { title: "Richieste dirette", text: "Data, ospiti, contatto: la richiesta arriva a te senza passare dai portali." },
      { title: "Multilingua", text: "Italiano e inglese di serie, altre lingue quando la clientela le chiede." },
      { title: "Contenuti di stagione", text: "Pagine per eventi e bassa stagione che riempiono maggio e settembre." },
      { title: "Channel manager", text: "Se usi già un gestionale, valutiamo il collegamento per evitare doppi turni." },
    ],
    faq: [
      {
        q: "Quanto costa un sito per una struttura ricettiva?",
        a: "Da 1.000 € per B&B e case vacanza a 5.000 € e oltre per hotel con più camere e servizi collegati.",
      },
      {
        q: "In quanto tempo online, se manca poco alla stagione?",
        a: "Sette giorni lavorativi per la base. Nei mesi prima dell'estate i progetti del territorio passano avanti.",
      },
      {
        q: "Devo cambiare gestionale per lavorare con voi?",
        a: "No: ci adattiamo a quello che usi, o semplifichiamo con il calendario interno se non ne usi nessuno.",
      },
      {
        q: "Chi aggiorna prezzi e foto?",
        a: "Tu, in due minuti dal telefono; oppure noi, quando servisse, con tempi rapidi concordati.",
      },
      {
        q: "Il sito porta anche prenotazioni last minute?",
        a: "Sì: WhatsApp in vista e pagine veloci su telefono fanno il grosso delle ultime notti.",
      },
    ],
    proof:
      "L'indicatore è uno: le notti vendute direttamente. Sito, scheda Google e contenuti lavorano tutte per quello.",
    serviceType: "Siti web ricettività",
  },
  {
    slug: "siti-web-brindisi",
    h1: "Siti web a Brindisi per aziende vere",
    title: "Siti Web Brindisi | Porto, industria e servizi",
    description:
      "Siti web a Brindisi per aziende del porto, industria e servizi: preventivo in chat, siti veloci e in italiano corretto, riunione d'avvio nei vostri uffici.",
    keyword: "siti web Brindisi",
    keywords: ["web agency Brindisi", "creazione sito web Brindisi"],
    city: "brindisi",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Brindisi", href: "/siti-web-brindisi" },
    ],
    intro: [
      L(`Brindisi lavora su scala industriale: porto e logistica, chimica ed energia, fornitori e
      servizi che ruotano attorno. Sono aziende che vendono ad altre aziende, dove il sito non
      fa lo spettacolo: qualifica. Un sito chiaro che spiega cosa fate, per chi lavorate, con
      riferimenti e richieste d'offerta strutturate, fa più di mille pagine di brochure.`),
      L(`Per questo settore costruiamo siti con schede macchina e servizi documentate, aree
      riservate per i clienti, cataloghi scaricabili e form d'offerta che arrivano per email
      complete di tutto. Velocità e lingua contano: il sito deve caricare in un secondo ed essere
      scritto in italiano corretto, perché chi lo legge decide in base a come comunicate.`),
      L(`Anche a Brindisi il metodo resta quello: riunione d'avvio nei vostri uffici, obiettivi
      scritti, preventivo entro 24 ore, consegna in 7 giorni per una vetrina. E dopo la
      consegna, la manutenzione tecnica del primo anno è inclusa: il sito non è un folklore
      di una settimana, è uno strumento che resta in piedi.`),
    ],
    services: [
      { title: "Siti B2B", text: "Servizi documentati, aree riservate e richieste d'offerta complete." },
      { title: "Cataloghi digitali", text: "Schede prodotto e download sempre aggiornabili in autonomia." },
      { title: "SEO industriale", text: "Le ricerche tecniche dei fornitori e dei clienti presidiate per parola chiave." },
      { title: "Riunione nei vostri uffici", text: "Avvio in un'ora: obiettivi, tempi, prezzo scritto." },
    ],
    faq: [
      {
        q: "Quanto costa un sito aziendale a Brindisi?",
        a: "Vetrina da 1.000 €, siti B2B con aree riservate da 3.000 €. Preventivo scritto entro 24 ore dalla chat.",
      },
      {
        q: "Venite in sede a Brindisi?",
        a: "Sì: siamo a un'ora, la riunione d'avvio la teniamo nei vostri uffici senza sovrapprezzi.",
      },
      {
        q: "Gestite siti con molte pagine tecniche?",
        a: "Sì: strutture organizzate per reparto e servizio, con ricerca interna e contenuti aggiornabili da voi.",
      },
      {
        q: "Serve anche la versione in inglese?",
        a: "Se vendete all'estero sì: la prepariamo con testi scritti correttamente, non tradotti alla lettera.",
      },
      {
        q: "Chi mantiene il sito dopo?",
        a: "Noi: primo anno di manutenzione tecnica incluso, poi si decide con calma e senza vincoli.",
      },
    ],
    proof:
      "La riunione d'avvio si fa nei vostri uffici a Brindisi: un'ora, obiettivi scritti e il progetto in moto.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-maglie",
    h1: "Siti web a Maglie e nell'interno del Salento",
    title: "Siti Web Maglie | Artigiani e agroalimentare",
    description:
      "Siti web a Maglie e nella Grecìa Salentina per artigiani, agroalimentare e professionisti: riunione da voi, sito in 7 giorni, supporto al telefono.",
    keyword: "siti web Maglie",
    keywords: ["web agency Maglie", "sito web Grecìa Salentina"],
    city: "maglie",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Maglie", href: "/siti-web-maglie" },
    ],
    intro: [
      L(`Maglie è il crocevia dell'interno salentino: negozi storici, artigiani che lavorano la
      pietra e il ferro, aziende agricole e caseifici, professionisti che seguono i comuni della
      Grecìa Salentina. È un mercato dove il passaparola comanda — e dove un sito ben fatto
      serve a far arrivare quel passaparola su Google, quando qualcuno cerca prima di chiedere.`),
      L(`Costruiamo siti che parlano la lingua del luogo: pagine per i comuni vicini, riferimenti
      reali, recensioni dei clienti veri. Per l'agroalimentare aggiungiamo la vendita diretta e
      la narrazione del prodotto; per gli artigiani il portfolio dei lavori con foto sul posto;
      per gli studi il numero cliccabile e gli orari chiari. Ogni attività ha il suo modo di
      essere cercata: il sito lo segue.`),
      L(`Veniamo da voi per la riunione d'avvio — Maglie è a un'ora da Lecce — e il progetto parte
      il giorno dopo. Sette giorni per la vetrina, anteprima dal terzo, formazione registrata
      per aggiornare i contenuti da soli. E al telefono risponde chi ha costruito il sito,
      perché nell'interno la fiducia si costruisce così.`),
    ],
    services: [
      { title: "Portfolio artigiani", text: "I lavori con foto vere sul posto: ciò che hai fatto vende più di mille parole." },
      { title: "Vendita diretta agroalimentare", text: "Ordini via WhatsApp o negozio online per olio, formaggi e vite." },
      { title: "Pagine dei comuni", text: "Melpignano, Carpignano, Cursi, Castrignano: ogni paese cerca con parole sue." },
      { title: "Riunione da voi", text: "Avvio in sede a Maglie, senza costi aggiuntivi di trasferta." },
    ],
    faq: [
      {
        q: "Quanto costa un sito a Maglie?",
        a: "Le stesse fasce di tutta la provincia: vetrina da 1.000 €, e-commerce da 3.000 €. Preventivo in chat, scritto in 24 ore.",
      },
      {
        q: "Venite a Maglie o dobbiamo venire noi?",
        a: "Veniamo noi: la riunione d'avvio in sede a Maglie o da voi, come preferite.",
      },
      {
        q: "Seguite anche i comuni della Grecìa Salentina?",
        a: "Sì: ogni comune ha ricerche sue e pagine dedicate, perché chi cerca un artigiano a Carpignano usa altre parole di chi cerca a Lecce.",
      },
      {
        q: "Fate anche negozi online per prodotti del territorio?",
        a: "Sì: vendita diretta con spedizioni configurate, oppure ordini via WhatsApp per chi preferisce iniziare semplice.",
      },
      {
        q: "In quanto tempo sono online?",
        a: "Sette giorni lavorativi per la vetrina, con anteprima dal terzo giorno.",
      },
    ],
    proof:
      "Da Maglie a Lecce è un'ora di strada: la riunione d'avvio la facciamo da voi, il progetto parte il giorno dopo.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-copertino",
    h1: "Siti web a Copertino, con chi li costruisce",
    title: "Siti Web Copertino | Artigiani, studi e commercianti",
    description:
      "Siti web a Copertino per artigiani, studi e commercianti: sito in 7 giorni, scheda Google ottimizzata, recensioni in vista e supporto diretto.",
    keyword: "siti web Copertino",
    keywords: ["web agency Copertino", "creazione sito web Copertino"],
    city: "copertino",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web Copertino", href: "/siti-web-copertino" },
    ],
    intro: [
      L(`A Copertino le attività vivono di raccomandazioni: l'armadio del falegname, la rifinitura
      del carrozziere, la consulenza dello studio che segue le famiglie da tre generazioni.
      Il sito web serve a fare una cosa precisa: far trovare quelle raccomandazioni anche a chi
      non conosce nessuno, cercando su Google «a Copertino» dal telefono.`),
      L(`Per questo il sito di un artigiano o di uno studio qui ha tre ingredienti: recensioni
      vere in vista, numero cliccabile in alto e fotografie dei lavori fatte sul posto. Aggiungiamo
      la scheda Google curata come una vetrina in più: categorie giuste, foto aggiornate, orari
      veri. È poco, è tutto: chi cerca trova, chi trova chiama.`),
      L(`Il progetto dura sette giorni per una vetrina, con testi scritti da noi dopo un'intervista
      di venti minuti. A Copertino ci arriviamo in quindici minuti da Lecce: la riunione la
      teniamo da voi, al bar della piazza o in ufficio. E dopo la consegna, aggiornare i
      contenuti richiede due minuti: te lo spieghiamo in un video che resta tuo.`),
    ],
    services: [
      { title: "Sito vetrina 7 giorni", text: "Cinque pagine, testi inclusi, foto dei lavori sul posto." },
      { title: "Recensioni in vista", text: "Le recensioni Google integrate nel sito, con metodo per raccoglierne di nuove." },
      { title: "Scheda Google curata", text: "Categorie, orari e foto: la seconda vetrina, quella della mappa." },
      { title: "Supporto diretto", text: "Telefono e WhatsApp rispondono a chi ha costruito il sito." },
    ],
    faq: [
      {
        q: "Quanto costa un sito a Copertino?",
        a: "Da 1.000 € per la vetrina: testi, SEO base, formazione e primo anno di manutenzione tecnica inclusi.",
      },
      {
        q: "Quanto siete lontani?",
        a: "Quindici minuti da Lecce: la riunione d'avvio la facciamo da voi, senza costi aggiuntivi.",
      },
      {
        q: "Fate anche siti per studi professionali?",
        a: "Sì: con area dedicata ai servizi, appuntamenti prenotabili e attenzione alla riservatezza.",
      },
      {
        q: "Il sito mi porta i clienti del passaparola?",
        a: "Li rende visibili: chi ti ha consigliato può trovarti online, e chi non conosce nessuno ti trova lo stesso.",
      },
      {
        q: "Posso aggiornare i contenuti da solo?",
        a: "Sì: due minuti, dal telefono, con il video di formazione registrato che ti consegniamo.",
      },
    ],
    proof:
      "A Copertino il sito funziona come il passaparola: recensioni vere, foto dei lavori e un numero che risponde.",
    serviceType: "Siti web",
  },
  {
    slug: "siti-web-ristoranti-salento",
    h1: "Siti web per ristoranti del Salento",
    title: "Siti Web Ristoranti Salento | Menu e prenotazioni",
    description:
      "Siti web per ristoranti del Salento: menu aggiornabile in due minuti, prenotazioni dirette via WhatsApp, recensioni Google e foto che fanno venire fame.",
    keyword: "sito web ristorante Salento",
    keywords: ["sito ristorante Lecce", "menu online", "prenotazioni ristorante"],
    city: "gallipoli",
    breadcrumb: [
      { name: "Home", href: "/" },
      { name: "Siti web ristoranti Salento", href: "/siti-web-ristoranti-salento" },
    ],
    intro: [
      L(`Il cliente del ristorante decide in trenta secondi: cerca sulla mappa, apre due siti,
      guarda le foto, controlla il menu. Se il tuo sito è un PDF del 2019 o una pagina su un
      portale pieno di pubblicità altrui, la prenotazione va al vicino. Il sito che costruiamo
      mette in fila le cose giuste: foto della sala e dei piatti, menu aggiornato, numero
      per prenotare, recensioni.`),
      L(`Il menu è il cuore: deve cambiare con la stagione e con il mercato, in due minuti, dal
      telefono, senza chiamare nessuno. Le prenotazioni arrivano dirette su WhatsApp con data
      e coperti — zero commissioni, il cliente è tuo. E per il turismo aggiungiamo la versione
      in inglese e la scheda Google con foto stagionali: è lì che il turista decide dove cenare
      stanotte.`),
      L(`Funziona per il ristorante di città che vive di clientela abituale e per la trattoria
      della costa che fa la stagione: cambia il calendario, non il metodo. La realizzazione
      parte da una chiacchierata di venti minuti sui piatti che vuoi raccontare, e il sito è
      online in sette giorni con le foto fatte bene — tue, non da catalogo.`),
    ],
    services: [
      { title: "Menu vivente", text: "Piatti e prezzi aggiornati in due minuti dal telefono, stagionalità inclusa." },
      { title: "Prenotazioni dirette", text: "WhatsApp con data e coperti: zero commissioni, cliente tuo." },
      { title: "Foto che vendono", text: "Piatti e sala fotografati bene: il cliente mangia prima con gli occhi." },
      { title: "Google curata", text: "Scheda con menu, orari, foto stagionali e recensioni a cui rispondere." },
    ],
    faq: [
      {
        q: "Quanto costa un sito per un ristorante?",
        a: "Da 1.000 €: menu gestibile, prenotazioni WhatsApp, foto e SEO locale inclusi nel prezzo.",
      },
      {
        q: "Devo cambiare il menu ogni stagione?",
        a: "Sì, e lo fai tu in due minuti dal telefono. Se preferisci, lo aggiorniamo noi a chiamata.",
      },
      {
        q: "Serve il sito se sono già su Tripadvisor e Google?",
        a: "Sì: quelle sono vetrine affittate. Il tuo sito porta la prenotazione diretta, senza intermedi e senza pubblicità altrui.",
      },
      {
        q: "Chi fa le foto?",
        a: "Le tue, se sono buone; altrimenti un fotografo del territorio a listino concordato prima di partire.",
      },
      {
        q: "In quanto tempo sono online?",
        a: "Sette giorni lavorativi. Se serve per la stagione, l'anteprima arriva dal terzo giorno.",
      },
    ],
    proof:
      "Il menu si aggiorna in due minuti e le prenotazioni arrivano dirette su WhatsApp: la tavola si riempie, la commissione no.",
    serviceType: "Siti web ristorazione",
  },
];

export function getLanding(slug: string) {
  return LANDINGS.find((l) => l.slug === slug);
}

/** I 4 chip cliccabili dell'hero (editabili da admin). */
export const SEARCH_CHIPS = [
  { label: "Sito web in 7 giorni", query: "sito web in 7 giorni" },
  { label: "Sito per hotel e B&B", query: "sito per hotel e B&B" },
  { label: "Preventivo e-commerce", query: "preventivo e-commerce" },
  { label: "SEO locale", query: "seo locale" },
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
