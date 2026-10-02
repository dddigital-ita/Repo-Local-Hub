/**
 * Dataset locale per il picker emoji frimousse: costruito dal set scelto
 * nell'admin (o dal default di Chat.tsx), senza fetch a CDN esterni.
 *
 * Il resolver di default di frimousse scaricherebbe Emojibase da
 * cdn.jsdelivr.net a runtime: su una pagina pubblica con consenso GDPR
 * prima del caricamento non è accettabile, e il picker deve funzionare
 * anche con il DB degradato. Qui niente rete: un unico dataset con una
 * categoria «Scelte per te», un'emoji per voce del set admin, nell'ordine
 * scelto dall'admin (la ricerca frimousse filtra per label e tag).
 */

import type { EmojiData } from "frimousse";

/** Voce del dataset: emoji + etichetta italiana + tag di ricerca IT. */
type ChatEmojiSpec = {
  /** L'emoji stessa, come salvata dall'admin. */
  emoji: string;
  /** Etichetta accessibile (aria-label, anteprima footer). */
  label: string;
  /** Parole chiave IT per la ricerca del picker. */
  tags: string[];
};

/** Specifiche del set predefinito (stesso ordine di DEFAULT_EMOJIS in Chat.tsx). */
const CHAT_EMOJI_SPECS: Record<string, ChatEmojiSpec> = {
  "😀": { emoji: "😀", label: "faccina sorridente", tags: ["sorriso", "felice", "viso"] },
  "😄": { emoji: "😄", label: "faccina con occhi sorridenti", tags: ["risata", "gioia", "occhi"] },
  "😉": { emoji: "😉", label: "faccina che ammicca", tags: ["occhiolino", "ammiccare"] },
  "😍": { emoji: "😍", label: "faccina con occhi a cuore", tags: ["amore", "innamorato"] },
  "🤩": { emoji: "🤩", label: "faccina a stella", tags: ["wow", "stelle", "entusiasmo"] },
  "😎": { emoji: "😎", label: "faccina con occhiali", tags: ["cool", "occhiali", "sciolto"] },
  "🤝": { emoji: "🤝", label: "stretta di mano", tags: ["accordo", "mano", "patto"] },
  "👍": { emoji: "👍", label: "pollice in su", tags: ["ok", "bene", "mano"] },
  "👏": { emoji: "👏", label: "applauso", tags: ["bravo", "mani", "battito"] },
  "🙏": { emoji: "🙏", label: "mani giunte", tags: ["grazie", "prego", "pregare"] },
  "🔥": { emoji: "🔥", label: "fiamma", tags: ["fuoco", "caldo", "top"] },
  "✨": { emoji: "✨", label: "scintille", tags: ["brillante", "stelle", "magia"] },
  "💡": { emoji: "💡", label: "lampadina", tags: ["idea", "luce", "ispirazione"] },
  "🚀": { emoji: "🚀", label: "razzo", tags: ["lancio", "spazio", "velocità"] },
  "🎯": { emoji: "🎯", label: "bersaglio con freccia", tags: ["obiettivo", "mirino", "meta"] },
  "💶": { emoji: "💶", label: "banconota in euro", tags: ["euro", "soldi", "prezzo"] },
  "📞": { emoji: "📞", label: "ricevitore", tags: ["telefono", "chiamata", "contatto"] },
  "💬": { emoji: "💬", label: "fumetto di dialogo", tags: ["messaggio", "chat", "parola"] },
  "✅": { emoji: "✅", label: "casella di spunta", tags: ["fatto", "ok", "verifica"] },
  "❤️": { emoji: "❤️", label: "cuore rosso", tags: ["amore", "cuoricino", "affetto"] },
};

/**
 * CATALOGO — la palette da cui l'admin sceglie, in /admin/settings/emoji-chat.
 * Stessa fonte del picker: le etichette e i tag di ricerca che guidano la
 * ricerca nel catalogo admin sono quelli che poi filtrano nella chat pubblica.
 * Una cura, due posti. Oltre il catalogo l'admin resta libero di digitare
 * qualunque emoji: il picker la degrada con specifica generica, non si rompe.
 */
export const CHAT_EMOJI_CATALOG: ChatEmojiSpec[] = Object.values(CHAT_EMOJI_SPECS);

/** Fallback generico per emoji aggiunte dall'admin senza voce dedicata. */
function specFor(emoji: string): ChatEmojiSpec {
  return (
    CHAT_EMOJI_SPECS[emoji] ?? {
      emoji,
      label: `emoji ${emoji}`,
      tags: ["emoji"],
    }
  );
}

/**
 * Dataset EmojiData di frimousse per il set corrente del picker.
 * Un'emoji per voce del set admin, stessa categoria, ordine preservato.
 */
export function chatEmojiData(emojis: readonly string[]): EmojiData {
  const list = emojis.length
    ? emojis
    : // Mai vuoto: frimousse con zero emoji mostrebbe solo «Nessun risultato».
      Object.keys(CHAT_EMOJI_SPECS);
  return {
    locale: "it",
    emojis: list.map((emoji) => {
      const spec = specFor(emoji);
      return {
        emoji: spec.emoji,
        // Una sola categoria (indice 0) per tutto il set dell'admin.
        category: 0,
        label: spec.label,
        // Versione 1.0: visibile a tutti i browser supportati.
        version: 1,
        tags: spec.tags,
      };
    }),
    categories: [{ index: 0, label: "Scelte per te" }],
    skinTones: {
      // Il set admin non ha varianti skin tone: non censite, non selezionabili.
      dark: "",
      light: "",
      medium: "",
      "medium-dark": "",
      "medium-light": "",
    },
  };
}
