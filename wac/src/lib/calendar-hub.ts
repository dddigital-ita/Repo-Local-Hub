/**
 * CALENDAR HUB — layer DB e rete del calendario unificato.
 * Le regole pure stanno in calendar-hub-shared.ts; qui le letture/scritture
 * su calendar_items (037), il pull Google/iCal e le proiezioni dei kind.
 *
 * REGOLE (convenzione del repo, come google-calendar.ts):
 * - NON bloccante: un errore di calendario non tocca mai chat/callback/admin;
 * - idempotente: (origin, external_id) unico — il pull ripassato non duplica;
 * - niente PII nei log: solo esiti e conteggi (audit con actor system/ambrosio).
 */
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { googleServiceAccountToken } from "@/lib/drive";
import { getGCalCredentials, GCAL_SCOPE } from "@/lib/google-calendar";
import {
  HUB_CONFIG_KEY,
  HUB_DEFAULTS,
  HUB_WORK_WINDOWS,
  hubConfigValidated,
  parseIcalEvents,
  freeSlots,
  type HubConfig,
} from "./calendar-hub-shared";

type Pool = NonNullable<ReturnType<typeof db>>;

/* ── Config ───────────────────────────────────────────────────────── */

export async function getHubConfig(pool?: Pool): Promise<HubConfig> {
  const p = pool ?? db();
  if (!p) return HUB_DEFAULTS;
  try {
    const { rows } = await p.query<{ value: unknown }>("select value from content_settings where key = $1", [HUB_CONFIG_KEY]);
    return hubConfigValidated(rows[0]?.value);
  } catch {
    return HUB_DEFAULTS;
  }
}

export async function saveHubConfig(input: { pullEnabled: boolean; icalUrls: { label: string; url: string; enabled: boolean }[] }): Promise<HubConfig> {
  const pool = db();
  if (!pool) throw new Error("db non disponibile");
  const cfg = hubConfigValidated({ pullEnabled: input.pullEnabled, icalUrls: input.icalUrls });
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [HUB_CONFIG_KEY, JSON.stringify(cfg)],
  );
  await logAudit("system", "calendar.hub-config", null, `pull ${cfg.pullEnabled ? "on" : "off"} · ${cfg.icalUrls.length} sorgenti iCal`);
  return cfg;
}

/* ── Proiezioni (callback → busy, personali) ──────────────────────── */

/** Riproietta le callback ATTIVE come eventi del hub (idempotente: delete+insert della callback). */
export async function projectCallbacks(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `insert into calendar_items (kind, origin, external_id, operator_id, callback_id, title, starts_at, ends_at, notes)
     select 'callback', 'callback', c.id::text, c.operator_id, c.id,
            coalesce('Callback — ' || l.name, 'Callback — cliente'),
            c.scheduled_at,
            c.scheduled_at + interval '30 minutes',
            coalesce(c.slot_label, '')
     from callbacks c left join leads l on l.id = c.lead_id
     where c.status = 'pending'
     on conflict (origin, external_id) do update
       set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           title = excluded.title, operator_id = excluded.operator_id,
           callback_id = excluded.callback_id, updated_at = now()`,
  );
  // Callback chiuse (done/missed): fuori dal hub (il calendario mostra il futuro).
  await pool.query(
    `delete from calendar_items
      where origin = 'callback' and callback_id in (select id from callbacks where status <> 'pending')`,
  );
  return rowCount ?? 0;
}

/** Inserisce/aggiorna un impegno personale (dalla UI admin). */
export async function upsertPersonalItem(input: {
  id?: string;
  operatorId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  notes?: string | null;
}): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db non disponibile");
  if (input.id) {
    await pool.query(
      `update calendar_items set operator_id = $2, title = $3, starts_at = $4, ends_at = $5, notes = $6, updated_at = now()
       where id = $1 and origin = 'manual'`,
      [input.id, input.operatorId, input.title, input.startsAt, input.endsAt, input.notes ?? null],
    );
  } else {
    await pool.query(
      `insert into calendar_items (kind, origin, operator_id, title, starts_at, ends_at, notes)
       values ('personal', 'manual', $1, $2, $3, $4, $5)`,
      [input.operatorId, input.title, input.startsAt, input.endsAt, input.notes ?? null],
    );
  }
}

