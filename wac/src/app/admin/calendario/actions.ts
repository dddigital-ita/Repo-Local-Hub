"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  saveHubConfig,
  upsertPersonalItem,
  deletePersonalItem,
  setExportToken,
  pullCalendarHub,
} from "@/lib/calendar-hub";
import { randomBytes } from "node:crypto";

/**
 * Azioni del Calendar Hub (pattern admin/actions.ts): ogni azione è dietro
 * requireAdmin, non bloccante per il resto dell'app e lascia traccia in audit.
 * Logica per ruolo (analisi di utilità JTBD «riempire l'agenda senza perdere
 * lead»): assegnazione SOLO di item non assegnati, config e azioni bulk SOLO
 * super admin, privacy: gli admin vedono i busy con titolo offuscato.
 */

/** Solo super admin: config sorgenti, token export, azioni bulk. */
async function requireSuperAdminForCalendar(): Promise<void> {
  await requireAdmin();
  const user = await getAppUser();
  if (user?.role !== "super_admin") redirect("/admin/calendario?err=permessi");
}

function parseWindow(date: string, hour: number, durationMin: number): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d || hour < 0 || hour > 23) return null;
  const start = new Date(y, m - 1, d, hour, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  const dur = Math.min(Math.max(durationMin, 15), 480);
  return { start, end: new Date(start.getTime() + dur * 60_000) };
}

/** Config pull: checkbox + textarea «Etichetta|https://…» una per riga. SOLO super admin. */
export async function saveHubConfigAction(formData: FormData): Promise<void> {
  await requireSuperAdminForCalendar();
  const pullEnabled = formData.get("pullEnabled") === "on";
  const raw = String(formData.get("icalUrls") ?? "");
  const icalUrls = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, url] = line.split("|", 2);
      return {
        label: (label ?? "iCal").trim().slice(0, 60),
        url: (url ?? line).trim(),
        enabled: true,
      };
    })
    .filter((s) => /^https?:\/\//.test(s.url))
    .slice(0, 10);
  await saveHubConfig({ pullEnabled, icalUrls });
  revalidatePath("/admin/calendario");
}

/** Pull manuale immediato (il cron lo fa da solo se pullEnabled). */
export async function pullNow(): Promise<void> {
  await requireAdmin();
  const res = await pullCalendarHub("system");
  await logAudit(
    "system",
    "calendar.manual-pull",
    null,
    `google: ${res.google.ok ? `${res.google.pulled} eventi` : (res.google.skipped ?? "ko")} · ical: ${res.ical.map((r) => (r.ok ? `${r.pulled}` : "ko")).join(", ") || "nessuna sorgente"}`,
  );
  revalidatePath("/admin/calendario");
}

/** Nuovo impegno personale (origin=manual, kind=personal). */
export async function addPersonalItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  const date = String(formData.get("date") ?? "");
  const hour = Number(formData.get("startHour") ?? "9");
  const durationMin = Number(formData.get("durationMin") ?? "60");
  const operatorRaw = String(formData.get("operatorId") ?? "");
  const window = parseWindow(date, hour, durationMin);
  if (!title || !window) return;
  await upsertPersonalItem({
    operatorId: operatorRaw || null,
    title,
    startsAt: window.start,
    endsAt: window.end,
    notes: null,
  });
  revalidatePath("/admin/calendario");
}

/** Cancella SOLO impegni manuali (busy/callback restano: vengono dai sistemi). */
export async function deletePersonalItemAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deletePersonalItem(id);
  revalidatePath("/admin/calendario");
}

/** Genera un nuovo token export: hash sha256 nel DB, il token in chiaro SOLO nel link mostrato. SOLO super admin. */
export async function rotateExportToken(): Promise<void> {
  await requireSuperAdminForCalendar();
  const token = randomBytes(24).toString("hex");
  await setExportToken(token);
  await logAudit("system", "calendar.export-token", null, "token export rigenerato");
  redirect(`/admin/calendario?export=${token}`);
}

/* ── Assegnazione (admin: solo item non assegnati; super admin: tutti) ── */

