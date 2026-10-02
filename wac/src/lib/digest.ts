import { db } from "@/lib/db";
import { sendEmailViaTools } from "@/lib/email-tools";
import { logAudit } from "@/lib/audit";
import { nowInRome } from "@/lib/operators";
import { digestSubject, digestLines, isMorningDigestTime } from "@/lib/digest-format";
import { getOverviewConfig } from "@/lib/overview-status";
import { slaAgendaStatus, recallsAgendaStatus } from "@/lib/settings-status";
import type { DigestItem, DigestSection } from "@/lib/digest-format";

/**
 * DIGEST MATTUTINO (server-only): una email al giorno, nella finestra 6–9
 * di Roma, con l'«Agenda di oggi» della Panoramica — le STESSHE fonti,
 * le STESSHE regole: overview-status per la configurazione, le funzioni
 * pure dell'agenda per SLA e promesse. Nessuna regola duplicata.
 *
 * Dedup: content_settings key `morning_digest_sent` = {"date": "2026-09-26"}
 * — un digest per giorno anche se il cron passa 4 volte nella finestra
 * (tick ogni 15 min). Il flag scade da solo: la mattina dopo lo si riscrive.
 *
 * Silenzio onesto: se non c'è nulla da dire, NON si invia (il default è
 * non spammare; `includeWhenClear` resta disponibile per chi lo vuole).
 * Invio best-effort come tutto il cron: un fallimento non tocca gli altri
 * automatismi, l'esito va in audit (`digest.inviato` / `digest.errore`).
 */

const DIGEST_FLAG_KEY = "morning_digest_sent";

