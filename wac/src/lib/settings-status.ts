/**
 * LAYER DI DATI DEGLI STATI DELL'HUB IMPOSTAZIONI — cuore PURO, zero import.
 *
 * Le funzioni che decidono i badge dell'hub (tono verde/ambra/grigio, label,
 * conteggi) vivono QUI e girano identiche nei test di node (import diretto
 * del .ts, nessuna costante duplicata). Le letture DB/config stanno nel
 * layer server (`settings-status-server.ts`), la UI solo le stampa — lo
 * stesso taglio del registro integrazioni: defs/derivazioni separate
 * dalle letture.
 *
 * Semantica dei tre toni (decisione del 2026-09-26):
 * - ok (verde): configurazione completa e attiva;
 * - warn (ambra): funziona MA incompleto/spento con azione attesa;
 * - neutro (grigio): default o spento DI PROPOSITO, nessuna azione dovuta.
 */

export type HubCardStatus = {
  /** Chiave stabile della scheda nell'hub. */
  key: string;
  ok: boolean;
  warn: boolean;
  label: string;
  /** Conteggi live opzionali (N salvate, N priorità…). */
  counts: { n: number; label: string }[];
  /**
   * Micro-informazioni libere per la card dell'hub («Ultimo test: 28 set»),
   * come le `meta` del registro integrazioni: il colore resta alla pill,
   * alla meta arriva solo testo. Optional perché quasi nessuna scheda ce l'ha.
   */
  meta?: string[];
};

/**
 * RIEPILOGO DELL'HUB (pill nell'header): quante schede sono INCOMPLETE.
 * "Incompleta" = ambra (warn): funziona MA ha un'azione attesa. Le grigie
 * (default o spente di proposito) NON contano: nessuna azione dovuta — è
 * la stessa semantica dei tre toni, applicata all'intero hub.
 */
export function hubSummary(
  statuses: readonly { ok: boolean; warn: boolean }[],
): { ok: boolean; warn: boolean; label: string } {
  const amber = statuses.filter((s) => s.warn).length;
  if (amber === 0) {
    return { ok: true, warn: false, label: "Nessuna azione attesa" };
  }
  return {
    ok: false,
    warn: true,
    label: amber === 1 ? "1 scheda da completare" : `${amber} schede da completare`,
  };
}

/**
 * SCHEDE IN ATTESA DI UN HUB: restituisce le CHIAVI stabili delle schede
 * ambra (stessa semantica di `hubSummary`, ma nominale). La Panoramica le
 * usa per dire a chi apre l'admin COSA è incompleto e dove andare, senza
 * duplicare la regola: chi alimenta le pill decide anche il riepilogo.
 */
export function pendingOf(
  statuses: readonly { key?: string; warn: boolean }[],
): string[] {
  return statuses
    .filter((s) => s.warn)
    .map((s) => s.key ?? "")
    .filter(Boolean);
}

/**
 * Dedup by-key per gli stati passati a `hubSummary`: gli hub compongono
 * schede e condizioni vitali che a volte dicono la stessa cosa (es. in
 * Ambrosio la chiave: scheda Provider e `hasKey` della dashboard) — senza
 * dedup, la pill conterebbe lo stesso problema due volte.
 */
