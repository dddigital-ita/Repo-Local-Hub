import { KeyRound, TriangleAlert } from "lucide-react";
import { UiIcon } from "@/components/icon-registry";
import { requireAdmin } from "@/lib/admin";
import { getAiSettings, getProviderKeyStatuses, getProviderUsageStats, getRecentProviderLogs, getLegacyKeyStatus, PROVIDERS } from "@/lib/ai";
import { saveProviderKeyAction, setPrimaryProviderAction, clearLegacyKeyAction } from "../../actions";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Intelligenze multiple · Ambrosio AI", robots: { index: false } };

const providerLabel = (k: string) => PROVIDERS.find((p) => p.key === k)?.label.split(" ")[0] ?? k;

export default async function AiProvidersPage() {
  await requireAdmin();
  const [ai, keyStatuses, usage, recentLogs, legacy] = await Promise.all([
    getAiSettings(),
    getProviderKeyStatuses(),
    getProviderUsageStats(30),
    getRecentProviderLogs(15),
    getLegacyKeyStatus(),
  ]);

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={KeyRound}
        title="Intelligenze multiple e fallback automatico"
        subtitle="Salva più chiavi: se il provider primario va in errore o finisce i token, Ambrosio passa da sola al successivo — la chat non si blocca mai."
      />

      {/* CHIAVE LEGACY: il form di Configurazione salva la chiave anche in
          ai_settings, dove SOVRASCRIVE quella del primario nella catena. Se
          è vecchia/invalida, il primario fallisce (401) PRIMA di provare le
          chiavi buone — e non c'era modo di cancellarla dall'UI. */}
      {legacy.hasLegacyKey && (
        <section className="glass-solid rounded-3xl p-5 ring-1 ring-amber-300/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-amber-700">
                <TriangleAlert className="size-4" /> Chiave legacy attiva
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                C&apos;è una chiave salvata dal vecchio form di «Configurazione» (per il provider
                <strong className="text-slate-800"> {legacy.legacyProvider ?? "—"}</strong>). Nella catena
                <strong className="text-slate-800"> quella conta più delle chiavi qui sotto</strong> per il
                primario: se è vecchia o invalida, ogni risposta parte con un errore del primario e il
                fallback si attiva per gusto. Se usi solo le card qui sotto, rimuovila.
              </p>
            </div>
            <form action={clearLegacyKeyAction}>
              <button className="rounded-full border border-amber-300/70 bg-amber-50/80 px-4 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100/80">
                Rimuovi chiave legacy
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="glass-solid rounded-3xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Come provare il fallback</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
          <li>
            In <strong>Prova dal vivo</strong> («Prova dal vivo» nel menu Ambrosio) fai una domanda e guarda la riga
            del provider: <span className="text-emerald-700">[provider: X]</span> significa primario riuscito;
            <span className="text-amber-700"> [provider: X — dopo fallback da Y, Z]</span> significa che Y e Z
            hanno fallito PRIMA.
          </li>
          <li>
            Qui sotto, «Chi risponde davvero · ultimi 30 giorni» conta quante risposte sono arrivate da ciascun
            provider e quante «dopo fallback»: è il dado storico, non serve rifare il test a mano.
          </li>
          <li>
            Per simulare un guasto: disattiva il primario togliendo la spunta «Attivo nel fallback» e salva, poi
            rifai il test — la risposta deve arrivare dal provider successivo della catena. Riattiva dopo.
          </li>
          <li>
            Un 401 ripetuto sul primario (log errori <code className="rounded bg-slate-100 px-1">[ambrosio] provider … fallito</code>)
            con chiave «salvata» è quasi sempre una chiave scaduta o la chiave legacy qui sopra.
          </li>
        </ol>
      </section>

      <section className="glass-solid rounded-3xl p-5">
        <p className="text-sm text-slate-500">
          Ordine di fallback attuale:{" "}
          {[
            ai?.provider,
            ...PROVIDERS.map((p) => p.key).filter((k) => k !== ai?.provider),
          ]
            .map((k) => PROVIDERS.find((p) => p.key === k)?.label.split(" ")[0] ?? k)
            .join(" → ")}
          .
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {PROVIDERS.map((p) => {
            const st = keyStatuses.find((k) => k.provider === p.key);
            const isPrimary = ai?.provider === p.key;
            return (
              <form key={p.key} action={saveProviderKeyAction} className={`rounded-2xl border p-4 transition ${isPrimary ? "border-brand-300/70 bg-brand-50/40" : "border-slate-200/70 bg-white/50"}`}>
                <input type="hidden" name="provider" value={p.key} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{p.label}</span>
                  <span className="flex items-center gap-1.5">
                    {isPrimary && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                        Primario
                      </span>
                    )}
                    {st?.hasKey ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">chiave salvata</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">nessuna</span>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{p.hint}</p>
                <input
                  name="apiKey"
                  type="password"
                  placeholder={st?.hasKey ? "•••••••• (lascia vuoto per tenere)" : "incolla la chiave"}
                  className="mt-2 w-full rounded-xl border border-white/50 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur transition focus:border-brand-400/70"
                />
                <div className="mt-2 flex gap-2">
                  <input
                    name="model"
                    defaultValue={st?.model ?? ""}
                    placeholder={`modello (${p.defaultModel || "default"})`}
                    className="w-full rounded-xl border border-white/50 bg-white/70 px-3 py-2 text-xs outline-none focus:border-brand-400/70"
                  />
                  {p.key === "custom" && (
                    <input
                      name="baseUrl"
                      defaultValue={st?.baseUrl ?? ""}
                      placeholder="Base URL"
                      className="w-full rounded-xl border border-white/50 bg-white/70 px-3 py-2 text-xs outline-none focus:border-brand-400/70"
                    />
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input type="checkbox" name="enabled" defaultChecked={st?.enabled ?? true} className="size-4 accent-emerald-500" />
                    Attivo nel fallback
                  </label>
                  <div className="flex items-center gap-2">
                    {st?.hasKey && (
                      <button
                        type="submit"
                        name="apiKey"
                        value="-"
                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-red-500 transition hover:bg-red-50"
                      >
                        Rimuovi
                      </button>
                    )}
                    {!isPrimary && (
                      <button
                        type="submit"
                        formAction={setPrimaryProviderAction}
                        className="rounded-full border border-brand-200/70 bg-brand-50/70 px-3 py-1.5 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100/80"
                      >
                        Rendi primario
                      </button>
                    )}
                    <button
                      type="submit"
                      className="rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                    >
                      Salva
                    </button>
                  </div>
                </div>
              </form>
            );
          })}
        </div>
      </section>

      <section className="glass-solid rounded-3xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Chi risponde davvero · ultimi 30 giorni</h2>
        {usage.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Nessuna risposta registrata: qui compariranno le statistiche dalla prima risposta di Ambrosio (migration 029).
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {usage.map((u) => (
                <div key={u.provider} className="rounded-2xl border border-slate-200/70 bg-white/50 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold text-slate-800">{providerLabel(u.provider)}</span>
                    <span className="text-xs font-semibold text-slate-500">{u.pct}% · {u.uses} risposte</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-500/80" style={{ width: `${Math.max(3, u.pct)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {u.fallbackUses > 0 ? (
                      <span className="font-semibold text-amber-600">{u.fallbackUses} dopo fallback</span>
                    ) : (
                      <span>sempre come primario</span>
                    )}
                    {u.avgLatencyMs != null && <> · {u.avgLatencyMs < 1000 ? `${u.avgLatencyMs} ms` : `${(u.avgLatencyMs / 1000).toFixed(1)} s`} media</>}
                  </p>
                  {u.lastUsedAt && <p className="text-[11px] text-slate-400">ultima: {new Date(u.lastUsedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</p>}
                </div>
              ))}
            </div>

            <div className="mt-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Ultime risposte della catena</h3>
              <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/50">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 font-bold">Quando</th>
                      <th className="px-3 py-2 font-bold">Provider</th>
                      <th className="px-3 py-2 font-bold">Esito</th>
                      <th className="px-3 py-2 font-bold">Fallback provati</th>
                      <th className="px-3 py-2 font-bold">Latenza</th>
                      <th className="px-3 py-2 font-bold">Modello</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentLogs.map((r, i) => (
                      <tr key={i} className="text-slate-600">
                        <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                          {new Date(r.createdAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-800">{providerLabel(r.usedProvider)}</td>
                        <td className="px-3 py-2">
                          {r.fallbacks.length === 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                              <UiIcon name="check" size={11} />
                              primario ok
                            </span>
                          ) : (
                            <span
                              className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700"
                              title="almeno un provider della catena è fallito prima della risposta (errore, 401, rate limit)"
                            >
                              dopo fallback
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.fallbacks.length > 0 ? (
                            <span title="provider provati e falliti prima della risposta, in ordine di tentativo">
                              {r.fallbacks.map((f) => providerLabel(f)).join(" → ")}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                          {r.latencyMs != null ? (r.latencyMs < 1000 ? `${r.latencyMs} ms` : `${(r.latencyMs / 1000).toFixed(1)} s`) : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{r.model ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Ogni riga è una risposta di Ambrosio. Se «Fallback provati» è compilato, quei provider sono falliti
                (errore, 401, rate limit) prima che la catena trovasse chi rispondesse: un 401 ripetuto sul primario
                si vede qui come riga «dopo fallback», senza aprire il log.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
