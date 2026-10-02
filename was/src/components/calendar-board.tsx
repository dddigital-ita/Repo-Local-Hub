"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, RefreshCw, Link2, Trash2, Plus, Bot, User } from "lucide-react";
// La settimana è il layer puro condiviso col gemello (stessa matematica,
// stesse etichette): weekStart/weekEnd/shiftWeek/weekLabel.
import { weekStart, shiftWeek } from "@/lib/calendar-hub-shared";

/**
 * La settimana del Calendar Hub. Server fornisce operatori/sorgenti/config;
 * qui: fetch della finestra, griglia per giorno, assegnazioni a un click
 * (persona o Ambrosio), prenotazione guidata su slot reali, gestione
 * sorgenti (super admin) e link dei feed export.
 */

interface HubItem {
  id: string;
  source: "internal" | "external";
  kind: "callback" | "appointment" | "personal" | "block" | "sla";
  title: string;
  starts_at: string;
  ends_at: string | null;
  operator_id: string | null;
  operator_name: string | null;
  assigned_ai: boolean;
  callback_id: string | null;
  conversation_id: string | null;
  location: string | null;
  color: string | null;
}

interface Operator {
  id: string;
  first_name: string;
  shift_start: number;
  shift_end: number;
}

interface Source {
  id: string;
  kind: string;
  label: string;
  operator_id: string | null;
  color: string;
  last_status: string | null;
  last_pull_at: string | null;
  url: string | null;
  calendar_id: string | null;
}

