import { Gauge, ShieldCheck, Zap } from "lucide-react";
import { UiIcon } from "@/components/icon-registry";
import { requireAdmin } from "@/lib/admin";
import { getAiSettings } from "@/lib/ai";
import { saveAutonomyAction } from "../actions";
import { SubPageHeader } from "@/components/sub-page-header";
import { HubStatus } from "@/components/settings-hub";
import { AMBROSIO_LEVELS, ACCESS_LABELS, accessList, MOVES_CAP_MIN, MOVES_CAP_MAX } from "@/lib/ambrosio-autonomy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Autonomia · Ambrosio AI", robots: { index: false } };

/**
 * LIVELLI DI GESTIONE DI AMBROSIO — la scheda dove si decide quanto spazio
 * lasciare alla macchina e quanto all'essere umano. La lista accessi è la
 * stessa mostrata nella card di Ambrosio in /admin/operators: un solo posto
 * (accessList) dice cosa può fare ogni livello.
 */
export default async function AiAutonomyPage() {
  await requireAdmin();
  const ai = await getAiSettings();
  const level = ai?.level ?? 1;
  const cap = ai?.movesCap ?? 4;
  const current = AMBROSIO_LEVELS.find((l) => l.level === level) ?? AMBROSIO_LEVELS[0];

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={Gauge}
        tone="text-violet-600"
        title="Livelli di autonomia"
        subtitle="Quanto può fare da solo Ambrosio: dal solo contatto alla proposta con preventivo. Ogni livello lascia spazio all'essere umano."
        right={<HubStatus ok warn={false} label={current.name} />}
      />

      <form action={saveAutonomyAction} className="glass-solid space-y-5 rounded-3xl p-5">
        {/* ── Livello attivo ── */}
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wide text-slate-500">Livello di gestione attivo</legend>
          {AMBROSIO_LEVELS.map((l) => (
            <label
              key={l.level}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1 transition ${
                level === l.level ? "bg-violet-50/70 ring-violet-300/70" : "bg-white/50 ring-white/60 hover:bg-white/80"
              }`}
            >
              <input
                type="radio"
                name="level"
                value={l.level}
                defaultChecked={level === l.level}
                className="mt-1 h-4 w-4 accent-violet-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{l.name}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{l.tagline}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* ── Tetto mosse (L2 e L3) ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="movesCap" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Tetto mosse (L2 · risposte consecutive max)
            </label>
            <input
              id="movesCap"
              name="movesCap"
              type="number"
              min={MOVES_CAP_MIN}
              max={MOVES_CAP_MAX}
              defaultValue={cap}
              className="mt-1 w-24 rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Raggiunto il tetto, Ambrosio passa la conversazione al team (handoff automatico).
            </p>
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                name="takeoverSla"
                defaultChecked={ai?.takeoverSla ?? true}
                className="mt-1 h-4 w-4 accent-violet-600"
              />
              <span>
                Take-over SLA (solo livello 3)
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  Superata la finestra di risposta, Ambrosio subentra nel thread, raccoglie i dettagli e prepara la bozza di proposta.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div>
          <button className="rounded-full bg-violet-600/90 px-6 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-violet-500/90">
            Salva livello di autonomia
          </button>
        </div>
      </form>

      {/* ── Lista accessi del livello attivo ── */}
      <section className="glass-solid rounded-3xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-violet-600" aria-hidden />
          Accessi di Ambrosio al livello {current.name.split("·")[0].trim()}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          La lista è la stessa mostrata nella card di Ambrosio nella pagina Operatori: un solo catalogo decide cosa può fare ogni livello.
        </p>
        <ul className="mt-3 space-y-1.5">
          {Object.entries(ACCESS_LABELS).map(([fn, label]) => {
            const allowed = accessList(level).some((x) => x === fn);
            return (
              <li key={fn} className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    allowed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                  }`}
                  aria-hidden
                >
                  <UiIcon name={allowed ? "check" : "minus"} size={10} />
                </span>
                <span className={allowed ? "text-slate-800" : "text-slate-400"}>{label}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Zap className="h-3.5 w-3.5 text-violet-500" aria-hidden />
          Ogni azione eseguita finisce nell&apos;audit log con firma «ambrosio@ai»: si sa sempre chi ha fatto cosa.
        </p>
      </section>
    </div>
  );
}
