const cn = (...parts) => parts.filter(Boolean).join(" ");

/** La superficie glass nasce da un literal dentro cn(): deve essere vista. */
export function GlassCn({ children }) {
  return <div className={cn("glass p-4", children && "extra")}>{children}</div>;
}

/** E l'overlay dentro, con classe composta: pure questo deve essere visto. */
export function InnerCnFixed() {
  return <div className={cn("fixed inset-0", "z-50")}>bug</div>;
}
