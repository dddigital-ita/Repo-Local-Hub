import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock,
  Cpu,
  Database,
  Gauge,
  HeartPulse,
  HelpCircle,
  KeyRound,
  MessageSquareDashed,
  Moon,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { getSystemHealth } from "@/lib/health";
import { getAmbrosioStatuses } from "@/lib/ambrosio-status-server";
import {
  getLatencyStats24h,
  getProviderKeyStatuses,
  getProviderUsageStats,
  PROVIDERS,
  type AiStats,
} from "@/lib/ai";
import { LATENCY_ALERT_MS, latencyVerdict, EMPTY_LATENCY } from "@/lib/latency-shared";
import { ACCESS_LABELS, accessList, AMBROSIO_LEVELS, levelLabel, type AmbrosioLevel } from "@/lib/ambrosio-autonomy";
import { db } from "@/lib/db";
import { SubPageHeader } from "@/components/sub-page-header";
import { GlassNotice } from "@/components/glass";
import { UiIcon } from "@/components/icon-registry";

export const dynamic = "force-dynamic";

export const metadata = { title: "Inventario AI · Ambrosio", robots: { index: false } };

const IT = "it-IT";
const dt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(IT, { dateStyle: "short", timeStyle: "short" }) : "—";

const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(
  PROVIDERS.map((p) => [p.key, p.label]),
);
const providerLabel = (k: string) => PROVIDER_LABEL[k] ?? k;

/** Livello validato per il cuore (la view lo porta come number): 2/3 restano, tutto il resto è L1. */
const lv = (n: number | null | undefined): AmbrosioLevel => (n === 2 || n === 3 ? n : 1);

/** 850 → «850 ms», 7200 → «7.2 s» (stile delle quote provider). */
const fmtMs = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

/** Pill di stato: verde/ambra/grigio, con icona decorativa per chi non distingue i colori. */
function Pill({
  ok,
  warn,
  title,
  children,
}: {
  ok: boolean;
  warn?: boolean;
  /** Spiegazione accessibile del perché dello stato (aria-label + tooltip nativo). */
  title?: string;
  children?: React.ReactNode;
}) {
  const tone =
    warn
      ? "bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/70"
      : ok
        ? "bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/70"
        : "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70";
  const Icon = warn ? CircleDashed : ok ? CheckCircle2 : CircleDashed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}
      {...(title ? { title, "aria-label": title } : {})}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

