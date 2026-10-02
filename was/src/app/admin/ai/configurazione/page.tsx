import Link from "next/link";
import { Settings2, TriangleAlert } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getAiSettings, getLegacyKeyStatus, PROVIDERS, DEFAULT_SYSTEM_PROMPT } from "@/lib/ai";
import { resetAiPromptAction, saveAiSettingsAction } from "../../actions";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configurazione · Ambrosio AI", robots: { index: false } };

export default async function AiConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ legacy?: string }>;
}) {
  await requireAdmin();
  const [{ legacy }, ai] = await Promise.all([searchParams, getAiSettings()]);
  const legacyStatus = await getLegacyKeyStatus();
  // providerLabel come in pagina provider: prima parola dell'etichetta.
  const providerLabel = (k: string) => PROVIDERS.find((p) => p.key === k)?.label.split(" ")[0] ?? k;

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={Settings2}
        title="Configurazione di Ambrosio"
        subtitle="Attivazione, provider, modello, chiave e personalità: tutto il carattere di Ambrosio in una scheda."
      />

      {/* AVVISO POST-SAVE: la chiave appena salvata ha RIUSATO lo slot legacy
          che apparteneva a un altro provider. Quella chiave ora sovrascrive la
          chiave della card del primario in providerChain: se è vecchia (es. la
          chiave Anthropic scaduta vista sul vivo), il primario parte con 401.
          L'admin deve saperlo subito, non scavando nei log. */}
      {legacy && (
        <section className="glass-solid rounded-3xl p-5 ring-1 ring-amber-300/60">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-700">
            <TriangleAlert className="size-4" /> Attenzione: chiave già presente per {providerLabel(legacy)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Il form di Configurazione salva la chiave nello slot generale, che
            <strong className="text-slate-800"> sovrascrive quella salvata sulla card di {providerLabel(legacy)}</strong> nella
            sezione «Intelligenze multiple»: la catena ora userà questa. Se la chiave di {providerLabel(legacy)} era
            ancora valida, puoi reinserirla lì; se invece questa è vecchia, ogni risposta partirà con un errore del
            primario. Controlla la tabella «Ultime risposte della catena» in
            <Link href="/admin/ai/provider" className="mx-1 font-semibold text-violet-700 underline underline-offset-2">
              Intelligenze multiple
            </Link>
            per verificare che il primario risponda senza fallback.
          </p>
        </section>
      )}

      {/* AVVISO STATICO: c&apos;è già una chiave legacy attiva (per il provider
          attuale) — il salvataggio con una nuova chiave la sostituirà. */}
      {!legacy && legacyStatus.hasLegacyKey && (
        <p className="rounded-2xl bg-amber-50/70 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200/60">
          Esiste già una chiave salvata qui ({providerLabel(legacyStatus.legacyProvider ?? "")}): salvando una nuova
          chiave la sostituirai, e quella varrà più della chiave della card del provider in «Intelligenze multiple».
        </p>
      )}

      {/* Form configurazione */}
      <form action={saveAiSettingsAction} className="glass-solid space-y-4 rounded-3xl p-5">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-800">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={ai?.enabled ?? false}
            className="h-4 w-4 accent-violet-600"
          />
          Attiva Ambrosio fuori turno
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="provider" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Provider
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={ai?.provider ?? "anthropic"}
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            >
              {PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {PROVIDERS.find((p) => p.key === ai?.provider)?.hint ?? "qualsiasi provider OpenAI-compatible"}
            </p>
          </div>
          <div>
            <label htmlFor="model" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Modello
            </label>
            <input
              id="model"
              name="model"
              defaultValue={ai?.model ?? ""}
              placeholder="es. claude-sonnet-4-5"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="apiKey" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Chiave API {ai?.hasKey && "(lascia vuota per tenere quella salvata)"}
            </label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </div>
          <div>
            <label htmlFor="baseUrl" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Base URL (solo provider custom)
            </label>
            <input
              id="baseUrl"
              name="baseUrl"
              defaultValue={ai?.baseUrl ?? ""}
              placeholder="https://mio-server.local/v1"
              className="mt-1 w-full rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
            />
          </div>
        </div>

        <div>
          <label htmlFor="systemPrompt" className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Prompt di sistema (personalità e regole di Ambrosio)
          </label>
          <textarea
            id="systemPrompt"
            name="systemPrompt"
            rows={8}
            defaultValue={ai?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
            className="mt-1 w-full resize-y rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 font-mono text-xs leading-relaxed outline-none backdrop-blur-xl focus:border-violet-400"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Le fasce prezzo nel prompt sono indicative: aggiornale quando decidi il listino ufficiale.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="temperature" className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Creatività (temperature)
          </label>
          <input
            id="temperature"
            name="temperature"
            type="number"
            min={0}
            max={1}
            step={0.1}
            defaultValue={ai?.temperature ?? 0.4}
            className="w-20 rounded-xl border border-white/50 bg-white/70 px-2 py-1.5 text-sm outline-none backdrop-blur-xl focus:border-violet-400"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* formAction: nessun form annidato (HTML vieta form dentro form e
              React va in hydration error). Il submit va a resetAiPromptAction
              ignorando i campi del form principale. */}
          <button
            type="submit"
            formAction={resetAiPromptAction}
            formNoValidate
            title="Ripristina il prompt originale di Ambrosio"
            className="rounded-full border border-white/50 bg-white/60 px-4 py-2.5 text-sm font-semibold text-slate-600 backdrop-blur-xl transition hover:bg-white/90"
          >
            Ripristina prompt
          </button>
          <button className="rounded-full bg-violet-600/90 px-6 py-2.5 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-violet-500/90">
            Salva configurazione
          </button>
        </div>
      </form>
    </div>
  );
}
