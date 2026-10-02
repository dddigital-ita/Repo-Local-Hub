/**
 * Icona dinamica locale (`<Icon className="h-…">` dove Icon è una const
 * del modulo che ritorna un <svg>) accanto a testo dentro un host flex:
 * LEGALE, non segnalare. Copre il pattern dei loop di card e del registry.
 */
import { Download } from "lucide-react";

function DownloadIcon({ className }: { className?: string }) {
  return <Download className={className} aria-hidden />;
}

export function CardRowOk() {
  return (
    <div className="flex items-center gap-2">
      <DownloadIcon className="h-4 w-4 text-slate-500" />
      Export CSV
    </div>
  );
}
