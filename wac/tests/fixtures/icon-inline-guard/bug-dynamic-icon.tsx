/**
 * Icona dinamica locale + testo dentro un ospite NON flex: DEVE essere
 * segnalato (stessa semantica del caso lucide diretto).
 */
function BotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2Z" />
    </svg>
  );
}

export function BotRowBug() {
  return (
    <p className="text-xs font-semibold text-slate-500">
      <BotIcon className="h-3 w-3" />
      Bot
    </p>
  );
}
