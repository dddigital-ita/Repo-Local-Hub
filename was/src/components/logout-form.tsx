"use client";

import { useEffect } from "react";
import { logoutAction } from "@/app/admin/actions";

/**
 * Form di logout (POST → server action) auto-inviato al mount: chi arriva
 * sulla pagina /admin/logout vuole uscire, non leggere. Il GET della pagina
 * NON fa nulla di permanente — è il POST a cancellare la sessione — quindi
 * il prefetch automatico di Next sui link verso questa pagina è innocuo.
 *
 * Il bottone resta per chi naviga senza JS (e per i test che vogliono il
 * percorso manuale): stesso flusso POST della nav.
 */
export default function LogoutForm() {
  useEffect(() => {
    (document.getElementById("logout-form") as HTMLFormElement | null)?.requestSubmit();
  }, []);

  return (
    <form id="logout-form" action={logoutAction} className="mt-8">
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/60 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white/85 hover:text-brand-700"
      >
        Conferma uscita
      </button>
    </form>
  );
}
