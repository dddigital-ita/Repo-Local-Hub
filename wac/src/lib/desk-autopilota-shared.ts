/**
 * AUTO-PILOTA MANUALE — il piano PURO del toggle nel pannello Ambrosio.
 * Nessun import (nemmeno db/audit): come scripts/channel-webhook-core.mjs è
 * un modulo loader-free che node --test può verificare senza DB né AI
 * (lezione del post-mortem: la logica che deve restare vera vive separata
 * dal guscio che tocca il mondo).
 *
 * Il contratto del take-over resta UNO con il cron SLA (ai-tools.ts): stessa
 * colonna (conversations.ai_takeover_at), stesse impronte (attiva = now(),
 * disattiva = null, come claimSlaTakeoverCandidates e releaseTakeoverClaim)
 * e lo stesso tipo di lock anti-corsa: `archived_at is null` nel WHERE, così
 * un ticket archiviato nel frattempo non viene MAI toccato — zero righe
 * tornate, niente audit, l'operatore vede il motivo invece di un falso ok.
 */

export const AUTOPILONA_SQL = `update conversations set ai_takeover_at = $1
   where id = $2 and archived_at is null
   returning ai_takeover_at`;

export const AUTOPILONA_AUDIT_ON = "ambrosio.desk.autopilota_on";
export const AUTOPILONA_AUDIT_OFF = "ambrosio.desk.autopilota_off";

export interface AutopilotaPlan {
  sql: string;
  params: [Date | null, string];
  auditAction: string;
}

/** Il piano di scrittura: SQL col lock anti-corsa, parametri e azione d'audit. */
export function autopilotaPlan(attiva: boolean, conversationId: string): AutopilotaPlan {
  return {
    sql: AUTOPILONA_SQL,
    params: [attiva ? new Date() : null, conversationId],
    auditAction: attiva ? AUTOPILONA_AUDIT_ON : AUTOPILONA_AUDIT_OFF,
  };
}

export type AutopilotaEsito =
  | { ok: true; takeover: boolean; auditDetail: string }
  | { ok: false; reason: string };

/**
 * L'esito dalle righe tornate: zero righe = ticket mancante o ARCHIVIATO
 * nel frattempo (il lock ha vinto): niente audit su un ticket che non c'è
 * più. L'impronta letta dal RETURNING è la verità, non l'intenzione.
 */
export function autopilotaEsito(rows: { ai_takeover_at: Date | string | null }[]): AutopilotaEsito {
  if (!rows.length) return { ok: false, reason: "ticket_non_trovato_o_archiviato" };
  const takeover = rows[0].ai_takeover_at != null;
  return {
    ok: true,
    takeover,
    auditDetail: takeover
      ? "takeover attivo manualmente dall'operatore"
      : "takeover rilasciato manualmente dall'operatore",
  };
}

/* ── Follow-up: il piano PURO della disattivazione/riattivazione ──
 *
 * Il follow-up del cron è UNICO per dedup su followup_sent_at: "disattivare"
 * cancellando l'impronta RIARMEREBBE il cron. Il toggle manuale scrive invece
 * il FLAG followup_disabled_at (migration 042): il cron smette di selezionare
 * il ticket e il claim lo rifiuta; riattivare rimette il flag a null e la
 * dedup standard torna a decidere — l'impronta non è MAI toccata.
 */

export const FOLLOWUP_DISABLED_SQL = `update conversations set followup_disabled_at = $1
   where id = $2 and archived_at is null
   returning followup_disabled_at`;

export const FOLLOWUP_AUDIT_OFF = "ambrosio.desk.followup_off";
export const FOLLOWUP_AUDIT_ON = "ambrosio.desk.followup_on";

/** «Invia follow-up ora»: l'audit porta il nome dell'operatore, non "system". */
export const FOLLOWUP_NOW_AUDIT = "ambrosio.desk.followup_now";

export interface FollowupNowInput {
  /** L'impronta followup_sent_at è già presente (dedup: UNO solo). */
  followupSent: boolean;
  /** Mittente dell'ultimo messaggio del filo. */
  lastSender: string | null;
  status: string;
}

export type FollowupNowVerdetto = { consentito: true } | { consentito: false; motivo: string };

/**
 * Quando «invia follow-up ora» ha senso: già inviato → mai (dedup);
 * chiuso o ancora in mano al bot → no; l'ultima parola NON del cliente →
 * no (un follow-up ora interromperebbe il filo — conservativo anche con
 * stato sconosciuto). L'operatore decide sul resto: è un invio A MANO.
 */
export function followupNowConsentibile(t: FollowupNowInput): FollowupNowVerdetto {
  if (t.followupSent) return { consentito: false, motivo: "follow-up già inviato su questo ticket: UNO solo (dedup)" };
  if (t.status === "closed") return { consentito: false, motivo: "il ticket è chiuso: niente follow-up" };
  if (t.status === "bot") return { consentito: false, motivo: "il filo è ancora in mano al bot: qualifica prima del follow-up" };
  if (t.lastSender !== "visitor") return { consentito: false, motivo: "l'ultima parola non è del cliente: un follow-up ora interromperebbe il filo" };
  return { consentito: true };
}

export interface FollowupPlan {
  sql: string;
  params: [Date | null, string];
  auditAction: string;
}

/** Il piano: disattiva = flag settato, riattiva = flag a null (mai l'impronta). */
export function followupPlan(attiva: boolean, conversationId: string): FollowupPlan {
  return {
    sql: FOLLOWUP_DISABLED_SQL,
    params: [attiva ? null : new Date(), conversationId],
    auditAction: attiva ? FOLLOWUP_AUDIT_ON : FOLLOWUP_AUDIT_OFF,
  };
}

export type FollowupEsito =
  | { ok: true; followupDisabled: boolean; auditDetail: string }
  | { ok: false; reason: string };

/** L'esito dalle righe tornate: zero righe = ticket mancante o archiviato. */
export function followupEsito(rows: { followup_disabled_at: Date | string | null }[]): FollowupEsito {
  if (!rows.length) return { ok: false, reason: "ticket_non_trovato_o_archiviato" };
  const followupDisabled = rows[0].followup_disabled_at != null;
  return {
    ok: true,
    followupDisabled,
    auditDetail: followupDisabled
      ? "follow-up automatico escluso su questo ticket dall'operatore"
      : "follow-up automatico riattivato su questo ticket dall'operatore",
  };
}
