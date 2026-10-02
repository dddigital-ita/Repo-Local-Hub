import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import Link from "next/link";
import StatusPills from "@/components/status-pills";
import { LeadNotesDetails } from "@/components/lead-note-form";
import { LeadTemperature, LeadRowTools, CompanyNameFix } from "@/components/lead-tools";
import { GlassCard as Card, GlassLinkButton, GlassNotice } from "@/components/glass";
import { Download, Flame, CalendarClock, Sparkles, Users, Building2, User } from "lucide-react";
import {
  resolveLeadCompanySegment,
  leadCompanyWhere,
  type LeadCompanySegment,
} from "@/lib/lead-company";

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
  company: string | null;       // «azienda» / «professionista» (value leggibile dallo script chat)
  company_name: string | null;
  hot: boolean;
  status: string;
  initial_query: string | null;
  source_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  callback_slot: string | null;
  notes: string | null;
  temperature: string;
  ricontatta_il: string | null;
  created_at: string;
}

/** Etichetta del segmento per il bottone export (es. «Export CSV (Aziende)»). */
function labelOfSegment(s: LeadCompanySegment): string {
  return s === "azienda" ? "Aziende" : s === "professionista" ? "Professionisti" : "Senza tipo";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company: companyParam } = await searchParams;
  await requireAdmin();
  const pool = db();
  if (!pool) return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  // Filtro tipo cliente via querystring (?company=…), whitelist e WHERE
  // nell'helper condiviso (stesso segmento dell'export CSV: /admin/leads
  // e /api/admin/leads.csv?company=… mostrano ed esportano la stessa lista).
  const company = resolveLeadCompanySegment(companyParam);

  const { rows: countRows } = await pool.query<{
    totale: number;
    azienda: number;
    professionista: number;
    senza: number;
  }>(
    `select count(*)::int as totale,
            count(*) filter (where company = 'azienda')::int as azienda,
            count(*) filter (where company = 'professionista')::int as professionista,
            count(*) filter (where company is null or company = '')::int as senza
     from leads`,
  );
  const counts = countRows[0] ?? { totale: 0, azienda: 0, professionista: 0, senza: 0 };

  const { whereSql, params } = leadCompanyWhere(company);
  const { rows: leads } = await pool.query<LeadRow>(
    `select * from leads ${whereSql} order by created_at desc limit 200`,
    params,
  );

  // Controllo di completezza: un lead «azienda» senza nome ditta esce dal
  // segmento e dall'export incompleto (chi ricontatta non sa a CHI parlare).
  // Lavoro chiesto all'operatore: massimo 3 nomi nel banner, il resto è il
  // badge sulla singola card.
  const dittaMancante = leads
    .filter((l) => l.company === "azienda" && !l.company_name?.trim())
    .slice(0, 3);

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
        {/* L'export rispetta il segmento attivo: il CSV scaricato è la lista
            che si vede, col segmento nel filename. */}
        <GlassLinkButton
          variant="glass"
          size="sm"
          href={company === "all" ? "/api/admin/leads.csv" : `/api/admin/leads.csv?company=${company}`}
        >
          <Download className="h-4 w-4" aria-hidden /> Export CSV{company !== "all" ? ` (${labelOfSegment(company as LeadCompanySegment)})` : ""}
        </GlassLinkButton>
      </header>

      {/* Tab tipo cliente (pattern canali inbox): segmentare le ricontatte è
          il gesto quotidiano — con l'azienda si chiede il titolare, il
          professionista spesso risponde da solo. */}
      <nav aria-label="Tipo cliente" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto py-1">
        {(
          [
            { key: "all", label: "Tutti", n: counts.totale },
            { key: "azienda", label: "Aziende", n: counts.azienda, Icon: Building2 },
            { key: "professionista", label: "Professionisti", n: counts.professionista, Icon: User },
            { key: "senza", label: "Senza tipo", n: counts.senza },
          ] as const
        ).map((tab) => {
          const active = company === tab.key;
          const Icon = "Icon" in tab ? tab.Icon : undefined;
          return (
            <Link
              key={tab.key}
              href={tab.key === "all" ? "/admin/leads" : `/admin/leads?company=${tab.key}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                active
                  ? "bg-brand-600/90 text-white shadow-glass-btn"
                  : "glass-solid text-slate-600 hover:text-slate-900"
              }`}
            >
              {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
              {tab.label}
              <span className="text-xs tabular-nums opacity-75">{tab.n}</span>
            </Link>
          );
        })}
      </nav>
      {company !== "all" && (
        <GlassNotice tone="info">
          Segmento filtrato sul tipo cliente. I conteggi delle tab restano globali.
        </GlassNotice>
      )}

      {/* Onestà sul troncamento: la query ha limit 200. I conteggi delle tab
          restano GLOBALI (count(*) senza limit): se il totale supera il limite
          l'utente deve saperlo — gli stessi dati si esportano COMPLETI via CSV
          (invariante del segmento condiviso). Stessa famiglia di trasparenza
          del segmento filtrato qui sopra. */}
      {counts.totale > leads.length && (
        <GlassNotice tone="info">
          Mostrati i primi {leads.length} lead su {counts.totale} totali —
          affina la ricerca con i segmenti o scarica l&apos;export CSV completo.
        </GlassNotice>
      )}
      {dittaMancante.length > 0 && (
        <GlassNotice tone="warning">
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {dittaMancante.length === 1
                ? "1 lead azienda è senza nome ditta"
                : `${dittaMancante.length} lead azienda sono senza nome ditta`}
              {": "}
            </span>
            {dittaMancante.map((l) => (
              <strong key={l.id} className="font-semibold">{l.name}</strong>
            ))}
            <span>— integralo dal badge sulla card, così segmento ed export escono completi.</span>
          </span>
        </GlassNotice>
      )}

      <div className="grid gap-3">
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
                {lead.company && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100/90 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {lead.company === "professionista" ? (
                      <User className="h-3 w-3" aria-hidden />
                    ) : (
                      <Building2 className="h-3 w-3" aria-hidden />
                    )}
                    {lead.company === "azienda" && lead.company_name
                      ? `Azienda · ${lead.company_name}`
                      : lead.company.charAt(0).toUpperCase() + lead.company.slice(1)}
                  </span>
                )}
                {lead.company === "azienda" && !lead.company_name?.trim() && (
                  <CompanyNameFix leadId={lead.id} companyName={lead.company_name} />
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
                {lead.utm_source
                  ? ` · utm: ${lead.utm_source}/${lead.utm_medium ?? "-"}${lead.utm_campaign ? `/${lead.utm_campaign}` : ""}`
                  : ""}
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
        {!leads.length && (
          <GlassNotice>
            {company === "all" ? "Nessun lead ancora: prova la chat in home." : "Nessun lead con questo tipo cliente."}
          </GlassNotice>
        )}
      </div>
    </div>
  );
}
