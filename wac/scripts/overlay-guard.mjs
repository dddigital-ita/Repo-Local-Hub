#!/usr/bin/env node
/**
 * OVERLAY GUARD — sentinella automatica del bug «containing block».
 *
 * Per spec CSS, un antenato con backdrop-filter (ma anche filter o
 * will-change) diventa CONTAINING BLOCK dei discendenti `position: fixed`:
 * un overlay «fixed inset-0» montato dentro una superficie glass si
 * dimensiona su quella superficie, non sul viewport. È successo alla
 * command palette ⌘K (2026-09, commit 8e5c7ba): questo guard impone che
 * non succeda di nuovo, fallendo la build.
 *
 * Come lavora (analisi statica con il compilatore TypeScript già in repo):
 *   1. SUPERFICI A RISCHIO: classi CSS definite in globals.css con
 *      backdrop-filter/filter/will-change + utility Tailwind
 *      `backdrop-blur*`, `filter`, `will-change*`;
 *   2. GRAFO COMPONENTI: per ogni file .ts/.tsx di src/ registra le
 *      definizioni di componente (dichiarate o importate da moduli interni)
 *      e i nodi JSX che restituiscono;
 *   3. DISCESA: da ogni superficie risale tutto il sottoalbero renderizzato
 *      — anche attraverso i componenti, compresi i frammenti passati come
 *      props (children e JSX nelle attributi) — e segnala ogni elemento con
 *      `fixed` tra le classi, SALVO che nel percorso ci sia `createPortal`
 *      (il pattern che riporta l'overlay al viewport).
 *
 * Limiti dichiarati (accettati per un guard di build): className dinamiche
 * (template/cn(…)) non sono valutabili — l'elemento è trattato come non a
 * rischio; JSX costruito via variabili non risolte non viene seguito;
 * l'aliasing di createPortal è riconosciuto solo da import interni.
 *
 * Uso CLI: node scripts/overlay-guard.mjs [--quiet]
 * Libreria: runGuard() per i test (tests/overlay-guard.test.mjs).
 * Esce 0 se nessuna violazione, 1 altrimenti.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

/* ── configurazione ── */

const SRC_DIR = path.join(process.cwd(), "src");
const GLOBALS_CSS = path.join(process.cwd(), "src", "app", "globals.css");
const MAX_DEPTH = 30;

/** Fallback se globals.css non è leggibile: le classi glass note. */
const CSS_FALLBACK = new Set(["glass", "glass-strong"]);

const RISKY_UTILITY_RE =
  /\b(?:backdrop-blur|backdrop-saturate|backdrop-grayscale|backdrop-invert|backdrop-sepia|backdrop-filter|filter|will-change)\b/;

/* ── classi CSS a rischio da globals.css ── */

function riskyCssClasses(cssText) {
  const found = new Set();
  const ruleRe = /\.([A-Za-z][\w-]*)\s*\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(cssText)) !== null) {
    if (/(^|[^-])(backdrop-filter|filter|will-change)\s*:/.test(m[2])) found.add(m[1]);
  }
  return found.size > 0 ? found : new Set(CSS_FALLBACK);
}

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

function hasExport(node) {
  return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
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

/* ── raccolta componenti per file ── */

function collectFileModule(sf) {
  const defs = new Map(); // nome locale → { exported, nodes: [espressioni JSX] }
  const imports = new Map(); // nome locale → nome esportato (solo moduli interni)
  const importPaths = new Map(); // nome esportato → file risolto (riempito dal driver)

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      // default: import StickyCallButton from "…"
      if (clause?.name) imports.set(clause.name.text, "default");
      // named: import { createPortal as X } from "…"
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          imports.set(el.name.text, el.propertyName?.text ?? el.name.text);
          importPaths.set(el.name.text, spec);
        }
      }
      if (clause?.name) importPaths.set(clause.name.text, spec);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      defs.set(node.name.text, {
        exported: hasExport(node),
        isDefault: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false,
        nodes: collectReturns(node.body),
      });
      return;
    }
    // export default (() => …): def senza nome, chiave sintetica "default"
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const init = unwrap(node.expression);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        defs.set("default", { exported: true, isDefault: true, nodes: collectReturns(init.body) });
      }
      return;
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExport(node);
      const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          defs.set(d.name.text, { exported, isDefault, nodes: collectReturns(init.body) });
        } else if (ts.isCallExpression(init) && init.arguments.length > 0) {
          // memo(forwardRef((…) => …)) e simili: il primo arg è il render
          const inner = unwrap(init.arguments[0]);
          if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
            defs.set(d.name.text, { exported, isDefault, nodes: collectReturns(inner.body) });
          }
        }
      }
      return;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  return { sf, defs, imports, importPaths };
}

