/**
 * CALENDAR BOARD (dal gemello) — l'adattatore sullo schema 037 locale.
 * Il gemello ha calendar_sources + config con token in chiaro; qui la
 * proiezione passa per calendar_items (origin/external_id) e le sorgenti
 * iCal vivono nella config del hub. Il test verifica le MAPATURE del
 * dominio (pure, senza DB) e i guard statici sull'integrazione — le
 * regole temporali (freeSlots, weekStart) sono già testate in
 * tests/calendar-hub.test.mjs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const lib = () => readFileSync(path.join(ROOT, "src", "lib", "calendar-hub.ts"), "utf8");
const board = () => readFileSync(path.join(ROOT, "src", "components", "calendar-board.tsx"), "utf8");
const route = (p) => readFileSync(path.join(ROOT, ...p.split("/")), "utf8");

test("la board è client component e NON tocca il DB: passa dalle API admin", () => {
  const src = board();
  assert.match(src, /"use client"/, "la board è interattiva (navigazione settimane, form)");
  assert.ok(!/from "@\/lib\/db"/.test(src), "nessun import del DB nel client");
  assert.match(src, /fetch\("\/api\/admin\/calendario\/window/, "legge dalla proiezione");
  assert.match(src, /fetch\("\/api\/admin\/calendario\/actions/, "scrive via POST actions");
});

test("le API della board sono dietro requireAdmin, con privacy by role", () => {
  const win = route("src/app/api/admin/calendario/window/route.ts");
  assert.match(win, /requireAdmin\(/, "la proiezione è admin-only");
  assert.match(win, /super_admin/, "il super admin vede i titoli veri (seePrivate)");
  const actions = route("src/app/api/admin/calendario/actions/route.ts");
  assert.match(actions, /requireAdmin\(/);
  assert.match(actions, /solo_super_admin/, "la config resta al super admin");
});

test("l'adattatore mappa lo schema locale sulla forma del gemello", () => {
  const src = lib();
  assert.match(src, /getBoardWindow/, "la proiezione per la board");
  assert.match(src, /origin === "callback" \? "callback"/, "le callback proiettate restano callback");
  assert.match(src, /r\.kind === "busy" \? "personal" : "appointment"/, "i busy esterni → personal external, i manuali → appointment");
  assert.match(src, /kind <> 'busy'/, "l'assegnazione NON tocca il busy (provider read-only)");
  assert.match(src, /update callbacks set operator_id/, "la callback segue la fonte");
  // Fuori dai commenti: nessuna query sulla tabella calendar_sources
  // (sullo schema locale non esiste — la riga del commento che lo dice
  // non conta). Le query toccano calendar_items, callbacks, content_settings.
  const senzaCommenti = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/calendar_sources/.test(senzaCommenti), "sullo schema locale la tabella calendar_sources NON esiste");
});

test("le sorgenti della board vivono nella config del hub (id = url)", () => {
  const src = lib();
  assert.match(src, /function boardSources/, "la lista sorgenti derivata dalla config");
  assert.match(src, /icalUrls\.map/, "le icalUrls del hub SONO le sorgenti");
  assert.match(src, /sorgente_gia_presente/, "niente doppioni per URL");
});

test("privacy: la proiezione offusca busy e impegni personali ALTRUI (i propri restano leggibili)", () => {
  const src = lib();
  assert.match(src, /"Occupato"/, "i busy per i non-super sono «Occupato»");
  assert.match(src, /"Impegno personale"/, "i personali altrui pure");
  assert.match(src, /viewerOperatorId/, "il titolare riconosce i propri impegni");
});

test("export della board: token della vista, ICS del team + JSON snapshot, read-only", () => {
  const exp = route("src/app/api/calendar/export/route.ts");
  assert.match(exp, /export_token/, "il token della vista protegge i feed");
  assert.match(exp, /format=|format ===/, "due formati: ics e json");
  assert.match(exp, /BEGIN:VCALENDAR/, "ICS valido");
  assert.ok(!/insert |update |delete /i.test(exp), "nessuna scrittura via URL (GET onesto)");
});
