import Link from "next/link";
import { Target, PhoneCall, Flame, Ticket, Clock, BarChart3, ClipboardList, ChevronRight, Coins } from "lucide-react";
import { GlassCard } from "@/components/glass";
import { HubStatus } from "@/components/settings-hub";
import { db, dbConfigured } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getOverviewConfig } from "@/lib/overview-status";
import { sumPortfolioBudget } from "@/lib/clients";
import { recallsAgendaStatus, slaAgendaStatus } from "@/lib/settings-status";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  await requireAdmin();
  const pool = db();
  const funnel = { conversations: 0, leads: 0, callbacks: 0 };
  let hotLeads = 0;
  let newLeads = 0;
  let openTickets = 0;
  let slaBreaches = 0;

  // Reminder (Fase 2): i lead con «richiama il» arrivato oggi o già passato.
  // La promessa presa in fase di qualificazione diventa un compito visibile:
  // senza cron, è la dashboard a sollecitare chi apre l'admin.
  let recalls: { id: string; name: string; phone: string; ricontatta_il: string }[] = [];
  let recallsTotal = 0;
  let recallsOverdue = 0;
  if (pool) {
    try {
      // Stessa finestra del reminder (Fase 2): entro 12h e non chiusi. Il
      // conteggio COMPLETO alimenta la pill dell'agenda (l'elenco resta
      // limitato a 5), «overdue» qualifica le promesse già scadute.
      const { rows } = await pool.query<{
        id: string;
        name: string;
        phone: string;
        ricontatta_il: string;
        total: string;
        overdue: string;
      }>(
        `select id, name, phone, ricontatta_il,
                (select count(*) from leads
                  where ricontatta_il is not null
                    and ricontatta_il < now() + interval '12 hours'
                    and status <> 'chiuso') as total,
                (select count(*) from leads
                  where ricontatta_il is not null
                    and ricontatta_il < now() + interval '12 hours'
                    and status <> 'chiuso'
                    and ricontatta_il < now()) as overdue
         from leads
         where ricontatta_il is not null
           and ricontatta_il < now() + interval '12 hours'
           and status <> 'chiuso'
         order by ricontatta_il asc
         limit 5`,
      );
      recalls = rows;
      recallsTotal = Number(rows[0]?.total ?? 0);
      recallsOverdue = Number(rows[0]?.overdue ?? 0);
    } catch (e) {
      console.error("[admin] recalls:", e);
    }
  }

  if (pool) {
    try {
      const { rows } = await pool.query<{
        conversations: string;
        leads: string;
        callbacks: string;
        hot: string;
        fresh: string;
        open_tickets: string;
        sla_breach: string;
      }>(
        `select
           (select count(*) from conversations where created_at > now() - interval '30 days') as conversations,
           (select count(*) from conversations where status <> 'closed') as open_tickets,
           (select count(*) from conversations where status <> 'closed' and first_response_at is null and created_at < now() - interval '2 hours') as sla_breach,
           (select count(*) from leads where created_at > now() - interval '30 days') as leads,
           (select count(*) from callbacks where created_at > now() - interval '30 days') as callbacks,
           (select count(*) from leads where hot and created_at > now() - interval '30 days') as hot,
           (select count(*) from leads where status = 'nuovo' and created_at > now() - interval '30 days') as fresh`,
      );
      const r = rows[0];
      if (r) {
        funnel.conversations = Number(r.conversations);
        funnel.leads = Number(r.leads);
        funnel.callbacks = Number(r.callbacks);
        hotLeads = Number(r.hot);
        newLeads = Number(r.fresh);
        openTickets = Number(r.open_tickets);
        slaBreaches = Number(r.sla_breach);
      }
    } catch (e) {
      console.error("[admin]", e);
    }
  }

  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  /** Agenda di oggi: le stesse funzioni pure delle pill degli hub, per
      DUE piani — operativo (SLA, promesse: si agisce oggi) e configurazione
      (schede incomplete: si completa quando si può). */
  const [config, slaRow, recallsRow, portfolio] = await Promise.all([
    getOverviewConfig(),
    Promise.resolve(slaAgendaStatus(slaBreaches, openTickets)),
    Promise.resolve(recallsAgendaStatus(recallsTotal, recallsOverdue)),
    sumPortfolioBudget(),
  ]);

  const KPIS = [
    {
      label: "Ticket aperti",
      value: openTickets,
      sub: slaBreaches ? `${slaBreaches} in ritardo SLA` : "tutti entro SLA",
      Icon: Ticket,
      tint: slaBreaches ? "bg-red-500/90" : "bg-blue-500/90",
    },
    {
      label: "Lead",
      value: funnel.leads,
      sub: `${rate(funnel.leads, funnel.conversations)} delle chat`,
      Icon: Target,
      tint: "bg-brand-600/90",
    },
    { label: "Callback fissate", value: funnel.callbacks, Icon: PhoneCall, tint: "bg-violet-500/90" },
    {
      label: "Lead «hot»",
      value: hotLeads,
      sub: `${newLeads} ancora da contattare`,
      Icon: Flame,
      tint: "bg-orange-500/90",
    },
    {
      // Valore commerciale del portafoglio: lo stesso layer della lista
      // Clienti (estrazione testata; senza DB «—», mai uno zero finto).
      label: "Portafoglio clienti",
      value: portfolio != null ? `~${portfolio.toLocaleString("it-IT")} €` : "—",
      sub: "budget dichiarato",
      Icon: Coins,
      tint: "bg-emerald-500/90",
      small: true,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <BarChart3 className="h-6 w-6 text-brand-600" aria-hidden />
          Ultimi 30 giorni
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Funnel: visita → ricerca → chat → lead → chiamata. Gli eventi GA4 completi sono in{" "}
          <Link href="/admin/settings/google" className="text-brand-700 underline">Google growth kit</Link>.
        </p>
      </div>

      {!dbConfigured() && (
        <p className="rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 backdrop-blur-xl">
          DATABASE_URL non configurata: i dati non vengono salvati. Vedi SETUP.md → Neon.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map((k) => (
          <GlassCard key={k.label} hover>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
                <p className={`mt-1 font-bold text-slate-900 ${"small" in k && k.small ? "text-2xl" : "text-3xl"}`}>{k.value}</p>
                {k.sub && <p className="mt-1 text-xs text-slate-500">{k.sub}</p>}
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${k.tint} text-white shadow-glass-btn backdrop-blur-xl`}>
                <k.Icon className="h-5 w-5" aria-hidden />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>



      {/* ── Agenda di oggi: operativo (si agisce ora) + configurazione ── */}
      <GlassCard>
        <p className="flex items-center gap-2 font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-brand-600" aria-hidden />
          Agenda di oggi
        </p>

        {/* Operativo: scadenze violata = rosso, carico in arrivo = ambra. */}
        <p className="mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Operativo</p>
        <div className="mt-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60">
            <Link
              href="/admin/tickets"
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-brand-700"
            >
              SLA dei ticket
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            </Link>
            <HubStatus ok={slaRow.ok} warn={slaRow.warn} danger={!slaRow.ok && !slaRow.warn} label={slaRow.label} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60">
            <Link
              href="/admin/leads"
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-brand-700"
            >
              Promesse da richiamare
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            </Link>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <HubStatus ok={recallsRow.ok} warn={recallsRow.warn} danger={!recallsRow.ok && !recallsRow.warn} label={recallsRow.label} />
            </div>
          </div>
          {/* Chi e quando: il dettaglio delle promesse resta qui, come nel
              vecchio blocco — la pill riassume, l'elenco rende operativo. */}
          {recalls.length > 0 && (
            <ul className="space-y-2 px-1">
              {recalls.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-800">
                    <strong className="font-semibold">{r.name}</strong> ·{" "}
                    <a href={`tel:${r.phone}`} className="text-brand-700 hover:underline">{r.phone}</a> ·{" "}
                    richiamare {new Date(r.ricontatta_il).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Link
                    href="/admin/leads"
                    className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200/70 transition hover:bg-white"
                  >
                    Apri il lead
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Configurazione: si completa quando si può (stessa regola degli hub). */}
        <p className="mt-4 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Configurazione</p>
        <div className="mt-1 space-y-2">
          {config.map((row) => (
            <div
              key={row.href}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/55 px-4 py-3 ring-1 ring-white/60"
            >
              <Link
                href={row.href}
                className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-brand-700"
              >
                {row.label}
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              </Link>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {row.pending.map(({ label, href }) => (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200/70 transition hover:bg-white"
                  >
                    {label}
                    <ChevronRight className="ml-0.5 inline h-3 w-3" aria-hidden />
                  </Link>
                ))}
                <HubStatus ok={row.ok} warn={row.warn} label={row.summary} />
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard>
        <p className="font-semibold text-slate-900">Da fare adesso</p>
        <ul className="mt-3 space-y-2.5 text-sm text-slate-600">
          <li className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600/90 text-white shadow-glass-btn backdrop-blur-xl">
              <Ticket className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <Link href="/admin/tickets" className="font-medium text-brand-700 hover:underline">Ticket</Link>:
              rispondi ai ticket aperti (il visitatore vede entro pochi secondi).
            </span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/90 text-white shadow-glass-btn backdrop-blur-xl">
              <Target className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <Link href="/admin/leads" className="font-medium text-brand-700 hover:underline">Lead</Link>:
              aggiorna la pipeline (nuovo → contattato → chiuso) ed esporta il CSV.
            </span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/90 text-white shadow-glass-btn backdrop-blur-xl">
              <Clock className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <Link href="/admin/operators" className="font-medium text-brand-700 hover:underline">Operatori</Link>:
              se oggi cambi turno, togli la disponibilità.
            </span>
          </li>
        </ul>
      </GlassCard>
    </div>
  );
}
