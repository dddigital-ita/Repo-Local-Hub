/**
 * Smoke test Calendar Hub (dati reali del DB locale).
 * Uso: npx tsx --env-file=.env.local scripts/calendar-hub-smoke.mts
 */
import { getFreeSlots, getHubWindow, buildIcsFeed, buildExportJson, pullAllSources } from "../src/lib/calendar-hub.ts";

const slots = await getFreeSlots({ days: 3, limit: 5 });
console.log(
  "SLOT LIBERI:",
  slots.map((s) => new Date(s.starts_at).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" }) + " " + s.operator_name).join(" | ") || "nessuno",
);

const from = new Date(Date.now() - 86_400_000);
const to = new Date(Date.now() + 5 * 86_400_000);
const wAdmin = await getHubWindow(from, to, false);
console.log("WINDOW admin (privacy on):", wAdmin.map((i) => `${i.kind} «${i.title}»`).slice(0, 6).join(" | "));
const wSuper = await getHubWindow(from, to, true);
console.log("WINDOW super admin:", wSuper.map((i) => `«${i.title}»`).slice(0, 6).join(" | "));

const ics = await buildIcsFeed();
console.log("ICS righe:", ics.split("\n").length, "| VEVENT:", ics.includes("BEGIN:VEVENT"), "| external offuscato:", ics.includes("SUMMARY:Occupato"));

const json = await buildExportJson();
console.log("JSON export: items", json.items.length, "· sources", json.sources.length);

const pull = await pullAllSources("smoke@local");
console.log("PULL:", pull.pulled, "· errori:", pull.errors.join("; ") || "nessuno");
process.exit(0);
