/**
 * REGISTRY ICONE — le icone dell'admin passano da un solo posto.
 *
 * Il test PARSA i file reali (il registry è TSX: node non può importare
 * JSX, stesso pattern del test emoji) e verifica tre guardie:
 *
 * 1. il registry esiste, è client, usa entrambe le famiglie (Phosphor
 *    per i concetti, Tabler per brand/pillole) ed espone UiIcon;
 * 2. le UI admin non usano più glifi emoji come icone di stato/esito/
 *    canale (🟢 ✓ ✗ 🌐 …): il significato è nel `name` semantico;
 * 3. nessuna UI importa Phosphor o Tabler direttamente — la famiglia
 *    grafica cambia in un file solo, non in ogni schermata.
 *
 * Esecuzione: `npm test` (node --test).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const REGISTRY = "src/components/icon-registry.tsx";

/** Le UI che il prompt «registry icone» ha ripulito dai glifi. */
const ADMIN_UI_FILES = [
  "src/app/admin/operators/page.tsx",
  "src/app/admin/ai/autonomia/page.tsx",
  "src/app/admin/ai/inventario/page.tsx",
  "src/app/admin/ai/provider/page.tsx",
  "src/app/admin/shield/page.tsx",
  "src/app/setup/page.tsx",
  "src/components/callback-buttons.tsx",
  "src/components/ai-tool-usage.tsx",
  "src/components/ai-faq-editor.tsx",
  "src/components/seo-gsc-panel.tsx",
  "src/components/theme-editor.tsx",
  "src/components/seo-global-panel.tsx",
  "src/components/seo-landing-editor.tsx",
];

/**
 * Glifi pittografici vietati come icone di stato/esito/canale nelle UI.
 * NON rientrano i segni tipografici di testo (frecce → ←, divisori ─ ·):
 * quelli sono punteggiatura, non icone.
 */
const FORBIDDEN_GLYPHS = [
  "🟢", "🔴", "✓", "✗", "✖", "✔", "⚠", "●", "🌐", "💬",
  "🚫", "🎯", "☀️", "☀", "🌙", "🇮🇹", "🇬🇧", "🇩🇪", "🇫🇷", "🇪🇸",
];

test("icon registry: esiste, è client e usa entrambe le famiglie", () => {
  const src = read(REGISTRY);
  assert.match(src, /"use client"/);
  assert.match(src, /from "@phosphor-icons\/react\//);
  assert.match(src, /from "@tabler\/icons-react"/);
  assert.match(src, /export const icons = \{/);
  assert.match(src, /export type IconName = keyof typeof icons;/);
  assert.match(src, /export function UiIcon\(/);
});

test("icon registry: le icone sono aria-hidden, il significato sta nel testo", () => {
  const src = read(REGISTRY);
  assert.match(src, /aria-hidden/);
});

test("icon registry: le UI admin non usano più glifi emoji come icone", () => {
  for (const f of ADMIN_UI_FILES) {
    const src = read(f);
    assert.match(
      src,
      /from "@\/components\/icon-registry"/,
      `${f} deve importare il registry`,
    );
    for (const glyph of FORBIDDEN_GLYPHS) {
      assert.ok(!src.includes(glyph), `${f} contiene ancora il glifo ${JSON.stringify(glyph)}`);
    }
  }
});

/** Cammina l'albero (src/app/admin, src/components, src/app/setup). */
function* walk(dir) {
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const res = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(res);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) yield res;
  }
}

test("icon registry: Phosphor e Tabler si importano SOLO nel registry", () => {
  const offenders = [];
  for (const dir of ["src/app/admin", "src/components", "src/app/setup"]) {
    for (const f of walk(dir)) {
      if (f === REGISTRY) continue;
      if (/"@phosphor-icons\/react"|"@tabler\/icons-react"/.test(read(f))) offenders.push(f);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Questi file importano le famiglie direttamente (devono passare da UiIcon): ${offenders.join(", ")}`,
  );
});
