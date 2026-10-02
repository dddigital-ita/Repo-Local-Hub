/**
 * chat-script.ts
 * FASE 1 della chat: qualificazione lead a script fisso — NESSUN LLM.
 *
 * Come lo usa il controller (in /app/consulenza):
 *   1. All'avvio:  getGreeting(ctx, lead) → poi parte il primo step di STEP_ORDER.
 *   2. A ogni messaggio del visitatore:
 *      a. detectEdgeCase(testo) → se combacia: mostra la risposta del caso
 *         limite e RIPETI lo step corrente (preventivo_subito segna lead.hot = true).
 *      b. Altrimenti: step.validate(risposta) → salva in lead[step.saveAs]
 *         e vai allo step successivo.
 *      c. Se la validazione fallisce MAX_REASK volte → mostra reaskFallback(ctx)
 *         e offri la via umana (chiamata / WhatsApp / callback).
 *   3. A consenso dato: salva il lead su Neon (Postgres), notifica l'operatore di
 *      turno (email + Telegram) e mostra getClosing(ctx, lead) + azioni.
 *
 * Tutto il testo si modifica SOLO qui dentro: nessuna logica altrove.
 */

// ───────────────────────────── TIPI ─────────────────────────────

export interface Operator {
  id: string;
  firstName: string;
  phone: string;      // formato internazionale: +393331234567
  whatsapp?: string;  // se diverso dal telefono di voice
  shiftStart: number; // ora inizio turno (0–23)
  shiftEnd: number;   // ora fine turno (0–23, esclusa)
  active: boolean;
}

export interface ChatContext {
  agencyName: string;
  query: string;           // la ricerca del visitatore, es. "siti web Lecce"
  operators: Operator[];
  now: Date;
  privacyUrl?: string;     // default: /privacy
  privacyEmail?: string;   // default: privacy@DOMAIN.IT → da impostare
}

export interface LeadData {
  service?: string;
  urgency?: string;
  existingSite?: string;
  budget?: string;
  company?: string;
  companyName?: string;
  name?: string;
  phone?: string;
  consent?: boolean;
  hot?: boolean;   // ha chiesto subito il preventivo
  edge?: string;   // ultimo caso limite combaciato
}

export type StepId =
  | 'service'
  | 'timing'
  | 'existing_site'
  | 'budget'
  | 'company'
  | 'company_name'
  | 'name'
  | 'phone'
  | 'consent';

export interface StepDef {
  id: StepId;
  question: (ctx: ChatContext, lead: LeadData) => string;
  input: 'buttons' | 'text' | 'consent';
  buttons?: readonly { label: string; value: string }[];
  placeholder?: string;
  saveAs: keyof LeadData;
  validate?: (answer: string) => true | string; // true = ok, string = messaggio d'errore
}

// Da popolare da .env o tabella operators. WEB AGENCY SALENTO: Daniele è
// l'operatore deciso; il secondo turno resta da definire col team → finché
// non arriva il nome, tutti e due i turni puntano al numero principale.
export const DEFAULT_OPERATORS: Operator[] = [
  { id: 'A', firstName: 'Daniele', phone: '+393200865907', shiftStart: 9, shiftEnd: 14, active: true },
  { id: 'B', firstName: 'Daniele', phone: '+393200865907', shiftStart: 14, shiftEnd: 19, active: true },
];

export const MAX_REASK = 2;

