"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Gauge, LoaderCircle } from "lucide-react";
import { GlassButton } from "@/components/glass";
import { savePageCacheTtl } from "@/app/admin/actions";
import {
  DEFAULT_PAGE_CACHE_TTL_S,
  describePageCacheTtl,
  PAGE_CACHE_MAX_S,
  PAGE_CACHE_MIN_S,
  PAGE_CACHE_STEP_S,
  type PageCacheConfig,
} from "@/lib/page-cache-shared";

/**
 * Slider TTL cache pagine pubbliche (Tools → Prestazioni):
 * la leva «velocità» del sito. Meno secondi = contenuto
 * più fresco (ma l'origine lavora di più); più secondi =
 * la CDN serve home e landing senza chiamarci (TTFB
 * minimo). Il valore si salva nel DB e lo applica il
 * proxy: nessun redeploy, nessuna riconfigurazione CDN.
 * Le action server del repo restano void: l'esito vero è
 * lo stato che la pagina rilegge dal DB dopo il
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

export default function PageCacheTtlPanel({ config }: { config: PageCacheConfig }) {
  const [ttl, setTtl] = useState(config.ttlSeconds);
  const dirty = ttl !== config.ttlSeconds;

  return (
    <form
      action={savePageCacheTtl}
      className="space-y-4 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60"
    >
      <input type="hidden" name="ttlSeconds" value={ttl} />
      <div>
        <label
          htmlFor="pc-ttl"
          className="flex items-center gap-2 text-sm font-medium text-slate-700"
        >
          <Gauge className="h-4 w-4" aria-hidden />
          Cache delle pagine pubbliche (home e landing)
        </label>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          Per quanto tempo la CDN serve home e landing senza
          chiamare il server. Valore attuale:{" "}
          <strong className="text-slate-700">
            {describePageCacheTtl(config.ttlSeconds)}
          </strong>{" "}
          (default {DEFAULT_PAGE_CACHE_TTL_S / 60} minuti).
        </p>
        <div className="mt-3 flex items-center gap-4">
          <input
            id="pc-ttl"
            type="range"
            min={PAGE_CACHE_MIN_S}
            max={PAGE_CACHE_MAX_S}
            step={PAGE_CACHE_STEP_S}
            value={ttl}
            onChange={(e) => setTtl(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-brand-600"
            aria-describedby="pc-ttl-value"
          />
          <span
            id="pc-ttl-value"
            className="min-w-24 rounded-xl bg-white/70 px-3 py-1.5 text-center text-sm font-bold tabular-nums text-slate-900 ring-1 ring-white/60"
          >
            {describePageCacheTtl(ttl)}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          A sinistra freschezza (modifiche visibili prima, TTFB
          più alto); a destra velocità (pagine servite dalla
          cache, TTFB minimo).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton label="Salva il TTL" />
        {!dirty && (
          <span className="text-xs text-slate-400">
            Nessuna modifica: il valore salvato è già questo.
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        Il nuovo valore arriva in produzione entro ~30 secondi
        (il proxy rilegge la config). Le risposte già calde
        nella CDN scadono col TTL precedente: per rendere il
        cambio subito usa Tools → Free cache. Il salvataggio
        finisce in audit (chi, quando, vecchio → nuovo).
      </p>
    </form>
  );
}
