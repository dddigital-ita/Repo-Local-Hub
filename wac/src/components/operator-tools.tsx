"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateOperatorShifts } from "@/app/admin/actions";
import { toastSaved } from "@/components/admin-toaster";

/** Editor turni inline: select "dalle" e "alle" con salvataggio immediato al cambio. */
export default function OperatorShiftEditor({
  operatorId,
  start,
  end,
}: {
  operatorId: string;
  start: number;
  end: number;
}) {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const hours = Array.from({ length: 24 }, (_, i) => i);

  function change(nextStart: number, nextEnd: number) {
    if (nextEnd <= nextStart) return; // turno non valido: ignora
    setSaving(true);
    const fd = new FormData();
    fd.set("id", operatorId);
    fd.set("start", String(nextStart));
    fd.set("end", String(nextEnd));
    updateOperatorShifts(fd)
      .then(() => toastSaved("operator_shifts"))
      .catch(() => router.refresh())
      .finally(() => setSaving(false));
  }

  const selectCls =
    "rounded-lg border border-white/60 bg-white/70 px-2 py-1 text-xs font-semibold text-slate-700 outline-none backdrop-blur-xl focus:border-brand-400";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
      Turno
      <select
        aria-label="Ora inizio turno"
        value={start}
        disabled={saving}
        onChange={(e) => change(Number(e.target.value), end)}
        className={selectCls}
      >
        {hours.map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}:00
          </option>
        ))}
      </select>
      –
      <select
        aria-label="Ora fine turno"
        value={end}
        disabled={saving}
        onChange={(e) => change(start, Number(e.target.value))}
        className={selectCls}
      >
        {hours.slice(1).concat(24).map((h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, "0")}:00
          </option>
        ))}
      </select>
    </span>
  );
}
