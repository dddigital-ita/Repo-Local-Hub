import { createPortal } from "react-dom";

/** Stesso JSX del bug, ma montato via createPortal: deve essere esente. */
export default function PortaledFixed() {
  return createPortal(<div className="fixed inset-0 z-50">ok</div>, document.body);
}
