import Link from "next/link";
import { Building2, Coins, Mail, MessageCircle, Phone, RefreshCw, Search, Sparkles, Ticket, Users, X } from "lucide-react";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { countClients, listClients, channelLabel, sumPortfolioBudget } from "@/lib/clients";
import { GlassButton, GlassNotice } from "@/components/glass";
import { syncClientsAction } from "@/app/admin/actions";

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
  searchParams: Promise<{ q?: string; sync?: string; aperti?: string; ordina?: string }>;
}) {
  await requireAdmin();
  const { q, sync, aperti, ordina } = await searchParams;
  const byBudget = ordina === "budget";
  const openOnly = aperti === "1";
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const [clients, counts, portfolio] = await Promise.all([
    listClients(q, 200, openOnly, byBudget ? "budget" : undefined),
    countClients(),
    sumPortfolioBudget(),
  ]);

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
        <form action={syncClientsAction}>
          <GlassButton type="submit" variant="primary" size="sm">
            <RefreshCw className="h-4 w-4" aria-hidden /> Sincronizza ora
          </GlassButton>
        </form>
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
      <div className="flex items-center gap-2">
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
        {(openOnly || q) && (
          <span className="text-xs text-slate-500">
            {clients.length} {clients.length === 1 ? "risultato" : "risultati"}
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
            {q
              ? "Nessun cliente trovato con questo filtro."
              : "Portafoglio vuoto: Ambrosio lo popola al primo giro di sync (cron ogni 15 minuti) oppure premi «Sincronizza ora»."}
          </GlassNotice>
        )}
      </div>
    </div>
  );
}