export async function deletePersonalItem(id: string): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db non disponibile");
  await pool.query("delete from calendar_items where id = $1 and origin = 'manual'", [id]);
}

/* ── Letture ──────────────────────────────────────────────────────── */

export interface HubItem {
  id: string;
  kind: string;
  origin: string;
  operatorId: string | null;
  callbackId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
}

export async function itemsInWindow(from: Date, to: Date): Promise<HubItem[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<HubItem>(
      `select id, kind, origin, operator_id as "operatorId", callback_id as "callbackId",
              title, starts_at as "startsAt", ends_at as "endsAt", notes
       from calendar_items
       where starts_at < $2 and ends_at > $1
       order by starts_at`,
      [from, to],
    );
    return rows;
  } catch {
    return [];
  }
}

/** Impegni → intervalli busy per il calcolo slot (mergi le sovrapposte a monte in freeSlots). */
export async function busySpans(from: Date, to: Date) {
  const items = await itemsInWindow(from, to);
  return items.map((i) => ({ startsAt: i.startsAt, endsAt: i.endsAt }));
}

/* ── PULL: Google Calendar + iCal ─────────────────────────────────── */

export interface PullResult {
  google: { ok: boolean; pulled: number; skipped?: string };
  ical: { ok: boolean; pulled: number; skipped?: string }[];
}

