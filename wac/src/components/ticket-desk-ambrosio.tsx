"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, PenLine, Tags, Sparkles, Power, BellOff, BellRing } from "lucide-react";

/**
 * PANNELLO AMBROSIO DELLA SCHEDA (Fase 3 desk): tre azioni AI — riepilogo
 * del filo, risposta suggerita, classifica — più lo stato dell'auto-pilota
 * (le impronte reali: takeover e follow-up, passate dal server come prop).
 *
 * La risposta suggerita NON viene mai inviata da qui: viene INIETTATA nel
 * composer (`#reply-<id>`), dove l'operatore la edita e la firma — l'AI
 * propone, l'umano scrive. Ogni chiamata passa da
 * /api/admin/tickets/[id]/ambrosio (audit ambrosio.desk.*).
 *
 * L'auto-pilota è anche MANUALE: il toggle attiva/disattiva il take-over
 * (impronta reale ai_takeover_at) con conferma esplicita — l'operatore sa
 * che Ambrosio risponderà al cliente al posto del team finché non lo
 * riprende.
 */

type Azione = "riepilogo" | "risposta" | "classifica" | "autopilota" | "followup" | "followup_now";

const AZIONI: { key: Azione; label: string; Icon: typeof Sparkles; hint: string }[] = [
  { key: "riepilogo", label: "Riepilogo filo", Icon: ClipboardList, hint: "Cosa è successo finora, in 5 punti" },
  { key: "risposta", label: "Risposta suggerita", Icon: PenLine, hint: "Bozza nel composer, tu la editi e invii" },
  { key: "classifica", label: "Classifica", Icon: Tags, hint: "Priorità e stato proposti, tu decidi" },
];

