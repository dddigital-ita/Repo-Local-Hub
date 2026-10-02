/**
 * MARKDOWN-LITE — un parser markdown puro, pensato per i documenti operativi
 * del repo (CHECKLIST-*, GUIDE-*, ecc.) che le schede admin devono mostrare
 * senza dipendenze nuove e senza tenere copie in sincrono: la pagina legge
 * il file dal disco e renderizza quello che c'è scritto oggi.
 *
 * Cosa copre (e basta): heading #/##/###, paragrafi, liste (ul e ol,
 * comprese annidate a un livello), code block ``` e inline code, grassetto
 * **x**, citazioni `>` (con annidamento a un livello), tabelle pipe,
 * separatori orizzontali e link [testo](href) con flag external. Tutto il
 * resto finisce in un paragrafo: mai perso, mai crash.
 *
 * Puro e sync: testabile con node --test (type stripping di Node ≥22.6),
 * usato da pagine e route server-side.
 */

const headingRegex = /^(#{1,3})\s+(.*)$/;
const listRegex = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const tableRowRegex = /^\s*\|(.*)\|\s*$/;
const tableSeparatorRegex = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const fenceRegex = /^```(\S*)\s*$/;
const quoteRegex = /^>\s?(.*)$/;
const hrRegex = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const externalHrefRegex = /^https?:\/\//i;

export interface MarkdownLink {
  text: string;
  href: string;
  external: boolean;
}

export interface MarkdownListItem {
  text: string;
  depth: 0 | 1;
}

export type MarkdownNode =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { type: "fence"; lang: string; lines: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" };

export interface MarkdownDoc {
  /** Il testo del primo heading di livello 1, se esiste. */
  title: string | null;
  nodes: MarkdownNode[];
}

/** Token inline: testo semplice, codice, grassetto o link (in ordine di apparizione). */
export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "link"; text: string; href: string; external: boolean };

const linkRegex = /\[([^\]]+)\]\(([^()\s]+)\)/;
const boldRegex = /\*\*([^*]+)\*\*/g;

/** Link e testo semplice di un segmento già privo di code e bold. */
function parsePlainSegment(part: string, tokens: MarkdownInline[]): void {
  let rest = part;
  for (;;) {
    const m = linkRegex.exec(rest);
    if (!m || m.index === undefined) break;
    if (m.index > 0) tokens.push({ kind: "text", text: rest.slice(0, m.index) });
    const href = m[2].replace(/&amp;/g, "&");
    tokens.push({ kind: "link", text: m[1], href, external: externalHrefRegex.test(href) });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) tokens.push({ kind: "text", text: rest });
}

/** Scompatta il markup inline (codice `x`, grassetto **x** e link [t](href)) in token. */
export function parseInlineTokens(text: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  // Prima i code span: dentro non si parsa nulla (nemmeno i link e il bold).
  const codeParts = text.split(/(`[^`]+`)/g);
  for (const part of codeParts) {
    if (!part) continue;
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      tokens.push({ kind: "code", text: part.slice(1, -1) });
      continue;
    }
    // Poi il grassetto: il contenuto può a sua volta contenere link.
    boldRegex.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = boldRegex.exec(part))) {
      if (m.index > last) parsePlainSegment(part.slice(last, m.index), tokens);
      tokens.push({ kind: "strong", text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < part.length) parsePlainSegment(part.slice(last), tokens);
  }
  return tokens;
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/**
 * Parse del documento in blocchi tipizzati. `title` è il primo H1
 * (utile per l'header della pagina); il relativo nodo NON viene duplicato
 * nei `nodes`.
 */
export function parseMarkdownDoc(md: string): MarkdownDoc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const nodes: MarkdownNode[] = [];
  let title: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block: tutto fino alla chiusura è contenuto letterale.
    const fence = fenceRegex.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !fenceRegex.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      nodes.push({ type: "fence", lang, lines: body });
      continue;
    }

    // Tabella: riga pipe + riga separatore → consuma finché ci sono righe pipe.
    if (tableRowRegex.test(line) && i + 1 < lines.length && tableSeparatorRegex.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && tableRowRegex.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--;
      nodes.push({ type: "table", headers, rows });
      continue;
    }

    const heading = headingRegex.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      if (level === 1 && title === null) {
        title = heading[2].trim();
        continue;
      }
      nodes.push({ type: "heading", level, text: heading[2].trim() });
      continue;
    }

    if (hrRegex.test(line)) {
      nodes.push({ type: "hr" });
      continue;
    }

    const quote = quoteRegex.exec(line);
    if (quote) {
      // Le citazioni nel doc operativo sono blocchi brevi: le appiattisco
      // a un livello (una `>` annidata resta testo, mai perso).
      let text = quote[1];
      while (i + 1 < lines.length) {
        const next = quoteRegex.exec(lines[i + 1]);
        if (!next) break;
        i++;
        text += ` ${next[1]}`;
      }
      nodes.push({ type: "quote", text: text.trim() });
      continue;
    }

    const list = listRegex.exec(line);
    if (list) {
      const ordered = /\d+\./.test(list[2]);
      const items: MarkdownListItem[] = [];
      let current: MarkdownListItem | null = null;
      for (; i < lines.length; i++) {
        const raw = lines[i];
        const m = listRegex.exec(raw);
        if (m) {
          const depth: 0 | 1 = m[1].length >= 2 ? 1 : 0;
          // Cambio di tipo (bullet ↔ ordinata) ALLO STESSO LIVELLO: chiude
          // la lista (CommonMark). Un sotto-punto annidato di tipo diverso
          // è un figlio dell'item: la lista prosegue (la numerazione non
          // riparte — nel documento reale le liste ordinate hanno bullet).
          if (depth === 0 && /\d+\./.test(m[2]) !== ordered) break;
          current = { text: m[3], depth };
          items.push(current);
          continue;
        }
        // Riga di continuazione: appartiene all'ultimo item se indentata.
        if (current && /^\s+\S/.test(raw) && raw.trim()) {
          current.text += ` ${raw.trim()}`;
          continue;
        }
        break;
      }
      i--;
      nodes.push({ type: "list", ordered, items });
      continue;
    }

    if (!line.trim()) continue;

    // Paragrafo: le righe fino alla riga vuota si ricongiungono.
    let text = line.trim();
    while (i + 1 < lines.length && lines[i + 1].trim() && !headingRegex.test(lines[i + 1]) && !fenceRegex.test(lines[i + 1]) && !tableRowRegex.test(lines[i + 1]) && !quoteRegex.test(lines[i + 1]) && !listRegex.test(lines[i + 1]) && !hrRegex.test(lines[i + 1])) {
      i++;
      text += ` ${lines[i].trim()}`;
    }
    nodes.push({ type: "paragraph", text });
  }

  return { title, nodes };
}
