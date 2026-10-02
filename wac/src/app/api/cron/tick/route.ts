import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyAdmin } from "@/lib/notify";
import { logAudit } from "@/lib/audit";
import { backupReminderDue, markBackupReminderSent } from "@/lib/maintenance";
import { sendLeadFollowup, claimSlaTakeoverCandidates, releaseTakeoverClaim, AI_ACTOR, setToolLevel } from "@/lib/ai-tools";
import { pullCalendarHub } from "@/lib/calendar-hub";
import { getAutonomyConfig } from "@/lib/ambrosio-server";
import { takeoverEnabled, takeoverAnnouncement } from "@/lib/ambrosio-autonomy";
import { syncClients, isClientsSyncEnabled } from "@/lib/clients";
import { ingestEmails } from "@/lib/email-tools";
import { sendMorningDigest } from "@/lib/digest";
import { sendEveningDigest } from "@/lib/telegram-digest";
import { takeSeoBackup } from "@/lib/seo-backups";
import { runCloudBackup, allarmeBackupCloudSeDovuto } from "@/lib/backup-cloud";
import { pollTelegramUpdates } from "@/lib/telegram-ingest";
import type { Lang } from "@/lib/language";
import { loadOperators } from "@/lib/server-context";
import { onDutyOperator, nowInRome } from "@/lib/operators";

export const dynamic = "force-dynamic";

/**
 * CRON FASE 2 — automazioni temporali del ticketing.
 *
 * Invocato da Vercel Cron (vercel.json) o a mano con la chiave:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3200/api/cron/tick
 *
 * Idempotente: ogni azione ha un flag persistente (dedup), quindi ri-eseguire
 * il tick non duplica notifiche né azioni. Ogni automatismo scrive in audit
 * con actor='system': le azioni della macchina sono distinte da quelle umane.
 *
 * Cosa fa a ogni tick:
 *  1. SLA «scade presto» (meno di 25 minuti alla scadenza) → avviso, flag sla_warned_at
 *  2. SLA «scaduto» → breach, flag sla_breached_at
 *  3. Callback pending con orario passata da >1h → 'missed' + avviso
 *  4. Ticket «In attesa cliente» da N giorni → chiusura automatica (default: OFF)
 *  5. Lead spariti da N ore dopo l'ultimo messaggio → UN follow-up di Ambrosio
 *     nel thread (dedup: followup_sent_at; default ON, 48h; chiave lead_followup_hours)
 *  6. Polling canale email → email diventano ticket/risposte (dedup Message-ID)
 *  7. Promemoria backup: l'ultimo export è più vecchio di N giorni
 *     (default 7; chiave backup_reminder_days; 0 = disattivato)
 *  8. Backup automatico settimanale config SEO
 *  9. Portafoglio clienti: Ambrosio riconcilia i ticket nuovi con le
 *     schede clienti (dedup roster client_conversations; disattivabile
 *     con content_settings key clients_sync_enabled = {"enabled": false})
 */

const CRON_USER_AGENT = "vercel-cron/1.0";

