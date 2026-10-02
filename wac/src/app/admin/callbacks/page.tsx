import { Fragment } from "react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { Check, PhoneCall, X } from "lucide-react";
import CallbackButtons from "@/components/callback-buttons";
import CallbackTools from "@/components/callback-tools";
import { GlassCard, GlassNotice } from "@/components/glass";
import { cn } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Ordine di richiamo: le PENDING prima (la coda da chiamare), le chiuse
 * (done/missed) in fondo come registro — l'unico ordinamento sensato è per
 * orario. Prima: `order by scheduled_at` mescolava i pending ai già
 * chiamati: un done di ieri andava sopra un pending di stanotte, e la coda
 * da chiamare non era mai «in cima» dove lo sguardo atterra.
 */
const QUEUE_SQL = `select cb.id, cb.slot_label, cb.scheduled_at, cb.status, l.name as lead_name, l.phone as lead_phone, l.temperature as lead_temperature
     from callbacks cb left join leads l on l.id = cb.lead_id
     order by (cb.status <> 'pending'), cb.scheduled_at asc limit 100`;

export default async function CallbacksPage() {
  await requireAdmin();
  const pool = db();
  if (!pool) return <p className="text-sm text-red-600">Database non configurato.</p>;

  const { rows } = await pool.query<{
    id: string;
    slot_label: string | null;
    scheduled_at: string;
    status: string;
    lead_name: string | null;
    lead_phone: string | null;
    lead_temperature: string | null;
  }>(QUEUE_SQL);

  return (
    <div className="space-y-4">
      {/* Header di pagina (pattern Panoramica/Tools): h1 text-2xl + icona +
          sottotitolo con il senso operativo della coda. */}
      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <PhoneCall className="h-6 w-6 text-brand-600" aria-hidden />
          Callback fissate
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Le richieste di richiamo fuori turno, ordinate per orario: da qui si chiama, si segna l&apos;esito e si rilascia lo slot.
        </p>
      </header>
      <div className="grid gap-3">
        {rows.map((cb, i) => {
          // Titolo «Già chiamate» alla PRIMA occorrenza di una callback chiusa:
          // l'inizio della lista resta la coda da chiamare, il registro inizia
          // dove finisce (pattern «OGGI/Ieri» della inbox — mai ripetuto a metà).
          const showRegistryHeader = i > 0 && cb.status !== "pending" && rows[i - 1].status === "pending";
          return (
          <Fragment key={cb.id}>
          {showRegistryHeader && (
            <p className="px-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Già chiamate (registro)
            </p>
          )}
          <GlassCard className="flex flex-col gap-3 md:flex-row md:items-start">
            {/* Colonna identità: titolo + RIGA DI STATO UNICA (slot + orario +
                temperatura del lead). L'emoji 📞 era l'unico glifo emoji del
                backend: le icone del design system (lucide) sono lo standard. */}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">
                {cb.lead_name ?? "Visitatore"} ·{" "}
                {cb.lead_phone ? (
                  <a href={`tel:${cb.lead_phone}`} className="text-brand-700 hover:underline">
                    {cb.lead_phone}
                  </a>
                ) : (
                  <span className="text-slate-400">numero non captato</span>
                )}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100/80 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
                  <PhoneCall className="h-3 w-3" aria-hidden />
                  {cb.slot_label ?? "slot"} · {new Date(cb.scheduled_at).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                {cb.lead_temperature && cb.lead_temperature !== "tiepido" && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      cb.lead_temperature === "caldo" ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700",
                    )}
                  >
                    lead {cb.lead_temperature}
                  </span>
                )}
              </div>
            </div>
            {/* ZONA AZIONI: sull'esito si decide in un gesto (fatto/mancato),
                il resto (richiama, elimina) sta sotto — allineata a destra
                come la colonna azioni della inbox. */}
            <div className="flex flex-col items-start gap-2 md:items-end">
              {cb.status === "pending" ? (
                <CallbackButtons callbackId={cb.id} />
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                    cb.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700",
                  )}
                >
                  {cb.status === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                  {cb.status === "done" ? "Fatto" : "Mancato"}
                </span>
              )}
              <CallbackTools callbackId={cb.id} />
            </div>
          </GlassCard>
          </Fragment>
        );
        })}
        {!rows.length && <GlassNotice>Nessuna callback: le richieste fuori turno finiscono qui.</GlassNotice>}
      </div>
    </div>
  );
}