// ──────────── BOTTONI DEGLI STEP — FONTE UNICA (STEP_BUTTONS) ────────────
// I value finiscono DRETTI in bolla in chat e nei campi del lead (DB, CSV,
// notifiche all'operatore): devono essere parole leggibili, mai token
// interni tipo sì/no (bug 30/09/2026: chi cliccava «Professionale» vedeva
// la propria bolla scrivere «no»). Definiti UNA volta qui: gli step sotto
// referenziano la costante e la sentinella in tests/chat-e2e.test.mjs
// fallisce se un value letterale riappare fuori da questo blocco.
export const STEP_BUTTONS = {
  service: [
    { label: '🌐 Un sito web nuovo', value: 'sito web nuovo' },
    { label: '🛒 Un e-commerce', value: 'e-commerce' },
    { label: '📈 Posizionamento Google (SEO)', value: 'seo / google' },
    { label: '🔧 Rifacimento o assistenza sito', value: 'restyling / assistenza' },
    { label: '✍️ Altro (scrivilo qui)', value: 'altro' },
  ],
  timing: [
    { label: '🔥 Il prima possibile', value: 'entro 2 settimane' },
    { label: '📅 Tra un mese o due', value: '1–2 mesi' },
    { label: '🧭 Per ora mi informo', value: 'solo informativa' },
  ],
  existing_site: [
    { label: '✅ Sì, ma lo voglio rifare', value: 'sì, da rifare' },
    { label: '🩹 Sì, ma dà problemi', value: 'sì, con problemi' },
    { label: '❌ No, parto da zero', value: 'no, da zero' },
  ],
  budget: [
    { label: '💶 Fino a 1.000 €', value: 'fino a 1.000 €' },
    { label: '💶💶 1.000 – 3.000 €', value: '1.000–3.000 €' },
    { label: '💶💶💶 Oltre 3.000 €', value: 'oltre 3.000 €' },
    { label: '🤷 Non lo so, consigliami tu', value: 'da definire' },
  ],
  company: [
    { label: '👤 Professionale / libero professionista', value: 'professionista' },
    { label: '🏢 Azienda / ditta', value: 'azienda' },
  ],
} as const;

export type ButtonValue = (typeof STEP_BUTTONS)[keyof typeof STEP_BUTTONS][number]['value'];

// ─────────────────────── I 5 STEP DELLO SCRIPT ───────────────────────

