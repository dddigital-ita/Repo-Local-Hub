/**
 * FORMATO DEL DIGEST SERALE — cuore PURO, zero import (stesso partito di
 * digest-format.ts: le decisioni su cosa entra e come si intitola vivono
 * qui e girano identiche nei test di node; l'invio sta nel layer server
 * telegram-digest.ts, la scelta dell'ora nel cron).
 *
 * Semantica: il mattino dice COSA FARE OGGI (sirena se serve), la sera
 * racconta COSA HA FATTO AMBROSIO — chiusura del cerchio della giornata sul
 * canale dove il team già legge (Telegram). A differenza del mattino, la
 * «giornata quieta» si dice: dopo una giornata senza attività il silenzio
 * creerebbe il dubbio che il digest sia rotto — una riga onesta costa zero.
 */

/** Finestra serale (ORARIO DI ROMA): tra le 20 e le 23 incluse. */
export const EVENING_DIGEST_WINDOW = { startRome: 20, endRome: 23 } as const;

/** true quando l'ora di Roma cade nella finestra del digest serale (20:00–23:59). */
export function isEveningDigestTime(hourRome: number): boolean {
  const h = Math.floor(Number(hourRome) || 0);
  return h >= EVENING_DIGEST_WINDOW.startRome && h <= EVENING_DIGEST_WINDOW.endRome;
}

/** Una voce del conteggio (label + numero). */
export interface EveningCount {
  label: string;
  n: number;
}

/** Dettaglio di una callback fissata da Ambrosio oggi. */
export interface EveningCallback {
  /** Etichetta dello slot come promessa al cliente (es. «Domani alle 09:00»). */
  slot: string;
  /** Nome del lead se noto (altrimenti il digest dice «cliente»). */
  name: string | null;
}

export interface EveningDigestInput {
  dateLabel: string; // es. «domenica 28 settembre»
  leads: number;
  questions: number;
  handoffs: number;
  callbacks: EveningCallback[];
  /** Dettaglio lead per fonte (web / telegram): stringhe corte. */
  leadSources: EveningCount[];
}

/**
 * Le righe del digest serale (testo piano; l'HTML/escape lo fa il layer di
 * invio telegram.ts, qui nessuna formattazione a monte). Righe stabili e
 * testabili: ogni sezione compare SOLO se ha contenuto.
 */
export function eveningDigestLines(input: EveningDigestInput): string[] {
  const lines: string[] = [];
  const active = input.questions > 0 || input.leads > 0 || input.handoffs > 0 || input.callbacks.length > 0;

  lines.push(`🌅 Chiusura — giornata di Ambrosio · ${input.dateLabel}`);

  if (!active) {
    lines.push("Giornata quieta: nessun cliente ha scritto mentre il team era fuori turno.");
    return lines;
  }

  // ── I numeri della giornata ───────────────────────────────────────
  const counts: EveningCount[] = [
    { label: "lead salvati", n: input.leads },
    { label: "clienti seguiti", n: input.questions },
    { label: "passaggi al team", n: input.handoffs },
    { label: "callback fissate", n: input.callbacks.length },
  ];
  lines.push(counts.map((c) => `${c.n} ${c.label}`).join(" · "));

  // ── Lead: da dove arrivano (solo se ce ne sono) ───────────────────
  const sources = input.leadSources.filter((s) => s.n > 0);
  if (input.leads > 0 && sources.length > 0) {
    lines.push(`Lead: ${sources.map((s) => `${s.n} da ${s.label}`).join(", ")}`);
  }

  // ── Le promesse prese per il team (la parte che genera lavoro domani) ──
  if (input.callbacks.length > 0) {
    lines.push("Da richiamare:");
    for (const cb of input.callbacks.slice(0, 8)) {
      lines.push(`• ${cb.slot} — ${cb.name ?? "cliente"}`);
    }
    if (input.callbacks.length > 8) {
      lines.push(`• …e altre ${input.callbacks.length - 8}`);
    }
  }

  return lines;
}

/**
 * La prima riga-guida (come l'oggetto del digest mattutino): il numero che
 * conta di più guida lo sguardo — lead > callback > passaggi al team.
 */
export function eveningDigestHeadline(input: EveningDigestInput): string {
  if (input.leads > 0) {
    return `${input.leads} ${input.leads === 1 ? "nuovo lead" : "nuovi lead"} 🎯`;
  }
  if (input.callbacks.length > 0) {
    return `${input.callbacks.length} ${input.callbacks.length === 1 ? "callback fissata" : "callback fissate"} 📞`;
  }
  if (input.handoffs > 0) {
    return `${input.handoffs} ${input.handoffs === 1 ? "caso passato al team" : "casi passati al team"} 🤝`;
  }
  if (input.questions > 0) {
    return `${input.questions} ${input.questions === 1 ? "conversazione seguita" : "conversazioni seguite"} 💬`;
  }
  return "giornata quieta 🌙";
}
