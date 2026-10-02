/**
 * HELPER DI LETTURA PER LE SENTINELLE — nessuna asserzione può più cadere
 * su un commento.
 *
 * I test sentinella del repo leggono i sorgenti reali e affermano che il
 * CODICE contiene le invarianti. Ma `includes()` non distingue un commento
 * dal codice: quando la gestione del widget Turnstile è cambiata (2026-09,
 * commit be1fc4d), la sentinella `size: "invisible"` è continuata a passare
 * perché la stringa era rimasta solo nel commento nuovo («NIENTE size:
 * "invisible": l'API la rifiuta»). Questi helper tolgono il problema alla
 * radice: si legge il sorgente SENZA commenti e le asserzioni cadono per
 * costruzione sul codice.
 *
 * Lo strip è consapevole di stringhe e template literal: un `//` dentro
 * "https://dash.cloudflare.com" non tronca la riga, un `/*` dentro una
 * stringa non apre un blocco. Le stringhe NON vengono toccate: solo i
 * commenti spariscono. Esecuzione: `npm test` (node --test).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * Rimuove i commenti da un sorgente JS/TS/JSX/MDX-like, preservando le
 * stringhe ('…', "…", `…` — con escape \\ e sostituzione ${…} nei template).
 * Non è un parser completo: è abbastanza per i sorgenti del repo e
 * fallisce in difetto di conservazione (nessuna riga di codice viene
 * mai scartata per sbaglio; nel dubbio resta qualcosa in più).
 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";

    // Commento di riga: scarta fino al newline (il newline resta).
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i++;
      continue;
    }

    // Commento a blocchi: scarta fino a */.
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      out += " ";
      continue;
    }

    // Stringa con apici: copia TUTTA (escape compresi), commenti dentro no.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        out += source[i];
        if (source[i] === "\\") {
          if (i + 1 < n) out += source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === quote || source[i] === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Template literal: copia tutto, gestendo ${ … } annidato (dove i
    // commenti SONO codice e vanno rimossi: ricorsione sul blocco).
    if (ch === "`") {
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          out += source[i] + (i + 1 < n ? source[i + 1] : "");
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          out += "`";
          i++;
          break;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          // Trova la graffa chiusa bilanciata e stripa l'interno.
          let depth = 1;
          let j = i + 2;
          while (j < n && depth > 0) {
            if (source[j] === "{") depth++;
            else if (source[j] === "}") depth--;
            if (depth === 0) break;
            j++;
          }
          out += "${" + stripComments(source.slice(i + 2, j)) + "}";
          i = Math.min(j + 1, n);
          continue;
        }
        out += source[i];
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * Afferma che `needle` compare nel CODICE (i commenti sono stripati internamente:
 * si può passare il sorgente grezzo, l'helper non sbaglia mai a favore del test).
 */
export function assertInCode(source, needle, message) {
  if (!stripComments(source).includes(needle)) {
    const err = new Error(message ?? `atteso nel codice: ${needle}`);
    err.code = "ERR_ASSERTION";
    err.operator = "includes";
    err.expected = needle;
    err.actual = false;
    throw err;
  }
}

/** Afferma che `needle` NON compare nel codice (presente solo in commenti = ok). */
export function assertNotInCode(source, needle, message) {
  if (stripComments(source).includes(needle)) {
    const err = new Error(message ?? `atteso ASSSENTE dal codice: ${needle}`);
    err.code = "ERR_ASSERTION";
    err.operator = "includes";
    err.expected = `assente: ${needle}`;
    err.actual = "presente";
    throw err;
  }
}

/**
 * Legge un file del repo (percorso relativo alla radice) e ritorna
 * { raw, code } — `code` è il sorgente senza commenti. 
 */
export function readSource(relPath) {
  const raw = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  return { raw, code: stripComments(raw) };
}

/**
 * Estrae dal codice (senza commenti) il blocco tra `startNeedle` e
 * `endNeedle` (estremi inclusi): utile per asserzioni su un solo punto
 * (es. le opzioni passate a turnstile.render).
 */
export function codeBlock(code, startNeedle, endNeedle) {
  const start = code.indexOf(startNeedle);
  const end = endNeedle ? code.indexOf(endNeedle, start + startNeedle.length) : -1;
  if (start === -1) throw new Error(`blocco non trovato (inizio): ${startNeedle}`);
  if (endNeedle && end === -1) throw new Error(`blocco non trovato (fine): ${endNeedle}`);
  return endNeedle ? code.slice(start, end + endNeedle.length) : code.slice(start);
}