/* ── JSX: lettura tag / classi / attributi ── */

function tagNameText(node, sf) {
  const t = ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement?.tagName;
  if (!t) return "";
  return t.getText(sf).trim();
}

function attributesOf(node) {
  const open = ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement.attributes;
  const out = {};
  for (const attr of open.properties) {
    if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name)) out[attr.name.text] = attr.initializer;
  }
  return out;
}

/** className statica. Estrae anche i literal dagli argomenti stringa di
 *  cn(…)/clsx(…) (le superfici del design system); "" se restano parti
 *  dinamiche rilevanti: limite dichiarato in testa. */
function staticClassName(initializer) {
  if (!initializer) return "";
  const fromNode = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
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

function jsxFamily(node) {
  return (
    ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
  );
}

/** Frammenti JSX passati come props a un elemento (children inclusi). */
function harvestPropsJsx(node) {
  const map = new Map(); // prop → [nodo JSX]
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

/* ── discesa ── */

/**
 * @param {ts.Node} raw     nodo da visitare
 * @param {object} ctx      { chain, file, mod, scope, inPortal, seen, frames, out }
 */
function walkJsx(raw, ctx) {
  if (ctx.chain.length > MAX_DEPTH) return;
  const node = unwrap(raw);

  if (ts.isJsxExpression(node)) {
    if (node.expression) walkJsx(node.expression, ctx);
    return;
  }

  if (ts.isJsxFragment(node)) {
    for (const c of node.children) walkJsx(c, ctx);
    return;
  }

  if (ts.isIdentifier(node)) {
    // {children} o {unaPropJsx}: risale al frammento passato al sito d'uso,
    // dal frame più interno verso l'esterno. La guardia «resolving» spezza
    // i pass-through ciclici (un def che inoltra {children} a un figlio che
    // a sua volta renderizza {children}): senza, l'identificatore risolve
    // ricorsivamente in se stesso.
    for (let i = ctx.frames.length - 1; i >= 0; i--) {
      const frame = ctx.frames[i];
      const nodes = frame.map.get(node.text);
      if (nodes) {
        const rKey = `${i}:${node.text}`;
        if (ctx.resolving.has(rKey)) return;
        const nextResolving = new Set(ctx.resolving);
        nextResolving.add(rKey);
        for (const frag of nodes) {
          walkJsx(frag, { ...ctx, file: frame.file, mod: frame.mod, scope: frame.scope, resolving: nextResolving });
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
    if (isPortalCall(node, ctx)) {
      ctx.out.portals += 1;
      if (node.arguments.length > 0) walkJsx(node.arguments[0], { ...ctx, inPortal: true });
      return;
    }
    // callback di map/ecc.: i loro ritorni JSX sono parte del rendering
    for (const arg of node.arguments) {
      const cb = unwrap(arg);
      if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
        for (const ret of collectReturns(cb.body)) walkJsx(ret, ctx);
      }
    }
    return;
  }

  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return;

  /* ── elemento JSX ── */
  const tag = tagNameText(node, ctx.mod.sf);

  if (tag === "createPortal") {
    // forma <CreatePortal> non usata nel repo; mantenuta per Completezza
    ctx.out.portals += 1;
    if (ts.isJsxElement(node)) for (const c of node.children) walkJsx(c, { ...ctx, inPortal: true });
    return;
  }

  const isHostLike = /^[a-z]/.test(tag) || tag.includes(".");
  if (isHostLike) {
    // host o passthrough (es. motion.div: framer inoltra className al div)
    const attrs = attributesOf(node);
    const cls = staticClassName(attrs.className ?? attrs.class);
    const words = cls.split(/\s+/).filter(Boolean);
    const risky = words.some((w) => RISKY_UTILITY_RE.test(w) || ctx.cssRisky.has(w));

    let chain = ctx.chain;
    if (risky) chain = [...ctx.chain, { file: baseName(ctx.file), cls: words.find((w) => RISKY_UTILITY_RE.test(w) || ctx.cssRisky.has(w)) ?? tag }];

    // La regola vale per gli ANTENATI: un elemento glass+fixed su sé stesso
    // è legittimo (il proprio backdrop-filter crea containing block per i
    // PROPRI discendenti, non per sé — vedi CookieBanner). Per questo la
    // condizione usa ctx.chain, non la catena appena estesa.
    if (words.includes("fixed") && ctx.chain.length > 0 && !ctx.inPortal) {
      recordViolation(ctx, cls, node);
    }
    if (ts.isJsxElement(node)) {
      const next = { ...ctx, chain };
      for (const c of node.children) walkJsx(c, next);
    }
    return;
  }

  const resolved = ctx.scope.get(tag);
  if (!resolved) {
    // Componente esterno (lucide, framer…): la def non è nel grafo, ma i
    // children scritti qui vengono renderizzati normalmente dentro di esso
    // (es. AnimatePresence) → li si attraversa comunque: scelto il falso
    // positivo accettabile, il falso negativo no.
    if (ts.isJsxElement(node)) {
      for (const c of node.children) walkJsx(c, ctx);
    }
    return;
  }
  // componente interno: scende nella definizione, con i frammenti
  // passati qui come props disponibili per i riferimenti {children}/{prop}.

  const key = `${resolved.file}#${tag}`;
  // il seen è anche input: un componente già nella catena (ricorsione nel
  // grafo) non viene ridisceso — la ricorsione termina, la catena di superfici
  // percorsa fin lì resta valida per la violazione
  if (ctx.seen.has(key)) return;
  const propsMap = harvestPropsJsx(node);
  const frames = [...ctx.frames, { map: propsMap, file: ctx.file, mod: ctx.mod, scope: ctx.scope }];
  const nextSeen = new Set(ctx.seen);
  nextSeen.add(key);

  // i children letterali scritti QUI restano nel file corrente
  if (ts.isJsxElement(node)) {
    const here = { ...ctx, frames };
    for (const c of node.children) walkJsx(c, here);
  }

  const inner = { ...ctx, file: resolved.file, mod: resolved.mod, scope: resolved.mod.scope, seen: nextSeen, frames };
  for (const ret of resolved.def.nodes) walkJsx(ret, inner);
}

function isPortalCall(call, ctx) {
  const callee = unwrap(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  if (callee.text === "createPortal") return true;
  // aliasing: import { createPortal as X } risolto sui moduli interni
  const imported = ctx.mod.imports.get(callee.text);
  return imported === "createPortal";
}

function recordViolation(ctx, cls, node) {
  // il nodo può arrivare da un frame di prop (figlio scritto in un altro
  // file del grafo): la sourceFile del contesto è l'unica fonte veritiera
  const sf = ctx.mod.sf;
  const key = `${ctx.file}:${node.getStart(sf)}:${cls}`;
  if (ctx.out.seenKeys.has(key)) return;
  ctx.out.seenKeys.add(key);
  ctx.out.violations.push({
    file: baseName(ctx.file),
    cls,
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    root: ctx.root,
    chain: ctx.chain.map((c) => `${c.file}«${c.cls}»`).join(" → "),
  });
}

function baseName(p) {
  return path.relative(process.cwd(), p);
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

export function runGuard({ files, cssText, srcDir = path.join(process.cwd(), "src") }) {
  const cssRisky = riskyCssClasses(cssText);
  const out = { violations: [], portals: 0, seenKeys: new Set() };

  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  });

  const graph = new Map(); // file → modulo { sf, defs, imports, importPaths }
  const byPath = new Map(); // path normalizzato → file (per risolvere gli import)
  for (const f of files) {
    const sf = program.getSourceFile(f);
    if (!sf) continue;
    const mod = collectFileModule(sf);
    graph.set(f, mod);
    byPath.set(path.resolve(f), f);
  }

  // risoluzione import interni: nome esportato → file che lo definisce
  const exportsIndex = new Map(); // file → Set(nomi esportati)
  for (const [f, mod] of graph) {
    exportsIndex.set(f, new Set([...mod.defs.entries()].filter(([, d]) => d.exported).map(([n]) => n)));
  }
  function resolveImportPath(fromFile, specifier) {
    let target;
    if (specifier.startsWith("@/")) target = path.join(srcDir, specifier.slice(2));
    else if (specifier.startsWith(".")) target = path.resolve(path.dirname(fromFile), specifier);
    else return null;
    for (const c of [target + ".tsx", target + ".ts", path.join(target, "index.tsx"), path.join(target, "index.ts")]) {
      const hit = byPath.get(path.resolve(c));
      if (hit) return hit;
    }
    return null;
  }

  for (const [f, mod] of graph) {
    const scope = new Map();
    for (const [name, def] of mod.defs) scope.set(name, { file: f, mod, def });
    for (const [local, exported] of mod.imports) {
      const targetFile = resolveImportPath(f, mod.importPaths.get(local) ?? "");
      if (!targetFile || !graph.has(targetFile)) continue;
      const targetMod = graph.get(targetFile);
      const def =
        exported === "default"
          ? [...targetMod.defs.values()].find((d) => d.isDefault)
          : targetMod.defs.get(exported);
      if (def) scope.set(local, { file: targetFile, mod: targetMod, def });
    }
    mod.scope = scope;
  }

  for (const [f, mod] of graph) {
    for (const [name, def] of mod.defs) {
      const ctx = {
        chain: [],
        file: f,
        mod,
        scope: mod.scope,
        inPortal: false,
        seen: new Set([`${f}#${name}`]),
        frames: [],
        resolving: new Set(),
        out,
        cssRisky,
        root: `${baseName(f)}#${name}`,
      };
      for (const ret of def.nodes) walkJsx(ret, ctx);
    }
  }

  return { violations: out.violations, portals: out.portals, cssRiskyCount: cssRisky.size, files: files.length };
}

/* ── CLI ── */

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  if (!existsSync(SRC_DIR)) {
    console.error("overlay-guard: cartella src/ non trovata (eseguire dalla radice del progetto)");
    process.exit(1);
  }
  const files = listTsFiles(SRC_DIR);
  const cssText = existsSync(GLOBALS_CSS) ? readFileSync(GLOBALS_CSS, "utf8") : "";
  const { violations, portals, cssRiskyCount } = runGuard({ files, cssText });

  if (violations.length > 0) {
    console.error(`\n✖ overlay-guard: ${violations.length} violazione/i del containing block:\n`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  fixed class="${v.cls}"`);
      console.error(`    percorso: ${v.root} → ${v.chain}`);
      console.error(`    fix: createPortal su document.body (vedi admin-command-palette.tsx, commit 8e5c7ba)\n`);
    }
    process.exit(1);
  }

  if (!process.argv.includes("--quiet")) {
    console.log(
      `✓ overlay-guard: nessun overlay fixed raggiungibile da una superficie glass — ${files.length} file, ${cssRiskyCount} classi CSS a rischio, ${portals} percorsi protetti da portale.`,
    );
  }
}
