#!/usr/bin/env node
/**
 * ICON INLINE GUARD — sentinella del bug «icona su riga propria».
 *
 * Tailwind Preflight rende OGNI `svg` `display: block`: un'icona lucide
 * dentro un elemento non-flex diventa un blocco a larghezza piena su una
 * riga propria e `text-center` non la sposta (il testo scende sotto). È
 * successo alle CTA finali della chat («Ti chiamo adesso», «Scrivici su
 * WhatsApp», 2026-09): due `<a>` a `text-center` senza inline-flex.
 *
 * Come lavora (analisi statica con il compilatore TypeScript già in repo,
 * stesso approccio di scripts/overlay-guard.mjs):
 *   1. individua gli elementi che renderizzano ICONE: import da
 *      «lucide-react», `<UiIcon>` del registry admin, `<svg>` inline,
 *      componenti interni il cui corpo ritorna un `<svg>`;
 *   2. risale l'albero: se QUALUNQUE antenato garantisce un layout che
 *      tiene i figli sulla stessa riga (`flex|inline-flex|grid|table…`
 *      nelle utility Tailwind, nelle costanti stringa del modulo tipo
 *      `glassButtonBase`, o nelle classi CSS di casa con display:flex),
 *      il caso è legale;
 *   3. altrimenti cerca l'ospite più interno che ha testo BESIDES l'icona
 *      (stringhe JSX o espressioni) e lo segnala.
 *
 * Override legale per i casi puntuati: la classe `inline` (o
 * `inline-block`) sull'svg stesso — sostituisce il `display: block` di
 * Preflight ed è il pattern del repo per le icone dentro il testo.
 *
 * Limiti dichiarati (accettati per un guard di build): className con
 * parti dinamiche valutano SOLO i segmenti letterali (un template senza
 * nessun token flex garantito è segnalato: falso positivo preferibile al
 * bug reale); componenti esterni senza def nel grafo si attraversano ma
 * le loro def non si analizzano; `<Icon>` dinamici risolti solo se la
 * variabile locale è un def che ritorna `<svg>`.
 *
 * Uso CLI: node scripts/icon-inline-guard.mjs [--quiet]
 * Libreria: runIconGuard() per i test (tests/icon-inline-guard.test.mjs).
 * Esce 0 se nessuna violazione, 1 altrimenti.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

/* ── configurazione ── */

const SRC_DIR = path.join(process.cwd(), "src");
const MAX_DEPTH = 40;

/** Token di layout che tengono icona e testo sulla stessa riga. */
const LAYOUT_TOKENS = new Set([
  "flex", "inline-flex", "grid", "inline-grid",
  "table", "inline-table", "table-row", "table-cell",
]);

/** Override puntuale di Preflight sull'svg stesso. */
const SVG_INLINE_TOKENS = new Set(["inline", "inline-block"]);

/** Componente-icona del registry admin (la def interna non è risolvibile:
 *  il wrapper riceve l'icona come parametro di chiusura). */
const KNOWN_ICON_COMPONENTS = new Set(["UiIcon"]);

/* ── utilità AST ── */

function unwrap(node) {
  let cur = node;
  while (
    ts.isParenthesizedExpression(cur) ||
    ts.isAsExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isSatisfiesExpression(cur)
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** Ritorni JSX di un corpo funzione (incluse le arrow inline, es. .map). */
function collectReturns(body) {
  const nodes = [];
  const walk = (node) => {
    if (ts.isReturnStatement(node) && node.expression) nodes.push(unwrap(node.expression));
    else if (!ts.isFunctionDeclaration(node)) node.forEachChild(walk);
  };
  if (body && ts.isBlock(body)) body.forEachChild(walk);
  else if (body) nodes.push(unwrap(body));
  return nodes;
}

/* ── classi CSS di casa con display:flex/inline-flex/grid ── */

/** Classi css di casa con display flex/grid → «safe-inline» | «safe-block». */
function collectFlexCssClasses(cssFiles) {
  const found = new Map();
  for (const file of cssFiles) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(text)) !== null) {
      const inline = /(^|[^-])display\s*:\s*inline-(flex|grid)\b/.test(m[2]);
      if (!inline && !/(^|[^-])display\s*:\s*(flex|grid)\b/.test(m[2])) continue;
      // un solo selettore per segmento (`.a, .b { }`): la classe promette
      // flex solo se compare nel segmento, non per eredità di gruppo.
      for (const seg of m[1].split(",")) {
        for (const cls of seg.matchAll(/\.([A-Za-z][\w-]*)/g)) {
          found.set(cls[1], inline ? "safe-inline" : "safe-block");
        }
      }
    }
  }
  return found;
}

