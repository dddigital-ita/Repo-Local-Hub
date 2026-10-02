import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  StickyNote,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getClient, channelLabel } from "@/lib/clients";
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/tickets";
import { saveClientNotesAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

/**
 * SCHEDA CLIENTE (livello 2 del portafoglio, come /admin/tickets/[id] per
 * la inbox): tutta la verità sul cliente — identità ricostruita dai canali,
 * azioni collegate (chiama, WhatsApp, email), nota libera e la lista dei
 * SUOI ticket su ogni canale. I ticket restano la fonte di verità: da qui
 * si aprono, non si modificano.
 */

const AWAITING_TONE =
  "bg-orange-50/90 text-orange-700 ring-1 ring-orange-200/70";

/** Testo precompilato del WhatsApp contestuale: cita il ticket, il contesto
 *  esiste già dal primo «ciao» — il cliente non deve spiegare chi è. */
function waTicketHref(waDigits: string, ticketNumber: number): string {
  const text = encodeURIComponent(
    `Buongiorno, la scrivo per il ticket #${ticketNumber} della Web Agency Crema.`,
  );
  return `https://wa.me/${waDigits}?text=${text}`;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const client = await getClient(id);
  if (!client) notFound();

  const email = client.contact_email ?? client.email_norm;
  const waDigits = client.phone_e164?.replace(/\D/g, "");

  return (
    <div className="space-y-4">
      <Link
        href="/admin/clients"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Torna ai clienti
      </Link>

      {/* Identità + azioni: stesso guscio glass dell'header ticket. */}
      <div className="glass-solid rounded-3xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold text-slate-900">
              {client.name}
              {client.company_name && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-50/90 px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200/70">
                  <Building2 className="h-3.5 w-3.5" aria-hidden />
                  {client.company_name}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Cliente dal{" "}
              {new Date(client.first_seen_at).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}{" "}
              · scheda composta da Ambrosio dai ticket su{" "}
              {(client.channels ?? []).length > 0
                ? (client.channels ?? []).map((ch) => channelLabel(ch)).join(", ").toLowerCase()
                : "—"}
              {client.budget_total != null && (
                <strong className="ml-1.5 font-semibold text-emerald-700">
                  · ~{client.budget_total.toLocaleString("it-IT")} € dichiarati
                </strong>
              )}
            </p>
          </div>

          {/* Azioni collegate ai canali: telefono, WhatsApp, email. */}
          <div className="flex flex-wrap items-center gap-2">
            {client.phone_e164 && (
              <a
                href={`tel:${client.phone_e164}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/60 px-4 py-2 text-sm font-medium text-brand-700 ring-1 ring-white/50 transition hover:bg-white/90"
              >
                <Phone className="h-4 w-4" aria-hidden />
                {client.phone_e164}
              </a>
            )}
            {waDigits && (
              <a
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-50/80 px-4 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                WhatsApp
              </a>
            )}
            {email && (
              <a
                href={`mailto:${email}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-50/80 px-4 py-2 text-sm font-medium text-sky-700 ring-1 ring-sky-200/60 transition hover:bg-sky-100/80"
              >
                <Mail className="h-4 w-4" aria-hidden />
                Email
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        {/* Ticket del cliente: i casi, su tutti i canali. */}
        <div className="min-w-0 space-y-3">
          <h2 className="text-sm font-bold text-slate-900">
            Ticket ({client.tickets.length})
          </h2>
          <div className="grid gap-3">
            {client.tickets.map((t) => {
              const waiting = t.last_sender === "visitor" && t.status !== "closed" && t.status !== "on_hold" && t.status !== "bot";
              const ticketWaDigits = t.wa_phone?.replace(/\D/g, "");
              return (
                <div
                  key={t.id}
                  className="group/ticket glass-solid block rounded-2xl p-4 transition hover:bg-white/60"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/admin/tickets/${t.id}`}
                      className="font-mono text-sm font-semibold tabular-nums text-brand-700 hover:underline"
                    >
                      #{t.number}
                    </Link>
                    <Link
                      href={`/admin/tickets/${t.id}`}
                      className="line-clamp-1 min-w-0 flex-1 text-sm font-semibold text-slate-900 hover:text-brand-700"
                    >
                      «{t.initial_query || "senza oggetto"}»
                    </Link>
                    {ticketWaDigits && (
                      <a
                        href={waTicketHref(ticketWaDigits, t.number)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`WhatsApp per il ticket #${t.number}`}
                        className="inline-flex min-h-9 items-center gap-1 rounded-full bg-emerald-50/80 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80"
                      >
                        <MessageCircle className="h-3 w-3" aria-hidden />
                        WhatsApp
                      </a>
                    )}
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover/ticket:text-brand-600" aria-hidden />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {t.channel === "email" ? (
                        <Mail className="h-3 w-3" aria-hidden />
                      ) : (
                        <MessageSquare className="h-3 w-3" aria-hidden />
                      )}
                      {channelLabel(t.channel)}
                    </span>
                    <span aria-hidden className="text-slate-300">·</span>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[t.status] ?? "bg-slate-100/80 text-slate-600 ring-1 ring-slate-200/70"}`}
                    >
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                    <span
                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${PRIORITY_TONE[t.priority] ?? ""}`}
                    >
                      {PRIORITY_LABEL[t.priority] ?? t.priority}
                    </span>
                    {waiting && (
                      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-semibold ${AWAITING_TONE}`}>
                        Attende risposta
                      </span>
                    )}
                    <span aria-hidden className="text-slate-300">·</span>
                    <span className="whitespace-nowrap">
                      {new Date(t.updated_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            })}
            {client.tickets.length === 0 && (
              <p className="rounded-2xl bg-white/50 px-4 py-3 text-sm text-slate-500">
                Nessun ticket collegato: la scheda è rimasta senza casi (può accadere se il ticket
                è stato archiviato come spam).
              </p>
            )}
          </div>
        </div>

        {/* Colonna strumenti: nota + ultimi messaggi (contesto rapido). */}
        <div className="space-y-4 xl:sticky xl:top-28">
          <div className="glass-solid rounded-3xl p-4">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              Nota
            </h3>
            <form action={saveClientNotesAction} className="mt-2.5 space-y-2">
              <input type="hidden" name="id" value={client.id} />
              <textarea
                name="notes"
                rows={5}
                maxLength={2000}
                defaultValue={client.notes ?? ""}
                placeholder="Storico, preferenze, accordi…"
                className="w-full rounded-2xl border border-white/50 bg-white/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 backdrop-blur-xl outline-none transition focus:border-brand-400/70 focus:bg-white/80"
              />
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-brand-600/90 px-4 py-2 text-sm font-semibold text-white shadow-glass-btn transition hover:bg-brand-700"
              >
                Salva nota
              </button>
            </form>
          </div>

          <div className="glass-solid rounded-3xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Ultimi messaggi
            </h3>
            <div className="mt-2.5 space-y-2.5">
              {client.messages.map((m, i) => (
                <div key={`${m.conversation_id}-${i}`} className="rounded-xl bg-white/55 p-2.5 text-xs text-slate-700 ring-1 ring-white/50">
                  <p className="line-clamp-3">{m.body}</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    {m.sender === "visitor" ? "cliente" : m.sender === "operator" ? "agente" : m.sender} ·{" "}
                    {new Date(m.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                  </p>
                </div>
              ))}
              {client.messages.length === 0 && (
                <p className="text-xs text-slate-500">Nessun messaggio nei ticket collegati.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
