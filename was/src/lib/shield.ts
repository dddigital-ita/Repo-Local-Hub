import { db } from "./db";
import { clientIp } from "./rate-limit";

/**
 * Shield Security: scudo anti-hack / anti-spambot per il sito.
 * - Ban persistente su DB (i rate limit in-memory valgono per istanza; il ban no)
 * - Honeypot: campi trappola che solo i bot riempiono
 * - Log eventi consultabile in /admin/shield con sblocco IP
 */

export type ShieldKind = "rate_limit" | "honeypot" | "bad_payload" | "ban" | "unban";

const BAN_THRESHOLD = 3; // violazioni entro la finestra → ban automatico
const BAN_WINDOW_MS = 10 * 60 * 1000; // 10 minuti
const BAN_DURATION_HOURS = 24;

/* ── Log su DB (mai bloccante: il fallo non deve fermare il sito) ── */

export function shieldLog(ip: string, kind: ShieldKind, endpoint?: string, detail?: string): void {
  const pool = db();
  if (!pool) return;
  pool
    .query("insert into shield_events (ip, kind, endpoint, detail) values ($1, $2, $3, $4)", [
      ip,
      kind,
      endpoint ?? null,
      detail ?? null,
    ])
    .catch(() => {});
}

/* ── Ban persistente ── */