/* ── riconoscimento moduli/icona ── */

function isLucideModule(spec) {
  return spec === "lucide-react" || spec.startsWith("lucide-react/");
}

/* ── valutazione della garanzia di layout ── */

/**
 * L'espressione className GARANTISCE un token di layout in ogni percorso
 * di rendering? Ritorna:
 *   "safe-inline"  → inline-flex/inline-grid: l'elemento è inline-level e
 *                    scorre col testo circostante anche senza testo dentro;
 *   "safe-block"   → flex/grid/table: i figli stanno su una riga, ma
 *                    l'elemento è block-level;
 *   "unsafe"       → classi senza nessun token di layout;
 *   "unknown"      → non dimostrabile: trattato unsafe (falso positivo
 *                    preferibile al bug reale).
 */
function guaranteesLayout(expr, ctx, depth = 0) {
  if (!expr || depth > 8) return "unknown";
  const e = unwrap(expr);

  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return verdictOfToken(layoutTokenOf(e.text)) ?? "unsafe";
  }

  if (ts.isTemplateExpression(e)) {
    // UNIONE: la classe finale concatena tutte le parti — basta che UNA
    // garantisca il layout, statica o tramite la costante risolta
    // (es. `${glassButtonBase} px-5` con la costante flex).
    const kinds = [];
    const staticKind = verdictOfToken(
      layoutTokenOf([e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ")),
    );
    if (staticKind) kinds.push(staticKind);
    for (const span of e.templateSpans) {
      const v = guaranteesLayout(span.expression, ctx, depth + 1);
      if (isSafeV(v)) kinds.push(v);
    }
    if (kinds.includes("safe-block")) return "safe-block";
    if (kinds.length > 0) return "safe-inline";
    return "unknown";
  }

  if (ts.isConditionalExpression(e)) {
    // XOR: solo uno dei due rami viene renderizzato — servono ENTRAMBI safe.
    const a = guaranteesLayout(e.whenTrue, ctx, depth + 1);
    const b = guaranteesLayout(e.whenFalse, ctx, depth + 1);
    if (isSafeV(a) && isSafeV(b)) return a === b ? a : "safe-block";
    if (a === "unsafe" || b === "unsafe") return "unsafe";
    return "unknown";
  }

  if (ts.isBinaryExpression(e)) {
    if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      // cond && classi: se cond è falsa le classi SPARISCONO — come un
      // condizionale servono ENTRAMBI i «rami» safe (il sinistro di solito
      // è la condizione: verdict unknown → conservativo).
      const a = guaranteesLayout(e.right, ctx, depth + 1);
      const b = guaranteesLayout(e.left, ctx, depth + 1);
      if (isSafeV(a) && isSafeV(b)) return a === b ? a : "safe-block";
      if (a === "unsafe" || b === "unsafe") return "unsafe";
      return "unknown";
    }
    if (e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      // a || b: ne viene renderizzato UNO — come un condizionale.
      const a = guaranteesLayout(e.left, ctx, depth + 1);
      const b = guaranteesLayout(e.right, ctx, depth + 1);
      if (isSafeV(a) && isSafeV(b)) return a === b ? a : "safe-block";
      if (a === "unsafe" || b === "unsafe") return "unsafe";
      return "unknown";
    }
    return "unknown";
  }

  if (ts.isCallExpression(e)) {
    // cn()/clsx()/join(): UNIONE — basta UN argomento che da solo
    // garantisca il layout (gli altri sono opzionali o aggiuntivi).
    let sawInline = false;
    for (const arg of e.arguments) {
      const v = guaranteesLayout(arg, ctx, depth + 1);
      if (v === "safe-block") return "safe-block";
      if (v === "safe-inline") sawInline = true;
    }
    if (sawInline) return "safe-inline";
    return "unknown";
  }

  if (ts.isIdentifier(e)) {
    const constInit = ctx.stringConsts.get(e.text);
    if (constInit) return guaranteesLayout(constInit, ctx, depth + 1);
    return "unknown";
  }

  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
    // glassVariants[variant]: il dizionario è una const oggetto del modulo —
    // se TUTTI i suoi valori stringa hanno il token, è safe.
    const objName = ts.isIdentifier(e.expression) ? e.expression.text : null;
    const dict = objName ? ctx.objectConsts.get(objName) : null;
    if (dict) {
      // `dict[variant]`: ogni valore della const oggetto è un PropertyAssignment
      const values = [...dict.properties.values()]
        .map((p) => (ts.isPropertyAssignment(p) ? p.initializer : null))
        .filter((v) => v !== null);
      if (values.length > 0) {
        const verdicts = values.map((v) => guaranteesLayout(v, ctx, depth + 1));
        if (verdicts.every(isSafeV)) {
          return verdicts.every((v) => v === verdicts[0]) ? verdicts[0] : "safe-block";
        }
        if (verdicts.some((v) => v === "unsafe")) return "unsafe";
      }
    }
    return "unknown";
  }

  if (ts.isJsxExpression(e)) return guaranteesLayout(e.expression, ctx, depth + 1);

  return "unknown";
}

