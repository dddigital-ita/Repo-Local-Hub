"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle, Check, HelpCircle, Languages, Lightbulb, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X,
} from "lucide-react";
import { deleteAiFaqAction, draftFaqAnswerAction, saveAiFaqAction, translateFaqAction } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import { UiIcon } from "@/components/icon-registry";

/**
 * Tool vincente: le domande vere dei clienti, raggruppate per somiglianza e
 * ordinate per urgenza, diventano risposte ufficiali che Ambrosio usa al
 * posto di improvvisare. Per ogni gruppo: «Crea FAQ» (form precompilato) o
 * «Bozza AI» (l'AI scrive la prima versione, l'agente la verifica e salva).
 */

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  priority: number;
  active: boolean;
  /** Traduzioni approvate (Fase 3); l'italiano resta la fonte di verità. */
  translations?: Record<string, string> | null;
}

export interface FaqSuggestionItem {
  question: string;
  count: number;
  examples: string[];
  covered: boolean;
}

export default function AiFaqSection({
  faqs,
  suggestions,
  aiDraft,
  draftError,
}: {
  faqs: FaqItem[];
  suggestions: FaqSuggestionItem[];
  /** Bozza generata dall'AI (?q=...&draft=...): apre il form precompilato. */
  aiDraft?: { q: string; draft: string; note?: string } | null;
  /** Errore della generazione (?faq_draft_error=...). */
  draftError?: string | null;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(aiDraft?.q ?? null);
  const [busy, setBusy] = useState(false);

  // Bozza AI arrivata via URL: la prop aiDraft non cambia mai nel ciclo di
  // vita del componente (arriva dai search params server), quindi lo stato
  // inizializzato da essa è già la verità — niente copia in effect.
  const [highlight, setHighlight] = useState(Boolean(aiDraft));
  useEffect(() => {
    if (!aiDraft) return;
    requestAnimationFrame(() => {
      document.getElementById("faq-new-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [aiDraft]);

  // URL pulito dopo che il form è stato aperto (il refresh non riapre il draft).
  useEffect(() => {
    if (!aiDraft && !draftError) return;
    const url = new URL(window.location.href);
    ["q", "draft", "note", "faq_draft_error"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url.toString());
  }, [aiDraft, draftError]);

  async function run(fd: FormData, action: "save" | "delete") {
    setBusy(true);
    try {
      if (action === "delete") await deleteAiFaqAction(fd);
      else await saveAiFaqAction(fd);
      toastSaved(action === "delete" ? "ai_faq_deleted" : "ai_faq_saved");
      setEditingId(null);
      setDraft(null);
      setHighlight(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function teach(q: string) {
    setEditingId(null);
    setHighlight(false);
    setDraft(q);
    requestAnimationFrame(() => {
      document.getElementById("faq-new-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const openCount = suggestions.filter((s) => !s.covered).length;

  return (
    <div>
      {draftError && (
        <p className="mb-3 flex items-start gap-2 rounded-2xl bg-amber-50/90 p-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200/70">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {draftError}
        </p>
      )}

      {/* Suggerimenti: domande raggruppate, le urgenti prima */}
      {suggestions.length > 0 && (
        <div className="rounded-2xl bg-white/50 p-3.5 ring-1 ring-violet-100/70">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            Domande dei clienti da trasformare in risposte
            {openCount > 0 && (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                {openCount} da coprire
              </span>
            )}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {suggestions.map((s) => (
              <li
                key={s.question}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                  s.covered ? "bg-slate-50/80" : "bg-white/80 ring-1 ring-violet-100"
                }`}
              >
                <span className="min-w-0 flex-1" title={s.examples.slice(1).join("\n") || undefined}>
                  <span className={`block truncate text-xs font-medium ${s.covered ? "text-slate-400" : "text-slate-800"}`}>
                    “{s.question}”
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    {s.count > 1 ? `fatta ${s.count} volte` : "fatta 1 volta"}
                    {s.covered && (
                      <>
                        {" · già coperta da una FAQ"}
                        <UiIcon name="check" size={10} className="inline-block" />
                      </>
                    )}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5">
                  <AiDraftButton question={s.question} disabled={s.covered} />
                  <button
                    type="button"
                    disabled={s.covered}
                    onClick={() => teach(s.question)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full border border-violet-200/80 bg-violet-50/60 px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    Crea FAQ
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Le risposte ufficiali insegnate finora */}
      <div className="mt-3 space-y-2">
        {faqs.map((f) =>
          editingId === f.id ? (
            <FaqForm key={f.id} item={f} busy={busy} onCancel={() => setEditingId(null)} onSubmit={(fd) => run(fd, "save")} />
          ) : (
            <div
              key={f.id}
              className={`rounded-2xl border p-3.5 transition ${
                f.active ? "border-white/50 bg-white/60" : "border-slate-200/60 bg-slate-50/60 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-slate-900">
                  {!f.active && <span className="mr-1.5 text-[10px] font-bold uppercase text-slate-400">off</span>}«{f.question}»
                </p>
                <span className="inline-flex shrink-0 items-center gap-1">
                  <span
                    title={`Priorità ${f.priority}: più bassa = più in alto nel prompt`}
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                  >
                    #{f.priority}
                  </span>
                  {f.translations && Object.keys(f.translations).length > 0 && (
                    <span
                      title={`Traduzioni: ${Object.keys(f.translations).join(", ").toUpperCase()}`}
                      className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700"
                    >
                      <UiIcon name="globe" size={10} />
                      {Object.keys(f.translations).length}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Modifica la risposta a «${f.question}»`}
                    onClick={() => {
                      setDraft(null);
                      setHighlight(false);
                      setEditingId(f.id);
                    }}
                    className="rounded-full p-1.5 text-slate-400 transition hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <DeleteFaqButton id={f.id} busy={busy} onDelete={(fd) => run(fd, "delete")} />
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-600">{f.answer}</p>
            </div>
          ),
        )}

        {editingId === null && (draft !== null || faqs.length === 0) ? (
          <FaqForm
            draftQuestion={draft ?? undefined}
            draftAnswer={draft === aiDraft?.q ? aiDraft?.draft : undefined}
            highlight={highlight}
            busy={busy}
            onCancel={() => {
              setDraft(null);
              setHighlight(false);
            }}
            onSubmit={(fd) => run(fd, "save")}
          />
        ) : (
          editingId === null && (
            <button
              type="button"
              onClick={() => setDraft("")}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-violet-300/80 bg-violet-50/50 px-4 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Insegna a Ambrosio una nuova risposta
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** Bottone «Bozza AI»: chiama la server action che genera e riapre il form compilato. */
function AiDraftButton({ question, disabled }: { question: string; disabled?: boolean }) {
  return (
    <form action={draftFaqAnswerAction}>
      <input type="hidden" name="question" value={question} />
      <DraftSubmitButton disabled={disabled} />
    </form>
  );
}

function DraftSubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title="L'AI scrive la prima bozza della risposta: la verifichi e la salvi"
      className="inline-flex min-h-9 items-center gap-1 rounded-full bg-violet-600/90 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-violet-500/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {pending ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Sparkles className="h-3 w-3" aria-hidden />}
      {pending ? "Scrivo…" : "Bozza AI"}
    </button>
  );
}

function FaqForm({
  item,
  draftQuestion,
  draftAnswer,
  highlight,
  busy,
  onCancel,
  onSubmit,
}: {
  item?: FaqItem;
  draftQuestion?: string;
  draftAnswer?: string;
  highlight?: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  return (
    <form
      id={item?.id ? undefined : "faq-new-form"}
      onSubmit={submit}
      className={`space-y-2 rounded-2xl border p-3.5 transition ${
        highlight ? "border-violet-400/80 bg-violet-50/60 ring-2 ring-violet-200/70" : "border-violet-200/70 bg-violet-50/40"
      }`}
    >
      {item?.id && <input type="hidden" name="id" value={item.id} />}
      {highlight && (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden />
          Bozza scritta dall&apos;AI: controlla prezzi e tempi (tra parentesi quadre) e correggi prima di salvare.
        </p>
      )}
      <div>
        <label htmlFor={`faq-q-${item?.id ?? "new"}`} className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
          Quando il cliente chiede
        </label>
        <input
          id={`faq-q-${item?.id ?? "new"}`}
          name="question"
          required
          maxLength={300}
          defaultValue={item?.question ?? draftQuestion ?? ""}
          key={item?.id ?? draftQuestion ?? "new"} // re-render quando arriva una nuova domanda
          placeholder="es. Quanto costa un sito vetrina?"
          className="mt-1 w-full rounded-xl border border-white/60 bg-white/80 px-3 py-2 text-sm outline-none backdrop-blur transition focus:border-violet-400"
        />
      </div>
      <div>
        <label htmlFor={`faq-a-${item?.id ?? "new"}`} className="text-[11px] font-bold uppercase tracking-wide text-violet-500">
          Ambrosio risponde con (la risposta vincente)
        </label>
        <textarea
          id={`faq-a-${item?.id ?? "new"}`}
          name="answer"
          required
          rows={4}
          maxLength={2000}
          defaultValue={item?.answer ?? draftAnswer ?? ""}
          key={item?.id ?? `a-${draftAnswer ?? "empty"}`}
          placeholder="La risposta ufficiale: prezzi veri, tempi, e l'invito a fissare l'appuntamento…"
          className="mt-1 w-full resize-y rounded-xl border border-white/60 bg-white/80 px-3 py-2 text-sm leading-relaxed outline-none backdrop-blur transition focus:border-violet-400"
        />
      </div>
      <TranslationsEditor faqId={item?.id} question={item?.question ?? draftQuestion ?? ""} answer={item?.answer ?? draftAnswer ?? ""} initial={item?.translations ?? null} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
          Priorità
          <input
            name="priority"
            type="number"
            min={1}
            max={99}
            defaultValue={item?.priority ?? 50}
            className="w-16 rounded-lg border border-white/60 bg-white/80 px-2 py-1 text-xs outline-none focus:border-violet-400"
          />
          <span className="text-[11px] text-slate-400">(1 = la prima che usa)</span>
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" name="active" defaultChecked={item?.active ?? true} className="size-4 accent-emerald-500" />
          Attiva
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Annulla
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-violet-600/90 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {item?.id ? (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Salva modifiche
            </>
          ) : (
            "Insegna a Ambrosio"
          )}
        </button>
      </div>
    </form>
  );
}

function DeleteFaqButton({ id, busy, onDelete }: { id: string; busy: boolean; onDelete: (fd: FormData) => void }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const fd = new FormData();
            fd.set("id", id);
            onDelete(fd);
          }}
          className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-red-600"
        >
          Elimina
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          aria-label="Annulla eliminazione"
          className="rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900"
        >
          No
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label="Elimina FAQ"
      disabled={busy}
      onClick={() => setConfirming(true)}
      className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** Lingue gestite (Fase 3): l'italiano è la fonte di verità, queste sono le traduzioni. */
const FAQ_LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

/**
 * Traduzioni opzionali della FAQ: senza traduzione Ambrosio risponde comunque
 * nella lingua del cliente (parafrasa l'italiano); con traduzione usa quella
 * ufficiale. «Traduci con AI» precompila le bozze: il team verifica e salva.
 */
function TranslationsEditor({
  faqId,
  question,
  answer,
  initial,
}: {
  faqId?: string;
  question: string;
  answer: string;
  initial: Record<string, string> | null;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const { code } of FAQ_LANGS) v[code] = initial?.[code] ?? "";
    return v;
  });
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function translateAll() {
    if (translating) return;
    setTranslating(true);
    setError(null);
    try {
      const res = await translateFaqAction(question, answer);
      if (res.ok && res.translations) {
        setValues((prev) => ({ ...prev, ...res.translations }));
      } else {
        setError(res.error ?? "Traduzione non disponibile.");
      }
    } catch {
      setError("Errore di rete: riprova.");
    } finally {
      setTranslating(false);
    }
  }

  function toggle() {
    setOpen((o) => !o);
    setError(null);
  }

  const filled = FAQ_LANGS.filter((l) => values[l.code].trim()).length;

  return (
    <div className="rounded-xl bg-sky-50/50 p-2.5 ring-1 ring-sky-100/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={toggle} className="inline-flex min-h-8 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          <Languages className="h-3.5 w-3.5" aria-hidden />
          Traduzioni (opzionali){filled > 0 ? ` · ${filled} presenti` : ""}
        </button>
        {open && (
          <button
            type="button"
            onClick={translateAll}
            disabled={translating || !question.trim() || !answer.trim()}
            title="Bozza AI in en/de/fr/es: il team la verifica prima di salvare"
            className="inline-flex min-h-8 items-center gap-1 rounded-full bg-sky-600/90 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-sky-500/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {translating ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden /> : <Sparkles className="h-3 w-3" aria-hidden />}
            {translating ? "Traduco…" : "Traduci con AI"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
          {FAQ_LANGS.map(({ code, label }) => (
            <div key={code}>
              <label htmlFor={`faq-tr-${code}-${faqId ?? "new"}`} className="text-[10px] font-bold uppercase tracking-wide text-sky-600">
                {label}
              </label>
              <textarea
                id={`faq-tr-${code}-${faqId ?? "new"}`}
                rows={2}
                maxLength={2000}
                value={values[code]}
                onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                placeholder={`Domanda e risposta in ${label}…`}
                className="mt-0.5 w-full resize-y rounded-lg border border-white/60 bg-white/80 px-2.5 py-1.5 text-xs outline-none focus:border-sky-400"
              />
            </div>
          ))}
          <p className="text-[10px] leading-relaxed text-slate-400">
            Senza traduzione Ambrosio risponde comunque nella lingua del cliente parafrasando l&apos;italiano. Le traduzioni qui sono la versione ufficiale.
          </p>
        </div>
      )}
      {/* I valori viaggiano col form come JSON: sanitizzati lato server */}
      <input type="hidden" name="translations" value={JSON.stringify(Object.fromEntries(FAQ_LANGS.map(({ code }) => [code, values[code]].filter(([, v]) => String(v).trim()))))} />
    </div>
  );
}
