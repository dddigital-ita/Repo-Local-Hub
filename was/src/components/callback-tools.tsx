"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneOutgoing, Trash2 } from "lucide-react";
import { deleteCallback, recallCallbackNow } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/** Azioni callback: "richiama ora" (mette in cima come pending) ed elimina con conferma inline. */
export default function CallbackTools({ callbackId }: { callbackId: string }) {
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  function recallNow() {
    const fd = new FormData();
    fd.set("id", callbackId);
    recallCallbackNow(fd)
      .then(() => toastSaved("callback_now"))
      .catch(() => router.refresh());
  }

  function remove() {
    const fd = new FormData();
    fd.set("id", callbackId);
    deleteCallback(fd)
      .then(() => toastSaved("callback_deleted"))
      .catch(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={recallNow}
        title="Metti in cima: da richiamare adesso"
        className="inline-flex items-center gap-1 rounded-full bg-brand-50/90 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100"
      >
        <PhoneOutgoing className="h-3 w-3" aria-hidden />
        Richiama ora
      </button>
      {confirming ? (
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={remove}
            className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-red-600"
          >
            Elimina
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900"
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          aria-label="Elimina callback"
          onClick={() => setConfirming(true)}
          className="rounded-full p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
