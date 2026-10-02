import { BookOpen } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { listDocuments } from "@/lib/ambrosio-server";
import { saveAiDocumentAction, deleteAiDocumentAction } from "../actions";
import { SubPageHeader } from "@/components/sub-page-header";
import { HubCount } from "@/components/settings-hub";
import { DOC_CATEGORIES, DOC_LANGS, DOC_BODY_MAX } from "@/lib/ambrosio-autonomy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Documenti · Ambrosio AI", robots: { index: false } };

/**
 * SEZIONE DOCUMENTI — la biblioteca che istruisce Ambrosio (esattamente la
 * richiesta: «sezione documenti per ambrosio potrebbe essere utile averla»).
 * Ogni documento è verità dell'agenzia: Ambrosio lo usa per rispondere senza
 * improvvisare. A L3 può citarne la fonte; a L1/L2 le usa in silenzio.
 */
export default async function AiDocumentsPage() {
  await requireAdmin();
  const docs = await listDocuments();
  const active = docs.filter((d) => d.active);

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={BookOpen}
        tone="text-violet-600"
        title="Documenti di Ambrosio"
        subtitle="La biblioteca che lo istruisce: procedure, prezzi, politiche. Vengono iniettati nel prompt come verità dell'agenzia, accanto alle FAQ."
        right={<HubCount n={active.length} label="attivi" />}
      />

      {/* ── Nuovo documento ── */}
      <form action={saveAiDocumentAction} className="glass-solid space-y-4 rounded-3xl p-5">
        <h2 className="text-sm font-bold text-slate-900">Nuovo documento</h2>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <label htmlFor="title" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Titolo
            </label>
            <input
              id="title"
              name="title"
              required
              maxLength={150}
              placeholder="es. Politica garanzia e revisioni"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </div>
          <div>
            <label htmlFor="category" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Categoria
            </label>
            <select
              id="category"
              name="category"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            >
              {DOC_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lang" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Lingua
            </label>
            <select
              id="lang"
              name="lang"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            >
              {DOC_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="priority" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Priorità
            </label>
            <input
              id="priority"
              name="priority"
              type="number"
              min={1}
              max={50}
              defaultValue={10}
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </div>
        </div>
        <div>
          <label htmlFor="body" className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Contenuto (massimo {DOC_BODY_MAX} caratteri)
          </label>
          <textarea
            id="body"
            name="body"
            required
            rows={5}
            maxLength={DOC_BODY_MAX}
            placeholder="es. La garanzia copre 12 mesi di correzioni bug a partire dalla pubblicazione. Le revisioni grafiche incluse sono 2 per progetto; le successive si quotano a parte…"
            className="mt-1 w-full resize-y rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm leading-relaxed outline-none backdrop-blur-xl focus:border-violet-400"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="active" defaultChecked className="h-4 w-4 accent-violet-600" />
          Attivo (iniettato nel prompt)
        </label>
        <div>
          <button className="rounded-full bg-violet-600/90 px-6 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-violet-500/90">
            Salva documento
          </button>
        </div>
      </form>

      {/* ── Elenco documenti ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Documenti salvati ({docs.length})</h2>
        {docs.length === 0 && (
          <p className="glass-solid rounded-3xl p-5 text-sm text-slate-500">
            Nessun documento: Ambrosio risponde con le regole del prompt e le FAQ. Aggiungi procedure e politiche per farlo rispondere come il team.
          </p>
        )}
        {docs.map((d) => (
          <form key={d.id} action={saveAiDocumentAction} className="glass-solid space-y-3 rounded-3xl p-5">
            <input type="hidden" name="id" value={d.id} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="title"
                  defaultValue={d.title}
                  maxLength={150}
                  className="rounded-xl border border-white/50 bg-white/70 px-3 py-1.5 text-sm font-semibold outline-none backdrop-blur-xl focus:border-violet-400"
                />
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
                    d.active ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200/70" : "bg-slate-100/80 text-slate-500 ring-slate-200/70"
                  }`}
                >
                  {d.active ? "Attivo" : "Spento"}
                </span>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-white/50">
                  {d.category} · {d.lang.toUpperCase()} · pr. {d.priority}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" name="active" defaultChecked={d.active} className="h-3.5 w-3.5 accent-violet-600" />
                  Attivo
                </label>
                <button
                  type="submit"
                  formAction={deleteAiDocumentAction}
                  formNoValidate
                  className="rounded-full border border-red-200/70 bg-red-50/80 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100/80"
                >
                  Elimina
                </button>
                <button className="rounded-full bg-white/70 px-4 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-white/60 transition hover:bg-white/95">
                  Salva
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_80px]">
              <select
                name="category"
                defaultValue={d.category}
                className="rounded-2xl border border-white/50 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
              >
                {DOC_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                name="lang"
                defaultValue={d.lang}
                className="rounded-2xl border border-white/50 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
              >
                {DOC_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                name="priority"
                type="number"
                min={1}
                max={50}
                defaultValue={d.priority}
                className="rounded-2xl border border-white/50 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
              />
            </div>
            <textarea
              name="body"
              rows={4}
              maxLength={DOC_BODY_MAX}
              defaultValue={d.body}
              className="w-full resize-y rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm leading-relaxed outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </form>
        ))}
      </section>
    </div>
  );
}
