"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { toastSaved } from "@/components/admin-toaster";

/**
 * Editor di testo formattabile in stile WordPress (Gutenberg/classic editor):
 * toolbar sopra il campo, tab «Visuale / Testo» in alto a destra come nel
 * classic editor, e in modalità Testo si scrive HTML a mano (tag whitelist
 * validati lato server prima dell'invio).
 *
 * Motivazione: il campo «Prima risposta» parte via SMTP al cliente —
 * la formattazione deve arrivare DAVVERO nella sua casella, quindi il
 * componente produce anche l'HTML (multipart text+html lato server).
 *
 * Tecnica: contentEditable + document.execCommand. È deprecato ma resta
 * l'unico modo senza dipendenze per avere bold/italic/list inline su
 * contentEditable, ed è ciò che usano gli editor «classici»; per i nostri
 * comandi (formato inline e blocchi) è stabile su tutti i browser in uso.
 */

/* Comandi execCommand «inline»: trasformano la selezione. */
type InlineCmd = "bold" | "italic" | "strikeThrough";

/* Tag ammessi in modalità Testo: tutto il resto viene spogliato dal
   sanitizer lato server — qui è solo aiuto alla scrittura. */
export const WP_EDITOR_ALLOWED_TAGS = [
  "strong",
  "b",
  "em",
  "i",
  "s",
  "br",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
];

const TAG_STYLE: Record<string, string> = {
  a: "color: rgb(38 83 223); text-decoration: underline;",
  code: "background: rgb(241 245 249); border-radius: 4px; padding: 1px 5px; font-family: ui-monospace, monospace; font-size: 0.9em;",
  blockquote: "border-left: 3px solid rgb(203 213 225); margin: 4px 0; padding-left: 12px; color: rgb(71 85 105);",
};

function applyTagStyle(tagName: string, el: HTMLElement) {
  const style = TAG_STYLE[tagName];
  if (style) el.setAttribute("style", style);
  if (tagName === "a") {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  }
}

/** Ripulisce l'HTML incollato (ad es. da Word) mantenendo la whitelist. */
function sanitizeFragment(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (!WP_EDITOR_ALLOWED_TAGS.includes(tag)) {
      el.replaceWith(...Array.from(el.childNodes));
      return;
    }
    // Solo attributi noti; tutto il resto via.
    const keep = tag === "a" ? ["href", "style", "target", "rel"] : ["style"];
    [...el.attributes].forEach((a) => {
      if (!keep.includes(a.name)) el.removeAttribute(a.name);
      else if (a.name === "style") el.setAttribute("style", TAG_STYLE[tag] ?? "");
    });
    if (tag === "a" && !el.getAttribute("href")) el.replaceWith(...Array.from(el.childNodes));
  });
  return clone.innerHTML;
}

/** Premetti Invio su una lista → nuovo <li>; su paragrafo → <p>. */
function ensureBlockStructure(ed: HTMLDivElement) {
  if (ed.querySelector("ul, ol, blockquote, pre")) return; // già a blocchi
  const html = ed.innerHTML;
  if (html.includes("<div")) {
    ed.innerHTML = html.replace(/<div>/g, "<p>").replace(/<\/div>/g, "</p>");
  }
}

const TOOL: { cmd?: InlineCmd; block?: "ul" | "ol" | "blockquote" | "pre"; icon: typeof Bold; label: string; title: string }[] = [
  { cmd: "bold", icon: Bold, label: "Grassetto", title: "Grassetto (⌘B)" },
  { cmd: "italic", icon: Italic, label: "Corsivo", title: "Corsivo (⌘I)" },
  { cmd: "strikeThrough", icon: Strikethrough, label: "Barrato", title: "Barrato" },
  { block: "ul", icon: List, label: "Elenco puntato", title: "Elenco puntato" },
  { block: "ol", icon: ListOrdered, label: "Elenco numerato", title: "Elenco numerato" },
  { block: "blockquote", icon: Quote, label: "Citazione", title: "Citazione" },
  { block: "pre", icon: Code, label: "Codice", title: "Blocco codice" },
];

