"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Bot, LoaderCircle, MessageSquareDashed, StickyNote } from "lucide-react";

/**
 * Timeline messaggi del ticket. Bug risolti rispetto alla versione inline:
 * - auto-scroll in fondo solo se l'agente è già vicino al fondo (niente furto
 *   di scroll mentre sta rileggendo) + pulsante "salta ai recenti";
 * - polling leggero (4s) dei messaggi nuovi del visitatore via /api/chat/message;
 * - autorità per messaggio (chi ha risposto: tu o il collega);
 * - accessibilità: regione di log con label, date-separator, focus visibili.
 */

interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  author?: string | null;
  created_at: string;
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

/**
 * MessageBubble unico (Prompt 4): bolle asimmetriche con coda verso il
 * mittente, larghezza di lettura ~72ch, mittenti sempre distinguibili.
 * - cliente: sinistra, superficie piena chiara;
 * - agente: destra, brand tenue con testo scuro (legge Zendesk: il testo
 *   lungo si legge meglio scuro su chiaro; il blocco pieno brand stancava);
 * - bot: centrato, discreto, con etichetta.
 */
function MessageBubble({
  m,
  animate,
}: {
  m: ChatMessage;
  animate: boolean;
}) {
  const isVisitor = m.sender === "visitor";
  const isBot = m.sender === "bot";
  const isOperator = m.sender === "operator";
  return (
    <div className={`mb-1.5 flex ${isVisitor ? "justify-start" : isOperator ? "justify-end" : "justify-center"} ${animate ? "msg-in" : ""}`}>
      <div
        className={`max-w-[min(72ch,88%)] whitespace-pre-line break-words px-4 py-2 text-sm leading-relaxed ${
          isVisitor
            ? "bubble-visitor rounded-[20px] rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200/70 shadow-sm"
            : isOperator
              ? "bubble-operator rounded-[20px] rounded-br-md bg-brand-50 text-slate-900 ring-1 ring-brand-200/70"
              : "max-w-[min(72ch,92%)] rounded-2xl bg-slate-100/80 px-3.5 py-2 text-xs leading-relaxed text-slate-600" // il bot può parlare a lungo: niente pillola-stadio
        }`}
      >
        {isBot && (
          <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-slate-500">
            <Bot className="h-3 w-3" aria-hidden />
            Bot
          </span>
        )}
        {m.body}
        {isOperator ? (
          <span className="mt-0.5 block text-[10px] text-slate-500">
            {m.author ? `${m.author} · ` : ""}
            {timeLabel(m.created_at)}
          </span>
        ) : (
          !isBot && (
            <span className="mt-0.5 block text-[10px] text-slate-500">{timeLabel(m.created_at)}</span>
          )
        )}
      </div>
    </div>
  );
}

/** Skeleton di caricamento: bolle grigie animate, non un semplice spinner. */
function ChatSkeleton() {
  return (
    <div aria-hidden className="space-y-3 py-2">
      {[70, 45, 60, 38].map((w, i) => (
        <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
          <div
            className="h-10 animate-pulse rounded-[20px] bg-slate-200/60"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
      <p className="sr-only" role="status">
        <LoaderCircle className="inline h-3 w-3 animate-spin" aria-hidden /> Carico la conversazione…
      </p>
    </div>
  );
}

export default function TicketChat({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // loading parte true e viene solo SPENTO dal primo load riuscito: i polling
  // successivi non lo riaccendono (niente skeleton che lampeggia ogni 4s).
  const [loading, setLoading] = useState(true);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  // I messaggi arrivati DOPO il mount animano l'ingresso: i vecchi no,
  // così il polling ogni 4s non fa ripartire l'animazione sull'intera
  // conversazione (niente stroboscopio). Soglia = timestamp del primo load
  // riuscito, fissato UNA volta come state (mai un ref letto nel render:
  // react-hooks/refs). Dichiarata prima di `load`, che la usa nelle deps.
  const [animFrom, setAnimFrom] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/tickets/${conversationId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: { id: string; sender: string; body: string; author?: string | null; created_at: string }[];
      };
      if (Array.isArray(data.messages)) {
        if (animFrom === null && data.messages.length) {
          // Primo batch: da qui in avanti i NUOVI messaggi animano.
          setAnimFrom(Date.now());
        }
        setMessages(data.messages);
        // dopo un load batch: se l'utente era in fondo, resta in fondo
        requestAnimationFrame(() => {
          if (nearBottomRef.current) {
            const el = scrollerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }
        });
      }
    } catch {
      /* rete: riproviamo al prossimo giro */
    } finally {
      setLoading(false);
    }
  }, [conversationId, animFrom]);

  // Primo caricamento + polling periodico. Il primo giro parte in un rAF
  // (fuori dal ciclo sincrono dell'effetto: niente setState-in-effect; nessun
  // impatto pratico — l'utente non percepirà un frame di attesa). Il polling
  // ogni 4s non riaccende lo skeleton e le sue chiamate non sono setState
  // sincroni in effect, quindi la regola resta soddisfatta.
  useEffect(() => {
    const raf = requestAnimationFrame(() => void load());
    const t = setInterval(() => void load(), 4000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, [load]);

  // L'aggiunta di messaggi deve scorrere solo se l'agente non sta rileggendo
  useEffect(() => {
    if (nearBottomRef.current) {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = gap < 120;
    nearBottomRef.current = near;
    setNearBottom(near);
  }

  const rendered = useMemo(() => {
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
      const animate = animFrom !== null && new Date(m.created_at).getTime() > animFrom;
      return (
        <div key={m.id}>
          {newDay && (
            <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              {dayLabel(m.created_at)}
            </p>
          )}
          <MessageBubble m={m} animate={animate} />
        </div>
      );
    });
  }, [messages, animFrom]);

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="scroll-thin max-h-[58vh] min-h-[320px] space-y-1 overflow-y-auto rounded-3xl glass-solid p-5"
        role="log"
        aria-label={`Conversazione del ticket ${conversationId}`}
      >
        {loading ? (
          <ChatSkeleton />
        ) : (
          rendered
        )}
        {!loading && !messages.length && (
          <div className="py-10 text-center">
            <MessageSquareDashed className="mx-auto h-7 w-7 text-slate-300" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-slate-700">Conversazione ancora vuota</p>
            <p className="mx-auto mt-1 max-w-[32ch] text-xs text-slate-500">
              Il cliente non ha ancora scritto qui: appena arriva un messaggio lo vedrai in tempo reale.
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400">
              <StickyNote className="h-3 w-3" aria-hidden />
              Puoi lasciare subito una nota interna dalla colonna a destra.
            </p>
          </div>
        )}
      </div>

      {/* Salta ai messaggi recenti: appare solo quando l'agente ha scrollato su */}
      {!nearBottom && !loading && (
        <button
          type="button"
          onClick={() => {
            const el = scrollerRef.current;
            if (el) {
              el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              nearBottomRef.current = true;
              setNearBottom(true);
            }
          }}
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full glass-strong px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-glass transition hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          Vai ai messaggi recenti
        </button>
      )}
    </div>
  );
}