const KIND_COLOR: Record<HubItem["kind"], string> = {
  callback: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  appointment: "bg-brand-500/15 text-brand-300 border-brand-500/30",
  personal: "bg-slate-500/15 text-slate-300 border-slate-400/25",
  block: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  sla: "bg-red-500/15 text-red-300 border-red-500/30",
};

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Le label dei giorni della griglia usano la stessa base del layer condiviso.
const GIORNI_LABEL = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default function CalendarBoard({
  operators,
  sources: initialSources,
  isSuper,
  exportToken,
}: {
  operators: Operator[];
  sources: Source[];
  isSuper: boolean;
  busyPrivate: boolean;
  exportToken: string | null;
  primary: string;
}) {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const [items, setItems] = useState<HubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [slots, setSlots] = useState<{ starts_at: string; ends_at: string; operator_id: string | null; operator_name: string }[]>([]);
  const [newForm, setNewForm] = useState({ title: "", day: "", time: "10:00", minutes: 30, operator: "", kind: "appointment" as "appointment" | "personal" | "block" });

  const days = useMemo(() => {
    const monday = shiftWeek(weekStart(dayStart(new Date())), weekOffset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const load = useCallback(async () => {
    setLoading(true);
    const from = days[0].toISOString();
    const to = new Date(days[6].getTime() + 86_400_000).toISOString();
    const res = await fetch(`/api/admin/calendario/window?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const data = await res.json();
    setItems(data.ok ? data.items : []);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const from = days[0].toISOString();
      const to = new Date(days[6].getTime() + 86_400_000).toISOString();
      try {
        const res = await fetch(`/api/admin/calendario/window?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        const data = await res.json();
        if (alive) {
          setItems(data.ok ? data.items : []);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [days]);

  async function act(body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/admin/calendario/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok && body.action === "pull") {
        const s = await fetch("/api/admin/calendario/window?from=" + encodeURIComponent(days[0].toISOString()) + "&to=" + encodeURIComponent(new Date(days[6].getTime() + 86400000).toISOString()));
        setItems((await s.json()).items ?? []);
      }
      await load();
      router.refresh();
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function assign(id: string, operatorId: string | null, assignedAi: boolean) {
    await act({ action: "assign", id, operator_id: operatorId, assigned_ai: assignedAi }, id);
  }

  async function pull() {
    setPullMsg(null);
    const r = await act({ action: "pull" }, "pull");
    setPullMsg(r.pulled !== undefined ? `Sincronizzati ${r.pulled} impegni${r.errors?.length ? ` · errori: ${r.errors.join("; ")}` : ""}` : "pull fallito");
  }

  async function openNew() {
    setShowNew(true);
    const r = await fetch("/api/admin/calendario/slots").then((x) => x.json()).catch(() => ({ slots: [] }));
    setSlots(r.slots ?? []);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const day = newForm.day ? new Date(newForm.day + "T" + newForm.time + ":00") : null;
    if (!day || Number.isNaN(day.getTime())) return;
    const ends = new Date(day.getTime() + newForm.minutes * 60_000);
    await act(
      { action: "create", kind: newForm.kind, title: newForm.title, starts_at: day.toISOString(), ends_at: ends.toISOString(), operator_id: newForm.operator || null },
      "create",
    );
    setShowNew(false);
    setNewForm({ title: "", day: "", time: "10:00", minutes: 30, operator: "", kind: "appointment" });
  }

  async function deleteSource(id: string) {
    await fetch("/api/admin/calendario/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    setSources((s) => s.filter((x) => x.id !== id));
    await load();
  }

  async function addSource(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const kind = String(fd.get("kind")) === "gcal" ? "gcal" : "ics";
    const r = await fetch("/api/admin/calendario/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        label: String(fd.get("label") ?? ""),
        url: kind === "ics" ? String(fd.get("url") ?? "") || null : null,
        calendar_id: kind === "gcal" ? String(fd.get("calendar_id") ?? "") || null : null,
        operator_id: String(fd.get("operator_id") ?? "") || null,
      }),
    }).then((x) => x.json());
    if (r.ok) {
      setSources((prev) => [
        ...prev,
        {
          id: r.id,
          kind,
          label: String(fd.get("label")),
          operator_id: String(fd.get("operator_id") ?? "") || null,
          color: "#2F6BFF",
          last_status: null,
          last_pull_at: null,
          url: String(fd.get("url") ?? "") || null,
          calendar_id: String(fd.get("calendar_id") ?? "") || null,
        },
      ]);
      await load();
      router.refresh();
    }
  }

  const itemsByDay = useMemo(() => {
    const map = new Map<string, HubItem[]>();
    for (const d of days) map.set(d.toDateString(), []);
    for (const it of items) {
      const k = new Date(it.starts_at).toDateString();
      if (map.has(k)) map.get(k)!.push(it);
    }
    for (const list of map.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return map;
  }, [items, days]);

  return (
    <div className="space-y-4">
      {/* Barra strumenti */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setWeekOffset((w) => w - 1)} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">← Settimana</button>
        <button onClick={() => setWeekOffset(0)} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">Oggi</button>
        <button onClick={() => setWeekOffset((w) => w + 1)} className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5">Settimana →</button>
        <div className="grow" />
        <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">
          <Plus className="h-4 w-4" /> Nuovo impegno
        </button>
        <button onClick={pull} disabled={busy === "pull"} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${busy === "pull" ? "animate-spin" : ""}`} /> Sincronizza calendari
        </button>
      </div>
      {pullMsg && <p className="text-xs text-slate-400">{pullMsg}</p>}

      {/* Griglia settimana */}
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d, i) => {
          const list = itemsByDay.get(d.toDateString()) ?? [];
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div key={d.toISOString()} className={`glass rounded-2xl p-3 min-h-40 ${isToday ? "ring-1 ring-brand-500/50" : ""}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className={`text-sm font-bold ${isToday ? "text-brand-400" : "text-slate-200"}`}>
                  {GIORNI_LABEL[i]} {d.getDate()}
                </span>
                {list.length > 0 && <span className="text-[10px] text-slate-500">{list.length}</span>}
              </div>
              <div className="space-y-1.5">
                {loading && <div className="h-8 animate-pulse rounded-lg bg-white/5" />}
                {!loading && list.length === 0 && <p className="text-[11px] text-slate-600">—</p>}
                {list.map((it) => (
                  <div key={it.id} className={`rounded-lg border p-2 text-[11px] leading-tight ${KIND_COLOR[it.kind]}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold">
                        {new Date(it.starts_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                        {it.kind === "callback" && " 📞"}
                        {it.kind === "appointment" && " 🤝"}
                      </span>
                      {it.assigned_ai && <Bot className="h-3 w-3 text-brand-400" aria-label="di Ambrosio" />}
                    </div>
                    <p className="mt-0.5 truncate" title={it.title}>{it.title}</p>
                    <div className="mt-1 flex items-center gap-1">
                      {it.operator_name ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400"><User className="h-2.5 w-2.5" />{it.operator_name}</span>
                      ) : it.assigned_ai ? (
                        <span className="text-[10px] text-brand-400">Ambrosio</span>
                      ) : (
                        <span className="text-[10px] text-slate-500">non assegnato</span>
                      )}
                    </div>
                    {it.source === "internal" && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {operators.slice(0, 2).map((op) => (
                          <button
                            key={op.id}
                            disabled={busy === it.id}
                            onClick={() => assign(it.id, op.id, false)}
                            className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-slate-200 hover:bg-white/20 disabled:opacity-40"
                            title={`Assegna a ${op.first_name}`}
                          >
                            {op.first_name}
                          </button>
                        ))}
                        <button
                          disabled={busy === it.id}
                          onClick={() => assign(it.id, null, true)}
                          className="rounded-full bg-brand-600/20 px-1.5 py-0.5 text-[9px] text-brand-300 hover:bg-brand-600/30 disabled:opacity-40"
                          title="Assegna ad Ambrosio AI"
                        >
                          AI
                        </button>
                        <button
                          disabled={busy === it.id}
                          onClick={() => assign(it.id, null, false)}
                          className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-slate-400 hover:bg-white/10 disabled:opacity-40"
                          title="Rimuovi assegnazione"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda */}
      <p className="text-xs text-slate-500">
        <CalendarDays className="mr-1 inline h-3.5 w-3.5" />
        📞 Richiamo · 🤝 Appuntamento · Impegno = calendario esterno (privacy: titolo offuscato se non sei super admin) · i pulsanti assegnano a persona o ad Ambrosio AI.
      </p>

      {/* Sorgenti + export (super admin configura, tutti vedono) */}
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-200">Calendari collegati</h2>
          {exportToken && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a href={`/api/calendar/export?token=${exportToken}&format=ics`} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5" target="_blank" rel="noreferrer">
                <Link2 className="h-3 w-3" /> Feed ICS (Google/Apple)
              </a>
              <a href={`/api/calendar/export?token=${exportToken}&format=json`} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-slate-300 hover:bg-white/5" target="_blank" rel="noreferrer">
                <Link2 className="h-3 w-3" /> JSON per WAC
              </a>
            </div>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {sources.length === 0 && <p className="text-xs text-slate-500">Nessun calendario esterno collegato: il pull è un no-op. Google usa il service account già configurato (034); Apple/ICS bastano un URL basic.ics.</p>}
          {sources.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="font-medium text-slate-200">{s.label}</span>
                <span className="text-slate-500">{s.kind === "ics" ? "iCal/ICS" : "Google"}</span>
                <span className={s.last_status === "error" ? "text-red-400" : "text-slate-600"}>
                  {s.last_status === "error" ? "errore all'ultimo pull" : s.last_pull_at ? `pull ${new Date(s.last_pull_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "mai sincronizzato"}
                </span>
              </div>
              {isSuper && (
                <button onClick={() => deleteSource(s.id)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-red-400" title="Elimina sorgente e suoi impegni">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {isSuper && (
          <form onSubmit={addSource} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <select name="kind" className="rounded-lg bg-white/5 px-2 py-1.5 text-slate-200">
              <option value="ics">Apple / ICS (URL)</option>
              <option value="gcal">Google (calendar ID)</option>
            </select>
            <input name="label" required placeholder="Etichetta (es. Daniele Apple)" className="rounded-lg bg-white/5 px-2 py-1.5 text-slate-200" />
            <input name="url" placeholder="https://…/basic.ics" className="w-56 rounded-lg bg-white/5 px-2 py-1.5 text-slate-200" />
            <input name="calendar_id" placeholder="calendar ID Google" className="w-44 rounded-lg bg-white/5 px-2 py-1.5 text-slate-200" />
            <select name="operator_id" className="rounded-lg bg-white/5 px-2 py-1.5 text-slate-200">
              <option value="">— di chi è —</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.first_name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-full bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-500">Collega</button>
          </form>
        )}
      </div>

      {/* Form nuovo impegno */}
      {showNew && (
        <div className="glass fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-3xl p-5 shadow-glass-hover">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">Nuovo impegno</h3>
            <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-200">✕</button>
          </div>
          <form onSubmit={create} className="mt-3 grid gap-2 text-sm">
            <input required value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} placeholder="Titolo (es. Call conoscitiva — Rossi)" className="rounded-lg bg-white/5 px-3 py-2 text-slate-100" />
            <div className="flex flex-wrap gap-2">
              <input required type="date" value={newForm.day} onChange={(e) => setNewForm({ ...newForm, day: e.target.value })} className="rounded-lg bg-white/5 px-3 py-2 text-slate-100" />
              <input required type="time" step={900} value={newForm.time} onChange={(e) => setNewForm({ ...newForm, time: e.target.value })} className="rounded-lg bg-white/5 px-3 py-2 text-slate-100" />
              <select value={newForm.minutes} onChange={(e) => setNewForm({ ...newForm, minutes: Number(e.target.value) })} className="rounded-lg bg-white/5 px-3 py-2 text-slate-100">
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 h</option>
              </select>
              <select value={newForm.kind} onChange={(e) => setNewForm({ ...newForm, kind: e.target.value as typeof newForm.kind })} className="rounded-lg bg-white/5 px-3 py-2 text-slate-100">
                <option value="appointment">Appuntamento</option>
                <option value="personal">Impegno personale</option>
                <option value="block">Blocco (non disponibile)</option>
              </select>
              <select value={newForm.operator} onChange={(e) => setNewForm({ ...newForm, operator: e.target.value })} className="rounded-lg bg-white/5 px-3 py-2 text-slate-100">
                <option value="">— assegnatario —</option>
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>{o.first_name}</option>
                ))}
              </select>
            </div>
            {slots.length > 0 && newForm.day === "" && (
              <div className="text-xs text-slate-400">
                Slot liberi: {slots.slice(0, 3).map((s) => `${new Date(s.starts_at).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" })} (${s.operator_name})`).join(" · ")}…
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNew(false)} className="rounded-full px-4 py-2 text-slate-400 hover:text-slate-200">Annulla</button>
              <button type="submit" disabled={busy === "create"} className="rounded-full bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">Crea</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
