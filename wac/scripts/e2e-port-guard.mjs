// E2E PORT GUARD — la porta E2E deve parlare il NOSTRO ambiente, non quello
// di un progetto sorella.
//
// reuseExistingServer (!CI) decide dal solo health check HTTP: se sulla porta
// risponde un qualunque server, Playwright lo riusa ciecamente — anche se è
// il server E2E di un altro repo, con il SUO .env.e2e e il SUO database.
// Caso reale (30/09/2026, gemello «WebAgencyCrema»): stessa porta 3100 e
// stesso stack copiato — i loro login fallivano con «Credenziali non valide»
// perché il server che rispondeva guardava was_e2e (il NOSTRO DB) invece di
// wac_e2e; e le nostre run morivano a metà per SIGTERM di chi considerava
// la porta sua. Da quel giorno la porta è UNICA PER REPO (scripts/e2e-port.cjs,
// twin-sync: per-repo BEGIN
// qui 3135) e questo guard è la seconda difesa indipendente.
// twin-sync: per-repo END
//
// Gira in globalSetup (DOPO l'avvio/riuso del webServer, PRIMA del primo
// test): ispeziona i processi in LISTEN sulla porta e fallisce la run subito
// se il loro cwd è fuori da questo repo, col pid e il rimedio. Il nostro
// webServer ha cwd = root del repo (Playwright lancia il comando da qui).
//
// Modalità: default export per Playwright (throw = run fallita); CLI con
// scripts/e2e-port-guard-cli.mjs (exit 1 = processo estraneo).
//
// NOTA: il file è IMPORTATO da playwright.config.ts, che compila la sua
// catena d'import come CJS — qui non può esserci import.meta. Per la riga
// di comando c'è il wrapper CLI, eseguito da Node come ESM vero.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { portaE2ERepo } from "./e2e-port.cjs";
import { acquisisciLock } from "./e2e-lock.mjs";

export { portaE2ERepo };

/** Pid dei processi in LISTEN sulla porta (lsof; vuoto = porta libera). */
function pidInAscolto(porta) {
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${porta}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // lsof exit 1 = nessun processo: porta libera
  }
}

/** cwd di un pid (lsof -p N; null se non leggibile). */
function cwdDi(pid) {
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const n = out.split("\n").find((l) => l.startsWith("n/"));
    return n ? n.slice(1) : null;
  } catch {
    return null;
  }
}

/** Porta letta dal config risolto (webServer.url → use.baseURL; default 80/443). */
export function portaDaConfig(config) {
  const url = config?.webServer?.url ?? config?.use?.baseURL;
  if (!url) return null;
  try {
    return Number(new URL(url).port) || (url.startsWith("https:") ? 443 : 80);
  } catch {
    return null;
  }
}

/**
 * Playwright passa il config risolto al globalSetup: da lì la porta che il
 * webServer USA DAVVERO (webServer.url). Accetto anche un numero diretto
 * (per i test e la CLI); in mancanza, la porta derivata dal percorso.
 * Mai usare l'argomento tal quale: diventerebbe «[object Object]».
 */
export default function runPortGuard(configOrPort, opzioni = {}) {
  const porta =
    typeof configOrPort === "number" && Number.isFinite(configOrPort)
      ? configOrPort
      : (typeof configOrPort === "object" && configOrPort && portaDaConfig(configOrPort)) ||
        Number(process.env.WAC_E2E_PORT ?? portaE2ERepo());
  // IL LOCK prima di ogni altra cosa: se un'altra run (di questo o di un
  // altro repo) è viva sulla porta/DB, questa si rifiuta di partire —
  // subito, col pid e il rimedio. Self-healing sui lock stantii, avviso
  // sui server orfani riusati (e2e-lock.mjs per il meccanismo).
  // SOLO nel percorso Playwright: la CLI diagnostica passa { lock: false }
  // — una verifica a mano non deve acquisire un lock che poi non rilascia
  // (lezione del 01/10: i lock stantii trovati dal self-healing erano
  // proprio quelli della CLI).
  if (opzioni.lock !== false) acquisisciLock(porta);
  const pids = pidInAscolto(porta);
  if (pids.length === 0) return; // porta libera: il webServer la occupa da solo

  const root = path.resolve();
  const estranei = pids
    .map((pid) => ({ pid, cwd: cwdDi(pid) }))
    // cwd === root: il webServer lanciato dalla root del repo (il caso
    // normale) — dentro il repo anche ogni sotto-percorso.
    .filter(({ cwd }) => cwd == null || !(cwd === root || cwd.startsWith(root + path.sep)));

  if (estranei.length === 0) return; // nostri processi: riuso lecito

  const dettagli = estranei
    .map(({ pid, cwd }) => `  - pid ${pid} — cwd: ${cwd ?? "non leggibile (probabile progetto diverso)"}`)
    .join("\n");
  throw new Error(
    `e2e-port-guard: sulla porta ${porta} ascolta un processo FUORI da questo repo:\n` +
      `${dettagli}\n` +
      `reuseExistingServer lo riuserebbe col SUO ambiente (.env.e2e = altro database,\n` +
      `altro progetto): l'E2E girerebbe contro lo stato sbagliato. Rimedio:\n` +
      `  lsof -ti :${porta} | xargs kill   # poi rilancia: il webServer usa la porta derivata (${portaE2ERepo()})`,
  );
}
