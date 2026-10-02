/** Converte l'etichetta slot ("Domani alle 09:00") in una data reale (ora Italia). */
export function slotToDate(slot: string, now = new Date()): Date | null {
  const m = slot.match(/^(Oggi|Domani) alle (\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(now);
  if (m[1] === "Domani") d.setDate(d.getDate() + 1);
  d.setHours(Number(m[2]), Number(m[3]), 0, 0);
  return d;
}
