"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callbackAction } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";
import { UiIcon } from "@/components/icon-registry";

/**
 * Bottoni Fatto/Mancato dei callback: disabilitano entrambi al click
 * (l'esito è definitivo) e confermano con il toast iOS al salvataggio.
 */
export default function CallbackButtons({ callbackId }: { callbackId: string }) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function pick(action: "done" | "missed") {
    if (outcome || saving) return;
    setOutcome(action); // UI immediata
    setSaving(true);
    const fd = new FormData();
    fd.set("id", callbackId);
    fd.set("action", action);
    callbackAction(fd)
      .then(() => toastSaved(action === "done" ? "callback_done" : "callback_missed"))
      .catch(() => {
        setOutcome(null); // ripristino se fallisce
        router.refresh();
      })
      .finally(() => setSaving(false));
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => pick("done")}
        disabled={!!outcome || saving}
        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-70 ${
          outcome === "done"
            ? "bg-green-500 text-white"
            : "bg-green-100 text-green-700 hover:bg-green-200"
        }`}
      >
        <UiIcon name="checkCircle" size={13} /> Fatto
      </button>
      <button
        type="button"
        onClick={() => pick("missed")}
        disabled={!!outcome || saving}
        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-70 ${
          outcome === "missed"
            ? "bg-slate-500 text-white"
            : "bg-slate-200 text-slate-600 hover:bg-slate-300"
        }`}
      >
        <UiIcon name="xCircle" size={13} /> Mancato
      </button>
    </div>
  );
}