function authorized(req: Request): boolean {
  // Vercel Cron firma con lo user-agent specifico; in locale/manualmente vale CRON_SECRET.
  if (req.headers.get("user-agent")?.startsWith(CRON_USER_AGENT)) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const pool = db();
  if (!pool) {
    return NextResponse.json({ ok: false, error: "db_not_configured" }, { status: 503 });
  }

  const summary = {
    slaWarn: 0,
    slaBreach: 0,
    callbackMissed: 0,
    autoClosed: 0,
    leadFollowup: 0,
    emailCreated: 0,
    emailReplied: 0,
    seoBackup: 0,
    clientsSynced: 0,
    cloudBackup: "" as string,
    cloudBackupAlarm: "" as string,
    aiTakeover: 0,
    digest: "",
    telegramIn: 0,
    eveningDigest: "",
    calendarPull: 0,
  };

  try {
    /* ── 1. SLA «scade presto» ───────────────────────────────────────── */
    // Stessa soglia percepita dal badge: quando manca meno di 25 minuti alla
    // scadenza del clock dell'agente. Flag dedup: un avviso per scadenza.
    const { rows: warned } = await pool.query<{ id: string; number: number; lead_name: string | null }>(
      `update conversations c set sla_warned_at = now()
       where c.sla_next_reply_due is not null
         and c.sla_warned_at is null
         and c.sla_next_reply_due > now()
         and c.sla_next_reply_due - now() < interval '25 minutes'
       returning c.id, c.number,
         (select l.name from leads l where l.id = c.lead_id) as lead_name`,
    );
    if (warned.length) {
      summary.slaWarn = warned.length;
      await notifyAdmin(
        `⏳ SLA in scadenza: ${warned.length} ticket`,
        warned
          .map((t) => `#${t.number} ${t.lead_name ?? ""} — rispondi entro pochi minuti\n${baseUrl()}/admin/tickets?t=${t.id}`)
          .join("\n\n"),
      );
      await logAudit("system", "cron.sla-warn", warned.map((w) => w.number).join(","), `${warned.length} ticket in scadenza`);
    }

    /* ── 2. SLA «scaduto» ────────────────────────────────────────────── */
    const { rows: breached } = await pool.query<{ id: string; number: number; lead_name: string | null }>(
      `update conversations c set sla_breached_at = now(), sla_warned_at = coalesce(sla_warned_at, now())
       where c.sla_next_reply_due is not null
         and c.sla_breached_at is null
         and c.sla_next_reply_due <= now()
       returning c.id, c.number,
         (select l.name from leads l where l.id = c.lead_id) as lead_name`,
    );
    if (breached.length) {
      summary.slaBreach = breached.length;
      await notifyAdmin(
        `🚨 SLA scaduto: ${breached.length} ticket`,
        breached
          .map((t) => `#${t.number} ${t.lead_name ?? ""} — il cliente aspetta da troppo\n${baseUrl()}/admin/tickets?t=${t.id}`)
          .join("\n\n"),
      );
      await logAudit("system", "cron.sla-breach", breached.map((b) => b.number).join(","), `${breached.length} ticket scaduti`);
    }

    /* ── 3. Callback mancate ─────────────────────────────────────────── */
    // Pending con orario passato da oltre un'ora: nessuno ha chiamato (o
    // nessuno ha segnato). Un impegno preso in chat non può sparire nel silenzio.
    const { rows: missed } = await pool.query<{ id: string; slot_label: string | null; lead_name: string | null }>(
      `update callbacks cb set status = 'missed'
       where cb.status = 'pending'
         and cb.scheduled_at < now() - interval '1 hour'
       returning cb.id, cb.slot_label,
         (select l.name from leads l where l.id = cb.lead_id) as lead_name`,
    );
    if (missed.length) {
      summary.callbackMissed = missed.length;
      await notifyAdmin(
        `📞 Callback mancate: ${missed.length}`,
        missed
          .map((cb) => `${cb.lead_name ?? "visitatore"} — slot «${cb.slot_label ?? "?"}» mai evaso\n${baseUrl()}/admin/callbacks`)
          .join("\n"),
      );
      await logAudit("system", "cron.callback-missed", missed.map((m) => m.id).join(","), `${missed.length} callback marcate mancate`);
    }

    /* ── 4. Chiusura automatica (default OFF) ─────────────────────── */
    // content_settings key ticket_autoclose_days: giorni di attesa del cliente
    // prima di chiudere i ticket «In attesa cliente». Assente/0 = disattivata.
    const { rows: cfg } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = 'ticket_autoclose_days'",
    );
    const days = Number(cfg[0]?.value);
    if (Number.isFinite(days) && days >= 1 && days <= 60) {
      const { rows: closedRows } = await pool.query<{ id: string; number: number }>(
        `update conversations c set status = 'closed', closed_at = now(), closed_by = null,
                sla_next_reply_due = null, sla_resolve_due = null, awaiting_notified_at = null
         where c.status = 'waiting_customer'
           and c.updated_at < now() - ($1 || ' days')::interval
         returning c.id, c.number`,
        [String(Math.round(days))],
      );
      if (closedRows.length) {
        summary.autoClosed = closedRows.length;
        await logAudit("system", "cron.auto-close", closedRows.map((x) => x.number).join(","), `chiusi dopo ${Math.round(days)} giorni di attesa cliente`);
      }
    }

    /* ── 5. Follow-up unico ai lead spariti (default ON, 48h) ───────── */
    // Il visitatore ha lasciato un lead (nome+telefono+consenso) e poi è
    // sparito: UN solo messaggio di Ambrosio nel thread della chat, che
    // ritroverà riaprendo il widget. Dedup esplicito: followup_sent_at.
    // Criteri (tutti in AND):
    //  - status lead_captured (il bot ha qualificato, nessun umano coinvolto);
    //  - silence > N ore dall'ULTIMO messaggio del VISITATORE;
    //  - l'ultimo messaggio del thread non è già nostro (non interrompo);
    //  - followup_sent_at is null (mai seguito prima).
    const { rows: fCfg } = await pool.query<{ value: unknown }>(
      "select value from content_settings where key = 'lead_followup_hours'",
    );
    const fHours = Number(fCfg[0]?.value ?? "48");
    if (Number.isFinite(fHours) && fHours >= 1) {
      const { rows: candidates } = await pool.query<{ id: string; number: number; lead_name: string | null; language: string | null }>(
        `select c.id, c.number, c.language,
           (select l.name from leads l where l.id = c.lead_id) as lead_name
         from conversations c
         where c.followup_sent_at is null
           and c.followup_disabled_at is null
           and c.status = 'lead_captured'
           and c.archived_at is null
           and (
             select max(m.created_at) from messages m
             where m.conversation_id = c.id and m.sender = 'visitor'
           ) < now() - ($1 || ' hours')::interval
           and (
             select m2.sender from messages m2
             where m2.conversation_id = c.id
             order by m2.created_at desc limit 1
           ) <> 'bot'`,
        [String(Math.max(1, Math.round(fHours)))],
      );
      for (const t of candidates) {
        // Nome dell'operatore del prossimo turno per personalizzare il messaggio;
        // mai bloccante: se fallisce, il claim resta (follow-up non partito, accettabile).
        let who: string | null = null;
        try {
          const now = nowInRome();
          const ops = await loadOperators();
          who = (onDutyOperator(ops, now) ?? ops[0])?.firstName ?? null;
        } catch {
          who = null;
        }
        const r = await sendLeadFollowup(t.id, { operatorName: who, lang: (t.language ?? "it") as Lang });
        if (r.ok) summary.leadFollowup++;
        else console.warn(`[cron/tick] followup #${t.number}: ${r.detail}`);
      }
    }

    /* ── 11. TAKE-OVER SLA di Ambrosio (solo L3 con switch attivo) ─── */
    // Un ticket che ha superato la finestra «prossima risposta» non deve
    // aspettare l'apertura della inbox: Ambrosio subentra, raccoglie le
    // informazioni giuste e prepara la BOZZA di proposta con preventivo.
    // L'umano resta nel loop: la proposta non parte mai da sola (stato draft).
    try {
      const autoCfg = await getAutonomyConfig();
      if (takeoverEnabled(autoCfg.level, autoCfg.takeoverSla)) {
        const candidates = await claimSlaTakeoverCandidates(3);
        if (candidates.length) {
          setToolLevel(3); // il take-over usa i poteri del livello 3
          for (const t of candidates) {
            try {
              // Operatore del prossimo turno per non promettere l'impossibile.
              let who: string | null = null;
              try {
                const now = nowInRome();
                const ops = await loadOperators();
                who = (onDutyOperator(ops, now) ?? ops[0])?.firstName ?? null;
              } catch {
                who = null;
              }
              // Annuncio nel thread: il cliente SA che è Ambrosio e cosa succede.
              await pool.query(
                "insert into messages (conversation_id, sender, body) values ($1, 'bot', $2)",
                [t.id, takeoverAnnouncement({
                  leadName: t.lead_name,
                  initialQuery: t.initial_query,
                  service: t.service,
                  budget: t.budget,
                  urgency: t.urgency,
                  language: t.language ?? "it",
                  nextOperator: who,
                })],
              );
              // Nota interna per il team: il subentro è tracciato dove il team guarda.
              await pool.query(
                "insert into ticket_notes (conversation_id, author_email, body) values ($1, $2, $3)",
                [t.id, AI_ACTOR, `[take-over SLA] Ambrosio ha subentrato sul ticket #${t.number}: raccoglie i dettagli e prepara la bozza di proposta. Contesto: ${t.initial_query ?? "—"}`],
              );
              // Le mosse vere (domande, salvataggio lead, proposta) le fa
              // Ambrosio rispondendo nel thread via provider: la chiamata qui
              // prepara il terreno (annuncio + nota). La prossima risposta del
              // visitatore entra nella chat normale, col gate L3 attivo.
              await logAudit("system", "cron.ai-takeover", String(t.number), `Ambrosio subentra su SLA scaduta (L3, ticket #${t.number})`);
              summary.aiTakeover++;
            } catch (e) {
              // Annuncio fallito: rilascio il claim, il ticket potrà essere
              // preso al prossimo tick (mai un take-over a metà).
              await releaseTakeoverClaim(t.id);
              console.warn(`[cron/tick] takeover #${t.number}:`, e instanceof Error ? e.message : e);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[cron/tick] ai takeover skip:", e instanceof Error ? e.message : e);
    }

    /* ── 7. Promemoria backup (default ON, ogni 7 giorni) ─────────── */
    // L'export è il gesto volontario da Tools → «Backup e Aggiornamenti
    // Versione»: se nessuno lo fa da N giorni, il team viene avvisato.
    // Il confronto è sull'ULTIMO backup MAI fatto (anche soft-deleted):
    // cancellarlo dall'elenco non deve spegnere il promemoria.
    try {
      const rem = await backupReminderDue();
      if (rem.due) {
        const when = rem.lastAt
          ? `ultimo backup: ${new Date(rem.lastAt).toLocaleString("it-IT")}`
          : "nessun backup registrato";
        await notifyAdmin(
          `💾 Promemoria backup (oltre ${rem.days} giorni)`,
          `Non si scarica un backup da troppo tempo (${when}).\n` +
            `Scarica l'export JSON completo da Admin → Tools → «Backup e Aggiornamenti Versione».`,
        );
        await logAudit("system", "cron.backup-reminder", null, `oltre ${rem.days} giorni dall'ultimo backup`);
        // Dedup (flag persistente come le altre automazioni): l'avviso resta
        // ZITTO per questa finestra di età — senza questo, un audit ogni 15
        // minuti finché nessuno fa un backup (succedeva davvero: vedi
        // docs/VALUTAZIONE… e l'audit di produzione). Riarma da sola quando
        // l'età cresce di un giorno; un nuovo backup azzera tutto.
        await markBackupReminderSent(rem.lastAt);
      }
    } catch (e) {
      // Migration assente o DB in manutenzione: il tick non deve fallire per questo.
      console.warn("[cron/tick] backup reminder skip:", e instanceof Error ? e.message : e);
    }

    /* ── 8-bis. Backup automatico GIORNALIERO del DB nel cloud ────── */
    // Depone su Neon Object Storage una copia restoreabile del DB (formato
    // JSON della pipeline di restore esistente) con verifica di lettura e
    // sha256, UNA volta al giorno (dedup su content_settings). Serve a non
    // dipendere dal Mac acceso per i backup: la retention tiene gli ultimi
    // 14. Best-effort come tutto il tick; spento senza credenziali storage.
    try {
      const cloud = await runCloudBackup("system");
      if (cloud.done) {
        summary.cloudBackup = cloud.key ?? "";
        await notifyAdmin(
          "💾 Backup automatico nel cloud completato",
          `Database depositato su Neon Object Storage: ${cloud.key}\n` +
            `${((cloud.bytes ?? 0) / 1024).toFixed(0)} KB gzip · sha256 ${cloud.sha256?.slice(0, 12)}… · verifica lettura OK.`,
        );
      }
    } catch (e) {
      console.warn("[cron/tick] cloud backup skip:", e instanceof Error ? e.message : e);
    }

    /* ── 8-ter. Allarme backup cloud tacente ────────────────────────── */
    // Rete di sicurezza del 8-bis: se il backup automatico non riesce da
    // 2 giorni di fila (o non è MAI riuscito), l'amministratore lo sa via
    // Telegram/email — al massimo un messaggio al giorno, e solo se la
    // notifica è davvero consegnata (il prossimo tick ritenta altrimenti).
    // Best-effort come tutto il tick.
    try {
      if (await allarmeBackupCloudSeDovuto("system")) {
        summary.cloudBackupAlarm = "suonato";
      }
    } catch (e) {
      console.warn("[cron/tick] cloud backup alarm skip:", e instanceof Error ? e.message : e);
    }

    /* ── 8. Backup automatico settimanale della config SEO ─────────── */
    // Snapshot della config SEO (meta, contenuti, redirect, storici, avvisi)
    // su content_settings, max 4. Dedup: niente doppioni se niente è
    // cambiato nella settimana. L'operatore li scarica da /admin/seo.
    try {
      const taken = await takeSeoBackup();
      if (taken) {
        summary.seoBackup = 1;
        await logAudit("system", "cron.seo-backup", null, "snapshot automatico della config SEO");
      }
    } catch (e) {
      console.warn("[cron/tick] seo backup skip:", e instanceof Error ? e.message : e);
    }

    /* ── 14. Calendar Hub: pull delle sorgenti (default OFF) ──────── */
    // Riproietta le callback attive su calendar_items e scarica Google e le
    // sorgenti iCal ABILITATE nella config (pullEnabled). Idempotente:
    // ripassare gli stessi eventi non duplica nulla. Mai bloccante, come
    // tutto il tick: un errore di calendario non tocca gli altri automatismi.
    try {
      const pull = await pullCalendarHub("system");
      if (pull.google.ok || pull.ical.some((r) => r.ok)) {
        summary.calendarPull = pull.google.pulled + pull.ical.reduce((a, r) => a + r.pulled, 0);
      }
    } catch (e) {
      console.warn("[cron/tick] calendar pull skip:", e instanceof Error ? e.message : e);
    }

    /* ── 6. Polling canale email (default ON) ─────────────────────── */
    // Le email in casella diventano ticket o risposte dentro ticket esistenti
    // (dedup Message-ID: ri-eseguire non duplica nulla). Disattivabile con
    // content_settings key email_polling = {"enabled": false}.
    try {
      const { rows: eCfg } = await pool.query<{ value: { enabled?: unknown } | null }>(
        "select value from content_settings where key = 'email_polling'",
      );
      const pollingOn = eCfg[0]?.value ? eCfg[0].value.enabled !== false : true;
      if (pollingOn) {
        const ing = await ingestEmails();
        summary.emailCreated = ing.created;
        summary.emailReplied = ing.replied;
        if (ing.errors.length) console.warn("[cron/tick] email ingest:", ing.errors.join("; "));
      }
    } catch (e) {
      // Il canale email non configurato non deve far fallire il tick intero.
      console.warn("[cron/tick] email polling skip:", e instanceof Error ? e.message : e);
    }

    /* ── 10. Digest mattutino (finestra 6–9 Roma, un invio al giorno) ──
     * L'«Agenda di oggi» della Panoramica via email agli admin: le stesse
     * fonti e le stesse regole (overview-status + funzioni pure), zero
     * duplicazione. Silenzio onesto se non c'è nulla da dire; dedup
     * giornaliero su content_settings; best-effort come tutto il tick.
     */
    try {
      const digest = await sendMorningDigest({ baseUrl: baseUrl() });
      if (digest.outcome !== "skipped") summary.digest = digest.detail;
    } catch (e) {
      console.warn("[cron/tick] digest skip:", e instanceof Error ? e.message : e);
    }

    /* ── 14. Digest serale Telegram (finestra 20–23 Roma, 1/giorno) ──
     * La chiusura della giornata di Ambrosio sulle chat del team: lead
     * salvati, conversazioni seguite, passaggi al team, callback fissate.
     * Stessa disciplina del digest mattutino: finestra, dedup giornaliero,
     * invio best-effort con esito in audit.
     */
    try {
      const evening = await sendEveningDigest();
      if (evening.outcome !== "skipped") summary.eveningDigest = evening.detail;
    } catch (e) {
      console.warn("[cron/tick] evening digest skip:", e instanceof Error ? e.message : e);
    }

    /* ── 9. Portafoglio clienti (Ambrosio, default ON) ───────────── */
    // Dopo l'ingest: le email appena diventate ticket entrano nel roster
    // e vengono riconciliate allo stesso giro. Mai bloccante, come tutto
    // il resto del tick: un errore qui non tocca gli altri automatismi.
    try {
      if (await isClientsSyncEnabled()) {
        summary.clientsSynced = await syncClients("ambrosio@ai");
      }
    } catch (e) {
      console.warn("[cron/tick] clients sync skip:", e instanceof Error ? e.message : e);
    }

    /* ── 13. Polling Telegram di riserva (OFF di default) ────────── */
    // Il webhook è la via normale; questo pallino esiste per lo sviluppo
    // locale (niente HTTPS → niente webhook) e come rete di sicurezza se
    // il server è irraggiungibile. Attivo SOLO con TELEGRAM_POLLING=1:
    // webhook e getUpdates non possono correre insieme su Telegram, quindi
    // l'env è una scelta esplicita. Dedup update_id: nessun doppione anche
    // se webhook e polling si sovrapponessero per un attimo.
    try {
      if (process.env.TELEGRAM_POLLING === "1") {
        summary.telegramIn = await pollTelegramUpdates();
      }
    } catch (e) {
      console.warn("[cron/tick] telegram polling skip:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error("[cron/tick]", e);
    return NextResponse.json({ ok: false, error: "cron_failed" }, { status: 500 });
  }
}
