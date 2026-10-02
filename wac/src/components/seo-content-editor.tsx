"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, FileText, History, Plus, RotateCcw, Save, Sparkles, X, XCircle } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { toastSaved } from "@/components/admin-toaster";
import { resetSeoLandingContentAction, restoreSeoContentVersionAction, saveSeoLandingContentAction, seoContentAmbrosioDraftAction } from "@/app/admin/actions";
import { SeoChecklist, faqKeywordCount, keywordCoverage, type Check, type CheckState } from "@/components/seo-checks";

/** Versione archiviata nello storico (vista client di LandingContentVersion). */
interface ContentVersionView {
  intro: string[];
  services: { title: string; text: string }[];
  faq: { q: string; a: string }[];
  proof: string;
  h1: string;
  /** ISO timestamp dell'archiviazione. */
  archivedAt: string;
  archivedBy: string;
  source: "base" | "override" | "history";
}

/**
 * Editor dei CONTENUTI di una landing (intro, servizi, FAQ, prova, H1):
 * testi finora solo nel codice (site.ts), ora modificabili dall'admin con
 * fallback degradato — vuoto = testi di codice, mai pagina incompleta.
 *
 * È anche il PUNTO DI VERIFICA della checklist on-page per i contenuti:
 * H1 e FAQ effettivi (override se compilato, altrimenti il testo di codice
 * che la pagina usa davvero) sono controllati contro la keyword — passata
 * live dall'editor meta — così ogni check vive accanto al campo che lo
 * corregge e si aggiorna mentre l'operatore digita o salva.
 *
 * Contract con la pagina: la prop `base` contiene SEMPRE i testi di codice
 * (site.ts); i campi arrivano precompilati con l'eventuale override.
 */

export interface LandingContentView {
  slug: string;
  /** Testi di codice (site.ts): riferimento per i placeholder e il reset. */
  base: {
    h1: string;
    intro: string[];
    services: { title: string; text: string }[];
    faq: { q: string; a: string }[];
    proof: string;
  };
  /** Override correntemente salvato (campi vuoti = usa base). */
  override: {
    h1: string;
    intro: string[];
    services: { title: string; text: string }[];
    faq: { q: string; a: string }[];
    proof: string;
  } | null;
  /** Versioni archiviate (il più recente in testa, max 10). */
  history: ContentVersionView[];
}

const inputCls =
  "mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-400 focus:bg-white";

