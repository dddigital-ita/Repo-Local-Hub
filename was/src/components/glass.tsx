import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Check, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "./ui";

/**
 * Design system "Liquid Glass" (stile Apple):
 * superfici traslucide con blur, bordo-luce sottile, ombra morbida.
 * Da usare su fondi gradient; il contenuto resta leggibile (contrasto AA).
 */

export function GlassCard({
  children,
  className,
  hover = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
} & React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        // glass-solid: niente backdrop-filter (bug Chromium sotto transform animate)
        "glass-solid rounded-3xl p-5",
        hover && "transition duration-300 hover:-translate-y-0.5 hover:shadow-glass-hover",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

const glassButtonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40 disabled:pointer-events-none";

const glassVariants = {
  primary:
    "bg-brand-600/90 text-white backdrop-blur-xl shadow-glass-btn hover:bg-brand-500/90 active:scale-[0.98]",
  glass:
    "glass text-slate-800 hover:bg-white/70 active:scale-[0.98]",
  ghost: "text-slate-600 hover:bg-white/50",
  danger:
    "bg-red-600 text-white shadow-glass-btn hover:bg-red-500 active:scale-[0.98]",
};

/* min-h per touch target ≥ 44px (WCAG 2.5.5) su tutte le dimensioni. */
const glassSizes = {
  sm: "min-h-11 px-3.5 py-1.5 text-sm",
  md: "min-h-11 px-5 py-2.5 text-sm",
  lg: "min-h-12 px-7 py-3.5 text-base",
};

interface GlassButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof glassVariants;
  size?: keyof typeof glassSizes;
}

export function GlassButton({ variant = "primary", size = "md", className, ...props }: GlassButtonProps) {
  return <button className={cn(glassButtonBase, glassVariants[variant], glassSizes[size], className)} {...props} />;
}

interface GlassLinkButtonProps extends ComponentProps<typeof Link> {
  variant?: keyof typeof glassVariants;
  size?: keyof typeof glassSizes;
}

export function GlassLinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: GlassLinkButtonProps) {
  return <Link className={cn(glassButtonBase, glassVariants[variant], glassSizes[size], className)} {...props} />;
}/** Badge pill su vetro. Il default testuale è nella classe .glass-badge
 *  (CSS: slate-700 in light, slate-200 in dark) così il colore non contende
 *  con le utility del chiamante. */
export function GlassBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "glass-badge inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/50 px-3 py-1 text-xs font-medium backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </span>
  );}

/** Badge di stato per pannelli strumenti: verde = collegato, grigio = da fare. */
export function GlassStatus({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        ok
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70"
          : // slate-600 su slate-100: 5,0:1 (slate-500 era 4,34 — sotto AA per testo 11px)
            "bg-slate-100 text-slate-600 ring-1 ring-slate-300/70",
      )}
    >
      {ok ? <Check className="h-3 w-3" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden />}
      {label}
    </span>
  );
}

/**
 * Header di sezione per i pannelli di Tools: tile-icona + titolo + sottotitolo
 * (opzionale) + area destra (CTA o badge di stato). Un solo pattern per
 * tutti i pannelli: la gerarchia della pagina si legge a colpo d'occhio.
 */
export function GlassSectionHeader({
  icon: Icon,
  tone = "bg-white/70 text-brand-700 ring-1 ring-white/70 shadow-sm",
  title,
  subtitle,
  right,
}: {
  icon: LucideIcon;
  tone?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", tone)}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * Banner di esito per le azioni dei pannelli (query string → messaggio).
 * L'icona di stato non è decorativa: chi non distingue i colori (o usa
 * uno schermo monocromatico) riconosce comunque il tipo di esito; il
 * ruolo ARIA segue il tone (alert per gli errori, status per il resto).
 */
export function GlassNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning";
  children: ReactNode;
}) {
  const tones = {
    info: { box: "bg-white/60 text-slate-700 ring-white/60", Icon: Info, iconCls: "text-slate-400" },
    success: { box: "bg-emerald-50 text-emerald-800 ring-emerald-200", Icon: CircleCheck, iconCls: "text-emerald-600" },
    warning: { box: "bg-amber-50 text-amber-800 ring-amber-200", Icon: TriangleAlert, iconCls: "text-amber-600" },
  } as const;
  const { box, Icon, iconCls } = tones[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm font-medium ring-1", box)} role={tone === "warning" ? "alert" : "status"}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconCls)} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Campo input su vetro. */
export function GlassInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-2xl border border-white/50 bg-white/50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 backdrop-blur-xl outline-none transition focus:border-brand-400/70 focus:bg-white/70",
        className,
      )}
      {...props}
    />
  );
}