/** Riga «modulo → cosa fa → dove si regola», il pattern di tutta la mappa. */
function ModuleRow({
  Icon,
  title,
  desc,
  href,
  linkLabel,
  status,
}: {
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  desc: string;
  href?: string;
  linkLabel?: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 ring-1 ring-white/70">
            <Icon className="h-4.5 w-4.5 text-brand-700" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{title}</p>
            <p className="text-xs leading-relaxed text-slate-500">{desc}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status}
          {href && (
            <Link href={href} className="text-[11px] font-semibold text-brand-700 hover:underline">
              {linkLabel ?? "Apri"} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function AiInventoryPage() {
  await requireAdmin();

  /* ── Una sola ondata di letture (stesso stile di ambrosio-status-server) ── */
  const [hub, health, keyStatuses, usage, lat] = await Promise.all([
    getAmbrosioStatuses().catch(() => null),
    getSystemHealth().catch(() => null),
    getProviderKeyStatuses().catch(() => []),
    getProviderUsageStats(30).catch(() => [] as Awaited<ReturnType<typeof getProviderUsageStats>>),
    getLatencyStats24h().catch(() => EMPTY_LATENCY),
  ]);
  const latVerdict = latencyVerdict(lat);
  const view = hub?.view ?? null;

  const stats: AiStats = view?.stats ?? {
    conversations: 0, replies: 0, nightConversations: 0, questions: [], questionCounts: [], leads: 0, repliesPerConv: "—",
  };
  const statuses = hub?.statuses ?? {
    training: { key: "addestramento", ok: true, warn: false, label: "—", counts: [] },
    config: { key: "configurazione", ok: false, warn: false, label: "Disattivata", counts: [] },
    provider: { key: "provider", ok: false, warn: true, label: "Chiave mancante", counts: [] },
    autonomy: { key: "autonomia", ok: true, warn: false, label: "L1 · Contatto", counts: [] },
    documents: { key: "documenti", ok: false, warn: true, label: "Nessun documento", counts: [] },
    proposals: { key: "proposte", ok: true, warn: false, label: "Nessuna da revisionare", counts: [] },
  };
  const { training, config, provider, documents, proposals } = statuses;

  /* ── Ultimo audit AI + ultimo intervento del cron (fallback memoria se il DB manca) ── */
  const pool = db();
  let lastAiAudit: { actor: string; action: string; target: string | null; detail: string | null; created_at: string } | null = null;
  let lastCron: { action: string; created_at: string } | null = null;
  if (pool) {
    try {
      const ai = await pool.query(
        "select actor, action, target, detail, created_at from audit_log where actor = 'ambrosio@ai' order by created_at desc limit 1",
      );
      lastAiAudit = ai.rows[0] ?? null;
      const cr = await pool.query(
        "select action, created_at from audit_log where actor = 'system' and action like 'cron.%' order by created_at desc limit 1",
      );
      lastCron = cr.rows[0] ?? null;
    } catch {
      /* tabelle non migrate: le card restano «nessun dato» */
    }
  }

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={Sparkles}
        tone="text-violet-600"
        title="Inventario AI — funzioni e salute"
        subtitle="La mappa completa di Ambrosio in una pagina: cosa esiste, come sta, dove si regola. Dati di salute condivisi con /api/health (monitoraggi uptime esterni)."
      />

      {/* ── STATO VITALE ─────────────────────────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill ok={view?.enabled ?? false} warn={Boolean(view?.enabled === false && view?.hasKey)}>
            {view?.enabled ? "Attiva" : "Disattivata"}
          </Pill>
          <Pill ok={view?.hasKey ?? false} warn={!view?.hasKey}>
            {view?.hasKey ? "Chiave salvata (cifrata)" : "Chiave API mancante"}
          </Pill>
          {view?.provider && (
            <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-white/50">
              {providerLabel(view.provider)} · {view.model}
            </span>
          )}
          <Pill ok>{levelLabel(lv(view?.level))}</Pill>
          {view?.movesCap != null && (
            <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-white/50">
              Tetto {view.movesCap} mosse (L2)
            </span>
          )}
          {view?.takeoverSla && (
            <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-white/50">
              Take-over SLA L3 attivo
            </span>
          )}
          {lat.count > 0 && (
            <Pill ok={latVerdict === "ok"} warn={latVerdict === "warn"}>
              p95 {fmtMs(lat.p95Ms ?? 0)} (24h)
            </Pill>
          )}
        </div>
      </section>

      {/* ── MAPPA DEI MODULI ─────────────────────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Wrench className="h-4 w-4 text-violet-600" aria-hidden />
          Mappa delle funzioni
        </h2>
        <div className="mt-3 grid gap-3">
          <ModuleRow
            Icon={Bot}
            title="Chat e risposta automatica"
            desc="Risponde fuori turno, multilingua (it/en/de/fr/es), con FAQ ufficiali, pacchetti e documenti interni nel prompt. Tracking FAQ → conversioni."
            status={<Pill ok={config.ok} warn={config.warn}>{config.label}</Pill>}
            href="/admin/ai/configurazione"
          />
          <ModuleRow
            Icon={Gauge}
            title="Autonomia a 3 livelli"
            desc="L1 Contatto (4 domande + richiamata) · L2 Qualifica (tetto mosse, poi handoff) · L3 Proposta (take-over SLA, bozza con preventivo)."
            status={<Pill ok>{levelLabel(lv(view?.level))}</Pill>}
            href="/admin/ai/autonomia"
          />
          <ModuleRow
            Icon={KeyRound}
            title="Intelligenze multiple"
            desc="Chiavi cifrate AES-256-GCM con fallback a catena: se il primario fallisce, la chat non si blocca. Log di chi risponde davvero."
            status={<Pill ok={provider.ok} warn={provider.warn}>{provider.label}</Pill>}
            href="/admin/ai/provider"
          />
          <ModuleRow
            Icon={ScrollText}
            title="Addestramento FAQ"
            desc="Le domande vere dei clienti diventano risposte ufficiali, con traduzioni approvate e suggerimenti dalle chat reali."
            status={<Pill ok={training.ok} warn={training.warn}>{training.label}</Pill>}
            href="/admin/ai/addestramento"
          />
          <ModuleRow
            Icon={ScrollText}
            title="Documenti interni"
            desc="La biblioteca che istruisce Ambrosio: procedure, politiche e prezzi. A L3 Ambrosio può citare la fonte, a L1/L2 usa in silenzio."
            status={<Pill ok={documents.ok} warn={documents.warn}>{documents.label}</Pill>}
            href="/admin/ai/documenti"
          />
          <ModuleRow
            Icon={Send}
            title="Proposte con preventivo"
            desc="Le bozze preparate da Ambrosio (solo L3, mai inviate da sole): il team revisiona, approva, invia."
            status={<Pill ok={proposals.ok} warn={proposals.warn}>{proposals.label}</Pill>}
            href="/admin/ai/proposte"
          />
          <ModuleRow
            Icon={ShieldCheck}
            title="Sicurezza e limiti"
            desc="Rate limit 10 domande/min per IP + Shield, consenso esplicito prima di ogni contatto, priorità solo alzata, audit append-only su ogni azione."
            status={<Pill ok />}
            href="/admin/audit"
            linkLabel="Audit"
          />
          <ModuleRow
            Icon={HelpCircle}
            title="Prova dal vivo"
            desc="Simula una domanda cliente e leggi la risposta reale della catena di provider."
            href="/admin/ai/test"
            linkLabel="Apri"
          />
        </div>
      </section>

      {/* ── GATE DI AUTONOMIA ────────────────────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Gauge className="h-4 w-4 text-violet-600" aria-hidden />
          Gate di autonomia — livello attivo {levelLabel(lv(view?.level))}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Il gate è una proprietà della configurazione, non della buona volontà del modello: un tool fuori lista non viene eseguito MAI.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {AMBROSIO_LEVELS.map((l) => {
            const active = lv(view?.level) === l.level;
            const tools = accessList(l.level);
            return (
              <div
                key={l.level}
                className={`rounded-2xl p-4 ring-1 ${active ? "bg-brand-50/50 ring-brand-300/60" : "bg-white/60 ring-white/50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-900">{l.name}</span>
                  {active ? <Pill ok>attivo</Pill> : <span className="text-[11px] text-slate-400">—</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{l.tagline}</p>
                <ul className="mt-2.5 space-y-1">
                  {tools.length === 0 && (
                    <li className="text-[11px] text-slate-400">Nessun tool: solo conversazione e qualificazione a bottoni.</li>
                  )}
                  {tools.map((fn) => (
                    <li key={fn} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden />
                      {ACCESS_LABELS[fn]}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── STATISTICHE 30 GIORNI ────────────────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Activity className="h-4 w-4 text-violet-600" aria-hidden />
          Attività degli ultimi 30 giorni
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <MessageSquareDashed className="h-3.5 w-3.5" aria-hidden />
              Conversazioni
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.conversations}</p>
            <p className="text-[11px] text-slate-500">{stats.replies} risposte · {stats.repliesPerConv} per chat</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Moon className="h-3.5 w-3.5" aria-hidden />
              Di notte o weekend
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.nightConversations}</p>
            <p className="text-[11px] text-slate-500">fuori dai turni del team</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Lead generati
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.leads}</p>
            <p className="text-[11px] text-slate-500">dalle chat con Ambrosio</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
              Domande ricevute
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{stats.questions.length || "—"}</p>
            <p className="text-[11px] text-slate-500">elenco in «Addestramento»</p>
          </div>
        </div>
        {stats.conversations === 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Nessuna conversazione gestita ancora: le statistiche compaiono alla prima risposta di Ambrosio.
          </p>
        )}
      </section>

      {/* ── PROVIDER: CHI RISPONDE DAVVERO ───────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Cpu className="h-4 w-4 text-violet-600" aria-hidden />
          Intelligenze — chi risponde davvero (30 giorni)
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDERS.map((p) => {
            const st = keyStatuses.find((k) => k.provider === p.key);
            const u = usage.find((x) => x.provider === p.key);
            const isPrimary = view?.provider === p.key;
            return (
              <div
                key={p.key}
                className={`rounded-2xl p-4 ring-1 ${isPrimary ? "bg-brand-50/50 ring-brand-300/60" : "bg-white/60 ring-white/50"}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{p.label.split(" ")[0]}</span>
                  <span className="flex items-center gap-1.5">
                    {isPrimary && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                        Primario
                      </span>
                    )}
                    <Pill ok={Boolean(st?.hasKey)} warn={!st?.hasKey && st?.enabled}>
                      {st?.hasKey ? "chiave salvata" : st?.enabled === false ? "disattivato" : "nessuna chiave"}
                    </Pill>
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">modello: {st?.model || p.defaultModel || "—"}</p>
                {u ? (
                  <p className="mt-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{u.pct}%</span> delle risposte ({u.uses})
                    {u.fallbackUses > 0 && <> · <span className="font-semibold text-amber-600">{u.fallbackUses} dopo fallback</span></>}
                    {u.avgLatencyMs != null && <> · {u.avgLatencyMs < 1000 ? `${u.avgLatencyMs} ms` : `${(u.avgLatencyMs / 1000).toFixed(1)} s`} media</>}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">nessuna risposta negli ultimi 30 giorni</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Le quote storiche arrivano da ai_provider_log (migration 029): ogni risposta registra chi ha risposto, i fallback provati prima e la latenza.
        </p>
      </section>

      {/* ── CRONOMETRO DI LATENZA (ultime 24 ore) ────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900">
          <Timer className="h-4 w-4 text-violet-600" aria-hidden />
          Cronometro di latenza — ultime 24 ore
          {lat.count === 0 && <Pill ok={false}>Nessuna risposta misurata</Pill>}
          {lat.count > 0 && latVerdict === "ok" && <Pill ok>Entro soglia</Pill>}
          {latVerdict === "warn" && <Pill ok={false} warn title="Il 95% delle risposte arriva entro la soglia, ma le restanti no: un outlier reale che la media da sola nasconde.">p95 sopra soglia</Pill>}
          {latVerdict === "alert" && <Pill ok={false} warn title="Anche la media supera la soglia: la lentezza non è un outlier, è la norma di questa finestra.">media sopra soglia</Pill>}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <MessageSquareDashed className="h-3.5 w-3.5" aria-hidden />
              Risposte misurate
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lat.count}</p>
            <p className="text-[11px] text-slate-500">dal log dei provider (migration 029)</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Latenza media
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lat.avgMs != null ? fmtMs(lat.avgMs) : "—"}</p>
            <p className="text-[11px] text-slate-500">obiettivo: sotto {fmtMs(LATENCY_ALERT_MS)}</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Timer className="h-3.5 w-3.5" aria-hidden />
              p95
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{lat.p95Ms != null ? fmtMs(lat.p95Ms) : "—"}</p>
            <p className="text-[11px] text-slate-500">il 95% delle risposte arriva entro</p>
          </div>
        </div>
        {latVerdict === "alert" && (
          <div className="mt-3">
            <GlassNotice tone="warning">
              Anche la <strong>media</strong> supera {fmtMs(LATENCY_ALERT_MS)}: la lentezza non è un outlier ma la norma di
              questa finestra. Controlla il primario e le righe «dopo fallback» in «Intelligenze — chi risponde davvero»:
              ogni salto di catena aggiunge un tentativo fallito prima della risposta.
            </GlassNotice>
          </div>
        )}
        {lat.count === 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Nessuna risposta nelle ultime 24 ore (o tabella non ancora migrata): il cronometro parte dalla prima risposta di Ambrosio.
          </p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          La soglia d&apos;allarme è {fmtMs(LATENCY_ALERT_MS)}. Il p95 usa interpolazione lineare, come i monitor APM: un picco raro lo vede
          solo il p95, la media resta com&apos;è — per questo l&apos;avviso scatta prima sul p95 e diventa allarme solo se la media la supera.
        </p>
      </section>

      {/* ── SALUTE DELLA PIATTAFORMA (condivisa con /api/health) ─────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <HeartPulse className="h-4 w-4 text-violet-600" aria-hidden />
          Salute della piattaforma
          <span className="ml-1 text-[10px] font-medium normal-case text-slate-400">(la stessa di /api/health)</span>
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Database className="h-3.5 w-3.5" aria-hidden />
              Database
            </p>
            <p className="mt-2">
              {health ? (
                <Pill ok={health.database === "ok"} warn={health.database === "unconfigured"}>
                  {health.database === "ok" ? "OK" : health.database === "unconfigured" ? "Non configurato" : "GIÙ"}
                </Pill>
              ) : (
                <Pill ok={false}>Indisponibile</Pill>
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Send className="h-3.5 w-3.5" aria-hidden />
              Email (Resend)
            </p>
            <p className="mt-2">
              <Pill ok={Boolean(health?.notify.email)}>{health?.notify.email ? "Configurata" : "Non configurata"}</Pill>
            </p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Send className="h-3.5 w-3.5" aria-hidden />
              Telegram
            </p>
            <p className="mt-2">
              <Pill ok={Boolean(health?.notify.telegram)}>{health?.notify.telegram ? "Configurato" : "Non configurato"}</Pill>
            </p>
            {health?.telegramChannel.enabled && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                Canale Ambrosio:{" "}
                {health.telegramChannel.mode === "webhook" && (
                  <UiIcon name="webhook" size={11} className="text-emerald-600" />
                )}
                {health.telegramChannel.mode === "webhook"
                  ? "webhook attivo"
                  : health.telegramChannel.mode === "webhook-no-secret"
                    ? "webhook (senza secret)"
                    : health.telegramChannel.mode === "polling"
                      ? "polling cron"
                      : "off"}
              </p>
            )}
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              In turno ora
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {health && health.operatorsOnDuty.length > 0 ? health.operatorsOnDuty.join(", ") : "Nessuno (copre Ambrosio)"}
            </p>
            <p className="text-[11px] text-slate-500">finestre dei turni di Daniele e Michele</p>
          </div>
        </div>
      </section>

      {/* ── ULTIMO AUDIT ─────────────────────────────────────────────── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <ScrollText className="h-4 w-4 text-violet-600" aria-hidden />
          Ultimo audit
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ultima azione di Ambrosio</p>
            {lastAiAudit ? (
              <>
                <p className="mt-1 text-sm font-bold text-slate-900">{lastAiAudit.action}</p>
                <p className="text-xs text-slate-500">{lastAiAudit.detail ?? "—"}</p>
                <p className="mt-1 text-[11px] text-slate-400">{dt(lastAiAudit.created_at)}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-400">nessuna azione registrata (firma «ambrosio@ai»)</p>
            )}
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ultimo intervento del cron</p>
            {lastCron ? (
              <>
                <p className="mt-1 text-sm font-bold text-slate-900">{lastCron.action}</p>
                <p className="mt-1 text-[11px] text-slate-400">{dt(lastCron.created_at)}</p>
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-400">nessun intervento registrato (SLA, follow-up, take-over…)</p>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          Il log di audit è append-only: nessuna azione si può riscrivere. L&apos;elenco completo e filtrabile vive nella scheda{" "}
          <Link href="/admin/audit" className="font-semibold text-brand-700 hover:underline">Audit</Link>.
        </p>
      </section>

      {/* Note operative (identiche al resto dell'hub) */}
      <GlassNotice tone="info">
        Sicurezza: le chiavi API sono cifrate (AES-256-GCM) e restano sul server. Il rate limit anti-spam copre l&apos;endpoint AI
        (10 domande/min per IP) e Shield applica ban progressivi. Il take-over SLA interviene solo a L3 con lo switch attivo.
      </GlassNotice>
    </div>
  );
}