export function dedupeByKey<T extends { key?: string }>(statuses: readonly T[]): T[] {
  const seen = new Set<string>();
  return statuses.filter((s) => {
    if (!s.key) return true;
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
}

/* ── Agenda operativa della Panoramica ─────────────────────────────── */

/**
 * Agenda operativa: i pendi di OGGI (ticket in ritardo SLA, promesse da
 * richiamare) non sono configurazione ma meritano la stessa disciplina:
 * regola dichiarata in funzione pura, testata dove vive, pill uguale alle
 * altre. La regola differisce dal riepilogo hub: qui il ROSSO è la scadenza
 * violata (si deve agire adesso), l'ambra è il carico in arrivo; il verde
 * «Giornata libera» NON è «nessun problema», è «nessun pendio operativo» —
 * la configurazione parla nella sezione sotto.
 */
export function slaAgendaStatus(
  breaches: number,
  openTickets: number,
): { ok: boolean; warn: boolean; label: string } {
  const b = Math.max(0, Number(breaches) || 0);
  const open = Math.max(0, Number(openTickets) || 0);
  if (b > 0) {
    return {
      ok: false,
      warn: false,
      label: b === 1 ? "1 ticket in ritardo" : `${b} ticket in ritardo`,
    };
  }
  if (open > 0) {
    return {
      ok: false,
      warn: true,
      label: open === 1 ? "1 aperto, entro SLA" : `${open} aperti, entro SLA`,
    }
  }
  return { ok: true, warn: false, label: "Nessun ticket aperto" };
}

/**
 * Promesse da mantenere: la regola della dashboard («ricontatta_il» entro
 * 12h, non chiusi) diventa pill. Verde «Giornata libera» = nessuna promessa
 * in arrivo: l'ambra conta quelle da mantenere, con la qualifica del lato
 * già scaduto («in ritardo») come in dashboard.
 */
export function recallsAgendaStatus(
  total: number,
  overdue: number,
): { ok: boolean; warn: boolean; label: string } {
  const t = Math.max(0, Number(total) || 0);
  const od = Math.max(0, Number(overdue) || 0);
  if (t === 0) {
    return { ok: true, warn: false, label: "Giornata libera" };
  }
  const base = t === 1 ? "1 promessa da mantenere" : `${t} promesse da mantenere`;
  return {
    ok: false,
    warn: od === 0,
    label: od > 0 ? (od === 1 ? `1 in ritardo su ${t}` : `${od} in ritardo su ${t}`) : base,
  }
}

/* ── Ticketing ────────────────────────────────────────────────────── */

/** Risposte rapide: personalizzate solo se il testo salvato ≠ default (l'ordine conta: è il menu degli agenti). */
export function quickRepliesStatus(
  replies: readonly string[],
  fallback: readonly string[],
): HubCardStatus {
  const customized = replies.join("\n") !== fallback.join("\n");
  return {
    key: "risposte-rapide",
    ok: customized,
    warn: false,
    label: customized ? "Personalizzate" : "Predefinite",
    counts: [{ n: replies.length, label: "salvate" }],
  };
}

/** Emoji della chat: stessa semantica delle risposte rapide (l'ordine è il menu del picker). */
export function chatEmojisStatus(
  emojis: readonly string[],
  fallback: readonly string[],
): HubCardStatus {
  const customized = emojis.join("\n") !== fallback.join("\n");
  return {
    key: "emoji-chat",
    ok: customized,
    warn: false,
    label: customized ? "Personalizzate" : "Predefinite",
    counts: [{ n: emojis.length, label: "emoji" }],
  };
}

/**
 * Policy SLA: attiva quando ALMENO una priorità ha ore > 0. Una priorità
 * presente ma a zero non è configurata. `policy` resta unknown di proposito:
 * il layer server passa l'oggetto com'è dal DB, qui lo normalizziamo.
 */
export function slaStatus(policy: unknown): HubCardStatus {
  const entries = Object.entries(
    typeof policy === "object" && policy !== null ? (policy as Record<string, unknown>) : {},
  );
  const active = entries.filter(([, v]) => {
    const rule = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
    return Number(rule.nextReplyH ?? 0) > 0 || Number(rule.resolveH ?? 0) > 0;
  });
  return {
    key: "sla",
    ok: active.length > 0,
    warn: false,
    label: active.length > 0 ? "Attiva" : "Predefinita",
    counts: [{ n: active.length, label: "priorità" }],
  };
}

/** Chiusura automatica: spenta di default per scelta — neutro, non ambra. */
export function autoCloseStatus(days: number): HubCardStatus {
  const on = Number(days) > 0;
  return {
    key: "chiusura-automatica",
    ok: on,
    warn: false,
    label: on ? `Ogni ${days} gg` : "Disattivata",
    counts: [],
  };
}

/* ── Canali ───────────────────────────────────────────────────────── */

/**
 * Telegram: collegato con token e almeno una chat del team. Ambra quando il
 * canale è spento (manca la scheda o l'env): dopo l'arrivo del digest serale
 * e dei campanelli handoff, un canale spento merita un colpo d'occhio.
 */
export function telegramStatus(cfg: {
  hasToken: boolean;
  hasTeamChats: boolean;
}): HubCardStatus {
  const connected = Boolean(cfg.hasToken && cfg.hasTeamChats);
  return {
    key: "telegram",
    ok: connected,
    warn: !connected,
    label: connected ? "Collegato" : "Da collegare",
    counts: [],
  };
}

/**
 * Canali social: collegati = almeno un account Facebook, Instagram
 * Business o LinkedIn autorizzato via OAuth (la vista `channel_accounts`
 * dei tre canali). Zero account → «Da collegare»: l'azione è il
 * «Collega» della scheda dedicata, a un click dalla card.
 */
export function socialStatus(accounts: number): HubCardStatus {
  const n = Math.max(0, Number(accounts) || 0);
  return {
    key: "social",
    ok: n > 0,
    warn: n === 0,
    label: n === 0 ? "Da collegare" : n === 1 ? "1 collegato" : `${n} collegati`,
    counts: [],
  };
}

/** Email: collegata solo con host, utente e password salvati (SMTP completo). */
export function emailStatus(cfg: {
  smtpHost?: string | null;
  user?: string | null;
  hasPassword?: boolean;
}): HubCardStatus {
  const connected = Boolean(cfg.smtpHost && cfg.user && cfg.hasPassword);
  return {
    key: "email",
    ok: connected,
    warn: !connected,
    label: connected ? "Collegata" : "Da collegare",
    counts: [],
  };
}

/** Riga whatsapp_config normalizzata: il layer server la riempie dal DB. */
export interface WhatsAppConfigRow {
  phoneNumberId: string | null;
  wabaTokenEnc: string | null;
  enabled: boolean;
}

export const EMPTY_WHATSAPP_CONFIG: WhatsAppConfigRow = {
  phoneNumberId: null,
  wabaTokenEnc: null,
  enabled: false,
};

/**
 * WhatsApp: Fase 4 spenta di proposito → «Predisposto» NEUTRO finché non
 * c'è nulla (l'ambra segnalerebbe un problema falso); credenziali presenti
 * ma canale spento → «Da attivare» (ambra, qui l'azione è attesa); tutto
 * presente e attivo → «Attivo».
 */
export function whatsappStatus(cfg: WhatsAppConfigRow): HubCardStatus {
  const configured = Boolean(cfg.phoneNumberId && cfg.wabaTokenEnc);
  const enabled = Boolean(cfg.enabled);
  if (enabled && configured) {
    return { key: "whatsapp", ok: true, warn: false, label: "Attivo", counts: [] };
  }
  if (configured) {
    return { key: "whatsapp", ok: false, warn: true, label: "Da attivare", counts: [] };
  }
  return { key: "whatsapp", ok: false, warn: false, label: "Predisposto", counts: [] };
}

/* ── Protezione ───────────────────────────────────────────────────── */

/**
 * Data corta in italiano (es. «28 set») per le meta dell'hub: un solo posto,
 * lo stesso formato del registro integrazioni.
 */
function shortDateIt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

/**
 * Cloudflare (Turnstile): attivo solo con ENTRAMBE le chiavi attive (site +
 * secret): è la stessa regola di `turnstileEnabledAsync`, che decide anche
 * la verifica runtime — l'hub non può dire una cosa e il captcha farne
 * un'altra. `active` (env o DB) e `fromDb` (fonte dichiarata in UI) arrivano
 * da `getTurnstileSettings` (turnstile-settings.ts). L'esito dell'ultimo
 * «Prova verifica» (audit, azione `cloudflare.test`) diventa meta della
 * card: chi guarda l'hub vede subito SE la catena è mai stata provata e
 * come è andata, senza aprire la scheda — il colore resta alla pill.
 */
export function cloudflareStatus(cfg: {
  active: boolean;
  fromDb: boolean;
  /** Esito dell'ultimo «Prova verifica» (null = mai eseguito). */
  lastTestOk?: boolean | null;
  /** Quando (ISO) — viene formattato in data corta IT. */
  lastTestAt?: string | null;
}): HubCardStatus {
  const label = cfg.active ? (cfg.fromDb ? "Attivo (DB)" : "Attivo (env)") : "Da configurare";
  const day = cfg.lastTestAt ? shortDateIt(cfg.lastTestAt) : "";
  return {
    key: "cloudflare",
    ok: cfg.active,
    warn: !cfg.active,
    label,
    counts: [],
    meta: cfg.lastTestOk === true && day
      ? [`Ultimo test OK · ${day}`]
      : cfg.lastTestOk === false && day
        ? [`Ultimo test fallito · ${day}`]
        : [],
  };
}

/* ── Ambrosio ─────────────────────────────────────────────────────── */

export const LEAD_FOLLOWUP_DEFAULT_HOURS = 48;

/**
 * Follow-up lead: riga ASSENTE nel DB = default attivo 48h (comportamento
 * storico); null = OFF esplicito → ambra «Disattivato» (qualcuno l'ha
 * spento: merita un colpo d'occhio, non è il default).
 */
export function leadFollowupStatus(hours: number | null | undefined): HubCardStatus {
  const off = hours === null;
  return {
    key: "lead-followup",
    ok: !off,
    warn: off,
    label: off ? "Disattivato" : `Ogni ${hours ?? LEAD_FOLLOWUP_DEFAULT_HOURS} h`,
    counts: [],
  };
}

/* ── Ambrosio AI (hub /admin/ai) ──────────────────────────────────── */

export interface AmbrosioFaqLike {
  active: boolean;
}

/**
 * Addestramento: conteggio FAQ attive + domande vere degli ultimi 30 giorni
 * non ancora coperte da una FAQ. `uncovered > 0` è l'unico segnale d'azione
 * (ambra): significa che ai clienti è stata data una risposta non ufficiale.
 */
export function trainingStatus(activeFaqs: number, uncovered: number): HubCardStatus {
  const n = Math.max(0, Number(activeFaqs) || 0);
  const gaps = Math.max(0, Number(uncovered) || 0);
  return {
    key: "addestramento",
    ok: gaps === 0,
    warn: gaps > 0,
    label: gaps > 0 ? `${gaps} da coprire` : "Copertura ok",
    counts: [{ n, label: n === 1 ? "risposta" : "risposte" }],
  };
}

/**
 * Configurazione: ambra «Da attivare» SOLO quando Ambrosio è spento ma la
 * chiave c'è (qualcuno deve riaccenderlo o è una scelta da confermare);
 * spento SENZA chiave resta grigio «Disattivata» (attivarlo ora non sarebbe
 * possibile: prima la chiave — il badge giusto è quello della scheda Provider).
 */
export function aiConfigStatus(enabled: boolean, hasKey: boolean): HubCardStatus {
  if (!enabled && hasKey) {
    return { key: "configurazione", ok: false, warn: true, label: "Da attivare", counts: [] };
  }
  if (!enabled) {
    return { key: "configurazione", ok: false, warn: false, label: "Disattivata", counts: [] };
  }
  return { key: "configurazione", ok: true, warn: false, label: "Attiva", counts: [] };
}

/**
 * Provider (intelligenze multiple): senza NESSUNA chiave salvata Ambrosio
 * non può rispondere → ambra «Chiave mancante», azione attesa. Con almeno
 * una chiave è verde «Chiave salvata» (niente fallback configurato NON è
 * un errore: una chiave sola è una scelta legittima).
 */
export function providerStatus(hasKey: boolean): HubCardStatus {
  return {
    key: "provider",
    ok: Boolean(hasKey),
    warn: !hasKey,
    label: hasKey ? "Chiave salvata" : "Chiave mancante",
    counts: [],
  };
}

/**
 * Autonomia: il livello attivo è SEMPRE una scelta deliberata (mai un
 * incompletezza), quindi mai ambra — la pill mostra il livello corrente
 * come stato, non come allarme. Lo stesso nome vive in AMBROSIO_LEVELS:
 * qui la copia letterale evita di tirare nel layer puro il catalogo,
 * il test di coerenza verifica che non divergano.
 */
export function autonomyStatus(level: number): HubCardStatus {
  const l = level === 2 || level === 3 ? level : 1;
  const names: Record<number, string> = { 1: "L1 · Contatto", 2: "L2 · Qualifica", 3: "L3 · Proposta" };
  return { key: "autonomia", ok: true, warn: false, label: names[l], counts: [] };
}

/** Documenti: zero documenti attivi = Ambrosio non istruito oltre al prompt → ambra. */
export function documentsStatus(activeDocs: number): HubCardStatus {
  const n = Math.max(0, Number(activeDocs) || 0);
  return {
    key: "documenti",
    ok: n > 0,
    warn: n === 0,
    label: n === 0 ? "Nessun documento" : n === 1 ? "1 documento" : `${n} documenti`,
    counts: [],
  };
}

/** Proposte: bozze in attesa di revisione = azione attesa → ambra; zero = verde. */
export function proposalsStatus(drafts: number): HubCardStatus {
  const d = Math.max(0, Number(drafts) || 0);
  return {
    key: "proposte",
    ok: d === 0,
    warn: d > 0,
    label: d === 0 ? "Nessuna da revisionare" : d === 1 ? "1 da revisionare" : `${d} da revisionare`,
    counts: [],
  };
}
