/**
 * CALENDAR HUB — il tempo dell'agenzia in un unico archivio.
 *
 * Cosa fa:
 *  - PROIEZIONE: internals (callback, appuntamenti, blocchi, finestre SLA)
 *    + externals (pull read-only da Google/iCalendar) → lista unificata per
 *    la vista settimanale e per chi deve assegnare lavoro;
 *  - SLOT LIBERI: turni (operators) + impegni (calendar_items) → orari
 *    proponibili. È la fonte che Ambrosio consulta PRIMA di promettere un
 *    orario (niente più "domani alle 9" su un calendario pieno);
 *  - ASSEGNAZIONI: callback/ticket/appuntamenti a un collega o ad Ambrosio AI,
 *    con la stessa regola del triage (chi risponde prende — qui in anticipo);
 *  - EXPORT: feed iCalendar e JSON del tempo interno → re-import in WAC
 *    (WebAgencyCrema) o in qualunque calendario come "calendario abbonato".
 *
 * Principi (migration 037):
 *  - gli external sono READ-ONLY: il pull aggiorna/sincronizza, mai cancella
 *    impegni interni; la privacy è di default (title_rl per l'admin normale);
 *  - tutto auditato: le azioni di scrittura passano da logAudit;
 *  - niente magia: senza sorgenti configurate il pull è un no-op che non
 *    rompe nulla (stessa scuola di gcal_config).
 */
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { logAudit } from "./audit";
import { getGCalCredentials } from "./google-calendar";
// Il layer puro è CONDIVISO col gemello (contratto calendar-hub-shared,
// twin-sync): parsing iCal e scrittura ICS sono le stesse righe nei due
// repo — il marchio ICS passa da ICS_BRAND_SALENTO.
import { parseIcalEvents, buildIcs, ICS_BRAND_SALENTO } from "./calendar-hub-shared";

/* ── Config (content_settings → calendar_hub_config) ─────────────── */

export interface CalendarHubConfig {
  busy_private: boolean;
  work_start: number;
  work_end: number;
  work_days: number[];
  slot_minutes: number;
  export_token: string | null;
}

const HUB_DEFAULTS: CalendarHubConfig = {
  busy_private: true,
  work_start: 9,
  work_end: 19,
  work_days: [1, 2, 3, 4, 5],
  slot_minutes: 30,
  export_token: null,
};

export async function getHubConfig(): Promise<CalendarHubConfig> {
  const pool = db();
  if (!pool) return HUB_DEFAULTS;
  try {
    const { rows } = await pool.query<{ value: Partial<CalendarHubConfig> }>(
      "select value from content_settings where key = 'calendar_hub_config'",
    );
    if (!rows[0]) return { ...HUB_DEFAULTS };
    const v = rows[0].value ?? {};
    return {
      busy_private: v.busy_private !== false,
      work_start: Number(v.work_start ?? 9),
      work_end: Number(v.work_end ?? 19),
      work_days: Array.isArray(v.work_days) && v.work_days.length ? v.work_days.map(Number) : [1, 2, 3, 4, 5],
      slot_minutes: Number(v.slot_minutes ?? 30) || 30,
      export_token: typeof v.export_token === "string" && v.export_token ? v.export_token : null,
    };
  } catch {
    return HUB_DEFAULTS;
  }
}

export async function saveHubConfig(
  input: Partial<Omit<CalendarHubConfig, "export_token">> & { rotateToken?: boolean } = {},
  actor: string,
): Promise<CalendarHubConfig> {
  const pool = db();
  if (!pool) throw new Error("db_non_configurato");
  const cur = await getHubConfig();
  const next: CalendarHubConfig = {
    busy_private: input.busy_private ?? cur.busy_private,
    work_start: input.work_start ?? cur.work_start,
    work_end: input.work_end ?? cur.work_end,
    work_days: input.work_days ?? cur.work_days,
    slot_minutes: input.slot_minutes ?? cur.slot_minutes,
    export_token: input.rotateToken || !cur.export_token ? randomUUID().replace(/-/g, "") : cur.export_token,
  };
  await pool.query(
    `insert into content_settings (key, value) values ('calendar_hub_config', $1)
     on conflict (key) do update set value = $1, updated_at = now()`,
    [JSON.stringify(next)],
  );
  await logAudit(actor, "calendar_hub.config", "calendar_hub_config", JSON.stringify(input));
  return next;
}

/* ── Proiezione unificata (vista settimanale) ────────────────────── */