export default function WpEditor({
  name,
  label,
  required,
  placeholder,
  maxLength: _maxLength = 20000, // doc: cap dell'editor; la validazione vera vive nel submit
  initialHtml = "",
  hint,
  /** Azione server che produce la bozza di Ambrosio (FAQ + pacchetti). */
  ambrosioDraft,
  /** Frasi preimpostate = le FAQ ufficiali: click → la risposta entra nell'editor. */
  quickFaqs = [],
  /** id dell'input Oggetto del form: il suo valore è il contesto di Ambrosio. */
  subjectInputId,
}: {
  /** Nome dell'hidden input HTML inviato col form. */
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  initialHtml?: string;
  hint?: string;
  ambrosioDraft?: (subject: string) => Promise<
    { ok: true; draft: string; provider: string } | { ok: false; error: string }
  >;
  quickFaqs?: { question: string; answer: string }[];
  subjectInputId?: string;
}) {
  const edRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [empty, setEmpty] = useState(!initialHtml);
  const [wordCount, setWordCount] = useState(0);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [ambrosioBusy, setAmbrosioBusy] = useState(false);
  const [ambrosioError, setAmbrosioError] = useState<string | null>(null);
  const [ambrosioDone, setAmbrosioDone] = useState(false);
  const [, startTransition] = useTransition();
  // L'oggetto si legge dal form al bisogno: niente ref client da un
  // server component — l'id dell'input è tutto il contratto necessario.
  function currentSubject(): string {
    return subjectInputId
      ? (document.getElementById(subjectInputId) as HTMLInputElement | null)?.value ?? ""
      : "";
  }

  /* Stato dei pulsanti inline: queryCommandState su selezione. */
  function refreshActive() {
    if (mode !== "visual") return;
    try {
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
      });
    } catch {
      /* browser senza queryCommandState: pulsanti sempre neutri */
    }
  }

  useEffect(() => {
    if (edRef.current && initialHtml) edRef.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncHidden() {
    const ed = edRef.current;
    if (!ed) return;
    const hidden = document.getElementById(`${name}-hidden`) as HTMLInputElement | null;
    // In modalità Testo l'utente sta GUARDANDO il sorgente: il valore inviato
    // è il testo grezzo del nodo (textContent = sorgente letterale, innerText
    // decodificherebbe i tag rendendoli invisibili). In Visuale è l'HTML
    // pulito dalla whitelist del client.
    const html = mode === "html" ? ed.textContent ?? "" : sanitizeFragment(ed);
    if (hidden) hidden.value = html;
    const text = ed.innerText.trim();
    setEmpty(!text);
    setWordCount(text ? text.split(/\s+/).length : 0);
  }

  /** Variante di syncHidden con formato esplicito (per i cambio tab,
   *  dove il closure vede ancora il `mode` precedente al re-render). */
  function syncHiddenAs(fmt: "visual" | "html") {
    const ed = edRef.current;
    if (!ed) return;
    const hidden = document.getElementById(`${name}-hidden`) as HTMLInputElement | null;
    const html = fmt === "html" ? ed.textContent ?? "" : sanitizeFragment(ed);
    if (hidden) hidden.value = html;
  }

  function exec(cmd: InlineCmd) {
    edRef.current?.focus();
    document.execCommand(cmd);
    refreshActive();
    syncHidden();
  }

  function execBlock(tag: "ul" | "ol") {
    edRef.current?.focus();
    document.execCommand(tag === "ul" ? "insertUnorderedList" : "insertOrderedList");
    ensureBlockStructure(edRef.current!);
    refreshActive();
    syncHidden();
  }

  function wrapBlock(tag: "blockquote" | "pre") {
    const ed = edRef.current;
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      // Nessuna selezione: avvolge il blocco sotto il cursore.
      document.execCommand("formatBlock", false, tag);
    } else {
      document.execCommand("formatBlock", false, tag);
    }
    syncHidden();
  }

  function insertLink() {
    const ed = edRef.current;
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      // Nessuna selezione: chiede l'URL e inserisce il link come testo.
      const url = window.prompt("URL del link (https://…)");
      if (!url) return;
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    } else {
      const url = window.prompt("URL del link (https://…)", "https://");
      if (!url) return;
      document.execCommand("createLink", false, url);
    }
    // Stile + target sui link appena creati.
    ed.querySelectorAll("a").forEach((a) => applyTagStyle("a", a as HTMLElement));
    syncHidden();
  }

  function undo() {
    edRef.current?.focus();
    document.execCommand("undo");
    syncHidden();
  }
  function redo() {
    edRef.current?.focus();
    document.execCommand("redo");
    syncHidden();
  }

  /* ══ AMBROSIO ══════════════════════════════════════════════════
   * L'AI dell'agenzia scrive la bozza: FAQ ufficiali + pacchetti attivi
   * (le stesse fonti del chatbot pubblico). La bozza ARRIVA nell'editor
   * come contenuto formattabile: l'agente la corregge prima di inviare.
   */
  function insertHtmlIntoEditor(html: string) {
    const ed = edRef.current;
    if (!ed) return;
    // Il testo della bozza arriva in paragrafi: pulito e formattabile.
    ed.innerHTML = html
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, "<br>").trim()}</p>`)
      .join("");
    ed.querySelectorAll(Object.keys(TAG_STYLE).join(",")).forEach((el) =>
      applyTagStyle(el.tagName.toLowerCase(), el as HTMLElement),
    );
    setEmpty(false);
    syncHidden();
  }

  function askAmbrosio() {
    if (!ambrosioDraft || ambrosioBusy) return;
    const subject = currentSubject().trim();
    if (!subject) {
      setAmbrosioError("Scrivi prima l'oggetto del ticket: è il contesto che usa Ambrosio.");
      return;
    }
    setAmbrosioError(null);
    setAmbrosioBusy(true);
    startTransition(async () => {
      try {
        const res = await ambrosioDraft(subject);
        if (res.ok) {
          insertHtmlIntoEditor(res.draft);
          setAmbrosioDone(true);
          toastSaved("ambrosio_draft");
        } else {
          setAmbrosioError(res.error);
        }
      } finally {
        setAmbrosioBusy(false);
      }
    });
  }

  function applyQuickFaq(answer: string) {
    // La risposta ufficiale entra nell'editor: punto di partenza, non copia
    // cieca — l'agente vede cosa sarà inviato e può personalizzarla.
    insertHtmlIntoEditor(answer);
    toastSaved("ambrosio_faq");
  }

  /* Da modalità Testo a Visuale: l'HTML scritto a mano diventa contenuto. */
  function switchToVisual() {
    const ed = edRef.current;
    if (!ed) return;
    // textContent (non innerText): il sorgente letterale va parseato come HTML.
    const raw = ed.textContent ?? "";
    ed.innerHTML = raw;
    ed.querySelectorAll(Object.keys(TAG_STYLE).join(",")).forEach((el) =>
      applyTagStyle(el.tagName.toLowerCase(), el as HTMLElement),
    );
    setMode("visual");
    // syncHidden dopo il re-render: `mode` nel closure di syncHidden è ancora
    // "html" fino al commit di React (setTimeout 0 gira prima), quindi si
    // passa esplicitamente il formato: qui il valore è l'HTML VISUALE pulito.
    setTimeout(() => syncHiddenAs("visual"), 0);
  }

  /* Da Visuale a Testo: mostra l'HTML pulito dalla whitelist. */
  function switchToHtml() {
    const ed = edRef.current;
    if (!ed) return;
    ed.innerText = sanitizeFragment(ed);
    setMode("html");
    // Come sopra: il formato del valore inviato cambia con la tab.
    setTimeout(() => syncHiddenAs("html"), 0);
  }

  const btn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 aria-disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600";

  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-2">
        <label htmlFor={`${name}-editor`} className="text-xs font-semibold text-slate-700">
          {label} {required && <span aria-hidden className="text-red-500">*</span>}
        </label>
        {/* Tab in stile WordPress classic editor */}
        <div role="tablist" aria-label="Modalità editor" className="flex gap-0.5 text-[11px] font-semibold">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "visual"}
            onClick={() => mode === "html" && switchToVisual()}
            className={`rounded-t-md px-2.5 py-1 transition ${
              mode === "visual" ? "bg-white text-slate-900 ring-1 ring-white/70" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Visuale
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "html"}
            onClick={() => mode === "visual" && switchToHtml()}
            className={`rounded-t-md px-2.5 py-1 transition ${
              mode === "html" ? "bg-white text-slate-900 ring-1 ring-white/70" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Testo
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/50 bg-white/70 backdrop-blur-xl focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600">
        {/* Toolbar (solo in modalità Visuale, come il classic editor) */}
        {mode === "visual" && (
          <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200/70 bg-white/60 px-1.5 py-1" role="toolbar" aria-label="Formattazione testo">
            {TOOL.map(({ cmd, block, icon: Icon, label: lbl, title }) => (
              <button
                key={lbl}
                type="button"
                title={title}
                aria-label={lbl}
                aria-pressed={cmd ? !!active[cmd] : undefined}
                onMouseDown={(e) => e.preventDefault() /* non perdere la selezione */}
                onClick={() => {
                  if (cmd) exec(cmd);
                  else if (block === "ul" || block === "ol") execBlock(block);
                  else wrapBlock(block!);
                }}
                className={`${btn} ${cmd && active[cmd] ? "bg-brand-50 text-brand-700" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </button>
            ))}
            <span aria-hidden className="mx-1 h-4 w-px bg-slate-200" />
            <button type="button" title="Inserisci/modifica link" aria-label="Inserisci o modifica link" onMouseDown={(e) => e.preventDefault()} onClick={insertLink} className={btn}>
              <Link2 className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span aria-hidden className="mx-1 h-4 w-px bg-slate-200" />
            <button type="button" title="Annulla (⌘Z)" aria-label="Annulla" onMouseDown={(e) => e.preventDefault()} onClick={undo} className={btn}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button type="button" title="Ripeti (⌘⇧Z)" aria-label="Ripeti" onMouseDown={(e) => e.preventDefault()} onClick={redo} className={btn}>
              <Redo2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        <div
          id={`${name}-editor`}
          ref={edRef}
          contentEditable={mode === "visual"}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder}
          onInput={() => {
            // Il closure di syncHidden legge `mode` dal render corrente:
            // dopo un cambio tab è già aggiornato (onInput scatta su eventi
            // successivi al commit React). OK per la digitazione.
            syncHidden();
            refreshActive();
          }}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onBlur={syncHidden}
          onPaste={(e) => {
            // Incolla come testo piano quando si incolla HTML estraneo:
            // la whitelist la applichiamo comunque, ma il piatto è più prevedibile.
            if (e.clipboardData.types.includes("text/html")) {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              document.execCommand("insertText", false, text);
            }
          }}
          className={`wp-editor min-h-[180px] w-full px-3.5 py-3 text-sm leading-relaxed text-slate-900 outline-none ${
            mode === "html" ? "font-mono text-[13px]" : ""
          } ${empty && mode === "visual" ? "wp-editor-empty" : ""}`}
        >
          {mode === "html" ? null : undefined}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <p>{hint ?? "Grassetto, elenchi e link arrivano formattati nell'email del cliente."}</p>
        <p aria-live="polite" className="tabular-nums">
          {wordCount} {wordCount === 1 ? "parola" : "parole"}
        </p>
      </div>

      {/* ══ AMBROSIO TI PROPONE ══════════════════════════════════
          Frasi preimpostate = risposte ufficiali (FAQ) + bozza generata
          dal contesto del ticket. Tutto entra NELL'EDITOR: l'agente
          vede e corregge quello che sarà inviato. */}
      {(ambrosioDraft || quickFaqs.length > 0) && (
        <div className="rounded-xl border border-brand-200/60 bg-brand-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-800">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Ambrosio ti propone
            </p>
            {ambrosioDraft && (
              <button
                type="button"
                onClick={askAmbrosio}
                disabled={ambrosioBusy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-600/90 px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-glass-btn transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
              >
                <Sparkles className={`h-3.5 w-3.5 ${ambrosioBusy ? "animate-pulse" : ""}`} aria-hidden />
                {ambrosioBusy ? "Ambrosio scrive…" : ambrosioDone ? "Riscrivi con Ambrosio" : "Fai scrivere Ambrosio"}
              </button>
            )}
          </div>
          {ambrosioError && (
            <p role="alert" className="mt-2 text-[11px] font-medium text-red-700">{ambrosioError}</p>
          )}
          {quickFaqs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickFaqs.map((f) => (
                <button
                  key={f.question}
                  type="button"
                  title={`Inserisci la risposta ufficiale: ${f.answer.slice(0, 90)}…`}
                  onClick={() => applyQuickFaq(f.answer)}
                  className="max-w-full truncate rounded-full border border-brand-200/70 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-brand-800 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  {f.question}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            La bozza entra nell&apos;editor: rileggila e correggila prima di inviare.
          </p>
        </div>
      )}

      {/* Il valore che arriva alla server action */}
      <input type="hidden" id={`${name}-hidden`} name={name} defaultValue={initialHtml} />
    </div>
  );
}
