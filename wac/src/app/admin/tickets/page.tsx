import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Inbox, Mail, MessageSquare, Plus, RefreshCw } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import {
  countTickets,
  countTicketsByChannel,
  listTickets,
  listArchivedTickets,
  FILTERS,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  awaitsReply,
  slaTier,
  type TicketFilter,
} from "@/lib/tickets";
import ArchivedTicketsBanner from "@/components/archived-tickets-banner";
import TicketCardActions from "@/components/ticket-card-actions";
import TicketSearch from "@/components/ticket-search";
import { GlassButton, GlassLinkButton, GlassNotice } from "@/components/glass";
import { syncEmailIngestAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

/**
 * INBOX DI TRIAGE (livello 1 del modello Zendesk): una pagina con le code
 * divise per canale, fatta per SCANDIRE e DECIDERE. Qui non si risponde:
 * ogni card apre la pagina completa del ticket (/admin/tickets/[id]) dove
 * vivono conversazione e strumenti. Separare i due livelli restituisce la
 * cognizione del ticket: la inbox resta stabile mentre il dettaglio lavora.
 */

/** Paginazione a Precedenti/Successivi: con code da decine (non migliaia) di
 * ticket è tutto ciò che serve — niente numeri di pagina che spostano il
 * focus, niente query di conteggio. La pagina vive nell'URL (?page=), la
 * pagina 1 non compare mai: i link condivisi restano puliti. */
const PAGE_SIZE = 60;

/* Raggruppamento per data sui dati già caricati (nessuna query nuova). */
function dateBucket(iso: string): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ts = new Date(iso).getTime();
  if (ts >= startOfToday) return "Oggi";
  if (ts >= startOfToday - 86_400_000) return "Ieri";
  if (ts >= startOfToday - 6 * 86_400_000) return "Questa settimana";
  return "Prima";
}

/* Etichette e icone dei canali: data-driven, un canale nuovo della
   migration compare da solo (la query è GROUP BY channel). */
const CHANNEL_META: Record<string, { label: string; Icon: typeof MessageSquare | typeof Mail }> = {
  web: { label: "Chat web", Icon: MessageSquare },
  email: { label: "Email", Icon: Mail },
  whatsapp: { label: "WhatsApp", Icon: MessageSquare },
};
function channelMeta(ch: string | null) {
  return CHANNEL_META[ch ?? "web"] ?? { label: ch ?? "web", Icon: CHANNEL_ICON_FALLBACK };
}

