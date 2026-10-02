"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ExternalLink, LoaderCircle, Power } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { saveMaintenanceSettings } from "@/app/admin/actions";
import type { MaintenanceConfig } from "@/lib/maintenance-shared";

/**
 * Pannello della modalità manutenzione (Tools → Manutenzione): switch con
 * conferma esplicita a due fasi, messaggio ai visitatori e promessa «torna
 * online». Le action server del repo restano void: l'esito vero è lo stato
 * che la pagina rilegge dal DB dopo il revalidate — il pannello non inventa
 * un esito che non ha verificato.
 */

function SubmitButton({ label, variant }: { label: string; variant: "primary" | "danger" | "glass" }) {
  const { pending } = useFormStatus();
  return (
    <GlassButton type="submit" variant={variant} disabled={pending}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
      {label}
    </GlassButton>
  );
}

export default function MaintenancePanel({ config }: { config: MaintenanceConfig }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState(config.message);
  const [backOnline, setBackOnline] = useState(config.backOnline);
  const active = config.active;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Power className="h-4 w-4" aria-hidden />
            Stato: {active ? "ATTIVA" : "spenta"}
          </p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-slate-500">
            {active
              ? "Il sito pubblico mostra la pagina di manutenzione su ogni percorso (risposta 503): admin e API restano raggiungibili e il team continua a lavorare."
              : "Il sito è regolare: nessuna pagina sostitutiva viene servita al pubblico."}
          </p>
        </div>
        {!confirming ? (
          <GlassButton type="button" variant={active ? "glass" : "danger"} onClick={() => setConfirming(true)}>
            {active ? "Spegni la manutenzione" : "Attiva la manutenzione"}
            <Power className="h-4 w-4" aria-hidden />
          </GlassButton>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 p-3">
            <p className="w-full text-xs font-medium text-amber-900 sm:hidden sm:w-auto">
              {active ? "Riporto il sito online?" : "Chiudo il sito pubblico?"}
            </p>
            <form action={saveMaintenanceSettings} className="flex items-center gap-2">
              <input type="hidden" name="active" value={String(!active)} />
              <input type="hidden" name="message" value={message} />
              <input type="hidden" name="backOnline" value={backOnline} />
              <SubmitButton
                label={active ? "Sì, torna online" : "Sì, attiva ora"}
                variant={active ? "primary" : "danger"}
              />
            </form>
            <GlassButton type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Annulla
            </GlassButton>
          </div>
        )}
      </div>

      <form action={saveMaintenanceSettings} className="space-y-4 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
        <input type="hidden" name="active" value={String(active)} />
        <div>
          <label htmlFor="m-message" className="text-sm font-medium text-slate-700">
            Messaggio mostrato ai visitatori (opzionale)
          </label>
          <textarea
            id="m-message"
            name="message"
            rows={3}
            maxLength={280}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={`Es. Stiamo pubblicando i nuovi preventivi: torniamo entro le 18.`}
            className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
          />
        </div>
        <div>
          <label htmlFor="m-back" className="text-sm font-medium text-slate-700">
            Promessa «torna online» (opzionale, max 60 caratteri)
          </label>
          <input
            id="m-back"
            name="backOnline"
            type="text"
            maxLength={60}
            value={backOnline}
            onChange={(e) => setBackOnline(e.target.value)}
            placeholder="Es. entro le 18:00"
            className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton label="Salva i testi" variant="primary" />
          <a
            href="/maintenance"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
          >
            Anteprima pagina
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          Le modifiche ai testi valgono per la pagina pubblica entro qualche secondo (cache del cancello: 15s).
          L&apos;attivazione e lo spegnimento finiscono in audit con nome e email di chi li ha fatti.
        </p>
      </form>
    </div>
  );
}
