import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Sentinella del TWIN-SYNC: i file del manifest (funzioni e strumenti
 * condivisi per contratto) devono coincidere tra i repo gemelli — fuori
 * dai blocchi «twin-sync: per-repo», che sono gestiti per-repo (ogni repo
 * le sue costanti d'ambiente). Il drift del "clients-shared" (203 righe:
 * il gemello senza client-type, noi senza il budget «k») è esattamente
 * ciò che questa sentinella rende impossibile d'ora in poi.
 *
 * Se il checkout gemello non è raggiungibile, il test salta con motivo:
 * la suite non deve fallire solo perché i due checkout non sono sullo
 * stesso disco — il twin-sync esplicito resta la fonte.
 */

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(ROOT, "twin-sync.json"), "utf8"));

const TWIN_ROOT = path.join(path.dirname(ROOT), manifest["twin-name"]);
const gemelloPresente = existsSync(path.join(TWIN_ROOT, "package.json"));

test("il manifest twin-sync è ben formato e con perimetro rispettato", () => {
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "manca la lista file");
  for (const f of manifest.files) {
    assert.ok(!f.startsWith("src/app/"), `fuori perimetro: ${f} (pagine/route mai condivise)`);
    assert.ok(!/admin/i.test(f), `fuori perimetro: ${f} (file admin mai condivisi)`);
    assert.ok(existsSync(path.join(ROOT, f)), `il file non esiste nel repo: ${f}`);
  }
  assert.equal(manifest["source-repo"], "WebAgencyCrema");
});

test("i file condivisi coincidono con il gemello (fuori dai blocchi per-repo)", { skip: gemelloPresente ? false : "checkout gemello non raggiungibile" }, () => {
  const { segmentiPerRepo } = moduliDiSync();

  for (const rel of manifest.files) {
    const nostro = readFileSync(path.join(ROOT, rel), "utf8");
    const loro = readFileSync(path.join(TWIN_ROOT, rel), "utf8");
    const fuoriA = segmentiPerRepo(nostro);
    const fuoriB = segmentiPerRepo(loro);
    assert.equal(
      fuoriA,
      fuoriB,
      `DIVERGE: ${rel} — eseguire «node scripts/twin-sync.mjs» nel repo sorgente e sincronizzare`,
    );
  }
});

/** Import pigro del motore di sync (evita duplicare la logica dei blocchi). */
function moduliDiSync() {
  // scripts/twin-sync.mjs è un eseguibile, non un modulo: la logica dei
  // blocchi è replicata qui in 6 righe — la sentinella deve restare vera
  // anche se un giorno lo script cambia interfaccia.
  const segmentiPerRepo = (testo) =>
    testo
      .replace(/^\/\/ twin-sync: per-repo BEGIN[\s\S]*?^\/\/ twin-sync: per-repo END.*$\n?/gm, "")
      .trim();
  return { segmentiPerRepo };
}
