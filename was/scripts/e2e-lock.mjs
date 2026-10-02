// E2E LOCK — UNA SOLA RUN per volta sul DB E2E condiviso di questo repo.
//
// La porta E2E è unica per repo (scripts/e2e-port.cjs) e il suo DB è lo
// stesso per tutta la suite: due run in parallelo sullo stesso repo (o
// l'intreccio con una run del gemello su porte/DB diversi) si contendono
// il DB — reset a metà di qualcuno, seed spariscono, leak-guard urla
// falsi positivi (caso reale 01/10/2026: due agenti attivi sul gemello,
// tre run intrecciate su wac_e2e). Questo lock è il semaforo:
//
//   - il globalSetup (e2e-port-guard) ACQUISISCE il lock prima dei test:
//     se un'altra run è viva, questa si rifiuta di partire — subito, col
//     pid e il rimedio, non a metà suite;
//   - il globalTeardown (e2e-leak-guard) RILASCIA in finally, anche quando
//     il leak-guard fallisce;
//   - se una run muore male (lock rimasto, pid non esiste più) il lock è
//     STANTIO: l'acquire successivo lo rimuove e procede — niente sblocco
//     manuale;
//   - i server E2E orfani (il wrapper sopravvive alla fine della run e
//     tiene la porta: caso 02/10) vengono RILEVATI: l'acquire avvisa col
//     pid, senza killarli — Playwright potrebbe starli riusando.
//
// Il lock vive in /tmp chiave sulla porta (porta ↔ DB è 1:1 per repo):
//   /tmp/wac-e2e-lock-<porta>.json
//
// Stato a mano: node scripts/e2e-lock-cli.mjs [porta]
//
// NOTA: importato da e2e-port-guard.mjs (catena compilata come CJS da
// playwright.config.ts): qui niente import.meta.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { portaE2ERepo } from "./e2e-port.cjs";

export { portaE2ERepo };

export function percorsoLock(porta) {
  return `/tmp/wac-e2e-lock-${porta}.json`;
}

/** Il pid esiste (segnale 0 = nessun segnale, solo sondaggio). */
function pidVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Lock letto dal file (null se assente o corrotto: un lock illeggibile è come assente, l'acquire lo riscrive). */
export function leggiLock(porta) {
  const file = percorsoLock(porta);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function repoDi(cwd) {
  return path.basename(path.resolve(cwd ?? process.cwd()));
}

/** cwd di un pid (stessa tecnica del port-guard; null se non leggibile). */
function cwdDi(pid) {
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const n = out.split("\n").find((l) => l.startsWith("n/"));
    return n ? n.slice(1) : null;
  } catch {
    return null;
  }
}

/** Pid in LISTEN sulla porta (lsof; vuoto = porta libera). */
function pidInAscolto(porta) {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${porta}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Acquisisce il lock per la porta (default: derivata dal percorso) o esce
 * con errore chiaro se un'altra run è viva. Self-healing sui lock stantii,
 * avviso sui server orfani del repo. Idempotente di fatto: la run che
 * detiene il lock può rilanciarlo senza autocandidarsi (il pid vivo del
 * lock è però un rifiuto, anche se stesso repo: DUE run non devono
 * coesistere anche se shareno il pid? no: due run hanno pid diversi).
 */
export function acquisisciLock(
  porta = Number(process.env.WAC_E2E_PORT ?? portaE2ERepo()),
  opzioni = {},
) {
  const repo = repoDi(opzioni.cwd);
  const esistente = leggiLock(porta);

  if (esistente && esistente.pid !== process.pid && pidVivo(esistente.pid)) {
    const diChi =
      esistente.repo === repo
        ? "una run di QUESTO repo"
        : `una run di «${esistente.repo}» (altro repo sulla stessa porta: controllare scripts/e2e-port.cjs)`;
    throw new Error(
      `e2e-lock: la porta ${porta} (e il suo DB E2E) è occupata da ${diChi}:\n` +
        `  - pid ${esistente.pid}, avviata ${esistente.avviata} su ${esistente.host}\n` +
        `Aspetta la fine di quella run, oppure se è rimasta appesa:\n` +
        `  kill ${esistente.pid}\n` +
        `Stato: node scripts/e2e-lock-cli.mjs ${porta}`,
    );
  }

  if (esistente) {
    const motivo =
      esistente.pid === process.pid
        ? "è di questa stessa run (acquisizione ripetuta)"
        : `il pid ${esistente.pid} non esiste più (run del ${esistente.avviata} terminata male)`;
    console.warn(`⚠ e2e-lock: lock stantio rimosso (${motivo})`);
    unlinkSync(percorsoLock(porta));
  }

  // Server orfani: RILEVATI, non killati (il riuso di Playwright è lecito
  // e un server tiepido funziona; ma la run deve sapere di non essere
  // l'unica cosa viva sulla porta).
  for (const pid of pidInAscolto(porta)) {
    const cwd = cwdDi(pid);
    if (cwd && (cwd === path.resolve(opzioni.cwd ?? process.cwd()) || cwd.startsWith(path.resolve(opzioni.cwd ?? process.cwd()) + path.sep))) {
      console.warn(
        `⚠ e2e-lock: server E2E orfano riusato (pid ${pid}, cwd ${cwd}) — è ` +
          `sopravvissuto alla sua run. Funziona, ma per ripartire pulito:\n` +
          `  kill ${pid}   # il webServer di questa run userà la porta da solo`,
      );
    }
  }

  // Scrittura atomica (tmp + rename): due acquire simultanee non si
  // mescolano nel file.
  const tmp = `${percorsoLock(porta)}.tmp-${process.pid}`;
  writeFileSync(
    tmp,
    JSON.stringify(
      { porta, repo, pid: process.pid, avviata: new Date().toISOString(), host: os.hostname() },
      null,
      2,
    ) + "\n",
  );
  renameSync(tmp, percorsoLock(porta));
}

/**
 * Rilascia il lock SE è del nostro repo (il teardown è un processo diverso
 * dall'acquire: conta il repo, non il pid). Il lock di un altro repo non
 * viene toccato: è la loro run, puliranno (o lo farà il self-healing).
 */
export function rilasciaLock(
  porta = Number(process.env.WAC_E2E_PORT ?? portaE2ERepo()),
  opzioni = {},
) {
  const lock = leggiLock(porta);
  if (!lock) return;
  if (lock.repo !== repoDi(opzioni.cwd)) {
    console.warn(`⚠ e2e-lock: il lock della porta ${porta} appartiene a «${lock.repo}» — non lo tocco.`);
    return;
  }
  unlinkSync(percorsoLock(porta));
}

/** Descrizione umana dello stato (per la CLI). */
export function statoLock(porta = Number(process.env.WAC_E2E_PORT ?? portaE2ERepo())) {
  const lock = leggiLock(porta);
  if (!lock) {
    const ascolto = pidInAscolto(porta);
    if (ascolto.length === 0) return `LIBERO — porta ${porta} senza lock e senza listener`;
    return `LIBERO (nessuna run) ma sulla porta ${porta} ascolta: ${ascolto.join(", ")} — possibile orfano`;
  }
  if (pidVivo(lock.pid)) {
    const da = Math.round((Date.now() - new Date(lock.avviata).getTime()) / 1000);
    return `OCCUPATO — run di «${lock.repo}», pid ${lock.pid}, attiva da ${da}s (porta ${porta})`;
  }
  return `STANTIO — lock di «${lock.repo}» (pid ${lock.pid} morto): la prossima run lo rimuoverà da sola`;
}
