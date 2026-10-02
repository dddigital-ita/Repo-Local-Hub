import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Sentinella del REGISTRO DELLE INTEGRAZIONI: defs ↔ reader ↔
 * palette ⌘K, stessa ricetta di channel-registry. Se qualcuno
 * aggiunge una def senza reader, un reader senza def, o toglie
 * lo spread che popola la palette, la suite rompe qui prima
 * che l'hub Impostazioni mostri un'integrazione muta.
 *
 * GEMELLO-PARI (byte-identica nei due repo, nel manifest
 * twin-sync): il registry è logica condivisa (strumenti, non
 * contenuti né pagine). Le DEF sono identiche per contratto:
 * quando il gemello è raggiungibile, il test tiene onesta la
 * copia byte-identica — divergenza = fail, aggiornare in
 * coppia (twin-sync --apply è lo strumento per portarle pari).
 */

const ROOT = process.cwd();
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");
const TWIN_NAME = JSON.parse(read("twin-sync.json"))["twin-name"];
const gemelloPresente = existsSync(path.join(path.dirname(ROOT), TWIN_NAME, "package.json"));

// Il registry è puro (solo lucide-react): node lo importa diretto.
const { INTEGRATION_DEFS, integrationDestinations } = await import(
  path.join(ROOT, "src", "lib", "integrations-registry.ts")
);
const statusSrc = read("src", "lib", "integrations-status.ts");
const destinationsSrc = read("src", "lib", "admin-destinations.ts");

/**
 * Def INTENTAMENTE senza reader (stato neutro «Presente»):
 * dichiarare qui, in coppia nei due repo, quando si aggiunge
 * una def muta per contratto. Vuoto: ogni integrazione ha il
 * suo badge dettagliato — una def muta non dichiarata è un
 * errore, non una scorciatoia.
 */
const READERLESS = [];

/** Chiavi del map READERS di integrations-status (blocco piatto, no nested). */
function readerKeys() {
  const at = statusSrc.indexOf("const READERS");
  assert.ok(at !== -1, "manca const READERS in integrations-status.ts");
  const block = statusSrc.slice(statusSrc.indexOf("{", at) + 1, statusSrc.indexOf("}", at));
  return [...block.matchAll(/^\s*([A-Za-z0-9_$]+)\s*:/gm)].map((m) => m[1]);
}

test("registry: ogni def ha forma completa, chiave univoca, href /admin", () => {
  const keys = new Set();
  for (const def of INTEGRATION_DEFS) {
    for (const campo of ["key", "href", "label", "Icon", "tone", "text", "keywords"]) {
      assert.ok(def[campo] !== undefined, `def ${def.key ?? "?"} manca del campo «${campo}»`);
    }
    assert.ok(!keys.has(def.key), `chiave duplicata nel registry: ${def.key}`);
    keys.add(def.key);
    assert.ok(def.href.startsWith("/admin/"), `def ${def.key}: href deve stare sotto /admin/`);
  }
  assert.ok(INTEGRATION_DEFS.length > 0, "registry vuoto");
});

test("registry: ogni def ha il suo reader in integrations-status (READERS)", () => {
  const readers = readerKeys();
  for (const def of INTEGRATION_DEFS) {
    assert.ok(
      readers.includes(def.key) || READERLESS.includes(def.key),
      `def «${def.key}» senza reader in READERS (e non in READERLESS): l'hub mostrerà «Presente» per sempre`,
    );
  }
});

test("registry: nessun reader orfano (chiave READERS senza def)", () => {
  const keys = new Set(INTEGRATION_DEFS.map((d) => d.key));
  for (const r of readerKeys()) {
    assert.ok(keys.has(r), `reader «${r}» senza def nel registry: rimuoverlo o aggiungere la def`);
  }
});

test("palette ⌘K: integrationDestinations copre TUTTE le def (stessi href e label)", () => {
  const dest = integrationDestinations();
  assert.equal(dest.length, INTEGRATION_DEFS.length, "le destinazioni devono essere esattamente le def");
  for (const def of INTEGRATION_DEFS) {
    const d = dest.find((x) => x.href === def.href);
    assert.ok(d, `def «${def.key}» assente da integrationDestinations()`);
    assert.equal(d.label, def.label, `def «${def.key}»: label della destinazione diversa dalla def`);
    assert.equal(d.group, "Integrazioni", `def «${def.key}»: destinazione fuori dal gruppo Integrazioni`);
  }
});

test("palette ⌘K: admin-destinations popola dal registro (spread, mai lista manuale)", () => {
  assert.match(
    destinationsSrc,
    /\.\.\.integrationDestinations\(\)/,
    "admin-destinations.ts deve includere ...integrationDestinations(): una nuova def arriva in palette da sola",
  );
});

test("il registry resta gemello-pari (logica condivisa: si aggiorna in coppia)", { skip: gemelloPresente ? false : "checkout gemello non raggiungibile" }, () => {
  const rel = "src/lib/integrations-registry.ts";
  assert.equal(
    read(rel),
    readFileSync(path.join(path.dirname(ROOT), TWIN_NAME, rel), "utf8"),
    `DIVERGE: ${rel} — il registry è logica condivisa non ancora nel manifest: aggiornarlo in coppia, o portarlo in twin-sync.json`,
  );
});
