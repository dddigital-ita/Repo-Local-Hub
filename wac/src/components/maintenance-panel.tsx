"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, ExternalLink, LoaderCircle, Power } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { saveMaintenanceSettings } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import type { MaintenanceConfig } from "@/lib/maintenance-shared";

/**
 * Pannello della modalità manutenzione (Tools → Manutenzione):
 * switch on/off come la sveglia di iOS (pill verde quando accesa,
 * grigio quando spenta, knob che scorre), messaggio ai visitatori
 * e promessa «torna online». Lo switch è a stato ottimistico con
 * richieste IN CATENA nell'ordine dei click: l'ultimo click vince
 * sempre, anche a raffica; su errore la UI si riallinea ai dati
 * reali del DB con un refresh. Le action server del repo restano
 * void: l'esito vero è lo stato che la pagina rilegge dal DB dopo
 * il revalidate — il pannello non inventa un esito che non ha
 * verificato.
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
  const [message, setMessage] = useState(config.message);
  const [backOnline, setBackOnline] = useState(config.backOnline);
  const [active, setActive] = useState(config.active);
  const [pending, setPending] = useState(false);
  const latest = useRef(config.active);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const reduce = useReducedMotion();
  const router = useRouter();

  function flip() {
    const next = !latest.current;
    latest.current = next;
    setActive(next); // UI immediata: il cancello risponde al click, non al round-trip
    const fd = new FormData();
    fd.set("active", String(next));
    fd.set("message", message);
    fd.set("backOnline", backOnline);
    setPending(true);
    const me = next;
    chain.current = chain.current
      .then(() => saveMaintenanceSettings(fd))
      .then(() => {
        if (latest.current === me) toastSaved("maintenance_toggle");
      })
      .catch(() => {
        if (latest.current === me) router.refresh();
      })
      .finally(() => {
        if (latest.current === me) setPending(false);
      });
  }

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
        {/* Switch on/off come la sveglia di iOS: pill verde quando
            accesa, grigio quando spenta, knob bianco che scorre.
            L'attivazione è immediata (il cancello rilegge la
            config): il click è la conferma, l'esito vero lo rilegge
            la pagina dal DB dopo il salvataggio. */}
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="Manutenzione"
            onClick={flip}
            className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-300 ${
              active ? "bg-[#34C759]" : "bg-slate-300/90"
            } ${pending ? "opacity-60" : ""}`}
          >
            {/* aria-hidden: lo stato è già letto da aria-checked sul bottone */}
            <motion.span
              aria-hidden
              className="absolute top-[2px] left-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
              initial={false}
              animate={{ x: active ? 22 : 0, scale: active ? 1 : 0.92 }}
              transition={
                reduce
                  ? { duration: 0.01 }
                  : { type: "spring", stiffness: 500, damping: 32, mass: 0.9 }
              }
            />
          </button>
          {pending && (
            <span className="sr-only" role="status">
              Salvataggio…
            </span>
          )}
        </div>
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