/** Pull Google: eventi futuri del calendario configurato (service account esistente). */
async function pullGoogle(pool: Pool): Promise<PullResult["google"]> {
  try {
    const credsPair = await (async () => {
      const creds = await getGCalCredentials();
      if (!creds) return null;
      const cfgRow = await pool.query<{ value: { calendarId?: string } }>(
        "select value from content_settings where key = 'gcal_config'",
      );
      const calendarId = cfgRow.rows[0]?.value?.calendarId || "primary";
      return { creds, calendarId };
    })();
    if (!credsPair) return { ok: false, pulled: 0, skipped: "gcal non configurato" };

    const token = await googleServiceAccountToken(credsPair.creds, GCAL_SCOPE);
    const timeMin = new Date(Date.now() - 24 * 3600_000).toISOString();
    const timeMax = new Date(Date.now() + 60 * 24 * 3600_000).toISOString();
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(credsPair.calendarId)}/events` +
      `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&singleEvents=true&orderBy=startTime&maxResults=250`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, pulled: 0, skipped: `google ${res.status}` };
    const data = (await res.json()) as {
      items?: { id: string; summary?: string; description?: string; start?: { dateTime?: string; date?: string }, end?: { dateTime?: string; date?: string } }[];
    };
    let pulled = 0;
    for (const ev of data.items ?? []) {
      const startS = ev.start?.dateTime ?? ev.start?.date;
      const endS = ev.end?.dateTime ?? ev.end?.date;
      if (!ev.id || !startS || !endS) continue;
      const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
      const startsAt = new Date(startS);
      const endsAt = new Date(endS);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
      await pool.query(
        `insert into calendar_items (kind, origin, external_id, title, starts_at, ends_at, all_day, notes)
         values ('busy', 'google', $1, $2, $3, $4, $5, $6)
         on conflict (origin, external_id) do update
           set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
               all_day = excluded.all_day, notes = excluded.notes, updated_at = now()`,
        [ev.id, (ev.summary ?? "(evento Google)").slice(0, 200), startsAt, endsAt, allDay, (ev.description ?? "").slice(0, 2000) || null],
      );
      pulled++;
    }
    return { ok: true, pulled };
  } catch (e) {
    return { ok: false, pulled: 0, skipped: e instanceof Error ? e.message.slice(0, 120) : "errore google" };
  }
}

/** Pull di una sorgente iCal (Apple/CalDAV pubblicati, read-only). */
async function pullIcal(pool: Pool, source: { label: string; url: string }, max = 200): Promise<PullResult["ical"][number]> {
  try {
    const res = await fetch(source.url, { signal: AbortSignal.timeout(15000), headers: { accept: "text/calendar" } });
    if (!res.ok) return { ok: false, pulled: 0, skipped: `${source.label}: http ${res.status}` };
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, pulled: 0, skipped: `${source.label}: non è un feed iCal` };
    const events = parseIcalEvents(text, max);
    let pulled = 0;
    const horizon = Date.now() + 60 * 24 * 3600_000;
    for (const ev of events) {
      // Il layer condiviso (superset del gemello) può tornare eventi senza
      // DTEND: qui resta il comportamento storico — senza fine, non pull.
      if (!ev.endsAt) continue;
      if (ev.endsAt.getTime() < Date.now() - 24 * 3600_000 || ev.startsAt.getTime() > horizon) continue;
      await pool.query(
        `insert into calendar_items (kind, origin, external_id, title, starts_at, ends_at, all_day)
         values ('busy', 'ical', $1, $2, $3, $4, $5)
         on conflict (origin, external_id) do update
           set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
               all_day = excluded.all_day, updated_at = now()`,
        [ev.uid, `${ev.title} · ${source.label}`.slice(0, 200), ev.startsAt, ev.endsAt, ev.allDay],
      );
      pulled++;
    }
    return { ok: true, pulled };
  } catch (e) {
    return { ok: false, pulled: 0, skipped: e instanceof Error ? e.message.slice(0, 120) : "errore iCal" };
  }
}

/**
 * PULL COMPLETO: riproietta le callback, scarica Google e le sorgenti iCal
 * abilitate. Mai bloccante: gli errori tornano nel risultato, non lanciano.
 */
export async function pullCalendarHub(actor = "system"): Promise<PullResult> {
  const pool = db();
  if (!pool) return { google: { ok: false, pulled: 0, skipped: "db assente" }, ical: [] };
  const cfg = await getHubConfig(pool);
  const result: PullResult = { google: { ok: false, pulled: 0, skipped: "pull disattivato" }, ical: [] };

  if (cfg.pullEnabled) {
    try {
      const projected = await projectCallbacks(pool);
      await logAudit(actor, "calendar.pull-project", null, `${projected} callback proiettate`);
    } catch {}
    result.google = await pullGoogle(pool);
    for (const src of cfg.icalUrls.filter((s) => s.enabled)) {
      result.ical.push(await pullIcal(pool, src));
    }
    await logAudit(actor, "calendar.pull", null, `google: ${result.google.ok ? result.google.pulled : (result.google.skipped ?? "ko")} · ical: ${result.ical.map((r) => `${r.ok ? r.pulled : "ko"}`).join(", ") || "nessuna sorgente"}`);
  }
  return result;
}

/* ── Export token (feed ICS/JSON del team) ────────────────────────── */

export async function setExportToken(token: string): Promise<void> {
  const pool = db();
  if (!pool) throw new Error("db non disponibile");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  const cfg = await getHubConfig(pool);
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [HUB_CONFIG_KEY, JSON.stringify({ ...cfg, exportTokenHash: hash })],
  );
}

export async function exportTokenMatches(token: string | null): Promise<boolean> {
  if (!token) return false;
  const pool = db();
  if (!pool) return false;
  try {
    const { rows } = await pool.query<{ value: { exportTokenHash?: string } }>("select value from content_settings where key = $1", [HUB_CONFIG_KEY]);
    const hash = rows[0]?.value?.exportTokenHash;
    if (!hash) return false;
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(token).digest("hex") === hash;
  } catch {
    return false;
  }
}

/** Righe per l'export: futuro + passato recente (30 gg), ordinate. */
export async function itemsForExport(): Promise<HubItem[]> {
  const pool = db();
  if (!pool) return [];
  const from = new Date(Date.now() - 30 * 24 * 3600_000);
  const to = new Date(Date.now() + 90 * 24 * 3600_000);
  return itemsInWindow(from, to);
}

/* ══════════════════════════════════════════════════════════════════════
   CALENDAR BOARD — l'adattatore per la vista settimanale del gemello.
   Il gemello porta calendar-board.tsx: griglia client-side per giorno con
   navigazione settimane, assegnazioni a un click, prenotazione su slot
   reali e link export. Questo file espone le STESSE funzioni che il suo
   calendar-hub.ts dà alla board, ma sul NOSTRO schema 037 (calendar_items
   con origin/external_id, config in HUB_CONFIG_KEY, sorgenti iCal nella
   config — niente calendar_sources, che qui non esiste).
   Mappature:
     origin 'callback'                → kind 'callback' (proiezione 037)
     origin 'manual'  + kind callback → kind 'appointment' (prenotato da lead)
     origin 'manual'  + kind personal → kind 'appointment' (impegno creato in vista)
     kind 'busy' (google/ical)        → kind 'personal', source 'external'
   Privacy: come la pagina RSC — chi non è super admin vede «Occupato» sui
   busy e sugli impegni personali altrui (displayTitle nel server).
   ══════════════════════════════════════════════════════════════════════ */

/** Impostazioni della VISTA: i default sono i turni reali del team (037). */
export interface BoardConfig {
  busy_private: boolean;
  work_start: number;
  work_end: number;
  work_days: number[];
  slot_minutes: number;
  export_token: string | null;
}

const BOARD_DEFAULTS: BoardConfig = {
  busy_private: true,
  work_start: HUB_WORK_WINDOWS[0].startHour,
  work_end: HUB_WORK_WINDOWS[HUB_WORK_WINDOWS.length - 1].endHour,
  work_days: [1, 2, 3, 4, 5],
  slot_minutes: 30,
  export_token: null,
};

/** Config della board: legge la STESSA chiave del hub e ne estrae i campi vista. */
export async function getBoardConfig(): Promise<BoardConfig> {
  const pool = db();
  if (!pool) return { ...BOARD_DEFAULTS };
  try {
    const { rows } = await pool.query<{ value: Record<string, unknown> | null }>(
      "select value from content_settings where key = $1",
      [HUB_CONFIG_KEY],
    );
    const v = rows[0]?.value ?? {};
    return {
      busy_private: v.busy_private !== false,
      work_start: Number(v.work_start ?? BOARD_DEFAULTS.work_start),
      work_end: Number(v.work_end ?? BOARD_DEFAULTS.work_end),
      work_days: Array.isArray(v.work_days) && v.work_days.length ? (v.work_days as unknown[]).map(Number) : [...BOARD_DEFAULTS.work_days],
      slot_minutes: Number(v.slot_minutes ?? 30) || 30,
      export_token: typeof v.export_token === "string" && v.export_token ? v.export_token : null,
    };
  } catch {
    return { ...BOARD_DEFAULTS };
  }
}

/** Salva (merge) la config della board nella STESSA chiave del hub: le icalUrls e il pullEnabled del hub non si toccano. */
export async function saveBoardConfig(
  input: Partial<Omit<BoardConfig, "export_token">> & { rotateToken?: boolean },
  actor: string,
): Promise<BoardConfig> {
  const pool = db();
  if (!pool) throw new Error("db non disponibile");
  const cur = await getBoardConfig();
  const { rows } = await pool.query<{ value: Record<string, unknown> | null }>("select value from content_settings where key = $1", [HUB_CONFIG_KEY]);
  const hubCfg = rows[0]?.value ?? {};
  const next = {
    ...hubCfg,
    busy_private: input.busy_private ?? cur.busy_private,
    work_start: input.work_start ?? cur.work_start,
    work_end: input.work_end ?? cur.work_end,
    work_days: input.work_days ?? cur.work_days,
    slot_minutes: input.slot_minutes ?? cur.slot_minutes,
    // Il token della vista vive in CHIARO qui (lo mostra la board per i link
    // export) — il token dei FEED TEAM resta quello con hash del hub.
    export_token:
      input.rotateToken || !cur.export_token ? globalThis.crypto.randomUUID().replace(/-/g, "") : cur.export_token,
  };
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [HUB_CONFIG_KEY, JSON.stringify(next)],
  );
  await logAudit(actor, "calendar_hub.config", "calendar_hub_config", JSON.stringify({ ...input, rotateToken: undefined }));
  return {
    busy_private: next.busy_private as boolean,
    work_start: next.work_start as number,
    work_end: next.work_end as number,
    work_days: next.work_days as number[],
    slot_minutes: next.slot_minutes as number,
    export_token: next.export_token as string | null,
  };
}

/** Riga della board: STESSA forma del gemello (ISO strings, campi serializzabili). */
export interface BoardItem {
  id: string;
  source: "internal" | "external";
  kind: "callback" | "appointment" | "personal" | "block" | "sla";
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  operator_id: string | null;
  operator_name: string | null;
  assigned_ai: boolean;
  callback_id: string | null;
  lead_id: string | null;
  notes: string | null;
  location: string | null;
  color: string | null;
}

/**
 * Proiezione per la vista settimanale: [from, to). `seePrivate`=false
 * offusca i busy e gli impegni personali altrui (privacy del collega —
 * `viewerOperatorId` è l'operatore loggato: i PROPRI impegni restano
 * leggibili anche a lui). Accoda le callback pendenti senza item
 * proiettato: la verità operativa anche se il pull non è ancora passato
 * (stessa garanzia del gemello).
 */
export async function getBoardWindow(from: Date, to: Date, seePrivate: boolean, viewerOperatorId?: string | null): Promise<BoardItem[]> {
  const pool = db();
  if (!pool) return [];
  const { rows } = await pool.query<{
    id: string;
    kind: string;
    origin: string;
    title: string;
    starts_at: Date;
    ends_at: Date | null;
    all_day: boolean;
    operator_id: string | null;
    operator_name: string | null;
    callback_id: string | null;
    notes: string | null;
  }>(
    `select ci.id, ci.kind, ci.origin, ci.title, ci.starts_at, ci.ends_at, ci.all_day,
            ci.operator_id, o.first_name as operator_name, ci.callback_id, ci.notes
     from calendar_items ci
     left join operators o on o.id = ci.operator_id
     where ci.starts_at < $2 and coalesce(ci.ends_at, ci.starts_at) >= $1
     order by ci.starts_at asc`,
    [from, to],
  );
  const items: BoardItem[] = rows.map((r) => {
    const external = r.kind === "busy";
    const kind: BoardItem["kind"] =
      r.origin === "callback" ? "callback" : r.kind === "busy" ? "personal" : "appointment";
    // Privacy come la pagina RSC: ai non-super i busy sono «Occupato» e gli
    // impegni personali ALTRUI «Impegno personale» — i propri restano leggibili.
    const personaleAltrui = !seePrivate && kind === "personal" && r.operator_id !== (viewerOperatorId ?? null);
    const title = external && !seePrivate ? "Occupato" : personaleAltrui ? "Impegno personale" : r.title;
    return {
      id: r.id,
      source: external ? "external" : "internal",
      kind,
      title,
      starts_at: r.starts_at.toISOString(),
      ends_at: r.ends_at ? r.ends_at.toISOString() : null,
      all_day: r.all_day,
      operator_id: r.operator_id,
      operator_name: r.operator_name,
      assigned_ai: false,
      callback_id: r.callback_id,
      lead_id: null,
      notes: r.notes,
      location: null,
      color: null,
    };
  });

  // Callback pendenti senza proiezione (dati storici o fissate da fuori).
  const cbs = await pool.query<{
    id: string;
    scheduled_at: Date;
    operator_id: string | null;
    operator_name: string | null;
    lead_name: string | null;
    notes: string | null;
  }>(
    `select cb.id, cb.scheduled_at, cb.operator_id, o.first_name as operator_name, l.name as lead_name, coalesce(cb.slot_label, '') as notes
     from callbacks cb
     left join operators o on o.id = cb.operator_id
     left join leads l on l.id = cb.lead_id
     where cb.status = 'pending' and cb.scheduled_at < $2 and cb.scheduled_at >= $1
       and not exists (select 1 from calendar_items ci where ci.callback_id = cb.id)`,
    [from, to],
  );
  for (const cb of cbs.rows) {
    items.push({
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
      callback_id: cb.id,
      lead_id: null,
      notes: cb.notes,
      location: null,
      color: null,
    });
  }
  items.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return items;
}

/** Slot liberi per la prenotazione guidata: matematica pura (shared) + impegni reali. */
export async function getBoardFreeSlots(opts: { days?: number; durationMin?: number; limit?: number }): Promise<
  { starts_at: string; ends_at: string; operator_id: string | null; operator_name: string }[]
> {
  const pool = db();
  if (!pool) return [];
  const days = Math.min(Math.max(opts.days ?? 5, 1), 7);
  const from = new Date();
  const to = new Date(from.getTime() + days * 86_400_000);
  const busy = await busySpans(from, to);
  const slots = freeSlots(busy, { days, durationMin: opts.durationMin ?? 30 }).slice(0, opts.limit ?? 12);
  return slots.map((s) => ({
    starts_at: s.toISOString(),
    ends_at: new Date(s.getTime() + (opts.durationMin ?? 30) * 60_000).toISOString(),
    operator_id: null,
    operator_name: "Team",
  }));
}

/** Nuovo impegno dalla vista: sempre manuale (origin manual, kind personal). */
export async function createBoardItem(
  input: { title: string; starts_at: Date; ends_at?: Date | null; operatorId?: string | null },
  actor: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  if (!input.title?.trim()) return { ok: false, error: "titolo_vuoto" };
  if (!(input.starts_at instanceof Date) || Number.isNaN(input.starts_at.getTime()))
    return { ok: false, error: "data_non_valida" };
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into calendar_items (kind, origin, operator_id, title, starts_at, ends_at, notes)
       values ('personal', 'manual', $1, $2, $3, $4, null) returning id`,
      [input.operatorId ?? null, input.title.trim().slice(0, 160), input.starts_at, input.ends_at ?? null],
    );
    await logAudit(actor, "calendar_hub.create", rows[0].id, input.title.slice(0, 80));
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "errore_db" };
  }
}

