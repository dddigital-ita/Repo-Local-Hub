/**
 * Preset e costanti condivise dello strumento email (client + server).
 * Il pannello client importa SOLO questo file: niente pg, nodemailer o
 * imapflow nel bundle browser (pattern notion-config-shared/theme-shared).
 */

export const EMAIL_TOOLS_KEY = "email_tools";

export const EMAIL_PRESETS: Record<
  string,
  { label: string; smtpHost: string; smtpPort: number; imapHost: string; imapPort: number }
> = {
  custom: { label: "Personalizzato", smtpHost: "", smtpPort: 587, imapHost: "", imapPort: 993 },
  gmail: {
    label: "Gmail / Google Workspace",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    imapHost: "imap.gmail.com",
    imapPort: 993,
  },
  aruba: {
    label: "Aruba",
    smtpHost: "smtp.aruba.it",
    smtpPort: 587,
    imapHost: "imap.aruba.it",
    imapPort: 993,
  },
  register: {
    label: "Register.it",
    smtpHost: "smtp.register.it",
    smtpPort: 587,
    imapHost: "imap.register.it",
    imapPort: 993,
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    imapHost: "outlook.office365.com",
    imapPort: 993,
  },
  zoho: {
    label: "Zoho Mail",
    smtpHost: "smtp.zoho.eu",
    smtpPort: 587,
    imapHost: "imap.zoho.eu",
    imapPort: 993,
  },
};

/** Interfaccia condivisa: la config in variante server-side vive in email-tools.ts. */
export interface EmailToolsConfigBase {
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  user: string;
  hasPassword: boolean;
  passwordHint: string | null;
}

/* ── Appuntamenti via email → callback → calendario ─────────────── */

/**
 * Slot riconoscibile in una conferma scritta dal cliente: giorno
 * (parola o data 15/10) + orario («domani alle 10», «oggi alle 9:00»,
 * «lunedì alle 15», «15/10 alle 15:30»). Solo il riconoscimento: la
 * decisione (conferma o negazione) sta in detectEmailAppointment.
 */
export const EMAIL_SLOT_RE =
  /(oggi|domani|dopodomani|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(?:alle?|ore|@)\s*(\d{1,2})(?::(\d{2}))?/i;

/** Annullamenti espliciti: anche con uno slot presente, NON è una conferma. */
export const EMAIL_NEGATION_RE = /\b(non\s+(?:riusc\w+|poss\w+|vogl\w+|riesco)|cancell\w+|annull\w+|rimando)\b/i;

/** La callback nata da email nasce generica: la schedula il team, a 2 ore. */
export const EMAIL_APPT_HOURS = 2;

export interface EmailSlotDecision {
  /** true = slot riconosciuto E nessuna negazione: è una conferma. */
  confirmed: boolean;
  /** true = slot presente ma annullamento esplicito: non creare nulla. */
  negated: boolean;
  /** Etichetta leggibile per humans (colonna slot_label). */
  slotLabel: string | null;
}

/**
 * Rileva una conferma di appuntamento nel testo di una email del cliente.
 * Puro (zero import): testato con import diretto come tutto il repo.
 */
export function detectEmailAppointment(body: string): EmailSlotDecision {
  const text = body.replace(/\s+/g, " ").trim();
  const m = text.match(EMAIL_SLOT_RE);
  if (!m) return { confirmed: false, negated: false, slotLabel: null };
  const negated = EMAIL_NEGATION_RE.test(text);
  return {
    confirmed: !negated,
    negated,
    slotLabel: `${m[1].toLowerCase()} alle ${m[2]}:${m[3] ?? "00"}`,
  };
}
