import Link from "next/link";
import { ArrowLeft, Mail, Send } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { TICKET_PRIORITIES, PRIORITY_LABEL } from "@/lib/tickets";
import { createTicketAction, ambrosioDraftAction } from "@/app/admin/actions";
import { getAiFaqs } from "@/lib/ai";
import WpEditor from "@/components/wp-editor";

export const dynamic = "force-dynamic";

/**
 * NUOVO TICKET (modello CRM): l'agente apre il caso e la prima
 * risposta parte dal canale scelto — email (SMTP, oggetto
 * «[#N] …»), WhatsApp (Graph API) o Telegram (Bot API). Il
 * cliente risponde nel suo canale: la risposta torna nel
 * ticket (polling IMAP / webhook social). Meta (Instagram,
 * Messenger, Facebook) e LinkedIn sono nel selettore ma
 * disabilitati: outbound social in arrivo (Fase 5).
 */
export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireAdmin();
  const { error } = await searchParams;
  // Le FAQ ufficiali diventano frasi preimpostate: click → la risposta
  // entra nell'editor come punto di partenza. Solo le attive, priorità alta prima.
  const faqs = (await getAiFaqs()).filter((f) => f.active).slice(0, 6);

  const inputClass =
    "w-full rounded-xl border border-white/50 bg-white/70 px-3.5 py-2.5 text-sm text-slate-900 outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

  void user; // le azioni server rieseguono requireAdmin: qui serve solo il gate

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/admin/tickets"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Torna alla inbox
      </Link>

      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-200/70">
          <Mail className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Nuovo ticket</h1>
          <p className="text-xs text-slate-500">
            Il caso nasce qui: scegli il canale e la prima risposta parte da lì — email con oggetto «[#N]», WhatsApp o Telegram. Ogni risposta del cliente torna nel ticket.
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 ring-1 ring-red-200/70">
          {error}
        </p>
      )}

      <form action={createTicketAction} className="glass-solid space-y-4 rounded-2xl p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="channel" className="text-xs font-semibold text-slate-700">
              Canale
            </label>
            <select id="channel" name="channel" defaultValue="email" className={inputClass}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option disabled>Instagram — in arrivo</option>
              <option disabled>Messenger — in arrivo</option>
              <option disabled>Facebook — in arrivo</option>
              <option disabled>LinkedIn — in arrivo</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="contact" className="text-xs font-semibold text-slate-700">
              Contatto del cliente <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="contact"
              name="contact"
              required
              autoComplete="off"
              placeholder="cliente@azienda.it · +39… · @username"
              className={inputClass}
            />
            <p className="text-[11px] leading-snug text-slate-500">
              Email: indirizzo · WhatsApp: numero internazionale · Telegram: chat id o @username.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="priority" className="text-xs font-semibold text-slate-700">
              Priorità
            </label>
            <select id="priority" name="priority" defaultValue="normale" className={inputClass}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p] ?? p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] leading-snug text-amber-800 ring-1 ring-amber-200/70">
          WhatsApp: il primo messaggio è <strong>business-initiated</strong> — Meta può rifiutarlo
          senza un template approvato (soprattutto fuori dalla finestra di 24 ore dall&apos;ultimo
          messaggio del cliente). L&apos;eventuale errore dell&apos;API torna qui, sul ticket.
        </p>

        <div className="space-y-1.5">
          <label htmlFor="subject" className="text-xs font-semibold text-slate-700">
            Oggetto <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="subject"
            name="subject"
            required
            maxLength={200}
            placeholder="Preventivo sito e-commerce"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          {/* Blocco di testo formattabile in stile WordPress (toolbar + tab
              Visuale/Testo): produce anche l'HTML che arriva formattato
              nella casella del cliente (multipart text+html lato server).
              Ambrosio scrive la bozza (FAQ + pacchetti) e le FAQ ufficiali
              sono frasi preimpostate: tutto entra nell'editor, mai in cielo. */}
          <WpEditor
            name="bodyHtml"
            label="Prima risposta"
            required
            placeholder="Buongiorno, in allegato le informazioni richieste…"
            ambrosioDraft={ambrosioDraftAction}
            quickFaqs={faqs.map((f) => ({ question: f.question, answer: f.answer }))}
            subjectInputId="subject"
          />
          <p className="text-[11px] text-slate-500">
            Firmata automaticamente con il tuo nome (email). Su WhatsApp e Telegram il testo arriva in chiaro, senza firma.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link
            href="/admin/tickets"
            className="inline-flex min-h-11 items-center rounded-full px-4 py-2 text-xs font-semibold text-slate-600 transition hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Annulla
          </Link>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600/90 px-5 py-2.5 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            Crea ticket e invia
          </button>
        </div>
      </form>
    </div>
  );
}
