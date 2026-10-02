/**
 * Estrazione da testo libero: Ambrosio chiede nome, telefono e consenso
 * come farebbe un umano; qui riconosciamo le risposte del visitatore con
 * euristiche conservative (meglio perdere un lead che inventarne uno).
 * L'estrazione decide SOLO quando persistere: mai quando il testo non
 * combacia con certezza ragionevole.
 *
 * Multilingua (PROMPT-AMBROSIO-AI.md, FASE 3 anticipata sul solo consenso):
 * le risposte di consenso sono riconosciute in it/en/de/fr/es —
 * "sì/yes/ja/oui/sí" — con normalizzazione degli accenti perché le \b di
 * JavaScript non considerano le lettere accentate come confini di parola
 * (prima di questa correzione persino «Sì» accentato restituiva null).
 */

/** Normalizza per il matching delle parole chiave: minuscole e accenti
 *  rimossi ("Sì"→"si", "sí"→"si", "tschüss"→"tschuss"). */
function keywords(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function extractPhone(text: string): string | null {
  const t = text.trim();
  // Numeri italiani: almeno 8 cifre totali, con separatori comuni
  const candidate = t.match(/(?:\+39[\s-]?)?(?:3\d{2}|0\d{1,4})[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/);
  if (candidate) {
    const digits = candidate[0].replace(/\D/g, "");
    // +39 seguito da 9-10 cifre, oppure numero nazionale di 8-11 cifre
    const ok = candidate[0].startsWith("+39") ? digits.length >= 11 && digits.length <= 13 : digits.length >= 8 && digits.length <= 11;
    if (ok) return candidate[0].trim();
  }
  // Internazionali: +CC (1-3 cifre) seguito da 6-12 cifre con separatori
  // comuni — copre "+44 7911 123456" e il francese "+33 6 12 34 56 78".
  const intl = t.match(/\+\d{1,3}(?:[\s.-]?\d{1,4}){3,8}/);
  if (intl) {
    const digits = intl[0].replace(/\D/g, "");
    const cc = intl[0].match(/^\+\d{1,3}/)![0].length - 1;
    const rest = digits.length - cc;
    if (cc >= 1 && cc <= 3 && rest >= 6 && rest <= 12) return intl[0].trim();
  }
  return null;
}

const NAME_PREFIX =
  /(?:mi chiamo|my name is|ich hei(?:ss|ß)e|je m'appelle|me llamo|il mio nome è)\s+/i;

export function extractName(text: string): string | null {
  // Frase intera: cerca il nome dopo i verbi tipici ("mi chiamo X", "my name is X", "je m'appelle X"…)
  const m =
    text.match(new RegExp(NAME_PREFIX.source + "([A-Za-zÀ-ÿ]+(?:\\s[A-Za-zÀ-ÿ]+){0,2})", "i")) ??
    text.match(/(?:^|\bsono\s)\b([A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+){0,2})\b/);
  if (!m) {
    // Testo breve = probabilmente solo il nome (risposta allo step nome)
    const t = text.trim().replace(new RegExp("^" + NAME_PREFIX.source, "i"), "");
    if (/^[A-Za-zÀ-ÿ]+(?:['\s-][A-Za-zÀ-ÿ]+){0,2}$/.test(t) && t.split(/\s+/).length <= 3) return t;
    return null;
  }
  // «Sono Gianni Bianchi» → il confine ^ cattura anche «Sono»: lo togliamo.
  return m[1].replace(/^(sono|mi\s+chiamo)\s+/i, "").trim();
}

// Consenso/rifiuto esplicito nelle 5 lingue gestite (it/en/de/fr/es).
// Testato sul testo normalizzato (minuscole, niente accenti).
const YES =
  /^(si|ok|okay|certo|certamente|sicuro|assolutamente|volevo|voglio|daccordo|d'accordo|approvo|consento|acconsento|yes|yeah|yep|sure|of\s+course|certainly|ja|gern|gerne|einverstanden|oui|d'accord|vale|de\s+acuerdo|claro|por\s+supuesto)\b/;
const NO = /^(no|nop|nope|nein|non\s+sono\s+d'accordo|niente|rifiuto|no\s+thanks|not\s+really|not\s+now)\b/;

/** true = consenso, false = rifiuto esplicito, null = non sapere. */
export function extractConsent(text: string): boolean | null {
  const n = keywords(text);
  if (NO.test(n)) return false;
  if (YES.test(n)) return true;
  // Consenso dentro frasi lunghe: "sì acconsento", "yes you can",
  // "do il consenso", "i agree", "ich willige ein", "j'accepte"…
  if (/\b(si|yes|ja|oui)\b[,;\s]*(acconsento|consento|ok|certo|einverstanden|de\s+acuerdo)/.test(n)) return true;
  if (/\b(acconsento|consento|do il consenso|accetto|i\s+agree|i\s+consent|you\s+can\s+call\s+me|ich\s+willige\s+ein|j'accepte|je\s+consens|d'accord|einverstanden)\b/.test(n)) return true;
  // Consenso «sparso» a metà frase (osservato sul vivo: «Marco Rossi, 333…,
  // sono d'accordo, richiamatemi»): la frase NON inizia con l'affermazione.
  // Guardia: «non chiamatemi» / «non richiamatemi» NON è consenso.
  if (
    /\b(va\s+bene|ci\s+sta|sono\s+d'?accordo|d'accordo|daccordo|richiamatemi|richiamarmi|richiamami|richiamate|chiamatemi|chiamarmi|chiamami|chiamate|fissatemi|fissarmi|fissami)\b/.test(n) &&
    !/\bnon\b[^.!?]*\b(chiamatemi|richiamatemi|richiamami|richiamarmi|chiamami|chiamarmi|fissatemi|fissarmi|fissami)\b/.test(n)
  ) {
    return true;
  }
  return null;
}

/** True se il messaggio sembra un rifiuto di continuare (stop conversation). */
export function looksLikeGoodbye(text: string): boolean {
  return /^(no\s+grazie|niente\s+grazie|basta|addio|arrivederci|ciao\s+grazie|bye|goodbye|tschuss|auf\s+wiedersehen|adios|hasta\s+luego)\b/.test(
    keywords(text),
  );
}
