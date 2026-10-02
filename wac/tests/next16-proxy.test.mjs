import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

// Convenzione Next 16 (Passo 2/3 del piano): proxy.ts sostituisce middleware.ts
// e il runtime Edge dichiarato esplicitamente è deprecato. Se qualcuno riporta
// la vecchia convenzione, la suite rompe prima della build.

test("la convenzione proxy (Next 16) sostituisce middleware", () => {
  assert.ok(existsSync(path.join(SRC, "proxy.ts")), "manca src/proxy.ts");
  assert.ok(!existsSync(path.join(SRC, "middleware.ts")), "src/middleware.ts è deprecata in 16: usare proxy.ts");
  const proxy = readFileSync(path.join(SRC, "proxy.ts"), "utf8");
  assert.match(proxy, /export async function proxy\(/, "proxy.ts deve esportare la funzione proxy");
  assert.ok(!/export async function middleware\(/.test(proxy), "export middleware non ammesso");
  assert.match(proxy, /matcher:/, "il matcher del proxy deve restare esplicito");
});

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("nessuna rotta dichiara runtime edge (deprecato in 16, disabilita la static generation)", () => {
  const offenders = tsFiles(SRC).filter((f) =>
    /export const runtime = "edge"/.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(offenders, [], `runtime edge dichiarato in: ${offenders.join(", ")}`);
});
