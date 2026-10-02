import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import StatusPills from "@/components/status-pills";
import { LeadNotesDetails } from "@/components/lead-note-form";
import { LeadTemperature, LeadRowTools } from "@/components/lead-tools";
import { GlassCard as Card, GlassLinkButton, GlassNotice } from "@/components/glass";
import { Download, Flame, CalendarClock, Sparkles, Users } from "lucide-react";

export const dynamic = "force-dynamic";


interface LeadRow {
  id: string;
  name: string;
  phone: string;
  source: string | null;
  service: string | null;
  urgency: string | null;
  existing_site: string | null;
  budget: string | null;
  hot: boolean;
  status: string;
  initial_query: string | null;
  source_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  callback_slot: string | null;
  notes: string | null;
  temperature: string;
  ricontatta_il: string | null;
  created_at: string;
}

export default async function LeadsPage() {
  await requireAdmin();
  const pool = db();
  if (!pool) return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const [{ rows: leads }, { rows: totals }] = await Promise.all([
    pool.query<LeadRow>("select * from leads order by created_at desc limit 200"),
    pool.query<{ n: number }>("select count(*)::int as n from leads"),
  ]);
  const totale = totals[0]?.n ?? leads.length;

  return (
    <div className="space-y-4">
      {/* Header di pagina (pattern Panoramica/Tools): h1 text-2xl + icona +
          sottotitolo, CTA a destra sul design system. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Users className="h-6 w-6 text-brand-600" aria-hidden />
            Lead
          </h1>
          <p className="mt-1 text-sm text-slate-500">Gli ultimi 200 contatti entrati da chat, form e callback.</p>
        </div>
        <GlassLinkButton variant="glass" size="sm" href="/api/admin/leads.csv">
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </GlassLinkButton>
      </header>

      <div className="grid gap-3">
        {/* Onestà sul troncamento: la query ha limit 200. Il numero delle
            card non è il numero dei lead: se il totale supera il limite
            l'utente deve saperlo — gli stessi dati si esportano COMPLETI
            via CSV (stesso invariante del segmento condiviso del gemello). */}
        {totale > leads.length && (
          <GlassNotice tone="info">
            Mostrati i primi {leads.length} lead su {totale} totali —
            l&apos;export CSV contiene l&apos;elenco completo.
          </GlassNotice>
        )}
        {leads.map((lead) => (
          <Card key={lead.id} className="flex flex-col gap-3 md:flex-row md:items-start">
            {/* Colonna identità: titolo, RIGA DI STATO UNICA, contesto. Le
                semantiche (hot, callback, provenienza) stavano DENTRO il
                paragrafo del nome: mescolate all'identità, nessuna col proprio
                senso — ora sono una riga di stato distinta, come nella inbox. */}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">
                {lead.name} ·{" "}
                <a href={`tel:${lead.phone}`} className="text-brand-700 hover:underline">
                  {lead.phone}
                </a>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {lead.source === "ai" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100/90 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                    <Sparkles className="h-3 w-3" aria-hidden /> da Ambrosio
                  </span>
                )}
                {lead.hot && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-100/90 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                    <Flame className="h-3 w-3" aria-hidden /> hot
                  </span>
                )}
                {lead.status === "callback_scheduled" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100/90 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                    <CalendarClock className="h-3 w-3" aria-hidden /> callback fissata{lead.callback_slot ? `: ${lead.callback_slot}` : ""}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-slate-600">
                {[lead.service, lead.urgency, lead.budget, lead.existing_site].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                «{lead.initial_query || "—"}» da {lead.source_page || "?"} ·{" "}
                {new Date(lead.created_at).toLocaleString("it-IT")}
                {lead.utm_source ? ` · utm: ${lead.utm_source}/${lead.utm_medium ?? "-"}` : ""}
              </p>
            </div>
            {/* ZONA AZIONI: cambiare stato È il gesto primario del lead, la
                temperatura e il richiamo sono le secondary, la nota il "+".
                Allineate a destra come la colonna azioni della inbox. */}
            <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
              <StatusPills leadId={lead.id} initial={lead.status} />
              <LeadTemperature leadId={lead.id} initial={lead.temperature} />
              <LeadRowTools leadId={lead.id} ricontattaIl={lead.ricontatta_il} />
              {/* Il <details> Note è posseduto dal client wrapper (LeadNotesDetails):
                  lo stato aperto sopravvive al refresh e al riordino della lista
                  (sessionStorage per lead) — prima si richiudeva da solo mentre
                  l'utente stava lavorando alla nota. */}
              <LeadNotesDetails leadId={lead.id} initialNotes={lead.notes} />
            </div>
          </Card>
        ))}
        {!leads.length && <GlassNotice>Nessun lead ancora: prova la chat in home.</GlassNotice>}
      </div>
    </div>
  );
}
