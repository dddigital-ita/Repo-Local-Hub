/**
 * FORMATO DEL DIGEST MATTUTINO — le regole verificate dove vivono.
 * Import diretto del .ts (Node ≥22.6 type stripping), come il test delle
 * pill degli hub: nessuna costante duplicata.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const m = await import("../src/lib/digest-format.ts");
const { isMorningDigestTime, digestSubject, digestLines, DIGEST_WINDOW_UTC } = m;

test("finestra mattutina: 6–8 incluse, fuori finestra no", () => {
  assert.equal(DIGEST_WINDOW_UTC.startRome, 6);
  assert.equal(DIGEST_WINDOW_UTC.endRome, 8);
  assert.equal(isMorningDigestTime(6), true);
  assert.equal(isMorningDigestTime(7), true);
  assert.equal(isMorningDigestTime(8), true);
  assert.equal(isMorningDigestTime(9), false);
  assert.equal(isMorningDigestTime(5), false);
  assert.equal(isMorningDigestTime(-1), false, "input assurdo → fuori finestra");
});

test("oggetto: il rosso guida, poi le schede, poi «tutto a posto»", () => {
  const red = digestSubject({
    operational: {
      title: "Operativo",
      items: [{ label: "SLA dei ticket", note: "!38 in ritardo", href: "/admin/tickets" }],
    },
    configuration: { title: "Configurazione", items: [] },
  });
  assert.match(red, /1 scadenza violata/, "singolare con un solo rosso");

  const amber = digestSubject({
    operational: null,
    configuration: {
      title: "Configurazione",
      items: [
        { label: "Notion", note: "Da collegare", href: "/admin/notion" },
        { label: "Email", note: "Da collegare", href: "/admin/settings/email" },
      ],
    },
  });
  assert.match(amber, /2 schede da completare/);

  const clear = digestSubject({
    operational: null,
    configuration: { title: "Configurazione", items: [] },
  });
  assert.match(clear, /tutto a posto/);
});

test("righe: sezioni con link, e silenzio onesto quando non c'è nulla", () => {
  const lines = digestLines({
    baseUrl: "https://x.it",
    operational: {
      title: "Operativo",
      items: [{ label: "Promesse", note: "2 in ritardo su 3", href: "/admin/leads" }],
    },
    configuration: {
      title: "Configurazione",
      items: [{ label: "Notion", note: "Da collegare", href: "/admin/notion" }],
    },
  });
  assert.equal(lines[0], "OPERATIVO — si agisce oggi");
  assert.ok(lines.some((l) => l.startsWith("• Promesse — 2 in ritardo su 3")));
  assert.ok(lines.some((l) => l === "  https://x.it/admin/leads"));
  assert.ok(lines.includes("CONFIGURAZIONE — si completa quando si può"));

  const onlyConfig = digestLines({
    baseUrl: "https://x.it",
    operational: null,
    configuration: {
      title: "Configurazione",
      items: [{ label: "Notion", note: "Da collegare", href: "/admin/notion" }],
    },
  });
  assert.equal(onlyConfig[0], "CONFIGURAZIONE — si completa quando si può", "nessuna sezione operativa vuota");

  const silent = digestLines({
    baseUrl: "https://x.it",
    operational: null,
    configuration: { title: "C", items: [] },
  });
  assert.deepEqual(silent, [], "nessun pendio → niente email (il silenzio è una buona notizia)");

  const explicitClear = digestLines({
    baseUrl: "https://x.it",
    operational: null,
    configuration: { title: "C", items: [] },
    includeWhenClear: true,
  });
  assert.ok(explicitClear.length > 0, "includeWhenClear forza la riga «giornata libera»");
});
