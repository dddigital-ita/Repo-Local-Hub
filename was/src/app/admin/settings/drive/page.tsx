import { CheckCircle2, ExternalLink, FileJson, FolderSync, KeyRound, Trash2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getDriveConfig } from "@/lib/drive";
import { saveDriveAction, testDriveAction } from "@/app/admin/actions";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: 1,
    title: "Abilita l'API Drive",
    text: "Google Cloud Console → nuovo progetto (o quello dell'agenzia) → «API e servizi» → cerca «Google Drive API» → Abilita. È l'API dell'account di servizio, non serve schermo OAuth.",
    link: { href: "https://console.cloud.google.com/apis/library/drive.googleapis.com", label: "Apri la libreria API" },
  },
  {
    n: 2,
    title: "Crea l'account di servizio",
    text: "IAM → Service Accounts → «Crea account di servizio» → nome «webagency-drive» → fine (niente ruoli). Poi apri la scheda → Chiavi → «Aggiungi chiave» → JSON: si scarica il file da incollare qui.",
    link: { href: "https://console.cloud.google.com/iam-admin/serviceaccounts", label: "Apri gli account di servizio" },
  },
  {
    n: 3,
    title: "Condividi la cartella Drive",
    text: "Su Drive crea una cartella (es. «Web Agency Salento») → Condividi → incolla l'email dell'account di servizio (finisce con @…iam.gserviceaccount.com) → ruolo Editor. Senza questo passo il test si collega ma l'upload verrà negato.",
  },
  {
    n: 4,
    title: "Incolla il JSON qui e prova",
    text: "Copia TUTTO il contenuto del file JSON scaricato, salva, poi «Prova connessione»: il test chiede un token con il JSON e interroga l'API Drive — fallisce se API è spenta o la chiave non è valida.",
  },
];

export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  await requireAdmin();
  const { test } = await searchParams;
  const config = await getDriveConfig();

  const badge = !config.hasCreds
    ? { text: "Da collegare", cls: "bg-amber-100/90 text-amber-700" }
    : config.lastTestOk === true
      ? { text: "Collegato", cls: "bg-green-100/90 text-green-700" }
      : config.lastTestOk === false
        ? { text: "Errore ultimo test", cls: "bg-amber-100/90 text-amber-700" }
        : { text: "Da verificare", cls: "bg-amber-100/90 text-amber-700" };

  return (
    <div className="space-y-4">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={FolderSync}
        title="Google Drive — la cartella condivisa dell'agenzia"
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

      {test && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm font-medium ring-1 ${
            test.startsWith("OK") || test.startsWith("Credenziali")
              ? "bg-green-50/90 text-green-800 ring-green-200/60"
              : "bg-amber-50/90 text-amber-900 ring-amber-200/60"
          }`}
        >
          {test}
          {test.startsWith("ERRORE") && " — i dettagli completi sono nel Log di audit (azione «Test Google Drive»)."}
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
        <form action={saveDriveAction} className="mt-3 space-y-3">
          <label className="block text-xs font-medium text-slate-500">
            JSON dell&apos;account di servizio (file completo o solo client_email + private_key)
            <textarea
              name="serviceAccountJson"
              rows={6}
              autoComplete="off"
              spellCheck={false}
              placeholder='{ "type": "service_account", "project_id": "…", "client_email": "…", "private_key": "-----BEGIN PRIVATE KEY-----\n…" }'
              className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 font-mono text-xs text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-400 focus:border-brand-400"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-full bg-brand-600/90 px-4 py-1.5 text-xs font-semibold text-white shadow-glass-btn transition hover:bg-brand-500/90">
              Salva credenziali
            </button>
            <span className="text-xs text-slate-400">Salvare non attiva nulla da solo: subito dopo usa «Prova connessione».</span>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/60 pt-3">
          <form action={testDriveAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Prova connessione
            </button>
          </form>
          {config.hasCreds && (
            <form action={saveDriveAction}>
              <input type="hidden" name="remove" value="1" />
              <button className="inline-flex items-center gap-1 rounded-full border border-red-200/70 bg-red-50/70 px-4 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100/70">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Rimuovi credenziali
              </button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
