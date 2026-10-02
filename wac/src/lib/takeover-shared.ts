/**
 * ORIGINE DEL TAKEOVER — la regola PURO che distingue il take-over attivato
 * a mano dall'operatore (pannello Ambrosio) da quello del cron SLA
 * (claimSlaTakeoverCandidates). Nessun import: verificabile da node --test
 * senza DB, stessa ricetta di desk-autopilota-shared.ts.
 *
 * L'attribuzione vive nell'AUDIT (append-only dalla 010): il cron scrive
 * solo conversations.ai_takeover_at, il toggle manuale lascia anche gli
 * eventi ambrosio.desk.autopilota_on/off con target = id conversazione.
 * La regola è «l'ultimo evento autopilota_* del ticket»:
 *   - ultimo = autopilota_on  → MANUALE (l'operatore ce l'ha messo la mano);
 *   - ultimo = autopilota_off o nessun evento → CRON SLA (copre anche il
 *     caso on → off → il cron riprende il filo dopo il rilascio: l'ultima
 *     parola sull'impronta torna ad avere il cron).
 */

export const AUTOPILONA_ON = "ambrosio.desk.autopilota_on";
export const AUTOPILONA_OFF = "ambrosio.desk.autopilota_off";

export type TakeoverOrigin = "manuale" | "cron_sla";

/** L'ultimo evento autopilota del ticket decide l'origine (null = cron). */
export function takeoverOrigin(ultimoEvento: string | null): TakeoverOrigin {
  return ultimoEvento === AUTOPILONA_ON ? "manuale" : "cron_sla";
}

/**
 * Il fragmento SQL della lookup per-ticket (c = conversations): esige
 * l'indice audit_log (target, action, created_at desc) della migration 041
 * — viene valutato per ogni riga della inbox. Il cast c.id::text serve:
 * audit_log.target è TEXT e conversations.id è UUID (text = uuid non
 * esiste in PG); il cast è sul valore esterno, l'indice su target resta
 * usabile.
 */
export const TAKEOVER_ORIGIN_SQL = `(
    select a.action from audit_log a
    where a.target = c.id::text and a.action in ('${AUTOPILONA_ON}', '${AUTOPILONA_OFF}')
    order by a.created_at desc limit 1
  )`;

/** TRUE se il takeover attivo è nato a mano (ultimo evento = autopilota_on). */
export const TAKEOVER_MANUALE_SQL = `(${TAKEOVER_ORIGIN_SQL}) = '${AUTOPILONA_ON}'`;

/** Le impronte che accendono la presenza di Ambrosio su un ticket aperto. */
export const AMBROSIO_ATTIVO_SQL = `(c.ai_takeover_at is not null or c.followup_sent_at is not null)`;

export interface TakeoverChipInput {
  takeover: boolean;
  followup: boolean;
  /** TRUE quando l'ultimo evento autopilota_* del ticket è un ON manuale. */
  manuale: boolean;
}

export interface TakeoverChipSpec {
  label: string;
  title: string;
}

/** Tooltip del badge «follow-up escluso» in inbox (icona accanto alla chip). */
export const FOLLOWUP_ESCLUSO_TITLE = "Follow-up automatico escluso su questo ticket: Ambrosio non lo seguirà (riattivabile in scheda)";

/**
 * Il badge di esclusione si mostra su OGNI ticket escluso, anche quando la
 * chip Ambrosio non c'è: l'esclusione è una promessa sul FUTURO (niente
 * follow-up a venire), la chip racconta il PRESENTE (chi ha il filo ora).
 */
export function followupEsclusoBadge(t: { followupDisabled: boolean }): { title: string } | null {
  return t.followupDisabled ? { title: FOLLOWUP_ESCLUSO_TITLE } : null;
}

/**
 * La chip della inbox: label e spiegazione al passaggio del mouse. Il
 * takeover senza storia d'audit è del cron (i takeover pre-toggle restano
 * etichettati SLA: è la verità che i dati dicono).
 */
export function takeoverChip(t: TakeoverChipInput): TakeoverChipSpec | null {
  if (t.takeover) {
    return t.manuale
      ? {
          label: "Ambrosio · a mano",
          title: "Auto-pilota attivato a mano da un operatore (audit ambrosio.desk.autopilota_on)",
        }
      : {
          label: "Ambrosio · SLA",
          title: "Take-over SLA: Ambrosio è subentrato perché la risposta era scaduta (cron)",
        };
  }
  if (t.followup) {
    return { label: "Ambrosio", title: "Ambrosio ha inviato un follow-up al cliente" };
  }
  return null;
}
