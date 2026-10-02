"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { toggleOperatorAvailability } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Switch on/off come la sveglia di iOS: pill verde quando acceso,
 * grigio quando spento, knob bianco che scorre.
 * Stato ottimistico con richieste IN CATENA nell'ordine dei click:
 * l'ultimo click vince sempre, anche a raffica; su errore la UI si
 * riallinea ai dati reali del DB con un refresh.
 */
export default function AppleToggle({ id, on, label }: { id: string; on: boolean; label: string }) {
  const [state, setState] = useState(on);
  const [pending, setPending] = useState(false);
  const latest = useRef(on);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const reduce = useReducedMotion();
  const router = useRouter();

  function flip() {
    const next = !latest.current;
    latest.current = next;
    setState(next); // UI immediata
    const fd = new FormData();
    fd.set("id", id);
    fd.set("next", next ? "true" : "false");
    setPending(true);
    const me = next;
    chain.current = chain.current
      .then(() => toggleOperatorAvailability(fd))
      .then(() => {
        if (latest.current === me) toastSaved("operator_toggle");
      })
      .catch(() => {
        if (latest.current === me) router.refresh();
      })
      .finally(() => {
        if (latest.current === me) setPending(false);
      });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={state}
        aria-label={label}
        onClick={flip}
        className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-300 ${
          state ? "bg-[#34C759]" : "bg-slate-300/90"
        } ${pending ? "opacity-60" : ""}`}
      >
        {/* aria-hidden: lo stato è già letto da aria-checked sul bottone */}
        <motion.span
          aria-hidden
          className="absolute top-[2px] left-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
          initial={false}
          animate={{ x: state ? 22 : 0, scale: state ? 1 : 0.92 }}
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
  );
}
