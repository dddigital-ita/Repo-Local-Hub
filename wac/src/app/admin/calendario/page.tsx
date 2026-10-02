import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getAppUser } from "@/lib/users";
import { CalendarDays, Plus } from "lucide-react";
import { GlassCard, GlassNotice } from "@/components/glass";
import CalendarBoard from "@/components/calendar-board";
import { getSiteTheme } from "@/lib/theme";
import { cn } from "@/components/ui";
import {
  weekStart,
  weekLabel,
  shiftWeek,
} from "@/lib/calendar-hub-shared";
import { itemsInWindow, getHubConfig, getBoardConfig } from "@/lib/calendar-hub";
import {
  addPersonalItem,
  deletePersonalItemAction,
  saveHubConfigAction,
  rotateExportToken,
  pullNow,
  assignItem,
  bookFromLead,
  bulkReassign,
} from "./actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const GIORNI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const KIND_STYLE: Record<string, string> = {
  callback: "bg-brand-50/90 text-brand-700 ring-brand-200",
  personal: "bg-sky-50/90 text-sky-700 ring-sky-200",
  busy: "bg-slate-100/90 text-slate-600 ring-slate-200",
  google: "bg-emerald-50/90 text-emerald-700 ring-emerald-200",
  ical: "bg-amber-50/90 text-amber-700 ring-amber-200",
};

