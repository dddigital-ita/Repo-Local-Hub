/**
 * DIGEST SERALE TELEGRAM (server-only): ogni sera, nella finestra 20–23 di
 * Roma, il riepilogo di cosa ha fatto Ambrosio durante la giornata — lead
 * salvati, conversazioni seguite, passaggi al team, callback fissate con
 * slot e nome — sulle STESSHE chat del team che ricevono le notifiche
 * (TELEGRAM_CHAT_ID, notify.ts). Nessuna config nuova: il canale è lo stesso
 * dei campanelli, il destinatario è chi già legge quei messaggi.
 *
 * Struttura identica al digest mattutino (digest.ts): finestra oraria,
 * dedup giornaliero su content_settings, silenzio onesto gestito nel
 * formato, invio best-effort con esito in audit. Le query contano i
 * messaggi di OGGI (giorno civile di Roma): lo storico resta nel CRM.
 */
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { nowInRome } from "@/lib/operators";
import { sendMessage } from "@/lib/telegram";
import { getEffectiveTelegramConfig } from "@/lib/telegram-config";
import {
  isEveningDigestTime,
  eveningDigestLines,
  eveningDigestHeadline,
  type EveningCallback,
  type EveningCount,
} from "@/lib/telegram-digest-format";

const DIGEST_FLAG_KEY = "evening_digest_sent";

