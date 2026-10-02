import { CalendarClock, CheckCircle2, ExternalLink, FileJson, KeyRound, ListChecks, RefreshCw, Trash2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getGCalConfig, getGCalDiagnostics } from "@/lib/google-calendar";
import { getNotionSettings } from "@/lib/notion";
import { getSyncConfig } from "@/lib/notion-config";
import { backfillGCalAction, retryGCalAction, saveGCalAction, testGCalAction } from "@/app/admin/actions";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Google Calendar · Impostazioni", robots: { index: false } };

const STEPS = [
  {
    n: 1,
    title: "Abilita l'API Calendar",
    text: "Google Cloud Console → «API e servizi» → cerca «Google Calendar API» → Abilita. Puoi usare lo stesso progetto e lo stesso service account già creati per Google Drive.",
    link: { href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", label: "Apri la libreria API" },
  },
  {
    n: 2,
    title: "Crea (o riusa) l'account di servizio",
    text: "Se hai già configurato Drive, il JSON che hai salvato lì va bene anche qui. Altrimenti: IAM → Service Accounts → crea → Chiavi → «Aggiungi chiave» → JSON: si scarica il file da incollare qui.",
    link: { href: "https://console.cloud.google.com/iam-admin/serviceaccounts", label: "Apri gli account di servizio" },
  },
  {
    n: 3,
    title: "Prepara il calendario dell'agenzia",
    text: "Su Google Calendar crea (o scegli) il calendario degli appuntamenti → Impostazioni e condivisione → «Condividi con persone specifiche» → aggiungi l'email del service account col permesso «Apportare modifiche agli eventi». Poi copia l'«ID calendario» dalla sezione «Integra calendario» (tipo agency-xyz@group.calendar.google.com; per il calendario principale usa primary).",
  },
  {
    n: 4,
    title: "Incolla qui, prova, attiva",
    text: "Incolla il JSON, indica l'ID calendario, salva e usa «Prova connessione»: il test interroga davvero il calendario e fallisce se l'API è spenta o il calendario non è condiviso. Solo dopo attiva la sincronizzazione: ogni callback (widget, team, Ambrosio) diventa un evento.",
  },
];

export default async function GoogleCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  await requireAdmin();
  const { msg } = await searchParams;
  const [config, notion, notionSync, diag] = await Promise.all([
    getGCalConfig(),
    getNotionSettings().catch(() => null),
    getSyncConfig().catch(() => null),
    getGCalDiagnostics().catch(() => null),
  ]);

  const notionReady = Boolean(notion?.enabled && notion.hasKey);
  const notionCallbacks = Boolean(notionSync?.entities.callbacks.enabled);
  const mirrorWarn = config.syncToNotion && (!notionReady || !notionCallbacks);

  const badge = !config.hasCreds || !config.calendarId
    ? { text: "Da collegare", cls: "bg-amber-100/90 text-amber-700" }
    : config.lastTestOk === true
      ? { text: config.enabled ? "Attivo" : "Collegato", cls: "bg-green-100/90 text-green-700" }
      : config.lastTestOk === false
        ? { text: "Errore ultimo test", cls: "bg-amber-100/90 text-amber-700" }
        : { text: "Da verificare", cls: "bg-amber-100/90 text-amber-700" };

  return (
    <div className="space-y-4">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={CalendarClock}
        title="Google Calendar — gli appuntamenti dell'agenzia"
        subtitle={
          <>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
              {badge.text}
            </span>
            {config.lastTestAt && (
              <span className="inline-flex items-center gap-1 text-xs">
                {config.lastTestOk === true ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#34C759]" aria-hidden />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />
                )}
                ultimo test: {new Date(config.lastTestAt).toLocaleString("it-IT")}
              </span>
            )}
          </>
        }
      />

      <Card>
        <p className="text-sm leading-relaxed text-slate-600">
          Ogni <strong>callback</strong> — dal widget del sito, fissata da Michele o Daniele, oppure presa da{" "}
          <strong>Ambrosio AI</strong> fuori turno — diventa un evento nel calendario Google configurato, con cliente,
          telefono e servizio. Callback conclusa o cancellata → evento rimosso; «Richiama ora» → evento riprogrammato.
          Se attivi anche il mirror, la stessa callback finisce nel database <strong>Notion</strong>.
        </p>
      </Card>

      {msg && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
            msg.startsWith("OK")
              ? "bg-green-50/90 text-green-800 ring-green-200/60"
              : "bg-amber-50/90 text-amber-900 ring-amber-200/60"
          }`}
        >
          {msg}
          {msg.startsWith("ERRORE") && " — i dettagli completi sono nel Log di audit (azione «gcal.*»)."}
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
        <p className="flex items-center gap-1.5 font-semibold text-slate-900">
          <KeyRound className="h-4 w-4 text-brand-600" aria-hidden />
          Configurazione
        </p>
        {config.hasCreds ? (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <FileJson className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            Service account salvato:
            <code className="rounded-lg bg-white/70 px-2 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-white/60">
              {config.clientEmail ?? "email non leggibile — riscarica il JSON"}
            </code>
            <span className="text-slate-400">· cifrato AES-256-GCM, mai rispedito al browser</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Nessun service account collegato: segui i 4 passi qui sopra, poi incolla il JSON qui sotto.
          </p>
        )}

        <form action={saveGCalAction} className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-slate-500">
            JSON dell&apos;account di servizio {config.hasCreds && "(lascia vuoto per tenere quello salvato)"}
            <textarea
              name="serviceAccountJson"
              rows={5}
              autoComplete="off"
              spellCheck={false}
              placeholder={config.hasCreds ? "•••••••• (vuoto = non cambiare)" : '{ "type": "service_account", "client_email": "…", "private_key": "-----BEGIN PRIVATE KEY-----\\n…" }'}
              className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 font-mono text-xs text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-400 focus:border-brand-400"
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            ID calendario (es. agency-xyz@group.calendar.google.com, oppure <code className="font-mono">primary</code>)
            <input
              name="calendarId"
              defaultValue={config.calendarId ?? ""}
              autoComplete="off"
              spellCheck={false}
              placeholder="primary"
              className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 font-mono text-xs text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-400 focus:border-brand-400"
            />
          </label>
          <div className="flex flex-col gap-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="enabled" defaultChecked={config.enabled} className="size-4 accent-emerald-500" />
              Sincronizzazione attiva: ogni nuova callback genera un evento
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="syncToNotion" defaultChecked={config.syncToNotion} className="size-4 accent-emerald-500" />
              Mirror Notion: la callback finisce anche nel database Notion
            </label>
          </div>
          {mirrorWarn && (
            <p className="rounded-xl bg-amber-50/90 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200/70">
              Il mirror richiede <strong>Notion collegato</strong> e l&apos;entità <strong>Callbacks attiva</strong> nella
              configurazione Notion. Stato attuale: Notion {notionReady ? "collegato" : "non collegato"} · Callbacks{" "}
              {notionCallbacks ? "attive" : "spente"} (da /admin/notion).
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-full bg-brand-600/90 px-4 py-1.5 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
              Salva configurazione
            </button>
            <span className="text-xs text-slate-400">Salvare non attiva nulla da solo: subito dopo usa «Prova connessione».</span>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/60 pt-3">
          <form action={testGCalAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Prova connessione
            </button>
          </form>
          <form action={backfillGCalAction}>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Sincronizza callback esistenti
            </button>
          </form>
          {config.hasCreds && (
            <form action={saveGCalAction}>
              <input type="hidden" name="remove" value="1" />
              <button className="inline-flex items-center gap-1 rounded-full border border-red-200/70 bg-red-50/70 px-4 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100/70">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Rimuovi credenziali
              </button>
            </form>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          «Sincronizza callback esistenti» ripercorre le callback pendenti senza evento (max 20 per giro: rilanciala finché
          il risultato dice 0 creati). Le callback già sincronizzate non vengono mai duplicate.
        </p>
      </Card>

      {/* ── DIAGNOSTICA: eventi 24h, errori, riprova fallite ───────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 font-semibold text-slate-900">
              <ListChecks className="h-4 w-4 text-brand-600" aria-hidden />
              Diagnostica — ultime 24 ore
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Cosa è partito davvero verso il calendario e cosa è rimasto indietro, dal log di sync.
            </p>
          </div>
          <form action={retryGCalAction}>
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
              disabled={!diag || diag.pendingRetry === 0}
              title={diag && diag.pendingRetry === 0 ? "Nessuna callback da recuperare" : undefined}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Riprova fallite {diag && diag.pendingRetry > 0 ? `(${diag.pendingRetry})` : ""}
              </button>
          </form>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Eventi creati (24h)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{diag?.created24h ?? 0}</p>
            {diag?.lastCreatedAt && (
              <p className="text-[11px] text-slate-400">ultimo: {new Date(diag.lastCreatedAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</p>
            )}
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Errori (24h)</p>
            <p className={`mt-1 text-2xl font-bold ${diag && diag.errors24h > 0 ? "text-amber-600" : "text-slate-900"}`}>
              {diag?.errors24h ?? 0}
            </p>
            <p className="text-[11px] text-slate-400">righe «error» nel log di sync</p>
          </div>
          <div className="rounded-2xl bg-white/60 p-4 ring-1 ring-white/50">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Da recuperare</p>
            <p className={`mt-1 text-2xl font-bold ${diag && diag.pendingRetry > 0 ? "text-red-600" : "text-slate-900"}`}>
              {diag?.pendingRetry ?? 0}
            </p>            <p className="text-[11px] text-slate-400">callback mai consegnate, ritentabili col bottone</p>
          </div>
        </div>
        {diag && diag.recentErrors.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Ultimi errori</h3>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/50">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-bold">Quando</th>
                    <th className="px-3 py-2 font-bold">Cliente</th>
                    <th className="px-3 py-2 font-bold">Slot</th>
                    <th className="px-3 py-2 font-bold">Errore</th>
                  </tr>
                  </thead>
                <tbody className="divide-y divide-slate-100">
                  {diag.recentErrors.map((e, i) => (
                    <tr key={i} className="text-slate-600">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                        {new Date(e.createdAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-800">{e.leadName ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{e.slotLabel ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{e.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              «Riprova fallite» rilancia la sync per le callback mai consegnate (max 10 per giro, stesso percorso di una
              callback nuova): un errore di rete o di token passa, un problema di configurazione resta e va corretto qui sopra.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
