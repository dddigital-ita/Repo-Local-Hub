import { CheckCircle2, Cloud, ExternalLink, KeyRound, Trash2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getOneDriveConfig } from "@/lib/onedrive";
import { saveOneDriveAction, testOneDriveAction } from "@/app/admin/actions";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: 1,
    title: "Registra l'app in Microsoft Entra ID",
    text: "entra.microsoft.com → Microsoft Entra ID → Registrazioni app → Nuova registrazione: nome «webagency-onedrive», tipo «Account in questa directory organizzativa». Alla fine copierai l'ID applicazione (client).",
    link: { href: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps", label: "Apri le registrazioni app" },
  },
  {
    n: 2,
    title: "Crea il segreto client",
    text: "Nella registrazione → Certificati e segreti → Nuovo segreto client: copia il VALORE appena appare (visibile una volta sola). È il terzo campo qui sotto.",
  },
  {
    n: 3,
    title: "Dai i permessi a Microsoft Graph",
    text: "API → Aggiungi permesso → Microsoft Graph → Permessi applicazione → Files.Read.All (Files.ReadWrite.All quando serviranno gli upload) → poi «Concedi consenso amministrativo»: senza il consenso il test torna 401/403 anche con tutto il resto giusto.",
    link: { href: "https://entra.microsoft.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps", label: "Apri le registrazioni app" },
  },
  {
    n: 4,
    title: "Trova l'ID tenant e prova",
    text: "Microsoft Entra ID → Panoramica → ID tenant. Incolla qui ID tenant + ID applicazione + segreto, salva, poi «Prova connessione»: il test chiede un token a login.microsoftonline.com e legge la libreria del sito root via Graph — fallisce se l'app non ha permessi o il consenso manca.",
  },
];

export default async function OneDrivePage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  await requireAdmin();
  const { test } = await searchParams;
  const config = await getOneDriveConfig();

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
        Icon={Cloud}
        title="OneDrive — la libreria documenti dell'agenzia"
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
          {test.startsWith("ERRORE") && " — i dettagli completi sono nel Log di audit (azione «Test OneDrive»)."}
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
            App salvata:
            <code className="rounded-lg bg-white/70 px-2 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-white/60">
              tenant {config.tenantId ?? "—"} · client {config.clientId ?? "—"}
            </code>
            <span className="text-slate-400">· segreto cifrato AES-256-GCM, mai rispedito al browser</span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Nessuna app collegata: segui i 4 passi qui sopra, poi incolla i tre valori qui sotto.
          </p>
        )}
        <form action={saveOneDriveAction} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-500">
              ID tenant (GUID o dominio, es. contoso.onmicrosoft.com)
              <input
                name="tenantId"
                autoComplete="off"
                spellCheck={false}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 font-mono text-xs text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-400 focus:border-brand-400"
              />
            </label>
            <label className="block text-xs font-medium text-slate-500">
              ID applicazione (client)
              <input
                name="clientId"
                autoComplete="off"
                spellCheck={false}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="mt-1 w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 font-mono text-xs text-slate-800 outline-none backdrop-blur-xl placeholder:text-slate-400 focus:border-brand-400"
              />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-500">
            Segreto client
            <input
              name="clientSecret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="valore copiato da Certificati e segreti (visibile una volta sola)"
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
          <form action={testOneDriveAction}>
            <button className="rounded-full border border-white/50 bg-white/60 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white/90">
              Prova connessione
            </button>
          </form>
          {config.hasCreds && (
            <form action={saveOneDriveAction}>
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
