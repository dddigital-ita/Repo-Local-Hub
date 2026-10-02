import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { CHANNEL_LABEL_IT, KNOWN_TICKET_CHANNELS, PRIORITY_TONE, getTicketDashboard } from "@/lib/tickets";
import { GlassCard, GlassLinkButton, GlassNotice } from "@/components/glass";
import { cn } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * DASHBOARD TICKET (lettura aggregata, livello 2): risponde alla domanda
 * «stiamo rispettando gli SLA promessi e dove si accumula il volume?»
 * (docs/dashboard-ticket-brief.md). È volutamente separata dalla inbox:
 * lì un solo numero (l'azione dovuta), qui trend e distribuzioni. Zero
 * chart library: le barre sono div in CSS (budget bundle sorvegliato) e
 * i filtri vivono nella query string — niente stato client, link
 * condivisibili come la inbox.
 */

const PERIODS = [
  { days: 7, label: "7 giorni" },
  { days: 30, label: "30 giorni" },
  { days: 90, label: "90 giorni" },
] as const;

/** Serie per canale: stessi colori delle pill della inbox (web blu, email ambra,
 *  whatsapp verde) — il colore deve dire la stessa cosa in tutta l'app. */
const CHANNEL_BAR: Record<string, string> = {
  web: "bg-sky-500/80",
  email: "bg-amber-500/80",
  whatsapp: "bg-emerald-500/80",
};
const CHANNEL_DOT: Record<string, string> = {
  web: "bg-sky-500",
  email: "bg-amber-500",
  whatsapp: "bg-emerald-500",
};

/** Durata compatta in italiano: 45 min · 2,3 h · 1,4 giorni. */
function fmtDur(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `${(Math.round(h * 10) / 10).toString().replace(".", ",")} h`;
  return `${(Math.round((h / 24) * 10) / 10).toString().replace(".", ",")} giorni`;
}

/** Età compatta in ore: 3h · 27h · 4 giorni (oltre 48h conta in giorni). */
function fmtAge(h: number): string {
  if (h >= 48) return `${Math.round(h / 24)} giorni`;
  return `${Math.round(h)}h`;
}

/** Delta vs periodo precedente. `good` fissa la semantica: per le violazioni
 *  salire è male (rosso), per i risolti è bene (verde), «flat» = neutro (gli
 *  aperti non sono né buone né cattive notizie: sono lo stato). Con `label`
 *  cita la grandezza («vs 9 ticket del periodo prec.»). */
function Delta({ n, prev, good, label }: { n: number; prev: number; good: "up" | "down" | "flat"; label?: string }) {
  const diff = n - prev;
  if (prev === 0 && n === 0) return <span className="text-xs text-slate-400">nessun dato nel periodo</span>;
  const up = diff > 0;
  const flat = diff === 0;
  const tone =
    good === "flat" || flat ? "text-slate-500" : up === (good === "up") ? "text-emerald-600" : "text-red-600";
  return (      <span className={cn("text-xs font-medium tabular-nums", tone)}>
      {flat ? "= " : up ? "▲ " : "▼ "}
      {Math.abs(diff)} vs {prev}
      {label ? ` ${label} del periodo prec.` : " del periodo prec."}
    </span>
  );
}

/** Confronto di totali sotto un grafico: «▲ 12 vs 9 ticket del periodo prec.».
 *  Con la finestra precedente vuota il confronto non esiste (non è 0): lo
 *  dichiara invece di fingere un delta dal nulla. La semantica va scelta a
 *  mano: più volume o più aperti NON sono buone notizie (flat), un aging che
 *  si sgonfia sì (down). */
function TrendBadge({ n, prev, label, empty, good = "flat" }: { n: number; prev: number; label: string; empty?: boolean; good?: "up" | "down" | "flat" }) {
  if (empty) return <span className="text-xs text-slate-400">nessun dato nel periodo prec.</span>;
  return <Delta n={n} prev={prev} good={good} label={label} />;
}

/** Barra orizzontale: etichetta + traccia + riempimento + numero. */
function HBar({ label, n, max, fill }: { label: string; n: number; max: number; fill: string }) {
  const pct = max > 0 ? Math.round((n / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-xs text-slate-600" title={label}>{label}</span>
      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-white/40 bg-white/50">
        {/* h-0 diventa una traccia vuota: anche 0 deve leggersi come 0, non come assenza */}
        <div className={cn("h-full rounded-full", fill, n === 0 && "w-0")} style={n > 0 ? { width: `${Math.max(pct, 4)}%` } : undefined} />
      </div>
      <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">{n}</span>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  warn?: boolean;
}) {
  return (
    <GlassCard className={cn("p-4", warn && "ring-1 ring-red-200/70")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", warn ? "text-red-700" : "text-slate-900")}>{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </GlassCard>
  );
}

export default async function TicketDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; channel?: string }>;
}) {
  const { days: daysParam, channel: channelParam } = await searchParams;

  await requireAdmin();
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const days = Number.parseInt(daysParam ?? "30", 10);
  const d = PERIODS.find((p) => p.days === days)?.days ?? 30;

  // Canale: filtra i GRAFICI a valle (i dati arrivano completi dalla lib):
  // i KPI restano globali per scelta da brief — il filtro canale qui serve a
  // guardare le serie, non a riscrivere gli obblighi SLA del team.
  const dash = await getTicketDashboard(d);
  // I canali NOTI restano in tab anche a 0 nella finestra (stessa regola della
  // inbox: una tab che sparisce nasconde metà del sistema); i canali nuovi
  // introdotti da una migration compaiono appena hanno ticket.
  const channelsPresent = [
    ...KNOWN_TICKET_CHANNELS,
    ...dash.mixCanali.map((c) => c.canale).filter((k) => !(KNOWN_TICKET_CHANNELS as readonly string[]).includes(k)),
  ];
  const channel = channelParam && channelsPresent.includes(channelParam) ? channelParam : "all";

  const qs = (over: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { days: d !== 30 ? String(d) : undefined, channel: channel !== "all" ? channel : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/admin/tickets/dashboard${s ? `?${s}` : ""}`;
  };

  // Il canale selezionato filtra le serie del volume a valle (i dati arrivano
  // completi dalla lib): KPI globali, grafici focalizzati — dichiarato qui.
  const volumeSerie = channel === "all" ? dash.volume : dash.volume.filter((v) => v.canale === channel);
  const canaliGrafico = channel === "all" ? Object.keys(CHANNEL_BAR) : [channel];

  const maxGiorno = Math.max(1, ...Object.values(
    volumeSerie.reduce<Record<string, number>>((acc, v) => {
      acc[v.giorno] = (acc[v.giorno] ?? 0) + v.n;
      return acc;
    }, {}),
  ));
  const volumeTotale = volumeSerie.reduce((a, v) => a + v.n, 0);
  const maxBucket = Math.max(1, ...dash.rispostaBuckets.map((b) => b.n));
  const maxCarico = Math.max(1, ...dash.carico.map((c) => c.aperti));
  const hasVolume = volumeTotale > 0;

  // Confronti «vs periodo precedente» per ogni grafico: totali delle STESTE
  // serie sulla finestra shiftata (dalla lib: stesse definizioni, non copie).
  const volumePrevTot = channel === "all"
    ? dash.volumePrev.reduce((a, v) => a + v.n, 0)
    : dash.volumePrev.find((v) => v.canale === channel)?.n ?? 0;
  const bucketPrevTot = dash.rispostaBucketsPrev.reduce((a, b) => a + b.n, 0);
  const agingPrevTot = dash.agingPrev.reduce((a, b) => a + b.n, 0);
  const maxTrend = Math.max(1, ...dash.operatoriTrend.map((o) => o.risposte));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
            <BarChart3 className="h-6 w-6 text-brand-600" aria-hidden />
            Dashboard ticket
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            SLA e accumuli del servizio: la lettura settimanale, non il triage del giorno.
          </p>
        </div>
        {/* Periodo: pill-link come la inbox (niente select client, URL condivisibile). */}
        <nav aria-label="Periodo" className="flex gap-1 rounded-2xl bg-white/40 p-1 ring-1 ring-white/50">
          {PERIODS.map((p) => (
            <Link
              key={p.days}
              href={qs({ days: p.days !== 30 ? String(p.days) : undefined })}
              scroll={false}
              aria-current={d === p.days ? "page" : undefined}
              className={cn(
                "min-h-9 rounded-xl px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                d === p.days ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5" : "text-slate-600 hover:text-slate-900",
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Canale: tab come la inbox, conteggi = volumi della finestra scelta. */}
      <nav aria-label="Canali" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto py-1">
        <Link
          href={qs({ channel: undefined })}
          scroll={false}
          aria-current={channel === "all" ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
            channel === "all" ? "bg-brand-600/90 text-white shadow-glass-btn" : "glass-solid text-slate-600 hover:text-slate-900",
          )}
        >
          Tutti i canali
          <span className={cn("text-xs tabular-nums", channel === "all" ? "font-bold" : "font-medium text-slate-500")}>
            {"\u00A0"}{dash.mixCanali.reduce((a, c) => a + c.totale, 0)}
          </span>
        </Link>
        {channelsPresent.map((key) => {
          const tot = dash.mixCanali.find((c) => c.canale === key)?.totale ?? 0;
          return (
            <Link
              key={key}
              href={qs({ channel: key })}
              scroll={false}
              aria-current={channel === key ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
                channel === key ? "bg-brand-600/90 text-white shadow-glass-btn" : "glass-solid text-slate-600 hover:text-slate-900",
              )}
            >
              {CHANNEL_LABEL_IT[key] ?? key}
              <span className={cn("text-xs tabular-nums", channel === key ? "font-bold" : "font-medium text-slate-500")}>
                {"\u00A0"}{tot}
              </span>
            </Link>
          );
        })}
      </nav>

      {channel !== "all" && (
        <GlassNotice tone="info">
          Serie filtrate sul canale «{CHANNEL_LABEL_IT[channel] ?? channel}». Le 5 carte KPI restano globali: gli SLA sono doveri del team, non di un canale.
        </GlassNotice>
      )}

      {/* RIGA 1 — KPI: sintesi prima di tutto il resto (gerarchia da brief). */}
      <section aria-label="Indicatori chiave" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Aperti"
          value={String(dash.kpi.aperti.n)}
          sub={<Delta n={dash.kpi.aperti.n} prev={dash.kpi.aperti.prev} good="flat" />}
        />
        <KpiCard
          label="Da rispondere"
          value={String(dash.kpi.daRispondere.n)}
          warn={dash.kpi.daRispondere.n > 0}
          sub={
            dash.kpi.daRispondere.oldestH != null ? (
              <span className="text-xs text-slate-600">
                il più vecchio aspetta da <strong className="font-semibold text-orange-700">{fmtAge(dash.kpi.daRispondere.oldestH)}</strong>
              </span>
            ) : (
              <span className="text-xs text-slate-400">coda al passo</span>
            )
          }
        />
        <KpiCard
          label={`Media 1ª risposta (${d}gg)`}
          value={fmtDur(dash.kpi.primaRisposta.minuti)}
          sub={
            <span className="text-xs text-slate-500">
              su {dash.kpi.primaRisposta.n} ticket · target 2h
            </span>
          }
        />
        <KpiCard
          label="Risolti (7gg)"
          value={String(dash.kpi.risolti7.n)}
          sub={<Delta n={dash.kpi.risolti7.n} prev={dash.kpi.risolti7.prev} good="up" />}
        />
        <KpiCard
          label={`Violazioni SLA (${d}gg)`}
          value={String(dash.kpi.violazioni.n)}
          warn={dash.kpi.violazioni.n > 0}
          sub={<Delta n={dash.kpi.violazioni.n} prev={dash.kpi.violazioni.prev} good="down" />}
        />
      </section>

      {/* RIGA 2 — volume/giorno per canale: barre CSS impilate, griglia dei
          giorni CONTINUA (un giorno a 0 è un dato, non un buco da colmare). */}
      <GlassCard className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Volume per giorno</h2>
          <div className="flex flex-wrap gap-3">
            {canaliGrafico.map((key) => (
              <span key={key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span className={cn("h-2.5 w-2.5 rounded-full", CHANNEL_DOT[key])} aria-hidden />
                {CHANNEL_LABEL_IT[key] ?? key}
              </span>
            ))}
          </div>
        </div>
        {hasVolume ? (
          <>
            <div className="no-scrollbar mt-4 overflow-x-auto">
              <div className="flex min-w-full items-end gap-[2px] border-b border-slate-300/60 pb-px" style={{ height: 160 }}>
                {dash.giorni.map((g) => {
                  const perCanale = canaliGrafico.map(
                    (key) => volumeSerie.find((v) => v.giorno === g && v.canale === key)?.n ?? 0,
                  );
                  const tot = perCanale.reduce((a, b) => a + b, 0);
                  const dettaglio = canaliGrafico
                    .map((key, i) => `${CHANNEL_LABEL_IT[key] ?? key}: ${perCanale[i]}`)
                    .join(" · ");
                  return (
                    <div
                      key={g}
                      className="flex h-full min-w-[7px] flex-1 flex-col justify-end gap-[2px]"
                      title={`${g} — ${tot} ticket (${dettaglio})`}
                    >
                      {perCanale.map((n, i) =>
                        n > 0 ? (
                          <div
                            key={canaliGrafico[i]}
                            className={cn("rounded-[3px]", CHANNEL_BAR[canaliGrafico[i]])}
                            style={{ height: `${(n / maxGiorno) * 100}%` }}
                          />
                        ) : null,
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-1 flex min-w-full gap-[2px]">
              {dash.giorni.map((g, i) => {
                const step = Math.ceil(dash.giorni.length / 6);
                const show = i % step === 0 || i === dash.giorni.length - 1;
                return (
                  <span key={g} className="min-w-[7px] flex-1 text-center text-[10px] text-slate-400">
                    {show ? g.slice(8) : ""}
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Nessun ticket negli ultimi {d} giorni.</p>
        )}
        {/* Il confronto vive sotto il grafico anche a zero: il vuoto della
            finestra attuale è un dato, non un motivo per tacere. */}
        <div className="mt-3 border-t border-white/50 pt-2">
          <TrendBadge n={volumeTotale} prev={volumePrevTot} label="ticket" empty={volumePrevTot === 0} />
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* RIGA 3a — distribuzione tempi di prima risposta: il «2–4 ore» è la
            zona di pericolo esattamente dove il target da 2h scade. */}
        <GlassCard className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Tempi di prima risposta ({d}gg)</h2>
          <p className="mt-0.5 text-xs text-slate-500">Quanta parte della coda cade oltre i 2h promessi.</p>
          <div className="mt-4 space-y-2.5">
            {dash.rispostaBuckets.map((b) => (
              <HBar
                key={b.key}
                label={b.label}
                n={b.n}
                max={maxBucket}
                fill={
                  b.key === "le1h"
                    ? "bg-emerald-500/80"
                    : b.key === "1-2h"
                      ? "bg-sky-500/80"
                      : b.key === "2-4h"
                        ? "bg-amber-500/80"
                        : b.key === "oltre4h"
                          ? "bg-orange-500/80"
                          : "bg-red-500/80"
                }
              />
            ))}
          </div>
          <div className="mt-3 border-t border-white/50 pt-2">
            <TrendBadge n={dash.rispostaBuckets.reduce((a, b) => a + b.n, 0)} prev={bucketPrevTot} label="risposte" empty={bucketPrevTot === 0} />
          </div>
        </GlassCard>

        {/* RIGA 3b — carico per operatore: la riga «Non assegnati» è il bacino
            da prendere in carico, non un dato tra gli altri. */}
        <GlassCard className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Carico per operatore</h2>
          <p className="mt-0.5 text-xs text-slate-500">Aperti (barra) e da rispondere (segmento scuro).</p>
          <div className="mt-4 space-y-2.5">
            {dash.carico.map((c) => {
              // Segmento scuro = quota da rispondere DENTRO la barra aperti:
              // proporzionale all'aperti (non al max), mai più lunga della traccia.
              const pctAperti = Math.min(100, (c.aperti / maxCarico) * 100);
              const pctSeg = c.aperti > 0 ? (c.daRispondere / c.aperti) * pctAperti : 0;
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs text-slate-600" title={c.label}>{c.label}</span>
                  <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-white/40 bg-white/50">
                    <div className="h-full rounded-full bg-brand-500/70" style={{ width: `${c.aperti > 0 ? Math.max(pctAperti, 4) : 0}%` }} />
                    {c.daRispondere > 0 && c.aperti > 0 && (
                      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-800/70" style={{ width: `${pctSeg}%` }} />
                    )}
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-600">
                    {c.aperti}
                    {c.daRispondere > 0 && <strong className="font-semibold text-orange-700"> · {c.daRispondere}</strong>}
                  </span>
                </div>
              );
            })}
            {dash.carico.length === 0 && <p className="text-sm text-slate-500">Nessun ticket aperto.</p>}
          </div>
          {/* Ricostruzione al confine: chi era aperto alla fine della finestra
              precedente (chiuso o archiviato dopo conta come aperto). */}
          <div className="mt-3 border-t border-white/50 pt-2">
            <TrendBadge
              n={dash.carico.reduce((a, c) => a + c.aperti, 0)}
              prev={dash.caricoApertiPrev}
              label="aperti"
              empty={dash.caricoApertiPrev === 0}
            />
          </div>
        </GlassCard>
      </div>

      {/* RIGA 4 — aging + mix: due tabelle compatte affiancate sul desktop. */}
      <GlassCard className="p-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Aging del backlog aperto</h2>
            <p className="mt-0.5 text-xs text-slate-500">Gli oltre 7 giorni sono gli zombie che la coda ordinata nasconde in fondo.</p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {dash.aging.map((a) => (
                  <tr key={a.key} className="border-b border-white/50 last:border-0">
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">{a.label}</th>
                    <td className="py-2 text-right font-semibold tabular-nums text-slate-900">{a.n}</td>
                    <td className="py-2 text-right text-xs tabular-nums text-slate-400" title="Stessa fascia al confine del periodo precedente">{dash.agingPrev.find((p) => p.key === a.key)?.n ?? 0}</td>
                    <td className="w-1/3 py-2 pl-3">
                      <div className="h-2 overflow-hidden rounded-full bg-white/50">
                        <div
                          className={cn("h-full rounded-full", a.key === "oltre7g" ? "bg-red-500/80" : "bg-brand-500/60")}
                          style={{ width: `${Math.round((a.n / Math.max(1, ...dash.aging.map((x) => x.n))) * 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2">
              <TrendBadge
                n={dash.aging.reduce((a, b) => a + b.n, 0)}
                prev={agingPrevTot}
                label="in coda"
                good="down"
                empty={agingPrevTot === 0}
              />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Mix canale e priorità</h2>
            <p className="mt-0.5 text-xs text-slate-500">Email a 0 non è pace: il canale muore in silenzio senza «Sincronizza».</p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {dash.mixCanali.map((c) => (
                  <tr key={c.canale} className="border-b border-white/50 last:border-0">
                    <th scope="row" className="py-2 text-left font-medium text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", CHANNEL_DOT[c.canale] ?? "bg-slate-400")} aria-hidden />
                        {c.label}
                      </span>
                    </th>
                    <td className="py-2 text-right tabular-nums text-slate-700">{c.totale}</td>
                    <td className="py-2 text-right text-xs tabular-nums text-slate-400" title="Periodo precedente">{dash.volumePrev.find((p) => p.canale === c.canale)?.n ?? 0}</td>
                    <td className="py-2 pl-3 text-right text-xs tabular-nums">
                      {c.daRispondere > 0 ? (
                        <strong className="font-semibold text-orange-700">{c.daRispondere} da rispondere</strong>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {dash.mixCanali.length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-slate-500">Nessun ticket nella finestra.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dash.mixPriorita.map((p) => (
                <span key={p.priorita} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", PRIORITY_TONE[p.priorita] ?? "bg-slate-100/70 text-slate-500")}>
                  {p.label} <span className="tabular-nums">{p.n}</span>
                </span>
              ))}
              {dash.mixPriorita.length === 0 && <span className="text-xs text-slate-400">Nessuna priorità impostata sul backlog aperto.</span>}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* TENDENZA PER OPERATORE: chi fa cosa e se sta crescendo. L'attività
          è attribuita a chi l'ha fatta (autore del messaggio operatore, chi
          ha chiuso); i confronti sono sulla finestra scelta. La riga di un
          operatore compare anche senza risposte nella finestra (prevRisposte
          > 0: se sparisse, un periodo di pausa sembrerebbe un'estinzione).
          Zero-coperta (0/0) si dichiara, non si nasconde. */}
      <GlassCard className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">Tendenza per operatore ({d}gg)</h2>
          <p className="text-xs text-slate-500">Risposte scritte (barra) · chiusure · media 1ª risposta sulle proprie conversazioni.</p>
        </div>
        <div className="mt-4 space-y-3">
          {dash.operatoriTrend.map((o) => {
            const zeroCoperta = o.risposte === 0 && o.prevRisposte === 0;
            const pct = maxTrend > 0 && o.risposte > 0 ? Math.max((o.risposte / maxTrend) * 100, 4) : 0;
            const prevPct = maxTrend > 0 && o.prevRisposte > 0 ? (o.prevRisposte / maxTrend) * 100 : 0;
            return (
              <div key={o.label} data-testid="trend-row" data-name={o.label}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-slate-800" title={o.label}>{o.label}</span>
                  <span className="text-xs tabular-nums text-slate-600">
                    {zeroCoperta ? (
                      <span className="text-slate-400">nessuna risposta ora né nel periodo prec.</span>
                    ) : (
                      <>
                        {o.risposte} risposte{" "}
                        <Delta n={o.risposte} prev={o.prevRisposte} good="flat" label="risposte" />{" · "}
                        {o.chiusi} chiusi{" "}
                        <Delta n={o.chiusi} prev={o.prevChiusi} good="up" label="chiusi" />
                      </>
                    )}
                    {o.mediaRisposta != null && (
                      <>
                        {" · "}media {fmtDur(o.mediaRisposta)}
                      </>
                    )}
                  </span>
                </div>
                <div className="relative mt-1 h-3 overflow-hidden rounded-full border border-white/40 bg-white/50">
                  {/* Ghost del periodo precedente: la tendenza si LEGGE sullo
                      stesso righello, senza incrociare due grafici. */}
                  {prevPct > 0 && (
                    <div className="absolute inset-y-0 left-0 rounded-full border-r border-slate-400/50 bg-slate-200/60" style={{ width: `${Math.max(prevPct, 2)}%` }} aria-hidden />
                  )}
                  <div
                    className="h-full rounded-full bg-brand-500/70"
                    style={o.risposte > 0 ? { width: `${pct}%` } : undefined}
                  />
                </div>
              </div>
            );
          })}
          {dash.operatoriTrend.length === 0 && (
            <p className="text-sm text-slate-500">Nessuna attività del team nella finestra (né risposte né chiusure).</p>
          )}
        </div>
      </GlassCard>

      {/* RIGA 5 — l'uscita trasforma la lettura in azione (stesso gesto della
          inbox vuota); il caveat resta onesto e visibile, non nascosto in doc. */}
      <footer className="flex flex-wrap items-center justify-between gap-4">
        <GlassLinkButton href="/admin/tickets?f=da_rispondere" size="md">
          Vai alla coda «Da rispondere»
          <ArrowRight className="h-4 w-4" aria-hidden />
        </GlassLinkButton>
        <p className="max-w-md text-xs leading-relaxed text-slate-400">
          Violazioni storiche calcolate sulla soglia 2h: se la policy SLA è cambiata nel tempo, il retrospettivo è un&apos;approssimazione. Le riaperture non sono tracciate dal sistema.
        </p>
      </footer>
    </div>
  );
}
