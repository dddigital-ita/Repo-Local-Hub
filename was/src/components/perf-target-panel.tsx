"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Gauge, LoaderCircle } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { HubStatus } from "@/components/settings-hub";
import { savePerfTarget } from "@/app/admin/actions";
import {
  deltaPercent,
  formattaMs,
  sogliaTone,
  PERF_MIN_CAMPIONI,
  type PaginaPerf,
} from "@/lib/admin-perf";
import {
  PERF_TARGET_MAX_MS,
  PERF_TARGET_MIN_MS,
  PERF_TARGET_STEP_MS,
  describePerfTargetMs,
  type PerfTargetConfig,
} from "@/lib/perf-target-shared";

/**
 * Cursore del target di risposta (Tools → Velocità): la soglia
 * verde della scheda. Meno ms = il verde è esigente (più pagine
 * vanno in ambra/rosso); più ms = il piano perdona. Muovendo il
 * cursore le barre e le pill qui sotto si ricolorano AL MOMENTO —
 * il feedback è istantaneo, il salvaggio (DB + audit) è del
 * pulsante. Stessa architettura del TTL cache: modulo puro
 * (perf-target-shared), store di lettura, action dietro
 * requireAdmin. Le action server del repo restano void: l'esito
 * vero è lo stato che la pagina rilegge dal DB dopo il
 * revalidate — il pannello non inventa un esito.
 */

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <GlassButton type="submit" variant="primary" disabled={pending}>
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 className="h-4 w-4" aria-hidden />
      )}
      {label}
    </GlassButton>
  );
}

/** Il Δ percentuale con la sua firma (negativo = più veloce di prima). */
function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-xs text-slate-400">—</span>;
  const meglio = delta <= 0;
  return (
    <span
      className={`text-xs font-semibold tabular-nums ${
        meglio ? "text-green-700" : "text-red-600"
      }`}
    >
      {delta > 0 ? "+" : ""}
      {delta}%
    </span>
  );
}

/** La colonna di un periodo: mediana + quanta storia c'è dietro. */
function Cell({
  p,
  label,
}: {
  p: { p50: number; p95: number; worst: number; n: number } | null;
  label: string;
}) {
  if (!p) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm font-semibold text-slate-900 tabular-nums">{formattaMs(p.p50)}</span>
      <span className="text-[10px] text-slate-400">
        {label} · p95 {formattaMs(p.p95)} · n={p.n}
      </span>
    </span>
  );
}

export default function PerfTargetPanel({
  pagine,
  config,
}: {
  pagine: PaginaPerf[];
  config: PerfTargetConfig;
}) {
  const [targetMs, setTargetMs] = useState(config.targetMs);
  const dirty = targetMs !== config.targetMs;

  return (
    <div className="mt-4 space-y-4">
      {/* Il cursore: la soglia verde si sposta e le barre si
          colorano mentre lo muovi — il click su «Salva» la
          rende definitiva (DB + audit). */}
      <form
        action={savePerfTarget}
        className="space-y-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60"
      >
        <input type="hidden" name="targetMs" value={targetMs} />
        <div>
          <label
            htmlFor="perf-target"
            className="flex items-center gap-2 text-sm font-medium text-slate-700"
          >
            <Gauge className="h-4 w-4" aria-hidden />
            Target di risposta (soglia verde)
          </label>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Mediana di rendering sotto questo valore = «veloce».
            Valore attuale:{" "}
            <strong className="text-slate-700">
              {describePerfTargetMs(config.targetMs)}
            </strong>
            .
          </p>
          <div className="mt-3 flex items-center gap-4">
            <input
              id="perf-target"
              type="range"
              min={PERF_TARGET_MIN_MS}
              max={PERF_TARGET_MAX_MS}
              step={PERF_TARGET_STEP_MS}
              value={targetMs}
              onChange={(e) => setTargetMs(Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-brand-600"
              aria-describedby="perf-target-value"
            />
            <span
              id="perf-target-value"
              className="min-w-24 rounded-xl bg-white/70 px-3 py-1.5 text-center text-sm font-bold tabular-nums text-slate-900 ring-1 ring-white/60"
            >
              {describePerfTargetMs(targetMs)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            A sinistra il verde è esigente (più pagine vanno in
            ambra e rosso); a destra il piano perdona. Le barre qui
            sotto si ricolorano mentre sposti il cursore: il
            salvataggio finisce in audit (chi, quando, vecchio →
            nuovo).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton label="Salva il target" />
          {!dirty && (
            <span className="text-xs text-slate-400">
              Nessuna modifica: il valore salvato è già questo.
            </span>
          )}
        </div>
      </form>

      {/* Legenda di lettura: il target è VIVO — lo legge dal
          cursore, non dal piano. */}
      <p className="text-xs text-slate-500">
        Mediana dei tempi di rendering lato server. Verde = dentro il
        target ({describePerfTargetMs(targetMs)}); sotto{" "}
        {PERF_MIN_CAMPIONI} campioni la colonna è orientativa.
      </p>

      {pagine.length === 0 && (
        <p className="rounded-xl bg-white/60 p-4 text-sm text-slate-600 ring-1 ring-white/60">
          Nessun evento «admin.render» nell&apos;audit: naviga le pagine
          dell&apos;admin e torna — la storia si scrive da sola, una riga per
          caricamento.
        </p>
      )}

      {/* Le pagine in ordine di ultima navigazione: la fresca in
          cima. Il tono della pill segue il cursore: è IL colore
          della scheda a inseguire il target, non il contrario. */}
      {pagine.map((p) => {
        const tone = p.dopo ? sogliaTone(p.dopo.p50, targetMs) : null;
        const pochi = p.dopo !== null && p.dopo.n < PERF_MIN_CAMPIONI;
        return (
          <div
            key={p.path}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/55 p-3 ring-1 ring-white/60"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900">{p.path}</span>
              <span className="mt-0.5 block text-[10px] text-slate-400">
                ultima navigazione: {new Date(p.ultimo).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {pochi && " · pochi campioni"}
              </span>
            </span>
            <span className="flex items-center gap-4 sm:gap-6">
              <Cell p={p.prima} label="prima" />
              <span className="inline-flex flex-col items-start">
                {p.dopo && tone ? (
                  <>
                    <HubStatus
                      ok={tone === "ok"}
                      warn={tone === "warn"}
                      label={formattaMs(p.dopo.p50)}
                    />
                    <span className="mt-0.5 text-[10px] text-slate-400">
                      dopo · p95 {formattaMs(p.dopo.p95)}
                    </span>
                  </>
                ) : (
                  <Cell p={null} label="dopo" />
                )}
              </span>
              <Delta delta={deltaPercent(p.prima, p.dopo)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
