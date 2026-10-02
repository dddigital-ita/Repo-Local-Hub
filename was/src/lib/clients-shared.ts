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

/* ── Tipo cliente (038) ──────────────────────────────────────────── */

/**
 * I tipi cliente come COSTANTE TIPIZZATA: la fonte unica del dominio —
 * DB (constraint di 038), select in scheda e filtro in lista leggono
 * QUESTA lista. Il fallback «senza tipo» non è un valore: è NULL, e la
 * UI lo chiama «Da classificare» — mai un tipo congetturato.
 */
export const CLIENT_TYPES = ["azienda", "privato", "ente_pubblico"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  azienda: "Azienda",
  privato: "Privato",
  ente_pubblico: "Ente pubblico",
};

/** Valore dal form/query → tipo valido, altrimenti null (maior scrittura). */
export function clientTypePure(raw: string | null | undefined): ClientType | null {
  const t = (raw ?? "").trim();
  return (CLIENT_TYPES as readonly string[]).includes(t) ? (t as ClientType) : null;
}

/* ── Suggerimento ditta per aziende senza ditta (038) ───────────── */

/** Riga grezza dei ditte citate nei lead del cliente (dal DB). */
export interface DittaCitataRow {
  company_name: string | null;
  n: number;
}

export interface DittaSuggeritaPureResult {
  /** La ditta da proporre, già ripulita e verificata, o null. */
  ditta: string | null;
  /** Quante citazioni distinte la sostengono (≥2 = segnale forte). */
  citazioni: number;
}

/**
 * Una ditta citata nei lead è un SUGGERIMENTO, mai una scrittura: il tipo
 * «azienda» è un atto umano (038) e la ragione sociale pure. La regola qui
 * (testata): il troncamento a 120 è la stessa manica del sync, la forza
 * minima è 2 citazioni DISTINTE (una sola è un dubbio, non un dato) — e
 * mai proporsi ciò che la scheda sa già (ditta presente), ciò che è stato
 * RIGETTATO esplicitamente dall'operatore (039, caso-insensibile) o ciò
 * che è solo rumore (email/URL senza nome).
 */
export const DITTA_SUGGERITA_MIN_CITAZIONI = 2;