export interface HubItem {
  id: string;
  source: "internal" | "external";
  kind: "callback" | "appointment" | "personal" | "block" | "sla";
  title: string; // già offuscato se il chiamante è admin e l'item è external+private
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  operator_id: string | null;
  operator_name: string | null;
  assigned_ai: boolean;
  conversation_id: string | null;
  callback_id: string | null;
  lead_id: string | null;
  notes: string | null;
  location: string | null;
  color: string | null;
}

/**
 * Proiezione per la vista: [from, to) chiuso-aperto. `seePrivate`=false
 * offusca i titoli degli impegni esterni (privacy del collega, migration 037).
 * Accoda sempre le CALLBACK pendenti dal DB: sono la verità operativa anche
 * se qualcuno non ha ancora creato l'item (retrocompatibilità totale).
 */
export async function getHubWindow(from: Date, to: Date, seePrivate: boolean): Promise<HubItem[]> {
  const pool = db();
  if (!pool) return [];
  const { rows } = await pool.query<{
    id: string;
    source: "internal" | "external";
    kind: HubItem["kind"];
    title: string;
    starts_at: Date;
    ends_at: Date | null;
    all_day: boolean;
    operator_id: string | null;
    operator_name: string | null;
    assigned_ai: boolean;
    conversation_id: string | null;
    callback_id: string | null;
    lead_id: string | null;
    notes: string | null;
    location: string | null;
    color: string | null;
  }>(
    `select ci.id, ci.source, ci.kind,
            ${seePrivate ? "ci.title" : "coalesce(nullif(ci.title_rl, ''), ci.title)"} as title,
            ci.starts_at, ci.ends_at, ci.all_day, ci.operator_id, o.first_name as operator_name,
            ci.assigned_ai, ci.conversation_id, ci.callback_id, ci.lead_id, ci.notes, ci.location,
            cs.color
     from calendar_items ci
     left join operators o on o.id = ci.operator_id
     left join calendar_sources cs on cs.id = ci.source_id
     where ci.starts_at < $2 and coalesce(ci.ends_at, ci.starts_at) >= $1
     order by ci.starts_at asc`,
    [from, to],
  );
  const items: HubItem[] = rows.map((r) => ({
    ...r,
    starts_at: r.starts_at.toISOString(),
    ends_at: r.ends_at ? r.ends_at.toISOString() : null,
  }));

  // Callback pendenti senza item proiettato (dati storici o fissate da prima della 037).
  const cbs = await pool.query<{
    id: string;
    scheduled_at: Date;
    slot_label: string | null;
    operator_id: string | null;
    operator_name: string | null;
    lead_name: string | null;
    conversation_id: string | null;
    lead_id: string | null;
  }>(
    `select cb.id, cb.scheduled_at, cb.slot_label, cb.operator_id, o.first_name as operator_name,
            l.name as lead_name, cb.conversation_id, cb.lead_id
     from callbacks cb
     left join operators o on o.id = cb.operator_id
     left join leads l on l.id = cb.lead_id
     where cb.status = 'pending' and cb.scheduled_at < $2 and cb.scheduled_at >= $1
       and not exists (select 1 from calendar_items ci where ci.callback_id = cb.id)`,
    [from, to],
  );
  // Privacy «personali»: l'impegno personale (interno o esterno) resta
  // leggibile solo a super admin e al titolare; per gli altri diventa
  // «Occupato». La disponibilità è di tutti, il contenuto no.
  const privateView = !seePrivate;
  const finalItems = privateView
    ? items.map((it) => (it.kind === "personal" ? { ...it, title: "Occupato" } : it))
    : items;
  for (const cb of cbs.rows) {
    finalItems.push({
      id: `cb-${cb.id}`,
      source: "internal",
      kind: "callback",
      title: cb.lead_name ? `Richiamo ${cb.lead_name}` : "Callback",
      starts_at: cb.scheduled_at.toISOString(),
      ends_at: null,
      all_day: false,
      operator_id: cb.operator_id,
      operator_name: cb.operator_name,
      assigned_ai: false,
      conversation_id: cb.conversation_id,
      callback_id: cb.id,
      lead_id: cb.lead_id,
      notes: cb.slot_label,
      location: null,
      color: null,
    });
  }
  finalItems.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return finalItems;
}

/* ── Slot liberi (per admin che prenota e per Ambrosio) ──────────── */

export interface FreeSlot {
  starts_at: string;
  ends_at: string;
  operator_id: string | null;
  operator_name: string;
  assigned_ai: boolean;
}

/**
 * Slot proponibili nei prossimi `days` giorni: intersezione dei turni con
 * l'assenza di impegni. Con operatorId filtra una persona (o l'AI con
 * assigned_ai); senza, restituisce il migliore slot per OGNI assegnatario
 * disponibile — chi assegna sceglie la persona, non solo l'ora.
 */
