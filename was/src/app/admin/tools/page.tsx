import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  Construction,
  FileSearch,
  Gauge,
  GraduationCap,
  NotebookPen,
  Palette,
  ScrollText,
  Sparkles,
  Wrench,
} from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { HubStatus } from "@/components/settings-hub";
import { requireAdmin } from "@/lib/admin";
import { hubSummary } from "@/lib/settings-status";
import { getToolsStatuses } from "@/lib/tools-status-server";
import { cachePurgeStatus } from "@/lib/tools-status";
import { readLastPurge } from "@/lib/cache-purge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tools · Admin", robots: { index: false } };

/** Schede operative: ognuna vive nella SUA pagina (scheda singola). */
const STRUMENTI = [
  {
    href: "/admin/tools/theme",
    Icon: Palette,
    title: "Tema grafico",
    text: "Aspetto di tutto il sito: palette, modalità chiara/scura e anteprima live prima di salvare.",
  },
  {
    href: "/admin/tools/hero",
    Icon: Sparkles,
    title: "Hero animato",
    text: "Apertura animata della home: 4 template stile Apple, testi, font e colori con anteprima live.",
  },
  {
    href: "/admin/tools/backup",
    Icon: CalendarClock,
    title: "Backup e aggiornamenti",
    text: "Export JSON del database, storico, ripristino guidato e controllo versione di Next.js.",
  },
  {
    href: "/admin/tools/manutenzione",
    Icon: Construction,
    title: "Modalità manutenzione",
    text: "Chiudi con garbo il sito pubblico: pagina pulita con contatti e CTA, risposta 503, admin sempre raggiungibile.",
  },
  {
    href: "/admin/tools/cache",
    Icon: Gauge,
    title: "Free cache",
    text: "Svuota la cache dove serve: tutto il sito o solo home, landing o admin. Contenuti visibili subito.",
  },
];

/** Sezione di formazione: solo lettura, spiega le schede del resto dell'admin. */
const FORMAZIONE = [
  {
    href: "/admin/tools/manuale",
    Icon: GraduationCap,
    title: "Manuale Operativo",
    text: "La guida in due capitoli: come si usa Ambrosio AI e come si usa il sito. Semplice, con link diretti alle schede.",
  },
];

/** Pagine di sistema: servizio, non navigazione quotidiana. */
const SISTEMA = [
  {
    href: "/admin/notion",
    Icon: NotebookPen,
    title: "Notion",
    text: "Sincronizzazione contenuti con il workspace Notion.",
  },
  {
    href: "/admin/seo",
    Icon: FileSearch,
    title: "SEO",
    text: "Meta, landing, redirect e query reali da Search Console.",
  },
  {
    href: "/admin/audit",
    Icon: ScrollText,
    title: "Audit",
    text: "Chi ha fatto cosa: registro append-only delle azioni.",
  },
  {
    href: "/admin/tools/perf",
    Icon: Gauge,
    title: "Velocità",
    text: "Tempi di caricamento per pagina, prima/dopo le ottimizzazioni.",
  },
];

export default async function ToolsPage() {
  await requireAdmin();
  const statuses = await getToolsStatuses();
  const lastPurge = await readLastPurge();

  /** Stati dall'hub, per href: le schede senza segnale reale restano senza badge. */
  const STATUS_BY_HREF: Record<string, { ok: boolean; warn: boolean; label: string } | null> = {
    "/admin/tools/theme": statuses.theme,
    "/admin/tools/hero": statuses.hero,
    "/admin/tools/backup": statuses.backup,
    "/admin/tools/cache": cachePurgeStatus(lastPurge),
    "/admin/notion": statuses.notion,
  };
  const pillFor = (href: string): React.ReactNode => {
    const s = STATUS_BY_HREF[href];
    if (!s) return null;
    return (
      <span className="shrink-0 self-center">
        <HubStatus ok={s.ok} warn={s.warn} label={s.label} />
      </span>
    );
  };
  /** Riepilogo: le schede con segnale valutabile (grigie «Non disponibile»/«Predisposto» non contano come azione). */
  const summary = hubSummary(
    Object.values(STATUS_BY_HREF)
      .filter((s) => s !== null)
      .map((s) => ({ ok: s.ok, warn: s.warn })),
  );

  return (
    <div className="space-y-6">
      {/* ── Header di pagina (stesso pattern di Panoramica) ────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Wrench className="h-6 w-6 text-brand-600" aria-hidden />
            Tools
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Una scheda per strumento: apri, regoli, chiudi. Le pagine di sistema stanno qui sotto.
          </p>
        </div>
        <HubStatus ok={summary.ok} warn={summary.warn} label={summary.label} />
      </div>

      {/* ── Strumenti operativi: una scheda = una pagina dedicata ──── */}
      <Card>
        <GlassSectionHeader
          icon={Wrench}
          title="Strumenti operativi"
          subtitle="Configurazioni che si toccano raramente ma cambiano tutto il sito."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STRUMENTI.map(({ href, Icon, title, text }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 transition hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-900/5">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                {pillFor(href)}
              </span>
              <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-slate-900">
                {title}
                <ChevronRight
                  className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                  aria-hidden
                />
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">{text}</span>
            </Link>
          ))}
        </div>
      </Card>

      {/* ── Formazione: solo lettura, una pagina sola ───────────────── */}
      <Card>
        <GlassSectionHeader
          icon={GraduationCap}
          title="Formazione"
          subtitle="Guide per chi inizia: cosa fa ogni strumento e dove si trova, senza gergo."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FORMAZIONE.map(({ href, Icon, title, text }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 transition hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-900/5">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
              </span>
              <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-slate-900">
                {title}
                <ChevronRight
                  className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                  aria-hidden
                />
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-slate-500">{text}</span>
            </Link>
          ))}
        </div>
      </Card>

      {/* ── Sistema: pagine di servizio fuori dalla nav ────────────── */}
      <Card>
        <GlassSectionHeader
          icon={ScrollText}
          title="Sistema"
          subtitle="Sincronizzazioni, sicurezza, log e indicizzazione: si aprono in pagina dedicata."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {SISTEMA.map(({ href, Icon, title, text }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-start gap-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 transition hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-900/5">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                  {title}
                  <ChevronRight
                    className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
                    aria-hidden
                  />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{text}</span>
              </span>
              {pillFor(href)}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
