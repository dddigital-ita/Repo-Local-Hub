"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Componenti client della nota una tantum (banner password temporanea).
 * - CopyNoteButton: copia negli appunti con feedback «copiato».
 * - ClaimCleanup: riscrive l'URL rimuovendo ?note= e ?email= dopo il claim,
 *   così la nota consumata non resta in cronologia né riappare al refresh.
 */

export function CopyNoteButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback legacy (http non sicuro): selezione + execCommand.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard negata: l'utente copia a mano dal <code> accanto.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-amber-300/80 transition hover:bg-white"
      aria-live="polite"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copiata" : "Copia la password"}
    </button>
  );
}

export function ClaimCleanup() {
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("note") || u.searchParams.has("email")) {
        u.searchParams.delete("note");
        u.searchParams.delete("email");
        window.history.replaceState(null, "", u.pathname + u.search);
      }
    } catch {
      // URL fuori formato: nessuna pulizia possibile, nessun danno.
    }
  }, []);
  return null;
}
