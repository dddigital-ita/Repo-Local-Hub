/**
 * CALENDAR HUB — regole PURE (zero import), il taglio del repo per i layer
 * testabili (come gcal-shared.ts e ambrosio-autonomy.ts).
 *
 * Qui vive la matematica del calendario unificato: normalizzazione degli
 * eventi iCalendar, finestra della vista settimana, calcolo degli slot
 * liberi per Ambrosio e escape ICS per l'export. Le letture DB e le
 * chiamate di rete stanno in calendar-hub.ts; il test importa direttamente
 * questo file (type stripping, nessuna build).
 */

export const HUB_CONFIG_KEY = "calendar_hub_config";

export interface HubIcalSource {
  label: string;
  url: string;
  enabled: boolean;
}

export interface HubConfig {
  pullEnabled: boolean;
  icalUrls: HubIcalSource[];
}

export const HUB_DEFAULTS: HubConfig = { pullEnabled: false, icalUrls: [] };

/** Normalizza la config letta dal DB: input corrotto → default, mai crash. */
export function hubConfigValidated(raw: unknown): HubConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const icalUrls = Array.isArray(r.icalUrls)
    ? (r.icalUrls as unknown[])
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return {
            label: typeof o.label === "string" ? o.label.slice(0, 60) : "",
            url: typeof o.url === "string" ? o.url.trim().slice(0, 2000) : "",
            enabled: o.enabled !== false,
          };
        })
        .filter((s) => /^https?:\/\//.test(s.url))
    : [];
  return { pullEnabled: r.pullEnabled === true, icalUrls };
}

export const HUB_KINDS = ["callback", "personal", "busy"] as const;
export type HubKind = (typeof HUB_KINDS)[number];

/* ── Vista settimana ──────────────────────────────────────────────── */

/** Lunedì 00:00 della settimana che contiene `d` (ora locale server). */
export function weekStart(d: Date): Date {
  const s = new Date(d);
  const dow = (s.getDay() + 6) % 7; // lun=0 … dom=6
  s.setDate(s.getDate() - dow);
  s.setHours(0, 0, 0, 0);
  return s;
}

export function weekEnd(start: Date): Date {
  return new Date(start.getTime() + 7 * 24 * 3600_000);
}

export function shiftWeek(start: Date, weeks: number): Date {
  return new Date(start.getTime() + weeks * 7 * 24 * 3600_000);
}

/** Etichetta «30 set – 6 ott» per l'intestazione della vista. */
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
export function weekLabel(start: Date): string {
  const end = new Date(weekEnd(start).getTime() - 1);
  const a = `${start.getDate()} ${MESI[start.getMonth()]}`;
  const b = `${end.getDate()} ${MESI[end.getMonth()]}`;
  return start.getMonth() === end.getMonth() ? `${a} – ${end.getDate()} ${MESI[end.getMonth()]}` : `${a} – ${b}`;
}

/* ── Slot liberi (per Ambrosio e per la UI) ───────────────────────── */

/** Turni reali del team: le stesse finestre degli slot callback. */
export const HUB_WORK_WINDOWS = [
  { startHour: 9, endHour: 13 },
  { startHour: 15, endHour: 19 },
];

