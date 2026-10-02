// Porta E2E UNICA per repo — modulo CJS NATIVO: viene richiesto dal config di
// Playwright (che traspira i .ts/.mjs della sua catena d'import, rompendo gli
// ESM veri) e dai test. Un .cjs non passa mai dal transpiler: una sola
// implementazione, zero derive. FILE GESTITO DA twin-sync (twin-sync.json):
// modificare solo qui nel repo sorgente e sincronizzare.
//
// 3110 + sha1 del percorso assoluto, modulo 80 → banda 3110–3189, sotto il
// dev diurno e lontana dalla vecchia 3100 condivisa coi repo gemelli.
// Lo stesso percorso dà SEMPRE la stessa porta (webServer e spec concordano
// run dopo run); percorsi diversi danno porte (quasi sempre) diverse: due
// repo gemelli con lo stesso stack copiato non si scontrano più.
//
// twin-sync: per-repo BEGIN (override env e porta dev: ogni repo il suo
// ambiente — la formula resta identica, le costanti no)
// Override esplicito qui (WebAgencyCrema): E2E_PORT vince sulla derivazione;
// il dev diurno ascolta sulla 3200, mai toccata dalla banda E2E.
// twin-sync: per-repo END — questa riga la aggiorna scripts/twin-sync.mjs

const { createHash } = require("node:crypto");
const path = require("node:path");

function portaE2ERepo(root = process.cwd()) {
  const assoluto = path.resolve(root);
  const h = createHash("sha1").update(assoluto).digest().readUInt32BE(0);
  return 3110 + (h % 80);
}

module.exports = { portaE2ERepo };
