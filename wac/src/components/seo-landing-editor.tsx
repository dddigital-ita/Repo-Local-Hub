"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ChevronDown, Eye, History, LoaderCircle, RefreshCw, RotateCcw, Save, Search, Sparkles, TrendingDown } from "lucide-react";
import { GlassBadge, GlassButton, GlassStatus } from "@/components/glass";
import { toastSaved } from "@/components/admin-toaster";
import { UiIcon } from "@/components/icon-registry";
import { dismissSeoPageAlertAction, resetSeoLandingAction, resolveSeoPageAlertAction, restoreSeoMetaVersionAction, saveSeoLandingAction, seoAmbrosioDraftAction, seoGscPositionHistoryAction } from "@/app/admin/actions";
import SeoContentEditor, { type LandingContentView } from "@/components/seo-content-editor";
import { SeoChecklist, keywordCoverage, type Check } from "@/components/seo-checks";

/** Slug normalizzato lato client (identico a sanitizeSlug in lib/seo.ts). */
function slugifyClient(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Testo su una riga, troncato alla lunghezza massima (per l'anteprima storico). */
function excerpt(v: string, max = 160): string {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/**
 * Controlli META di una landing (title, description, cannibalizzazione).
 * La copertura dell'H1 e delle FAQ è verificata nell'editor dei contenuti,
 * dove quei testi si modificano — così ogni check vive accanto al campo
 * che lo corregge, e i due pannelli si aggiornano alla stessa keyword.
 */
function buildChecks(input: {
  title: string;
  description: string;
  keyword: string;
  keywordsList: string[];
  others: { slug: string; keyword: string; keywords: string[] }[];
}): Check[] {
  const { title, description, keyword, keywordsList, others } = input;
  const checks: Check[] = [];

  if (!keyword.trim()) {
    checks.push({ state: "fail", label: "Keyword principale vuota", hint: "Impostala per attivare le verifiche di copertura." });
  } else {
    const tc = keywordCoverage(keyword, title);
    checks.push(
      tc === "full"
        ? { state: "ok", label: "Title contiene la keyword" }
        : tc === "partial"
          ? { state: "warn", label: "Title contiene la keyword solo in parte" }
          : { state: "fail", label: "La keyword non compare nel title" },
    );
  }

  checks.push(
    title.length <= 60
      ? { state: "ok", label: `Lunghezza title: ${title.length}/60` }
      : title.length <= 70
        ? { state: "warn", label: `Title lungo: ${title.length} caratteri (consigliato ≤ 60)` }
        : { state: "fail", label: `Title troppo lungo: ${title.length} caratteri` },
  );
  checks.push(
    description.length >= 70 && description.length <= 160
      ? { state: "ok", label: `Lunghezza description: ${description.length}/160` }
      : description.length > 160
        ? { state: "warn", label: `Description lunga: ${description.length} caratteri (Google taglia oltre 160)` }
        : { state: "fail", label: `Description corta: ${description.length} caratteri (minimo 70)` },
  );

  const kwN = keyword.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const listNorm = keywordsList.map((k) => k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")).filter(Boolean);
  if (kwN) {
    const dupMain = others.filter((o) => o.keyword.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === kwN);
    const collisions = others.filter(
      (o) =>
        o.keyword.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") !== kwN &&
        (o.keywords.some((k) => k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === kwN) ||
          listNorm.some((k) => k === o.keyword.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))),
    );
    if (dupMain.length > 0) {
      checks.push({
        state: "fail",
        label: `Keyword duplicata: anche /${dupMain[0].slug} la usa`,
        hint: "Due pagine sulla stessa keyword si dividono il posizionamento (cannibalizzazione).",
      });
    } else if (collisions.length > 0) {
      checks.push({
        state: "warn",
        label: `Sovrapposizione con /${collisions[0].slug}`,
        hint: "Una keyword secondaria coincide con la principale di un'altra pagina.",
      });
    } else {
      checks.push({ state: "ok", label: "Keyword unica: nessun'altra pagina la usa" });
    }
  }

  return checks;
}

/**
 * Editor SEO di una landing: title, description, keyword principale e
 * secondarie, slug personalizzato e noindex. Contatori live con soglie
 * Google (title ≤ 60, description 120–160) e anteprima SERP in tempo reale:
 * l'operatore vede esattamente come la pagina apparirà su Google.
 */

export interface LandingSeoView {
  slug: string;
  h1: string;
  title: string;
  description: string;
  keyword: string;
  keywords: string[];
  slugOverride: string;
  noindex: boolean;
  /** True se esiste già un override salvato per questa landing. */
  customized: boolean;
  /** Versioni META archiviate (il più recente in testa, max 10). */
  metaHistory: {
    title: string;
    description: string;
    keyword: string;
    keywords: string[];
    slugOverride: string;
    noindex: boolean;
    archivedAt: string;
    archivedBy: string;
    source: "base" | "override" | "history";
  }[];
  /** Avviso GSC attivo per questa pagina (calo posizioni post-ripristino). */
  alert: {
    positionBefore: number;
    positionAfter: number;
    restoredAt: string;
    measuredAt: string;
    daysAfter: number;
    restoredSource: "base" | "override" | "history";
  } | null;
}

export type { LandingContentView };

type TrendPoint = { date: string; position: number; impressions: number; clicks: number };

/**
 * Confronto 28 giorni vs 28 giorni precedenti, calcolato DALLA SERIE GIÀ
 * CARICATA (zero nuove chiamate a Google): posizione media ponderata per
 * impressioni, somma impressioni e click per finestra. Il delta di posizione
 * è «invertito»: scendere significa migliorare.
 */
function trendDeltas(points: TrendPoint[]) {
  const last = points.slice(-56);
  const recent = last.slice(-28);
  const previous = last.slice(0, 28);
  const window = (arr: TrendPoint[]) => {
    let num = 0;
    let den = 0;
    let imp = 0;
    let clk = 0;
    for (const p of arr) {
      imp += p.impressions;
      clk += p.clicks;
      if (p.position > 0) {
        num += p.position * p.impressions;
        den += p.impressions;
      }
    }
    return { pos: den > 0 ? num / den : null, imp, clk };
  };
  const a = window(recent);
  const b = window(previous);
  return {
    pos: a.pos !== null && b.pos !== null ? a.pos - b.pos : null,
    imp: b.imp > 0 ? ((a.imp - b.imp) / b.imp) * 100 : null,
    clk: b.clk > 0 ? ((a.clk - b.clk) / b.clk) * 100 : null,
  };
}

/** Mini-badge di delta: verde = miglioramento, rosso = peggioramento, grigio = stabile. */
function DeltaBadge({
  label,
  value,
  invert = false,
  suffix = "",
}: {
  label: string;
  /** Delta già calcolato (null = non confrontabile). */
  value: number | null;
  /** True se delta negativo = miglioramento (es. posizione media). */
  invert?: boolean;
  suffix?: string;
}) {
  if (value === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
        {label} —
      </span>
    );
  }
  const flat = Math.abs(value) < (suffix === "%" ? 2 : 0.15);
  const good = flat ? null : invert ? value < 0 : value > 0;
  const arrow = flat ? "→" : value < 0 ? "▼" : "▲";
  const num = suffix === "%" ? Math.round(Math.abs(value)) : Math.abs(value).toLocaleString("it-IT", { maximumFractionDigits: 1 });
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
        good === null
          ? "bg-slate-100 text-slate-600 ring-slate-200"
          : good
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-red-50 text-red-700 ring-red-200"
      }`}
      title={`${label}: ${value > 0 ? "+" : ""}${value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}${suffix} rispetto ai 28 giorni precedenti`}
    >
      {label} {arrow} {num}
      {suffix}
    </span>
  );
}

/**
 * Grafico della posizione media GSC (serie giornaliera): asse Y INVERTITO
 * (posizione 1 = in alto, la linea che sale è male). I giorni senza dati
 * (position 0) sono buchi nella linea. I marker verticali indicano i
 * ripristini di contenuti letti dall'audit log, con legenda.
 */
function GscPositionChart({
  points,
  restores,
}: {
  points: { date: string; position: number; impressions: number; clicks: number }[];
  restores: { ts: string; source: string }[];
}) {
  // Giorno puntato col mouse (indice nella serie): abilita la guida verticale
  // e la tooltip. Hook PRIMA di qualsiasi early return.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const PAD = { top: 14, right: 12, bottom: 22, left: 34 };
  const withData = points.filter((p) => p.position > 0);
  if (withData.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Nessun dato di posizione nella finestra (pagina con poco traffico o Search Console non collegata).
      </p>
    );
  }
  const maxPos = Math.max(10, Math.ceil(Math.max(...withData.map((p) => p.position)) / 5) * 5);
  const minPos = 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * plotW;
  const y = (pos: number) => {
    const p = Math.max(minPos, Math.min(maxPos, pos));
    return PAD.top + ((p - minPos) / (maxPos - minPos)) * plotH;
  };
  // Aree di volume (impressioni/click): ogni serie normalizzata al proprio
  // massimo — conta la CORRELAZIONE temporale col trend di posizione, non
  // il valore assoluto. I giorni a zero valgono davvero zero (l'area tocca
  // il fondo, non si spezza come la linea di posizione).
  const maxImp = Math.max(...points.map((p) => p.impressions), 0);
  const maxClicks = Math.max(...points.map((p) => p.clicks), 0);
  const yBase = H - PAD.bottom;
  const yVol = (v: number, max: number) => (max > 0 ? PAD.top + (1 - v / max) * plotH : yBase);
  const areaPath = (get: (p: (typeof points)[number]) => number, max: number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yVol(get(p), max).toFixed(1)}`).join(" ") +
    ` L${x(points.length - 1).toFixed(1)},${yBase} L${x(0).toFixed(1)},${yBase} Z`;
  // Segmenti di linea: interrotti nei giorni senza dati (position 0).
  const segments: { date: string; position: number; i: number }[][] = [];
  let current: { date: string; position: number; i: number }[] = [];
  points.forEach((p, i) => {
    if (p.position > 0) current.push({ ...p, i });
    else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length > 0) segments.push(current);
  const restoreMarks = restores
    .map((r) => {
      const tsDay = r.ts.slice(0, 10);
      const idx = points.findIndex((p) => p.date >= tsDay);
      return idx >= 0 ? { ...r, idx } : null;
    })
    .filter((m): m is { ts: string; source: string; idx: number } => m !== null);

  // Coordinate mouse → indice giorno (il viewBox scala la larghezza reale).
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * W : PAD.left;
    const idx = Math.round(((svgX - PAD.left) / plotW) * (points.length - 1));
    setHoverIdx(idx >= 0 && idx < points.length ? idx : null);
  }

  // Navigazione da tastiera: frecce per spostarsi giorno per giorno, Home/End
  // per gli estremi, Esc per uscire. Al focus si parte dal giorno più recente
  // CON dati (inutile atterrare su un buco della serie).
  const lastDataIdx = (() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i].position > 0) return i;
    return points.length - 1;
  })();
  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      setHoverIdx((p) => Math.max(0, Math.min(points.length - 1, (p ?? lastDataIdx) + delta)));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHoverIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHoverIdx(points.length - 1);
    } else if (e.key === "Escape") {
      setHoverIdx(null);
    }
  }
  const hp = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="relative">
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl bg-slate-900/90 px-2.5 py-1.5 text-[10px] leading-relaxed text-white shadow-lg"
          style={{
            left: `${(x(hoverIdx!) / W) * 100}%`,
            transform: hoverIdx! > points.length * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <p className="font-semibold">
            {new Date(hp.date).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short" })}
          </p>
          <p>
            Posizione: <span className="font-semibold tabular-nums">{hp.position > 0 ? hp.position.toFixed(1) : "—"}</span>
          </p>
          <p>
            Impressioni: <span className="font-semibold tabular-nums">{hp.impressions}</span>
          </p>
          <p>
            Click: <span className="font-semibold tabular-nums">{hp.clicks}</span>
          </p>
        </div>
      )}
      {/* Annuncio per screen reader: i valori del giorno puntato cambiano con
          frecce/focus e vengono letti in modo non invasivo (polite). */}
      <p aria-live="polite" className="sr-only">
        {hp
          ? `${new Date(hp.date).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}: posizione media ${hp.position > 0 ? hp.position.toFixed(1) : "non disponibile"}, ${hp.impressions} impressioni, ${hp.clicks} click.`
          : ""}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        role="img"
        aria-label="Grafico della posizione media, impressioni e click giornalieri su Google negli ultimi 90 giorni. Con focus: frecce sinistra e destra per esplorare i giorni, Esc per uscire."
        tabIndex={0}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setHoverIdx((p) => p ?? lastDataIdx)}
        onBlur={() => setHoverIdx(null)}
      >
        {[1, Math.round(maxPos / 2), maxPos].map((pos) => (
          <g key={pos}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(pos)} y2={y(pos)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(pos) + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
              {pos}
            </text>
          </g>
        ))}
        {maxImp > 0 && <path d={areaPath((p) => p.impressions, maxImp)} fill="#64748b" opacity={0.14} />}
        {maxClicks > 0 && <path d={areaPath((p) => p.clicks, maxClicks)} fill="#059669" opacity={0.22} />}
        {/* Guida verticale + punto sulla linea del giorno puntato. */}
        {hoverIdx !== null && hp && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.top} y2={yBase} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 2" />
            {hp.position > 0 && (
              <circle cx={x(hoverIdx)} cy={y(hp.position)} r={3.5} fill="#4f46e5" stroke="white" strokeWidth={1.5} />
            )}
          </g>
        )}
        {restoreMarks.map((m, i) => (
          <g key={i}>
            <line x1={x(m.idx)} x2={x(m.idx)} y1={PAD.top} y2={H - PAD.bottom} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />
            <circle cx={x(m.idx)} cy={PAD.top - 4} r={3.5} fill="#f59e0b" />
          </g>
        ))}
        {segments.map((seg, si) => (
          <polyline
            key={si}
            points={seg.map((p) => `${x(p.i)},${y(p.position)}`).join(" ")}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <text x={PAD.left} y={H - 6} fontSize={9} fill="#94a3b8">
          {new Date(points[0].date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
        </text>
        <text x={W - PAD.right} y={H - 6} fontSize={9} fill="#94a3b8" textAnchor="end">
          {new Date(points[points.length - 1].date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-[#4f46e5]" aria-hidden />
          Posizione media (1 = primo risultato)
        </span>
        {maxImp > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#64748b]/25" aria-hidden />
            Impressioni
          </span>
        )}
        {maxClicks > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#059669]/30" aria-hidden />
            Click
          </span>
        )}
        {restoreMarks.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full border-t-2 border-dashed border-[#f59e0b]" aria-hidden />
            Ripristini contenuti ({restoreMarks.map((m) => new Date(m.ts).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })).join(", ")})
          </span>
        )}
        <span className="text-slate-400">aree normalizzate al loro massimo</span>
      </div>
    </div>
  );
}

function Counter({ value, min, max, idealMax }: { value: number; min?: number; max: number; idealMax?: number }) {
  const ok = value <= max && (min === undefined || value >= min);
  const warn = !ok && value <= (idealMax ?? max);
  return (
    <span
      className={`text-[11px] font-semibold tabular-nums ${
        ok ? "text-emerald-600" : warn ? "text-amber-600" : "text-red-600"
      }`}
    >
      {value}/{max}
      {min !== undefined && value < min ? " · troppo corta" : ""}
    </span>
  );
}

export default function SeoLandingEditor({
  landing,
  siteUrl,
  others,
  content,
}: {
  landing: LandingSeoView;
  siteUrl: string;
  others: { slug: string; keyword: string; keywords: string[] }[];
  content: LandingContentView;
}) {
  const [title, setTitle] = useState(landing.title);
  const [description, setDescription] = useState(landing.description);
  const [keyword, setKeyword] = useState(landing.keyword);
  const [keywordsList, setKeywordsList] = useState(landing.keywords.join("\n"));
  const [slugOverride, setSlugOverride] = useState(landing.slugOverride);
  const [saved, setSaved] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDone, setAiDone] = useState(false);
  const [metaHistoryOpen, setMetaHistoryOpen] = useState(false);
  /** Versione META in anteprima (timestamp): una sola aperta alla volta. */
  const [metaPreviewTs, setMetaPreviewTs] = useState<string | null>(null);
  /** Grafico posizioni GSC (caricato on demand). */
  const [trend, setTrend] = useState<{ points: TrendPoint[]; restores: { ts: string; source: string }[] } | null>(null);
  const [trendBusy, setTrendBusy] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const effectiveSlug = slugifyClient(slugOverride) || landing.slug;
  const siteName = "Web Agency Crema";

  const keywordsClean = keywordsList.split("\n").map((k) => k.trim()).filter(Boolean);
  const checks = buildChecks({
    title,
    description,
    keyword,
    keywordsList: keywordsClean,
    others,
  });

  /** Carica la serie giornaliera GSC + i ripristini (on demand, come le query reali). */
  function loadTrend() {
    if (trendBusy) return;
    setTrendError(null);
    setTrendBusy(true);
    startTransition(async () => {
      try {
        const res = await seoGscPositionHistoryAction(landing.slug);
        if (res.ok) setTrend({ points: res.points, restores: res.restores });
        else setTrendError(res.error);
      } finally {
        setTrendBusy(false);
      }
    });
  }

  /** Ambrosio propone title e description: entrano nei campi, mai salvati diretti. */
  function askAmbrosio() {
    if (aiBusy) return;
    setAiError(null);
    setAiBusy(true);
    startTransition(async () => {
      try {
        const res = await seoAmbrosioDraftAction(landing.slug);
        if (res.ok) {
          setTitle(res.title);
          setDescription(res.description);
          setAiDone(true);
          toastSaved("ambrosio_seo");
        } else {
          setAiError(res.error);
        }
      } finally {
        setAiBusy(false);
      }
    });
  }

  return (
    <div className="rounded-3xl border border-white/60 bg-white/55 p-4 shadow-[0_12px_35px_-24px_rgb(15_23_42/.5)] backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">/{landing.slug}</h3>
            {landing.customized ? (
              <GlassStatus ok label="Personalizzata" />
            ) : (
              <GlassStatus ok={false} label="Default" />
            )}
            {landing.noindex && <GlassBadge className="text-red-700 ring-red-200">noindex</GlassBadge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">{landing.h1}</p>
        </div>
        <a
          href={`${siteUrl}/${effectiveSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          aria-label={`Apri la pagina /${effectiveSlug}`}
        >
          <Search className="h-4 w-4" aria-hidden />
        </a>
      </div>

      {/* ── Avviso GSC: calo posizioni dopo un ripristino di contenuti ── */}
      {landing.alert && landing.alert.measuredAt && (
        <div className="mt-3 rounded-2xl bg-amber-50/90 px-4 py-3 ring-1 ring-amber-200">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Calo posizioni dopo il ripristino del{" "}
            {new Date(landing.alert.restoredAt).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
            Posizione media: {landing.alert.positionBefore.toFixed(1)} →{" "}
            <span className="font-semibold">{landing.alert.positionAfter.toFixed(1)}</span> dopo{" "}
            {landing.alert.daysAfter} giorni. La versione ripristinata potrebbe non essere quella giusta:
            confronta lo storico contenuti (più sotto) e ripristina una versione diversa se serve.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={resolveSeoPageAlertAction}>
              <input type="hidden" name="slugKey" value={landing.slug} />
              <GlassButton type="submit" size="sm">
                Ho verificato: è risolto
              </GlassButton>
            </form>
            <form action={dismissSeoPageAlertAction}>
              <input type="hidden" name="slugKey" value={landing.slug} />
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-white/60 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                Falso allarme
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Anteprima SERP Google: quello che vede l'utente prima del clic. */}
      <div className="mt-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-white/70">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Anteprima su Google</p>
        <p className="mt-1 truncate text-xs text-emerald-700">{siteUrl}/{effectiveSlug}</p>
        <p className="mt-0.5 truncate text-[15px] font-medium text-[#1a0dab]">
          {title || landing.title} <span className="text-slate-400">| {siteName}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
          {description || landing.description}
        </p>
      </div>

      <div className="mt-3">
        <SeoChecklist checks={checks} title="Checklist meta" />
      </div>

      {/* ── Storico versioni meta ───────────────────────────────────── */}
      {landing.metaHistory.length > 0 && (
        <div className="mt-3 rounded-2xl bg-white/45 ring-1 ring-white/60">
          <button
            type="button"
            onClick={() => setMetaHistoryOpen((p) => !p)}
            aria-expanded={metaHistoryOpen}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <History className="h-3.5 w-3.5 text-brand-600" aria-hidden />
              Storico meta
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {landing.metaHistory.length}
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition ${metaHistoryOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {metaHistoryOpen && (
            <div className="border-t border-white/60 px-3.5 pb-4 pt-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Ogni salvataggio delle meta archivia la versione che sostituisce (max 10). Ripristinare
                archivia a sua volta lo stato attuale: niente è mai definitivo.
              </p>
              <ul className="mt-2 space-y-2">
                {landing.metaHistory.map((v) => {
                  const d = new Date(v.archivedAt);
                  const valid = !Number.isNaN(d.getTime());
                  const dateLabel = valid
                    ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
                    : "data non valida";
                  const timeLabel = valid ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
                  const parts: string[] = [];
                  if (v.title) parts.push(excerpt(v.title, 44));
                  if (v.keyword) parts.push(`kw: ${excerpt(v.keyword, 28)}`);
                  if (v.slugOverride) parts.push(`slug: /${v.slugOverride}`);
                  if (v.noindex) parts.push("noindex");
                  const what = parts.length ? parts.join(" · ") : "default di codice";
                  const srcLabel = v.source === "base" ? "da codice" : v.source === "override" ? "da override" : "da storico";
                  return (
                    <li
                      key={v.archivedAt}
                      className="rounded-2xl bg-white/60 px-3 py-2 ring-1 ring-white/60"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-slate-800" title={what}>
                            {what}
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            {dateLabel} · {timeLabel} · da {v.archivedBy} · {srcLabel}
                          </span>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setMetaPreviewTs((p) => (p === v.archivedAt ? null : v.archivedAt))}
                            aria-expanded={metaPreviewTs === v.archivedAt}
                            aria-label={`Anteprima meta del ${dateLabel} ${timeLabel}`}
                            className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                            <span className="sr-only">Anteprima</span>
                          </button>
                          <form
                            action={async (fd: FormData) => {
                              await restoreSeoMetaVersionAction(fd);
                            }}
                          >
                            <input type="hidden" name="slugKey" value={landing.slug} />
                            <input type="hidden" name="archivedAt" value={v.archivedAt} />
                            <GlassButton type="submit" size="sm" className="shrink-0">
                              Ripristina
                            </GlassButton>
                          </form>
                        </div>
                      </div>
                      {metaPreviewTs === v.archivedAt && (
                        <div className="mt-2 w-full rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-white/70">
                          <p className="text-[11px] text-slate-500">
                            URL: <span className="font-semibold text-slate-600">/{v.slugOverride || landing.slug}</span>
                            {v.noindex && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">noindex</span>}
                          </p>
                          <p className="mt-1 truncate text-[13px] font-medium text-[#1a0dab]">
                            {v.title || landing.title} <span className="text-slate-400">| {siteName}</span>
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                            {v.description || landing.description}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Keyword: <span className="font-semibold text-slate-600">{v.keyword || "—"}</span>
                            {v.keywords.length > 0 && <span className="text-slate-400"> · secondarie: {v.keywords.join(", ")}</span>}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Trend posizioni GSC (on demand) ─────────────────────────── */}
      <div className="mt-3 rounded-2xl bg-white/45 ring-1 ring-white/60">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <TrendingDown className="h-3.5 w-3.5 text-brand-600" aria-hidden />
            Posizione media su Google (90 giorni)
          </span>
          <button
            type="button"
            onClick={loadTrend}
            disabled={trendBusy}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60"
          >
            {trendBusy ? (
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            {trend ? "Aggiorna" : "Carica il grafico"}
          </button>
        </div>
        {(trend || trendError) && (
          <div className="border-t border-white/60 px-3.5 pb-3.5 pt-2">
            {trendError && <p role="alert" className="text-[11px] font-medium text-red-700">{trendError}</p>}
            {trend && (
              <div className="flex flex-wrap items-center gap-1.5 pb-1.5">
                <DeltaBadge label="Posizione" value={trendDeltas(trend.points).pos} invert />
                <DeltaBadge label="Impressioni" value={trendDeltas(trend.points).imp} suffix="%" />
                <DeltaBadge label="Click" value={trendDeltas(trend.points).clk} suffix="%" />
                <span className="text-[10px] text-slate-400">28 giorni vs 28 precedenti</span>
              </div>
            )}
            {trend && <GscPositionChart points={trend.points} restores={trend.restores} />}
            {trend && !trendError && (
              <p className="mt-1 text-[11px] text-slate-400">
                Più la linea è in alto, meglio è (posizione 1 = primo risultato). Dati Google con 2–3 giorni di ritardo.
              </p>
            )}
          </div>
        )}
        {!trend && !trendError && (
          <p className="px-3.5 pb-3 text-[11px] text-slate-400">
            Il caricamento interroga Google on demand: serve il collegamento API in{" "}
            <span className="font-semibold text-slate-500">Admin → Tools → Search Console</span>.
          </p>
        )}
      </div>

      {/* L'editor contenuti riceve la keyword COME DIGITATA ora: i suoi
          controlli su H1 e FAQ si aggiornano in tempo reale. */}
      <SeoContentEditor view={content} keyword={keyword} secondaryKeywords={keywordsClean} />

      <form
        action={async (fd: FormData) => {
          await saveSeoLandingAction(fd);
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        }}
        className="mt-4 space-y-3"
      >
        <input type="hidden" name="slugKey" value={landing.slug} />
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`title-${landing.slug}`} className="block text-xs font-semibold text-slate-600">
              Title (meta)
            </label>
            <Counter value={title.length} max={60} idealMax={70} />
          </div>
          <input
            id={`title-${landing.slug}`}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={70}
            className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`desc-${landing.slug}`} className="block text-xs font-semibold text-slate-600">
              Meta description
            </label>
            <Counter value={description.length} min={70} max={160} idealMax={200} />
          </div>
          <textarea
            id={`desc-${landing.slug}`}
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={200}
            className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={`kw-${landing.slug}`} className="block text-xs font-semibold text-slate-600">
            Keyword principale
            <input
              id={`kw-${landing.slug}`}
              name="keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
            />
          </label>
          <label htmlFor={`slug-${landing.slug}`} className="block text-xs font-semibold text-slate-600">
            Slug personalizzato
            <div className="mt-1 flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-slate-400">/</span>
              <input
                id={`slug-${landing.slug}`}
                name="slugOverride"
                value={slugOverride}
                onChange={(e) => setSlugOverride(e.target.value)}
                placeholder={landing.slug}
                maxLength={80}
                className="w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400 focus:bg-white"
              />
            </div>
          </label>
        </div>
        <label htmlFor={`kws-${landing.slug}`} className="block text-xs font-semibold text-slate-600">
          Keyword secondarie <span className="font-normal text-slate-400">(una per riga, max 12)</span>
          <textarea
            id={`kws-${landing.slug}`}
            name="keywords"
            value={keywordsList}
            onChange={(e) => setKeywordsList(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input name="noindex" type="checkbox" defaultChecked={landing.noindex} className="h-4 w-4 accent-brand-600" />
          Noindex (escludi la pagina da Google e dalla sitemap)
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={askAmbrosio}
              disabled={aiBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-600/90 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-glass-btn transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
            >
              <Sparkles className={`h-3.5 w-3.5 ${aiBusy ? "animate-pulse" : ""}`} aria-hidden />
              {aiBusy ? "Ambrosio scrive…" : aiDone ? "Riscrivi con Ambrosio" : "Suggerisci con Ambrosio"}
            </button>
            <span aria-live="polite" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
              {saved ? (
                <>
                  Salvato
                  <UiIcon name="check" size={12} />
                </>
              ) : (
                ""
              )}
            </span>
          </div>
          <div className="flex gap-2">
            {landing.customized && (
              <button
                type="submit"
                formAction={resetSeoLandingAction}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-white/60 transition hover:bg-white/90"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Ripristina
              </button>
            )}
            <GlassButton type="submit" size="sm">
              <Save className="h-3.5 w-3.5" aria-hidden />
              Salva
            </GlassButton>
          </div>
        </div>
        {aiError && (
          <p role="alert" className="text-[11px] font-medium text-red-700">{aiError}</p>
        )}
      </form>
    </div>
  );
}
