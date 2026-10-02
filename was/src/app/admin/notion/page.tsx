import { CheckCircle2, ExternalLink, KeyRound, NotebookPen, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getNotionSettings, NOTION_LEAD_PROPERTIES } from "@/lib/notion";
import { getSyncConfig } from "@/lib/notion-config";
import NotionConfigEditor from "@/components/notion-config-editor";
import { saveNotionAction, syncLeadsNotionAction, testNotionAction, dryRunNotionAction, syncEntityNotionAction } from "../actions";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: 1,
    title: "Crea l'integrazione",
    text: "Su notion.so → Settings → Connections → «Develop or manage integrations» → New integration. Nome «Web Agency Salento», workspace giusto. Copia il secret (inizia con ntn_).",
    link: { href: "https://www.notion.so/profile/integrations", label: "Apri le integrazioni Notion" },
  },
  {
    n: 2,
    title: "Crea il database dei lead",
    text: "In Notion crea una pagina → Database (Table). Aggiungi le colonne come da mapping qui sotto (le select: Servizio, Urgenza, Budget, Stato, Sorgente).",
  },
  {
    n: 3,
    title: "Condividi il database con l'integrazione",
    text: "Sul database → menu ••• → Connections → collega «Web Agency Salento». Senza questo passaggio Notion risponde 404 anche con chiave giusta.",
  },
  {
    n: 4,
    title: "Incolla qui chiave e Database ID",
    text: "L'id del database è nella URL dopo il nome della pagina e prima di «?v=» (stringa di 32 caratteri). Poi salva e usa «Prova connessione».",
  },
];

interface QueueRow {
  entity: string;
  record_id: string;
  attempts: number;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
}