/**
 * Assegnazione dalla vista: SOLO item manuali e callback (il busy viene
 * dai provider, read-only). Se il item è la proiezione di una callback,
 * l'assegnazione segue la fonte (callbacks.operator_id) come fa la pagina.
 */
export async function assignBoardItem(
  itemId: string,
  to: { operatorId?: string | null },
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  try {
    // Callback non ancora proiettate (id sintetico cb-…): l'assegnazione
    // scrive sulla FONTE — la proiezione la seguirà al prossimo pull.
    if (itemId.startsWith("cb-")) {
      await pool.query("update callbacks set operator_id = $2 where id = $1", [itemId.slice(3), to.operatorId ?? null]);
      await logAudit(actor, "calendar_hub.assign", itemId, `→ ${to.operatorId ?? "non assegnato"}`);
      return { ok: true };
    }
    await pool.query(
      `update calendar_items set operator_id = $2, updated_at = now() where id = $1 and kind <> 'busy'`,
      [itemId, to.operatorId ?? null],
    );
    await pool.query(`update callbacks set operator_id = $2 where id = (select callback_id from calendar_items where id = $1)`, [
      itemId,
      to.operatorId ?? null,
    ]);
    await logAudit(actor, "calendar_hub.assign", itemId, `→ ${to.operatorId ?? "non assegnato"}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "errore_db" };
  }
}

/* ── Sorgenti iCal della board: la LISTA vive nella config del hub ── */

export interface BoardSource {
  id: string;
  kind: "ics";
  label: string;
  operator_id: string | null;
  color: string;
  last_status: string | null;
  last_pull_at: string | null;
  url: string | null;
  calendar_id: string | null;
}

/** Le sorgenti della board sono le icalUrls del hub: id stabile = URL. */
export function boardSources(cfg: { icalUrls: { label: string; url: string; enabled: boolean }[] }): BoardSource[] {
  return cfg.icalUrls.map((s) => ({
    id: s.url,
    kind: "ics" as const,
    label: s.label || "iCal",
    operator_id: null,
    color: "#2F6BFF",
    last_status: s.enabled ? "ok" : null,
    last_pull_at: null,
    url: s.url,
    calendar_id: null,
  }));
}

/** Collega una sorgente iCal (Google calendar_id NON supportato dall'adattatore). */
export async function addBoardSource(
  input: { kind: string; label: string; url?: string | null },
  actor: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (input.kind !== "ics") return { ok: false, error: "solo_ical" };
  const url = input.url?.trim();
  if (!/^https?:\/\//.test(url ?? "")) return { ok: false, error: "url_mancante" };
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  const cfg = await getHubConfig(pool);
  if (cfg.icalUrls.some((s) => s.url === url)) return { ok: false, error: "sorgente_gia_presente" };
  const next = await saveHubConfig({
    pullEnabled: cfg.pullEnabled,
    icalUrls: [...cfg.icalUrls, { label: (input.label || "iCal").slice(0, 60), url: url!.slice(0, 2000), enabled: true }],
  });
  await logAudit(actor, "calendar_hub.source_add", null, `ics ${url}`);
  void next;
  return { ok: true, id: url };
}

/** Elimina la sorgente iCal con quell'URL (gli item già pullati restano finché non ripassa il pull). */
export async function deleteBoardSource(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "db_non_configurato" };
  const cfg = await getHubConfig(pool);
  const next = await saveHubConfig({
    pullEnabled: cfg.pullEnabled,
    icalUrls: cfg.icalUrls.filter((s) => s.url !== id),
  });
  void next;
  await logAudit(actor, "calendar_hub.source_delete", null, id);
  return { ok: true };
}

/** Pull per la vista: il pull del hub, esito appiattito come lo mostra la board. */
export async function pullBoard(actor: string): Promise<{ pulled: number; errors: string[] }> {
  const r = await pullCalendarHub(actor);
  const errors: string[] = [];
  if (!r.google.ok && r.google.skipped) errors.push(`Google: ${r.google.skipped}`);
  for (const i of r.ical) if (!i.ok && i.skipped) errors.push(i.skipped);
  return { pulled: (r.google.ok ? r.google.pulled : 0) + r.ical.reduce((a, b) => a + (b.ok ? b.pulled : 0), 0), errors };
}

/** Snapshot JSON della board (per il re-import programmatico nel gemello WAS). */
export async function buildBoardExportJson(): Promise<{ exported_at: string; config: BoardConfig; items: BoardItem[]; sources: BoardSource[] }> {
  const now = new Date();
  const cfg = await getBoardConfig();
  const hub = await getHubConfig();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 60 * 86_400_000);
  const items = await getBoardWindow(from, to, true);
  return { exported_at: now.toISOString(), config: cfg, items, sources: boardSources(hub) };
}