export async function getFreeSlots(opts: {
  days?: number;
  durationMin?: number;
  operatorId?: string | null;
  limit?: number;
}): Promise<FreeSlot[]> {
  const pool = db();
  if (!pool) return [];
  const cfg = await getHubConfig();
  const days = opts.days ?? 5;
  const dur = opts.durationMin ?? cfg.slot_minutes;
  const limit = opts.limit ?? 8;

  const ops = await pool.query<{ id: string; first_name: string; shift_start: number; shift_end: number; active: boolean }>(
    "select id, first_name, shift_start, shift_end, active from operators where active = true order by id",
  );
  const busy = await pool.query<{ operator_id: string | null; assigned_ai: boolean; starts_at: Date; ends_at: Date | null }>(
    `select operator_id, assigned_ai, starts_at, ends_at from calendar_items
     where starts_at < now() + interval '${Math.max(days, 1)} days' and (operator_id is not null or assigned_ai = true)`,
  );
  const cbs = await pool.query<{ operator_id: string | null; scheduled_at: Date }>(
    `select operator_id, scheduled_at from callbacks
     where status = 'pending' and scheduled_at < now() + interval '${Math.max(days, 1)} days'`,
  );

  const out: FreeSlot[] = [];
  const now = new Date();
  for (let d = 0; d < days && out.length < limit; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    const dow = day.getDay();
    if (!cfg.work_days.includes(dow)) continue;
    for (const op of ops.rows) {
      if (opts.operatorId && op.id !== opts.operatorId) continue;
      // Slot a passo fisso dal turno: semplice, prevedibile, spiegabile al cliente.
      for (let h = op.shift_start; h < op.shift_end && out.length < limit; h++) {
        for (let m = 0; m < 60; m += cfg.slot_minutes) {
          const start = new Date(day);
          start.setHours(h, m, 0, 0);
          if (start <= new Date(now.getTime() + 30 * 60_000)) continue; // niente slot a 30 secondi
          const end = new Date(start.getTime() + dur * 60_000);
          if (end.getHours() > op.shift_end || (end.getHours() === op.shift_end && end.getMinutes() > 0)) continue;
          const clash =
            busy.rows.some(
              (b) =>
                (b.operator_id === op.id || (b.assigned_ai && opts.operatorId === "ai")) &&
                b.starts_at < end &&
                (b.ends_at ?? new Date(b.starts_at.getTime() + 30 * 60_000)) > start,
            ) ||
            cbs.rows.some(
              (c) =>
                (c.operator_id === op.id || c.operator_id === null) &&
                c.scheduled_at < end &&
                new Date(c.scheduled_at.getTime() + 30 * 60_000) > start,
            );
          if (!clash) {
            out.push({
              starts_at: start.toISOString(),
              ends_at: end.toISOString(),
              operator_id: op.id,
              operator_name: op.first_name,
              assigned_ai: false,
            });
            if (out.length >= limit) break;
          }
        }
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}

/* ── Creazione/assegnazione impegni interni ──────────────────────── */

export interface CreateItemInput {
  kind: "appointment" | "personal" | "block" | "callback";
  title: string;
  starts_at: Date;
  ends_at?: Date | null;
  operatorId?: string | null;
  assignedAi?: boolean;
  notes?: string | null;
  location?: string | null;
  conversationId?: string | null;
  callbackId?: string | null;
  leadId?: string | null;
  privateTitle?: boolean;
}

export async function createCalendarItem(input: CreateItemInput, actor: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  if (!input.title?.trim()) return { ok: false, error: "titolo_vuoto" };
  if (!(input.starts_at instanceof Date) || Number.isNaN(input.starts_at.getTime())) return { ok: false, error: "data_non_valida" };
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into calendar_items (source, kind, title, starts_at, ends_at, operator_id, assigned_ai,
                                   conversation_id, callback_id, lead_id, notes, location)
       values ('internal', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        input.kind,
        input.title.trim().slice(0, 160),
        input.starts_at,
        input.ends_at ?? null,
        input.operatorId ?? null,
        input.assignedAi ?? false,
        input.conversationId ?? null,
        input.callbackId ?? null,
        input.leadId ?? null,
        input.notes ?? null,
        input.location ?? null,
      ],
    );
    await logAudit(actor, "calendar_hub.create", rows[0].id, `${input.kind} ${input.title.slice(0, 80)}`);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "errore_db" };
  }
}

