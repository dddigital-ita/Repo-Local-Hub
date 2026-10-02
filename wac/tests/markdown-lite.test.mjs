/**
 * MARKDOWN-LITE — il parser che renderizza i documenti operativi del repo
 * (CHECKLIST-CAPTCHA-PRODUZIONE e compagnia) nelle schede admin.
 *
 * Il test importa DIRETTAMENTE `src/lib/markdown-lite.ts` (type stripping
 * di Node ≥22.6): nessuna costante duplicata. Copre i blocchi del documento
 * reale: heading, paragrafi sfusi, liste annidate, code block, citazioni,
 * tabelle pipe, hr e link interni/esterni con inline code.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/markdown-lite.ts");
const { parseMarkdownDoc, parseInlineTokens } = m;

test("markdown-lite: heading, title (primo H1 non duplicato) e paragrafo sfuso", () => {
  const doc = parseMarkdownDoc("# Titolo\n\n## Sezione\n\nriga uno\nriga due\n\nAltro.");
  assert.equal(doc.title, "Titolo");
  assert.deepEqual(
    doc.nodes.map((n) => n.type),
    ["heading", "paragraph", "paragraph"],
  );
  assert.deepEqual(doc.nodes[0], { type: "heading", level: 2, text: "Sezione" });
  assert.deepEqual(doc.nodes[1], { type: "paragraph", text: "riga uno riga due" });
});

test("markdown-lite: liste, annidamento a un livello e righe di continuazione", () => {
  const doc = parseMarkdownDoc("- primo\n- secondo con\n  continuazione\n  - figlio\n7. settimo");
  const list = doc.nodes.find((n) => n.type === "list");
  assert.ok(list && list.type === "list");
  assert.equal(list.ordered, false);
  assert.deepEqual(list.items, [
    { text: "primo", depth: 0 },
    { text: "secondo con continuazione", depth: 0 },
    { text: "figlio", depth: 1 },
  ]);
  const ordered = doc.nodes.filter((n) => n.type === "list")[1];
  assert.ok(ordered && ordered.type === "list" && ordered.ordered);
  assert.equal(ordered.items[0].text, "settimo");
});

test("markdown-lite: code block letterale, citazioni unite e hr", () => {
  const doc = parseMarkdownDoc("```bash\nnpm test\nnpm run lint\n```\n\n> nota uno\n> nota due\n\n---");
  const fence = doc.nodes.find((n) => n.type === "fence");
  assert.ok(fence && fence.type === "fence");
  assert.equal(fence.lang, "bash");
  assert.deepEqual(fence.lines, ["npm test", "npm run lint"]);
  const quote = doc.nodes.find((n) => n.type === "quote");
  assert.ok(quote && quote.type === "quote");
  assert.equal(quote.text, "nota uno nota due");
  assert.ok(doc.nodes.some((n) => n.type === "hr"));
});

test("markdown-lite: tabella pipe con celle ripulite", () => {
  const doc = parseMarkdownDoc("| # | Cosa | Esito |\n|---|------|-------|\n| 1 | Login | OK |");
  const table = doc.nodes.find((n) => n.type === "table");
  assert.ok(table && table.type === "table");
  assert.deepEqual(table.headers, ["#", "Cosa", "Esito"]);
  assert.deepEqual(table.rows, [["1", "Login", "OK"]]);
});

test("markdown-lite: inline — code protetto, link interni/esterni, entità decodificate", () => {
  const code = parseInlineTokens("usa `npm test` oggi");
  assert.deepEqual(code, [
    { kind: "text", text: "usa " },
    { kind: "code", text: "npm test" },
    { kind: "text", text: " oggi" },
  ]);

  const links = parseInlineTokens("[Shield](/admin/shield) e [Cloudflare](https://dash.cloudflare.com/?to=/:account/turnstile)");
  assert.equal(links.length, 3);
  assert.deepEqual(links[0], { kind: "link", text: "Shield", href: "/admin/shield", external: false });
  assert.deepEqual(links[1], { kind: "text", text: " e " });
  assert.deepEqual(links[2], { kind: "link", text: "Cloudflare", href: "https://dash.cloudflare.com/?to=/:account/turnstile", external: true });

  // Nessun link dentro un code span; il grassetto può contenere link.
  const guarded = parseInlineTokens("`[x](/y)`");
  assert.deepEqual(guarded, [{ kind: "code", text: "[x](/y)" }]);

  const bold = parseInlineTokens("premendo **Salva chiavi captcha** ([guida](/admin/settings/cloudflare/checklist))");
  assert.deepEqual(bold[1], { kind: "strong", text: "Salva chiavi captcha" });
  assert.deepEqual(bold[3], { kind: "link", text: "guida", href: "/admin/settings/cloudflare/checklist", external: false });
});

test("markdown-lite: nessuna perdita — blocco sconosciuto resta paragrafo", () => {
  const doc = parseMarkdownDoc("~~~ strano ~~~\n\ntesto normale");
  assert.equal(doc.nodes[0].type, "paragraph");
  assert.ok((doc.nodes[0].text ?? "").includes("strano"));
});