export function dittaSuggeritaPure(
  citate: DittaCitataRow[] | null | undefined,
  dittaSalvata: string | null | undefined,
  rigettate: string[] | null | undefined,
): DittaSuggeritaPureResult {
  if (!Array.isArray(citate)) return { ditta: null, citazioni: 0 };
  const salvata = dittaSalvata?.trim().toLowerCase() ?? "";
  const giaNo = new Set((Array.isArray(rigettate) ? rigettate : []).map((d) => d?.trim().toLowerCase()).filter(Boolean));
  const candidate = new Map<string, { nome: string; n: number; nVariante: number }>();
  for (const r of citate) {
    const nome = r?.company_name?.trim().slice(0, 120);
    if (!nome) continue;
    const chiave = nome.toLowerCase();
    if (salvata && chiave === salvata) continue; // già in scheda: nulla da proporre
    if (giaNo.has(chiave)) continue; // rigettata dall'operatore: resta no
    // Rumore da chat: un indirizzo citato come «ditta» non è una ditta.
    if (chiave.includes("@") || /^https?:\/\//.test(chiave)) continue;
    const c = candidate.get(chiave);
    if (c) {
      c.n += r.n;
      // Il casing proposto è DETERMINISTICO e NON dipende dall'ordine del
      // SQL: vince la variante più citata; a parità, quella con PIÙ
      // MAIUSCOLE (acronimi e nomi propri: «Rossi SRL», non «rossi srl» —
      // attenzione: localeCompare da sola ordina le minuscole prima, non
      // è un tiebreak qui); a pari maiuscole, l'alfabeto.
      const maiu = (s: string) => (s.match(/[A-ZÀ-ÖØ-Þ]/g) ?? []).length;
      if (
        r.n > c.nVariante ||
        (r.n === c.nVariante &&
          (maiu(nome) > maiu(c.nome) || (maiu(nome) === maiu(c.nome) && nome.localeCompare(c.nome) < 0)))
      ) {
        c.nome = nome;
        c.nVariante = r.n;
      }
    } else candidate.set(chiave, { nome, n: r.n, nVariante: r.n });
  }
  // La più citata vince; a parità, l'ordine alfabetico rende deterministico
  // il risultato (stesso input → stessa proposta, testabile).
  const [migliore] = [...candidate.values()].sort(
    (a, b) => b.n - a.n || a.nome.localeCompare(b.nome),
  );
  if (!miglitoreGuard(migliore)) return { ditta: null, citazioni: 0 };
  return { ditta: migliore.nome, citazioni: migliore.n };
}

function miglitoreGuard(
  m: { nome: string; n: number; nVariante: number } | undefined,
): m is { nome: string; n: number; nVariante: number } {
  return !!m && m.n >= DITTA_SUGGERITA_MIN_CITAZIONI;
}

/* ── Coorte portafoglio per tipo nel tempo (038) ────────────────── */

/** Riga grezza dal DB: acquisitions del mese per tipo (date_trunc month). */
export interface TipoMeseRow {
  mese: string;
  client_type: string | null;
  n: number;
}

/** Riga della timeline: portafoglio CUMULATIVO a fine mese, per tipo. */
export interface TipoTimelineRow {
  mese: string;
  azienda: number;
  privato: number;
  ente_pubblico: number;
  da_classificare: number;
  totale: number;
}

/**
 * La crescita del portafoglio per tipo: da (mese, tipo, nuovi) costruisce
 * la serie CUMULATIVA mese per mese — «quanti clienti di ogni tipo avevamo
 * a fine mese». La regola vive qui (testata) e non nella route: stessa
 * tabella per CSV e per ogni futura vista. I valori fuori dominio non
 * esistono (constraint 038) e vengono ignorati difensivamente, non
 * nascosti in un altro tipo: mai spostare un dato che non capisci.
 */
export function clientsTypeTimelinePure(rows: TipoMeseRow[]): TipoTimelineRow[] {
  const perMese = new Map<string, Map<string, number>>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.mese) continue;
    const key =
      r.client_type === null || r.client_type === undefined
        ? "da_classificare"
        : (CLIENT_TYPES as readonly string[]).includes(r.client_type)
          ? r.client_type
          : null;
    if (!key) continue;
    if (!perMese.has(r.mese)) perMese.set(r.mese, new Map());
    const m = perMese.get(r.mese)!;
    m.set(key, (m.get(key) ?? 0) + r.n);
  }
  const acc: Omit<TipoTimelineRow, "mese" | "totale"> = {
    azienda: 0,
    privato: 0,
    ente_pubblico: 0,
    da_classificare: 0,
  };
  return [...perMese.keys()]
    .sort()
    .map((mese) => {
      const m = perMese.get(mese)!;
      for (const k of ["azienda", "privato", "ente_pubblico", "da_classificare"] as const) {
        acc[k] += m.get(k) ?? 0;
      }
      const totale = acc.azienda + acc.privato + acc.ente_pubblico + acc.da_classificare;
      return { mese, ...acc, totale };
    });
}

/** Etichetta per la UI: i tipi noti dal dizionario, NULL → «Da classificare». */
export function clientTypeLabelPure(t: string | null | undefined): string {
  return t ? (CLIENT_TYPE_LABELS[t as ClientType] ?? t) : "Da classificare";
}

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
 * («2000-3000 euro», «fino a 1500», «800€», «5-8k €») e somma il MASSIMO di
 * ogni voce (il tetto dichiarato è il segnale commerciale). Non contano:
 * «poco/molto», i testi senza cifre, gli ANNI NUDI («dal 2024» non è un
 * budget) e le run di cifre troppo lunghe per essere soldi (un telefono
 * troncato a 6 cifre non diventa un budget da 300.000 €). Mai inventato:
 * solo cifre davvero scritte e plausibili come soldi.
 *
 * Il suffisso «k» (5k, 5-8k, 10k) vale per MILLE: i bottoni budget della chat
 * e gli operatori lo scrivono spesso — «5-8k €» è 8.000, non «otto euro».
 * [Adozione dal gemello «Web Agency Salento + Installer», same-repo sync 30/09.]
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
    // Il suffisso «k» moltiplica la cifra per 1.000 (catturato subito dopo:
    // «5-8k» → token 8 con k → 8.000).
    const tokens = [...raw.matchAll(/\d{1,3}(?:[.,]\d{3})+|\d+/g)].map((m) => ({
      value: Number(m[0].replace(/[.,]/g, "")),
      grouped: /[.,]/.test(m[0]),
      k: /^\s*k\b/i.test(raw.slice(m.index + m[0].length, m.index + m[0].length + 2)),
    }));
    const money = tokens
      .map((t) => ({ ...t, value: t.k ? t.value * 1_000 : t.value }))
      .filter(
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