/** Il primo token di layout presente nelle classi, o null. */
function layoutTokenOf(clsText) {
  return clsText.split(/\s+/).find((w) => LAYOUT_TOKENS.has(w)) ?? null;
}

/** «safe-inline» se il token è inline-level (inline-flex…), altrimenti block. */
function verdictOfToken(tk) {
  if (!tk) return null;
  return tk.startsWith("inline") ? "safe-inline" : "safe-block";
}

function isSafeV(v) {
  return v === "safe-inline" || v === "safe-block";
}

function hasInlineOverride(clsText) {
  return clsText.split(/\s+/).some((w) => SVG_INLINE_TOKENS.has(w));
}

/** Icona fuori dal flusso (absolute/fixed): non spinge il testo su altre righe. */
function isOutOfFlow(clsText) {
  return clsText.split(/\s+/).some((w) => w === "absolute" || w === "fixed");
}

/** L'svg ha un NOME accessibile (role="img" + aria-label/title): è un'immagine dichiarata. */
function isNamedImage(attrs) {
  if (staticClassName(attrs.role) !== "img") return false;
  const label = attrs["aria-label"] ?? attrs["aria-labelledby"];
  return Boolean(label && staticClassName(label).trim());
}

/* ── raccolta moduli ── */

function collectFileModule(sf) {
  const defs = new Map(); // nome → nodi JSX ritornati
  const stringConsts = new Map(); // nome → espressione stringa
  const objectConsts = new Map(); // nome → ObjectLiteralExpression
  const imports = new Map(); // nome locale → { module, exported }

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) imports.set(clause.name.text, { module: spec, exported: "default" });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          imports.set(el.name.text, { module: spec, exported: el.propertyName?.text ?? el.name.text });
        }
      }
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      defs.set(node.name.text, collectReturns(node.body));
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          defs.set(d.name.text, collectReturns(init.body));
        } else if (ts.isCallExpression(init) && init.arguments.length > 0) {
          // memo/forwardRef((…) => …): il primo arg è il render
          const inner = unwrap(init.arguments[0]);
          if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
            defs.set(d.name.text, collectReturns(inner.body));
          }
        } else if (
          ts.isStringLiteral(init) ||
          ts.isNoSubstitutionTemplateLiteral(init) ||
          ts.isTemplateExpression(init) ||
          ts.isCallExpression(init)
        ) {
          stringConsts.set(d.name.text, init);
        } else if (ts.isObjectLiteralExpression(init)) {
          objectConsts.set(d.name.text, init);
        }
      }
      return;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return { sf, defs, stringConsts, objectConsts, imports };
}

/* ── JSX: attributi, tag, testo ── */

function attributesOf(node) {
  const open = ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement?.attributes;
  const out = {};
  if (!open) return out;
  for (const attr of open.properties) {
    if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name)) out[attr.name.text] = attr.initializer;
  }
  return out;
}