export async function assignCalendarItem(itemId: string, to: { operatorId?: string | null; assignedAi?: boolean }, actor: string): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  try {
    await pool.query(
      `update calendar_items set operator_id = $2, assigned_ai = $3, updated_at = now() where id = $1 and source = 'internal'`,
      [itemId, to.operatorId ?? null, to.assignedAi ?? false],
    );
    // Se l'item rappresenta una callback, l'assegnazione la segue (fonte unica).
    await pool.query(
      `update callbacks set operator_id = $2 where id = (select callback_id from calendar_items where id = $1)`,
      [itemId, to.operatorId ?? null],
    );
    await logAudit(actor, "calendar_hub.assign", itemId, to.assignedAi ? "→ Ambrosio AI" : `→ ${to.operatorId ?? "non assegnato"}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "errore_db" };
  }
}

/* ── Sorgenti esterne: pull read-only ────────────────────────────── */

export async function addSource(
  input: { kind: "gcal" | "ics"; label: string; url?: string | null; calendarId?: string | null; operatorId?: string | null; color?: string },
  actor: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  if (input.kind === "ics" && !input.url) return { ok: false, error: "url_mancante" };
  if (input.kind === "gcal" && !input.calendarId) return { ok: false, error: "calendar_id_mancante" };
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into calendar_sources (kind, label, url, calendar_id, operator_id, color)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.kind, input.label.slice(0, 80), input.url ?? null, input.calendarId ?? null, input.operatorId ?? null, input.color ?? "#2F6BFF"],
    );
    await logAudit(actor, "calendar_hub.source_add", rows[0].id, `${input.kind} ${input.label}`);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "errore_db" };
  }
}

/** Sintetizza il titolo per l'admin normale: «Occupato (Google agenzia)». */
function redactTitle(label: string, allDay: boolean): string {
  return allDay ? `Fuori sede · ${label}` : `Occupato · ${label}`;
}

/**
 * Pull di TUTTE le sorgenti visibili. Idempotente: upsert su (source_id, ext_uid).
 * Google usa il service account già configurato per Drive/GCal (034); ICS è
 * HTTP puro + parser minimi (DTSTART/DTEND/SUMMARY/UID) — Apple Calendar,
 * Fastmail, Nextcloud pubblicano tutti un basic.ics.
 */
export async function pullAllSources(actor: string): Promise<{ pulled: number; errors: string[] }> {
  const pool = db();
  if (!pool) return { pulled: 0, errors: ["db_non_configurato"] };
  const { rows: sources } = await pool.query<{
    id: string;
    kind: "gcal" | "ics";
    label: string;
    url: string | null;
    calendar_id: string | null;
  }>("select id, kind, label, url, calendar_id from calendar_sources");
  const errors: string[] = [];
  let pulled = 0;

  for (const s of sources) {
    try {
      let events: { uid: string; title: string; starts_at: Date; ends_at: Date | null; allDay: boolean; location: string | null }[] = [];
      if (s.kind === "ics" && s.url) {
        events = await fetchIcsEvents(s.url);
      } else if (s.kind === "gcal" && s.calendar_id) {
        events = await fetchGcalEvents(s.calendar_id);
      }
      for (const ev of events) {
        await pool.query(
          `insert into calendar_items (source_id, source, kind, title, title_rl, starts_at, ends_at, all_day, operator_id, location, ext_uid)
           values ($1, 'external', 'personal', $2, $3, $4, $5, $6, (select operator_id from calendar_sources where id = $1), $7, $8)
           on conflict (source_id, ext_uid) do update set
             title = excluded.title, title_rl = excluded.title_rl, starts_at = excluded.starts_at,
             ends_at = excluded.ends_at, all_day = excluded.all_day, location = excluded.location, updated_at = now()`,
          [s.id, ev.title, redactTitle(s.label, ev.allDay), ev.starts_at, ev.ends_at, ev.allDay, ev.location, ev.uid],
        );
        pulled++;
      }
      await pool.query("update calendar_sources set last_pull_at = now(), last_status = 'ok', last_error = null where id = $1", [s.id]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${s.label}: ${msg}`);
      await pool.query("update calendar_sources set last_pull_at = now(), last_status = 'error', last_error = $2 where id = $1", [s.id, msg.slice(0, 300)]);
    }
  }
  if (pulled || errors.length) await logAudit(actor, "calendar_hub.pull", "calendar_sources", `pulled=${pulled} errors=${errors.length}`);
  return { pulled, errors };
}

/**
 * Parser ICS: la matematica è nel layer condiviso (calendar-hub-shared,
 * gemellato); qui resta solo la forma di ritorno del pull (location per la
 * vista, ends_at nullable per gli eventi senza DTEND — accettati da sempre).
 */
