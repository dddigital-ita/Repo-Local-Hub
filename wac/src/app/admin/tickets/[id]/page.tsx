import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Mail,
  Merge,
  MessageSquare,
  Phone,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import {
  getTicket,
  getQuickReplies,
  getTicketTagVocabulary,
  PRIORITY_LABEL,
  STATUS_ACTIONS,
  STATUS_LABEL,
  TICKET_PRIORITIES,
  awaitsReply,
  slaTier,
} from "@/lib/tickets";
import { getDeskContext } from "@/lib/desk-ambrosio";
import { clientTypeLabelPure } from "@/lib/clients-shared";
import {
  TicketAssignActions,
  TicketCallbackButton,
  TicketStatusActions,
} from "@/components/ticket-actions";
import { TicketTagEditor } from "@/components/ticket-tag-editor";
import {
  TicketEscalationPanel,
  TicketMergePanel,
} from "@/components/ticket-escalation-merge";
import { ReplyComposer, TicketNoteComposer } from "@/components/ticket-composers";
import TicketChat from "@/components/ticket-chat";
import TicketDeskAmbrosio from "@/components/ticket-desk-ambrosio";

export const dynamic = "force-dynamic";

/**
 * PAGINA DEL SINGOLO TICKET (livello 2 del modello Zendesk): a tutta pagina,
 * con TUTTI gli strumenti. La conversazione è il centro; gestione, composer,
 * lead e note orbitano intorno senza competere con l'inbox (che resta una
 * scheda indietro, con i filtri intact nel suo URL).
 */
interface NoteRow {
  author_email: string;
  body: string;
  created_at: string;
}

interface OperatorRow {
  id: string;
  first_name: string;
}

interface LeadRow {
  name: string;
  phone: string;
  service: string | null;
  urgency: string | null;
  budget: string | null;
  notes: string | null;
  source: string | null;
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireAdmin();
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const [quickReplies, operators, notesRows, leadRows, deskCtx, tagVocabulary] =
    await Promise.all([
      getQuickReplies(),
      pool.query<OperatorRow>("select id, first_name from operators where active order by created_at"),
      pool.query<NoteRow>(
        "select author_email, body, created_at from ticket_notes where conversation_id = $1 order by created_at",
        [id],
      ),
      pool.query<LeadRow>(
        `select l.name, l.phone, l.service, l.urgency, l.budget, l.notes, l.source
         from conversations c join leads l on l.id = c.lead_id where c.id = $1`,
        [id],
      ),
      // Contesto del pannello Ambrosio (Fase 3): filo, lead, cliente abbinato
      // e impronte AI reali. Null-safe: se il DB manca la pagina degrada sopra.
      getDeskContext(id),
      // Vocabolario canonico dei tag per la datalist dell'editor.
      getTicketTagVocabulary(),
    ]);
  const notes = notesRows.rows;
  const lead = leadRows.rows[0] ?? null;
  const waNumber = lead?.phone.replace(/\D/g, "");
  const sla = slaTier(ticket);

