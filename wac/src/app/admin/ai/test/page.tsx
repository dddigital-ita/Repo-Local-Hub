import { FlaskConical } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getAiSettings } from "@/lib/ai";
import { testAiAction } from "../../actions";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Prova dal vivo · Ambrosio AI", robots: { index: false } };

export default async function AiTestPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string; reply?: string }>;
}) {
  await requireAdmin();
  const ai = await getAiSettings();
  const { test, reply } = await searchParams;

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={FlaskConical}
        tone="text-violet-600"
        title="Prova dal vivo"
        subtitle="Simula una domanda cliente: la risposta usa il provider configurato (serve chiave salvata + Ambrosio attiva)."
      />

      <form action={testAiAction} className="glass-solid space-y-3 rounded-3xl p-5">
        <div className="flex gap-2">
          <input
            name="question"
            defaultValue="Quanto costa un sito vetrina e in quanto tempo?"
            className="w-full rounded-full border border-white/50 bg-white/70 px-4 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
          />
          <button className="shrink-0 rounded-full bg-violet-600/90 px-5 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-violet-500/90">
            Testa
          </button>
        </div>
        {reply && (
          <div className="rounded-2xl bg-violet-50/80 p-4 ring-1 ring-violet-200/60">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-violet-500">
              Risposta di Ambrosio a «{test}»
            </p>
            <p className="whitespace-pre-line text-sm text-slate-800">{reply}</p>
          </div>
        )}
      </form>

      {!ai?.enabled && (
        <p className="rounded-2xl bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200/70">
          Ambrosio è disattivata: il test mostra comunque la risposta del provider, ma in produzione non
          risponderebbe. Attivala in «Configurazione».
        </p>
      )}
    </div>
  );
}