export const STEPS: Record<StepId, StepDef> = {
  service: {
    id: 'service',
    question: () => 'Partiamo dal tuo progetto: di cosa hai bisogno?',
    input: 'buttons',
    buttons: STEP_BUTTONS.service,
    saveAs: 'service',
    validate: (v) =>
      v.trim().length >= 2 || 'Due parole bastano così capisco cosa ti serve 👇',
  },

  timing: {
    id: 'timing',
    question: () => 'Entro quando ti servirebbe?',
    input: 'buttons',
    buttons: STEP_BUTTONS.timing,
    saveAs: 'urgency',
  },

  existing_site: {
    id: 'existing_site',
    question: () => 'Hai già un sito?',
    input: 'buttons',
    buttons: STEP_BUTTONS.existing_site,
    saveAs: 'existingSite',
  },

  budget: {
    id: 'budget',
    question: () => 'Quasi finito ✌️ Budget indicativo per questo progetto?',
    input: 'buttons',
    buttons: STEP_BUTTONS.budget,
    saveAs: 'budget',
  },  company: {
    id: 'company',
    question: () => 'Sei un professionista o un\'azienda?',
    input: 'buttons',
    buttons: STEP_BUTTONS.company,
    saveAs: 'company',
  },

  company_name: {
    id: 'company_name',
    question: () => 'Qual è il nome della tua ditta?',
    input: 'text',
    placeholder: 'Es. Rossi Srl, Da Vinci Studio, Mariani Fotografia',
    saveAs: 'companyName',
    validate: (v) =>
      /^[\p{L}0-9''”’ \-.,&(){}/]{2,80}$/u.test(v.trim()) ||
      'Inserisci il nome della tua ditta 👇',
  },

  name: {
    id: 'name',
    question: () => 'Perfetto ✨ Come ti chiami?',
    input: 'text',
    placeholder: 'Il tuo nome',
    saveAs: 'name',
    validate: (v) =>
      /^[\p{L}'\s-]{2,40}$/u.test(v.trim()) ||
      'Come posso chiamarti? Basta il nome 👇',
  },

  phone: {
    id: 'phone',
    question: (_ctx, lead) =>
      lead.name
        ? `Grazie ${lead.name}! Su quale numero ti richiamiamo?`
        : 'Ok! Su quale numero ti richiamiamo?',
    input: 'text',
    placeholder: '333 1234567',
    saveAs: 'phone',
    validate: validatePhone,
  },

  consent: {
    id: 'consent',
    question: (ctx) => `${PRIVACY_SHORT(ctx)}\n\nSpunta qui sotto per continuare 👇`,
    input: 'consent',
    saveAs: 'consent',
  },
};

export const STEP_ORDER: StepId[] = [
  'service',
  'timing',
  'existing_site',
  'budget',
  'company',
  'company_name',
  'name',
  'phone',
  'consent',
];

// ─────────────────── SALUTO, CHIUSURA E STATO OPERATORE ───────────────────

export function getGreeting(ctx: ChatContext): string {
  const onDuty = pickOnDutyOperator(ctx);
  const q = ctx.query.trim() ? `«${ctx.query.trim()}»` : 'quello che cerchi';

  if (onDuty) {
    return (
      `Ciao! 👋 Cerchi ${q}? Sei nel posto giusto.\n` +
      `Sono ${onDuty.firstName} di ${ctx.agencyName}: 4 domande da 10 secondi ` +
      `e ti dico subito come possiamo aiutarti.`
    );
  }
  const next = getNextShift(ctx);
  return (
    `Ciao! 👋 Cerchi ${q}? Sei nel posto giusto.\n` +
    `Sono l'assistente di ${ctx.agencyName}: rispondo a 4 domande veloci e ` +
    `${next.operator.firstName} ti ricontatta appena rientra (il prossimo turno è ${next.label}).`
  );
}

export function getClosing(ctx: ChatContext, lead: LeadData): string {
  const name = lead.name ? `, ${lead.name}` : '';
  const onDuty = pickOnDutyOperator(ctx);

  if (onDuty) {
    return (
      `Fatto${name}! ✅\n` +
      `${onDuty.firstName} è in turno adesso e ha già ricevuto la notifica: ` +
      `ti scrive qui tra pochissimo. Se hai fretta, chiamalo direttamente 👇`
    );
  }
  const next = getNextShift(ctx);
  const slot = getCallbackSlots(ctx)[0];
  return (
    `Fatto${name}! ✅\n` +
    `${next.operator.firstName} rientra ${next.label}: ti richiamiamo ${slot.toLowerCase()}. ` +
    `Intanto, se preferisci, scrivici su WhatsApp 👇`
  );
}

/** Riga di stato sempre visibile in testa alla chat. */
export function getOnDutyStatusLine(ctx: ChatContext): string {
  const onDuty = pickOnDutyOperator(ctx);
  if (onDuty) {
    return `🟢 ${onDuty.firstName} è in turno fino alle ${onDuty.shiftEnd}:00`;
  }
  const next = getNextShift(ctx);
  return `🔴 Team fuori turno — rientro ${next.label}`;
}

/** Bottoni/CTA da mostrare dopo la chiusura (il controller li trasforma in azioni). */
export function getClosingActions(ctx: ChatContext): {
  call?: { label: string; phone: string };
  whatsapp?: string;
  callbackSlots?: string[];
} {
  const onDuty = pickOnDutyOperator(ctx);
  const next = getNextShift(ctx);
  const wa = onDuty?.whatsapp ?? next.operator.whatsapp;
  return {
    call: onDuty
      ? { label: `📞 Chiama ${onDuty.firstName} ora`, phone: onDuty.phone }
      : undefined,
    whatsapp: wa ? `https://wa.me/${wa.replace(/\D/g, '')}` : undefined,
    callbackSlots: onDuty ? undefined : getCallbackSlots(ctx),
  };
}

// ───────────────────────── CASI LIMITE (EDGE CASES) ─────────────────────────

export interface EdgeCase {
  id: string;
  match: RegExp;
  reply: (ctx: ChatContext, lead: LeadData) => string;
  markHot?: boolean;
}

export const EDGE_CASES: EdgeCase[] = [
  {
    // "quanto costa un sito?" / "voglio un preventivo"
    // Le fasce citate sono il listino (pacchetti nel DB, seed 036-salento-pricing
    // — vetrina 1.000 / professionale 1.500 / e-commerce 3.000 / SEO 350/mese):
    // se il listino cambia, aggiornare QUESTA riga per coerenza con landing,
    // home e prompt di Ambrosio.
    id: 'preventivo_subito',
    match: /preventiv|quanto\s+cost|prezzo|tariffa|costo\b/i,
    reply: () =>
      'Voglio darti un numero vero, non un "dipende" 😄 ' +
      'Intanto le fasce vere: sito vetrina da 1.000 €, e-commerce da 3.000 €, SEO locale da 350 €/mese. ' +
      'Per il numero esatto rispondimi a queste domande da 10 secondi 👇',
    markHot: true,
  },
  {
    // "sono arrabbiato" / "truffa" / "perdo tempo"
    id: 'cliente_frustrato',
    match: /truffa|fregat|arrabbiat|maledett|incompetent|perd(?:o|endo)\s+tempo|reclam/i,
    reply: (ctx) => {
      const onDuty = pickOnDutyOperator(ctx);
      return onDuty
        ? `Hai ragione e mi dispiace. Niente più domande: sono ${onDuty.firstName}, una persona vera — ` +
          'scrivimi qui cosa è successo, oppure chiamami subito 👇'
        : 'Hai ragione e mi dispiace. Niente più domande: lasciami solo il tuo numero e il titolare ' +
          'ti richiama di persona appena rientra 👇';
    },
  },
  {
    // "voglio parlare con una persona"
    id: 'vuole_umano',
    match: /parla(?:re)?\s+con|umano|persona\s+vera|voce\s+vera|operatore\s+vero/i,
    reply: (ctx) => {
      const onDuty = pickOnDutyOperator(ctx);
      return onDuty
        ? `Certo! ${onDuty.firstName} è al computer adesso: scrivi pure qui, risponde una persona vera. ` +
          'Se preferisci la voce, il telefono è qui 👇'
        : 'Certo! Il team rientra a breve: lascia qui il tuo numero e ti chiama una persona vera, ' +
          'nessun robot 👇';
    },
  },
  {
    // "quanto tempo ci vuole?"
    id: 'tempi',
    match: /quanto\s+tempo|in\s+quanto\s+tempo|quanto\s+ci\s+mett/i,
    reply: () =>
      'In genere: sito vetrina online in ~7 giorni, e-commerce in 3–4 settimane. ' +
      'Confermiamo i tempi esatti sul tuo caso tra un attimo 👇',
  },
  {
    // visitatore che riscrive solo "ciao"
    id: 'smalltalk',
    match: /^(ciao|salve|buongiorno|buonasera|hey|hello|hi)[\s!.,?]*$/i,
    reply: () => 'Ciao! 👋 Dimmi pure: di cosa hai bisogno? Puoi anche scrivere con parole tue.',
  },
  {
    // fuori tema
    id: 'off_topic',
    match: /meteo|calci\b|ricetta|superenalotto|lotto\b/i,
    reply: () => 'Qua parliamo solo di siti e marketing 😄 Torniamo a noi: di cosa hai bisogno?',
  },
];

export function detectEdgeCase(text: string): EdgeCase | null {
  const t = text.trim();
  return EDGE_CASES.find((e) => e.match.test(t)) ?? null;
}

/** Dopo MAX_REASK errori di validazione: si arrende il modulo, non noi. */
export function reaskFallback(ctx: ChatContext): string {
  const onDuty = pickOnDutyOperator(ctx);
  const next = getNextShift(ctx);
  return onDuty
    ? `Ok, lasciamo perdere il modulo 😄 ${onDuty.firstName} è in turno adesso: ` +
      'chiamalo e parlate a voce 👇'
    : `Ok, lasciamo perdere il modulo 😄 ${next.operator.firstName} rientra ${next.label} ` +
      'e può richiamarti: lascia solo il tuo numero qua sotto, oppure scrivici su WhatsApp 👇';
}

/** Messaggio per risposta che non è né un bottone né testo valido. */
export const NO_MATCH_FALLBACK =
  'Non ho capito bene 😅 Puoi rispondermi con i pulsanti qui sopra oppure scrivere con parole tue.';

// ────────────────────────── PRIVACY (BREVE, GDPR) ──────────────────────────

export function PRIVACY_SHORT(ctx: ChatContext): string {
  const email = ctx.privacyEmail ?? 'privacy@DOMAIN.IT';
  const url = ctx.privacyUrl ?? '/privacy';
  return (
    '🔒 Informativa breve (art. 13 GDPR)\n' +
    `I dati che inserisci (nome, telefono e risposte) sono trattati da ${ctx.agencyName} ` +
    'esclusivamente per ricontattarti e preparare il preventivo richiesto. ' +
    'Base giuridica: il tuo consenso.\n' +
    'Non vendiamo né cediamo i tuoi dati a terzi. Li conserviamo 24 mesi, poi li cancelliamo.\n' +
    `Puoi chiedere accesso, rettifica o cancellazione quando vuoi scrivendo a ${email}. ` +
    `Informativa completa: ${url}`
  );
}

// ─────────────────────────── TURNI E VALIDAZIONI ───────────────────────────

/** Operatore di turno adesso (gestisce anche turni che attraversano mezzanotte). */
export function pickOnDutyOperator(ctx: ChatContext): Operator | null {
  const h = ctx.now.getHours();
  return (
    ctx.operators.find(
      (o) =>
        o.active &&
        (o.shiftStart <= o.shiftEnd
          ? h >= o.shiftStart && h < o.shiftEnd
          : h >= o.shiftStart || h < o.shiftEnd),
    ) ?? null
  );
}

export function getNextShift(ctx: ChatContext): { operator: Operator; label: string } {
  const ops = ctx.operators.filter((o) => o.active);
  const hour = ctx.now.getHours();

  const today = ops
    .filter((o) => o.shiftStart > hour)
    .sort((a, b) => a.shiftStart - b.shiftStart)[0];

  if (today) {
    const part =
      today.shiftStart < 12 ? 'questa mattina' : today.shiftStart < 18 ? 'questo pomeriggio' : 'stasera';
    return { operator: today, label: `${part} alle ${today.shiftStart}:00` };
  }

  const first = [...ops].sort((a, b) => a.shiftStart - b.shiftStart)[0];
  return { operator: first, label: `domani alle ${first.shiftStart}:00` };
}

/** Slot di callback proposti quando nessuno è in turno. */
export function getCallbackSlots(ctx: ChatContext): string[] {
  const { operator, label } = getNextShift(ctx);
  const day = label.startsWith('domani') ? 'Domani' : 'Oggi';
  const slots: string[] = [];
  for (let h = operator.shiftStart; h < operator.shiftEnd && slots.length < 3; h += 2) {
    slots.push(`${day} alle ${String(h).padStart(2, '0')}:00`);
  }
  return slots.length ? slots : [`${day} alle ${String(operator.shiftStart).padStart(2, '0')}:00`];
}

export function validatePhone(v: string): true | string {
  const digits = v.replace(/[^\d]/g, '');
  // Cellulare 3XX… (9–10 cifre) o fisso 0… (9–11 cifre), con o senza prefisso 39
  const ok = /^(?:39)?(?:3\d{8,9}|0\d{8,10})$/.test(digits);
  return ok
    ? true
    : 'Mmm, quel numero non mi convince 😅 Ricontrolla e riscrivilo (es. 333 1234567).';
}
