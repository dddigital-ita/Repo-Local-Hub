import Link from "next/link";
import { BellOff, MessageCircle, Sparkles, Users } from "lucide-react";
import type { MessageSquare, Mail } from "lucide-react";
import type { TicketRow } from "@/lib/tickets";
import {
  slaTier,
  awaitsReply,
  relativeAge,
  STATUS_TONE,
  STATUS_LABEL,
  PRIORITY_TONE,
  PRIORITY_LABEL,
} from "@/lib/tickets";
import TicketCardActions from "@/components/ticket-card-actions";
import { TicketBulkToggle } from "@/components/ticket-bulk-bar";
import { takeoverChip, followupEsclusoBadge, FOLLOWUP_ESCLUSO_TITLE } from "@/lib/takeover-shared";

/**
 * RIGA DELLA CODA TICKET — portata dal gemello (refactoring della inbox,
 * assessment docs/tickets-redesign-assessment.md): markup IDENTICO alla
 * riga inline che aveva qui, in una componente riusabile. Riuso previsto
 * da /admin/clients/[id] (i ticket del cliente usano la STESSA riga).
 *
 * Server component di proposito: la riga non ha stato; le uniche
 * interazioni (azioni di triage) sono già client component propri
 * (TicketCardActions) e la selezione bulk parla alla barra via evento
 * window (pattern admin-toaster), senza prop drilling attraverso l'RSC.
 *
 * Divergenze del gemello PRESERVATE (non sono drift, sono dettagli suoi):
 *  - la BARRA SLA sul bordo sinistro della card (Fase 2: l urgenza è il
 *    perimetro, non una pill in più);
 *  - la CHIP IDENTITÀ CRM (client_id/client_name del sync portafoglio):
 *    link diretto alla scheda cliente dalla riga.
 */