export default async function NotionPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string; dryrun?: string }>;
}) {
  await requireAdmin();
  const { test, dryrun } = await searchParams;
  const settings = await getNotionSettings();
  const config = await getSyncConfig();
  const pool = db();
  let pending = 0;
  let queue: QueueRow[] = [];
  if (pool) {
    try {
      const { rows } = await pool.query<{ n: string }>(
        "select count(*) as n from leads where notion_synced_at is null",
      );
      pending = Number(rows[0]?.n ?? 0);
      const q = await pool.query<QueueRow>(
        `select entity, record_id, attempts, last_error, last_error_at, created_at
         from notion_sync_queue
         order by (last_error_at is null), last_error_at desc nulls last, created_at desc
         limit 20`,
      );
      queue = q.rows;
    } catch {}
  }

  return (
    <div className="space-y-4">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={NotebookPen}
        title="Notion — lead nel vostro workspace"
        subtitle={
          <>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                settings?.enabled && settings.hasKey
                  ? "bg-green-100/90 text-green-700"
                  : "bg-amber-100/90 text-amber-700"
              }`}
            >
              {settings?.enabled && settings.hasKey ? "Pronto" : "In attesa chiavi"}
            </span>
            {settings?.lastTestAt && (
              <span className="inline-flex items-center gap-1 text-xs">
                {settings.lastTestOk ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />
                )}
                ultimo test: {new Date(settings.lastTestAt).toLocaleString("it-IT")}
              </span>
            )}
          </>
        }
      />

      {test && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
            test.startsWith("OK")
              ? "bg-green-50/90 text-green-800 ring-green-200/60"
              : "bg-amber-50/90 text-amber-900 ring-amber-200/60"
          }`}
        >
          {test}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {STEPS.map((s) => (
          <Card key={s.n}>
            <p className="font-semibold text-slate-900">
              <span className="step-dot mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600/90 text-[11px] text-white">
                {s.n}
              </span>
              {s.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.text}</p>
            {s.link && (
              <a
                href={s.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                {s.link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-brand-600" aria-hidden />
            Configurazione
          </p>
          {settings?.databaseId && (
            <a
              href={`https://www.notion.so/${settings.databaseId.replace(/-/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-white/60 transition hover:bg-white"
            >
              Apri il database in Notion <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
        <form action={saveNotionAction} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-500">
              Secret integrazione (ntn_…)
              <input
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={settings?.hasKey ? "••• salvata cifrata — lascia vuoto per conservarla" : "secret dell'integrazione Notion"}
                className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-brand-400"
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              Database ID
              <input
                name="databaseId"
                defaultValue={settings?.databaseId ?? ""}
                placeholder="32 caratteri dalla URL del database"
                className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-brand-400"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={settings?.enabled ?? false}
                className="h-4 w-4 accent-[#34C759]"
              />
              Attiva sincronizzazione lead
            </label>
            <button className="ml-auto rounded-full bg-brand-600/90 px-4 py-1.5 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
              Salva
            </button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/60 pt-3">
          <form action={testNotionAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Prova connessione
            </button>
          </form>
          <form action={syncLeadsNotionAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Sincronizza lead ora{pending > 0 ? ` (${pending} in attesa)` : ""}
            </button>
          </form>
          <form action={dryRunNotionAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Dry-run (payload senza inviare)
            </button>
          </form>
        </div>
        {dryrun && (
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-slate-900/90 p-3 text-[11px] leading-relaxed text-slate-100">
            {dryrun}
          </pre>
        )}
      </Card>

      {/* ── Editor config (Fase 3) ── */}
      <Card>
        <p className="font-semibold text-slate-900">Config di sincronizzazione</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Mapping, titolo, sorgente e comportamento: tutto modificabile senza toccare codice. La validazione è lato
          server; con i valori di default la sync si comporta esattamente come sempre.
        </p>
        <div className="mt-3">
          <NotionConfigEditor config={config} />
        </div>
      </Card>

      {/* ── FASE 4: entità estese, spente di default ── */}
      <Card>
        <p className="font-semibold text-slate-900">Altre entità (tickets, callbacks)</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Stesso motore, mapping dedicato. <strong>Spente di default</strong>: finché non le attivi nella config
          non generano nessuna chiamata API. Attivazione: card «Config di sincronizzazione» → JSON entità
          (tickets/callbacks → enabled).
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={syncEntityNotionAction}>
            <input type="hidden" name="entity" value="tickets" />
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Sincronizza ticket ora
            </button>
          </form>
          <form action={syncEntityNotionAction}>
            <input type="hidden" name="entity" value="callbacks" />
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Sincronizza callback ora
            </button>
          </form>
        </div>
      </Card>

      {/* ── Sync log (coda persistente) ── */}
      <Card>
        <p className="font-semibold text-slate-900">Sync log (coda di sincronizzazione)</p>
        {queue.length === 0 ? (
          <p className="mt-2 text-xs text-slate-400">
            Coda vuota: nessun record in attesa o in errore. I lead consegnati escono dalla coda; i fallimenti
            definitivi restano qui visibili con l&apos;errore, senza buttare via nulla.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {queue.map((q) => (
              <li
                key={`${q.entity}-${q.record_id}`}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-white/50 px-3 py-2 text-xs ring-1 ring-white/60"
              >
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{q.entity}</span>
                <code className="text-slate-500">{q.record_id.slice(0, 8)}</code>
                <span className="text-slate-400">tentativi: {q.attempts}</span>
                {q.last_error && (
                  <span className="text-red-500" title={q.last_error_at ? new Date(q.last_error_at).toLocaleString("it-IT") : undefined}>
                    {q.last_error.slice(0, 120)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <p className="font-semibold text-slate-900">Colonne del database Notion (default, nomi esatti)</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(NOTION_LEAD_PROPERTIES).map(([name, type]) => (
            <li
              key={name}
              className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] text-slate-600 ring-1 ring-white/60"
            >
              {name} <span className="text-slate-400">· {type}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Quando la sincronizzazione è attiva, ogni lead finisce su Notion come pagina secondo il mapping qui sopra
          (configurabile nella card «Config di sincronizzazione»). Fino ad allora tutto resta com&apos;è: la coda si
          svuota con «Sincronizza lead ora» appena collegate le chiavi.
        </p>
      </Card>
    </div>
  );
}
