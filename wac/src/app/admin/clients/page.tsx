import Link from "next/link";
import { Building2, Coins, Download, Mail, MessageCircle, Phone, RefreshCw, Search, Sparkles, Ticket, TrendingUp, Users, X } from "lucide-react";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { countClients, listClients, channelLabel, sumPortfolioBudget, clientTypeLabel } from "@/lib/clients";
import { CLIENT_TYPES, CLIENT_TYPE_LABELS, clientTypePure } from "@/lib/clients-shared";
import { GlassButton, GlassNotice } from "@/components/glass";
import { syncClientsAction, salvaDittaAction, rigettaDittaAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

/**
 * PORTAFOGLIO CLIENTI — sezione tutta gestita da Ambrosio: i dati non si
 * inseriscono a mano, il sync (cron blocco 9 o bottone «Sincronizza»)
 * recupera nome/telefono/email/ditta DAI TICKET su tutti i canali e
 * compone le schede. Ogni riga è un cliente reale con le sue azioni
 * collegate: chiama, WhatsApp, email, apri i suoi ticket.
 *
 * Header di pagina sul pattern Panoramica/Ticket: h1 text-2xl + icona +
 * sottotitolo operativo; KPI in card glass come la dashboard.
 */

const WA_RE = /^[+0-9]+$/;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sync?: string; aperti?: string; ordina?: string; tipo?: string; "senza-ditta"?: string }>;
}) {
  await requireAdmin();
  const { q, sync, aperti, ordina, tipo: tipoParam, "senza-ditta": senzaDittaParam } = await searchParams;
  const byBudget = ordina === "budget";
  const openOnly = aperti === "1";
  // Filtro tipo: SOLO valori del contratto condiviso (o «nessuno» per le
  // schede da classificare) — un ?tipo= manomesso degrada a «tutti».
  const tipo = tipoParam === "nessuno" ? "nessuno" : clientTypePure(tipoParam);
  // Segmento di qualità dati: aziende senza ragione sociale (038). Quando
  // attivo è lui il filtro (implica tipo=azienda, vedi listClients).
  const senzaDitta = senzaDittaParam === "1";
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const [clients, counts, portfolio] = await Promise.all([
    listClients(q, 200, openOnly, byBudget ? "budget" : undefined, tipo ?? undefined, senzaDitta),
    countClients(),
    sumPortfolioBudget(),
  ]);

  // Export CSV segmentato: STESSI filtri della vista corrente — quello che
  // vedi è quello che esporta (il file dice il segmento nel nome).
  const csvParams = new URLSearchParams();
  if (q) csvParams.set("q", q);
  if (openOnly) csvParams.set("aperti", "1");
  if (byBudget) csvParams.set("ordina", "budget");
  if (tipo) csvParams.set("tipo", tipo);
  if (senzaDitta) csvParams.set("senza-ditta", "1");
  const csvQuery = csvParams.toString();
  const csvHref = `/api/admin/clients.csv${csvQuery ? `?${csvQuery}` : ""}`;

  const KPIS = [
    { label: "Clienti", value: counts.total, Icon: Users, tint: "bg-brand-600/90" },
    { label: "Con telefono", value: counts.withPhone, Icon: Phone, tint: "bg-violet-500/90" },
    { label: "Con email", value: counts.withEmail, Icon: Mail, tint: "bg-blue-500/90" },
    { label: "Aziende", value: counts.companies, Icon: Building2, tint: "bg-orange-500/90" },
    {
      label: "Budget dichiarato",
      // Valore commerciale del portafoglio: somma dei «~N € dichiarati»
      // delle schede (null se il DB non è migrato — mai uno 0 finto).
      value: portfolio != null ? `~${portfolio.toLocaleString("it-IT")} €` : "—",
      Icon: Coins,
      tint: "bg-emerald-500/90",
      small: true,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header di pagina (pattern delle liste admin) con CTA sync: il
          gesto manuale esiste ma la regolare è l'automazione di Ambrosio. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold text-slate-900">
            <Users className="h-6 w-6 text-brand-600" aria-hidden />
            Clienti
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50/90 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200/70">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              gestito da Ambrosio
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Le schede nascono dai ticket (chat, email, WhatsApp): Ambrosio riconcilia i contatti
            automaticamente, tu resti con le azioni da fare.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={csvHref}
            download
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/60 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-white/60 transition hover:bg-white/90"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Esporta CSV
          </a>
          <a
            href="/api/admin/clients.csv?agg=tipo-mese"
            download
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/60 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-white/60 transition hover:bg-white/90"
          >
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Portafoglio nel tempo
          </a>
          <form action={syncClientsAction}>
            <GlassButton type="submit" variant="primary" size="sm">
              <RefreshCw className="h-4 w-4" aria-hidden /> Sincronizza ora
            </GlassButton>
          </form>
        </div>
      </header>

      {sync && <GlassNotice tone={sync.startsWith("Ambrosio") ? "success" : "info"}>{sync}</GlassNotice>}

      <form method="get" action="/admin/clients" className="flex max-w-md items-center gap-2" role="search">
        <label htmlFor="q-clienti" className="sr-only">
          Cerca cliente
        </label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="q-clienti"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Cerca per nome, email, telefono, azienda…"
            className="w-full rounded-full border border-white/50 bg-white/60 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 backdrop-blur-xl outline-none transition focus:border-brand-400/70 focus:bg-white/80"
          />
        </div>
        <GlassButton type="submit" variant="glass" size="sm">
          Cerca
        </GlassButton>
        {q && (
          <Link
            href="/admin/clients"
            aria-label="Rimuovi filtro di ricerca"
            className="inline-flex min-h-11 items-center rounded-full px-2 text-slate-500 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </form>

      {/* Filtro «solo con ticket aperti»: il cribbio del portafoglio — chi
          ha lavoro in corso ora. Link-graffetta come le tab della inbox. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={openOnly ? "/admin/clients" : "/admin/clients?aperti=1"}
          aria-pressed={openOnly}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
            openOnly
              ? "bg-orange-50/90 text-orange-700 ring-orange-200/70"
              : "bg-white/50 text-slate-600 ring-white/60 hover:bg-white/80"
          }`}
        >
          <Ticket className="h-3.5 w-3.5" aria-hidden />
          Solo con ticket aperti
        </Link>
        {(openOnly || q || senzaDitta) && (
          <span className="text-xs text-slate-500">
            {clients.length} {clients.length === 1 ? "risultato" : "risultati"}
          </span>
        )}
        {/* Onestà sul troncamento: la lista ha limit 200. Il KPI «Clienti»
            conta TUTTO (count(*)): se il totale supera il limite, i due numeri
            non tornano e l utente deve saperlo — gli stessi dati si esportano
            COMPLETI via CSV/Notion. Solo su lista non filtrata: con ?q o
            ?aperti=1 il conteggio è dei risultati, il troncamento globale
            non è pertinente (niente allarmi falsi). */}
        {counts.total > clients.length && !q && !openOnly && (
          <span className="text-xs font-medium text-amber-700">
            mostrati i primi {clients.length} su {counts.total}
          </span>
        )}
        {/* Ordina per budget dichiarato: la lettura commerciale del
            portafoglio — chi vale di più in cima, senza toccare il DB. */}
        <Link
          href={byBudget ? "/admin/clients" : "/admin/clients?ordina=budget"}
          aria-pressed={byBudget}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
            byBudget
              ? "bg-emerald-50/90 text-emerald-700 ring-emerald-200/70"
              : "bg-white/50 text-slate-600 ring-white/60 hover:bg-white/80"
          }`}
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          Budget: più alto prima
        </Link>

        {/* Filtro tipo cliente (038): chips coi conteggi — il dato che dice
            se vale la pena cliccare. «Da classificare» = NULL, la coda delle
            schede che un umano deve ancora guardare. Query string come le
            altre (aperti/ordina), niente stato client. */}
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden />
        <Link
          href={tipo ? "/admin/clients" : "/admin/clients?tipo=nessuno"}
          aria-pressed={tipo === "nessuno"}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
            tipo === "nessuno"
              ? "bg-slate-900/90 text-white ring-slate-900/20"
              : "bg-white/50 text-slate-600 ring-white/60 hover:bg-white/80"
          }`}
        >
          Da classificare
          <span className="tabular-nums opacity-70">{counts.byType.nessuno ?? 0}</span>
        </Link>
        {/* Segmento qualità «aziende senza ditta»: il conto delle schede
            da completare, con lo stesso gesto degli altri filtri. */}
        {counts.aziendeSenzaDitta > 0 && (
          <Link
            href={senzaDitta ? "/admin/clients" : "/admin/clients?senza-ditta=1"}
            aria-pressed={senzaDitta}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
              senzaDitta
                ? "bg-amber-500/90 text-white shadow-glass-btn"
                : "bg-white/50 text-slate-600 ring-white/60 hover:bg-white/80"
            }`}
          >
            Aziende senza ditta
            <span className="tabular-nums opacity-70">{counts.aziendeSenzaDitta}</span>
          </Link>
        )}
        {CLIENT_TYPES.map((t) => (
          <Link
            key={t}
            href={tipo === t ? "/admin/clients" : `/admin/clients?tipo=${t}`}
            aria-pressed={tipo === t}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 transition ${
              tipo === t
                ? "bg-brand-600/90 text-white shadow-glass-btn"
                : "bg-white/50 text-slate-600 ring-white/60 hover:bg-white/80"
            }`}
          >
            {CLIENT_TYPE_LABELS[t]}
            <span className="tabular-nums opacity-70">{counts.byType[t] ?? 0}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {KPIS.map((k) => (
          <div key={k.label} className="glass-solid rounded-3xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
                <p
                  className={`mt-1 font-bold text-slate-900 tabular-nums ${
                    "small" in k && k.small ? "text-2xl" : "text-3xl"
                  }`}
                >
                  {k.value}
                </p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${k.tint} text-white shadow-glass-btn backdrop-blur-xl`}>
                <k.Icon className="h-5 w-5" aria-hidden />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3">
        {clients.map((c) => (
          <div key={c.id} className="glass-solid rounded-3xl p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              {/* Identità: il nome apre la scheda (il gesto primario). */}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">
                  <Link href={`/admin/clients/${c.id}`} className="hover:text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                  {c.company_name && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-orange-50/90 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-orange-200/70">
                      <Building2 className="h-3 w-3" aria-hidden />
                      {c.company_name}
                    </span>
                  )}
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                      c.client_type
                        ? "bg-violet-50/90 text-violet-700 ring-violet-200/70"
                        : "bg-slate-50/90 text-slate-500 ring-slate-200/70"
                    }`}
                  >
                    {clientTypeLabel(c.client_type)}
                  </span>
                </p>
                <p className="mt-0.5 text-sm text-slate-600">
                  {c.contact_email ?? c.email_norm ?? "nessuna email"} ·{" "}
                  {c.phone_e164 ?? "nessun telefono"}
                  {c.budget_total != null && (
                    <strong className="ml-1.5 font-semibold text-emerald-700">
                      · ~{c.budget_total.toLocaleString("it-IT")} € dichiarati
                    </strong>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {c.ticket_count} {c.ticket_count === 1 ? "ticket" : "ticket"} su{" "}
                  {(c.channels ?? []).length > 0
                    ? (c.channels ?? []).map((ch) => channelLabel(ch)).join(" · ")
                    : "—"}{" "}
                  · visto l&apos;ultima volta il{" "}
                  {new Date(c.last_seen_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" })}
                  {c.open_tickets > 0 && (
                    <strong className="ml-1.5 font-semibold text-orange-700">
                      · {c.open_tickets} {c.open_tickets === 1 ? "aperto" : "aperti"}
                    </strong>
                  )}
                </p>

                {/* Completamento rapido (038/039) in LISTA: la ditta citata
                    nei lead si salva (o rigetta) senza aprire la scheda —
                    stesse azioni server, stesso audit, stessa regola del banner. */}
                {c.azienda_suggerita && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-xs text-slate-700">
                    <span className="min-w-0">
                      <strong className="font-semibold text-slate-900">{c.azienda_suggerita}</strong>{" "}
                      citata nei suoi lead ({c.azienda_suggerita_citazioni}) —
                    </span>
                    <form action={salvaDittaAction} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="ditta" value={c.azienda_suggerita} />
                      <button
                        type="submit"
                        className="inline-flex min-h-8 items-center rounded-full bg-brand-600/90 px-3 py-1 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-700"
                      >
                        Salva in scheda
                      </button>
                    </form>
                    <form action={rigettaDittaAction} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="ditta" value={c.azienda_suggerita} />
                      <button
                        type="submit"
                        className="inline-flex min-h-8 items-center rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-white/60 transition hover:bg-white"
                      >
                        Non è la sua
                      </button>
                    </form>
                  </div>
                )}
              </div>

              {/* Budget dichiarato: colonna propria della card (quando c'è).
                  Larghezza minima fissa: le cifre si allineano leggendo in colonna. */}
              {c.budget_total != null && (
                <div className="min-w-28 shrink-0 md:text-right">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Budget dichiarato</p>
                  <p className="text-lg font-bold text-emerald-700 tabular-nums">
                    ~{c.budget_total.toLocaleString("it-IT")} €
                  </p>
                </div>
              )}

              {/* Azioni collegate: telefono, WhatsApp, email, ticket. Le
                  stesse che il ticketing usa già nel dettaglio ticket. */}
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {c.phone_e164 && (
                  <a
                    href={`tel:${c.phone_e164}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/60 px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-white/50 transition hover:bg-white/90"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    <span className="md:sr-only">Chiama</span>
                  </a>
                )}
                {c.phone_e164 && WA_RE.test(c.phone_e164) && (
                  <a
                    href={`https://wa.me/${c.phone_e164.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-50/80 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200/60 transition hover:bg-emerald-100/80"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden />
                    <span className="md:sr-only">WhatsApp</span>
                  </a>
                )}
                {(c.contact_email ?? c.email_norm) && (
                  <a
                    href={`mailto:${c.contact_email ?? c.email_norm}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-50/80 px-3 py-1.5 text-sm font-medium text-sky-700 ring-1 ring-sky-200/60 transition hover:bg-sky-100/80"
                  >
                    <Mail className="h-4 w-4" aria-hidden />
                    <span className="md:sr-only">Email</span>
                  </a>
                )}
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600/90 px-3 py-1.5 text-sm font-semibold text-white shadow-glass-btn transition hover:bg-brand-700"
                >
                  Ticket ({c.ticket_count})
                </Link>
              </div>
            </div>
          </div>
        ))}
        {clients.length === 0 && (
          <GlassNotice>
            {q || tipo || senzaDitta
              ? "Nessun cliente trovato con questo filtro."
              : "Portafoglio vuoto: Ambrosio lo popola al primo giro di sync (cron ogni 15 minuti) oppure premi «Sincronizza ora»."}
          </GlassNotice>
        )}
      </div>
    </div>
  );
}