/** Testo su una riga, troncato alla lunghezza massima (per l'anteprima storico). */
function excerpt(v: string, max = 160): string {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/**
 * Anteprima compatta di una versione archiviata: H1 effettivo (con fallback
 * esplicito a quello di codice), paragrafi, servizi, FAQ e proof troncati —
 * abbastanza da capire COSA c'era scritto prima di ripristinare.
 */
function VersionPreview({ version, baseH1 }: { version: ContentVersionView; baseH1: string }) {
  const blocks: { label: string; items: string[] }[] = [
    ...(version.intro.length ? [{ label: "Intro", items: version.intro.map((p) => excerpt(p, 200)) }] : []),
    ...(version.services.length
      ? [{ label: "Servizi", items: version.services.map((s) => `${s.title} — ${excerpt(s.text, 120)}`) }]
      : []),
    ...(version.faq.length
      ? [{ label: "FAQ", items: version.faq.map((f) => `D: ${excerpt(f.q, 120)} · R: ${excerpt(f.a, 140)}`) }]
      : []),
    ...(version.proof ? [{ label: "Prova sul territorio", items: [excerpt(version.proof, 200)] }] : []),
  ];
  return (
    <div className="mt-2 w-full rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-white/70">
      <p className="text-[11px] text-slate-500">
        H1: <span className="font-semibold text-slate-600">«{version.h1 || baseH1}»</span>
        {!version.h1 && <span className="text-slate-400"> (di codice)</span>}
      </p>
      {blocks.map((b) => (
        <div key={b.label} className="mt-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{b.label}</p>
          <ul className="mt-0.5 space-y-0.5">
            {b.items.map((it, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-slate-600">
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {blocks.length === 0 && (
        <p className="text-[11px] text-slate-400">Versione senza contenuti personalizzati.</p>
      )}
    </div>
  );
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="rounded-2xl bg-white/50 p-3 ring-1 ring-white/60">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Rimuovi"
          className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export default function SeoContentEditor({
  view,
  keyword,
  secondaryKeywords = [],
}: {
  view: LandingContentView;
  /** Keyword principale digitata nell'editor meta (live). */
  keyword: string;
  /** Keyword secondarie digitate: alimentano solo l'avviso di cannibalizzazione. */
  secondaryKeywords?: string[];
}) {
  const [open, setOpen] = useState(false);
  const o = view.override;
  const [h1, setH1] = useState(o?.h1 ?? "");
  const [proof, setProof] = useState(o?.proof ?? "");
  const [intro, setIntro] = useState<string[]>(o?.intro ?? []);
  const [services, setServices] = useState<{ title: string; text: string }[]>(o?.services ?? []);
  const [faq, setFaq] = useState<{ q: string; a: string }[]>(o?.faq ?? []);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Versione in anteprima (timestamp): una sola aperta alla volta. */
  const [previewTs, setPreviewTs] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const customized =
    Boolean(o) && (o!.h1 !== "" || o!.intro.length > 0 || o!.services.length > 0 || o!.faq.length > 0 || o!.proof !== "");

  const addIntro = () => setIntro((p) => (p.length < 6 ? [...p, ""] : p));
  const addService = () => setServices((p) => (p.length < 8 ? [...p, { title: "", text: "" }] : p));
  const addFaq = () => setFaq((p) => (p.length < 12 ? [...p, { q: "", a: "" }] : p));

  /**
   * Ambrosio propone intro + FAQ: entrano nei campi, mai salvati diretti.
   * Sostituisce intro e FAQ correnti (servizi/proof/H1 restano); se la bozza
   * ha più paragrafi/FAQ dei massimi, la coda extra è tagliata come farebbe
   * il server al salvataggio. Le checklist si aggiornano subito: la bozza
   * deve passare i controlli prima del salvataggio.
   */
  function askAmbrosio() {
    if (aiBusy) return;
    setAiError(null);
    setAiNote(null);
    setAiBusy(true);
    startTransition(async () => {
      try {
        const res = await seoContentAmbrosioDraftAction(view.slug);
        if (res.ok) {
          setIntro(res.intro.slice(0, 6));
          setFaq(res.faq.slice(0, 12));
          setAiNote(
            `Bozza di ${res.provider}${res.usedRealQueries ? " · query reali usate" : " · senza query reali (Search Console non collegata)"} — rileggi e salva.`,
          );
          toastSaved("ambrosio_contenuti");
        } else {
          setAiError(res.error);
        }
      } finally {
        setAiBusy(false);
      }
    });
  }

  /* ── Checklist on-page dei contenuti ──────────────────────────────── */

  const effectiveH1 = h1.trim() || view.base.h1;
  const effectiveFaq = faq.filter((f) => f.q.trim());
  const kwN = keyword.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const checks: Check[] = [];

  // H1 effettivo: l'override se compilato, altrimenti il testo di codice
  // che la pagina pubblica sta usando davvero in questo momento.
  {
    const h1c = keywordCoverage(keyword, effectiveH1);
    const isOverride = h1.trim() !== "";
    checks.push(
      h1c === "full"
        ? { state: "ok", label: isOverride ? "H1 personalizzato contiene la keyword" : "H1 di codice contiene la keyword" }
        : h1c === "partial"
          ? {
              state: "warn",
              label: "H1 contiene la keyword solo in parte",
              hint: `H1 effettivo: «${effectiveH1}»`,
            }
          : {
              state: "fail",
              label: isOverride
                ? "L'H1 personalizzato perde la keyword"
                : "La keyword non compare nell'H1 di codice",
              hint: isOverride
                ? `H1 attuale: «${effectiveH1}» — oppure cancellalo per tornare al testo di codice.`
                : `H1 attuale: «${effectiveH1}» — personalizzalo qui sotto per correggerlo.`,
            },
    );
  }

  if (effectiveFaq.length === 0) {
    checks.push({ state: "warn", label: "Nessuna FAQ definita per la pagina" });
  } else if (!kwN) {
    checks.push({ state: "warn", label: `FAQ presenti: ${effectiveFaq.length} — keyword vuota, coerenza non verificabile` });
  } else {
    const matching = faqKeywordCount(keyword, effectiveFaq.map((f) => f.q));
    const isOverride = effectiveFaq.length > 0 && faq.length > 0;
    checks.push(
      matching > 0
        ? { state: "ok", label: `FAQ coerenti: ${matching} su ${effectiveFaq.length} toccano la keyword` }
        : {
            state: "fail",
            label: isOverride
              ? "Le FAQ personalizzate perdono la keyword"
              : "Nessuna FAQ di codice usa la keyword",
            hint: isOverride
              ? "Le FAQ alimentano anche il JSON-LD FAQPage: aggiungi una domanda che la usi, o cancellane una per tornare ai testi di codice."
              : "Le FAQ rispondono alle query reali: aggiungi qui una domanda sulla keyword.",
          },
    );
  }

  // Cannibalizzazione: una keyword secondaria usata qui non deve diventare
  // anche la principale di questa pagina (le conflitti tra PAGINE sono
  // verificati nell'editor meta, che vede tutte le altre landing).
  {
    const mainN = kwN;
    const clash = secondaryKeywords.find(
      (k) => k.trim() && k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === mainN,
    );
    if (mainN && clash) {
      checks.push({
        state: "fail",
        label: "Una keyword secondaria coincide con la principale",
        hint: "Due pagine sulla stessa keyword si dividono il posizionamento: spostala tra principale e secondarie.",
      });
    }
  }

  const toFix = checks.filter((c) => c.state !== "ok").length;
  const headerState: CheckState = toFix === 0 ? "ok" : checks.some((c) => c.state === "fail") ? "fail" : "warn";

  return (
    <div className="mt-3 rounded-2xl bg-white/45 ring-1 ring-white/60">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
          <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
          <span className="shrink-0">Contenuti pagina (intro, servizi, FAQ)</span>
          {customized ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              personalizzati
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              da codice
            </span>
          )}
          {/* Stato della checklist visibile anche da chiuso. */}
          {toFix === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              tutto ok
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                headerState === "fail"
                  ? "bg-red-50 text-red-700 ring-red-200"
                  : "bg-amber-50 text-amber-700 ring-amber-200"
              }`}
            >
              {headerState === "fail" ? (
                <XCircle className="h-3 w-3" aria-hidden />
              ) : (
                <AlertTriangle className="h-3 w-3" aria-hidden />
              )}
              {toFix} da sistemare
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div className="border-t border-white/60 px-3.5 pb-4 pt-3">
          <p className="text-[11px] leading-relaxed text-slate-500">
            I testi salvati qui sostituiscono quelli del codice per questa pagina. Un campo lasciato
            vuoto (o «Ripristina contenuti») fa tornare il testo di codice: la pagina non resta mai
            incompleta.
          </p>

          <div className="mt-3">
            <SeoChecklist checks={checks} title="Checklist contenuti" />
          </div>

          {aiNote && (
            <p className="mt-2 rounded-xl bg-brand-50/80 px-3 py-2 text-[11px] leading-relaxed text-brand-800 ring-1 ring-brand-200/70">
              {aiNote}
            </p>
          )}
          {aiError && (
            <p role="alert" className="mt-2 text-[11px] font-medium text-red-700">{aiError}</p>
          )}

          {/* ── Storico versioni ───────────────────────────────────── */}
          {view.history.length > 0 && (
            <div className="mt-3 rounded-2xl bg-white/45 ring-1 ring-white/60">
              <button
                type="button"
                onClick={() => setHistoryOpen((p) => !p)}
                aria-expanded={historyOpen}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <History className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                  Storico versioni
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                    {view.history.length}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition ${historyOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {historyOpen && (
                <div className="border-t border-white/60 px-3.5 pb-4 pt-3">
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Ogni salvataggio archivia la versione che sostituisce (max 10). Ripristinare non
                    cancella nulla: anche lo stato attuale finisce nello storico prima del ripristino.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {view.history.map((v) => {
                      const d = new Date(v.archivedAt);
                      const valid = !Number.isNaN(d.getTime());
                      const dateLabel = valid
                        ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
                        : "data non valida";
                      const timeLabel = valid ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
                      const counts = [v.intro.length, v.services.length, v.faq.length].filter((n) => n > 0);
                      const what = counts.length
                        ? `${counts.join("+")} blocchi`
                        : v.h1 || v.proof
                          ? "H1/proof"
                          : "vuota";
                      const srcLabel =
                        v.source === "base" ? "da codice" : v.source === "override" ? "da override" : "da storico";
                      return (
                        <li
                          key={v.archivedAt}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/60 px-3 py-2 ring-1 ring-white/60"
                       
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-800">
                              {dateLabel} · {timeLabel} · {what}
                            </span>
                            <span className="block text-[11px] text-slate-400">
                              da {v.archivedBy} · {srcLabel}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setPreviewTs((p) => (p === v.archivedAt ? null : v.archivedAt))}
                              aria-expanded={previewTs === v.archivedAt}
                              aria-label={`Anteprima versione del ${dateLabel} ${timeLabel}`}
                              className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">Anteprima</span>
                            </button>
                            <form
                              action={async (fd: FormData) => {
                                await restoreSeoContentVersionAction(fd);
                              }}
                            >
                            <input type="hidden" name="slugKey" value={view.slug} />
                            <input type="hidden" name="archivedAt" value={v.archivedAt} />
                            <GlassButton type="submit" size="sm" className="shrink-0">
                              Ripristina
                            </GlassButton>
                            </form>
                          </div>
                          {previewTs === v.archivedAt && <VersionPreview version={v} baseH1={view.base.h1} />}
                        </li>
                      );
                    })
                    }
                  </ul>
                </div>
              )}
            </div>
          )}

          <form
            action={async (fd: FormData) => {
              await saveSeoLandingContentAction(fd);
            }}
            className="mt-3 space-y-4"
          >
            <input type="hidden" name="slugKey" value={view.slug} />

            {/* H1 */}
            <label className="block text-xs font-semibold text-slate-600">
              H1 <span className="font-normal text-slate-400">(vuoto = «{view.base.h1}»)</span>
              <input name="h1" value={h1} onChange={(e) => setH1(e.target.value)} maxLength={160} className={inputCls} />
            </label>

            {/* Intro */}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">
                  Paragrafi introduttivi{" "}
                  <span className="font-normal text-slate-400">
                    ({intro.length || `testi di codice: ${view.base.intro.length}`})
                  </span>
                </p>
                {intro.length < 6 && (
                  <button
                    type="button"
                    onClick={addIntro}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    Paragrafo
                  </button>
                )}
              </div>
              {intro.length === 0 && (
                <p className="mt-1 rounded-xl bg-white/50 px-3 py-2 text-[11px] text-slate-500 ring-1 ring-white/50">
                  In uso i {view.base.intro.length} paragrafi di codice. Aggiungine uno per iniziare a
                  personalizzare.
                </p>
              )}
              {intro.map((p, i) => (
                <Row key={i} onRemove={() => setIntro((prev) => prev.filter((_, j) => j !== i))}>
                  <textarea
                    name="intro"
                    value={p}
                    onChange={(e) => setIntro((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    rows={3}
                    maxLength={2000}
                    placeholder={`Paragrafo ${i + 1} — domanda reale del cliente, contesto locale, metodo…`}
                    className={inputCls}
                  />
                </Row>
              ))}
            </div>

            {/* Servizi */}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">
                  Servizi{" "}
                  <span className="font-normal text-slate-400">
                    ({services.length || `testi di codice: ${view.base.services.length}`})
                  </span>
                </p>
                {services.length < 8 && (
                  <button
                    type="button"
                    onClick={addService}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    Servizio
                  </button>
                )}
              </div>
              {services.length === 0 && (
                <p className="mt-1 rounded-xl bg-white/50 px-3 py-2 text-[11px] text-slate-500 ring-1 ring-white/50">
                  In uso i {view.base.services.length} servizi di codice.
                </p>
              )}
              {services.map((s, i) => (
                <Row key={i} onRemove={() => setServices((prev) => prev.filter((_, j) => j !== i))}>
                  <input
                    name={`service_title_${i}`}
                    value={s.title}
                    onChange={(e) => setServices((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    maxLength={120}
                    placeholder={`Titolo servizio ${i + 1}`}
                    className={inputCls}
                  />
                  <textarea
                    name={`service_text_${i}`}
                    value={s.text}
                    onChange={(e) => setServices((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    rows={2}
                    maxLength={800}
                    placeholder={`Descrizione servizio ${i + 1}`}
                    className={inputCls}
                  />
                </Row>
              ))}
            </div>

            {/* Prova sul territorio */}
            <label className="block text-xs font-semibold text-slate-600">
              «Prova sul territorio» <span className="font-normal text-slate-400">(vuoto = testo di codice)</span>
              <textarea name="proof" value={proof} onChange={(e) => setProof(e.target.value)} rows={2} maxLength={500} className={inputCls} />
            </label>

            {/* FAQ */}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600">
                  FAQ{" "}
                  <span className="font-normal text-slate-400">
                    ({faq.length || `testi di codice: ${view.base.faq.length}`})
                  </span>
                </p>
                {faq.length < 12 && (
                  <button
                    type="button"
                    onClick={addFaq}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    FAQ
                  </button>
                )}
              </div>
              {faq.length === 0 && (
                <p className="mt-1 rounded-xl bg-white/50 px-3 py-2 text-[11px] text-slate-500 ring-1 ring-white/50">
                  In uso le {view.base.faq.length} FAQ di codice (anche nel JSON-LD FAQPage).
                </p>
              )}
              {faq.map((f, i) => (
                <Row key={i} onRemove={() => setFaq((prev) => prev.filter((_, j) => j !== i))}>
                  <input
                    name={`faq_q_${i}`}
                    value={f.q}
                    onChange={(e) => setFaq((prev) => prev.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                    maxLength={300}
                    placeholder={`Domanda ${i + 1} — come la scriverebbe il cliente su Google`}
                    className={inputCls}
                  />
                  <textarea
                    name={`faq_a_${i}`}
                    value={f.a}
                    onChange={(e) => setFaq((prev) => prev.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
                    rows={2}
                    maxLength={1500}
                    placeholder={`Risposta ${i + 1}`}
                    className={inputCls}
                  />
                </Row>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/60 pt-3">
              <button
                type="button"
                onClick={askAmbrosio}
                disabled={aiBusy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-600/90 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-glass-btn transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
              >
                <Sparkles className={`h-3.5 w-3.5 ${aiBusy ? "animate-pulse" : ""}`} aria-hidden />
                {aiBusy ? "Ambrosio scrive…" : aiNote ? "Riscrivi con Ambrosio" : "Ambrosio riscrive"}
              </button>
              <div className="flex gap-2">
                {customized && (
                  <button
                    type="submit"
                    formAction={resetSeoLandingContentAction}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/60 px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-white/60 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    Ripristina contenuti
                  </button>
                )}
                <GlassButton type="submit" size="sm">
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Salva contenuti
                </GlassButton>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