async function isBanned(ip: string): Promise<boolean> {
  const pool = db();
  if (!pool || ip === "unknown") return false;
  try {
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from shield_bans where ip = $1 and expires_at > now()",
      [ip],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

async function countRecentViolations(ip: string): Promise<number> {
  const pool = db();
  if (!pool) return 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from shield_events
       where ip = $1 and kind in ('rate_limit','honeypot','bad_payload')
       and created_at > now() - ($2 || ' minutes')::interval`,
      [ip, String(BAN_WINDOW_MS / 60000)],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

async function banIp(ip: string, reason: string, endpoint?: string): Promise<void> {
  const pool = db();
  if (!pool || ip === "unknown") return;
  try {
    await pool.query(
      `insert into shield_bans (ip, reason) values ($1, $2)
       on conflict (ip) do update set reason = $2, created_at = now(), expires_at = now() + ($3 || ' hours')::interval`,
      [ip, reason, String(BAN_DURATION_HOURS)],
    );
    shieldLog(ip, "ban", endpoint, reason);
    // Allerta al telefono del team di turno (quando Telegram e configurato)
    // @ts-expect-error -- import dinamico risolto da webpack anche senza estensione
    const { notifyShieldBan } = await import("./notify");
    notifyShieldBan({ ip, reason, endpoint }).catch(() => {});
  } catch {}
}

/**
 * Guardia principale da chiamare all'inizio di ogni endpoint pubblico.
 * Ritorna null se tutto ok, altrimenti la risposta 429/403 già pronta.
 */
export async function shieldCheck(
  req: Request,
  // Parametro tenuto per compatibilità con i chiamanti (signature stabile):
  // il check attuale guarda solo il ban sull'IP.
  _endpoint: string,
): Promise<{ status: number; reason: string } | null> {
  const ip = clientIp(req.headers);

  if (await isBanned(ip)) {
    return { status: 429, reason: "IP temporaneamente bloccato da Shield. Riprova più tardi." };
  }
  return null;
}

/** Dopo una violazione: logga e, superata la soglia, banna. Ritorna true se appena bannato. */
export async function shieldViolate(
  req: Request,
  kind: ShieldKind,
  endpoint: string,
  detail?: string,
): Promise<boolean> {
  const ip = clientIp(req.headers);
  shieldLog(ip, kind, endpoint, detail);
  const violations = await countRecentViolations(ip);
  if (violations >= BAN_THRESHOLD) {
    await banIp(
      ip,
      `${violations} violazioni in ${BAN_WINDOW_MS / 60000} minuti (${kind} su ${endpoint})`,
      endpoint,
    );
    return true;
  }
  return false;
}

/* ── Honeypot: i bot riempiono i campi trappola, le persone no ── */

/** Campo trappola da aggiungere ai form pubblici (visivamente nascosto). */
export const HONEYPOT_FIELD = "website_url";

/** true se l'honeypot è stato riempito → è un bot. */
export function honeypotTripped(body: Record<string, unknown>): boolean {
  const v = body[HONEYPOT_FIELD];
  return typeof v === "string" && v.trim().length > 0;
}

/* ── Statistiche per la dashboard ── */

export interface ShieldStats {
  events24h: number;
  byKind: { kind: string; n: number }[];
  activeBans: { ip: string; reason: string; expires_at: string }[];
  recent: { ip: string; kind: string; endpoint: string | null; detail: string | null; created_at: string }[];
  /** Conteggi ultimi 7 giorni per tipo (tutti i kind presenti, anche 0 per i noti). */
  byKind7d: { kind: string; n: number }[];
  /** Finestra attiva sulla lista «Eventi recenti": null = tutti. */
  kindFilter: string | null;
}

/** I tipi noti (la UI mostra il conteggio anche a zero). */
export const SHIELD_KINDS = ["rate_limit", "honeypot", "bad_payload", "ban", "unban"] as const;

export async function getShieldStats(kindFilter?: string | null): Promise<ShieldStats> {
  const empty: ShieldStats = { events24h: 0, byKind: [], activeBans: [], recent: [], byKind7d: [], kindFilter: null };
  const pool = db();
  if (!pool) return empty;
  try {
    const totals = await pool.query<{ kind: string; n: string }>(
      `select kind, count(*) as n from shield_events
       where created_at > now() - interval '24 hours' group by kind order by n desc`,
    );
    const bans = await pool.query<{ ip: string; reason: string; expires_at: string }>(
      "select ip, reason, expires_at from shield_bans where expires_at > now() order by created_at desc limit 20",
    );
    const recent = await pool.query<{
      ip: string;
      kind: string;
      endpoint: string | null;
      detail: string | null;
      created_at: string;
    }>(
      // Con filtro attivo: solo quel tipo (limit più alto, la lista è il motivo del filtro).
      kindFilter
        ? "select ip, kind, endpoint, detail, created_at from shield_events where kind = $1 order by created_at desc limit 50"
        : "select ip, kind, endpoint, detail, created_at from shield_events order by created_at desc limit 25",
      kindFilter ? [kindFilter] : [],
    );
    const week = await pool.query<{ kind: string; n: string }>(
      `select kind, count(*) as n from shield_events
       where created_at > now() - interval '7 days' group by kind`,
    );
    const weekMap = new Map(week.rows.map((r) => [r.kind, Number(r.n)]));
    // Tutti i tipi noti a zero + eventuali tipi non previsti comparsi nel DB.
    const byKind7d = [
      ...SHIELD_KINDS.map((k) => ({ kind: k, n: weekMap.get(k) ?? 0 })),
      ...[...weekMap.entries()].filter(([k]) => !SHIELD_KINDS.includes(k as (typeof SHIELD_KINDS)[number])).map(([kind, n]) => ({ kind, n })),
    ];
    const byKind = totals.rows.map((r) => ({ kind: r.kind, n: Number(r.n) }));
    return {
      events24h: byKind.reduce((a, b) => a + b.n, 0),
      byKind,
      activeBans: bans.rows,
      recent: recent.rows,
      byKind7d,
      // Filtro validato: solo tipi noti o già visti nel DB (mai SQL injection:
      // è un parametro bindato, ma un filtro assurdo produrrebbe una lista vuota).
      kindFilter: kindFilter && byKind7d.some((k) => k.kind === kindFilter) ? kindFilter : null,
    };
  } catch {
    return empty;
  }
}

/* ── Pannello «Reset password» in Shield ──
 * /admin/password-dimenticata è pubblico e invia email: bersaglio di spam.
 * Gli tentativi finiscono nell'audit (password.reset_*): qui li rendiamo
 * visibili a colpo d'occhio, classificati per esito. */

export interface ResetAttempt {
  actor: string;
  outcome: "ok" | "fallito" | "captcha" | "rate" | "reset_done";
  detail: string | null;
  created_at: string;
}

export interface ResetAttemptsSummary {
  attempts: ResetAttempt[];
  last24h: number;
  falliti24h: number;
}

/** Classifica una riga di audit password.reset_* in un esito leggibile. */
export function classifyResetAttempt(detail: string | null): ResetAttempt["outcome"] {
  if (detail === "self-service") return "reset_done";
  if (!detail) return "ok";
  if (detail.startsWith("invio fallito")) return "fallito";
  if (detail === "email_non_configurata") return "fallito";
  return "ok";
}

export async function getResetAttempts(): Promise<ResetAttemptsSummary> {
  const empty: ResetAttemptsSummary = { attempts: [], last24h: 0, falliti24h: 0 };
  const pool = db();
  if (!pool) return empty;
  try {
    const { rows } = await pool.query<{
      actor: string;
      detail: string | null;
      created_at: string;
    }>(
      `select actor, detail, created_at from audit_log
       where action in ('password.reset_request', 'password.reset_done')
         and created_at > now() - interval '48 hours'
       order by created_at desc limit 12`,
    );
    // Il blocco captcha/rate NON scrive in audit (è un redirect prima della
    // richiesta): quei contatori vivono nel rate limiter in-memory. Quello che
    // l'audit racconta è ciò che è EFFETTIVAMENTE arrivato al flusso email.
    const attempts: ResetAttempt[] = rows.map((r) => ({
      actor: r.actor,
      outcome: classifyResetAttempt(r.detail),
      detail: r.detail,
      created_at: r.created_at,
    }));
    const day = await pool.query<{ n: string; falliti: string }>(
      `select count(*) as n,
              count(*) filter (where detail like 'invio fallito%') as falliti
       from audit_log
       where action = 'password.reset_request'
         and created_at > now() - interval '24 hours'`,
    );
    return {
      attempts,
      last24h: Number(day.rows[0]?.n ?? 0),
      falliti24h: Number(day.rows[0]?.falliti ?? 0),
    };
  } catch {
    return empty;
  }
}

/** Sblocca un IP bannato (azione manuale dall'admin). */
export async function unbanIp(ip: string, byEmail: string): Promise<boolean> {
  const pool = db();
  if (!pool) return false;
  try {
    const res = await pool.query("delete from shield_bans where ip = $1", [ip]);
    shieldLog(ip, "unban", undefined, `sbloccato da ${byEmail}`);
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}
