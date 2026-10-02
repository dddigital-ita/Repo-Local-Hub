/**
 * Semina le traduzioni ufficiali (en + de) delle FAQ di Ambrosio.
 *
 * Fedeltà: le risposte sono traduzioni fedeli dell'italiano (fonte di
 * verità), niente aggiunte; prezzi e valute restano identici (800 €,
 * 2.500 €, 400 €/mese — solo il separatore delle migliaia si adatta alla
 * lingua); gli inviti alla call restano inviti, senza promesse nuove.
 *
 * Idempotente: le FAQ si riconoscono per domanda normalizzata (minuscole,
 * spazi collassati); le traduzioni esistenti per una lingua vengono
 * SOVRASCRITTE da questo file (è la fonte ufficiale delle traduzioni),
 * le altre lingue già presenti restano intatte.
 *
 * Rieseguibile in qualunque momento: `node scripts/seed-faq-translations.mjs`
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/^¿/, "");

/** [domanda italiana (fonte), {en, de}] */
const TRANSLATIONS = [
  [
    "Quanto costa un sito vetrina?",
    {
      en: {
        question: "How much does a showcase website cost?",
        answer:
          "The showcase website starts from €800 one-off: up to 5 pages, responsive design, contact form and basic SEO with Google Business Profile included, online in 7 days. If you'd like exact numbers for your business, we'll set up a free 20-minute call with Daniele — morning or afternoon?",
      },
      de: {
        question: "Was kostet eine Showcase-Website?",
        answer:
          "Die Showcase-Website startet ab 800 € einmalig: bis zu 5 Seiten, responsives Design, Kontaktformular und Basis-SEO mit Google Business Profile inklusive, online in 7 Tagen. Wenn Sie die genauen Zahlen für Ihr Unternehmen möchten, vereinbaren wir ein kostenloses 20-minütiges Gespräch mit Daniele — lieber vormittags oder nachmittags?",
      },
    },
  ],
  [
    "Quanto costa un sito professionale?",
    {
      en: {
        question: "How much does a professional website cost?",
        answer:
          "The professional website starts from €1,500 one-off: up to 10 pages, carefully written copy and photography, complete local SEO. It's the right choice for practices and businesses that want to be found. I'll prepare a written quote within 24 hours — how about a quick call to discuss it?",
      },
      de: {
        question: "Was kostet eine professionelle Website?",
        answer:
          "Die professionelle Website startet ab 1.500 € einmalig: bis zu 10 Seiten, sorgfältig geschriebene Texte und Fotografie, komplette lokale SEO. Die richtige Wahl für Praxen und Betriebe, die gefunden werden wollen. Ich bereite Ihnen ein schriftliches Angebot innerhalb von 24 Stunden vor — passt ein kurzes Gespräch?",
      },
    },
  ],
  [
    "Quanto costa un sito e-commerce?",
    {
      en: {
        question: "How much does an e-commerce website cost?",
        answer:
          "The e-commerce starts from €2,500 one-off: catalogue and cart, payments with Stripe or PayPal, configured shipping and management training included. Every shop has different needs: we'll set up a free 20-minute call to work out the right quote — Thursday or Friday?",
      },
      de: {
        question: "Was kostet ein E-Commerce?",
        answer:
          "Der Onlineshop startet ab 2.500 € einmalig: Katalog und Warenkorb, Zahlungen mit Stripe oder PayPal, konfigurierter Versand und Schulung zur Verwaltung inklusive. Jeder Shop hat andere Anforderungen: Wir vereinbaren ein kostenloses 20-minütiges Gespräch, um das passende Angebot zu finden — Donnerstag oder Freitag?",
      },
    },
  ],
  [
    "quanto costa la seo",
    {
      en: {
        question: "How much does SEO cost?",
        answer:
          "Local SEO starts from €400 per month: ranking in your area, fresh content every month and a transparent monthly report. The first results usually appear within 2-3 months. If you'd like to know whether it's right for you, we'll set up a free call with Daniele — morning or afternoon?",
      },
      de: {
        question: "Was kostet SEO?",
        answer:
          "Lokale SEO startet ab 400 € pro Monat: Ranking in Ihrer Region, jeden Monat neue Inhalte und ein transparenter Monatsbericht. Die ersten Ergebnisse zeigen sich in der Regel innerhalb von 2-3 Monaten. Wenn Sie wissen möchten, ob es zu Ihnen passt, vereinbaren wir ein kostenloses Gespräch mit Daniele — lieber vormittags oder nachmittags?",
      },
    },
  ],
  [
    "In quanto tempo avete il sito online?",
    {
      en: {
        question: "How long until the website is online?",
        answer:
          "The showcase website is online in 7 days: preview from day 3 and a round of corrections on day 6. Larger projects depend on the content, but the quote always states the delivery date — and there's no penalty if we're late. Shall we set up a call to schedule the timeline for your project?",
      },
      de: {
        question: "Inwiefern ist die Website online, also wie lange dauert es?",
        answer:
          "Die Showcase-Website ist in 7 Tagen online: Vorschau ab Tag 3 und eine Korrekturrunde am Tag 6. Größere Projekte hängen von den Inhalten ab, aber das Angebot nennt immer das Lieferdatum — und es gibt keine Vertragsstrafe, wenn wir uns verspäten. Vereinbaren wir ein Gespräch, um die Termine für Ihr Projekt festzulegen?",
      },
    },
  ],
  [
    "Fate il transfer del dominio?",
    {
      en: {
        question: "Do you handle domain transfer?",
        answer:
          "Yes: we take care of transferring or registering the domain, registered in your name (about €12/year paid directly to the registrar). The website is always yours, no strings attached with us. We'll handle the switch in a free 20-minute call — when suits you?",
      },
      de: {
        question: "Übernehmen Sie den Domain-Transfer?",
        answer:
          "Ja: Wir kümmern uns um die Übertragung oder Registrierung der Domain, auf Ihren Namen eingetragen (ca. 12 €/Jahr, direkt an den Registrar gezahlt). Die Website gehört immer Ihnen, keine Bindung an uns. Den Umzug erledigen wir in einem kostenlosen 20-minütigen Gespräch — wann passt es Ihnen?",
      },
    },
  ],
  [
    "Ci sono costi annuali oltre al sito?",
    {
      en: {
        question: "Are there yearly costs besides the website?",
        answer:
          "Besides the website: domain about €12/year and hosting €100-200/year, both registered in your name and manageable however you like. No hidden costs: everything is written in the quote, which is valid for 30 days. We'll send the full quote after a quick call — how does that sound?",
      },
      de: {
        question: "Gibt es jährliche Kosten außerhalb der Website?",
        answer:
          "Neben der Website: Domain ca. 12 €/Jahr und Hosting 100-200 €/Jahr, beide auf Ihren Namen eingetragen und frei verwaltbar. Keine versteckten Kosten: alles steht im Angebot, das 30 Tage gültig ist. Das vollständige Angebot schicken wir nach einem kurzen Gespräch — passt das?",
      },
    },
  ],
  [
    "Come funzionano i pagamenti?",
    {
      en: {
        question: "How do payments work?",
        answer:
          "50% at the start and 50% on publication, electronic invoicing included. For e-commerce you can also pay in instalments: 50% at the start, 25% at the preview, 25% on publication, interest-free. Shall we talk it through in a free 20-minute call — morning or afternoon?",
      },
      de: {
        question: "Wie funktionieren die Zahlungen?",
        answer:
          "50 % zum Start und 50 % bei Veröffentlichung, elektronische Rechnungsstellung inklusive. Beim Onlineshop ist auch Ratenzahlung möglich: 50 % zum Start, 25 % bei der Vorschau, 25 % bei Veröffentlichung, zinsfrei. Besprechen wir es in einem kostenlosen 20-minütigen Gespräch — lieber vormittags oder nachmittags?",
      },
    },
  ],
  [
    "Chi scrive i testi del sito?",
    {
      en: {
        question: "Who writes the website copy?",
        answer:
          "We do, included in the price: we start from a 20-minute interview and that's where the copy and structure come from. All you have to do is tell us about your business. Shall we book the interview? Thursday or Friday?",
      },
      de: {
        question: "Wer schreibt die Texte für die Website?",
        answer:
          "Wir, im Preis enthalten: Wir starten mit einem 20-minütigen Interview, und daraus entstehen Texte und Struktur. Sie müssen nur Ihr Unternehmen schildern. Vereinbaren wir das Interview? Donnerstag oder Freitag?",
      },
    },
  ],
  [
    "Il sito resta mio se cambio agenzia?",
    {
      en: {
        question: "Is the website still mine if I change agency?",
        answer:
          "Always: domain and hosting registered in your name and, if you change agency, we hand over files, access credentials and backups. No ransom. We put this in writing in the quote: we'll prepare it after a free call — how does that sound?",
      },
      de: {
        question: "Bleibt die Website mein Eigentum, wenn ich die Agentur wechsle?",
        answer:
          "Immer: Domain und Hosting auf Ihren Namen eingetragen, und wenn Sie die Agentur wechseln, übergeben wir Dateien, Zugänge und Backups. Kein Lösegeld. Das halten wir schwarz auf weiß im Angebot fest: Wir bereiten es nach einem kostenlosen Gespräch vor — passt das?",
      },
    },
  ],
  [
    "Che differenza c'è tra sito vetrina e e-commerce?",
    {
      en: {
        question: "What's the difference between a showcase website and an e-commerce?",
        answer:
          "The showcase website (from €800) gets you found and presents your services, online in 7 days. The e-commerce (from €2,500) gets you selling: catalogue, cart, payments and panel management. The first step is a free 20-minute call with Daniele to work out which one you actually need: Thursday or Friday?",
      },
      de: {
        question: "Was ist der Unterschied zwischen einer Showcase-Website und einem Onlineshop?",
        answer:
          "Die Showcase-Website (ab 800 €) lässt Sie gefunden werden und präsentiert Ihre Leistungen, online in 7 Tagen. Der Onlineshop (ab 2.500 €) lässt Sie verkaufen: Katalog, Warenkorb, Zahlungen und Verwaltung über das Panel. Der erste Schritt ist ein kostenloses 20-minütiges Gespräch mit Daniele, um herauszufinden, was Sie wirklich brauchen: Donnerstag oder Freitag?",
      },
    },
  ],
];

let updated = 0;
let missing = [];

for (const [questionIt, tr] of TRANSLATIONS) {
  const key = norm(questionIt);
  const { rows } = await pool.query("select id, question, translations from ai_faqs where active");
  const hit = rows.find((r) => norm(r.question) === key);
  if (!hit) {
    missing.push(questionIt);
    continue;
  }
  const merged = { ...(hit.translations ?? {}), ...Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, `${v.question} → ${v.answer}`])) };
  const r = await pool.query("update ai_faqs set translations = $2::jsonb, updated_at = now() where id = $1", [
    hit.id,
    JSON.stringify(merged),
  ]);
  updated += r.rowCount;
}

console.log(`FAQ aggiornate: ${updated}`);
if (missing.length) {
  console.error("ATTENZIONE: FAQ non trovate nel DB (domanda cambiata?):");
  for (const q of missing) console.error("  -", q);
  process.exit(1);
}
await pool.end();
