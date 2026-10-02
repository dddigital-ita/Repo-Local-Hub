/**
 * COERENZA SCHEDA CLIENTE ↔ LEAD COLLEGATO — cuore PURO, zero import.
 *
 * Le regole che derivano l'identità della scheda dal lead vivono QUI e
 * girano identiche nei test di node (import diretto del .ts, come
 * settings-status.ts: nessuna costante duplicata, le decisioni sono
 * verificate dove vivono davvero). I letture DB/sync restano in
 * `clients.ts` (server), la UI solo stampa.
 *
 * Regole verificate da tests/client-lead-coherence.test.mjs:
 *  - TELEFONO: `toE164Pure` normalizza lead.phone / lead.wa_phone nello
 *    stesso E.164 che fa da chiave di dedup — lo stesso numero su canali
 *    diversi è UN cliente;
 *  - BUDGET: `withBudgetTotal` somma il MASSIMO di ogni voce dichiarata
 *    (il «~N € dichiarati» della scheda è derivato qui, dal budget
 *    testuale del lead);
 *  - NOME: `resolveClientName` decide la priorità lead > header email >
 *    locale dell'indirizzo — la scheda mostra il nome del lead quando
 *    esiste, non il pezzo prima della @ di una email.
 */

/** Email minuscola e validata: la chiave di dedup per il canale email. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normEmailPure(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim().toLowerCase();
  return t && EMAIL_RE.test(t) && t.length <= 200 ? t : null;
}

/**
 * Normalizzazione E.164 condivisa web+WhatsApp (spec di messaging.toE164,
 * replicata qui in forma pura per i test e per i derivatori senza DB):
 * lo stesso numero al telefono è lo stesso cliente, qualunque canale
 * abbia scritto. null se non normalizzabile: meglio nessun dedup che
 * uno sbagliato.
 */
export function toE164Pure(raw: string | null | undefined, defaultCountry = "39"): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const withPlus = t.startsWith("+");
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  if (withPlus) return `+${digits}`;
  if (digits.length < 8 || digits.length > 13) return null;
  return `+${defaultCountry}${digits}`;
}

/** Telefono identitario del ticket: wa_phone > lead.phone, normalizzato. */
export function identityPhonePure(
  waPhone: string | null | undefined,
  leadPhone: string | null | undefined,
): string | null {
  return toE164Pure(waPhone ?? leadPhone ?? "");
}

export interface BudgetedRow {
  budgets?: string[] | null;
  budget_total?: number | null;
}

/**
 * Somma euristica dei budget: estrae i numeri da ogni valore dichiarato
 * («2000-3000 euro», «fino a 1500», «800€») e somma il MASSIMO di ogni
 * voce (il tetto dichiarato è il segnale commerciale). Non contano:
 * «poco/molto», i testi senza cifre, gli ANNI NUDI («dal 2024» non è un
 * budget) e le run di cifre troppo lunghe per essere soldi (un telefono
 * troncato a 6 cifre non diventa un budget da 300.000 €). Mai inventato:
 * solo cifre davvero scritte e plausibili come soldi.
 */
export function withBudgetTotal<T extends BudgetedRow>(c: T): T {
  if (!c.budgets?.length) return { ...c, budget_total: null };
  let total = 0;
  let any = false;
  for (const raw of c.budgets) {
    if (!raw) continue;
    // Run di cifre INTERE (con i gruppi «1.000» delle migliaia): prendere
    // solo i primi 6 digit («5000001» → «500000») trasformerebbe un
    // telefono o un codice in un budget.
    const tokens = [...raw.matchAll(/\d{1,3}(?:[.,]\d{3})+|\d+/g)].map((m) => ({
      value: Number(m[0].replace(/[.,]/g, "")),
      grouped: /[.,]/.test(m[0]),
    }));
    const money = tokens.filter(
      (t) =>
        t.value >= 50 &&
        t.value <= 500_000 &&
        // Anno nudo (19xx/20xx senza separatore di migliaia): quasi sempre
        // una data («il sito è online dal 2024»), mai un budget. Con il
        // punto («2.024») il separatore segnala migliaia, non una data.
        !(t.value >= 1900 && t.value <= 2100 && !t.grouped),
    );
    if (!money.length) continue;
    total += Math.max(...money.map((t) => t.value));
    any = true;
  }
  return { ...c, budget_total: any ? total : null };
}

/**
 * Ordinamento «Budget: più alto prima» della lista Clienti: i clienti CON
 * budget dichiarato vengono prima (dal più alto), chi non lo ha dichiarato
 * segue senza saltare in fondo né spostarsi a ogni sync. Comparatore puro:
 * l'ordinamento è una regola del portafoglio, testata dove vive.
 */
export function byBudgetDesc<T extends BudgetedRow>(a: T, b: T): number {
  const ba = a.budget_total ?? -1;
  const bb = b.budget_total ?? -1;
  return bb - ba;
}

/**
 * Nome del cliente con la priorità del sync: lead > header email
 * («Nome <mail@…>» salvato in email_ingest) > parte locale dell'indirizzo.
 * Ritorna null se non c'è davvero niente (la scheda mostrerà il fallback
 * «cliente senza nome», mai un nome inventato).
 */
export function resolveClientNamePure(
  leadName: string | null | undefined,
  fromHeaderName: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const lead = leadName?.trim().slice(0, 100);
  if (lead) return lead;
  const fn = fromHeaderName?.trim();
  if (fn) return fn.slice(0, 100);
  if (email) {
    return email.split("@")[0].replace(/[._-]+/g, " ").slice(0, 100);
  }
  return null;
}