  return (
    <div className="space-y-4">
      {/* Torna all'inbox: i filtri della provenienza restano nell'URL dell'indice */}
      <Link
        href="/admin/tickets"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-white/60 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Torna alla inbox
      </Link>

      {/* Errore dell'invio sul canale (es. Meta rifiuta il
          business-initiated senza template): il ticket esiste,
          l'operatore legge l'errore dell'API e riprova dal
          composer. */}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 ring-1 ring-red-200/70">
          {error}
        </p>
      )}

      {/* Banner ticket FUSO (merge): il duplicato resta
          leggibile (cronologia e note intatte) ma esce da
          ogni lista; da qui si torna al ticket vivo. */}
      {ticket.merged_into && (
        <div className="glass-solid flex flex-wrap items-center gap-x-3 gap-y-1 rounded-3xl p-4 ring-1 ring-violet-200/70">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50/90 px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200/70">
            <Merge className="h-3.5 w-3.5" aria-hidden />
            Ticket fuso
          </span>
          <p className="text-xs text-slate-600">
            Questo ticket è stato unito a{" "}
            <Link
              href={`/admin/tickets/${ticket.merged_into}`}
              className="font-mono font-semibold tabular-nums text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              #{ticket.merged_into_number ?? "…"}
            </Link>{" "}
            ({new Date(ticket.merged_at ?? ticket.updated_at).toLocaleString("it-IT")}): chat e
            note restano qui, la conversazione continua lì.
          </p>
        </div>
      )}

      {/* Header del ticket: identità + permalink + azioni principali */}
      <div className="glass-solid rounded-3xl p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="font-mono text-sm font-semibold tabular-nums text-brand-700">
                #{ticket.number}
              </span>
              <h1 className="text-lg font-bold text-slate-900">
                «{ticket.initial_query || "senza query"}»
              </h1>
              {awaitsReply(ticket) && (
                <span className="pop-in inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-orange-50/90 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200/70">
                  <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
                  Attende risposta
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              da {ticket.source_page ?? "/"} · aperto il{" "}
              {new Date(ticket.created_at).toLocaleString("it-IT")} ·{" "}
              <span className="tabular-nums">{ticket.message_count} messaggi</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TicketAssignActions
              key={ticket.id}
              ticketId={ticket.id}
              initialAssigned={ticket.assigned_to ?? null}
              operators={operators.rows}
              myOperatorId={user.operatorId}
              replyTargetId={`reply-${ticket.id}`}
            />
          </div>
        </div>

        {/* Gestione: priorità, stato, callback — una riga, sempre sotto l'identità */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/60 pt-3">
          <TicketStatusActions
            key={`st-${ticket.id}`}
            ticketId={ticket.id}
            initialPriority={ticket.priority}
            initialStatus={ticket.status}
            priorities={TICKET_PRIORITIES}
            priorityLabels={PRIORITY_LABEL}
            statusActions={STATUS_ACTIONS}
          />
          <TicketCallbackButton
            key={`cb-${ticket.id}`}
            conversationId={ticket.id}
            disabled={ticket.status === "closed"}
          />
          <span aria-hidden className="hidden h-5 w-px bg-white/70 sm:block" />
          <TicketEscalationPanel
            key={`esc-${ticket.id}`}
            ticketId={ticket.id}
            initialLevel={ticket.escalation_level ?? 0}
            escalationAt={ticket.escalation_at ?? null}
            status={ticket.status}
          />
        </div>

        {/* Tag: categorizzazione libera con vocabolario
            suggerito (impostazioni → tag) — una riga
            sotto la gestione, sopra la barra contesto. */}
        <div className="mt-3 border-t border-white/60 pt-3">
          <TicketTagEditor
            key={`tg-${ticket.id}`}
            conversationId={ticket.id}
            initialTags={ticket.tags ?? []}
            vocabulary={tagVocabulary}
          />
        </div>

        {/* Barra contesto: chi scrive, da dove, che SLA ha */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/60 pt-2.5 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{ticket.lead_name ?? ticket.contact_email ?? "Anonimo"}</span>
          {ticket.contact_email && (
            <a
              href={`mailto:${ticket.contact_email}`}
              className="inline-flex items-center gap-1 text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <Mail className="h-3 w-3" aria-hidden />
              {ticket.contact_email}
            </a>
          )}
          {ticket.lead_phone && (
            <a
              href={`tel:${ticket.lead_phone}`}
              className="text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {ticket.lead_phone}
            </a>
          )}
          <span aria-hidden className="text-slate-300">|</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70">
            {ticket.channel === "email" ? "via email" : ticket.channel === "whatsapp" ? "via WhatsApp" : "via chat"}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sla.tone}`}
          >
            SLA: {sla.label}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px_320px] xl:items-start">
        {/* Conversazione: il centro della pagina, con composer sempre raggiungibile */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Conversazione</h2>
              <p className="text-xs text-slate-500">Aggiornamento automatico ogni 4s.</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
              Live
            </span>
          </div>
          <TicketChat conversationId={ticket.id} />
          <div className="rounded-3xl bg-white/45 p-3 ring-1 ring-white/70 sm:p-4">
            <ReplyComposer
              key={`rc-${ticket.id}`}
              conversationId={ticket.id}
              quickReplies={quickReplies}
            />
          </div>
        </div>

        {/* Colonna STRUMENTI: lead + note interne, sticky su xl */}
        <div className="space-y-4 xl:sticky xl:top-28">
          <div className="glass-solid rounded-3xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Lead</h3>
            {lead ? (
              <div className="mt-2.5 space-y-2 text-sm">
                <p className="font-semibold text-slate-900">
                  {lead.name}
                  {lead.source === "ai" && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50/90 px-2 py-0.5 align-middle text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200/70">
                      <Sparkles className="h-3 w-3" aria-hidden />
                      da Ambrosio
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`tel:${lead.phone}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/60 px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-white/50 transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    {lead.phone}
                  </a>
                  {waNumber && (
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-50/80 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden />
                      WhatsApp
                    </a>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  {[lead.service, lead.urgency, lead.budget].filter(Boolean).join(" · ") || "—"}
                </p>
                {lead.notes && (
                  <p className="rounded-xl bg-amber-50/80 p-2 text-xs text-amber-900 ring-1 ring-amber-200/60">
                    {lead.notes}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Visitatore anonimo (qualificazione incompleta).</p>
            )}
          </div>

          <div className="glass-solid rounded-3xl p-4">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              Note interne
            </h3>
            <div className="scroll-thin mt-2.5 max-h-52 space-y-2 overflow-y-auto">
              {notes.map((n, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-3 py-2 text-xs ${
                    n.author_email === "system"
                      ? "bg-slate-100/70 italic text-slate-600"
                      : "bg-white/70 text-slate-700 ring-1 ring-white/50"
                  }`}
                >
                  <p>{n.body}</p>
                  {/* Autore PRIMA e in evidenza (revisione UX §2.4): in team
                      affollato «chi l'ha scritta» pesa più di «quando» — la
                      caption resta piccola, il nome no. */}
                  <p className="mt-1 text-[10px] text-slate-400">
                    <span className={`font-semibold ${n.author_email === "system" ? "" : "text-slate-500"}`}>
                      {n.author_email === "system" ? "audit" : n.author_email}
                    </span>{" "}
                    · {new Date(n.created_at).toLocaleString("it-IT", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))}
              {!notes.length && <p className="text-xs text-slate-500">Nessuna nota.</p>}
            </div>
            <TicketNoteComposer key={`nc-${ticket.id}`} conversationId={ticket.id} />
          </div>

          {/* Merge duplicati (migration 046): fonde il
              secondo ticket aperto per lo stesso identico
              problema nel primo. Solo su ticket VIVI: un
              ticket già fuso mostra il banner in alto. */}
          <div className="glass-solid rounded-3xl p-4">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <Merge className="h-3.5 w-3.5" aria-hidden />
              Merge duplicati
            </h3>
            <div className="mt-2.5">
              <TicketMergePanel
                key={`mg-${ticket.id}`}
                ticketId={ticket.id}
                ticketNumber={ticket.number}
                statusLabels={STATUS_LABEL}
                priorityLabels={PRIORITY_LABEL}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
            <CalendarClock className="h-3 w-3" aria-hidden />
            Collaborazione aperta: chi risponde per primo ferma lo SLA e prende il ticket.
          </div>
        </div>

        {/* Colonna CONTESTO (Fase 3): Ambrosio AI + scheda cliente abbinata.
            Sticky come gli strumenti; su mobile scendono sotto, ordine di
            lettura naturale (conversazione → strumenti → contesto). */}
        <div className="space-y-4 xl:sticky xl:top-28">
          <TicketDeskAmbrosio
            ticketId={ticket.id}
            takeover={deskCtx?.ambrosio.takeover ?? false}
            followup={deskCtx?.ambrosio.followup ?? false}
            followupDisabled={deskCtx?.ambrosio.followupDisabled ?? false}
          />

          {/* CRM: la scheda cliente abbinata dal sync portafoglio — il
              contesto commerciale del filo (chi è, quanto vale, che storia)
              a un gesto dal ticket. */}
          <div className="glass-solid rounded-3xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Cliente</h3>
            {deskCtx?.client ? (
              <div className="mt-2.5 space-y-2 text-sm">
                <Link
                  href={`/admin/clients/${deskCtx.client.id}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-slate-900 transition hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  {deskCtx.client.name}
                  {deskCtx.client.company_name && (
                    <span className="font-normal text-slate-500">· {deskCtx.client.company_name}</span>
                  )}
                </Link>
                <p className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70">
                    {clientTypeLabelPure(deskCtx.client.client_type)}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-white/70">
                    {deskCtx.client.ticket_count} ticket
                  </span>
                  {deskCtx.client.budget_total != null && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                      ~{Math.round(deskCtx.client.budget_total).toLocaleString("it-IT")} € dichiarati
                    </span>
                  )}
                </p>
                {deskCtx.client.notes && (
                  <p className="rounded-xl bg-amber-50/80 p-2 text-xs text-amber-900 ring-1 ring-amber-200/60">{deskCtx.client.notes}</p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Nessuna scheda abbinata: il sync di Ambrosio la crea quando riconcilia questo ticket (o{" "}
                <Link href="/admin/clients" className="font-medium text-brand-700 hover:underline">
                  guarda il portafoglio
                </Link>
                ).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
