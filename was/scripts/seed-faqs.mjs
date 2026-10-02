/**
 * Prepopola le FAQ addestrative di Ambrosio con le risposte ufficiali
 * dell'agenzia: prezzi dei pacchetti (dal DB stesso, così restano allineati),
 * tempi di consegna, transfer dominio, SEO e pagamenti. Ogni risposta chiude
 * con l'invito a fissare l'appuntamento, come da regole di Ambrosio.
 *
 * Idempotente: se la domanda esiste già (confronto normalizzato) aggiorna
 * risposta e priorità, altrimenti inserisce. Rieseguibile senza duplicati.
 *
 * Uso: node scripts/seed-faqs.mjs
 */
import pg from "pg";
import { readFileSync } from "fs";

const line = readFileSync(".env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL"));
if (!line) {
  console.error("DATABASE_URL non trovata in .env.local");
  process.exit(1);
}
const cs = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");

const norm = (s) =>
  s.toLowerCase().replace(/[^a-zà-ÿ0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** [domanda, risposta, priorità] — priorità bassa = considerata prima dal prompt. */
const FAQS = [
  [
    "Quanto costa un sito vetrina?",
    "Il sito vetrina parte da 800 € una tantum: fino a 5 pagine, design responsive, form contatti e SEO base con Google Business Profile incluso, online in 7 giorni. Se vuoi i numeri precisi per la tua attività, ti fissiamo una call gratuita di 20 minuti con Daniele: preferisci mattina o pomeriggio?",
    10,
  ],
  [
    "Quanto costa un sito professionale?",
    "Il sito professionale parte da 1.500 € una tantum: fino a 10 pagine, testi curati e fotografie, SEO locale completa. È la scelta giusta per studi e attività che vogliono farsi trovare. Ti preparo un preventivo scritto in 24 ore: ti va una call veloce per capirci?",
    11,
  ],
  [
    "Quanto costa un sito e-commerce?",
    "L'e-commerce parte da 2.500 € una tantum: catalogo e carrello, pagamenti con Stripe o PayPal, spedizioni configurate e formazione alla gestione inclusa. Ogni negozio ha esigenze diverse: ti fissiamo una call gratuita di 20 minuti per capire il preventivo giusto, giovedì o venerdì?",
    12,
  ],
  [
    "Quanto costa la SEO?",
    "La SEO locale parte da 400 € al mese: posizionamento nella tua zona, contenuti nuovi ogni mese e report mensile trasparente. I primi risultati si vedono in genere entro 2-3 mesi. Se vuoi capire se fa per te, ti fissiamo una call gratuita con Daniele: preferisci mattina o pomeriggio?",
    13,
  ],
  [
    "Che differenza c'è tra sito vetrina e e-commerce?",
    "Il sito vetrina (da 800 €) ti fa trovare e presenta i servizi, online in 7 giorni. L'e-commerce (da 2.500 €) ti fa vendere: catalogo, carrello, pagamenti e gestione dal pannello. Il primo passo è una call gratuita di 20 minuti con Daniele per capire quale serve davvero a te: giovedì o venerdì?",
    20,
  ],
  [
    "In quanto tempo avete il sito online?",
    "Il sito vetrina è online in 7 giorni: anteprima dal giorno 3 e un ciclo di correzioni al giorno 6. Progetti più grandi dipendono dai contenuti, ma il preventivo indica sempre la data di consegna e nessuna penale se consegniamo in ritardo. Ti fissiamo una call per fissare i tempi sul tuo progetto?",
    14,
  ],
  [
    "Fate il transfer del dominio?",
    "Sì: ci occupiamo noi di trasferire o registrare il dominio, intestato a te (circa 12 €/anno pagati direttamente al registrar). Il sito resta sempre tuo, nessun vincolo con noi. Ti prepariamo il passaggio in una call gratuita di 20 minuti: quando ti va?",
    15,
  ],
  [
    "Ci sono costi annuali oltre al sito?",
    "Oltre al sito: dominio circa 12 €/anno e hosting 100-200 €/anno, entrambi intestati a te e gestibili come vuoi. Nessun costo nascosto: tutto è scritto nel preventivo che vale 30 giorni. Ti mandiamo il preventivo completo dopo una call veloce, ti va?",
    16,
  ],
  [
    "Come funzionano i pagamenti?",
    "50% all'avvio e 50% alla pubblicazione, fattura elettronica inclusa. Per l'e-commerce si può anche rateizzare: 50% all'avvio, 25% all'anteprima, 25% alla pubblicazione, senza interessi. Ne parliamo in una call gratuita di 20 minuti: preferisci mattina o pomeriggio?",
    17,
  ],
  [
    "Chi scrive i testi del sito?",
    "Li scriviamo noi, inclusi nel prezzo: partiamo da un'intervista di 20 minuti e ne escono testi e struttura pronti. Tu devi solo raccontarci la tua attività. Ti fissiamo l'intervista? Giovedì o venerdì?",
    18,
  ],
  [
    "Il sito resta mio se cambio agenzia?",
    "Sempre: dominio e hosting intestati a te e, se cambi agenzia, ti consegniamo file, accessi e backup. Nessun riscatto. Questo lo mettiamo nero su bianco nel preventivo: te lo prepariamo dopo una call gratuita, ti va?",
    19,
  ],
];

const pool = new pg.Pool({
  connectionString: cs,
  ssl: { rejectUnauthorized: false },
});

let created = 0;
let updated = 0;

/** Id della FAQ con la stessa domanda (confronto normalizzato), se esiste. */
async function findSameQuestion(question) {
  const { rows } = await pool.query("select id, question from ai_faqs");
  const target = norm(question);
  return rows.find((r) => norm(r.question) === target)?.id;
}

for (const [question, answer, priority] of FAQS) {
  const id = await findSameQuestion(question);
  if (id) {
    await pool.query(
      "update ai_faqs set answer = $1, priority = $2, active = true, updated_at = now() where id = $3",
      [answer, priority, id],
    );
    updated++;
  } else {
    await pool.query(
      "insert into ai_faqs (question, answer, priority, active) values ($1, $2, $3, true)",
      [question, answer, priority],
    );
    created++;
  }
}

const total = await pool.query("select count(*)::int as n from ai_faqs");
console.log(`FAQ seminate: ${created} create, ${updated} aggiornate. Totale nel DB: ${total.rows[0].n}`);
await pool.end();