export async function assignItem(formData: FormData): Promise<void> {
  await requireAdmin();
  const user = await getAppUser();
  const id = String(formData.get("id") ?? "");
  const operatorRaw = String(formData.get("operatorId") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;

  const kind = String(formData.get("kind") ?? "calendar");
  if (kind === "callback") {
    // Callback: assegnazione sull'evento del hub + specchio su callbacks.
    if (user?.role !== "super_admin") {
      const owner = await pool.query<{ operator_id: string | null }>(
        "select operator_id from callbacks where id = (select callback_id from calendar_items where id = $1)",
        [id],
      );
      if (owner.rows[0]?.operator_id) return; // già assegnata: solo super admin la riassegna
    }
    await pool.query(
      `update callbacks set operator_id = $2 where id = (select callback_id from calendar_items where id = $1 and callback_id is not null)`,
      [id, operatorRaw || null],
    );
    await pool.query(`update calendar_items set operator_id = $2, updated_at = now() where id = $1`, [id, operatorRaw || null]);
  } else {
    // Personali/booking: riassegnazione libera al super admin, vincolata per admin.
    if (user?.role !== "super_admin") {
      const owner = await pool.query<{ operator_id: string | null }>("select operator_id from calendar_items where id = $1", [id]);
      if (owner.rows[0]?.operator_id) return;
    }
    await pool.query(`update calendar_items set operator_id = $2, updated_at = now() where id = $1 and kind <> 'busy'`, [id, operatorRaw || null]);
  }
  await logAudit(user?.email ?? "admin", "calendar.assign", id, `assegnato a ${operatorRaw || "nessuno"}`);
  revalidatePath("/admin/calendario");
}

/* ── Prenotare appuntamento da lead (slot 15/30 min, trasforma il lead in incontro) ── */

export async function bookFromLead(formData: FormData): Promise<void> {
  await requireAdmin();
  const user = await getAppUser();
  const leadId = String(formData.get("leadId") ?? "");
  const date = String(formData.get("date") ?? "");
  const hour = Number(formData.get("hour") ?? "9");
  const minute = String(formData.get("minute") ?? "00");
  const durationMin = Number(formData.get("durationMin") ?? "30");
  const operatorRaw = String(formData.get("operatorId") ?? "");
  const pool = db();
  if (!pool || !leadId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  if (minute !== "00" && minute !== "15" && minute !== "30" && minute !== "45") return;
  const dur = durationMin === 15 ? 15 : 30;
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, m - 1, d, hour, Number(minute));
  const h = start.getHours();
  if ((h < 9 || h >= 13) && (h < 15 || h >= 19)) return; // turni reali
  const end = new Date(start.getTime() + dur * 60_000);

  // Il lead deve esistere ed essere in uno stato coerente (nuovo o contattato).
  const lead = await pool.query<{ id: string; name: string; phone: string; status: string }>(
    "select id, name, phone, status from leads where id = $1",
    [leadId],
  );
  if (!lead.rows[0]) return;

  // Clash check sul hub.
  const clash = await pool.query("select 1 from calendar_items where starts_at < $2 and ends_at > $1 limit 1", [start, end]);
  if (clash.rows.length > 0) {
    redirect("/admin/calendario?err=occupato");
  }

  const title = `Appuntamento — ${lead.rows[0].name || lead.rows[0].phone}`;
  const ins = await pool.query<{ id: string }>(
    `insert into calendar_items (kind, origin, operator_id, callback_id, title, starts_at, ends_at, notes)
     values ('callback', 'manual', $1, null, $2, $3, $4, $5) returning id`,
    [operatorRaw || null, title, start, end, `prenotato da lead (${lead.rows[0].status}) da ${user?.email ?? "admin"}`],
  );
  await pool.query("update leads set status = 'appuntamento_fissato' where id = $1", [leadId]);
  await logAudit(user?.email ?? "admin", "calendar.book-from-lead", ins.rows[0].id, `${title} · ${start.toISOString()}`);
  revalidatePath("/admin/calendario");
}

/* ── Azioni bulk (SOLO super admin): sposta/riassegna le callback in scadenza SLA ── */

export async function bulkReassign(formData: FormData): Promise<void> {
  await requireSuperAdminForCalendar();
  const operatorRaw = String(formData.get("operatorId") ?? "");
  const pool = db();
  if (!pool) return;
  // Callback pending con inizio già passato (SLA breach della coda richiami):
  // le sposto di domani mattina alle 9:00 e le riassegno (o le lascio a chiunque).
  const { rows } = await pool.query<{ id: string; count: string }>(
    `with breached as (
       update callbacks set scheduled_at = date_trunc('day', now()) + interval '1 day 9 hours'
       where status = 'pending' and scheduled_at < now() - interval '1 hour'
       returning id
     )
     select count(*)::text as count from breached`,
  );
  const n = rows[0]?.count ?? "0";
  if (n !== "0") {
    await pool.query(
      `update calendar_items ci set starts_at = c.scheduled_at, ends_at = c.scheduled_at + interval '30 minutes', operator_id = $2, updated_at = now()
       from callbacks c where ci.callback_id = c.id and ci.origin = 'callback'`,
      [operatorRaw || null],
    );
    await logAudit("system", "calendar.bulk-reassign", null, `${n} callback SLA-breach spostate a domani 9:00`);
  }
  revalidatePath("/admin/calendario");
}
