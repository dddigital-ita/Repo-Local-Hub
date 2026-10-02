import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIENT_TYPES,
  clientTypePure,
  clientTypeLabelPure,
  clientsTypeTimelinePure,
  dittaSuggeritaPure,
  DITTA_SUGGERITA_MIN_CITAZIONI,
} from "../src/lib/clients-shared.ts";

/**
 * CLIENT TYPE (038) — il tipo cliente come dato del dominio, non come
 * congettura. La sentinella schema→UI tiene insieme i tre pezzi che
 * devono dire la stessa cosa:
 *   migration 038 (constraint SQL) ↔ costante tipizzata (clients-shared)
 *   ↔ opzioni della select in /admin/clients/[id].
 * Cambiare un valore in un posto solo deve ROMPERE la suite, non la UI.
 */

const MIGRATION = readFileSync("neon/migrations/038-client-type.sql", "utf8");
const DETAIL_PAGE = readFileSync("src/app/admin/clients/[id]/page.tsx", "utf8");
const LIST_PAGE = readFileSync("src/app/admin/clients/page.tsx", "utf8");

test("sentinella schema→UI: migration, costante e select dicono gli stessi valori", () => {
  // 1) La constraint SQL contiene TUTTI i valori della costante…
  for (const t of CLIENT_TYPES) {
    assert.ok(
      MIGRATION.includes(`'${t}'`),
      `migration 038 deve ammettere '${t}' nella constraint`,
    );
  }
  // …e nessun valore in più (la constraint elenca esattamente il dominio).
  const inMigration = [...MIGRATION.matchAll(/check \(client_type in \(([^)]*)\)\)/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim().replaceAll("'", "")));
  assert.deepEqual(
    [...inMigration].sort(),
    [...CLIENT_TYPES].sort(),
    "la constraint SQL deve elencare ESATTAMENTE i valori di CLIENT_TYPES",
  );

  // 2) La select della scheda offre tutti i tipi (e solo quelli, oltre a
  //    «Da classificare» = valore vuoto).
  assert.ok(
    DETAIL_PAGE.includes(`value={t}`),
    DETAIL_PAGE.includes("CLIENT_TYPES.map"),
    "la select della scheda deve generare le opzioni da CLIENT_TYPES",
  );
  assert.ok(
    !DETAIL_PAGE.includes('value="azienda"'),
    "niente valori letterali duplicati in scheda: la fonte è la costante",
  );

  // 3) La lista usa la stessa fonte per i chip e valida il parametro.
  assert.ok(
    LIST_PAGE.includes("CLIENT_TYPES.map"),
    "i chip della lista devono generarsi da CLIENT_TYPES",
  );
  assert.ok(
    LIST_PAGE.includes("clientTypePure(tipoParam)"),
    "il filtro ?tipo= deve passare dalla validazione del contratto condiviso",
  );
});

test("clientTypePure: solo i valori del dominio, tutto il resto → null", () => {
  assert.equal(clientTypePure("azienda"), "azienda");
  assert.equal(clientTypePure("  privato  "), "privato", "spazi tagliati");
  assert.equal(clientTypePure("ente_pubblico"), "ente_pubblico");
  assert.equal(clientTypePure("VIP"), null, "valore fuori dominio rifiutato");
  assert.equal(clientTypePure(""), null);
  assert.equal(clientTypePure(null), null);
  assert.equal(clientTypePure(undefined), null);
  // Un tentativo di injection via query string non diventa mai SQL.
  assert.equal(clientTypePure("azienda' or '1'='1"), null);
});

test("clientTypeLabelPure: dizionario per i noti, «Da classificare» per NULL", () => {
  assert.equal(clientTypeLabelPure("azienda"), "Azienda");
  assert.equal(clientTypeLabelPure("privato"), "Privato");
  assert.equal(clientTypeLabelPure("ente_pubblico"), "Ente pubblico");
  assert.equal(clientTypeLabelPure(null), "Da classificare");
  assert.equal(clientTypeLabelPure(undefined), "Da classificare");
  assert.equal(clientTypeLabelPure(""), "Da classificare");
  // Valore sconosciuto (es. tipo rimosso dal codice ma in DB): mostrato
  // com'è, mai nascosto — il dato esiste anche se il dizionario no.
  assert.equal(clientTypeLabelPure("cooperativa"), "cooperativa");
});

