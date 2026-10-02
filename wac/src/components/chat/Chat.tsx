"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Phone, MessageCircle, Search, Sparkles, Smile } from "lucide-react";
import {
  EmojiPicker as FrimousseEmojiPicker,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";
import { chatEmojiData } from "./chat-emoji-data";
import {
  detectEdgeCase,
  getGreeting,
  getOnDutyStatusLine,
  getCallbackSlots,
  MAX_REASK,
  reaskFallback,
  STEPS,
  STEP_ORDER,
  type ChatContext,
  type LeadData,
  type Operator,
} from "@/lib/chat-script";
import { trackEvent } from "@/lib/ga";
import { site, type TeamCard } from "@/lib/site";
import { cn } from "../ui";

interface Msg {
  sender: "visitor" | "ai" | "system";
  body: string;
  ts: number;
  fromAmbrosio?: boolean;
}

interface ServerStatus {
  conversationId: string | null;
  onDuty: { firstName: string; phone: string; whatsapp?: string; shiftEnd: number } | null;
  nextShiftLabel: string;
  greeting: string;
  statusLine: string;
  callbackSlots: string[];
  aiAvailable?: boolean;
}

type Phase = "searching" | "chat" | "done";

/** Statocline di fallback se il server non risponde (turni dei default). */
function localCtx(operators: Operator[], query: string): ChatContext {
  return {
    agencyName: site.name,
    query,
    operators,
    now: new Date(),
    privacyUrl: "/privacy-policy",
  };
}

/** Posizione dell'avatar nello split Telegram: iniziale a sinistra, poi destra. */
function senderInitial(name: string | null): string {
  return (name?.trim()?.[0] ?? "A").toUpperCase();
}
/** Senza nome il visitatore è «Ospite», non «A» come l'agente. */
function visitorInitial(name: string | null): string {
  return (name?.trim()?.[0] ?? "O").toUpperCase();
}

/** Set predefinito del picker: vale quando l'admin non ha salvato un set proprio
 *  (prop assente) o la pagina ha degradato senza DB (prop undefined). Sync con
 *  CHAT_EMOJIS_DEFAULT in lib/tickets.ts — guardato dai test di sentinella. */
const DEFAULT_EMOJIS = [
  "😀", "😄", "😉", "😍", "🤩", "😎", "🤝", "👍", "👏", "🙏",
  "🔥", "✨", "💡", "🚀", "🎯", "💶", "📞", "💬", "✅", "❤️",
];

export default function Chat({
  query,
  sourcePage,
  team,
  emojis,
}: {
  query: string;
  sourcePage: string;
  team: TeamCard[];
  /** Set dell'admin da /admin/settings/emoji-chat; undefined = default. */
  emojis?: string[];
}) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("searching");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [reaskCount, setReaskCount] = useState(0);
  const [lead, setLead] = useState<LeadData>({});
  const [input, setInput] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [submittingLead, setSubmittingLead] = useState(false);
  const [callbackBooked, setCallbackBooked] = useState<string | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiFor, setEmojiFor] = useState<"script" | "ai">("script");

  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationId = useRef<string | null>(null);
  const lastOperatorMsgId = useRef<string | null>(null);
  const leadRef = useRef<LeadData>({});
  // Honeypot Shield: invisibile per le persone, i bot lo riempiono e vengono filtrati
  const honeypotRef = useRef<string>("");
  // Mirror dei ref in effect (mai in render, regola react-hooks/refs): i valori
  // sono letti solo da callback asincrone, il giro di ritardo è irrilevante.
  useEffect(() => {
    leadRef.current = lead;
  }, [lead]);
  const onDutyRef = useRef<boolean>(false);
  useEffect(() => {
    onDutyRef.current = Boolean(status?.onDuty);
  }, [status?.onDuty]);

  // ── Splash "Sto cercando…" 2s, poi la chat si apre da sola ──
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("chat");
      trackEvent("chat_start", { search_term: query, source_page: sourcePage });
    }, 2000);
    return () => clearTimeout(t);
  }, [query, sourcePage]);

  // ── Init server: conversazione + operatori reali + saluto ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initOnce = (tk: string | null) =>
          fetch("/api/chat/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, sourcePage, turnstileToken: tk }),
          });
        let res = await initOnce(await window.wacTurnstile?.readyWithTimeout?.() ?? null);
        if (res.status === 403) {
          // token non ancora pronto (script lazy): riprova una volta
          await new Promise((r) => setTimeout(r, 1200));
          res = await initOnce(await window.wacTurnstile?.readyWithTimeout?.() ?? null);
        }
        const data = (await res.json()) as ServerStatus;
        if (cancelled) return;
        conversationId.current = data.conversationId;
        setStatus(data);
        setTyping(true);
        setTimeout(() => {
          if (cancelled) return;
          setTyping(false);
          setMessages((m) => [
            ...m,
            { sender: "ai", body: data.greeting, ts: Date.now() },
          ]);
        }, 900);
      } catch {
        if (cancelled) return;
        // Fallback offline: script uguale, salvataggio rimandato. Senza
        // conversazione persistita Ambrosio NON si attiva (aiAvailable false):
        // le sue risposte finirebbero in una sessione che il team non vede mai.
        const ctx = localCtx([], query);
        setStatus({
          conversationId: null,
          onDuty: null,
          nextShiftLabel: "",
          greeting: getGreeting(ctx),
          statusLine: getOnDutyStatusLine(ctx),
          callbackSlots: getCallbackSlots(ctx),
          aiAvailable: false,
        });
        setTyping(true);
        setTimeout(() => {
          if (cancelled) return;
          setTyping(false);
          setMessages((m) => [...m, { sender: "ai", body: getGreeting(ctx), ts: Date.now() }]);
        }, 900);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, sourcePage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  // ── Take-over: polling dei messaggi dell'operatore (ogni 3s) ──
  useEffect(() => {
    if (phase === "searching") return;
    const timer = setInterval(async () => {
      const cid = conversationId.current;
      if (!cid) return;
      try {
        const res = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: cid, sender: "system", body: "__poll__", afterId: lastOperatorMsgId.current }),
        });
        const data = await res.json();
        if (Array.isArray(data.operatorMessages) && data.operatorMessages.length) {
          for (const m of data.operatorMessages) {
            lastOperatorMsgId.current = m.id;
            setMessages((prev) => [...prev, { sender: "ai", body: m.body, ts: new Date(m.created_at).getTime() }]);
          }
        }
      } catch {
        /* offline: riproviamo al prossimo giro */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [phase]);

  /** Ambrosio: risposta AI in tempo reale quando il team è offline. */
  const aiBusy = useRef(false);
  const askAmbrosio = useCallback(
    async (question: string) => {
      if (aiBusy.current) return; // una domanda per volta
      aiBusy.current = true;
      setAiThinking(true);
      try {
        const res = await fetch("/api/chat/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversationId.current,
            question,
            context: Object.fromEntries(
              Object.entries(leadRef.current).filter(([, v]) => Boolean(v)),
            ) as Record<string, string>,
          }),
        });
        const data = (await res.json()) as { ok: boolean; reply?: string };
        if (data.ok && data.reply) {
          setMessages((m) => [
            ...m,
            { sender: "ai", body: data.reply as string, ts: Date.now(), fromAmbrosio: true },
          ]);
        } else {
          setMessages((m) => [
            ...m,
            {
              sender: "ai",
              body: "Ti risponde una persona vera appena riapriamo: lascia il numero qua sotto e ti richiamiamo 👇",
              ts: Date.now(),
            },
          ]);
        }
      } catch {
        setMessages((m) => [
          ...m,
          {
            sender: "ai",
            body: "Connessione lenta: per parlarne subito scrivici su WhatsApp 👇",
            ts: Date.now(),
          },
        ]);
      } finally {
        aiBusy.current = false;
        setAiThinking(false);
      }
    },
    [],
  );

  const pushAi = useCallback((body: string, delay = 700) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { sender: "ai", body, ts: Date.now() }]);
    }, delay);
  }, []);

  /** Persistenza best-effort del messaggio visitatore. */
  const persistMessage = useCallback((body: string) => {
    const cid = conversationId.current;
    if (!cid) return;
    fetch("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: cid, sender: "visitor", body }),
    }).catch(() => {});
  }, []);

  // ── Invio risposta dello step corrente ──
  const handleAnswer = useCallback(
    (raw: string) => {
      const answer = raw.trim();
      if (!answer) return;
      const currentStep = STEPS[STEP_ORDER[stepIdx]];
      if (!currentStep) return;

      setMessages((m) => [...m, { sender: "visitor", body: answer, ts: Date.now() }]);
      persistMessage(answer);
      setInput("");

      // 1. Edge case (prezzi, tempi, umano…): fuori turno li gestisce Ambrosio,
      //    se attiva — di notte uno script fisso non basta a una domanda vera.
      const edge = detectEdgeCase(answer);
      const edgeToAi = Boolean(edge && status?.aiAvailable && !onDutyRef.current);
      if (edge && !edgeToAi) {
        const ctx = localCtx([], query);
        pushAi(edge.reply(ctx, leadRef.current));
        if (edge.markHot) setLead((l) => ({ ...l, hot: true }));
        return;
      }

      // 2. Testo libero su step a bottoni: la risposta non è tra le opzioni.
      //    Team offline + Ambrosio attiva → risponde l'AI; altrimenti replay soft.
      if (currentStep.input === "buttons") {
        const isButtonValue = currentStep.buttons?.some((b) => b.value === answer) ?? false;
        if (!isButtonValue && status?.aiAvailable && !onDutyRef.current) {
          void askAmbrosio(answer);
          return;
        }
      }

      // 3. Validazione dello step
      const valid = currentStep.validate ? currentStep.validate(answer) : true;
      if (valid !== true) {
        if (reaskCount + 1 >= MAX_REASK) {
          setReaskCount(0);
          pushAi(reaskFallback(localCtx([], query)), 600);
          // via umana: mostra azioni anche senza lead completo
          return;
        }
        // Testo libero fuori script + team offline + AI attiva → Ambrosio risponde
        if (status?.aiAvailable && !onDutyRef.current) {
          void askAmbrosio(answer);
          return;
        }
        setReaskCount((c) => c + 1);
        pushAi(valid, 600);
        return;
      }

      setReaskCount(0);
      const nextLead = { ...leadRef.current, [currentStep.saveAs]: answer };
      setLead(nextLead);
      const nextIdx = stepIdx + 1;
      setStepIdx(nextIdx);

      const nextStep = STEP_ORDER[nextIdx] ? STEPS[STEP_ORDER[nextIdx]] : null;
      if (nextStep) {
        pushAi(nextStep.question(localCtx([], query), nextLead));
      }
    },
    [stepIdx, reaskCount, pushAi, persistMessage, query, status?.aiAvailable, askAmbrosio],
  );

  // ── Consenso → salvataggio lead → chiusura ──
  const handleConsent = useCallback(async () => {
    if (!consentChecked) return;
    const finalLead = { ...leadRef.current, consent: true };
    setLead(finalLead);
    setMessages((m) => [
      ...m,
      { sender: "visitor", body: "✅ Acconsento al trattamento dei miei dati", ts: Date.now() },
    ]);
    setSubmittingLead(true);
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId.current,
          lead: finalLead,
          query,
          sourcePage,
          website_url: honeypotRef.current,
          turnstileToken: await (window.wacTurnstile?.reset(), window.wacTurnstile?.readyWithTimeout?.()) ?? null,
        }),
      });
      const data = await res.json();
      setStatus((s) =>
        s
          ? {
              ...s,
              onDuty: data.onDuty ?? s.onDuty,
              nextShiftLabel: data.nextShiftLabel ?? s.nextShiftLabel,
              callbackSlots: data.callbackSlots ?? s.callbackSlots,
            }
          : s,
      );
      trackEvent("lead_captured", {
        service: finalLead.service,
        budget: finalLead.budget,
        urgency: finalLead.urgency,
        operator_on_duty: Boolean(data.onDuty),
        search_term: query,
        source_page: sourcePage,
      });
      setPhase("done");
      setSubmittingLead(false);
      pushAi(data.closing as string, 600);
    } catch {
      setSubmittingLead(false);
      pushAi(
        "Ho avuto un problema tecnico nel salvare i dati 😓 Puoi chiamarci direttamente: risponde il team 👇",
        400,
      );
      setPhase("done");
    }
  }, [consentChecked, pushAi, query, sourcePage]);

  // ── Callback booking ──
  const bookCallback = useCallback(
    async (slot: string) => {
      setCallbackBooked(slot);
      trackEvent("callback_booked", { slot, search_term: query, source_page: sourcePage });
      pushAi(`Perfetto: ti chiamiamo ${slot.toLowerCase()}. A dopo!`, 500);
      const cid = conversationId.current;
      const phone = leadRef.current.phone;
      if (cid || phone) {
        fetch("/api/callback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: cid, slot, phone, query, sourcePage, website_url: honeypotRef.current }),
        }).catch(() => {});
      }
    },
    [pushAi, query, sourcePage],
  );

  // ── Composer: input + emoji picker ──
  const composerRef = useRef<HTMLInputElement>(null);
  const onDutyNow = status?.onDuty ?? null;
  /** Nome dell'agente dal turno: la chat usa solo firstName, il team l'elenco completo. */
  const dutyAgent = team.find((t) => onDutyNow && t.name.startsWith(onDutyNow.firstName)) ?? null;
  const agentInitial = senderInitial(onDutyNow?.firstName ?? null);
  const agentPhoto = dutyAgent?.photo ?? null;
  const visitorName: string | null = lead.name?.trim() ?? null;
  const visitorInitialChar = visitorInitial(visitorName);

  /** Inserisce l'emoji nel composer da cui il picker è stato aperto. */
  const insertEmoji = useCallback(
    (emoji: string) => {
      if (emojiFor === "ai") {
        setAiInput((prev) => `${prev}${emoji}`);
      } else {
        setInput((prev) => `${prev}${emoji}`);
      }
      setEmojiOpen(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [emojiFor],
  );

  const currentStep = STEP_ORDER[stepIdx] ? STEPS[STEP_ORDER[stepIdx]] : null;
  /** Set del picker: quello dell'admin se c'è e non è vuoto, altrimenti il default. */
  const pickerEmojis = emojis?.length ? emojis : DEFAULT_EMOJIS;
  const showButtons =
    phase === "chat" && currentStep?.input === "buttons" && !typing;
  const showConsent = phase === "chat" && currentStep?.input === "consent" && !typing;
  const showTextInput =
    phase === "chat" &&
    !typing &&
    (currentStep?.input === "text" || currentStep?.input === "buttons");
  const done = phase === "done";
  const onDuty = status?.onDuty ?? null;
  // Team offline + AI attiva: solo a qualificazione FINITA (o chat già aperta con lei)
  // per non mettere due composer sullo schermo durante lo script.
  const aiFreeMode = Boolean(status?.aiAvailable) && !onDuty && done;

  const aiMsgCount = messages.filter((m) => m.sender === "ai").length;
  const isAmbrosioAvatar = (m: Msg) =>
    Boolean(m.fromAmbrosio) || (!onDuty && m.sender === "ai" && aiMsgCount > 1);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white md:min-h-0">
      {/* Stato turno: sempre visibile */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="glass mx-4 mt-4 rounded-full px-4 py-2 text-center text-xs text-slate-600 md:mx-6"
      >
        {status ? status.statusLine : "…"}
      </motion.div>

      {/* Splash ricerca */}
      <AnimatePresence mode="wait">
        {phase === "searching" && (
          <motion.div
            key="searching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-1 flex-col items-center justify-center px-6 py-16"
          >
            <motion.p
              className="text-lg font-medium text-slate-700"
              initial={{ opacity: 0.5 }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.4 }}
            >
              Sto cercando «{query}»…
            </motion.p>
            <div className="mt-6 grid w-full max-w-md gap-3">
              {team.slice(0, 3).map((t, i) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.35 }}
                  className="glass flex items-center gap-3 rounded-3xl p-4"
                >
                  {t.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.photo} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700"
                      aria-hidden
                    >
                      {t.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-500">
                      {t.role} · {t.availability}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat */}
      {phase !== "searching" && (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-6">
            {messages.map((m, i) => {
              const ambrosio = isAmbrosioAvatar(m);
              const showAvatar = m.sender === "ai";
              const avatarSrc = ambrosio ? null : agentPhoto;
              const initial = ambrosio ? "A" : agentInitial;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  className={cn("chat-row items-end gap-2", m.sender === "visitor" ? "is-visitor justify-end" : "justify-start")}
                >
                  {/* Avatar stile Telegram: batch = iniziale in gradiente, agente = foto */}
                  {showAvatar && (
                    ambrosio ? (
                      <span className="chat-avatar chat-avatar--ai shrink-0" aria-hidden>
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      </span>
                    ) : avatarSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarSrc} alt="" className="chat-avatar chat-avatar--agent shrink-0" />
                    ) : (
                      <span className="chat-avatar chat-avatar--agent shrink-0" aria-hidden>
                        {initial}
                      </span>
                    )
                  )}
                  <div
                    className={cn(
                      "chat-bubble max-w-[85%] whitespace-pre-line px-4 py-2.5 text-sm leading-relaxed",
                      m.sender === "visitor"
                        ? "chat-bubble--visitor"
                        : cn("chat-bubble--ai", ambrosio && "chat-bubble--ambrosio"),
                    )}
                  >
                    {m.fromAmbrosio && (
                      <span className="chat-ai-label">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Ambrosio — assistente AI
                      </span>
                    )}
                    {m.body}
                    <span className="chat-time">{new Date(m.ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  {/* Avatar visitatore sul lato destro, come nel client Telegram */}
                  {m.sender === "visitor" && (
                    <span className="chat-avatar chat-avatar--visitor shrink-0" aria-hidden>
                      {visitorInitialChar}
                    </span>
                  )}
                </motion.div>
              );
            })}
            {(typing || aiThinking) && (
              <div className="chat-row justify-start">
                <div className="glass flex items-center gap-1 rounded-3xl rounded-bl-md px-4 py-3">
                  {[0, 1, 2].map((d) => (
                    <motion.span
                      key={d}
                      className="h-1.5 w-1.5 rounded-full bg-slate-400"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ repeat: Infinity, duration: 1, delay: d * 0.2 }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Azioni di chiusura: chiama / WhatsApp / callback */}
          {done && (
            <div className="px-4 py-4">
              <div className="mx-auto flex max-w-md flex-col gap-2">
                {onDuty && (
                  <a
                    href={`tel:${onDuty.phone}`}
                    onClick={() =>
                      trackEvent("call_click", {
                        position: "chat",
                        operator: onDuty.firstName,
                        search_term: query,
                      })
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-center text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
                  >
                    <Phone className="h-4 w-4" aria-hidden /> Ti chiamo adesso — {onDuty.firstName}
                  </a>
                )}
                {onDuty?.whatsapp ?? true ? (
                  <a
                    href={`https://wa.me/${(onDuty?.whatsapp ?? site.phone).replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent("call_click", { position: "chat_whatsapp" })}
                    className="glass inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-center text-sm font-semibold text-slate-700 transition hover:bg-white/70"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden /> Scrivici su WhatsApp
                  </a>
                ) : null}
                {!onDuty && status?.callbackSlots?.length ? (
                  callbackBooked ? (
                    <p className="rounded-full bg-green-50 px-5 py-3 text-center text-sm font-medium text-green-700">
                      ✅ Callback confermata: {callbackBooked}. Ti arriva anche una email.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-center text-xs font-medium text-slate-500">
                        Oppure scegli quando richiamarti:
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {status.callbackSlots.map((slot, si) => (
                          <motion.button
                            key={slot}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + si * 0.08, type: "spring", stiffness: 400, damping: 26 }}
                            whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                            onClick={() => bookCallback(slot)}
                            className="rounded-full border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
                          >
                            {slot}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  )
                ) : null}
              </div>
            </div>
          )}

          {/* Bottoni di risposta */}
          {showButtons && currentStep?.buttons && (
            <motion.div
              initial="hidden"
              animate="shown"
              variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06 } } }}
              className="px-4 py-3"
            >
              <div className="mx-auto flex max-w-md flex-wrap gap-2">
                {currentStep.buttons.map((b) => (
                  <motion.button
                    key={b.value}
                    variants={{
                      hidden: { opacity: 0, y: 10, scale: 0.96 },
                      shown: {
                        opacity: 1, y: 0, scale: 1,
                        transition: { type: "spring", stiffness: 400, damping: 26 },
                      },
                    }}
                    whileTap={reduceMotion ? undefined : { scale: 0.94 }}
                    onClick={() => handleAnswer(b.value)}
                    className="rounded-full border border-brand-200/60 bg-brand-50/80 px-4 py-2 text-sm font-medium text-brand-700 backdrop-blur-xl transition-colors hover:bg-brand-100/90"
                  >
                    {b.label}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Consenso GDPR */}
          {showConsent && (
            <div className="px-4 py-4">
              <div className="mx-auto max-w-md space-y-3">
                <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <span>
                    Ho letto l&apos;informativa e acconsento al trattamento dei miei dati per essere
                    ricontattato.{" "}
                    <a
                      href="/privacy-policy"
                      target="_blank"
                      className="text-brand-700 underline underline-offset-2"
                    >
                      Informativa completa
                    </a>
                  </span>
                </label>
                <button
                  onClick={handleConsent}
                  disabled={!consentChecked || submittingLead}
                  className="w-full rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 disabled:opacity-40"
                >
                  {submittingLead ? "Invio…" : "Invia e fatti richiamare"}
                </button>
              </div>
            </div>
          )}

          {/* Input testo */}
          {showTextInput && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAnswer(input);
              }}
              className="px-4 py-3"
            >
              <div className="mx-auto flex max-w-md items-center gap-2">
                <input
                  ref={composerRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={currentStep?.placeholder ?? "Scrivi la tua risposta…"}
                  aria-label="La tua risposta"
                  className="w-full rounded-full border border-white/50 bg-white/60 px-4 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/80"
                />
                <button
                  type="button"
                  data-emoji-toggle
                  aria-expanded={emojiOpen && emojiFor === "script"}
                  aria-label="Aggiungi un emoji"
                  onClick={() => {
                    setEmojiFor("script");
                    setEmojiOpen((v) => !(v && emojiFor === "script"));
                  }}
                  className="glass shrink-0 rounded-full p-2.5 text-slate-500 transition hover:text-brand-700"
                >
                  <Smile className="h-4 w-4" aria-hidden />
                </button>
                <motion.button
                  type="submit"
                  aria-label="Invia"
                  whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="shrink-0 rounded-full bg-brand-600/90 p-2.5 text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-brand-500/90"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2Z" />
                  </svg>
                </motion.button>
              </div>
            </form>
          )}

          {/* Chat libera con Ambrosio quando il team è offline */}
          {aiFreeMode && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const q = aiInput.trim();
                if (!q) return;
                setMessages((m) => [...m, { sender: "visitor", body: q, ts: Date.now() }]);
                persistMessage(q);
                setAiInput("");
                void askAmbrosio(q).then(() => {});
              }}
              className="px-4 pb-2"
            >
              <div className="mx-auto flex max-w-md items-center gap-2">
                <input
                  ref={composerRef}
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder="Chiedi ad Ambrosio, risponde subito…"
                  aria-label="Chiedi ad Ambrosio"
                  className="w-full rounded-full border border-violet-200/70 bg-white/60 px-4 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-violet-400/70 focus:bg-white/80"
                />
                <button
                  type="button"
                  data-emoji-toggle
                  aria-expanded={emojiOpen && emojiFor === "ai"}
                  aria-label="Aggiungi un emoji"
                  onClick={() => {
                    setEmojiFor("ai");
                    setEmojiOpen((v) => !(v && emojiFor === "ai"));
                  }}
                  className="glass shrink-0 rounded-full p-2.5 text-slate-500 transition hover:text-violet-700"
                >
                  <Smile className="h-4 w-4" aria-hidden />
                </button>
                <motion.button
                  type="submit"
                  aria-label="Invia ad Ambrosio"
                  whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  className="shrink-0 rounded-full bg-violet-600/90 p-2.5 text-white shadow-glass-btn backdrop-blur-xl transition-colors hover:bg-violet-500/90"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2Z" />
                  </svg>
                </motion.button>
              </div>
              <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[11px] text-slate-400">
                <Sparkles className="h-3 w-3" aria-hidden />
                Assistente AI · Daniele o Michele ti rispondono di persona al prossimo turno
              </p>
            </form>
          )}

          {/* Emoji picker: chiudi via Esc o clic fuori (toggle escluso) */}
          {emojiOpen && (
            <EmojiPicker
              onPick={insertEmoji}
              onClose={() => setEmojiOpen(false)}
              emojis={pickerEmojis}
            />
          )}
          {done && !showTextInput && !aiFreeMode && (
            <p className="pb-4 text-center text-xs text-slate-400">
              {site.name} · {site.phone}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EmojiCategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className="chat-emoji-cat">
      {category.label}
    </div>
  );
}

function EmojiRow(props: EmojiPickerListRowProps) {
  return <div {...props} className="chat-emoji-row" />;
}

function EmojiCell({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button {...props} type="button" className="chat-emoji-cell">
      {emoji.emoji}
    </button>
  );
}

/**
 * Emoji picker della chat su frimousse (pacchetto aggiunto in b80d04a):
 * ricerca, navigazione da tastiera e virtualizzazione del pacchetto,
 * vestiti con la pillola glass della chat (chat.css). Il dataset è
 * costruito dal set scelto nell'admin (chat-emoji-data.ts): nessun fetch
 * a CDN esterni — il resolver di default di frimousse scaricherebbe
 * Emojibase da jsdelivr a runtime, inaccettabile qui (GDPR + degradazione
 * senza DB). Il picker monta solo quando è aperto: ogni apertura
 * risolve il dataset fresco, anche se l'admin ha cambiato il set.
 * Contratto invariato: onPick(string), onClose(), emojis = set dell'admin.
 */
function EmojiPicker({
  onPick,
  onClose,
  emojis,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  emojis: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-emoji-toggle]")) return; // il toggle gestisce sé stesso
      if (ref.current && !ref.current.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);
  const emojiData = useMemo(() => chatEmojiData(emojis), [emojis]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Inserisci un&apos;emoji"
      className="chat-emoji-pop glass-solid"
    >
      <FrimousseEmojiPicker.Root
        locale="it"
        columns={6}
        resolveEmojiData={() => emojiData}
        onEmojiSelect={(e) => onPick(e.emoji)}
        className="chat-emoji-root"
      >
        <div className="chat-emoji-searchbox">
          <Search className="chat-emoji-search-icon" aria-hidden />
          <FrimousseEmojiPicker.Search
            className="chat-emoji-search"
            placeholder="Cerca un'emoji…"
            aria-label="Cerca un'emoji"
          />
        </div>
        <FrimousseEmojiPicker.Viewport className="chat-emoji-viewport">
          <FrimousseEmojiPicker.Loading className="chat-emoji-state">
            Caricamento…
          </FrimousseEmojiPicker.Loading>
          <FrimousseEmojiPicker.Empty className="chat-emoji-state">
            Nessuna emoji trovata.
          </FrimousseEmojiPicker.Empty>
          <FrimousseEmojiPicker.List
            className="chat-emoji-list"
            components={{
              CategoryHeader: EmojiCategoryHeader,
              Row: EmojiRow,
              Emoji: EmojiCell,
            }}
          />
        </FrimousseEmojiPicker.Viewport>
        <div className="chat-emoji-footer">
          <FrimousseEmojiPicker.ActiveEmoji>
            {({ emoji }) =>
              emoji ? (
                <span className="chat-emoji-preview">
                  <span className="chat-emoji-preview-glyph" aria-hidden>
                    {emoji.emoji}
                  </span>
                  <span className="chat-emoji-preview-label">{emoji.label}</span>
                </span>
              ) : (
                <span className="chat-emoji-preview-label chat-emoji-preview-hint">
                  Scegli un&apos;emoji
                </span>
              )
            }
          </FrimousseEmojiPicker.ActiveEmoji>
        </div>
      </FrimousseEmojiPicker.Root>
    </div>
  );
}