function staticClassName(initializer) {
  if (!initializer) return "";
  const fromNode = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
    }
    return null;
  };
  const direct = fromNode(initializer);
  if (direct !== null) return direct;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    const e = unwrap(initializer.expression);
    const lit = fromNode(e);
    if (lit !== null) return lit;
    if (ts.isCallExpression(e)) {
      return e.arguments
        .map((a) => fromNode(unwrap(a)))
        .filter((s) => s !== null)
        .join(" ");
    }
  }
  return "";
}

function tagNameText(node, sf) {
  const t = ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement?.tagName;
  if (!t) return "";
  return t.getText(sf).trim();
}

function jsxFamily(node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function exprHasText(e, depth) {
  if (!e || depth > 6) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text.trim().length > 0;
  if (ts.isTemplateExpression(e)) return true;
  if (ts.isIdentifier(e)) return true; // {variabile}: testo a runtime
  if (ts.isConditionalExpression(e)) {
    return exprHasText(unwrap(e.whenTrue), depth + 1) || exprHasText(unwrap(e.whenFalse), depth + 1);
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return exprHasText(unwrap(e.right), depth + 1); // {cond && "testo"}
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return exprHasText(unwrap(e.left), depth + 1) || exprHasText(unwrap(e.right), depth + 1); // {a ?? b}
  }
  if (ts.isJsxExpression(e)) return exprHasText(e.expression, depth + 1);
  // JSX elementi/fragmente/call: giudicati dai loro discendenti, non qui
  return false;
}

/* ── il guard ── */

/**
 * @param {ts.Node} raw   nodo corrente
 * @param {object} ctx    { file, mod, scope, flexCss, layoutStack, frames, seen, depth, out }
 * layoutStack: [{ node, safe }] — gli elementi ospiti percorsi fin qui.
 */
function walkJsx(raw, ctx) {
  if (ctx.depth > MAX_DEPTH) return;
  const node = unwrap(raw);
  // il percorso di discesa serve a checkIconInHost per capire QUALE figlio
  // dell'ospite contiene l'icona (identità di nodo, valida cross-file).
  ctx.path.push(node);
  try {
    walkJsxNode(node, ctx);
  } finally {
    ctx.path.pop();
  }
}

function walkJsxNode(node, ctx) {
  if (ts.isJsxExpression(node)) {
    if (node.expression) {
      ctx.depth += 1;
      walkJsx(node.expression, ctx);
      ctx.depth -= 1;
    }
    return;
  }

  if (ts.isJsxFragment(node)) {
    ctx.depth += 1;
    for (const c of node.children) walkJsx(c, ctx);
    ctx.depth -= 1;
    return;
  }

  if (ts.isIdentifier(node)) {
    // {children} / {propJsx}: risale al frammento passato al sito d'uso.
    for (let i = ctx.frames.length - 1; i >= 0; i--) {
      const frame = ctx.frames[i];
      const nodes = frame.map.get(node.text);
      if (nodes) {
        for (const frag of nodes) {
          // i nodi del frammento appartengono al file del CHIAMANTE: anche
          // le costanti e lo scope devono essere i suoi, o gli identificatori
          // nelle className del frammento non si risolvono più.
          walkJsx(frag, {
            ...ctx,
            file: frame.file,
            mod: frame.mod,
            scope: frame.mod.scope,
            stringConsts: frame.mod.stringConsts,
            objectConsts: frame.mod.objectConsts,
            depth: ctx.depth + 1,
          });
        }
        return;
      }
    }
    return;
  }

  if (ts.isConditionalExpression(node)) {
    if (node.whenTrue) walkJsx(node.whenTrue, ctx);
    if (node.whenFalse) walkJsx(node.whenFalse, ctx);
    return;
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    walkJsx(node.right, ctx);
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) walkJsx(el, ctx);
    return;
  }

  if (ts.isCallExpression(node)) {
    // callback di .map() ecc.: i ritorni JSX sono parte del rendering
    for (const arg of node.arguments) {
      const cb = unwrap(arg);
      if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
        for (const ret of collectReturns(cb.body)) walkJsx(ret, ctx);
      }
    }
    return;
  }

  if (!jsxFamily(node)) return;

  const tag = tagNameText(node, ctx.mod.sf);

  /* ── svg inline ── */
  if (tag === "svg") {
    const attrs = attributesOf(node);
    const cls = staticClassName(attrs.className);
    if (hasInlineOverride(cls)) return; // override esplicito di Preflight
    if (isOutOfFlow(cls)) return; // assoluto/fixed: non sta nel flusso, non spinge il testo
    if (isNamedImage(attrs)) return; // role="img" con nome accessibile: immagine dichiarata, non icona di accoppiata
    checkIconInHost(node, ctx, "svg");
    return;
  }

  const isHostLike = /^[a-z]/.test(tag) || tag.includes(".");

  if (isHostLike) {
    const safe = layoutVerdictOf(node, ctx);
    ctx.depth += 1;
    if (ts.isJsxElement(node)) {
      for (const c of node.children) {
        // ogni ospite ricorda la SUA sourceFile: i figli JSX stanno nel suo
        // stesso albero, ma getSourceFile() non è affidabile su alberi non
        // boundati (i frame di prop attraversano file diversi).
        walkJsx(c, { ...ctx, layoutStack: [...ctx.layoutStack, { node, safe, sf: ctx.mod.sf, file: ctx.file }] });
      }
    }
    ctx.depth -= 1;
    return;
  }

  /* ── componente ── */

  // 1) icona lucide diretta
  const imp = ctx.mod.imports.get(tag);
  if (imp && isLucideModule(imp.module)) {
    const cls = staticClassName(attributesOf(node).className);
    if (hasInlineOverride(cls)) return;
    if (isOutOfFlow(cls)) return; // fuori dal flusso: mai un'accoppiata da proteggere
    checkIconInHost(node, ctx, tag);
    return;
  }

  // 2) UiIcon del registry admin
  if (KNOWN_ICON_COMPONENTS.has(tag) && imp?.module.includes("icon-registry")) {
    const cls = staticClassName(attributesOf(node).className);
    if (hasInlineOverride(cls)) return;
    if (isOutOfFlow(cls)) return;
    checkIconInHost(node, ctx, tag);
    return;
  }

  // 3) componente interno risolto: scende nella def, con i frammenti
  //    passati qui come props disponibili per {children}/{prop}.
  const resolved = ctx.scope.get(tag) ?? (ctx.mod.defs.has(tag) ? { file: ctx.file, mod: ctx.mod, nodes: ctx.mod.defs.get(tag) } : null);
  if (resolved) {
    const key = `${resolved.file}#${tag}`;
    if (ctx.seen.has(key)) return;
    const nextSeen = new Set(ctx.seen);
    nextSeen.add(key);

    // def che ritorna <svg> = icona dinamica locale (Icon = Download, ecc.)
    const svgRoot = svgRootOf(resolved.nodes, resolved.mod);
    if (svgRoot) {
      const cls = staticClassName(attributesOf(node).className);
      if (hasInlineOverride(cls)) return;
      if (isOutOfFlow(cls)) return;
      // role="img" + nome accessibile SULL'SVG DELLA DEF (i componenti
      // non propagano gli attributi all'uso): immagine dichiarata, non icona.
      if (isNamedImage(attributesOf(svgRoot))) return;
      checkIconInHost(node, ctx, tag);
      return;
    }

    const frames = [...ctx.frames, { map: harvestPropsJsx(node), file: ctx.file, mod: ctx.mod }];
    ctx.depth += 1;
    for (const ret of resolved.nodes) {
      // la def vive nel SUO modulo: costanti e scope devono essere quelli
      // del file che la contiene, o `className={itemCls}` (costante locale
      // alla lib) non si risolve scendendo da una pagina importatrice —
      // falso positivo cross-file, invisibile nell'analisi del file da solo.
      walkJsx(ret, {
        ...ctx,
        file: resolved.file,
        mod: resolved.mod,
        scope: resolved.mod.scope,
        stringConsts: resolved.mod.stringConsts,
        objectConsts: resolved.mod.objectConsts,
        seen: nextSeen,
        frames,
        depth: ctx.depth,
      });
    }
    ctx.depth -= 1;
    return;
  }

  // 4) componente esterno non risolto (Link, componenti di librerie): i
  //    children scritti qui finiscono DENTRO l'elemento radice del
  //    componente, che riceve la className scritta all'uso. Se quella
  //    className garantisce il layout, il sito d'uso È un ospite safe
  //    (il back-link <Link className="inline-flex …">): entra nello stack
  //    come tale. Attraversare i children senza registrarlo sarebbe un
  //    falso positivo certo; con il verdetto corretto il giudizio resta
  //    fedele al rendering (il layout vero è quello dell'elemento radice).
  const verdict = layoutVerdictOf(node, ctx);
  const childCtx = isSafeV(verdict)
    ? { ...ctx, layoutStack: [...ctx.layoutStack, { node, safe: verdict, sf: ctx.mod.sf, file: ctx.file }] }
    : ctx;
  ctx.depth += 1;
  if (ts.isJsxElement(node)) {
    for (const c of node.children) walkJsx(c, childCtx);
  }
  ctx.depth -= 1;
}

