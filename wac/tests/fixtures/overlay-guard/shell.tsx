export function GlassShell({ children }) {
  return <div className="glass rounded-3xl p-4">{children}</div>;
}

export function PlainShell({ children }) {
  return <div className="plain rounded-3xl p-4">{children}</div>;
}