export default function TicketDeskAmbrosio({
  ticketId,
  takeover,
  followup,
  followupDisabled,
}: {
  ticketId: string;
  takeover: boolean;
  followup: boolean;
  /** L'operatore ha escluso il follow-up automatico su questo ticket. */
  followupDisabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Azione | null>(null);
  const [esiti, setEsiti] = useState<Partial<Record<Azione, string>>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [iniettata, setIniettata] = useState(false);
  const [inviatoOra, setInviatoOra] = useState(false);

  async function toggleFollowupAuto() {
    const attiva = followupDisabled;
    const domanda = attiva
      ? "Riattivare il follow-up automatico su questo ticket?\n\nAmbrosio tornerà a seguire il cliente se sparite dopo una sua richiesta (sempre UN solo messaggio, secondo la dedup standard)."
      : "Escludere questo ticket dal follow-up automatico?\n\nAmbrosio non invierà il messaggio di follow-up al cliente su questo ticket, anche se le condizioni del cron si presentano. Potrai riattivarlo qui.";
    if (!confirm(domanda)) return;
    setBusy("followup");
    setErrore(null);
    setIniettata(false);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/ambrosio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "followup", attiva }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (!res.ok || !data.ok) {
        setErrore(data.detail ?? "Follow-up non aggiornato");
        return;
      }
      router.refresh();
    } catch {
      setErrore("Rete non disponibile, riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function inviaFollowupOra() {
    if (!confirm("Inviare ADESSO il follow-up di Ambrosio nel thread?\n\nÈ UN follow-up per ticket: dopo questo non ne partirà più nessuno (né manuale né automatico). Lo scrive Ambrosio firmando il prossimo operatore di turno.")) return;
    setBusy("followup_now");
    setErrore(null);
    setIniettata(false);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/ambrosio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "followup_now" }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (!res.ok || !data.ok) {
        setErrore(data.detail ?? "Follow-up non inviabile");
        return;
      }
      setInviatoOra(true);
      router.refresh();
    } catch {
      setErrore("Rete non disponibile, riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutopilota() {
    const attiva = !takeover;
    const domanda = attiva
      ? "Attivare l'auto-pilota di Ambrosio su questo ticket?\n\nFinché non lo disattivi, Ambrosio risponde al cliente al posto del team (take-over manuale, tracciato nell'audit)."
      : "Disattivare l'auto-pilota?\n\nAmbrosio smette di rispondere al posto del team: le prossime richieste del cliente restano al team.";
    if (!confirm(domanda)) return;
    setBusy("autopilota");
    setErrore(null);
    setIniettata(false);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/ambrosio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autopilota", attiva }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (!res.ok || !data.ok) {
        setErrore(data.detail ?? "Auto-pilota non aggiornato");
        return;
      }
      // La verità viene dal DB: la scheda si ridisegna e il pannello rilegge
      // takeover/followup dalle props server.
      router.refresh();
    } catch {
      setErrore("Rete non disponibile, riprova.");
    } finally {
      setBusy(null);
    }
  }

  async function esegui(action: Azione) {
    setBusy(action);
    setErrore(null);
    setIniettata(false);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/ambrosio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; text?: string; detail?: string };
      if (!res.ok || !data.ok || !data.text) {
        setErrore(data.detail ?? "Ambrosio non disponibile");
        return;
      }
      setEsiti((e) => ({ ...e, [action]: data.text! }));
      if (action === "risposta") {
        // INIEZIONE nel composer: la bozza arriva dove l'operatore scrive,
        // con evento input per i draft salvati — inviare resta un gesto umano.
        const ta = document.getElementById(`reply-${ticketId}`) as HTMLTextAreaElement | null;
        if (ta) {
          ta.value = data.text;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.focus();
          setIniettata(true);
        } else {
          setErrore("Composer non trovato: la bozza resta qui sotto.");
        }
      }
    } catch {
      setErrore("Rete non disponibile, riprova.");
    } finally {
      setBusy(null);
    }
  }

  const autoPilota = takeover || followup;

  return (
    <div className="glass-solid rounded-3xl p-4">
      <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
        Ambrosio AI
      </h3>

      {/* Auto-pilota: lo stato REALE (colonne conversations), non una promessa.
          Il toggle è MANUALE e chiede conferma: scrive sull'impronta reale
          (ai_takeover_at) e finisce nell'audit come ogni azione del pannello. */}
      <div className="mt-2 rounded-2xl bg-violet-50/80 p-2.5 ring-1 ring-violet-200/60">
        <div className="space-y-1 text-xs text-violet-900">
          {takeover && (
            <p className="font-semibold">
              ✨ Ambrosio ha in mano il filo (take-over): risponde al cliente al posto del team, finché non lo riprendi tu.
            </p>
          )}
          {followup && <p>Ambrosio ha già inviato un follow-up al cliente su questo ticket.</p>}
          {!autoPilota && (
            <p className="text-violet-900/80">
              Auto-pilota non attivo su questo ticket: Ambrosio osserva, ma non ha ancora preso in mano il filo.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggleAutopilota}
          disabled={busy !== null}
          title={takeover ? "Riprendi il controllo del filo: Ambrosio smette di rispondere per il team" : "Ambrosio risponde al cliente al posto del team finché non lo disattivi"}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm font-semibold text-violet-900 ring-1 ring-violet-200/80 transition hover:bg-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <Power className="h-3.5 w-3.5" aria-hidden />
          {busy === "autopilota" ? "Sto aggiornando…" : takeover ? "Disattiva auto-pilota (torna tu)" : "Attiva auto-pilota (Ambrosio risponde)"}
        </button>
        <button
          type="button"
          onClick={toggleFollowupAuto}
          disabled={busy !== null}
          title={followupDisabled ? "Riattiva il follow-up automatico di Ambrosio su questo ticket" : "Ambrosio non invierà il follow-up su questo ticket, anche se il cron lo prevede"}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm font-semibold text-violet-900 ring-1 ring-violet-200/80 transition hover:bg-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <BellOff className="h-3.5 w-3.5" aria-hidden />
          {busy === "followup" ? "Sto aggiornando…" : followupDisabled ? "Riattiva follow-up automatico" : "Escludi follow-up automatico"}
        </button>
      </div>

      {/* «Follow-up ora»: invio A MANO della stessa pipeline del cron — un
          solo follow-up per ticket (dedup), quindi nascosto se già partito.
          Il server può comunque bloccare (chiuso, bot, ultima parola): il
          motivo arriva nel box errore. */}
      {!followup && (
        <button
          type="button"
          onClick={inviaFollowupOra}
          disabled={busy !== null}
          title="Ambrosio scrive ora nel thread col tono suo, firmando il prossimo operatore di turno — UN follow-up per ticket"
          className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl bg-violet-50/80 px-3 py-2 text-left text-sm font-semibold text-violet-900 ring-1 ring-violet-200/70 transition hover:bg-violet-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span className="inline-flex items-center gap-2">
            <BellRing className="h-3.5 w-3.5" aria-hidden />
            {busy === "followup_now" ? "Ambrosio sta scrivendo…" : "Invia follow-up ora"}
          </span>
          <span aria-hidden className="text-xs text-violet-400">UNO solo</span>
        </button>
      )}

      {/* Le tre azioni: proposte AI, mai scritture dirette sul ticket. */}
      <div className="mt-2.5 grid gap-1.5">
        {AZIONI.map(({ key, label, Icon, hint }) => (
          <button
            key={key}
            type="button"
            onClick={() => esegui(key)}
            disabled={busy !== null}
            title={hint}
            className="inline-flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-white/60 px-3 py-2 text-left text-sm font-medium text-slate-700 ring-1 ring-white/60 transition hover:bg-white/95 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <span className="inline-flex items-center gap-2">
              <Icon className="h-3.5 w-3.5 text-violet-500" aria-hidden />
              {busy === key ? "Ambrosio sta lavorando…" : label}
            </span>
            <span aria-hidden className="text-xs text-slate-400">↵</span>
          </button>
        ))}
      </div>

      {errore && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50/90 p-2.5 text-xs font-medium text-red-700 ring-1 ring-red-200/70">
          {errore}
        </p>
      )}
      {iniettata && (
        <p className="mt-2 rounded-xl bg-emerald-50/90 p-2.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/70">
          Bozza inserita nel composer: editala e invia tu — Ambrosio non scrive mai al cliente da sola.
        </p>
      )}
      {inviatoOra && (
        <p className="mt-2 rounded-xl bg-emerald-50/90 p-2.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200/70">
          Follow-up inviato nel thread: il cliente lo ritrova riaprendo la chat. Non ne partiranno altri su questo ticket.
        </p>
      )}

      {/* I risultati restano nel pannello (riepilogo e classifica: consultazione). */}
      {(esiti.riepilogo || esiti.classifica) && (
        <div className="mt-2.5 space-y-2">
          {esiti.riepilogo && (
            <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/60">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Riepilogo del filo</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{esiti.riepilogo}</p>
            </div>
          )}
          {esiti.classifica && (
            <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/60">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Classifica proposta</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{esiti.classifica}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
