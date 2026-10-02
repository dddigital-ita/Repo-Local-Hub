/**
 * Il layout viene da una CLASSE CSS di casa con display:flex (pattern
 * .chat-emoji-searchbox in chat.css): l'elemento ospite non ha utility
 * Tailwind di layout ma è comunque sicuro. LEGALE, non segnalare.
 */
import { Search } from "lucide-react";

export function CssSearchRowOk() {
  return (
    <div className="chat-emoji-searchbox">
      <Search className="chat-emoji-search-icon" aria-hidden />
      <input
        aria-label="Cerca emoji"
        placeholder="Cerca…"
        className="chat-emoji-search-input"
      />
    </div>
  );
}