test("timeline portafoglio: cumulo mese per mese, fuori dominio ignorati, ordine crescente", () => {
  const t = clientsTypeTimelinePure([
    { mese: "2026-08", client_type: "azienda", n: 2 },
    { mese: "2026-09", client_type: "azienda", n: 1 },
    { mese: "2026-09", client_type: "privato", n: 3 },
    { mese: "2026-09", client_type: null, n: 1 },
  ]);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0], { mese: "2026-08", azienda: 2, privato: 0, ente_pubblico: 0, da_classificare: 0, totale: 2 });
  // Settembre CUMULA agosto: il portafoglio a fine mese, non le acquisitioni.
  assert.deepEqual(t[1], { mese: "2026-09", azienda: 3, privato: 3, ente_pubblico: 0, da_classificare: 1, totale: 7 });

  // I mesi devono uscire in ordine crescente qualunque sia l'ordine di arrivo.
  const t2 = clientsTypeTimelinePure([
    { mese: "2026-09", client_type: "privato", n: 1 },
    { mese: "2026-07", client_type: "ente_pubblico", n: 1 },
  ]);
  assert.deepEqual(t2.map((r) => r.mese), ["2026-07", "2026-09"]);
  assert.equal(t2[1].ente_pubblico, 1, "il cumulo attraversa i mesi senza righe");

  // Difesa: valori fuori dominio (constraint violata a mano) ignorati,
  // righe corrotte mai spostate in un altro tipo.
  const t3 = clientsTypeTimelinePure([
    { mese: "2026-09", client_type: "cooperativa", n: 99 },
    { mese: null, client_type: "azienda", n: 5 },
  ]);
  assert.deepEqual(t3, []);

  // Input vuoto/corrotto → serie vuota, mai crash.
  assert.deepEqual(clientsTypeTimelinePure([]), []);
  assert.deepEqual(clientsTypeTimelinePure(null), []);
});

test("dittaSuggeritaPure: dedup case-insensitive, rumore scartato, forza ≥2, rigetti rispettati", () => {
  // Dedup case-insensitive e somma citazioni; email/URL sono rumore da chat.
  const ok = dittaSuggeritaPure(
    [
      { company_name: "Bar Rossi", n: 2 },
      { company_name: "bar rossi", n: 1 },
      { company_name: "pippo@rossi.it", n: 5 },
      { company_name: "https://rossi.it", n: 3 },
    ],
    null,
    null,
  );
  assert.deepEqual(ok, { ditta: "Bar Rossi", citazioni: 3 });

  // Una sola citazione distinta è un dubbio, non un dato.
  assert.deepEqual(dittaSuggeritaPure([{ company_name: "Una Sola", n: 1 }], null, null), {
    ditta: null,
    citazioni: 0,
  });

  // Già in scheda (case-insensibile): nulla da proporre.
  assert.deepEqual(dittaSuggeritaPure([{ company_name: "Rossi SRL", n: 5 }], "rossi srl", null), {
    ditta: null,
    citazioni: 0,
  });

  // Il RIGETTO dell'operatore (039) spegne la proposta, case-insensibile —
  // anche quando resta una seconda candidata: quella diventa la proposta.
  const rigettata = dittaSuggeritaPure(
    [
      { company_name: "Bar Rossi", n: 4 },
      { company_name: "Rossi Gestionale", n: 2 },
    ],
    null,
    ["bar rossi"],
  );
  assert.deepEqual(rigettata, { ditta: "Rossi Gestionale", citazioni: 2 });
  assert.deepEqual(
    dittaSuggeritaPure([{ company_name: "Solo Questa", n: 9 }], null, ["solo questa"]),
    { ditta: null, citazioni: 0 },
    "rigettata = anche l'unica candidata sparisce",
  );

  // Input corrotto → nessuna proposta, mai crash.
  assert.deepEqual(dittaSuggeritaPure(null, null, null), { ditta: null, citazioni: 0 });
  assert.deepEqual(dittaSuggeritaPure("boh", "", 42), { ditta: null, citazioni: 0 });

  // Casing deterministico: a parità di citazioni vince la variante con più
  // maiuscole («Fornace E2E SRL», non «fornace e2e srl» — localeCompare da
  // sola ordinerebbe le minuscole prima). A parità di maiuscole, alfabeto.
  assert.deepEqual(
    dittaSuggeritaPure(
      [{ company_name: "fornace e2e srl", n: 1 }, { company_name: "Fornace E2E SRL", n: 1 }],
      null,
      null,
    ),
    { ditta: "Fornace E2E SRL", citazioni: 2 },
  );

  // La costante è il contratto: se qualcuno la abbassa a 1, la suite lo dice.
  assert.equal(DITTA_SUGGERITA_MIN_CITAZIONI, 2);
});

test("dizionario etichette: una voce per ogni tipo (fonte unica, niente orfani)", () => {
  // Il dizionario CLIENT_TYPE_LABELS nel sorgente deve avere ESATTAMENTE
  // una chiave per ogni tipo: una in più è un valore fuori dominio, una
  // in meno è una UI che mostrerebbe il valore grezzo.
  const src = readFileSync("src/lib/clients-shared.ts", "utf8");
  const block = src.split("CLIENT_TYPE_LABELS")[1]?.split("};")[0] ?? "";
  const chiavi = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...chiavi].sort(),
    [...CLIENT_TYPES].sort(),
    "CLIENT_TYPE_LABELS deve coprire esattamente CLIENT_TYPES",
  );
});