/** Oggi a Roma, come stringa YYYY-MM-DD (chiave del dedup giornaliero). */
function todayRome(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** «domenica 28 settembre» — la data come la legge un umano italiano. */
function dateLabelRome(now: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

interface DayStats {
  questions: number; // conversazioni con almeno un messaggio bot di Ambrosio oggi
  leads: number; // lead salvati da Ambrosio oggi (source = 'ai')
  leadSources: EveningCount[]; // ripartizione per canale di provenienza
  handoffs: number; // passaggi al team oggi (audit ambrosio.handoff)
  callbacks: EveningCallback[]; // callback fissate oggi da Ambrosio
}

/** Le fonti del digest: tre query di conteggio, ognuna degredisce da sola. */
async function collectDayStats(now: Date): Promise<DayStats> {
  const pool = db();
  const empty: DayStats = { questions: 0, leads: 0, leadSources: [], handoffs: 0, callbacks: [] };
  if (!pool) return empty;

  // «Oggi» = giorno civile di Roma: le conversation sono UTC, quindi si
  // confronta la data LOCALE dell'istante (created_at AT TIME ZONE):
  // un messaggio delle 00:30 di Roma il 29 non entra nel 28.
  const today = todayRome(now);

  // 1. Conversazioni seguite: bot attivo oggi su thread con interazione.
  let questions = 0;
  let leads = 0;
  let leadSources: EveningCount[] = [];
  try {
    const { rows } = await pool.query<{ questions: string; leads: string }>(
      `select
         (select count(distinct m.conversation_id) from messages m
            join conversations c on c.id = m.conversation_id
            where m.sender = 'bot'
              and (m.created_at at time zone 'Europe/Rome')::date = $1::date) as questions,
         (select count(*) from leads l
            where l.source = 'ai'
              and (l.created_at at time zone 'Europe/Rome')::date = $1::date) as leads`,
      [today],
    );
    questions = Number(rows[0]?.questions ?? 0);
    leads = Number(rows[0]?.leads ?? 0);
  } catch (e) {
    console.error("[telegram-digest] conteggi giorno:", e);
  }

  // Ripartizione canale dei lead di oggi (web = chat sito, telegram = bot).
  try {
    const { rows } = await pool.query<{ channel: string; n: string }>(
      `select coalesce(c.channel, 'web') as channel, count(*) as n
       from leads l join conversations c on c.id = l.conversation_id
       where l.source = 'ai' and (l.created_at at time zone 'Europe/Rome')::date = $1::date
       group by 1 order by 2 desc`,
      [today],
    );
    leadSources = rows.map((r) => ({ label: r.channel, n: Number(r.n) }));
  } catch {
    leadSources = []; // dettaglio non disponibile: il totale resta nel digest
  }

  // 2. Passaggi al team: l'audit è la fonte più onesta (già filtrata sulle
  //    transizioni vere) — stesso giorno civile di Roma.
  let handoffs = 0;
  try {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from audit_log
       where action = 'ambrosio.handoff'
         and (created_at at time zone 'Europe/Rome')::date = $1::date`,
      [today],
    );
    handoffs = Number(rows[0]?.n ?? 0);
  } catch (e) {
    console.error("[telegram-digest] handoff:", e);
  }

  // 3. Callback fissate oggi da Ambrosio (slot + nome per il team).
  let callbacks: EveningCallback[] = [];
  try {
    const { rows } = await pool.query<{ slot_label: string; lead_name: string | null }>(
      `select cb.slot_label, l.name as lead_name
       from callbacks cb
       left join leads l on l.id = cb.lead_id
       where (cb.created_at at time zone 'Europe/Rome')::date = $1::date
         and cb.slot_label is not null
       order by cb.created_at`,
      [today],
    );
    callbacks = rows.map((r) => ({ slot: r.slot_label, name: r.lead_name }));
  } catch (e) {
    console.error("[telegram-digest] callback:", e);
  }

  return { questions, leads, leadSources, handoffs, callbacks };
}

/**
 * Il punto d'ingresso per il cron: ritorna «skipped» fuori finestra o se il
 * digest di oggi è già partito; «sent»/«failed»/«empty» altrimenti.
 * Stessa disciplina del digest mattutino: il flag si scrive SOLO se almeno
 * un invio è riuscito (un fallimento totale riprova al prossimo tick).
 */
export async function sendEveningDigest(
  opts: { now?: Date } = {},
): Promise<{ outcome: "sent" | "skipped" | "failed" | "empty"; detail: string }> {
  const now = opts.now ?? nowInRome();
  const hour = now.getHours();

  if (!isEveningDigestTime(hour)) {
    return { outcome: "skipped", detail: `fuori finestra (${hour}:00 Roma)` };
  }

  const pool = db();
  if (!pool) return { outcome: "skipped", detail: "db non configurato" };

  const cfg = await getEffectiveTelegramConfig();
  if (!cfg || cfg.teamChatIds.length === 0) {
    return { outcome: "skipped", detail: "telegram non configurato (token o chat team)" };
  }

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

  const stats = await collectDayStats(now);
  const input = {
    dateLabel: dateLabelRome(now),
    questions: stats.questions,
    leads: stats.leads,
    leadSources: stats.leadSources,
    handoffs: stats.handoffs,
    callbacks: stats.callbacks,
  };
  const lines = eveningDigestLines(input);

  // Nessuna attività → si dice lo stesso (giornata quieta): il formato è
  // già pronto, il team distingue «tutto ok» da «digest rotto».
  const headline = eveningDigestHeadline(input);
  const text = [headline, "", ...lines].join("\n");

  let delivered = 0;
  const errors: string[] = [];
  for (const chatId of cfg.teamChatIds) {
    try {
      await sendMessage(cfg.token, chatId, text);
      delivered++;
    } catch (e) {
      errors.push(`${chatId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (delivered > 0) {
    await pool
      .query(
        "insert into content_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb",
        [DIGEST_FLAG_KEY, JSON.stringify({ date: todayRome(now), delivered })],
      )
      .catch(() => {});
    await logAudit("system", "telegram.digest_sera", `${delivered}/${cfg.teamChatIds.length}`, headline);
    if (errors.length) {
      await logAudit("system", "telegram.digest_sera_errore", null, errors.join("; ").slice(0, 500));
    }
    return { outcome: "sent", detail: `${delivered}/${cfg.teamChatIds.length} chat team` };
  }

  await logAudit("system", "telegram.digest_sera_errore", null, errors.join("; ").slice(0, 500) || "invio fallito");
  return { outcome: "failed", detail: errors.join("; ") || "invio fallito" };
}
