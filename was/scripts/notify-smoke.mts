/**
 * SMOKE notifica lead — verifica CHE IL TESTO CONTENGA i dati nuovi:
 *   npx tsx scripts/notify-smoke.mts
 *
 * Background (30/09/2026): notifyOperator non riceveva affatto company/
 * companyName — la notifica all'operatore non li includeva mai. Ora il lead
 * route li passa e buildBody li compone; questo smoke esegue la composizione
 * (stesso testo che partono in email Resend e Telegram) e fallisce se le righe
 * mancano. L'invio reale resta non testabile in locale: gli endpoint sono
 * hardcoded (api.resend.com / api.telegram.org) e in E2E restano non
 * configurati — by design, nessuna email vera dal test.
 */
import { buildBody } from "../src/lib/notify.ts";

const body = buildBody({
  name: "Marco Rossi",
  phone: "+39 333 1234567",
  service: "sito web nuovo",
  urgency: "entro 2 settimane",
  budget: "fino a 1.000 €",
  existingSite: "no, da zero",
  company: "azienda",
  companyName: "Trattoria Da Vinci",
  query: "sito per il ristorante",
  sourcePage: "/",
  operatorName: "Daniele",
  operatorPhone: "+393200865907",
});

console.log("── testo notifica ──");
console.log(body);
console.log("────────────────────");

const richieste: [string, RegExp][] = [
  ["riga tipo cliente", /^Tipo cliente: azienda$/m],
  ["riga ditta", /^Ditta: Trattoria Da Vinci$/m],
  ["riga sito esistente col nuovo value", /^Sito esistente: no, da zero$/m],
];
let ko = 0;
for (const [nome, re] of richieste) {
  if (re.test(body)) {
    console.log(`✔ ${nome}`);
  } else {
    console.error(`✘ ${nome} — MANCA nel testo della notifica`);
    ko++;
  }
}
if (ko > 0) process.exit(1);
console.log("\nsmoke notifica OK: tipo cliente e ditta arrivano al testo dell'operatore");