export async function fetchIcsEvents(url: string): Promise<{ uid: string; title: string; starts_at: Date; ends_at: Date | null; allDay: boolean; location: string | null }[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ics ${res.status}`);
  const raw = await res.text();
  return parseIcalEvents(raw, 200, { location: true, requireEnd: false }).map((ev) => ({
    uid: ev.uid,
    title: ev.title,
    starts_at: ev.startsAt,
    ends_at: ev.endsAt ?? null,
    allDay: ev.allDay,
    location: ev.location ?? null,
  }));
}

/** Eventi Google via API REST col service account già in content_settings (034). */
async function fetchGcalEvents(calendarId: string): Promise<{ uid: string; title: string; starts_at: Date; ends_at: Date | null; allDay: boolean; location: string | null }[]> {
  const creds = await getGCalCredentials();
  if (!creds) throw new Error("service_account_non_configurato");
  const clientEmail = creds.clientEmail;
  const privateKey = creds.privateKey;
  if (!clientEmail || !privateKey) throw new Error("credenziali_incomplete");
  const { createSign } = await import("node:crypto");
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(
    JSON.stringify({ iss: clientEmail, scope: "https://www.googleapis.com/auth/calendar.readonly", aud: "https://oauth2.googleapis.com/token", exp: iat + 3600, iat }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(privateKey).toString("base64url");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${signature}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`google_token ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const evRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`,
    { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!evRes.ok) throw new Error(`google_events ${evRes.status}`);
  const data = (await evRes.json()) as {
    items?: { id: string; summary?: string; location?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[];
  };
  return (data.items ?? []).map((it) => ({
    uid: it.id,
    title: it.summary ?? "Impegno",
    starts_at: new Date(it.start?.dateTime ?? it.start?.date ?? Date.now()),
    ends_at: it.end?.dateTime ? new Date(it.end.dateTime) : it.end?.date ? new Date(it.end.date) : null,
    allDay: !it.start?.dateTime,
    location: it.location ?? null,
  }));
}

/* ── EXPORT per WAC: ICS + JSON ──────────────────────────────────── */


/**
 * Feed iCalendar del tempo INTERNO (callbacks, appuntamenti, blocchi).
 * I personali dei colleghi NON esportano titoli (privacy): escono come
 * «Occupato» — il destinatario vede la disponibilità, non la vita privata.
 */
export async function buildIcsFeed(): Promise<string> {
  const pool = db();
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const items = pool
    ? await pool.query<{ id: string; kind: string; title: string; starts_at: Date; ends_at: Date | null; location: string | null; external: boolean }>(
        `select ci.id, ci.kind, ci.title, ci.starts_at, ci.ends_at, ci.location,
                (ci.source = 'external') as external
         from calendar_items ci
         where ci.starts_at >= $1 and ci.starts_at < $2 and ci.operator_id is not null
         order by ci.starts_at`,
        [from, to],
      )
    : { rows: [] as never[] };
  const ics = buildIcs(
    items.rows.map((it) => ({
      title: it.external ? "Occupato" : it.title,
      startsAt: it.starts_at,
      endsAt: it.ends_at ?? undefined,
      notes: null,
      location: it.location,
      categories: it.kind.toUpperCase(),
      uid: `${it.id}@calendar.webagencysalento`,
    })),
    now,
    ICS_BRAND_SALENTO,
  );
  // X-WR-TIMEZONE era della nostra variante: lo re-inietto sotto PRODID
  // (il writer condiviso non lo emette; i client Apple lo usano come hint).
  return ics.replace(
    "CALSCALE:GREGORIAN\r\n",
    "CALSCALE:GREGORIAN\r\nX-WR-TIMEZONE:Europe/Rome\r\n",
  );
}

/** Snapshot JSON completo (per il re-import programmatico in WAC). */
export async function buildExportJson(): Promise<{ exported_at: string; config: CalendarHubConfig; items: unknown[]; sources: unknown[] }> {
  const pool = db();
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const cfg = await getHubConfig();
  if (!pool) return { exported_at: now.toISOString(), config: cfg, items: [], sources: [] };
  const items = await pool.query(
    `select id, source, kind, title, starts_at, ends_at, all_day, operator_id, assigned_ai,
            conversation_id, callback_id, lead_id, notes, location
     from calendar_items where starts_at >= $1 and starts_at < $2 order by starts_at`,
    [from, to],
  );
  const sources = await pool.query("select id, kind, label, operator_id, color, visible from calendar_sources");
  return { exported_at: now.toISOString(), config: cfg, items: items.rows, sources: sources.rows };
}
