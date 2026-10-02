"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { purgeCacheAction } from "@/app/admin/actions";
import { CACHE_TARGETS, targetLabels, type CacheTargetId } from "@/lib/cache-shared";

/**
 * Pannello del tool Free cache (Tools → Free cache): scelta dei target
 * (tutto il sito, home, landing SEO, admin), conferma a due fasi (stesso
 * pattern della manutenzione) e motivo libero che finisce in audit.
 * Le action server del repo restano void: l'esito vero è lo stato che la
 * pagina rilegge dal server dopo il revalidate — il pannello non inventa
 * un esito che non ha verificato.
 */

function SubmitButton({ label, variant }: { label: string; variant: "primary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <GlassButton type="submit" variant={variant} disabled={pending}>
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      )}
      {label}
    </GlassButton>
  );
}

/** Pill del costo onesto di ogni target (quante pagine ricompilano). */
function CostPill({ cost }: { cost: "pesante" | "contenuto" | "trascurabile" }) {
  const tones = {
    pesante: "bg-amber-50 text-amber-800 ring-amber-200",
    contenuto: "bg-slate-100 text-slate-600 ring-slate-200",
    trascurabile: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[cost]}`}>
      {cost}
    </span>
  );
}

export default function CachePanel({ reason: initialReason }: { reason?: string }) {
  const [confirming, setConfirming] = useState(false);
  /** Selezione dell'utente: la conferma viaggia SOLO sui target scelti. */
  const [chosen, setChosen] = useState<CacheTargetId[]>([]);
  /** Il motivo digitato: la conferma lo porta in audit anche se è cambiato. */
  const [reason, setReason] = useState(initialReason ?? "");

  const toggle = (id: CacheTargetId, on: boolean) =>
    setChosen((prev) => {
      if (!on) return prev.filter((t) => t !== id);
      // "layout" esclude i singoli (copre tutto) e viceversa: una scelta sola.
      if (id === "layout") return on ? ["layout"] : prev.filter((t) => t !== "layout");
      const withoutLayout = prev.filter((t) => t !== "layout");
      return withoutLayout.includes(id) ? withoutLayout : [...withoutLayout, id];
    });

  const confirmLabel =
    chosen.length === 1 && chosen[0] === "layout"
      ? "Sì, svuota tutto"
      : `Sì, svuota: ${targetLabels(chosen) || "—"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Svuota la cache del sito
          </p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-slate-500">
            Scegli dove: tutto, o solo l&apos;area che serve. Serve dopo un cambio che non passa
            dalle action con revalidate integrata (import manuale, restore, edit diretto su DB).
          </p>
        </div>
        {!confirming ? (
          <GlassButton
            type="button"
            variant="glass"
            disabled={chosen.length === 0}
            onClick={() => setConfirming(true)}
          >
            Prepara la purga
            <RefreshCw className="h-4 w-4" aria-hidden />
          </GlassButton>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 p-3">
            <p className="w-full text-xs font-medium text-amber-900 sm:hidden sm:w-auto">
              Confermi la purga di {targetLabels(chosen).toLowerCase()}?
            </p>
            <form action={purgeCacheAction} className="flex items-center gap-2">
              {chosen.map((id) => (
                <input key={id} type="hidden" name={id} value="1" />
              ))}
              <input type="hidden" name="reason" value={reason} />
              <SubmitButton label={confirmLabel} variant="danger" />
            </form>
            <GlassButton type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Annulla
            </GlassButton>
          </div>
        )}
      </div>

      <form action={purgeCacheAction} className="space-y-4 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Dove intervenire</legend>
          {CACHE_TARGETS.map((t) => {
            const checked = chosen.includes(t.id);
            return (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1 transition ${
                  checked ? "bg-brand-50/80 ring-brand-300" : "bg-white/60 ring-white/60 hover:bg-white/85"
                }`}
              >
                <input
                  type="checkbox"
                  name={t.id}
                  value="1"
                  checked={checked}
                  onChange={(e) => toggle(t.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{t.label}</span>
                    <CostPill cost={t.cost} />
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {t.description}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <div>
          <label htmlFor="c-reason" className="text-sm font-medium text-slate-700">
            Motivo (opzionale, finisce nel registro audit)
          </label>
          <input
            id="c-reason"
            name="reason"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Es. aggiornato il listino da import manuale"
            className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton label="Svuota la cache" variant="primary" />
        </div>
        <p className="text-xs leading-relaxed text-slate-400">
          La purga paga in velocità percepita: le pagine toccate ricompilano al primo accesso dopo
          la purga — per questo i target singoli costano meno. L&apos;azione finisce in audit con
          nome, email e target scelti.
        </p>
      </form>
    </div>
  );
}