/** Frammenti JSX passati come props (children incluso) → mappa prop→nodi. */
function harvestPropsJsx(node) {
  const map = new Map();
  const attrs = attributesOf(node);
  for (const [name, init] of Object.entries(attrs)) {
    if (!init || !ts.isJsxExpression(init) || !init.expression) continue;
    const e = unwrap(init.expression);
    if (jsxFamily(e)) {
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(e);
    }
  }
  if (ts.isJsxElement(node) && node.children.length > 0) {
    const list = map.get("children") ?? [];
    for (const c of node.children) list.push(c);
    map.set("children", list);
  }
  return map;
}

/**
 * Verdetto di layout dell'elemento ospite: «safe-inline» (inline-flex…),
 * «safe-block» (flex/grid…), «unsafe» (classi senza layout) o «unknown»
 * (non dimostrabile — trattato unsafe).
 */
function layoutVerdictOf(node, ctx) {
  const attrs = attributesOf(node);
  const init = attrs.className ?? attrs.class;
  if (!init) return "unsafe";
  const verdict = guaranteesLayout(
    ts.isJsxExpression(init) ? init.expression : init,
    ctx,
  );
  if (isSafeV(verdict)) return verdict;
  // fallback: le classi letterali pescabili + classi css di casa
  const cls = staticClassName(init);
  if (!cls) return "unsafe";
  const kind = verdictOfToken(layoutTokenOf(cls));
  if (kind) return kind;
  for (const w of cls.split(/\s+/)) {
    const cssKind = ctx.flexCss.get(w);
    if (cssKind) return cssKind;
  }
  return "unsafe";
}

