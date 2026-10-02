import { clsx } from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cn(...args: (string | false | null | undefined)[]) {
  return clsx(args);
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50 disabled:pointer-events-none";

const buttonVariants = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  outline: "border border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:text-brand-700",
  ghost: "text-slate-600 hover:bg-slate-100",
};

const buttonSizes = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}

interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
}

export function LinkButton({ variant = "primary", size = "md", className, ...props }: LinkButtonProps) {
  return (
    <Link
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  );
}