function originClass(item: { kind: string; origin: string }): string {
  if (item.kind === "callback") return KIND_STYLE.callback;
  if (item.kind === "personal") return KIND_STYLE.personal;
  return item.origin === "google" ? KIND_STYLE.google : item.origin === "ical" ? KIND_STYLE.ical : KIND_STYLE.busy;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; export?: string; err?: string }>;
}) {
  await requireAdmin();
  const user = await getAppUser();
  const isSuper = user?.role === "super_admin";
  const sp = await searchParams;
  const wOffset = Math.min(Math.max(Number(sp.w ?? "0") || 0, -8), 12);
  const start = shiftWeek(weekStart(new Date()), wOffset);
  const end = new Date(start.getTime() + 7 * 24 * 3600_000);

  const items = await itemsInWindow(start, end);
  const cfg = await getHubConfig();
  const boardCfg = await getBoardConfig();
  const theme = await getSiteTheme().catch(() => null);

  const pool = db();
  let operators: { id: string; first_name: string }[] = [];
  let openLeads: { id: string; name: string; phone: string; status: string }[] = [];
  if (pool) {
    try {
      const { rows } = await pool.query<{ id: string; first_name: string }>(
        "select id, first_name from operators where active = true order by id",
      );
      operators = rows;
      const { rows: leads } = await pool.query<{ id: string; name: string; phone: string; status: string }>(
        `select id, coalesce(name, '') as name, phone, status from leads
         where status in ('nuovo', 'contattato', 'callback_scheduled')
         order by created_at desc limit 8`,
      );
      openLeads = leads;
    } catch {}
  }

  /** Privacy by default: gli admin vedono i busy con il titolo offuscato. */
  const displayTitle = (it: { kind: string; origin: string; title: string; operatorId: string | null }): string => {
    if (isSuper) return it.title;
    if (it.kind === "busy") return "Occupato";
    if (it.kind === "personal" && it.operatorId !== user?.operatorId) return "Impegno personale";
    return it.title;
  };

  // Griglia: 7 colonne giorno × righe per finestre turni.
  const dayCells = Array.from({ length: 7 }, (_, d) => {
    const dayBegin = new Date(start.getTime() + d * 24 * 3600_000);
    const dayEnd = new Date(dayBegin.getTime() + 24 * 3600_000);
    return {
      label: GIORNI[d],
      date: dayBegin,
      items: items.filter((i) => i.startsAt < dayEnd && i.endsAt > dayBegin),
    };
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <CalendarDays className="h-6 w-6 text-brand-600" aria-hidden />
          Calendario del team
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Un solo posto: callback del gestionale, impegni personali e tempo occupato letto da Google/CalDAV.
        </p>
      </header>

      {sp.export && (
        <GlassNotice>
          <strong className="font-semibold">Token export creato — copialo ORA, non viene più mostrato:</strong>
          <code className="mt-1 block break-all rounded-lg bg-slate-900/90 px-2 py-1 font-mono text-[11px] text-slate-100">{sp.export}</code>
          <span className="mt-1 block text-[11px] text-slate-500">
            Link feed: https://TUO-DOMINIO/api/calendar/feed.ics?token={sp.export} (o feed.json). Nel DB resta solo l&apos;hash: chi lo perde lo rigenera da qui.
          </span>
        </GlassNotice>
      )}

      {/* Navigazione settimane */}
      <div className="flex items-center justify-between">
        <Link
          href={`/admin/calendario?w=${wOffset - 1}`}
          className="rounded-full px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white/60"
          aria-label="Settimana precedente"
        >
          ← Settimana prima
        </Link>
        <p className="text-sm font-semibold text-slate-700">{weekLabel(start)}{wOffset === 0 && " · questa settimana"}</p>
        <Link
          href={`/admin/calendario?w=${wOffset + 1}`}
          className="rounded-full px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white/60"
          aria-label="Settimana successiva"
        >
          Settimana dopo →
        </Link>
      </div>

      {sp.err === "permessi" && (
        <GlassNotice>
          <strong className="font-semibold">Azione riservata ai super admin.</strong> Chiedi a un super admin o usa le azioni del tuo ruolo.
        </GlassNotice>
      )}
      {sp.err === "occupato" && (
        <GlassNotice>
          <strong className="font-semibold">Slot appena occupato:</strong> scegli un altro orario.
        </GlassNotice>
      )}

      {/* Vista settimana: colonna per giorno, chip per impegno (privacy: admin vede i busy offuscati) */}
      <GlassCard>
        <div className="grid grid-cols-7 gap-2">
          {dayCells.map((cell) => (
            <div key={cell.label + cell.date.getDate()} className="min-h-32 rounded-2xl bg-white/40 p-2">
              <p className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {cell.label} {cell.date.getDate()}
              </p>
              <div className="space-y-1">
                {cell.items.map((it) => (
                  <div key={it.id}>
                    <div
                      className={cn("rounded-xl px-2 py-1 text-[11px] leading-tight ring-1", originClass(it))}
                      title={`${displayTitle(it)} · ${it.startsAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}–${it.endsAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}${isSuper && it.notes ? ` · ${it.notes}` : ""}`}
                    >
                      <span className="font-semibold">
                        {it.startsAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                      </span>{" "}
                      {displayTitle(it).slice(0, 40)}
                      {!it.operatorId && <span className="font-bold"> ·?</span>}
                    </div>
                    {/* Assegnazione inline: admin solo su non assegnati, super admin su tutti (non busy). */}
                    {it.kind !== "busy" && (isSuper || !it.operatorId) && (
                      <form action={assignItem} className="mt-0.5 flex items-center gap-1">
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="kind" value={it.kind} />
                        <select name="operatorId" defaultValue={it.operatorId ?? ""} className="w-full rounded-lg border border-white/60 bg-white/70 px-1 py-0.5 text-[10px] text-slate-600 outline-none">
                          <option value="">— chi?</option>
                          {operators.map((o) => (
                            <option key={o.id} value={o.id}>{o.first_name}</option>
                          ))}
                        </select>
                        <button type="submit" className="shrink-0 rounded-lg bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 transition hover:bg-white" aria-label={`Assegna ${displayTitle(it)}`}>ok</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-3 px-1 text-[11px] text-slate-500">
          <span className="text-slate-400">·? = non assegnato{isSuper ? " (super admin: può riassegnare tutto)" : " (puoi prendere in carico)"}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-500" /> callback</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> personali</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Google</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> iCal/CalDAV</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> altro tempo occupato</span>
        </p>
      </GlassCard>

      {/* LA BOARD (dal gemello): la settimana interattiva client-side —
          navigazione settimane, assegnazioni a un click, nuovo impegno su
          slot reali, gestione sorgenti e link export. Sopra la griglia RSC
          (che resta come fotografia statica della settimana e veicolo
          delle azioni testuali: prenota da lead, bulk, config). */}
      <CalendarBoard
        operators={operators.map((o) => ({ id: o.id, first_name: o.first_name, shift_start: 9, shift_end: 19 }))}
        sources={[]}
        isSuper={isSuper}
        busyPrivate={boardCfg.busy_private}
        exportToken={boardCfg.export_token}
        primary={theme?.primary ?? "#2F6BFF"}
      />

      {/* Prenota da lead + azioni bulk */}
      <div className="grid gap-3 md:grid-cols-2">
        <GlassCard>
          <h2 className="text-sm font-bold text-slate-800">Prenota appuntamento da lead</h2>
          <p className="mt-1 text-xs text-slate-500">Trasforma un lead recente in incontro sul calendario (slot 15/30 min, turni reali, clash-check).</p>
          {openLeads.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">Nessun lead aperto al momento.</p>
          ) : (
            <form action={bookFromLead} className="mt-2 space-y-2">
              <select name="leadId" required className="w-full rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl">
                {openLeads.map((l) => (
                  <option key={l.id} value={l.id}>{l.name || l.phone} · {l.status}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <input name="date" type="date" required className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" />
                <select name="operatorId" className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl">
                  <option value="">Chiunque</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>{o.first_name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <select name="hour" className="w-1/3 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" defaultValue="9">
                  {[9, 10, 11, 12, 15, 16, 17, 18].map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
                <select name="minute" className="w-1/3 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" defaultValue="00">
                  {["00", "15", "30", "45"].map((m) => <option key={m} value={m}>:{m}</option>)}
                </select>
                <select name="durationMin" className="w-1/3 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" defaultValue="30">
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                </select>
              </div>
              <button type="submit" className="rounded-full bg-brand-600/90 px-4 py-2 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
                Fissa l&apos;incontro
              </button>
            </form>
          )}
        </GlassCard>

        {isSuper && (
          <GlassCard>
            <h2 className="text-sm font-bold text-slate-800">Azioni bulk</h2>
            <p className="mt-1 text-xs text-slate-500">Le callback pendenti scadute da più di un&apos;ora (SLA breach della coda) vengono spostate a domani 9:00 e riassegnate.</p>
            <form action={bulkReassign} className="mt-2 flex items-end gap-2">
              <select name="operatorId" className="flex-1 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl">
                <option value="">Rilascia a «chiunque»</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.first_name}</option>
                ))}
              </select>
              <button type="submit" className="rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                Recupera scadute
              </button>
            </form>
          </GlassCard>
        )}
      </div>

      {/* Pull + config sorgenti (config SOLO super admin; pull manuale a tutti) */}
      <div className="grid gap-3 md:grid-cols-2">
        <GlassCard>
          <h2 className="text-sm font-bold text-slate-800">Sincronizzazione</h2>
          <p className="mt-1 text-xs text-slate-500">
            Pull {cfg.pullEnabled ? "ATTIVO" : "spento"} · {cfg.icalUrls.filter((s) => s.enabled).length} sorgenti iCal attive su {cfg.icalUrls.length}.
          </p>
          <form action={pullNow} className="mt-2">
            <button type="submit" className="rounded-full bg-brand-600/90 px-4 py-2 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
              Pull adesso
            </button>
          </form>
          {isSuper && (
            <form action={saveHubConfigAction} className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" name="pullEnabled" defaultChecked={cfg.pullEnabled} className="h-3.5 w-3.5 accent-brand-600" />
                Pull automatico ad ogni tick del cron
              </label>
              <textarea
                name="icalUrls"
                rows={3}
                placeholder={"Una sorgente iCal per riga: Etichetta|https://…\nEs: Daniele Apple|https://caldav.icloud.com/…/basic.ics"}
                defaultValue={cfg.icalUrls.map((s) => `${s.label}|${s.url}`).join("\n")}
                className="w-full rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl focus:border-brand-400/70"
              />
              <button type="submit" className="rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                Salva configurazione
              </button>
            </form>
          )}
          <GlassNotice>
            Il pull legge SOLO (read-only): gli eventi finiscono nel hub come «tempo occupato». Il push verso Google resta quello delle callback (Impostazioni → Google Calendar).
          </GlassNotice>
        </GlassCard>

        <GlassCard>
          <h2 className="text-sm font-bold text-slate-800">Impegno personale</h2>
          <form action={addPersonalItem} className="mt-2 space-y-2">
            <input name="title" required maxLength={120} placeholder="Cosa (es. Installazione cliente Rossi)" className="w-full rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl focus:border-brand-400/70" />
            <div className="flex gap-2">
              <select name="operatorId" className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl">
                <option value="">Chiunque</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.first_name}</option>
                ))}
              </select>
              <input name="date" type="date" required className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" />
            </div>
            <div className="flex gap-2">
              <select name="startHour" className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" defaultValue="9">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
              <select name="durationMin" className="w-1/2 rounded-2xl border border-white/50 bg-white/60 px-3 py-2 text-xs outline-none backdrop-blur-xl" defaultValue="60">
                {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} h` : `${m} min`}</option>)}
              </select>
            </div>
            <button type="submit" className="inline-flex items-center gap-1 rounded-full bg-brand-600/90 px-4 py-2 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
              <Plus className="h-3.5 w-3.5" aria-hidden /> Aggiungi al calendario
            </button>
          </form>
          <h3 className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">Impegni personali in questa settimana</h3>
          <div className="mt-1 space-y-1">
            {items.filter((i) => i.kind === "personal").map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/50 px-3 py-1.5 text-xs text-slate-700">
                <span>
                  <span className="font-semibold">{it.startsAt.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}</span>{" "}
                  {it.startsAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} — {it.title}
                </span>
                <form action={deletePersonalItemAction}>
                  <input type="hidden" name="id" value={it.id} />
                  <button type="submit" className="text-slate-400 transition hover:text-red-600" aria-label={`Elimina ${it.title}`}>✕</button>
                </form>
              </div>
            ))}
            {items.filter((i) => i.kind === "personal").length === 0 && (
              <p className="text-xs text-slate-400">Nessun impegno personale questa settimana.</p>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Export: link disponibile a tutti (sola lettura), rigenerazione token SOLO super admin */}
      <GlassCard>
        <h2 className="text-sm font-bold text-slate-800">Export per il team</h2>
        <p className="mt-1 text-xs text-slate-500">
          Feed iCalendar e JSON del calendario unificato: chi li ha, li aggiorna da solo (Apple Calendar, Google «altro calendario», Thunderbird).{isSuper ? " Rigenera il token per invalidare i link vecchi." : " Chiedi a un super admin per un nuovo token."}
        </p>
        {isSuper && (
          <form action={rotateExportToken} className="mt-2 flex items-center gap-2">
            <button type="submit" className="rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
              Genera nuovo token
            </button>
            <span className="text-[11px] text-slate-400">il token esistente smette di funzionare appena rigeneri</span>
          </form>
        )}
      </GlassCard>
    </div>
  );
}