/**
 * La def È un'icona: l'svg è la RADICE del ritorno, raggiunta attraverso
 * solo avvolgenti trasparenti (espressioni, condizioni, dereferenziazioni
 * di variabili locali). Ritorna il NODO svg radice, o null se la def
 * renderizza altro contenuto (un componente che CONTIENE un svg in
 * profondità tra altro contenuto — grafico, barra di ricerca con input —
 * non è un'icona: classificarlo tale manderebbe in overload
 * checkIconInHost, che giudicherebbe l'ospite del componente invece
 * dell'accoppiata reale).
 */
function svgRootOf(defNodes, mod) {
  let svgRoot = null;
  const visit = (raw, depth) => {
    if (svgRoot || depth > 8) return;
    const node = unwrap(raw);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (tagNameText(node, mod.sf) === "svg") {
        svgRoot = node;
      }
      // radice non-svg: contenuto reale, non un avvolgente — il giudizio
      // sull'«è un'icona?» si chiude qui.
      return;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) visit(node.expression, depth + 1);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      if (node.whenTrue) visit(node.whenTrue, depth + 1);
      if (node.whenFalse) visit(node.whenFalse, depth + 1);
      return;
    }
    if (ts.isIdentifier(node) && mod.defs.has(node.text)) {
      for (const ret of mod.defs.get(node.text)) visit(ret, depth + 1);
    }
  };
  for (const n of defNodes) visit(n, 0);
  return svgRoot;
}

function containsNode(root, target) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (n === target) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  };
  visit(root);
  return found;
}

/**
 * Icona trovata: cerca dal più interno verso l'esterno il primo ospite che
 * ha testo accanto all'icona — l'ospite dell'ACCOPPIATA. È il SUO verdetto
 * a decidere: un antenato safe che non contiene anche il testo non mette
 * icona e testo sulla stessa riga garantita (bug-flex-on-wrong-level: lo
 * span inline-flex avvolge solo l'icona, il testo resta fuori e sotto wrap
 * vanno su righe separate). Nessun ospite con testo accanto = icona sola.
 */
