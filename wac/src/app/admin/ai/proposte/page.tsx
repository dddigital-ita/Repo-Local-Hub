import { FileText } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { listProposals } from "@/lib/ambrosio-server";
import { setProposalStatusAction } from "../actions";
import { SubPageHeader } from "@/components/sub-page-header";
import { HubCount } from "@/components/settings-hub";
import { PROPOSAL_STATUS_LABEL, PROPOSAL_TONE, PROPOSAL_STATUSES } from "@/lib/ambrosio-autonomy";

export const dynamic = "force-dynamic";

export const metadata = { title: "Proposte · Ambrosio AI", robots: { index: false } };

/**
 * PROPOSTE DI AMBROSIO (L3) — le bozze nate in chat o dal take-over SLA.
 * Il flusso è umano-nel-loop: Ambrosio prepara, il team approva e invia.
 * Nessuna proposta parte da sola: lo stato «Bozza» è la garanzia.
 */
export default async function AiProposalsPage() {
  await requireAdmin();
  const proposals = await listProposals();
  const drafts = proposals.filter((p) => p.status === "draft").length;

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={FileText}
        tone="text-violet-600"
        title="Proposte di Ambrosio"
        subtitle="Le bozze con preventivo preparate da Ambrosio (livello 3): le revisioni il team, poi si inviano. Nessuna proposta parte da sola."
        right={<HubCount n={drafts} label="in bozza" />}
      />

      {proposals.length === 0 && (
        <p className="glass-solid rounded-3xl p-5 text-sm text-slate-500">
          Nessuna proposta ancora. A livello 3, Ambrosio prepara una bozza quando il cliente chiede un preventivo o quando subentra su un ticket con SLA scaduta.
        </p>
      )}

      <section className="space-y-3">
        {proposals.map((p) => (
          <article key={p.id} className="glass-solid space-y-3 rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900">{p.title}</h2>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PROPOSAL_TONE[p.status] ?? PROPOSAL_TONE.draft}`}>
                  {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                </span>
                {p.ticket_number && (
                  <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-white/50">
                    Ticket #{p.ticket_number}
                    {p.lead_name ? ` · ${p.lead_name}` : ""}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">
                {new Date(p.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>

            {p.items.length > 0 && (
              <ul className="rounded-2xl bg-white/60 p-3 ring-1 ring-white/50">
                {p.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 border-b border-white/60 py-1 text-sm last:border-0">
                    <span className="text-slate-700">{it.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{it.price}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{p.body}</p>

            <div className="flex flex-wrap items-center gap-2">
              {PROPOSAL_STATUSES.filter((s) => s !== p.status).map((s) => (
                <form key={s} action={setProposalStatusAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="status" value={s} />
                  <button
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                      s === "approved"
                        ? "bg-emerald-600/90 text-white shadow-glass-btn hover:bg-emerald-500/90"
                        : s === "lost"
                          ? "border border-white/50 bg-white/60 text-slate-500 hover:bg-white/90"
                          : "border border-white/50 bg-white/60 text-slate-700 ring-1 ring-white/60 hover:bg-white/95"
                    }`}
                  >
                    → {PROPOSAL_STATUS_LABEL[s]}
                  </button>
                </form>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