export default function TicketQueueRow({
  ticket,
  userOperatorId,
  channel,
  showBucketHeader = false,
  bucketLabel,
  whatsappLink,
  whatsappStyle,
  bulkSelect = false,
  ambrosio,
  crm,
}: {
  ticket: TicketRow;
  /** operatorId dell admin loggato (per «Miei»: abilita Rilascia/Prendi). */
  userOperatorId: string | null;
  /** Icona + etichetta canale (channelMeta della pagina: mapping con icone,
   *  quindi resta nella vista, non nel dominio). */
  channel: { Icon: typeof MessageSquare | typeof Mail; label: string };
  /** Il bucket (OGGI/ieri/…) va mostrato su QUESTA riga (prima occorrenza). */
  showBucketHeader?: boolean;
  bucketLabel?: string;
  /** Link WhatsApp contestuale: wa.me col telefono DEL ticket (lead
   *  wa_phone). Scheda cliente: pill etichettata. Inbox: SOLO icona in
   *  colonna azioni (variante C del assessment) — la pill affollerebbe
   *  la riga stato. Se manca (niente wa_phone), nessun bottone. */
  whatsappLink?: { href: string; label: string };
  /** Come mostra il bottone (default "pill", il rendering della scheda
   *  cliente originario): la inbox passa "icon". */
  whatsappStyle?: "pill" | "icon";
  /** Colonna checkbox per le azioni bulk (solo inbox): colloquia con la
   *  barra via evento window. La scheda cliente (che riusa questa riga)
   *  non la passa: lì il bulk non ha senso. */
  bulkSelect?: boolean;
  /** Impronte AI (stessa forma della prop ambrosio): vedi sotto. */
  ambrosio?: { takeover: boolean; followup: boolean; manuale: boolean; followupDisabled: boolean };
  /** Identità CRM dal sync portafoglio (divergenza del gemello): chip
   *  link alla scheda cliente. La inbox la passa, la scheda no. */
  crm?: { clientId: string; clientName: string } | null;
}) {
  const tk = ticket;
  const sla = slaTier(tk);
  const open = tk.status !== "closed";
  const waiting = awaitsReply(tk);
  const late = open && (sla.label === "in ritardo" || sla.label === "scaduto");
  const { Icon: ChannelIcon, label: channelLabel } = channel;
  const waStyle = whatsappStyle ?? "pill";

  return (
    <div>
      {showBucketHeader && (
        <p className="mb-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {bucketLabel}
        </p>
      )}
      <div
        className={`group/ticket relative block overflow-hidden rounded-2xl border transition ${
          waiting
            ? "glass-solid ticket-waiting hover:border-brand-300 hover:bg-white/70"
            : "glass-solid border-white/40 hover:border-slate-300/80 hover:bg-white/60"
        }`}
      >
        {/* BARRA SLA SUL BORDO (divergenza del gemello, Fase 2): lo stato
            dell urgenza è il PERIMETRO della card, non una pill tra le
            altre — rosso = rotto, ambra = sta per rompersi, brand = palla
            nostra da rispondere, niente barra = tutto tranquillo. */}
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1 ${
            late ? "bg-red-500/90" : sla.label === "scade presto" ? "bg-amber-400/90" : waiting ? "bg-brand-500/80" : ""
          }`}
        />
        {/* CARD = div; il LINK è il titolo (gesto primario APRIRE).
            Prima la card intera era <Link> e le azioni di triage
            stavano DENTRO: interattivi annidati in interattivo
            (violazione ARIA, miss-click su touch — verificato in
            vivo: il click sul menu ⋯ apriva il ticket). Ora le azioni
            vivono nella colonna destra, fuori dal link. */}
        <div
          className={`grid items-start gap-x-3 p-3 ${
            bulkSelect
              ? // Colonna checkbox bulk (28px) PRIMA del numero — parità col gemello.
                "grid-cols-[28px_44px_minmax(0,1fr)_auto] sm:grid-cols-[28px_56px_minmax(0,1fr)_auto_auto]"
              : "grid-cols-[44px_minmax(0,1fr)_auto] sm:grid-cols-[56px_minmax(0,1fr)_auto_auto]"
          }`}
        >
          {/* Checkbox bulk (solo inbox): segnala la selezione alla barra
              fissa via evento window (pattern admin-toaster). */}
          {bulkSelect && <TicketBulkToggle id={tk.id} />}
          {/* Numero: colonna stabile, scansionabile in verticale */}
          <span className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-brand-700">
            #{tk.number}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* Il LINK è il titolo: il gesto primario (APRIRE) è
                  il titolo stesso, come nelle liste mail — non serve
                  la card intera cliccabile se ogni card ha azioni
                  proprie. */}
              <Link
                href={`/admin/tickets/${tk.id}`}
                className="line-clamp-1 text-sm font-semibold text-slate-900 transition hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                «{tk.initial_query || "senza query"}»
              </Link>
              {/* RIGA DI STATO UNICA: chi l ha in mano, come sta lo
                  SLA (solo se dice qualcosa), quanto urga. «Attende
                  risposta» NON è qui: esiste come bordo arancio della
                  card e come filtro «Da rispondere» — due posti bastano,
                  una terza copia era rumore. Prima: 4 pill in angoli
                  diversi (stato qui, SLA qui, stato+priorità nella
                  colonna destra) — nessuno con un senso proprio. */}
              <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[tk.status] ?? ""}`}>
                {STATUS_LABEL[tk.status] ?? tk.status}
              </span>
              {open && tk.status !== "on_hold" && sla.label !== "entro SLA" && sla.label !== "palla dal cliente" && (
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${sla.tone}`}>
                  {late && <span aria-hidden className="sla-late-dot" />}
                  {sla.label}
                </span>
              )}
              {tk.priority !== "normale" && (
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[tk.priority] ?? ""}`}>
                  {PRIORITY_LABEL[tk.priority] ?? tk.priority}
                </span>
              )}
              {/* CHIP AMBROSIO (parità col gemello): «a mano» = take-over
                  attivato dall operatore (audit autopilota_*, 041), «SLA» =
                  subentrato il cron, senza titolo = solo follow-up. Violet
                  solo se c è la mano dell operatore. Accanto, il badge
                  BellOff del follow-up escluso: parla del FUTURO (nessun
                  follow-up a venire), la chip del presente. */}
              {ambrosio && (() => {
                const chip = takeoverChip({ takeover: ambrosio.takeover, followup: ambrosio.followup, manuale: ambrosio.manuale });
                const escluso = followupEsclusoBadge({ followupDisabled: ambrosio.followupDisabled });
                if (!chip && !escluso) return null;
                const manual = chip?.label.includes("a mano") ?? false;
                return (
                  <span className="inline-flex items-center gap-1">
                    {chip && (
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${manual ? "bg-violet-100 text-violet-900 ring-violet-300" : "bg-violet-50 text-violet-700 ring-violet-200/70"}`}
                        title={chip.title}
                      >
                        <Sparkles className="h-3 w-3" aria-hidden />
                        {chip.label}
                      </span>
                    )}
                    {escluso && (
                      <span
                        aria-label="Follow-up automatico escluso"
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 ring-1 ring-slate-200/80"
                        title={FOLLOWUP_ESCLUSO_TITLE}
                      >
                        <BellOff className="h-3 w-3" aria-hidden />
                      </span>
                    )}
                  </span>
                );
              })()}
              {/* CHIP IDENTITÀ CRM (divergenza del gemello): il sync
                  portafoglio abbinato alla conversazione diventa link
                  diretto alla scheda — il contesto CRM è a un gesto. */}
              {crm && (
                <Link
                  href={`/admin/clients/${crm.clientId}`}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200/70 transition hover:bg-emerald-100"
                  title="Scheda cliente nel portafoglio (abbinata dal sync di Ambrosio)"
                >
                  <Users className="h-3 w-3" aria-hidden />
                  {crm.clientName}
                </Link>
              )}
              {whatsappLink && waStyle === "pill" && (
                <a
                  href={whatsappLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={whatsappLink.label}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full bg-emerald-50/80 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80"
                >
                  <MessageCircle className="h-3 w-3" aria-hidden />
                  WhatsApp
                </a>
              )}
            </div>
            {/* Ogni voce è un unità nowrap: la riga va a capo TRA le
                voci, mai dentro («8 / msg»). I separatori «·» sono
                stati TOLTI: a capo partivano con il punto orfano
                («· 28 set, 05:45» da solo) — il gap larga (10px)
                separa le voci senza rompersi al wrap. */}
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500">
              <span className={`inline-flex items-center gap-1 whitespace-nowrap ${tk.channel === "email" ? "font-medium text-brand-700" : ""}`}>
                <ChannelIcon className="h-3 w-3" aria-hidden />
                {channelLabel}
              </span>
              {/* Il contatto del richiedente: su email è l indirizzo
                  (a colpo d occhio sai A CHI risponderai), su chat
                  il nome del lead o il telefono. */}
              <span className="inline-flex min-w-0 items-center whitespace-nowrap">
                {tk.channel === "email" && tk.contact_email ? (
                  <span className="truncate font-medium text-slate-600" title={tk.contact_email}>{tk.contact_email}</span>
                ) : (
                  <span>{tk.lead_name ?? tk.lead_phone ?? "Anonimo"}</span>
                )}
              </span>
              {tk.channel === "email" && tk.lead_name && (
                <span className="inline-flex items-center whitespace-nowrap">
                  <span>{tk.lead_name}</span>
                </span>
              )}
              <span className="inline-flex items-center whitespace-nowrap">
                <span className="tabular-nums">{tk.message_count} msg</span>
              </span>
              {/* Età relativa («3gg») accanto alla data assoluta: la forma
                  breve dice quanto è vecchio, quella lunga (title) quando è
                  successo — la stessa informazione dell ordinamento, leggibile
                  senza aprire il ticket (Fase 2 del assessment). */}
              <span
                className="inline-flex items-center whitespace-nowrap tabular-nums text-slate-400"
                title={`Ultimo aggiornamento: ${new Date(tk.updated_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
              >
                {relativeAge(tk.updated_at)}
              </span>
              <span className="inline-flex items-center whitespace-nowrap">
                <span>{new Date(tk.updated_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </span>
              {tk.assigned_name && (
                <span className="inline-flex items-center whitespace-nowrap">
                  <span className="font-medium text-slate-600">{tk.assigned_name}</span>
                </span>
              )}
            </p>
            {tk.last_message_body && (
              <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-slate-600">
                {tk.last_sender === "visitor" ? "Cliente: " : "Team: "}{tk.last_message_body}
              </p>
            )}
            {/* Azioni di triage (mobile): nel corpo, sotto la preview —
                su desktop la stessa componente sta nella colonna destra.
                L icona WhatsApp vive qui su mobile e nella colonna destra su
                desktop: SPOSTATA per viewport, non replicata a schermo (i
                due blocchi sono entrambi nel DOM, ma sm:hidden/hidden sm:flex
                ne rendono visibile UNO per viewport — i test asseriscono
                sulla visibilità, non sulla sola presenza nel DOM). */}
            <div className="mt-2 flex items-center gap-2 sm:hidden">
              {whatsappLink && waStyle === "icon" && (
                <a
                  href={whatsappLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={whatsappLink.label}
                  title={whatsappLink.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-200/60 transition active:bg-emerald-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden />
                </a>
              )}
              <TicketCardActions
                ticketId={tk.id}
                open={open}
                waitingReply={waiting}
                mine={!!userOperatorId && tk.assigned_to === userOperatorId}
              />
            </div>
          </div>

          {/* Zona azioni (desktop): la colonna destra È delle azioni —
              primary visibile + WhatsApp (se il lead lo porta) + menu ⋯.
              FUORI dal link del titolo: nessun interattivo annidato. */}
          <div className="hidden sm:flex items-center gap-1.5">
            {whatsappLink && waStyle === "icon" && (
              <a
                href={whatsappLink.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={whatsappLink.label}
                title={whatsappLink.label}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
              </a>
            )}
            <TicketCardActions
              ticketId={tk.id}
              open={open}
              waitingReply={waiting}
              mine={!!userOperatorId && tk.assigned_to === userOperatorId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