/** Oggi a Roma, come stringa YYYY-MM-DD (chiave del dedup giornaliero). */
function todayRome(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Destinatari: gli account admin esistenti (la email è l'identità di login). */
async function adminRecipients(): Promise<string[]> {
  const pool = db();
  if (!pool) return [];
  try {
    const { rows } = await pool.query<{ email: string }>(
      "select email from admin_users order by email",
    );
    return rows.map((r) => r.email).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Le due sezioni del digest dalle STESSHE fonti della Panoramica.
 * - Operativo: SLA + promesse, con la nota qualificata («!» = rosso).
 * - Configurazione: le schede ambra dei tre hub, via pendingOf.
 */
async function buildDigestSections(_baseUrl: string): Promise<{
  operational: DigestSection | null;
  configuration: DigestSection;
}> {
  const pool = db();
  const [config] = await Promise.all([getOverviewConfig()]);

  // ── Operativo: SLA e promesse, le stesse query della dashboard ─────
  let slaBreaches = 0;
  let openTickets = 0;
  let recallsTotal = 0;
  let recallsOverdue = 0;
  if (pool) {
    try {
      const { rows } = await pool.query<{
        open_tickets: string;
        sla_breach: string;
        recalls_total: string;
        recalls_overdue: string;
      }>(
        `select
           (select count(*) from conversations where status <> 'closed') as open_tickets,
           (select count(*) from conversations where status <> 'closed' and first_response_at is null and created_at < now() - interval '2 hours') as sla_breach,
           (select count(*) from leads
              where ricontatta_il is not null
                and ricontatta_il < now() + interval '12 hours'
                and status <> 'chiuso') as recalls_total,
           (select count(*) from leads
              where ricontatta_il is not null
                and ricontatta_il < now() + interval '12 hours'
                and status <> 'chiuso'
                and ricontatta_il < now()) as recalls_overdue`,
      );
      const r = rows[0];
      if (r) {
        openTickets = Number(r.open_tickets);
        slaBreaches = Number(r.sla_breach);
        recallsTotal = Number(r.recalls_total);
        recallsOverdue = Number(r.recalls_overdue);
      }
    } catch {
      // tabelle non migrate: l'operativo sparisce, la configurazione resta
    }
  }

  const sla = slaAgendaStatus(slaBreaches, openTickets);
  const recalls = recallsAgendaStatus(recallsTotal, recallsOverdue);
  /** Rosso = scadenza violata: !ok && !warn (stessa regola di HubStatus danger). */
  const isDanger = (s: { ok: boolean; warn: boolean }) => !s.ok && !s.warn;
  const operationalItems: DigestItem[] = [];
  if (!sla.ok) {
    operationalItems.push({
      label: "SLA dei ticket",
      note: `${isDanger(sla) ? "!" : ""}${sla.label}`,
      href: "/admin/tickets",
    });
  }
  if (!recalls.ok) {
    operationalItems.push({
      label: "Promesse da richiamare",
      note: `${isDanger(recalls) ? "!" : ""}${recalls.label}`,
      href: "/admin/leads",
    });
  }
  const operational: DigestSection | null = operationalItems.length
    ? { title: "Operativo", items: operationalItems }
    : null;

  // ── Configurazione: le schede ambra dei tre hub (stesso pendingOf) ──
  const configurationItems: DigestItem[] = [];
  for (const row of config) {
    for (const p of row.pending) {
      configurationItems.push({ label: p.label, note: row.warn ? "Da completare" : "Da collegare", href: p.href });
    }
  }
  const configuration: DigestSection = { title: "Configurazione", items: configurationItems };

  return { operational, configuration };
}

/**
 * Il punto d'ingresso per il cron: ritorna «skipped» fuori finestra o se
 * il digest di oggi è già partito; «sent»/«failed» altrimenti.
 */
export async function sendMorningDigest(
  opts: { baseUrl?: string; now?: Date } = {},
): Promise<{ outcome: "sent" | "skipped" | "failed" | "empty"; detail: string }> {
  const now = opts.now ?? nowInRome();
  const hour = now.getHours();

  if (!isMorningDigestTime(hour)) {
    return { outcome: "skipped", detail: `fuori finestra (${hour}:00 Roma)` };
  }

  const pool = db();
  if (!pool) return { outcome: "skipped", detail: "db non configurato" };

  // Dedup giornaliero: la prima chiamata utile nella finestra vince.
  try {
    const { rows } = await pool.query<{ value: { date?: string } | null }>(
      "select value from content_settings where key = $1",
      [DIGEST_FLAG_KEY],
    );
    if (rows[0]?.value?.date === todayRome(now)) {
      return { outcome: "skipped", detail: "già inviato oggi" };
    }
  } catch {
    // flag non leggibile: si procede (peggio un doppione che un silenzio)
  }

  const baseUrl = (opts.baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const { operational, configuration } = await buildDigestSections(baseUrl);

  const recipients = await adminRecipients();
  if (recipients.length === 0) {
    return { outcome: "skipped", detail: "nessun admin destinatario" };
  }

  // Nessun pendio → silenzio (vedi digest-format.ts).
  if (!operational && configuration.items.length === 0) {
    await pool
      .query(
        "insert into content_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb",
        [DIGEST_FLAG_KEY, JSON.stringify({ date: todayRome(now) })],
      )
      .catch(() => {});
    return { outcome: "empty", detail: "nessun pendio: nessuna email (flag comunque impostato)" };
  }

  const subject = digestSubject({ operational, configuration });
  const text = [
    "Agenda di oggi — Web Agency Crema",
    "",
    ...digestLines({ baseUrl, operational, configuration }),
    "",
    `Apri la Panoramica: ${baseUrl}/admin`,
  ].join("\n");

  let sent = 0;
  const errors: string[] = [];
  for (const to of recipients) {
    const r = await sendEmailViaTools({ to, subject, text });
    if (r.ok) sent++;
    else errors.push(`${to}: ${r.error}`);
  }

  // Flag scritto SOLO se almeno un invio è riuscito: un fallimento SMTP
  // totale riprova al prossimo tick (15 min dopo, ancora in finestra).
  if (sent > 0) {
    await pool
      .query(
        "insert into content_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb",
        [DIGEST_FLAG_KEY, JSON.stringify({ date: todayRome(now), sent })],
      )
      .catch(() => {});
    await logAudit(
      "system",
      "digest.inviato",
      `${sent}/${recipients.length}`,
      subject,
    );
    if (errors.length) {
      await logAudit("system", "digest.errore", null, errors.join("; ").slice(0, 500));
    }
    return { outcome: "sent", detail: `${sent}/${recipients.length} destinatari` };
  }

  await logAudit("system", "digest.errore", null, errors.join("; ").slice(0, 500) || "invio fallito");
  return { outcome: "failed", detail: errors.join("; ") || "invio fallito" };
}
