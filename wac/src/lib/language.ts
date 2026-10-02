/**
 * Rilevamento lingua del cliente (Ambrosio Fase 3).
 *
 * Euristica conservativa: solo le 5 lingue gestite (it/en/de/fr/es),
 * con punteggio su stopwords e parole tipiche. Il default è SEMPRE
 * italiano: meglio rispondere in italiano a un testo ambiguo che
 * sbagliare lingua. La lingua rilevata si salva sulla conversazione
 * e resta per tutto il thread (non si riconverte a metà strada).
 *
 * Nome/telefono/consenso sono già multilingua dal fix lead-extract
 * (yes/ja/oui/sí + telefoni E.164): la Fase 3 completa il quadro.
 */

export type Lang = "it" | "en" | "de" | "fr" | "es";
export const SUPPORTED_LANGUAGES: Lang[] = ["it", "en", "de", "fr", "es"];
export const LANGUAGE_LABEL: Record<Lang, string> = {
  it: "Italiano",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
};

/** Stopword/punteggi per lingua: parole funzionali, non tematiche —
 *  presenti in quasi ogni frase naturale di quella lingua. */
const MARKERS: Record<Lang, string[]> = {
  it: ["ciao", "sono", "come", "per", "con", "non", "che", "una", "del", "gli", "anche", "più", "molto", "grazie", "quanto", "cosa", "vorrei", "serve", "sito", "quindi", "dove", "questo", "bene", "okay"],
  en: ["the", "and", "you", "for", "with", "are", "this", "that", "have", "need", "want", "how", "much", "what", "your", "can", "please", "thanks", "hello", "about", "would", "could", "there", "site", "website"],
  de: ["ich", "nicht", "und", "mit", "ein", "eine", "für", "ist", "auf", "wie", "was", "kann", "brauche", "möchte", "danke", "hallo", "sehr", "gerne", "bei", "wir", "sie", "webseite", "kosten"],
  fr: ["je", "le", "les", "des", "une", "pour", "avec", "est", "sur", "comment", "quoi", "combien", "veux", "besoin", "merci", "bonjour", "site", "pouvez", "nous", "vous", "dans", "plus"],
  es: ["el", "los", "las", "una", "para", "con", "está", "cómo", "cuánto", "quiero", "necesito", "gracias", "hola", "sitio", "página", "pueden", "muy", "pero", "más", "por", "qué", "cuándo"],
};

const WORD_RE = /[a-zà-öø-ÿ]+/gi;

/**
 * Lingua più probabile del testo, con soglia minima di affidabilità.
 * Ritorna "it" se nessuna lingua supera la soglia (default conservativo).
 */
export function detectLanguage(text: string): Lang {
  const words = String(text).toLowerCase().match(WORD_RE) ?? [];
  if (words.length < 2) return "it";
  const score: Record<Lang, number> = { it: 0, en: 0, de: 0, fr: 0, es: 0 };
  for (const w of words) {
    for (const lang of SUPPORTED_LANGUAGES) {
      if (MARKERS[lang].includes(w)) score[lang]++;
    }
  }
  const ranked = SUPPORTED_LANGUAGES.map((l) => [l, score[l]] as const).sort((a, b) => b[1] - a[1]);
  const [best, top] = ranked[0];
  const [, second] = ranked[1];
  // Serve un margine netto sul secondo e almeno 2 marker: sotto, italiano.
  if (top >= 2 && top - second >= 2) return best;
  return "it";
}