export interface BusySpan {
  startsAt: Date;
  endsAt: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Slot liberi da `from` (default: adesso arrotondato all'ora dopo) per
 * `days` giorni, dentro i turni reali, escludendo gli impegni passati.
 * Durata fissa 30 min (GCAL_EVENT_DURATION_MIN, stessa convenzione).
 * Torna al massimo 20 slot: è un suggerimento per il bot, non un catalogo.
 */
export function freeSlots(busy: BusySpan[], opts?: { from?: Date; days?: number; durationMin?: number }): Date[] {
  const duration = (opts?.durationMin ?? 30) * 60_000;
  const from = opts?.from ?? new Date(Date.now() + 3600_000);
  const days = Math.min(Math.max(opts?.days ?? 3, 1), 7);
  const out: Date[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  for (let d = 0; d < days && out.length < 20; d++) {
    for (const w of HUB_WORK_WINDOWS) {
      for (let h = w.startHour; h < w.endHour && out.length < 20; h++) {
        for (let m = 0; m < 60 && out.length < 20; m += 30) {
          const s = new Date(cursor);
          s.setDate(cursor.getDate() + d);
          s.setHours(h, m, 0, 0);
          const e = new Date(s.getTime() + duration);
          if (s < from) continue;
          const dayEnd = new Date(s); dayEnd.setHours(w.endHour, 0, 0, 0);
          if (e > dayEnd) continue;
          const clash = busy.some((b) => overlaps(s, e, b.startsAt, b.endsAt));
          if (!clash) out.push(s);
        }
      }
    }
  }
  return out;
}

/* ── iCalendar: parsing minimale (VEVENT: DTSTART/DTEND/SUMMARY/UID) ── */

export interface IcalEvent {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt?: Date;
  allDay: boolean;
  /** Popolato quando l'opzione location è attiva (il gemello la usa per il pull). */
  location?: string | null;
}

/** Srotola il folding RFC 5545 (righe di continuazione che iniziano con spazio). */
export function unfoldIcal(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/** Decodifica il testo iCal: escape \\n \\, \\; e sottigliezze minimali. */
function icalUnescape(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** DTSTART;TZID=Europe/Rome:20261001T090000 | DTSTART:20261001T070000Z | DTSTART;VALUE=DATE:20261001 */
function icalDate(prop: string): { date: Date; allDay: boolean } | null {
  const [namePart, value] = prop.split(":", 2);
  if (!value) return null;
  const allDay = /VALUE=DATE/i.test(namePart);
  const raw = value.trim();
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, dd, hh = "0", mi = "0", ss = "0", z = ""] = m;
  const date = allDay || z === "Z"
    ? new Date(Date.UTC(+y, +mo - 1, +dd, allDay ? 0 : +hh, +mi, +ss))
    : new Date(+y, +mo - 1, +dd, +hh, +mi, +ss); // floating = ora locale server
  return { date, allDay };
}

/**
 * Estrae i VEVENT dal testo iCal: tollerante, scarta ciò che non capisce.
 * Opzioni del gemello Salento (superset additivo, default = comportamento
 * storico di qui):
 *   - location: popola anche LOCATION (Salento la mostra negli impegni);
 *   - requireEnd: false tiene gli eventi SENZA DTEND (endsAt undefined)
 *     invece di scartarli — il pull di Salento li accetta da sempre.
 */
export function parseIcalEvents(
  text: string,
  max = 200,
  opzioni?: { location?: boolean; requireEnd?: boolean },
): IcalEvent[] {
  const requireEnd = opzioni?.requireEnd !== false;
  const lines = unfoldIcal(text);
  const events: IcalEvent[] = [];
  let cur: Partial<IcalEvent> | null = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) cur = {};
    else if (/^END:VEVENT/i.test(line)) {
      const uid = cur?.uid;
      const startsAt = cur?.startsAt;
      const endsAt = cur?.endsAt;
      const completo = uid && startsAt && (!requireEnd || (endsAt && endsAt > startsAt));
      if (completo) {
        events.push({
          uid,
          title: cur!.title ?? "(senza titolo)",
          startsAt,
          endsAt,
          allDay: cur!.allDay ?? false,
          ...(opzioni?.location ? { location: cur!.location ?? null } : {}),
        });
        if (events.length >= max) break;
      }
      cur = null;
    } else if (cur) {
      const name = line.slice(0, line.indexOf(":")).toUpperCase();
      if (name.startsWith("UID")) cur.uid = icalUnescape(line.slice(line.indexOf(":") + 1)).slice(0, 200);
      else if (name.startsWith("SUMMARY")) cur.title = icalUnescape(line.slice(line.indexOf(":") + 1)).slice(0, 200);
      else if (name.startsWith("DTSTART")) { const parsed = icalDate(line); if (parsed) { cur.startsAt = parsed.date; cur.allDay = parsed.allDay; } }
      else if (name.startsWith("DTEND")) { const parsed = icalDate(line); if (parsed) cur.endsAt = parsed.date; }
      else if (name.startsWith("LOCATION") && opzioni?.location) cur.location = icalUnescape(line.slice(line.indexOf(":") + 1)).slice(0, 300);
    }
  }
  return events;
}

/* ── Export ICS (feed del team) ───────────────────────────────────── */

function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * ICS minimale valido (RFC 5545), ordinato per inizio. Il marchio (PRODID,
 * X-WR-CALNAME, dominio degli UID) è PARAMETRICO: qui i default Crema, il
 * gemello passa il suo brand — le regole sono una sola, il marchio è del
 * repo. Salento usa anche categories/notes/uidFn, sue estensioni del feed.
 */
export interface IcsBrand {
  prodid: string;
  calname: string;
  uidDomain: string;
}
export const ICS_BRAND_CREMA: IcsBrand = {
  prodid: "-//WebAgencyCrema//Calendar Hub//IT",
  calname: "Web Agency Crema — Team",
  uidDomain: "webagencycrema",
};
export const ICS_BRAND_SALENTO: IcsBrand = {
  prodid: "-//Web Agency Salento//Calendar Hub//IT",
  calname: "Web Agency Salento — Team",
  uidDomain: "calendar.webagencysalento",
};

export function buildIcs(
  items: { title: string; startsAt: Date; endsAt?: Date; allDay?: boolean; notes?: string | null; location?: string | null; categories?: string | null; uid?: string }[],
  stamp = new Date(),
  brand: IcsBrand = ICS_BRAND_CREMA,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${brand.prodid}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${brand.calname}`,
  ];
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, 500);
  for (const [i, it] of sorted.entries()) {
    if (!it.endsAt && !it.allDay) continue; // gli eventi monchi non esportano
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${it.uid ?? `calhub-${i}-${icsStamp(it.startsAt)}@${brand.uidDomain}`}`);
    lines.push(`DTSTAMP:${icsStamp(stamp)}`);
    if (it.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${it.startsAt.toISOString().slice(0, 10).replace(/-/g, "")}`);
      lines.push(`DTEND;VALUE=DATE:${it.endsAt ? it.endsAt.toISOString().slice(0, 10).replace(/-/g, "") : it.startsAt.toISOString().slice(0, 10).replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART:${icsStamp(it.startsAt)}`);
      lines.push(`DTEND:${icsStamp(it.endsAt!)}`);
    }
    lines.push(`SUMMARY:${icsEscape(it.title)}`);
    if (it.notes) lines.push(`DESCRIPTION:${icsEscape(it.notes.slice(0, 2000))}`);
    if (it.location) lines.push(`LOCATION:${icsEscape(it.location)}`);
    if (it.categories) lines.push(`CATEGORIES:${icsEscape(it.categories)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
