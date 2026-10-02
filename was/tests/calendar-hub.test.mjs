import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hubConfigValidated,
  weekStart,
  weekLabel,
  shiftWeek,
  freeSlots,
  parseIcalEvents,
  unfoldIcal,
  buildIcs,
  ICS_BRAND_SALENTO,
} from "../src/lib/calendar-hub-shared.ts";

/**
 * CALENDAR HUB — il calendario unificato (037): callback + personali +
 * tempo occupato letto da Google/CalDAV. Il layer puro (questo test) porta
 * la matematica: config tollerante, settimana, slot liberi, iCal, ICS.
 */

test("hubConfigValidated: input corrotto → default, url non-http scartati", () => {
  assert.deepEqual(hubConfigValidated(null), { pullEnabled: false, icalUrls: [] });
  assert.deepEqual(hubConfigValidated("boh"), { pullEnabled: false, icalUrls: [] });
  assert.deepEqual(hubConfigValidated({ pullEnabled: "sì" }), { pullEnabled: false, icalUrls: [] });
  const cfg = hubConfigValidated({
    pullEnabled: true,
    icalUrls: [
      { label: "Daniele", url: "https://caldav.icloud.com/x.ics", enabled: false },
      { url: "ftp://nope" },
      { url: "http://ok.local/y.ics" },
    ],
  });
  assert.equal(cfg.pullEnabled, true);
  assert.equal(cfg.icalUrls.length, 2, "ftp scartato, gli altri due restano");
  assert.equal(cfg.icalUrls[0].enabled, false, "enabled=false rispettato");
  assert.equal(cfg.icalUrls[1].label, "", "label mancante → vuota, non crash");
});

test("settimana: weekStart è lunedì 00:00, shift si muove di 7 giorni, label leggibile", () => {
  // Un mercoledì noto: 2026-09-30 (mercoledì).
  const wed = new Date(2026, 8, 30, 15, 42);
  const ws = weekStart(wed);
  assert.equal(ws.getDay(), 1, "lunedì");
  assert.equal(ws.getHours(), 0);
  assert.equal(ws.getDate(), 28, "28 settembre 2026 è lunedì");
  const next = shiftWeek(ws, 1);
  assert.equal(next.getDate(), 5, "lunedì dopo");
  assert.ok(weekLabel(ws).includes("28"), "label contiene il giorno di inizio");
});

test("freeSlots: solo turni reali, impegni esclusi, limite 20", () => {
  // Mercoledì 2026-09-30 tutta la mattina occupata (09:00–13:00).
  const busy = [{ startsAt: new Date(2026, 8, 30, 9, 0), endsAt: new Date(2026, 8, 30, 13, 0) }];
  const from = new Date(2026, 8, 30, 8, 0);
  const slots = freeSlots(busy, { from, days: 2 });
  assert.ok(slots.length > 0, "ci sono slot nel pomeriggio");
  assert.ok(slots.every((s) => s.getDate() === 30 || s.getDate() === 1), "solo i 2 giorni richiesti");
  assert.ok(
    slots.every((s) => !((s.getHours() >= 9 && s.getHours() < 13) && s.getDate() === 30)),
    "nessuno slot dentro la mattina occupata",
  );
  assert.ok(slots.every((s) => (s.getHours() >= 9 && s.getHours() < 13) || (s.getHours() >= 15 && s.getHours() < 19)), "solo turni reali");
  const many = freeSlots([], { from, days: 7 });
  assert.ok(many.length <= 20, "limite 20 slot per non affogare il bot");
  // Proprietà: ogni slot torna ≥ from (il bot non propone mai il passato).
  assert.ok(slots.every((s) => s.getTime() >= from.getTime()), "tutti gli slot dopo il from");
});

test("iCal: unfolding, eventi con TZ, all-day, UID dedup", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:evt-1@icloud",
    "DTSTART;TZID=Europe/Rome:20261001T090000",
    "DTEND;TZID=Europe/Rome:20261001T100000",
    "SUMMARY:Installazione cliente\\, prima fase",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:evt-2@icloud",
    "DTSTART;VALUE=DATE:20261002",
    "DTEND;VALUE=DATE:20261003",
    "SUMMARY:Fiera",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const evs = parseIcalEvents(ics);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].uid, "evt-1@icloud");
  // Floating time (TZID): interpretato come ora locale server (09:00).
  assert.equal(evs[0].startsAt.getHours(), 9);
  assert.equal(evs[0].title, "Installazione cliente, prima fase");
  assert.equal(evs[1].allDay, true);
  // Folding: una SUMMARY spezzata su due righe si ricompone.
  const folded = "BEGIN:VEVENT\r\nUID:f@x\r\nDTSTART:20261001T070000Z\r\nDTEND:20261001T080000Z\r\nSUMMARY:Riga uno\r\n  continuazione\r\nEND:VEVENT";
  const [ev] = parseIcalEvents(folded);
  assert.ok(ev.title.includes("continuazione"), `titolo ricomposto: "${ev.title}"`);
  // Eventi senza UID/DTEND scartati senza crash.
  assert.equal(parseIcalEvents("BEGIN:VEVENT\r\nSUMMARY:monco\r\nEND:VEVENT").length, 0);
});

test("unfoldIcal: righe di continuazione (spazio/tab) attaccate alla precedente", () => {
  const lines = unfoldIcal("A:uno\r\n due\r\n\ttre\r\nB:quattro");
  assert.deepEqual(lines, ["A:unoduetre", "B:quattro"]);
});

