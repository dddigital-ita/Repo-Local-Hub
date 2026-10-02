import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { acquisisciLock, rilasciaLock, statoLock, leggiLock, percorsoLock } from "../scripts/e2e-lock.mjs";

/**
 * Sentinella del LOCK E2E: una sola run per volta sul DB condiviso del
 * repo (caso reale 01/10/2026: due agenti attivi, tre run intrecciate su
 * wac_e2e — reset a metà, leak-guard urla falsi). Il lock vive in /tmp
 * chiave sulla porta: qui si usa la porta reale del repo ma con file
 * dedicati ai test, per non toccare il lock di una run vera in corso.
 */

const PORTA_TEST = 1; // la porta entra solo nel NOME del file: serve unica per processo di test
const FILE = percorsoLock(PORTA_TEST);

function pulisci() {
  if (existsSync(FILE)) unlinkSync(FILE);
}

/** Run figlia: acquisisce il lock e resta viva (o esce col messaggio d'errore). */
function figliaAcquire(attesaMs = 15000) {
  const codice = `
    import { acquisisciLock } from ${JSON.stringify(new URL("../scripts/e2e-lock.mjs", import.meta.url).href)};
    import { setTimeout as dormi } from "node:timers/promises";
    try {
      acquisisciLock(${PORTA_TEST});
      await dormi(${attesaMs});
    } catch (e) {
      console.error(e.message);
      process.exit(3);
    }
  `;
  return spawn(process.execPath, ["--input-type=module", "-e", codice], { stdio: ["ignore", "pipe", "pipe"] });
}

test("acquisizione: il lock esiste, contiene pid e repo, e lo stato dice OCCUPATO", () => {
  pulisci();
  acquisisciLock(PORTA_TEST);
  const lock = leggiLock(PORTA_TEST);
  assert.equal(lock.porta, PORTA_TEST);
  assert.equal(lock.pid, process.pid);
  assert.ok(lock.repo.length > 0);
  assert.match(statoLock(PORTA_TEST), /^OCCUPATO/);
});

test("rifiuto: una seconda acquire con una run viva esce con pid e rimedio", async () => {
  pulisci();
  const figlia = figliaAcquire();
  // Attende che la figlia scriva il suo lock.
  for (let i = 0; i < 40 && !existsSync(FILE); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(existsSync(FILE), "la figlia non ha acquisito il lock");

  let messaggio = "";
  try {
    acquisisciLock(PORTA_TEST);
    assert.fail("la seconda acquire doveva essere rifiutata");
  } catch (e) {
    messaggio = e.message;
  }
  assert.match(messaggio, /e2e-lock: la porta 1 .* occupata/);
  assert.match(messaggio, /pid \d+/);
  assert.match(messaggio, /e2e-lock-cli/);

  figlia.kill("SIGKILL");
  await new Promise((r) => figlia.on("exit", r));
  pulisci();
});

test("self-healing: un lock con pid morto viene rimosso e l acquire procede", () => {
  pulisci();
  writeFileSync(FILE, JSON.stringify({ porta: PORTA_TEST, repo: "qualunque", pid: 2147483000, avviata: new Date(0).toISOString(), host: "test" }));
  assert.match(statoLock(PORTA_TEST), /^STANTIO/);
  acquisisciLock(PORTA_TEST); // non deve lanciare: rimuove lo stantio e riacquisisce
  assert.equal(leggiLock(PORTA_TEST).pid, process.pid);
  pulisci();
});

test("lock corrotto: trattato come assente, l acquire riscrive", () => {
  pulisci();
  writeFileSync(FILE, "{json rotto");
  acquisisciLock(PORTA_TEST);
  assert.equal(leggiLock(PORTA_TEST).pid, process.pid);
  pulisci();
});

test("rilascio selettivo: il lock di un altro repo non viene toccato", () => {
  pulisci();
  // Un lock «di un altro repo» con pid morto (il rilascio guarda il repo, non il pid).
  writeFileSync(FILE, JSON.stringify({ porta: PORTA_TEST, repo: "altro-repo-immaginario", pid: 2147483001, avviata: new Date().toISOString(), host: "test" }));
  const avvisi = [];
  const origWarn = console.warn;
  console.warn = (m) => avvisi.push(String(m));
  try {
    rilasciaLock(PORTA_TEST);
  } finally {
    console.warn = origWarn;
  }
  assert.ok(existsSync(FILE), "il lock di un altro repo non deve essere rimosso");
  assert.ok(avvisi.some((m) => m.includes("altro-repo-immaginario")));
  // E il self-healing della prossima run lo curerà (pid morto).
  acquisisciLock(PORTA_TEST);
  assert.equal(leggiLock(PORTA_TEST).pid, process.pid);
  pulisci();
});

test("rilascio del proprio repo: il file sparisce anche se pid nel lock è diverso", () => {
  pulisci();
  // Caso reale: teardown è un processo diverso dall acquire (globalSetup).
  writeFileSync(FILE, JSON.stringify({ porta: PORTA_TEST, repo: process.cwd().split("/").pop(), pid: 2147483002, avviata: new Date().toISOString(), host: "test" }));
  rilasciaLock(PORTA_TEST);
  assert.ok(!existsSync(FILE), "il lock del proprio repo deve essere rilasciato");
});

test("idempotenza: rilasciare senza lock è un no-op silenzioso", () => {
  pulisci();
  rilasciaLock(PORTA_TEST);
  assert.ok(!existsSync(FILE));
});