const CHANNEL_ICON_FALLBACK = MessageSquare;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; t?: string; q?: string; channel?: string; page?: string; sync?: string }>;
}) {
  const { f, t, q, channel: channelParam, page: pageParam, sync } = await searchParams;

  // Legacy: i vecchi link /admin/tickets?t=… ora puntano alla pagina dedicata.
  if (t) redirect(`/admin/tickets/${t}`);

  const user = await requireAdmin();
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const filter: TicketFilter = (FILTERS.find((x) => x.key === f)?.key ?? "aperti") as TicketFilter;
  // Canale: solo valori presenti nel DB (validati contro i conteggi, non interpolati dal client).
  const channelCounts = await countTicketsByChannel();
  const channel = channelParam && channelParam in channelCounts ? channelParam : "all";

  const page = Math.max(1, Math.min(500, Number.parseInt(pageParam ?? "1", 10) || 1));
  // limit+1: la riga in più dice se esiste la pagina successiva senza una
  // seconda query (che dovrebbe ripetere filtro+canale+ricerca per essere veritiera).
  const [ticketRows, counts, archived] = await Promise.all([
    listTickets(filter, user.operatorId, PAGE_SIZE + 1, q, channel === "all" ? null : channel, page, PAGE_SIZE),
    countTickets(user.operatorId),
    listArchivedTickets(8),
  ]);
  const hasNext = ticketRows.length > PAGE_SIZE;
  const tickets = ticketRows.slice(0, PAGE_SIZE);

  const qs = (over: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    // La pagina CORRENTE attraversa i link solo se ≠ 1; cambiare filtro o
    // canale la AZZERA (le tab passano page: undefined dopo il merge) —
    // finire in pagina 3 di un filtro appena scelto sarebbe un cortocircuito.
    const merged = { f: filter, channel, q, page: page > 1 ? String(page) : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") sp.set(k, v);
    const s = sp.toString();
    return `/admin/tickets${s ? `?${s}` : ""}`;
  };

  // I canali ordinati per volume, «tutti» sempre primo. Email e WhatsApp
  // sono SEMPRE in elenco (anche a 0): l'agente deve vedere che il canale
  // esiste e come si attiva — le tab a canale solo-attivo nascondevano metà
  // del sistema (sinonimo di bug: «Chat web17» senza tab Email accanto).
  const KNOWN_CHANNELS = ["web", "email", "whatsapp"] as const;
  const allCount = Object.values(channelCounts).reduce((a, b) => a + b, 0);
  const channels = [
    { key: "all", label: "Tutti i canali", n: allCount },
    ...KNOWN_CHANNELS.map((key) => ({ key, label: channelMeta(key).label, n: channelCounts[key] ?? 0 })),
    ...Object.entries(channelCounts)
      .filter(([key]) => !(KNOWN_CHANNELS as readonly string[]).includes(key))
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => ({ key, label: channelMeta(key).label, n })),
  ];
  // Il canale email offre anche il «come un CRM»: nuovo ticket che parte via email.
  const emailChannel = channels.find((c) => c.key === "email");
  const emailCount = emailChannel?.n ?? 0;

  return (
    <div className="space-y-4">
      {/* Header di pagina (pattern Panoramica/Tools): h1 text-2xl + icona +
          sottotitolo. UN solo numero qui: l'azione dovuta. I totali della
          coda stanno SOLO nelle tab che li producono — ripetere «18 aperti»
          e «21» in quattro posti generava il sospetto di aver perso ticket. */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Inbox className="h-6 w-6 text-brand-600" aria-hidden />
            Inbox ticket
            {/* Semantica (azione dovuta): pill dedicata — il colore di .glass-badge
                batte le utility a pari specificità, le semantiche non passano da lì. */}
            {counts.awaitingReply > 0 && (
              <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200/70">
                {counts.awaitingReply} da rispondere
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Scegli un ticket: si apre la pagina completa con conversazione e strumenti di triage.
            {" "}
            {/* Scoperta della dashboard: testo, non CTA — qui l'azione è il triage,
                la lettura aggregata è un'altra stanza (brief §Verdetto). */}
            <Link href="/admin/tickets/dashboard" className="font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-900 hover:decoration-slate-500">
              Dashboard SLA e volumi
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Sync email SEMPRE disponibile: il canale email esiste anche con
              0 ticket — è il modo con cui entrano i ticket nuovi. Con il
              canale vuoto la CTA è primaria (visibile quando serve). */}
          <form action={syncEmailIngestAction}>
            <GlassButton
              type="submit"
              variant={emailCount === 0 ? "primary" : "glass"}
              size="sm"
              title="Scarica la casella email: le nuove email diventano ticket o risposte"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Sincronizza email
            </GlassButton>
          </form>
          {/* UNA sola CTA primaria a schermo: quando «Sincronizza email»
              sale a primaria (canale vuoto), «Nuovo ticket» scende a vetro —
              due blu affiancati si rubavano il click a vicenda. */}
          <GlassLinkButton href="/admin/tickets/new" size="sm" variant={emailCount === 0 ? "glass" : "primary"}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Nuovo ticket
          </GlassLinkButton>
        </div>
      </header>

      {sync && <GlassNotice>{sync}</GlassNotice>}

      {/* Tab canali (web/email/whatsapp…): le code divise per canale come in Zendesk.
          Email e WhatsApp sono sempre visibili (anche a 0) — un canale del
          sistema non può sembrare assente. La lista nasconde gli archiviati. */}
      {/* py-1: senza padding verticale l'overflow-x taglia l'ombra (e il bordo
          inferiore) della pill attiva — su mobile il taglio netto era visibile. */}
      <nav aria-label="Canali" className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto py-1">
        {channels.map((ch) => {
          const { Icon } = channelMeta(ch.key);
          const active = channel === ch.key;
          const empty = ch.key !== "all" && ch.n === 0;
          return (
            <Link
              key={ch.key}
              href={qs({ channel: ch.key, page: undefined })}
              scroll={false}
              aria-current={active ? "page" : undefined}
              title={empty && ch.key === "email" ? "Nessun ticket email: configura la casella in Tools e sincronizza" : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                active
                  ? "bg-brand-600/90 text-white shadow-glass-btn"
                  : "glass-solid text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${empty ? "opacity-50" : ""}`} aria-hidden />
              {ch.label}
              {/* Spazio inscindibile dal conteggio: il gap-1.5 del flex non
                  tocca i text node («Chat web17» era illeggibile). */}
              {/* slate-500: slate-400 su vetro era ~2.8:1, sotto AA per testo 12px. */}
              <span className={`tabular-nums text-xs ${active ? "font-bold" : "font-medium text-slate-500"}`}>{"\u00A0"}{ch.n}</span>
            </Link>
          );
        })}
      </nav>

      {/* Filtri di triage + ricerca su una riga */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <nav
          aria-label="Filtri ticket"
          className="no-scrollbar -mx-1 flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/60 bg-white/45 p-1.5 backdrop-blur-xl sm:mx-0"
        >
          {FILTERS.map((flt) => (
            <Link
              key={flt.key}
              href={qs({ f: flt.key, page: undefined })}
              scroll={false}
              aria-current={filter === flt.key ? "page" : undefined}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                filter === flt.key ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5" : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
              }`}
            >
              {flt.label}
              <span className={`text-xs ${filter === flt.key ? "font-bold text-brand-700" : "font-medium text-slate-500"}`}>{counts[flt.key]}</span>
              {flt.key === "aperti" && counts.awaitingReply > 0 && (
                <span className="text-[11px] font-semibold text-orange-700">· {counts.awaitingReply} da rispondere</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Ricerca A RICHIESTA: collassata è un bottone — il gesto più
            frequente è scansionare, la casella vuota era un'inutile promessa
            permanente (critica: nove controlli prima del primo ticket). */}
        <TicketSearch q={q} filter={filter} channel={channel} />
      </div>

      {/* Lista di triage a tutta larghezza: scansionare è l'unico compito di questa pagina */}
      <section aria-labelledby="ticket-queue-title" className="space-y-2">
        <div className="flex items-baseline justify-between gap-2 px-1">
          {/* Il titolo ripete solo canale (se filtrato): la coda attiva è già
              detta dalla tab filtro — un quarto «aperti/18» era rumore. */}
          <h2 id="ticket-queue-title" className="text-sm font-bold text-slate-900">
            Coda
            {channel !== "all" && <span className="ml-1 font-normal text-slate-500">· {channelMeta(channel).label.toLowerCase()}</span>}
          </h2>
          <span className="text-xs text-slate-500" title={q ? "Risultati ricerca" : "Più urgenti prima"}>
            {/* Oltre la prima pagina la POSIZIONE sostituisce il totale: senza
                una query di conteggio il server non conosce il totale esatto,
                e un «61–67 di 7» era un controsenso — «Ticket 61–67» è onesto. */}
            {page > 1 ? (
              <span className="tabular-nums">Ticket {((page - 1) * PAGE_SIZE) + 1}–{((page - 1) * PAGE_SIZE) + tickets.length}</span>
            ) : (
              <>{tickets.length} {q ? (tickets.length === 1 ? "risultato" : "risultati") : "ticket"}</>
            )}
          </span>
        </div>

        <div className="space-y-2">
          {counts.archived > 0 && (
            <ArchivedTicketsBanner
              items={archived.map((a) => ({
                id: a.id,
                number: a.number,
                initial_query: a.initial_query,
                message_count: a.message_count,
              }))}
              total={counts.archived}
            />
          )}
          {tickets.map((tk, i) => {
            const sla = slaTier(tk);
            const open = tk.status !== "closed";
            const waiting = awaitsReply(tk);
            const bucket = dateBucket(tk.updated_at);
            // L'header appare solo alla PRIMA occorrenza del bucket: l'ordinamento
            // è per urgenza, quindi un ticket di oggi può seguire uno di ieri —
            // ripetere «OGGI» a metà lista sembra un bug, non lo è.
            const showHeader = !q && !tickets.slice(0, i).some((p) => dateBucket(p.updated_at) === bucket);
            const late = open && (sla.label === "in ritardo" || sla.label === "scaduto");
            const { Icon: ChannelIcon, label: channelLabel } = channelMeta(tk.channel ?? null);
            return (
              <div key={tk.id}>
                {showHeader && (
                  <p className="mb-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {bucket}
                  </p>
                )}
                <div
                  className={`group/ticket relative block rounded-2xl border transition ${
                    waiting
                      ? "glass-solid ticket-waiting hover:border-brand-300 hover:bg-white/70"
                      : "glass-solid border-white/40 hover:border-slate-300/80 hover:bg-white/60"
                  }`}
                >
                  {/* CARD = div; il LINK è il titolo (gesto primario APRIRE).
                      Prima la card intera era <Link> e le azioni di triage
                      stavano DENTRO: interattivi annidati in interattivo
                      (violazione ARIA, miss-click su touch — verificato in
                      vivo: il click sul menu ⋯ apriva il ticket). Ora le azioni
                      vivono nella colonna destra, fuori dal link. */}
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-x-3 p-3 sm:grid-cols-[56px_minmax(0,1fr)_auto_auto]">
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
                        {/* RIGA DI STATO UNICA: chi l'ha in mano, come sta lo
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
                      </div>
                      {/* Ogni voce è un'unità nowrap: la riga va a capo TRA le
                          voci, mai dentro («8 / msg»). I separatori «·» sono
                          stati TOLTI: a capo partivano con il punto orfano
                          («· 28 set, 05:45» da solo) — il gap larga (10px)
                          separa le voci senza rompersi al wrap. */}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-500">
                        <span className={`inline-flex items-center gap-1 whitespace-nowrap ${tk.channel === "email" ? "font-medium text-brand-700" : ""}`}>
                          <ChannelIcon className="h-3 w-3" aria-hidden />
                          {channelLabel}
                        </span>
                        {/* Il contatto del richiedente: su email è l'indirizzo
                            (a colpo d'occhio sai A CHI risponderai), su chat
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
                          su desktop la stessa componente sta nella colonna destra. */}
                      <div className="mt-2 sm:hidden">
                        <TicketCardActions
                          ticketId={tk.id}
                          open={open}
                          waitingReply={waiting}
                          mine={!!user.operatorId && tk.assigned_to === user.operatorId}
                        />
                      </div>
                    </div>

                    {/* Zona azioni (desktop): la colonna destra È delle azioni —
                        primary visibile + menu ⋯ (Chiudi, Nascondi). FUORI dal
                        link del titolo: nessun interattivo annidato. */}
                    <div className="hidden sm:block">
                      <TicketCardActions
                        ticketId={tk.id}
                        open={open}
                        waitingReply={waiting}
                        mine={!!user.operatorId && tk.assigned_to === user.operatorId}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!tickets.length && (
            <div className="glass-solid rounded-2xl p-6 text-center">
              <Inbox className="mx-auto h-6 w-6 text-slate-400" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-slate-700">Nessun ticket in questa coda</p>
              <p className="mt-1 text-xs text-slate-500">Prova un altro filtro, un altro canale o rimuovi la ricerca.</p>
              {(page > 1 || q) && (
                <GlassLinkButton variant="glass" size="sm" className="mt-3" href={q ? qs({ page: undefined, q: undefined }) : qs({ page: undefined })}>
                  {q ? "Torna alla coda" : "Torna alla prima pagina"}
                </GlassLinkButton>
              )}
            </div>
          )}
        </div>

        {/* Paginazione: solo quando c'è qualcosa da paginare (una pagina sola
            = zero controlli, zero rumore). Oltre la fine della coda (URL
            passato a mano) la lista è vuota e la nav perde senso — Precedenti
            cadrebbe in un'altra pagina vuota: recupera solo la CTA del vuoto.
            Link reali: la coda resta navigabile, condivisibile, apribile in
            nuova scheda. */}
        {((page > 1 && tickets.length > 0) || hasNext) && (
          <nav aria-label="Paginazione coda" className="flex items-center justify-between gap-3 pt-1">
            {page > 1 ? (
              <Link
                href={qs({ page: page === 2 ? undefined : String(page - 1) })}
                scroll={false}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/50 bg-white/70 px-4 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Precedenti
              </Link>
            ) : (
              <span aria-hidden />
            )}
            <span className="text-xs font-medium tabular-nums text-slate-500">
              Pagina {page}
            </span>
            {hasNext ? (
              <Link
                href={qs({ page: String(page + 1) })}
                scroll={false}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/50 bg-white/70 px-4 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Successivi
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <span aria-hidden />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
