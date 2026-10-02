import type { Metadata } from "next";
import Link from "next/link";
import { Construction } from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import MaintenancePanel from "@/components/maintenance-panel";
import { requireAdmin } from "@/lib/admin";
import { readMaintenanceConfig } from "@/lib/maintenance-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manutenzione · Admin", robots: { index: false } };

/** Tools → Manutenzione: il cancello sta nel proxy, qui si comanda. */
export default async function ManutenzionePage() {
  await requireAdmin();
  const config = await readMaintenanceConfig();

  return (
    <div className="space-y-6">
      <Card>
        <GlassSectionHeader
          icon={Construction}
          title="Modalità manutenzione"
          subtitle="Chiudi con garbo il sito pubblico: una pagina pulita con logo, contatti e CTA resta aperta."
        />

        <div className="mt-4 space-y-3 rounded-2xl bg-white/50 p-4 text-sm leading-relaxed text-slate-600">
          <p>
            <strong>Cosa succede quando è attiva:</strong> ogni percorso pubblico risponde con la pagina di
            manutenzione e un codice <code className="rounded bg-slate-100 px-1 text-xs">503</code> (i motori di
            ricerca capiscono «torna presto» e non deindicizzano). L&apos;admin e le API non passano dal cancello:
            il team continua a lavorare normalmente.
          </p>
          <p>
            <strong>Nessuna dipendenza:</strong> la pagina non carica chat, banner cookie o analytics —
            &egrave; servita dal cancello come HTML autonomo, quindi funziona anche se il resto del sito ha un problema.
          </p>
          <p>
            L&apos;anteprima React della pagina vive in{" "}
            <Link href="/maintenance" className="font-semibold text-brand-700 hover:underline">
              /maintenance
            </Link>
            . Per modificare i testi usa i campi qui sotto: valgono per la pagina pubblica entro ~15 secondi.
          </p>
        </div>

        <div className="mt-6">
          <MaintenancePanel config={config} />
        </div>
      </Card>
    </div>
  );
}