test("buildIcs: VCALENDAR valido, escape, ordinato per inizio", () => {
  const ics = buildIcs([
    { title: "B; secondo", startsAt: new Date(Date.UTC(2026, 9, 2, 7, 0)), endsAt: new Date(Date.UTC(2026, 9, 2, 8, 0)) },
    { title: "A, primo\nseconda riga", startsAt: new Date(Date.UTC(2026, 9, 1, 7, 0)), endsAt: new Date(Date.UTC(2026, 9, 1, 8, 0)), notes: "nota, con; virgole" },
  ], new Date(Date.UTC(2026, 9, 1, 6, 0)));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ics.indexOf("SUMMARY:A") < ics.indexOf("SUMMARY:B"), "ordinato per inizio");
  assert.ok(ics.includes("SUMMARY:A\\, primo\\nseconda riga"), "escape virgole e newline");
  assert.ok(ics.includes("DESCRIPTION:nota\\, con\\; virgole"));
  assert.ok(ics.includes("DTSTART:20261001T070000Z"), "stampa UTC compatta");
});

test("superset del gemello: LOCATION, eventi senza DTEND, brand ICS parametrico", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:evt-1@icloud",
    "DTSTART;TZID=Europe/Rome:20261001T090000",
    "DTEND;TZID=Europe/Rome:20261001T100000",
    "SUMMARY:Installazione",
    "LOCATION:Via Rossi 12\, Lecce",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:evt-2@icloud",
    "DTSTART:20261002T070000Z",
    "SUMMARY:Impegno senza fine",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  // Default invariato: niente LOCATION, il monco senza DTEND è scartato.
  assert.equal(parseIcalEvents(ics).length, 1);
  assert.equal(parseIcalEvents(ics)[0].location, undefined);
  // Opzioni del gemello: location popolata, monco tenuto con endsAt undefined.
  const evs = parseIcalEvents(ics, 200, { location: true, requireEnd: false });
  assert.equal(evs.length, 2, "anche l'evento senza DTEND passa");
  assert.equal(evs[0].location, "Via Rossi 12, Lecce");
  assert.equal(evs[1].endsAt, undefined);

  // buildIcs col marchio del gemello + sue estensioni del feed.
  const icsSalento = buildIcs(
    [{ title: "Call; X", startsAt: new Date(Date.UTC(2026, 9, 1, 7, 0)), endsAt: new Date(Date.UTC(2026, 9, 1, 8, 0)), categories: "APPOINTMENT", uid: "c1@calendar.webagencysalento" }],
    new Date(Date.UTC(2026, 9, 1, 6, 0)),
    ICS_BRAND_SALENTO,
  );
  assert.ok(icsSalento.includes("PRODID:-//Web Agency Salento//Calendar Hub//IT"));
  assert.ok(icsSalento.includes("X-WR-CALNAME:Web Agency Salento — Team"));
  assert.ok(icsSalento.includes("UID:c1@calendar.webagencysalento"));
  assert.ok(icsSalento.includes("CATEGORIES:APPOINTMENT"));
  // I default restano Crema.
  const icsNoBrand = buildIcs([{ title: "Y", startsAt: new Date(Date.UTC(2026, 9, 1, 7, 0)), endsAt: new Date(Date.UTC(2026, 9, 1, 8, 0)) }]);
  assert.ok(icsNoBrand.includes("PRODID:-//WebAgencyCrema//Calendar Hub//IT"));
});

// twin-sync: per-repo BEGIN (la coerenza statica verifica le invarianti
// LOCALI: qui anti-doublebook e audit nell hub, pull manuale; a Crema il
// cron pull e la gate L2/L3)
test("coerenza statica (variante Salento): tool in whitelist, anti-doublebook, audit nell hub, pull manuale", () => {
  const tools = readFileSync(new URL("../src/lib/ai-tools.ts", import.meta.url), "utf8");
  assert.ok(tools.includes('"cerca_slot"') && tools.includes('"prenota_appuntamento"'), "TOOL_FNS includono i due tool calendario");
  assert.ok(tools.includes("toolCercaSlot") && tools.includes("toolPrenotaAppuntamento"), "runToolCall li esegue");
  // ANTI-DOUBLEBOOK: prenota APPENA riesegue cerca_slot prima di scrivere.
  assert.ok(
    /toolPrenotaAppuntamento[\s\S]*?getFreeSlots[\s\S]*?stillFree/.test(tools),
    "prenota riversifica lo slot (anti-doublebook)",
  );
  // L'audit è NELL'HUB: createCalendarItem passa da logAudit (calendar_hub.create).
  const hub = readFileSync(new URL("../src/lib/calendar-hub.ts", import.meta.url), "utf8");
  assert.ok(hub.includes("calendar_hub.create") && hub.includes("calendar_hub.assign"), "ogni scrittura dell hub finisce in audit");
  assert.ok(hub.includes("from \"./calendar-hub-shared\""), "l hub usa il layer puro condiviso");

  // Il pull è MANUALE (route admin, azione dell'operatore) e auditato.
  const actions = readFileSync(new URL("../src/app/api/admin/calendario/actions/route.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("pullAllSources"), "il pull vive nella route admin");

  // I route handler GET dell'export: nessun side-effect.
  const feed = readFileSync(new URL("../src/app/api/calendar/export/route.ts", import.meta.url), "utf8");
  assert.ok(!/insert |update |delete /i.test(feed), "l'export non tocca il DB in scrittura");
});
// twin-sync: per-repo END
