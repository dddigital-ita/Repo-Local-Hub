import { Check, CircleDashed, KeyRound } from "lucide-react";

/**
 * Fase 4 — predisposizione WhatsApp: la card mostra cosa è già pronto
 * (schema, policy, adapter) e cosa manca (account Meta, token, webhook).
 * Nessun form attivo: l'attivazione è deliberatamente bloccata finché
 * l'agenzia non crea l'account WhatsApp Business Cloud.
 */
export default function WhatsappReadyCard({
  configured,
  enabled,
}: {
  /** true se esiste una riga whatsapp_config con token salvato */
  configured: boolean;
  /** true se enabled = true su DB (attivazione effettiva) */
  enabled: boolean;
}) {
  const steps = [
    { done: true, label: "Schema canale (conversations.channel, opt-in lead, credenziali cifrate)" },
    { done: true, label: "Policy canale: finestra 24h, max 4096 caratteri, niente markdown, niente follow-up fuori finestra" },
    { done: true, label: "Adapter di invio implementato (WhatsApp Cloud API) e spento di default" },
    { done: configured, label: "Credenziali Meta: phone number ID + token (da inserire quando l'account esiste)" },
    { done: enabled, label: "Canale attivo (abilitazione esplicita + webhook di ricezione)" },
  ];

  return (
    <div>
      <p className="text-sm text-slate-600">
        La predisposizione è completa: domani collegare WhatsApp Business significa creare l&apos;account
        Meta, inserire le credenziali e scrivere il webhook di ricezione — il cervello di Ambrosio non
        verrà toccato. Finché il canale resta spento, nessun credito viene speso e nessun messaggio parte.
      </p>
      <ul className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-xs leading-relaxed">
            {s.done ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
            )}
            <span className={s.done ? "text-slate-600" : "text-slate-400"}>
              {s.label}
              {s.label.startsWith("Credenziali") && <KeyRound className="ml-1 inline h-3 w-3 text-slate-300" aria-hidden />}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-xl bg-amber-50/80 p-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200/70">
        Attivazione bloccata di proposito (Fase 4 = predisposizione): quando avete l&apos;account WhatsApp
        Business Cloud, aggiungete le credenziali qui sotto e passate alla fase webhook.
      </p>
    </div>
  );
}