/**
 * Elementi che APRONO RIGA PROPRIA: il loro testo non è mai «accanto» a
 * un'icona inline del fratello (Pre flight: sono block). Contarli come
 * testo d'accoppiata generava decine di falsi positivi (un <p> di sezione
 * sotto l'icona, un'altra <li> accanto). L'accoppiata si forma solo con
 * contenuto INLINE: testo diretto, espressioni, elementi inline.
 */
const BLOCK_LEVEL = new Set([
  "p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "header", "footer", "nav", "aside", "main",
  "form", "table", "thead", "tbody", "tr", "blockquote", "pre", "figure",
  "figcaption", "hr", "dl", "dt", "dd", "fieldset",
]);

/**
 * Il ramo fratello può stare sulla STESSA riga dell'icona? Solo contenuto
 * inline forma l'accoppiata: il caso reale del bug (bug-flex-on-wrong-level)
 * resta coperto dallo span INLINE con testo, non dai blocchi circostanti.
 */
function siblingIsInlineCoupled(node, sf, depth = 0) {
  if (depth > 6) return false;
  if (ts.isJsxText(node)) {
    return node.getText(sf).replace(/\s+/g, " ").trim().length > 0;
  }
  if (ts.isJsxExpression(node)) {
    return node.expression ? exprHasText(unwrap(node.expression), 0) : false;
  }
  if (ts.isJsxElement(node)) {
    if (BLOCK_LEVEL.has(tagNameText(node, sf))) return false;
    // un ramo FUORI DAL FLUSSO non può stare accanto all'icona: assoluto,
    // fixed e sr-only (visivamente assente) non formano l'accoppiata.
    const cls = staticClassName(attributesOf(node).className);
    if (isOutOfFlow(cls) || cls.split(/\s+/).includes("sr-only")) return false;
    return node.children.some((c) => siblingIsInlineCoupled(c, sf, depth + 1));
  }
  if (ts.isJsxSelfClosingElement(node)) return false;
  if (ts.isJsxFragment(node)) {
    return node.children.some((c) => siblingIsInlineCoupled(c, sf, depth + 1));
  }
  return false;
}

function checkIconInHost(iconNode, ctx, label) {
  for (let i = ctx.layoutStack.length - 1; i >= 0; i--) {
    const entry = ctx.layoutStack[i];
    const host = entry.node;
    if (!ts.isJsxElement(host)) continue;
    // il ramo dell'albero che contiene l'icona: il figlio dell'ospite da cui
    // la discesa è passata. Con i frame di prop ({children} risolto in un
    // altro file) containsNode sull'icona da sola non basta: il confronto è
    // per identità di nodo lungo il percorso di discesa.
    const hostIdx = ctx.path.lastIndexOf(host);
    const iconBranch = hostIdx >= 0 && hostIdx + 1 < ctx.path.length ? ctx.path[hostIdx + 1] : iconNode;
    // il wrapper è BLOCK (p, div, li…): l'icona non condivide la riga con
    // NULLA fuori da lui — inutile risalire, l'accoppiata (se c'è) è già
    // stata giudicata dentro (o non c'è: icona sola, legale).
    if (i < ctx.layoutStack.length - 1 && iconBranchIsBlock(iconBranch, entry.sf)) break;
    const hasSiblingText = host.children.some((c) => {
      if (c === iconBranch || containsNode(c, iconBranch)) return false; // l'icona o il suo contenitore
      return siblingIsInlineCoupled(c, entry.sf);
    });
    if (!hasSiblingText) continue; // niente testo inline accanto: risali
    if (isSafeV(entry.safe)) return; // accoppiata dentro un ospite safe: legale
    recordViolation(ctx, entry, label);
    return;
  }
}

/**
 * Il ramo che contiene l'icona è un elemento block-level: a quel punto la
 * ricerca dell'accoppiata si ferma (il testo fuori dal wrapper non sta
 * accanto all'icona). Il caso bug-flex-on-wrong-level continua a essere
 * coperto: il suo wrapper è uno SPAN inline, quindi la risalita arriva
 * all'<a> dove il testo è davvero di fianco.
 */
function iconBranchIsBlock(branch, sf) {
  return ts.isJsxElement(branch) && BLOCK_LEVEL.has(tagNameText(branch, sf));
}

