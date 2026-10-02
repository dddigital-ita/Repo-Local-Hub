/**
 * Test della guard della porta E2E (scripts/e2e-port-guard.mjs): la seconda
 * difesa contro la porta contesa col repo gemello (la prima è la porta
 * derivata dal percorso).
 *
 * I due percorsi decisionali sono provati con PROCESSI REALI, non mock:
 *   - «nostro»: un listener con cwd = root del repo → la guard PASSA;
 *   - «estraneo»: un listener con cwd = tmpdir (fuori dal repo) → la guard
 *     LANCIA, con pid e rimedio nel messaggio.
 * È la stessa scena che ha generato il bug reale: un server di un altro
 * progetto sulla nostra porta, riusato ciecamente da reuseExistingServer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import runPortGuard, { portaDaConfig } from "../scripts/e2e-port-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Avvia un listener HTTP reale su una porta effimera e ne restituisce la
 * porta (il figlio la stampa appena ascolta). `cwd` decide il verdetto della
 * guard: root del repo = «nostro», tmpdir = «estraneo».
 */
function avviaListener(cwd) {
  const script =
    "const s=require('http').createServer((q,r)=>r.end('ok'));" +
    "s.listen(0,'127.0.0.1',()=>console.log('PORTA='+s.address().port))";
  const proc = spawn(process.execPath, ["-e", script], { cwd, stdio: ["ignore", "pipe", "inherit"] });
  const porta = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("listener non pronto in 5s")), 5_000);
    proc.stdout.on("data", (d) => {
      const m = String(d).match(/PORTA=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
  return { proc, porta };
}

/** Prima porta libera del sistema (listen(0) la assegna il kernel). */
function portaLibera() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

test("porta libera: la guard passa senza lamentarsi", async () => {
  const p = await portaLibera();
  assert.doesNotThrow(() => runPortGuard(p));
});

test("listener del NOSTRO repo (cwd = root): la guard passa", async () => {
  const { proc, porta } = avviaListener(ROOT);
  try {
    const p = await porta;
    assert.doesNotThrow(() => runPortGuard(p));
  } finally {
    proc.kill("SIGKILL");
    await once(proc, "exit").catch(() => {});
  }
});

test("listener ESTRAENO (cwd = tmpdir): la guard lancia con pid e rimedio", async () => {
  const { proc, porta } = avviaListener(os.tmpdir());
  try {
    const p = await porta;
    assert.throws(() => runPortGuard(p), (err) => {
      assert.match(err.message, /FUORI da questo repo/);
      assert.match(err.message, new RegExp(`pid ${proc.pid}`));
      assert.match(err.message, /xargs kill/); // il rimedio è nel messaggio
      return true;
    });
  } finally {
    proc.kill("SIGKILL");
    await once(proc, "exit").catch(() => {});
  }
});

test("portaDaConfig: webServer.url, use.baseURL e default https/assente", () => {
  assert.equal(portaDaConfig({ webServer: { url: "http://localhost:3135" } }), 3135);
  assert.equal(portaDaConfig({ use: { baseURL: "http://localhost:3135" } }), 3135);
  assert.equal(portaDaConfig({ use: { baseURL: "https://esempio.it" } }), 443);
  assert.equal(portaDaConfig({}), null);
  assert.equal(portaDaConfig(null), null);
});

test("CLI: exit 0 su porta libera, exit 1 con estraneo (messaggio su stderr)", async () => {
  const p = await portaLibera();
  const libera = spawn(process.execPath, ["scripts/e2e-port-guard-cli.mjs", String(p)], { cwd: ROOT });
  const [codiceLibera, outLibera] = await once(libera, "close").then(([c]) => [c, ""]);
  assert.equal(codiceLibera, 0, `attesa exit 0 su porta libera, output: ${outLibera}`);

  const { proc, porta } = avviaListener(os.tmpdir());
  try {
    const estranea = spawn(process.execPath, ["scripts/e2e-port-guard-cli.mjs", String(await porta)], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    estranea.stderr.on("data", (d) => (stderr += d));
    const [codice] = await once(estranea, "close");
    assert.equal(codice, 1, "attesa exit 1 con processo estraneo");
    assert.match(stderr, /FUORI da questo repo/);
  } finally {
    proc.kill("SIGKILL");
    await once(proc, "exit").catch(() => {});
  }
});
