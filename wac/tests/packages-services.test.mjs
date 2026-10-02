/**
 * TEST CATALOGO SERVIZI — Ambrosio vende servizi oltre ai pacchetti
 * (migration 035: colonna kind su packages). Le funzioni pure del layer
 * (packagesPromptBlock) si eseguono davvero; le decisioni della migration
 * si verificano leggendo il file, come da convenzione del repo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

// Le parti PURE vivono in packages-shared: importabili da Node senza il
// layer pg (stessa disciplina di ab-shared/hero-shared nel repo).
const sharedSrc = readFileSync(path.join(ROOT, "src", "lib", "packages-shared.ts"), "utf8");
const { packagesPromptBlock } = await import(path.join(ROOT, "src", "lib", "packages-shared.ts"));
const migration = readFileSync(path.join(ROOT, "neon", "migrations", "035-service-kind.sql"), "utf8");
const layerSrc = readFileSync(path.join(ROOT, "src", "lib", "packages.ts"), "utf8");
const actionsSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "actions.ts"), "utf8");

const PACCHETTO = {
  id: "p1",
  name: "Sito Vetrina",
  tagline: "Il biglietto da visita",
  price_text: "da 800 €",
  includes: ["5 pagine"],
  sort_order: 10,
  active: true,
  kind: "package",
};
const SERVIZIO = {
  id: "s1",
  name: "Servizio Fotografico",
  tagline: "Le foto giuste",
  price_text: "da 350 €",
  includes: ["30 foto"],
  sort_order: 20,
  active: true,
  kind: "service",
};

test("il prompt distingue i due cataloghi: sezioni PACCHETTI e SERVIZI separate", () => {
  const block = packagesPromptBlock([PACCHETTO, SERVIZIO]);
  assert.match(block, /PACCHETTI DA PROPORRE/);
  assert.match(block, /SERVIZI DA PROPORRE/);
  assert.ok(block.indexOf("PACCHETTI") < block.indexOf("SERVIZI"), "prima i pacchetti, poi i servizi");
  assert.match(block, /Sito Vetrina/);
  assert.match(block, /Servizio Fotografico/);
});

test("il blocco SERVIZI dice ad Ambrosio QUANDO proporli (attività, non preventivo)", () => {
  const block = packagesPromptBlock([SERVIZIO]);
  assert.match(block, /SERVIZI DA PROPORRE/);
  assert.doesNotMatch(block, /PACCHETTI DA PROPORRE/, "solo servizi: niente sezione pacchetti vuota");
  assert.match(block, /attività professionali/);
  assert.match(block, /preventivo di costruzione/, "la regola distingue il caso d'uso");
});

test("regressione: il blocco PACCHETTI resta nel formato atteso (match esatto anti-cambimenti accidentali)", () => {
  const block = packagesPromptBlock([PACCHETTO]);
  assert.match(block, /\n\nPACCHETTI DA PROPORRE \(aggiornati dall'agenzia; proponili quando il cliente valuta un preventivo sito, uno o due al massimo, adatti al bisogno espresso; cita il NOME ESATTO del pacchetto e il suo prezzo, senza inventare cifre\):\n- Sito Vetrina — da 800 € \(include: 5 pagine\)\. Il biglietto da visita/);
  assert.doesNotMatch(block, /SERVIZI/);
});

test("lista vuota → blocco vuoto (niente rumore nel prompt)", () => {
  assert.equal(packagesPromptBlock([]), "");
});

test("kind corrotto ricade su package: il dato sporco non buca il catalogo", () => {
  const block = packagesPromptBlock([{ ...SERVIZIO, kind: "foto" }]);
  assert.doesNotMatch(block, /SERVIZI DA PROPORRE/);
  assert.match(block, /PACCHETTI DA PROPORRE/);
});

test("migration 035: additiva, idempotente, seed guardito (mai su archivi in uso)", () => {
  assert.match(migration, /add column if not exists kind text not null default 'package'/);
  assert.match(migration, /packages_kind_check/, "manca il vincolo di dominio");
  assert.match(migration, /check \(kind in \('package', 'service'\)\)/);
  assert.match(migration, /packages_kind_idx/, "manca l'indice per le letture per catalogo");
  // Il seed entra SOLO se non esiste già un servizio: niente duplicati, mai
  // sovrascritti i dati dell'operatore.
  assert.match(migration, /where not exists \(select 1 from packages where kind = 'service'\)/);
  // I 4 servizi richiesti dall'agenzia ci sono tutti.
  for (const s of ["Servizio Fotografico", "Servizio Video", "Assistenza Tecnica", "Assistenza Tecnica SOS Web"]) {
    assert.ok(migration.includes(`'${s}'`), `manca il seed ${s}`);
  }
});

test("il layer filtra per kind e protegge le righe storiche (coalesce → package)", () => {
  assert.match(layerSrc, /coalesce\(kind, 'package'\)/);
  assert.match(layerSrc, /export async function listServices/);
  assert.match(layerSrc, /kind: CatalogKind = "package"/, "il default della firma resta pacchetto");
  // Delega: le parti pure vivono SOLO in packages-shared (niente doppioni).
  assert.match(layerSrc, /from "\.\/packages-shared"/);
  assert.doesNotMatch(layerSrc, /export function packagesPromptBlock/, "il prompt block non va duplicato nel layer");
  assert.match(sharedSrc, /export function packagesPromptBlock/);
});

test("l'action salva il kind e qualunque valore strano ricade su 'package'", () => {
  const idx = actionsSrc.indexOf("export async function savePackage");
  const block = actionsSrc.slice(idx, actionsSrc.indexOf("export async function togglePackage"));
  assert.match(block, /pkgStr\(formData, "kind", 10\) === "service" \? "service" : "package"/);
  assert.match(block, /kind=\$7/);
  assert.match(block, /insert into packages \(name, tagline, price_text, includes, sort_order, active, kind\)/);
  // La duplicazione conserva il catalogo d'appartenenza.
  const dupIdx = actionsSrc.indexOf("export async function duplicatePackage");
  assert.match(actionsSrc.slice(dupIdx, dupIdx + 500), /sort_order \+ 5, false, kind from packages where id/, "la duplicazione conserva il catalogo d'appartenenza");
});

test("wiring: la scheda admin ha le tab e la home mostra la sezione servizi", () => {
  const pageSrc = readFileSync(path.join(ROOT, "src", "app", "admin", "packages", "page.tsx"), "utf8");
  assert.match(pageSrc, /tab=servizi/);
  assert.match(pageSrc, /role="tab"/);
  assert.match(pageSrc, /Nuovo servizio/);
  const homeSrc = readFileSync(path.join(ROOT, "src", "app", "page.tsx"), "utf8");
  assert.match(homeSrc, /listPackages\(true, "service"\)/);
  assert.match(homeSrc, /Servizi che vanno oltre il sito/);
});