function recordViolation(ctx, entry, label) {
  // l'ospite può venire da un frame di prop: contano la SUA sourceFile e riga
  const { node: host, sf, file } = entry;
  const key = `${file}:${host.getStart(sf)}:${label}`;
  if (ctx.out.seenKeys.has(key)) return;
  ctx.out.seenKeys.add(key);
  ctx.out.violations.push({
    file: path.relative(process.cwd(), sf.fileName),
    line: sf.getLineAndCharacterOfPosition(host.getStart(sf)).line + 1,
    host: tagNameText(host, sf),
    icon: label,
  });
}

/* ── driver ── */

function listTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function listCssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCssFiles(p));
    else if (/\.css$/.test(entry.name)) out.push(p);
  }
  return out;
}

export function runIconGuard({ files, cssFiles, srcDir = path.join(process.cwd(), "src") }) {
  const flexCss = collectFlexCssClasses(cssFiles);
  const out = { violations: [], seenKeys: new Set() };

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  });

  const modules = new Map(); // file → module
  const byAbs = new Map(); // abs path → file key
  for (const f of files) {
    const sf = program.getSourceFile(f);
    if (!sf) continue;
    modules.set(f, collectFileModule(sf));
    byAbs.set(path.resolve(f), f);
  }

  function resolveImportPath(fromFile, specifier) {
    let target;
    if (specifier.startsWith("@/")) target = path.join(srcDir, specifier.slice(2));
    else if (specifier.startsWith(".")) target = path.resolve(path.dirname(fromFile), specifier);
    else return null;
    for (const c of [
      target + ".tsx",
      target + ".ts",
      path.join(target, "index.tsx"),
      path.join(target, "index.ts"),
    ]) {
      const hit = byAbs.get(path.resolve(c));
      if (hit) return hit;
    }
    return null;
  }

  // scope: nome locale → def cross-file (per scendere nelle def importate)
  for (const [f, mod] of modules) {
    mod.scope = new Map();
    for (const [local, info] of mod.imports) {
      const targetFile = resolveImportPath(f, info.module);
      if (!targetFile || !modules.has(targetFile)) continue;
      const targetMod = modules.get(targetFile);
      if (info.exported === "default") {
        const def = [...targetMod.defs.entries()].find(([, d]) => d)?.[1];
        if (def) mod.scope.set(local, { file: targetFile, mod: targetMod, nodes: def });
        continue;
      }
      const nodes = targetMod.defs.get(info.exported);
      if (nodes) mod.scope.set(local, { file: targetFile, mod: targetMod, nodes });
    }
  }

  for (const [f, mod] of modules) {
    const ctx = {
      file: f,
      mod,
      scope: mod.scope,
      flexCss,
      stringConsts: mod.stringConsts,
      objectConsts: mod.objectConsts,
      layoutStack: [],
      frames: [],
      seen: new Set(),
      path: [],
      depth: 0,
      out,
    };
    for (const [, def] of mod.defs) {
      for (const ret of def) {
        walkJsx(ret, { ...ctx, layoutStack: [], frames: [], seen: new Set([`${f}#root`]), path: [] });
      }
    }
  }

  return { violations: out.violations, flexCssCount: flexCss.size, files: files.length };
}

/* ── CLI ── */

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  if (!existsSync(SRC_DIR)) {
    console.error("icon-inline-guard: cartella src/ non trovata (eseguire dalla radice del progetto)");
    process.exit(1);
  }
  const files = listTsFiles(SRC_DIR);
  const cssFiles = listCssFiles(SRC_DIR);
  const { violations } = runIconGuard({ files, cssFiles });

  if (violations.length > 0) {
    console.error(`\n✖ icon-inline-guard: ${violations.length} icona/e accanto a testo senza layout flessibile:\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  <${v.host}> contiene «${v.icon}» + testo`);
      console.error(`    fix: aggiungi "inline-flex items-center gap-2" all'elemento — oppure "inline" sull'icona per i casi dentro il testo\n`);
    }
    process.exit(1);
  }

  if (!process.argv.includes("--quiet")) {
    console.log(`✓ icon-inline-guard: nessuna icona accanto a testo senza inline-flex — ${files.length} file analizzati.`);
  }
}
