"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { login, logout, requireAdmin, changeAdminPassword, issueSessionFor } from "@/lib/admin";
import { verifyTurnstile } from "@/lib/turnstile";
import { db } from "@/lib/db";
import { backfillGCalEvents, retryFailedGCalSync, saveGCalConfig, testGCalConnection } from "@/lib/google-calendar";
import { queueGCalSyncForCallback, rescheduleGCalEvent } from "@/lib/google-calendar";
import {
  bumpContentSettingsVersion,
  CHAT_EMOJIS_KEY,
  CHAT_EMOJIS_MAX,
  QUICK_REPLIES_KEY,
  QUICK_REPLIES_MAX,
  SLA_POLICY_KEY,
  LAST_SENDER_SQL,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  getChatEmojis,
  getQuickReplies,
  slaDueFor,
} from "@/lib/tickets";
import { saveAiSettings, saveProviderKey, setPrimaryProvider, clearLegacyKey, saveAiFaq, deleteAiFaq, ambrosioReply, draftFaqAnswer, draftSeoMeta, draftLandingContent, translateFaq, sanitizeFaqTranslations, PROVIDERS, type AiProvider, type FaqTranslations } from "@/lib/ai";
import { syncClients } from "@/lib/clients";
import { saveNotionSettings, testNotionConnection } from "@/lib/notion";
import {
  buildNotionPayload,
  getSyncConfig,
  sanitizeSyncConfig,
  saveSyncConfig,
} from "@/lib/notion-config";
import { drainNotionQueue, enqueueNotionSync } from "@/lib/notion-queue";
import { listClients } from "@/lib/clients";
import { unbanIp, shieldViolate } from "@/lib/shield";
import { limit, clientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { adapterFor } from "@/lib/messaging";
import { headers } from "next/headers";
import { HERO_KEY, sanitizeHeroConfig } from "@/lib/hero-shared";
import { purgeSiteCache } from "@/lib/cache-purge";
import { purgeProxyCaches } from "@/proxy";
import { sanitizeCacheReason, selectedTargets, targetLabels, wantsTarget } from "@/lib/cache-shared";
import { MAINTENANCE_KEY } from "@/lib/maintenance-shared";
import { PAGE_CACHE_KEY, sanitizePageCacheConfig } from "@/lib/page-cache-shared";
import { readPageCacheConfig } from "@/lib/page-cache-store";
import { PERF_TARGET_KEY, sanitizePerfTargetConfig } from "@/lib/perf-target-shared";
import { readPerfTargetConfig } from "@/lib/perf-target-store";
import { getGoogleApiKey, saveGoogleToolsConfig, testPageSpeed, saveGscCredentials, removeGscCredentials } from "@/lib/google-tools";
import { saveDriveCredentials, testDriveConnection } from "@/lib/drive";
import { saveOneDriveCredentials, testOneDriveConnection } from "@/lib/onedrive";
import { getGscQueries, getGscPageQueries, getGscPagePosition, getGscPagePositionTrend, testGscConnection, GscError } from "@/lib/gsc";
import { getSeoConfig, saveSeoConfig, sanitizeSeoConfig, sanitizeSlug, isValidRedirectPath, effectiveLandingSeo, pushContentVersion, pushMetaVersion, recordPageAlert, PAGE_ALERT_THRESHOLDS, diffSeoConfig } from "@/lib/seo";
import { LANDINGS } from "@/lib/site";
import {
  saveEmailToolsConfig,
  testEmailConnection,
  getEmailToolsConfig,
  sendEmailViaTools,
  ingestEmails,
  sanitizeEmailHtml,
  htmlToEmailText,
  buildEmailHtml,
} from "@/lib/email-tools";
import {
  buildBackupPayload,
  recordBackup,
  softDeleteBackup,
  setBackupReminderDays,
  currentVersion,
  installedNextVersion,
  checkLatestVersion,
  humanBytes,
  executeRestore,
  planRestore,
  type RestoreResult,
} from "@/lib/maintenance";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = clientIp(await headers());
  // Captcha invisibile (Turnstile) sul login: se configurato, un token mancante
  // o non valido blocca la richiesta PRIMA di consumare il rate limit e SENZA
  // violazione Shield (stesso trattamento degli endpoint pubblici: il widget
  // è lazy e un timing sfavorevole non è un abuso). Disattivato = nessun effetto.
  const ts = await verifyTurnstile(formData.get("turnstileToken"), ip);
  if (!ts.ok) {
    redirect(`/admin/login?error=${encodeURIComponent("Verifica anti-bot non riuscita: ricarica la pagina e riprova.")}`);
  }
  // Brute force: max 8 tentativi/ora per IP, poi violazione Shield (ban automatico).
  // In E2E (WAC_E2E=1, solo localhost) il limite sale: le spec fanno login
  // reali e la suite completa ne fa decine per run — il bucket è in-memory,
  // quindi le run locali ripetute nello stesso processo server si sommano
  // (superate le 100/ora i login 429 inquinavano i conteggi del pannello
  // Shield). In produzione resta 8.
  const rl = limit("admin-login", ip, process.env.WAC_E2E ? 500 : 8, 60 * 60_000);
  if (!rl.ok) {
    await shieldViolate({ headers: await headers() } as unknown as Request, "rate_limit", "/admin/login", `brute force da ${email}`);
    redirect(`/admin/login?error=${encodeURIComponent(`Troppi tentativi, riprova tra ${rl.retryAfterSec} secondi`)}`);
  }
  const ok = await login(email, password);
  if (!ok) {
    // Nota: le credenziali sbagliate consumano solo il rate limit (8/ora),
    // non generano violazioni Shield — l'admin che sbaglia 3 volte non deve
    // prendersi un ban di 24 ore. Il ban scatta solo sul superamento del limite.
    redirect(`/admin/login?error=${encodeURIComponent("Credenziali non valide")}`);
  }
  redirect("/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}

/**
 * Cambio password self-service (pagina Sicurezza): verifica la password
 * attuale, scrive il nuovo hash e RINNOVA il cookie della sessione corrente
 * (l'impronta nel payload deve matchare il nuovo hash, altrimenti il cambio
 * slogherebbe l'admin stesso). Le ALTRE sessioni dello stesso utente muoiono:
 * portano l'impronta del vecchio hash. Redirect espliciti per ogni esito.
 */
export async function changePasswordAction(formData: FormData) {
  const user = await requireAdmin();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (next !== confirm) redirect("/admin/sicurezza?err=match");
  const res = await changeAdminPassword(user.email, current, next);
  if (!res.ok) {
    const err = res.error === "credenziali" ? "credenziali" : res.error === "validazione" ? "corta" : "db";
    redirect(`/admin/sicurezza?err=${err}`);
  }
  await issueSessionFor(user.email);
  await logAudit(user.email, "admin.password-cambiata");
  redirect("/admin/sicurezza?ok=1");
}

/**
 * «Esci dalle altre sessioni»: rinnova il cookie della sessione corrente.
 * Le altre sessioni dello stesso utente portano l'impronta del vecchio hash —
 * ma senza cambio password l'hash NON cambia, quindi la revoca vera passa dal
 * cambio password. Qui offriamo la coppia: il form della pagina propone il
 * cambio password (revoca reale); questo pulsante da solo rinnova solo la
 * sessione corrente ed è etichettato di conseguenza.
 */
export async function refreshSessionAction() {
  const user = await requireAdmin();
  await issueSessionFor(user.email);
  redirect("/admin/sicurezza?ok=rinnovata");
}

const LEAD_STATUSES = ["nuovo", "contattato", "chiuso"];

export async function updateLeadStatus(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !LEAD_STATUSES.includes(status)) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update leads set status = $1 where id = $2", [status, id]);
  await logAudit(user.email, "lead.stato", id, status);
  revalidatePath("/admin/leads");
}

/**
 * Integra il nome ditta di un lead azienda (controllo di completezza della
 * dashboard): stessa validazione dello step chat company_name, audit con
 * prima/dopo come la migration 038. Il lead resta «azienda»: è il dato che
 * manca, non il tipo cliente.
 */
export async function updateLeadCompanyName(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const companyName = String(formData.get("company_name") ?? "").trim().slice(0, 100);
  if (!id || !companyName) return;
  if (!/^[\p{L}0-9''”’ \-.,&(){}/]{2,80}$/u.test(companyName)) return;
  const pool = db();
  if (!pool) return;
  const { rows } = await pool.query<{ company_name: string | null }>(
    "select company_name from leads where id = $1",
    [id],
  );
  const before = rows[0]?.company_name ?? null;
  await pool.query("update leads set company_name = $1 where id = $2", [companyName, id]);
  await logAudit(user.email, "lead.company_name", id, `${before ?? "(vuoto)"} → ${companyName}`);
  revalidatePath("/admin/leads");
}

export async function toggleOperatorAvailability(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("next") ?? "") === "true";
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update operators set available_override = $1 where id = $2", [next, id]);
  await logAudit(user.email, "operatore.disponibilita", id, next ? "online" : "offline");
  revalidatePath("/admin/operators");
}

export async function callbackAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  if (!id || !["done", "missed"].includes(action)) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update callbacks set status = $1 where id = $2", [action, id]);
  // GOOGLE CALENDAR (se attivo): callback conclusa → evento rimosso dal calendario.
  await queueGCalSyncForCallback(pool, id, "delete");
  await logAudit(user.email, `callback.${action}`, id);
  revalidatePath("/admin/callbacks");
}

export async function updateLeadNotes(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update leads set notes = $2 where id = $1", [id, notes]);
  await logAudit(user.email, "lead.nota", id);
  revalidatePath("/admin/leads");
}

/* ── TICKET ─────────────────────────────────────────────────────── */

export async function replyToTicket(formData: FormData) {
  const user = await requireAdmin();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  if (!conversationId || !body) return;
  const pool = db();
  if (!pool) return;
  const { rows } = await pool.query<{
    first_response_at: Date | null;
    priority: string;
    status: string;
    channel: string;
    number: number;
    contact_email: string | null;
    contact_handle: string | null;
    initial_query: string | null;
  }>(
    "select first_response_at, priority, status, channel, number, contact_email, contact_handle, initial_query from conversations where id = $1",
    [conversationId],
  );
  if (!rows[0]) return;
  const ticket = rows[0];
  await pool.query(
    "insert into messages (conversation_id, sender, body, author) values ($1, 'operator', $2, $3)",
    [conversationId, body, user.displayName],
  );

  // Canale email: la risposta DEVE arrivare nella casella del cliente.
  // Oggetto «[#N] oggetto»: il cliente risponde a quel filo e il polling
  // IMAP riclassifica la risposta dentro il ticket (migration 023).
  let emailError: string | null = null;
  if (ticket.channel === "email" && ticket.contact_email) {
    const subject = ticket.initial_query?.slice(0, 120) || "La tua richiesta";
    const sent = await sendEmailViaTools({
      to: ticket.contact_email,
      subject: `[#${ticket.number}] ${subject}`,
      text: `${body}\n\n— ${user.displayName}, Web Agency Salento\nRispondi a questa email: finirà nel ticket #${ticket.number}.`,
    });
    if (!sent.ok) emailError = sent.error ?? "Errore invio email";
  }

  // Canale Telegram (migration 033): la risposta esce verso la chat privata
  // del cliente (contact_handle = chat id). Best-effort come l'email: se
  // l'invio fallisce il messaggio resta comunque nel ticket (registro), e
  // l'errore finisce nell'audit dove il team lo vede.
  let telegramError: string | null = null;
  if (ticket.channel === "telegram" && ticket.contact_handle) {
    try {
      await adapterFor("telegram").reply({ to: ticket.contact_handle, body });
    } catch (e) {
      telegramError = e instanceof Error ? e.message : "Errore invio Telegram";
    }
  }

  // Prima risposta: stop SLA + auto-assegnazione a chi risponde per primo.
  // Il messaggio umano riporta anche il ticket in gestione attiva se il bot
  // aveva il controllo o se il lead era appena catturato.
  const extra = ticket.first_response_at ? "" : ", first_response_at = now()";
  // FASE 1.1: dopo la risposta umana la palla è al cliente → «In attesa
  // cliente». Il clock dell'agente si spegne (non dobbiamo niente finché il
  // cliente non riscrive: allora riparte, armato in api/chat/message).
  const nextStatus = "waiting_customer";
  await pool.query(
    `update conversations set status = $2,
            assigned_to = coalesce(assigned_to, $3),
            sla_next_reply_due = null,
            awaiting_notified_at = null${extra} where id = $1`,
    [conversationId, nextStatus, user.operatorId],
  );
  await logAudit(
    user.email,
    telegramError
      ? "ticket.risposta_telegram_errore"
      : emailError
        ? "ticket.risposta_email_errore"
        : ticket.channel === "email"
          ? "ticket.risposta_email"
          : ticket.channel === "telegram"
            ? "ticket.risposta_telegram"
            : "ticket.risposta",
    conversationId,
    telegramError ?? emailError,
  );
  revalidatePath(`/admin/tickets/${conversationId}`);
  revalidatePath("/admin/tickets");
}

export async function claimTicket(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id || !user.operatorId) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update conversations set assigned_to = $2 where id = $1", [id, user.operatorId]);
  await addAudit(pool, user.email, "ha preso in carico il ticket", id, null);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

export async function assignTicket(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("assigned_to") ?? ""); // "" = disassegna
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update conversations set assigned_to = nullif($2, '') where id = $1", [id, to]);
  await addAudit(pool, user.email, "assegnazione ticket", id, to || null);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

export async function setTicketPriority(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const priority = String(formData.get("priority") ?? "");
  if (!id || !TICKET_PRIORITIES.includes(priority as (typeof TICKET_PRIORITIES)[number])) return;
  const pool = db();
  if (!pool) return;
  // Il cambio priorità ricalcola la scadenza di risoluzione (dipende dalla
  // priorità); il clock «prossima risposta» si riarma solo se la palla è
  // all'agente (ultimo messaggio del cliente). Su un ticket sospeso o chiuso
  // i clock restano FERMI: la priorità non li riaccende (stessa policy di
  // setTicketStatus — prima un cambio priorità riarmava sla_next_reply_due
  // anche su on_hold/closed).
  const { rows } = await pool.query<{ last_sender: string | null; status: string }>(
    `select ${LAST_SENDER_SQL} as last_sender, c.status from conversations c where c.id = $1`,
    [id],
  );
  const due = slaDueFor(priority, new Date());
  const frozen = rows[0]?.status === "closed" || rows[0]?.status === "on_hold";
  const armNext = !frozen && rows[0]?.last_sender === "visitor";
  const clocks = frozen
    ? "sla_resolve_due = null, sla_next_reply_due = null"
    : armNext
      ? "sla_resolve_due = $3, sla_next_reply_due = $4"
      : "sla_resolve_due = $3, sla_next_reply_due = null";
  await pool.query(
    `update conversations set priority = $2, ${clocks} where id = $1`,
    frozen ? [id, priority] : armNext ? [id, priority, due.resolveDue, due.nextReplyDue] : [id, priority, due.resolveDue],
  );
  await addAudit(pool, user.email, "priorità", id, priority);
  await logAudit(user.email, "ticket.priorita", id, priority);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

export async function setTicketStatus(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(TICKET_STATUSES as string[]).includes(status)) return;
  const pool = db();
  if (!pool) return;
  // I clock SLA seguono la palla: chiuso/sospeso = fermi; se la palla è
  // all'agente (o gliela ridiamo uscendo da sospeso/chiuso) si armano da ora
  // con la policy della priorità corrente.
  const { rows } = await pool.query<{ last_sender: string | null; priority: string }>(
    `select ${LAST_SENDER_SQL} as last_sender, c.priority from conversations c where c.id = $1`,
    [id],
  );
  const ballWithUs =
    status !== "waiting_customer" &&
    (rows[0]?.last_sender === "visitor" || status === "operator" || status === "lead_captured");
  const due = slaDueFor(rows[0]?.priority ?? "normale", new Date());
  // clocks e params devono restare allineati: $4/$5 esistono SOLO quando si
  // armano gli orologi. Prima i params guardavano solo ballWithUs, così
  // on_hold a palla al cliente mandava 4 parametri su 2 placeholder (500).
  const stopClocks = status === "closed" || status === "on_hold";
  const armClocks = !stopClocks && ballWithUs;
  const clocks = stopClocks
    ? "sla_next_reply_due = null, sla_resolve_due = null, awaiting_notified_at = null"
    : armClocks
      ? "sla_next_reply_due = $4, sla_resolve_due = $5, awaiting_notified_at = null"
      : "sla_next_reply_due = null, awaiting_notified_at = null";
  if (status === "closed") {
    await pool.query(
      `update conversations set status = 'closed', closed_at = now(), closed_by = $2, ${clocks} where id = $1`,
      [id, user.operatorId],
    );
  } else {
    await pool.query(
      `update conversations set status = $2, closed_at = null, closed_by = null, ${clocks} where id = $1`,
      armClocks ? [id, status, due.nextReplyDue, due.resolveDue] : [id, status],
    );
  }
  await addAudit(pool, user.email, "stato", id, status);
  await logAudit(user.email, "ticket.stato", id, status);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

/**
 * Fissa una callback a ore da adesso e porta il ticket nello stato
 * "callback_scheduled": la promessa presa in chat diventa un impegno tracciato,
 * visibile anche nella pagina Callback.
 */
export async function scheduleTicketCallback(formData: FormData) {
  const user = await requireAdmin();
  const conversationId = String(formData.get("conversationId") ?? "");
  const hours = Number(formData.get("hours") ?? 0);
  if (!conversationId || !Number.isFinite(hours) || hours <= 0 || hours > 336) return;
  const pool = db();
  if (!pool) return;
  const ins = await pool.query<{ id: string }>(
    `insert into callbacks (conversation_id, operator_id, scheduled_at, slot_label)
     values ($1, $2, now() + ($3 || ' hours')::interval, $4) returning id`,
    [conversationId, user.operatorId, String(Math.round(hours)), `tra ${Math.round(hours)}h`],
  );
  await pool.query("update conversations set status = 'callback_scheduled' where id = $1", [conversationId]);
  // GOOGLE CALENDAR (se attivo): non bloccante, l'errore non tocca l'azione admin.
  await queueGCalSyncForCallback(pool, ins.rows[0].id, "create");
  await addAudit(pool, user.email, "callback fissata", conversationId, `tra ${Math.round(hours)}h`);
  await logAudit(user.email, "ticket.callback", conversationId, `tra ${Math.round(hours)}h`);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${conversationId}`);
  revalidatePath("/admin/callbacks");
}

export async function addTicketNote(formData: FormData) {
  const user = await requireAdmin();
  const conversationId = String(formData.get("conversationId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!conversationId || !body) return;
  const pool = db();
  if (!pool) return;
  await pool.query("insert into ticket_notes (conversation_id, author_email, body) values ($1, $2, $3)", [
    conversationId,
    user.email,
    body,
  ]);
  await logAudit(user.email, "ticket.nota", conversationId);
  revalidatePath(`/admin/tickets?t=${conversationId}`);
}

/**
 * Salva le risposte rapide del ticketing (una per riga, max 8, max 300
 * caratteri). Il JSON su content_settings viene riscritto solo se il testo
 * è diverso: niente scritture superflue né audit fasulli.
 */
export async function saveQuickReplies(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const list = String(formData.get("replies") ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, QUICK_REPLIES_MAX)
    .map((x) => x.slice(0, 300));
  const current = await getQuickReplies();
  if (JSON.stringify(list) === JSON.stringify(current)) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [QUICK_REPLIES_KEY, JSON.stringify(list)],
  );
  // Il render della STESSA richiesta rilegge fresco (ADR-005: snapshot
  // content_settings per richiesta, versionato): revalidatePath da solo non
  // invalida la cache() di React dentro la richiesta in corso.
  bumpContentSettingsVersion();
  await logAudit(user.email, "ticket.risposte-rapide", null, `${list.length} risposte`);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/tickets");
}

/**
 * Salva le emoji del picker della chat pubblica (una per riga, max 24, ogni
 * voce fino a 8 code point per coprire emoji composte). Stessa disciplina di
 * saveQuickReplies: il JSON viene riscritto solo se diverso, niente audit
 * fasulli. Con zero emoji valide il client torna sul set predefinito.
 */
export async function saveChatEmojis(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const list = String(formData.get("emojis") ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && [...x].length <= 8)
    .slice(0, CHAT_EMOJIS_MAX);
  const current = await getChatEmojis();
  if (JSON.stringify(list) === JSON.stringify(current)) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [CHAT_EMOJIS_KEY, JSON.stringify(list)],
  );
  // Stessa ragione di saveQuickReplies: il render post-revalidate rilegge fresco.
  bumpContentSettingsVersion();
  await logAudit(user.email, "chat.emoji", null, `${list.length} emoji`);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/emoji-chat");
}

/**
 * Archiviazione soft di un ticket (spam o vuoto): sparisce dalla inbox ma
 * resta nel DB, ripristinabile dal banner. Nessuna cancellazione.
 */
export async function archiveTicket(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query(
    "update conversations set archived_at = now(), archived_by = $2 where id = $1 and archived_at is null",
    [id, user.email],
  );
  await logAudit(user.email, "ticket.archiviato", id);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

/** Ripristina un ticket archiviato: torna in inbox nel suo filtro. */
export async function restoreTicket(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query(
    "update conversations set archived_at = null, archived_by = null where id = $1 and archived_at is not null",
    [id],
  );
  await logAudit(user.email, "ticket.ripristinato", id);
  revalidatePath("/admin/tickets");
  revalidatePath(`/admin/tickets?t=${id}`);
}

/**
 * AZIONI BULK sulla coda (parità col gemello WebAgencyCrema): archivia,
 * chiudi o prendi in carico PIÙ ticket in un gesto — a 60+ ticket l'azione
 * uno-a-uno non regge. UNA action server (non N form): la coda arriva come
 * lista di id da un solo form nascosto; il loop riusa le stesse regole
 * delle azioni singole (stessa clausola guardia di archiveTicket, gli
 * stessi clock SLA fermi di setTicketStatus sulla chiusura, addAudit per
 * ticket — la storia di ognuno resta leggibile). Ids non UUID e valori
 * fuori dominio si scartano in silenzio: il bulk non è un vettore di
 * injection.
 */
export async function bulkTicketsAction(formData: FormData) {
  const user = await requireAdmin();
  const op = String(formData.get("op") ?? "");
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
    .slice(0, 100); // tetto ragionevole: la coda pagina a 60
  if (!ids.length) return;
  // Il CLAIM richiede un operatore collegato (come claimTicket); archivia/
  // chiudi no — un super admin senza operatore può comunque ripulire la
  // coda (beccato in E2E sul gemello: return silenzioso = redirect perso).
  if (op === "claim" && !user.operatorId) return;
  if (!["archive", "close", "claim"].includes(op)) return;
  const pool = db();
  if (!pool) return;

  let done = 0;
  for (const id of ids) {
    if (op === "archive") {
      // Stessa clausola guardia di archiveTicket: archivia solo ciò che
      // non lo è già — il conteggio resta onesto sui doppioni.
      const { rowCount } = await pool.query(
        "update conversations set archived_at = now(), archived_by = $2 where id = $1 and archived_at is null",
        [id, user.email],
      );
      if (rowCount) {
        await logAudit(user.email, "ticket.archiviato", id);
        await addAudit(pool, user.email, "archiviazione multipla", id, null);
        done += 1;
      }
    } else if (op === "close") {
      // Stessa regola di setTicketStatus sulla chiusura: i clock SLA si
      // FERMANO (nel bulk non si riarmano mai: la palla non cambia mano).
      // La guardia «non già chiuso» non ritocca i ticket chiusi in
      // precedenza: closed_at/closed_by restano la loro storia.
      const { rowCount } = await pool.query(
        `update conversations set status = 'closed', closed_at = coalesce(closed_at, now()), closed_by = $2,
           sla_next_reply_due = null, sla_resolve_due = null, awaiting_notified_at = null
         where id = $1 and status <> 'closed'`,
        [id, user.operatorId],
      );
      if (rowCount) {
        await logAudit(user.email, "ticket.stato", id, "closed");
        await addAudit(pool, user.email, "chiusura multipla", id, null);
        done += 1;
      }
    } else {
      // Claim «cortese» (stessa guardia del gemello): si prendono solo i
      // ticket NESSUNO ha in carico o già propri — il bulk non strappa i
      // ticket al collega; l'assegnazione forzata resta una scelta
      // consapevole della scheda del singolo ticket.
      const { rowCount } = await pool.query(
        "update conversations set assigned_to = $2 where id = $1 and (assigned_to is null or assigned_to = $2)",
        [id, user.operatorId],
      );
      if (rowCount) {
        await addAudit(pool, user.email, "ha preso in carico il ticket (multiplo)", id, null);
        done += 1;
      }
    }
  }
  revalidatePath("/admin/tickets");
  // Il feedback dice COSA è successo e QUANTO: la pagina legge ?bulk=op:n
  // (notice in cima, non toast — la notizia merita di durare).
  redirect(`/admin/tickets?bulk=${op}:${done}`);
}

/* ── AMBROSIO (operatore AI) ────────────────────────────────── */

export async function saveAiSettingsAction(formData: FormData) {
  const user = await requireAdmin();
  const provider = String(formData.get("provider") ?? "anthropic") as AiProvider;
  if (!PROVIDERS.some((p) => p.key === provider)) return;
  let outcome: Awaited<ReturnType<typeof saveAiSettings>>;
  try {
    outcome = await saveAiSettings({
      enabled: String(formData.get("enabled") ?? "") === "on",
      provider,
      model: String(formData.get("model") ?? ""),
      apiKey: String(formData.get("apiKey") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? "") || null,
      systemPrompt: String(formData.get("systemPrompt") ?? ""),
      temperature: Number(formData.get("temperature") ?? "0.4") || 0.4,
    });
  } catch (e) {
    console.error("[saveAiSettings]", e);
    return;
  }
  if (outcome.legacyRepurposed) {
    // La chiave del vecchio form (slot legacy) apparteneva a un altro
    // provider: ora sovrascrive quella del primario appena salvato. Audit
    // dedicato + banner in pagina: senza avviso, il 401 del primario resta
    // un mistero (difetto visto sul vivo con la chiave Anthropic scaduta).
    // Il redirect è fuori dal try/catch: NEXT_REDIRECT non va mai ingoiato.
    await logAudit(
      user.email,
      "ai.chiave-legacy-riusata",
      provider,
      `la chiave legacy era del provider ${outcome.previousLegacyProvider ?? "sconosciuto"}: ora vale per ${provider}`,
    );
    redirect(`/admin/ai/configurazione?legacy=${outcome.previousLegacyProvider ?? "sconosciuto"}`);
  }
  await logAudit(user.email, "ai.impostazioni", provider);
  revalidatePath("/admin/ai");
}

/**
 * Promuove un provider a primario dalla sua card (sezione multi-provider).
 * Audit tracciato: chi ha cambiato il primario e quando.
 */
export async function setPrimaryProviderAction(formData: FormData) {
  const user = await requireAdmin();
  const provider = String(formData.get("provider") ?? "") as AiProvider;
  if (!PROVIDERS.some((p) => p.key === provider)) return;
  try {
    await setPrimaryProvider(provider);
    await logAudit(user.email, "ai.provider-primario", provider);
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[setPrimaryProvider]", e);
  }
}

export async function saveProviderKeyAction(formData: FormData) {
  const user = await requireAdmin();
  const provider = String(formData.get("provider") ?? "") as AiProvider;
  if (!PROVIDERS.some((p) => p.key === provider)) return;
  try {
    await saveProviderKey({
      provider,
      apiKey: String(formData.get("apiKey") ?? ""), // "-" = rimuovi
      model: String(formData.get("model") ?? ""),
      baseUrl: String(formData.get("baseUrl") ?? "") || null,
      enabled: String(formData.get("enabled") ?? "") === "on",
    });
    await logAudit(user.email, "ai.chiave-provider", provider);
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[saveProviderKey]", e);
  }
}

/**
 * Rimuove la chiave legacy del vecchio form singolo (Configurazione):
 * sovrascrive la chiave del provider primario nella catena di fallback —
 * una vecchia chiave invalida lì faceva fallire il primario PRIMA di
 * provare le chiavi buone (401 ad ogni richiesta). Leggera: se serve
 * una chiave al primario, si risalva dalla card del provider.
 */
export async function clearLegacyKeyAction() {
  const user = await requireAdmin();
  try {
    await clearLegacyKey();
    await logAudit(user.email, "ai.chiave-legacy-rimossa");
    revalidatePath("/admin/ai");
    revalidatePath("/admin/ai/provider");
  } catch (e) {
    console.error("[clearLegacyKey]", e);
  }
}

/**
 * Salva una FAQ addestrativa per Ambrosio (nuova o modifica). Domanda e
 * risposta sono obbligatorie; la priorità scala l'importanza nel prompt.
 */
export async function saveAiFaqAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim() || undefined;
  const question = String(formData.get("question") ?? "");
  const answer = String(formData.get("answer") ?? "");
  const priority = Number(formData.get("priority") ?? 50) || 50;
  const active = String(formData.get("active") ?? "") === "on";
  // Fase 3: traduzioni opzionali inviate dal form come JSON (sanificate in lib).
  const translationsRaw = formData.get("translations");
  let translations: FaqTranslations | null = null;
  if (typeof translationsRaw === "string" && translationsRaw.trim()) {
    try {
      translations = sanitizeFaqTranslations(JSON.parse(translationsRaw));
    } catch {
      translations = null;
    }
  }
  try {
    await saveAiFaq({ id, question, answer, priority, active, translations });
    await logAudit(user.email, id ? "ai.faq-modificata" : "ai.faq-creata", null, question.slice(0, 80));
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[saveAiFaq]", e);
  }
}

/**
 * Fase 3: bozza di traduzione della risposta ufficiale in en/de/fr/es.
 * Chiamata dal client (non da un form): ritorna le traduzioni per
 * precompilare i campi; il team le verifica e salva — l'AI non pubblica.
 */
export async function translateFaqAction(question: string, answer: string): Promise<{ ok: boolean; translations?: FaqTranslations; error?: string }> {
  await requireAdmin();
  if (!question.trim() || !answer.trim()) return { ok: false, error: "campi_vuoti" };
  try {
    const res = await translateFaq(question, answer);
    return { ok: true, translations: res.translations };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore provider";
    return { ok: false, error: msg === "chiave_mancante" ? "Nessuna chiave AI attiva." : "Il provider non ha risposto." };
  }
}

export async function deleteAiFaqAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deleteAiFaq(id);
    await logAudit(user.email, "ai.faq-eliminata", id);
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[deleteAiFaq]", e);
  }
}

export async function testAiAction(formData: FormData) {
  await requireAdmin();
  const question = String(formData.get("question") ?? "").trim() || "Quanto costa un sito vetrina?";
  let reply = "Errore sconosciuto";
  let usedInfo = "";
  try {
    const res = await ambrosioReply([{ role: "user", content: question }], null, { track: false });
    reply = res.reply || "Risposta vuota dal provider: controlla modello e chiave.";
    usedInfo = res.fallbacksTried.length
      ? ` [provider: ${res.usedProvider} — dopo fallback da ${res.fallbacksTried.join(", ")}]`
      : ` [provider: ${res.usedProvider}]`;
    // FASE 1: se il modello richiede un'azione, mostrala nel test (senza
    // eseguirla: il test non ha conversazione dietro).
    if (res.toolCall) {
      usedInfo += ` [azione richiesta: ${res.toolCall.fn}(${JSON.stringify(res.toolCall.args).slice(0, 140)})]`;
    }
  } catch (e) {
    reply = e instanceof Error ? `Errore: ${e.message}` : "Errore provider";
  }
  redirect(`/admin/ai/test?test=${encodeURIComponent(question)}&reply=${encodeURIComponent(reply + usedInfo)}`);
}

/**
 * Genera una bozza di risposta FAQ con l'AI e torna al form con la bozza
 * precompilata: l'agente la corregge (prezzi/tempi veri) e salva.
 */
export async function draftFaqAnswerAction(formData: FormData) {
  await requireAdmin();
  const question = String(formData.get("question") ?? "").trim();
  if (!question) redirect("/admin/ai");
  let draft = "";
  let note = "";
  try {
    const res = await draftFaqAnswer(question);
    draft = res.draft;
    note = res.fallbacksTried?.length
      ? ` [bozza via ${res.usedProvider} — dopo fallback da ${res.fallbacksTried.join(", ")}]`
      : ` [bozza via ${res.usedProvider}]`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore provider";
    const hint =
      msg === "chiave_mancante"
        ? "Nessuna chiave AI attiva: salvala nelle card qui sotto, poi riprova."
        : "Il provider non ha risposto: riprova o scegli un altro provider primario.";
    redirect(`/admin/ai/addestramento?faq_draft_error=${encodeURIComponent(hint)}`);
  }
  const params = new URLSearchParams({ q: question, draft });
  if (note) params.set("note", note);
  redirect(`/admin/ai/addestramento?${params.toString()}`);
}

/**
 * Bozza di Ambrosio per la «Prima risposta» del nuovo ticket email:
 * l'agente apre il caso, Ambrosio prepara la risposta usando le FAQ
 * ufficiali e i pacchetti attivi (le stesse fonti del chatbot pubblico).
 * Torna DATI, non redirect: è la UI dell'editor che decide dove metterla.
 */
export async function ambrosioDraftAction(subject: string): Promise<
  { ok: true; draft: string; provider: string } | { ok: false; error: string }
> {
  await requireAdmin();
  const clean = subject.trim().slice(0, 200);
  if (!clean) return { ok: false, error: "Scrivi prima l'oggetto del ticket." };
  try {
    // Il contesto è la domanda: oggetto del ticket + richiesta di risposta
    // al cliente. draftFaqAnswer usa già FAQ attive e pacchetti nel prompt.
    const res = await draftFaqAnswer(
      `Rispondi a un cliente che ha aperto un ticket con oggetto «${clean}». Presenta le informazioni richieste e chiudi invitando a fissare una call.`,
    );
    await logAudit((await requireAdmin()).email, "ambrosio.bozza_ticket", null, `bozza per «${clean}» via ${res.usedProvider}`);
    return { ok: true, draft: res.draft, provider: res.usedProvider };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore provider";
    return {
      ok: false,
      error:
        msg === "chiave_mancante"
          ? "Nessuna chiave AI attiva: salvala in Ambrosio AI → Provider."
          : "Il provider non ha risposto: riprova tra poco.",
    };
  }
}

/**
 * Bozza di title + meta description per una landing SEO, scritta da Ambrosio
 * (catena provider, FAQ/pacchetti non servono qui: conta il contesto pagina).
 * Torna DATI, non redirect: è l'editor della landing che riempie i campi.
 * La bozza non viene mai salvata diretta: l'operatore rilegge e salva.
 */
export async function seoAmbrosioDraftAction(slugKey: string): Promise<
  { ok: true; title: string; description: string; provider: string } | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  const landing = LANDINGS.find((l) => l.slug === slugKey);
  if (!landing) return { ok: false, error: "Pagina non trovata." };
  try {
    const res = await draftSeoMeta({
      slug: landing.slug,
      h1: landing.h1,
      keyword: landing.keyword,
      keywords: landing.keywords,
      intro: landing.intro,
    });
    await logAudit(admin.email, "ambrosio.bozza_seo", null, `meta per /${landing.slug} via ${res.usedProvider}`);
    return { ok: true, title: res.title, description: res.description, provider: res.usedProvider };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore provider";
    return {
      ok: false,
      error:
        msg === "chiave_mancante"
          ? "Nessuna chiave AI attiva: salvala in Ambrosio AI → Provider."
          : "Il provider non ha risposto: riprova tra poco.",
    };
  }
}

/**
 * Storico posizioni di una landing per il grafico in-card: serie giornaliera
 * GSC (max 90 giorni, chiusa 3 giorni fa) + marker dei ripristini di
 * contenuti letti dall'audit log (append-only, quindi attendibile).
 * Ritorna DATI o errore parlante: è il client che decide come mostrarli.
 */
export async function seoGscPositionHistoryAction(
  slugKey: string,
): Promise<
  | { ok: true; points: Awaited<ReturnType<typeof getGscPagePositionTrend>>; restores: { ts: string; source: string }[] }
  | { ok: false; error: string }
> {
  await requireAdmin();
  if (!LANDINGS.some((l) => l.slug === slugKey)) return { ok: false, error: "Pagina non trovata." };
  const config = await getSeoConfig();
  // URL realmente servito: se la pagina ha uno slug personalizzato il
  // traffico GSC sta sull'URL nuovo, non su quello originale.
  const served = config.landings[slugKey]?.slugOverride || slugKey;
  try {
    const [points, restoresRaw] = await Promise.all([
      getGscPagePositionTrend(`/${served}`, 90),
      (async () => {
        const pool = db();
        if (!pool) return [];
        try {
          const { rows } = await pool.query<{ created_at: Date; detail: string | null }>(
            "select created_at, detail from audit_log where action = 'seo.contenuti-ripristino-versione' and target = $1 order by created_at desc limit 10",
            [slugKey],
          );
          return rows.map((r: { created_at: Date; detail: string | null }) => ({
            ts: new Date(r.created_at).toISOString(),
            source: (r.detail ?? "").includes("(da base)") ? "base" : (r.detail ?? "").includes("(da storico)") ? "storico" : "override",
          }));
          } catch {
          return [];
        }
      })(),
    ]);
    // I ripristini più vecchi della serie non sono visualizzabili: taglio.
    const windowStart = points.length ? points[0].date : "";
    const restores = restoresRaw
      .filter((r) => r.ts.slice(0, 10) >= windowStart)
      .map(({ ts, source }) => ({ ts, source }));
    return { ok: true, points, restores };
    } catch (e) {
    return { ok: false, error: e instanceof GscError ? e.message : "Search Console non raggiungibile: riprova tra poco." };
  }
}

/**
 * Query reali di Search Console per il pannello SEO: top query del sito
 * (con match sulle keyword configurate) oppure query di una singola pagina
 * quando arriva `slugKey`. Errore gestito → messaggio azionabile in UI.
 */
export async function seoGscQueriesAction(
  slugKey?: string,
): Promise<{ ok: true; data: Awaited<ReturnType<typeof getGscQueries>> } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    if (slugKey) {
      const landing = LANDINGS.find((l) => l.slug === slugKey);
      if (!landing) return { ok: false, error: "Pagina non trovata." };
      const data = await getGscPageQueries(`/${landing.slug}`);
      return { ok: true, data };
    }
    return { ok: true, data: await getGscQueries() };
  } catch (e) {
    return { ok: false, error: e instanceof GscError ? e.message : "Search Console non raggiungibile: riprova tra poco." };
  }
}

/**
 * Bozza di CONTENUTI di una landing scritta da Ambrosio: intro + FAQ
 * coerenti con la keyword e — quando disponibile — con le query reali
 * di Search Console della pagina (le domande sono come le cerca la gente).
 * La keyword è risolta SERVER-SIDE (config salvata → default di codice):
 * nessun input non verificabile dal client. Ritorna DATI, non redirect:
 * la bozza entra nei campi dell'editor e l'operatore rilegge e salva.
 */
export async function seoContentAmbrosioDraftAction(slugKey: string): Promise<
  | { ok: true; intro: string[]; faq: { q: string; a: string }[]; provider: string; usedRealQueries: boolean }
  | { ok: false; error: string }
> {
  const admin = await requireAdmin();
  const landing = LANDINGS.find((l) => l.slug === slugKey);
  if (!landing) return { ok: false, error: "Pagina non trovata." };

  // Keyword, H1 e intro effettivi: override salvato (se non vuoto) → default di codice.
  const config = await getSeoConfig();
  const eff = effectiveLandingSeo(landing, config);
  const keyword = eff.keyword || landing.keyword;
  const h1 = config.contents[slugKey]?.h1 || landing.h1;
  const intro = config.contents[slugKey]?.intro.length ? config.contents[slugKey]!.intro : landing.intro;

  // Query reali della pagina: best effort — se Search Console non è collegata
  // la bozza si genera lo stesso, solo senza quel segnale.
  let realQueries: string[] = [];
  try {
    const gsc = await getGscPageQueries(`/${landing.slug}`);
    realQueries = gsc.rows
      .filter((r) => r.query.trim())
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 8)
      .map((r) => r.query);
  } catch {
    // nessun segnale GSC: si procede con keyword e contesto pagina
  }

  try {
    const res = await draftLandingContent({
      slug: landing.slug,
      h1,
      keyword,
      keywords: eff.keywords,
      intro,
      faqQuestions: landing.faq.map((f) => f.q),
      proof: landing.proof,
      realQueries,
    });
    await logAudit(
      admin.email,
      "ambrosio.bozza_contenuti",
      null,
      `intro+FAQ per /${landing.slug} via ${res.usedProvider}${realQueries.length ? ` (${realQueries.length} query reali)` : ""}`,
    );
    return { ok: true, intro: res.intro, faq: res.faq, provider: res.usedProvider, usedRealQueries: realQueries.length > 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "errore provider";
    return {
      ok: false,
      error:
        msg === "chiave_mancante"
          ? "Nessuna chiave AI attiva: salvala in Ambrosio AI → Provider."
          : "Il provider non ha risposto: riprova tra poco.",
    };
  }
}

/** Traccia su ticket_notes le azioni degli agenti (chi ha fatto cosa, quando). */
async function addAudit(
  pool: NonNullable<ReturnType<typeof db>>,
  email: string,
  action: string,
  conversationId: string,
  value: string | null,
) {
  const label = value ? `${action} → ${value}` : action;
  await pool.query("insert into ticket_notes (conversation_id, author_email, body) values ($1, $2, $3)", [
    conversationId,
    "system",
    `🛠 ${email} — ${label}`,
  ]);
}

/* ── CLIENTI (portafoglio gestito da Ambrosio) ─────────────── */

/**
 * Sync manuale del portafoglio: stesso motore del cron (Ambrosio riconcilia
 * i ticket non ancora visti con le schede clienti). L'esito torna in query
 * string come nelle altre pagine di gestione; ogni giro finisce in audit
 * (client.sync) con l'agente come actor.
 */
export async function syncClientsAction() {
  const user = await requireAdmin();
  const processed = await syncClients(user.email);

  // Notion (config lead, stessa infrastruttura): se l'entità clienti è
  // attiva e c'è la config, accoda le schede aggiornate in questo giro
  // (non bloccante: un errore Notion non tocca il portafoglio).
  let notionMsg = "";
  try {
    const cfg = await getSyncConfig();
    if (cfg.entities.leads.enabled) {
      // Solo le schede mai consegnate: il drain marca notion_synced_at
      // (027, stessa regola dei lead) — senza filtro ogni giro ri-accodava
      // tutte le schede e Notion si riempiva di copie.
      const clients = (await listClients(undefined, 200)).filter(
        (c) => c.synced_at && c.notion_synced_at == null,
      );
      let queued = 0;
      for (const c of clients.slice(0, cfg.sync.batchMax)) {
        const ok = await enqueueNotionSync(
          "client",
          {
            id: c.id,
            name: c.name,
            phone_e164: c.phone_e164,
            contact_email: c.contact_email ?? c.email_norm,
            company_name: c.company_name,
            ticket_count: c.ticket_count,
            channels: (c.channels ?? []).join(", "),
            last_seen_at: c.last_seen_at,
          } as unknown as Record<string, unknown>,
          cfg,
        );
        if (ok) queued++;
      }
      if (queued > 0) {
        const res = await drainNotionQueue({ actor: user.email });
        notionMsg = ` · Notion: ${res.ok} schede sincronizzate${res.failed ? `, ${res.failed} fallite` : ""}`;
      }
    }
  } catch (e) {
    console.error("[syncClientsAction] notion:", e instanceof Error ? e.message : e);
  }

  revalidatePath("/admin/clients");
  redirect(
    `/admin/clients?sync=${encodeURIComponent(
      processed > 0
        ? `Ambrosio ha aggiornato il portafoglio: ${processed} ${processed === 1 ? "ticket riconciliato" : "ticket riconciliati"}${notionMsg}.`
        : `Portafoglio già aggiornato: nessun ticket nuovo da riconciliare.${notionMsg}`,
    )}`,
  );
}

/** Nota libera sulla scheda cliente (max 2000 caratteri, audit tracciato). */
export async function saveClientNotesAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000);
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update clients set notes = $2, updated_at = now() where id = $1", [id, notes]);
  await logAudit(user.email, "client.nota", id);
  revalidatePath(`/admin/clients/${id}`);
  revalidatePath("/admin/clients");
}

/* ── PACCHETTI (proposti da Ambrosio) ───────────────────────────── */

function pkgStr(fd: FormData, key: string, max = 200): string {
  return String(fd.get(key) ?? "").trim().slice(0, max);
}

export async function savePackage(formData: FormData) {
  const user = await requireAdmin();
  const id = pkgStr(formData, "id", 40);
  const name = pkgStr(formData, "name", 80);
  const price = pkgStr(formData, "price_text", 60);
  if (!name || !price) return;
  const includes = pkgStr(formData, "includes", 600)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
  // Catalogo d'appartenenza: 'service' = servizio professionale (fotografo,
  // assistenza SOS…), 'package' = pacchetto sito. Qualsiasi altro valore
  // ricade in 'package' (stessa disciplina di normalizeKind nel layer).
  const kind = pkgStr(formData, "kind", 10) === "service" ? "service" : "package";
  const values = [
    name,
    pkgStr(formData, "tagline", 160) || null,
    price,
    includes,
    Number(pkgStr(formData, "sort_order", 6)) || 0,
    pkgStr(formData, "active", 6) === "on",
    kind,
  ];
  const pool = db();
  if (!pool) return;
  if (id) {
    await pool.query(
      "update packages set name=$1, tagline=$2, price_text=$3, includes=$4, sort_order=$5, active=$6, kind=$7 where id=$8",
      [...values, id],
    );
  } else {
    await pool.query(
      "insert into packages (name, tagline, price_text, includes, sort_order, active, kind) values ($1,$2,$3,$4,$5,$6,$7)",
      values,
    );
  }
  await logAudit(user.email, id ? "pacchetto.modificato" : "pacchetto.creato", name, kind === "service" ? "servizio" : "pacchetto");
  revalidatePath("/admin/packages");
  revalidatePath("/", "page"); // home ISR (revalidate 300): il pubblico vede il catalogo aggiornato subito
}

export async function togglePackage(formData: FormData) {
  const user = await requireAdmin();
  const id = pkgStr(formData, "id", 40);
  const next = pkgStr(formData, "next", 6) === "true";
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update packages set active = $1 where id = $2", [next, id]);
  await logAudit(user.email, "pacchetto.toggle", id, next ? "attivo" : "spento");
  revalidatePath("/admin/packages");
  revalidatePath("/", "page"); // attivo/spento cambia anche la home
}

export async function deletePackage(formData: FormData) {
  const user = await requireAdmin();
  const id = pkgStr(formData, "id", 40);
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query("delete from packages where id = $1", [id]);
  await logAudit(user.email, "pacchetto.eliminato", id);
  revalidatePath("/admin/packages");
  revalidatePath("/", "page"); // la home non deve mostrare un pacchetto eliminato
}

/* ── NOTION (strumento pronto, in attesa chiavi) ────────────────── */

export async function saveNotionAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    await saveNotionSettings({
      enabled: String(formData.get("enabled") ?? "") === "on",
      apiKey: String(formData.get("apiKey") ?? "").trim(),
      databaseId: String(formData.get("databaseId") ?? "").trim() || null,
    });
    await logAudit(user.email, "notion.impostazioni");
    revalidatePath("/admin/notion");
  } catch (e) {
    console.error("[saveNotion]", e);
  }
}

export async function testNotionAction() {
  await requireAdmin();
  const result = await testNotionConnection();
  const msg = result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`;
  redirect(`/admin/notion?test=${encodeURIComponent(msg)}`);
}

/* ── Google Drive (account di servizio) ─────────────────────── */

export async function saveDriveAction(formData: FormData) {
  const user = await requireAdmin();
  const raw = String(formData.get("serviceAccountJson") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  if (remove) {
    await saveDriveCredentials("", { removeCreds: true });
    await logAudit(user.email, "drive.impostazioni", null, "credenziali rimosse");
    redirect("/admin/settings/drive?test=" + encodeURIComponent("Credenziali Drive rimosse."));
  }
  if (!raw) {
    redirect("/admin/settings/drive?test=" + encodeURIComponent("ERRORE — incolla il JSON del service account (o chiedi la rimozione)."));
  }
  const result = await saveDriveCredentials(raw);
  if (!result.ok) {
    redirect("/admin/settings/drive?test=" + encodeURIComponent(`ERRORE — ${result.error ?? "JSON non valido"}`));
  }
  await logAudit(user.email, "drive.impostazioni");
  revalidatePath("/admin/settings/drive");
  redirect("/admin/settings/drive?test=" + encodeURIComponent("Credenziali salvate: ora usa «Prova connessione» per verificare API e condivisione."));
}

/** Test di connessione REALE: JWT → access token → about/get su Drive API. */
export async function testDriveAction() {
  const user = await requireAdmin();
  const result = await testDriveConnection();
  await logAudit(user.email, "drive.test", null, result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`);
  const msg = result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`;
  redirect(`/admin/settings/drive?test=${encodeURIComponent(msg)}`);
}

/* ── Microsoft OneDrive (Microsoft Graph) ─────────────── */

export async function saveOneDriveAction(formData: FormData) {
  const user = await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  if (remove) {
    await saveOneDriveCredentials({ tenantId: "", clientId: "", clientSecret: "" }, { removeCreds: true });
    await logAudit(user.email, "onedrive.impostazioni", null, "credenziali rimosse");
    redirect("/admin/settings/onedrive?test=" + encodeURIComponent("Credenziali OneDrive rimosse."));
  }
  if (!tenantId || !clientId || !clientSecret) {
    redirect("/admin/settings/onedrive?test=" + encodeURIComponent("ERRORE — servono ID tenant, ID applicazione e segreto client (o chiedi la rimozione)."));
  }
  const result = await saveOneDriveCredentials({ tenantId, clientId, clientSecret });
  if (!result.ok) {
    redirect("/admin/settings/onedrive?test=" + encodeURIComponent(`ERRORE — ${result.error ?? "credenziali non valide"}`));
  }
  await logAudit(user.email, "onedrive.impostazioni");
  revalidatePath("/admin/settings/onedrive");
  redirect("/admin/settings/onedrive?test=" + encodeURIComponent("Credenziali salvate: ora usa «Prova connessione» per verificare Microsoft Graph."));
}

/** Test di connessione REALE: client-credentials → token → /sites/root/drive su Graph. */
export async function testOneDriveAction() {
  const user = await requireAdmin();
  const result = await testOneDriveConnection();
  await logAudit(user.email, "onedrive.test", null, result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`);
  const msg = result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`;
  redirect(`/admin/settings/onedrive?test=${encodeURIComponent(msg)}`);
}

/* ── GOOGLE CALENDAR: salvataggio, test, backfill ─────────────────── */

export async function saveGCalAction(formData: FormData) {
  const user = await requireAdmin();
  const raw = String(formData.get("serviceAccountJson") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  if (remove) {
    await saveGCalConfig({ serviceAccountJson: "-" });
    await logAudit(user.email, "gcal.impostazioni", null, "credenziali rimosse");
    redirect("/admin/settings/google-calendar?msg=" + encodeURIComponent("Credenziali Google Calendar rimosse."));
  }
  const enabled = formData.get("enabled") === "on";
  const syncToNotion = formData.get("syncToNotion") === "on";
  const calendarIdRaw = String(formData.get("calendarId") ?? "").trim();
  const result = await saveGCalConfig({
    ...(raw ? { serviceAccountJson: raw } : {}),
    calendarId: calendarIdRaw,
    enabled,
    syncToNotion,
  });
  if (!result.ok) {
    redirect("/admin/settings/google-calendar?msg=" + encodeURIComponent(`ERRORE — ${result.error ?? "config non valida"}`));
  }
  await logAudit(user.email, "gcal.impostazioni", null, `config salvata (enabled: ${enabled ? "sì" : "no"}, mirror Notion: ${syncToNotion ? "sì" : "no"})`);
  redirect("/admin/settings/google-calendar?msg=" + encodeURIComponent("OK — configurazione salvata. Ora usa «Prova connessione»: il test interroga davvero il calendario."));
}

export async function testGCalAction() {
  const user = await requireAdmin();
  const result = await testGCalConnection();
  await logAudit(user.email, "gcal.test", null, result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`);
  const msg = result.ok ? `OK — ${result.message}` : `ERRORE — ${result.message}`;
  redirect(`/admin/settings/google-calendar?msg=${encodeURIComponent(msg)}`);
}

/**
 * Backfill: ripercorre le callback pendenti senza evento e le sincronizza
 * (max 20 per richiesta: si rilancia finché il messaggio dice 0 creati).
 */
export async function backfillGCalAction() {
  const user = await requireAdmin();
  const r = await backfillGCalEvents(20);
  await logAudit(user.email, "gcal.backfill", null, `${r.created} creati, ${r.skipped} saltati, ${r.errors} errori su ${r.processed} callback`);
  const msg = r.processed === 0
    ? "OK — nessuna callback pendente senza evento: tutto già sul calendario."
    : `OK — ${r.created} eventi creati, ${r.skipped} saltati, ${r.errors} errori su ${r.processed} callback.${r.errors > 0 ? " Riprova: le callback non ancora sincronizzate verranno ritentate." : ""}`;
  redirect(`/admin/settings/google-calendar?msg=${encodeURIComponent(msg)}`);
}

/**
 * RIPROVA le callback fallite (errori in gcal_sync_log mai consegnate):
 * max 10 per richiesta, stesso percorso e stesso log di una callback nuova.
 */
export async function retryGCalAction() {
  const user = await requireAdmin();
  const r = await retryFailedGCalSync(10);
  await logAudit(user.email, "gcal.retry", null, `${r.ok} recuperate, ${r.errors} ancora in errore su ${r.retried} riprovate`);
  const msg = r.retried === 0
    ? "OK — nessuna callback da recuperare: la sync è al passo con il calendario."
    : `OK — ${r.ok} recuperate, ${r.errors} ancora in errore su ${r.retried} riprovate.${r.errors > 0 ? " Controlla i dettagli sotto e riprova." : ""}`;
  redirect(`/admin/settings/google-calendar?msg=${encodeURIComponent(msg)}`);
}

/**
 * Sincronizza ora: svuota la coda (drain). La coda è persistente: un
 * record fallito resta visibile nel sync log con tentativi ed errore.
 */
export async function syncLeadsNotionAction() {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) redirect("/admin/notion?test=" + encodeURIComponent("ERRORE — database non configurato"));

  // Config lead attiva? (default: sì, comportamento odierno)
  const config = await getSyncConfig();
  if (!config.entities.leads.enabled) {
    redirect("/admin/notion?test=" + encodeURIComponent("La sincronizzazione lead è disattivata nella config."));
  }

  // Enqueue dei lead non ancora sincronizzati (payload calcolato dal motore).
  const { rows: leads } = await pool.query(
    "select * from leads where notion_synced_at is null order by created_at desc limit $1",
    [config.sync.batchMax],
  );
  for (const lead of leads) await enqueueNotionSync("lead", lead as Record<string, unknown>, config);

  const res = await drainNotionQueue({ actor: user.email });

  // Marca i lead consegnati (l'idempotenza resta su notion_synced_at).
  if (res.ok > 0) {
    await pool.query(
      `update leads set notion_synced_at = now()
       where notion_synced_at is null and id in (select record_id from notion_sync_queue_delivered)`,
    ).catch(() => {});
  }

  const msg = res.processed === 0
    ? "Nessun lead nuovo da sincronizzare."
    : res.failed === 0 && res.retried === 0
      ? `OK — sincronizzati ${res.ok} lead su Notion.`
      : `OK ${res.ok} · ritenti ${res.retried} · falliti ${res.failed} — ${res.messages.slice(0, 2).join(" · ")}`;
  redirect(`/admin/notion?test=${encodeURIComponent(msg)}`);
}

/** Dry-run: mostra il payload che verrebbe inviato per il prossimo lead, senza chiamare l'API. */
export async function dryRunNotionAction() {
  await requireAdmin();
  const pool = db();
  if (!pool) redirect("/admin/notion?dryrun=" + encodeURIComponent("Database non configurato."));
  const config = await getSyncConfig();
  const { rows } = await pool.query(
    "select * from leads where notion_synced_at is null order by created_at desc limit 1",
  );
  if (!rows[0]) {
    redirect("/admin/notion?dryrun=" + encodeURIComponent("Nessun lead da mostrare: la coda è vuota."));
  }
  const { properties, propErrors } = buildNotionPayload(config, config.leadMapping, rows[0] as Record<string, unknown>);
  const payload = {
    parent: { database_id: "(dal database configurato)" },
    properties,
  };
  const parts = [
    JSON.stringify(payload, null, 2).slice(0, 3500),
    ...(propErrors.length ? ["\n⚠ Avvisi: " + propErrors.join(" · ")] : []),
  ];
  redirect("/admin/notion?dryrun=" + encodeURIComponent(parts.join("")));
}

/* ── STRUMENTI GOOGLE ─────────────────────────────────────────── */

export async function saveGoogleToolsAction(formData: FormData) {
  const user = await requireAdmin();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const removeApiKey = String(formData.get("removeApiKey") ?? "") === "on";
  await saveGoogleToolsConfig({
    ga4Id: String(formData.get("ga4Id") ?? ""),
    gtmId: String(formData.get("gtmId") ?? ""),
    gscToken: String(formData.get("gscToken") ?? ""),
    clarityId: String(formData.get("clarityId") ?? ""),
    apiKey: apiKey || undefined,
    removeApiKey,
  });
  await logAudit(user.email, "google-tools.impostazioni");
  revalidatePath("/admin/settings/google");
}

export async function testGooglePageSpeedAction() {
  const user = await requireAdmin();
  const key = await getGoogleApiKey();
  const result = await testPageSpeed(key ?? undefined);
  await logAudit(user.email, "google-tools.pagespeed-test", null, result.message);
  redirect(`/admin/settings/google?google_test=${encodeURIComponent(result.message)}`);
}

/* ── SEARCH CONSOLE API (query reali in /admin/seo) ──────────── */

/**
 * Salva le credenziali OAuth per l'API Search Console (client id/secret +
 * refresh token + proprietà). Il refresh token viene cifrato e non torna
 * mai al browser; i dati delle query restano server-side.
 */
export async function saveGscCredentialsAction(formData: FormData) {
  const user = await requireAdmin();
  const rawJson = String(formData.get("gscJson") ?? "");
  const siteUrl = String(formData.get("gscSiteUrl") ?? "");
  const result = await saveGscCredentials(rawJson, siteUrl);
  if (result.ok) {
    await logAudit(user.email, "google-tools.gsc-creds", null, `proprietà ${siteUrl.trim() || "(vuota)"}`);
    redirect("/admin/settings/google?gsc_test=Credenziali%20salvate%3A%20usa%20%C2%ABTesta%20collegamento%C2%BB%20per%20verificarle.");
  }
  redirect(`/admin/settings/google?gsc_test=${encodeURIComponent(result.error ?? "Errore salvataggio")}`);
}

/** Test di connessione a Search Console (permessi sulla proprietà). */
export async function testGscConnectionAction() {
  const user = await requireAdmin();
  const result = await testGscConnection();
  await logAudit(user.email, "google-tools.gsc-test", null, result.message);
  redirect(`/admin/settings/google?gsc_test=${encodeURIComponent(result.message)}`);
}

/** Rimuove le credenziali Search Console salvate. */
export async function removeGscCredentialsAction() {
  const user = await requireAdmin();
  await removeGscCredentials();
  await logAudit(user.email, "google-tools.gsc-creds-rimosse");
  redirect("/admin/settings/google?gsc_test=Credenziali%20Search%20Console%20rimosse.");
}

/* ── STRUMENTO EMAIL (SMTP + IMAP) ───────────────────────────── */

/**
 * Salva la configurazione email dell'agenzia (server, credenziali).
 * La password resta cifrata: qui passa via form e muore nel save.
 */
export async function saveEmailToolsAction(formData: FormData) {
  const user = await requireAdmin();
  const result = await saveEmailToolsConfig({
    fromEmail: String(formData.get("fromEmail") ?? ""),
    fromName: String(formData.get("fromName") ?? ""),
    smtpHost: String(formData.get("smtpHost") ?? ""),
    smtpPort: Number(formData.get("smtpPort") ?? 587),
    imapHost: String(formData.get("imapHost") ?? ""),
    imapPort: Number(formData.get("imapPort") ?? 993),
    user: String(formData.get("user") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  await logAudit(user.email, result.ok ? "email-tools.impostazioni" : "email-tools.errore", null, result.error ?? null);
  redirect(
    result.ok
      ? "/admin/settings/email?email_test=Configurazione%20email%20salvata"
      : `/admin/settings/email?email_test=${encodeURIComponent(result.error ?? "Errore salvataggio")}`,
  );
}

/** Test live SMTP+IMAP con invio reale di una email di prova. */
export async function testEmailToolsAction(formData: FormData) {
  const user = await requireAdmin();
  const config = await getEmailToolsConfig();
  const recipient = String(formData.get("testRecipient") ?? "").trim() || config.fromEmail || config.user;
  const result = await testEmailConnection(config, recipient);
  const message = result.smtp.ok
    ? `SMTP ok — ${result.smtp.message}${result.imap.ok ? ` · IMAP ok — ${result.imap.message}` : result.imap.message ? ` · IMAP: ${result.imap.message}` : ""}`
    : `SMTP: ${result.smtp.message}`;
  await logAudit(user.email, "email-tools.test", null, message);
  redirect(`/admin/settings/email?email_test=${encodeURIComponent(message)}`);
}

/**
 * Sync manuale del canale email: scarica la casella e trasforma le email
 * in ticket o risposte (stesso motore del cron). Il bottone «Sincronizza
 * ora» in Tools e nella inbox email usa questa azione.
 */
export async function syncEmailIngestAction() {
  const user = await requireAdmin();
  const result = await ingestEmails();
  const summary = `email viste: ${result.fetched} · nuove accodate: ${result.queued} · ticket creati: ${result.created} · risposte a ticket: ${result.replied}${result.errors.length ? ` · errori: ${result.errors.join("; ").slice(0, 300)}` : ""}`;
  await logAudit(user.email, "email-ingest.sync", null, summary);
  revalidatePath("/admin/tickets");
  revalidatePath("/admin/settings");
  redirect(
    result.errors.length && !result.created && !result.replied
      ? `/admin/settings/email?email_test=${encodeURIComponent(`Sync con errori: ${summary}`)}`
      : `/admin/tickets?f=tutti&sync=${encodeURIComponent(summary)}`,
  );
}

/**
 * Nuovo ticket manuale creato dall'agente (come in qualsiasi CRM):
 * via email l'agente apre il caso e la prima risposta parte via SMTP
 * con oggetto «[#N] …». Canale 'email' perché il cliente risponde
 * nella sua casella, non nella web chat.
 */
export async function createTicketAction(formData: FormData) {
  const user = await requireAdmin();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim().slice(0, 200);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 200);
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  // Email formattata (WpEditor): l'HTML arriva dall'editor e viene
  // SANITIZZATO lato server — il client non è mai fidato.
  const bodyHtmlRaw = String(formData.get("bodyHtml") ?? "");
  const priority = String(formData.get("priority") ?? "normale");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!EMAIL_RE.test(contactEmail) || !subject || !body) {
    redirect(`/admin/tickets/new?error=${encodeURIComponent("Email, oggetto e messaggio sono obbligatori (email deve essere valida).")}`);
  }
  const pool = db();
  if (!pool) return;
  const { rows } = await pool.query<{ id: string; number: number }>(
    `insert into conversations (channel, status, initial_query, contact_email, priority, assigned_to)
     values ('email', 'open', $1, $2, $3, $4) returning id, number`,
    [
      subject,
      contactEmail,
      TICKET_PRIORITIES.includes(priority as (typeof TICKET_PRIORITIES)[number]) ? priority : "normale",
      user.operatorId,
    ],
  );
  const ticket = rows[0];
  await pool.query(
    "insert into messages (conversation_id, sender, body, author) values ($1, 'operator', $2, $3)",
    [ticket.id, body, user.displayName],
  );
  await pool.query(
    "update conversations set first_response_at = now(), sla_next_reply_due = null where id = $1",
    [ticket.id],
  );
  // La prima risposta parte davvero via SMTP: il cliente trova l'email
  // con oggetto [#N] e risponde nel filo → il ticket si alimenta da sé.
  // Con il WpEditor l'email è multipart: testo piano + HTML formattato
  // (stesso contenuto, whitelisted) — i client mostrano l'HTML.
  const hasHtml = bodyHtmlRaw.includes("<");
  const bodyHtml = hasHtml ? sanitizeEmailHtml(bodyHtmlRaw) : "";
  const textBody = hasHtml
    ? htmlToEmailText(bodyHtml)
    : `${body}\n\n— ${user.displayName}, Web Agency Salento\nRispondi a questa email: finirà nel ticket #${ticket.number}.`;
  const signatureHtml = `<p style="color:#64748b;font-size:13px;margin:16px 0 0;">— ${user.displayName}, Web Agency Salento<br>Rispondi a questa email: finirà nel ticket #${ticket.number}.</p>`;
  const sent = await sendEmailViaTools({
    to: contactEmail,
    subject: `[#${ticket.number}] ${subject}`,
    text: textBody,
    ...(hasHtml ? { html: buildEmailHtml(`${bodyHtml}${signatureHtml}`) } : {}),
  });
  await logAudit(
    user.email,
    "ticket.creato",
    ticket.id,
    sent.ok ? `#${ticket.number} via email a ${contactEmail}` : `#${ticket.number} — invio fallito: ${sent.error ?? "?"}`,
  );
  revalidatePath("/admin/tickets");
  redirect(`/admin/tickets/${ticket.id}`);
}

/* ── BACKUP E AGGIORNAMENTI VERSIONE ─────────────────────────── */

/**
 * Prepara un backup completo: registra la voce nello storico e ridirige
 * alla rotta di download con l'id. Il file vero si genera nella rotta
 * autenticata con i dati PIÙ FRESCI al momento dello scaricamento: la voce
 * dello storico è il riferimento, non una copia congelata. Il redirect è
 * fuori dal try: il NEXT_REDIRECT di redirect() non deve finire nel catch.
 */
export async function createBackupAction() {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) {
    redirect("/admin/tools/backup?backup_test=" + encodeURIComponent("ERRORE — database non configurato"));
  }
  let downloadId: string | null = null;
  let historyOk = true;
  let error: string | null = null;
  try {
    const payload = await buildBackupPayload(user.email);
    // Lo storico è best-effort: senza migration 024 il backup parte
    // comunque (id sintetico, solo il download), l'elenco lo dirà.
    const recorded = await recordBackup({
      createdBy: user.email,
      sizeBytes: payload.sizeBytes,
      counts: payload.counts,
    });
    downloadId = recorded ?? randomUUID();
    historyOk = recorded !== null;
    const detail = `${humanBytes(payload.sizeBytes)} · ${Object.entries(payload.counts)
      .map(([t, n]) => `${t}:${n}`)
      .join(", ")}`;
    await logAudit(user.email, "backup.creato", downloadId, detail.slice(0, 400));
  } catch (e) {
    error = e instanceof Error ? e.message : "errore sconosciuto";
    await logAudit(user.email, "backup.errore", null, error.slice(0, 200)).catch(() => {});
  }
  if (error || !downloadId) {
    redirect(`/admin/tools/backup?backup_test=${encodeURIComponent(`Backup non riuscito: ${error ?? "?"}`)}`);
  }
  const qs = new URLSearchParams({ backup_download: downloadId });
  if (!historyOk) qs.set("backup_test", "Backup scaricato ma storico non registrato (migration 024 mancante?).");
  redirect(`/admin/tools/backup?${qs.toString()}`);
}

/** Elimina una voce dallo storico (soft-delete: la traccia resta nel DB). */
export async function deleteBackupAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  const ok = await softDeleteBackup(id);
  if (ok) await logAudit(user.email, "backup.eliminato", id);
  revalidatePath("/admin/tools/backup");
}

/** Salva i giorni di promemoria backup (0 = promemoria OFF, max 180). */
export async function saveBackupReminderAction(formData: FormData) {
  const user = await requireAdmin();
  const raw = String(formData.get("days") ?? "").trim();
  const days = Number(raw);
  const value = !raw || days === 0 ? 0 : Math.round(days);
  if (!Number.isFinite(value) || value < 0 || value > 180) return;
  await setBackupReminderDays(value);
  await logAudit(user.email, "backup.promemoria", null, value === 0 ? "disattivato" : `ogni ${value} giorni`);
  revalidatePath("/admin/tools/backup");
}

/**
 * Verifica aggiornamenti: confronta la versione installata di Next.js con
 * l'ultima pubblicata su npm. Solo INFORMATIVO: il codice si aggiorna da
 * Git/Vercel (per design, mai da un pannello). L'app è privata: l'unica
 * dipendenza che guida lo stack è Next, e il check è su quella.
 */
export async function checkVersionAction() {
  const user = await requireAdmin();
  const app = currentVersion();
  const installed = installedNextVersion();
  const { ok, latest } = await checkLatestVersion("next");
  let msg: string;
  if (!installed) {
    msg = "Versione di Next.js non rilevabile: controlla l'installazione.";
  } else if (!ok || !latest) {
    msg = `npm registry non raggiungibile: impossibile verificare. Installato: Next ${installed}.`;
  } else if (installed === latest) {
    msg = `Tutto aggiornato: Next ${installed} = ultima pubblicata su npm.`;
  } else {
    msg = `Aggiornamento disponibile: Next ${installed} → ${latest}. Verifica la compatibilità, poi aggiorna da Git/Vercel (mai da qui).`;
  }
  await logAudit(user.email, "versione.check", null, msg.slice(0, 200));
  redirect(`/admin/tools/backup?version_test=${encodeURIComponent(`App v${app} · ${msg}`)}`);
}

/**
 * RESTORE (fase 1): il backup caricato viene ANALIZZATO, non eseguito.
 * Il piano (righe per tabella, tabelle saltate) torna in query string e
 * il JSON rientra nel form di conferma come campo nascosto — nessun file
 * salvato sul server, la fonte resta il file scelto dall'operatore.
 * Il redirect è fuori dal try: il NEXT_REDIRECT non deve finire nel catch.
 */
export async function restorePlanAction(formData: FormData) {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent("Scegli un file di backup (.json) da ripristinare.")}`);
  }
  if (file.size > 128 * 1024 * 1024) {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent("File troppo grande (limite 128 MB).")}`);
  }
  const json = await file.text();
  const plan = await planRestore(json);
  if (!plan.ok) {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent(plan.error)}`);
  }
  if (!plan.plan.some((p) => p.restore)) {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent("Il backup non contiene tabelle ripristinabili (solo log append-only o tabelle sconosciute).")}`);
  }
  const qs = new URLSearchParams();
  qs.set("restore_plan", JSON.stringify({ plan: plan.plan, meta: plan.meta }));
  qs.set("restore_json", json);
  redirect(`/admin/tools/backup?${qs.toString()}`);
}

/**
 * RESTORE (fase 2): esecuzione con conferma esplicita. Il testo digitato
 * deve coincidere ESATTAMENTE con la frase mostrata — la casella del form
 * non si riempie per sbaglio. Tutto in una transazione lato lib: o tutte
 * le tabelle scelte, o nessuna. Esito dettagliato in query string + audit.
 */
export async function restoreConfirmAction(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) {
    redirect("/admin/tools/backup?restore_error=" + encodeURIComponent("ERRORE — database non configurato"));
  }
  const json = String(formData.get("json") ?? "");
  const selected = formData.getAll("tables").map((t) => String(t));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!json || !selected.length) {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent("Nessuna tabella selezionata: il restore non è partito.")}`);
  }
  if (confirm !== "RIPRISTINA") {
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent("Conferma non corretta: scrivi RIPRISTINA per procedere. Nessun dato è stato toccato.")}`);
  }
  let result: RestoreResult | null = null;
  let error: string | null = null;
  try {
    result = await executeRestore(json, selected);
  } catch (e) {
    // Le violazioni FK di Postgres arrivano come errori opachi: il messaggio
    // umano resta quello dell'azione (dipendenze) o il rollback dichiarato.
    error = e instanceof Error ? e.message : "errore sconosciuto";
    if (error.includes("dipendenze mancanti")) {
      redirect(`/admin/tools/backup?restore_error=${encodeURIComponent(error)}`);
    }
  }
  if (error || !result) {
    await logAudit(user.email, "restore.errore", null, (error ?? "?").slice(0, 400)).catch(() => {});
    redirect(`/admin/tools/backup?restore_error=${encodeURIComponent(`Restore annullato: ${error ?? "?"}. Nessun dato è stato modificato (rollback completo).`)}`);
  }
  const detail = Object.entries(result.restored)
    .map(([t, n]) => `${t}:${n}`)
    .join(", ");
  await logAudit(user.email, "restore.eseguito", null, `${detail}${result.sequences.length ? ` · ${result.sequences.join(", ")}` : ""}`);
  revalidatePath("/", "layout");
  const qs = new URLSearchParams();
  qs.set("restore_done", JSON.stringify(result));
  qs.set("backup_test", `Restore completato: ${detail}. I dati sono tornati allo stato del backup.`);
  redirect(`/admin/tools/backup?${qs.toString()}`);
}

/* ── TEMA GRAFICO (PROMPT-TEMI-GRAFICI.md — Prompt 3) ────────── */

/**
 * Salva il tema in content_settings (unica scrittura nuova ammessa:
 * chiave site_theme). Validazione: tema noto, hex validi — tutto il
 * resto scarta e resta al default. revalidatePath("/", "layout")
 * invalida sito + admin: il root layout rilegge il tema server-side.
 */
export async function saveThemeAction(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const theme = String(formData.get("theme") ?? "classic") === "zendesk" ? "zendesk" : "classic";
  const mode = String(formData.get("mode") ?? "light") === "dark" ? "dark" : "light";
  const hex = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null);
  const primary = hex(String(formData.get("primary") ?? ""));
  const accent = hex(String(formData.get("accent") ?? ""));
  const value: Record<string, unknown> = { theme, mode };
  if (primary) value.primary = primary;
  if (accent) value.accent = accent;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    ["site_theme", JSON.stringify(value)],
  );
  await logAudit(user.email, "tema.salvato", theme, primary ?? "colori default");
  revalidatePath("/", "layout");
}

/* ── HERO ANIMATO (tools → hero, chiave site_hero) ─────────── */

/* ── TTL CACHE PAGINE PUBBLICHE (Tools → Prestazioni) ────── */

/**
 * Salva il TTL della cache CDN delle pagine pubbliche
 * (content_settings, chiave dedicata: zero migration).
 * Il cambio finisce in audit con vecchio→nuovo: la
 * freschezza del sito pubblico è una leva misurabile.
 * Il proxy lo applica entro ~30s (cache in-process) e
 * la rotta /api/page-cache/config ha CDN a 60s.
 */
export async function savePageCacheTtl(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;

  const raw = Number(String(formData.get("ttlSeconds") ?? "").trim());
  const next = sanitizePageCacheConfig({ ttlSeconds: raw });
  const prev = await readPageCacheConfig();

  await pool.query(
    `insert into content_settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [PAGE_CACHE_KEY, JSON.stringify(next)],
  );
  await logAudit(
    user.email,
    "cache.ttl",
    PAGE_CACHE_KEY,
    `${prev.ttlSeconds}→${next.ttlSeconds}s`,
  );
  revalidatePath("/admin/tools/perf");
}

/* ── TARGET DI RISPOSTA ADMIN (Tools → Prestazioni) ──────── */

/**
 * Salva il target di risposta della scheda Velocità
 * (content_settings, chiave dedicata: zero migration).
 * Il cursore colora le barre della scheda al momento;
 * il salvato è la soglia verde che il piano si dà.
 * Il cambio finisce in audit con vecchio→nuovo.
 */
export async function savePerfTarget(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;

  const raw = Number(String(formData.get("targetMs") ?? "").trim());
  const next = sanitizePerfTargetConfig({ targetMs: raw });
  const prev = await readPerfTargetConfig();

  await pool.query(
    `insert into content_settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [PERF_TARGET_KEY, JSON.stringify(next)],
  );
  await logAudit(
    user.email,
    "perf.target",
    PERF_TARGET_KEY,
    `${prev.targetMs}→${next.targetMs}ms`,
  );
  revalidatePath("/admin/tools/perf");
}

/**
 * FREE CACHE (Tools → Free cache) — modello del gemello (0.7.0): scelta dei
 * target a catalogo (cache-shared), conferma a due fasi, motivo libero in
 * audit. Aggiunta Salento che resta: la purga tocca anche le cache
 * in-process del PROXY (manutenzione e redirect SEO, fino a 60s) — le
 * revalidate di Next non le coprono. Ordine fisso: requireAdmin → selezione
 * tipo-sicura → conferma esplicita → purga (Next + proxy) → audit →
 * redirect con esito.
 */
export async function purgeCacheAction(formData: FormData) {
  const user = await requireAdmin();
  const targets = selectedTargets(formData);
  // Gate doppio: serve almeno un target del catalogo E il flag di conferma
  // della fase due. Un form senza conferma non fa nulla.
  if (targets.length === 0 || !wantsTarget(formData, targets)) return;

  const reason = sanitizeCacheReason(formData.get("reason"));
  const ok = await purgeSiteCache(targets);
  // Solo-Salento: il proxy (manutenzione, redirect SEO) tiene cache
  // in-process che le revalidate di Next non invalidano.
  if (ok) purgeProxyCaches();
  await logAudit(
    user.email,
    "cache.purga",
    targetLabels(targets),
    ok ? reason || null : `errore: ${reason || "senza motivo"}`,
  );
  const qs = new URLSearchParams();
  qs.set("purged", ok ? "1" : "0");
  qs.set("targets", targets.join(","));
  if (reason) qs.set("reason", reason);
  redirect(`/admin/tools/cache?${qs.toString()}`);
}

/**
 * Salva l'hero animato in content_settings (chiave site_hero). La
 * normalizzazione è TUTTA in sanitizeHeroConfig (hero-shared, pura e
 * testata): qui si passa il form grezzo e si registra l'azione.
 * revalidatePath("/", "layout") invalida la home: l'hero deciderà lì
 * se sostituire il blocco statico (enabled) o lasciare tutto com'era.
 */
export async function saveHeroAction(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const raw = {
    enabled: String(formData.get("enabled") ?? "0") === "1",
    abTest: String(formData.get("abTest") ?? "off"),
    template: String(formData.get("template") ?? ""),
    eyebrow: String(formData.get("eyebrow") ?? ""),
    title: String(formData.get("title") ?? ""),
    titleHighlight: String(formData.get("titleHighlight") ?? ""),
    subtitle: String(formData.get("subtitle") ?? ""),
    placeholder: String(formData.get("placeholder") ?? ""),
    font: String(formData.get("font") ?? ""),
    accent: String(formData.get("accent") ?? ""),
    gradient: String(formData.get("gradient") ?? ""),
    cursor: String(formData.get("cursor") ?? ""),
    cursorAccent: String(formData.get("cursorAccent") ?? ""),
  };
  const value = sanitizeHeroConfig(raw);
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [HERO_KEY, JSON.stringify(value)],
  );
  await logAudit(
    user.email,
    "hero.salvato",
    value.enabled ? value.template : "statico",
    `font=${value.font}${value.accent ? ` accent=${value.accent}` : ""}${value.abTest === "on" ? " ab=on" : ""} cursor=${value.cursor}${value.cursorAccent ? ` cursorAccent=${value.cursorAccent}` : ""}`,
  );
  revalidatePath("/", "layout");
  redirect("/admin/tools/hero?saved=1");
}

/**
 * FASE 4 — Sincronizzazione entità disattivate di default (tickets/callbacks).
 * Attive SOLO da config: senza la voce enabled non generano chiamate API.
 * Enqueue da audit/console: il drain le spinge col mapping dedicato.
 */
export async function syncEntityNotionAction(formData: FormData) {
  const user = await requireAdmin();
  const entity = String(formData.get("entity") ?? "");
  if (entity !== "tickets" && entity !== "callbacks") return;
  const pool = db();
  if (!pool) redirect("/admin/notion?test=" + encodeURIComponent("ERRORE — database non configurato"));
  const config = await getSyncConfig();
  const cfg = entity === "tickets" ? config.entities.tickets : config.entities.callbacks;
  if (!cfg.enabled) {
    redirect("/admin/notion?test=" + encodeURIComponent(`L'entità «${entity}» è disattivata nella config: nessuna chiamata API generata.`));
  }
  const table = entity === "tickets" ? "conversations" : "callbacks";
  const { rows } = await pool.query(
    `select * from ${table} order by updated_at desc nulls last, created_at desc limit $1`,
    [config.sync.batchMax],
  );
  for (const row of rows) {
    await enqueueNotionSync(entity === "tickets" ? "ticket" : "callback", row as Record<string, unknown>, config);
  }
  const res = await drainNotionQueue({ actor: user.email });
  const msg = res.processed === 0
    ? `Nessun ${entity === "tickets" ? "ticket" : "callback"} da sincronizzare.`
    : res.failed === 0
      ? `OK — sincronizzati ${res.ok} ${entity} su Notion.`
      : `OK ${res.ok} · ritenti ${res.retried} · falliti ${res.failed} — ${res.messages.slice(0, 2).join(" · ")}`;
  redirect(`/admin/notion?test=${encodeURIComponent(msg)}`);
}

/** Salva la config di sincronizzazione (mapping, titolo, select, retry). */
export async function saveNotionSyncConfigAction(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  try {
    const raw = JSON.parse(String(formData.get("configJson") ?? "{}")) as unknown;
    await saveSyncConfig(sanitizeSyncConfig(raw));
    await logAudit(user.email, "notion.config");
    revalidatePath("/admin/notion");
  } catch (e) {
    console.error("[notion config]", e);
    redirect("/admin/notion?test=" + encodeURIComponent("ERRORE — config non valida (JSON malformato?)."));
  }
}

/* ── STRUMENTI LEAD: temperatura + ricontatto + elimina ─────────── */

export async function setLeadTemperature(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const temperature = String(formData.get("temperature") ?? "");
  if (!id || !["caldo", "tiepido", "freddo"].includes(temperature)) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update leads set temperature = $1 where id = $2", [temperature, id]);
  await logAudit(user.email, "lead.temperatura", id, temperature);
  revalidatePath("/admin/leads");
}

export async function scheduleLeadRecall(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const days = Number(formData.get("days") ?? 0);
  if (!id || !Number.isFinite(days) || days <= 0 || days > 60) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update leads set ricontatta_il = now() + ($1 || ' days')::interval where id = $2", [
    String(Math.round(days)),
    id,
  ]);
  await logAudit(user.email, "lead.ricontatta", id, `tra ${Math.round(days)} giorni`);
  revalidatePath("/admin/leads");
}

export async function deleteLead(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  // stacca la conversazione (se collegata) e cancella il lead
  await pool.query("update conversations set lead_id = null where lead_id = $1", [id]);
  await pool.query("delete from callbacks where lead_id = $1", [id]);
  await pool.query("delete from leads where id = $1", [id]);
  await logAudit(user.email, "lead.eliminato", id);
  revalidatePath("/admin/leads");
}

/* ── CALLBACK: richiama ora + elimina ───────────────────────────── */

export async function deleteCallback(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  // GOOGLE CALENDAR (se attivo): prima di cancellare la callback rimuovi l'evento
  // (poi la riga sparisce: il dedup non potrà più trovarla).
  await queueGCalSyncForCallback(pool, id, "delete");
  await pool.query("delete from callbacks where id = $1", [id]);
  await logAudit(user.email, "callback.eliminata", id);
  revalidatePath("/admin/callbacks");
}

export async function recallCallbackNow(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  // sposta la callback a "proprio ora": appare in cima come da fare subito
  await pool.query("update callbacks set scheduled_at = now(), status = 'pending' where id = $1", [id]);
  // GOOGLE CALENDAR (se attivo): l'evento già creato viene riprogrammato a ora.
  await rescheduleGCalEvent(pool, id, new Date());
  await logAudit(user.email, "callback.richiama-ora", id);
  revalidatePath("/admin/callbacks");
}

/* ── OPERATORI: modifica turni inline ───────────────────────────── */

export async function updateOperatorShifts(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const start = Number(formData.get("start") ?? -1);
  const end = Number(formData.get("end") ?? -1);
  if (!id || !Number.isInteger(start) || !Number.isInteger(end)) return;
  if (start < 0 || start > 23 || end < 1 || end > 24 || end <= start) return;
  const pool = db();
  if (!pool) return;
  await pool.query("update operators set shift_start = $1, shift_end = $2 where id = $3", [start, end, id]);
  await logAudit(user.email, "operatore.turni", id, `${start}:00–${end}:00`);
  revalidatePath("/admin/operators");
  revalidatePath("/admin");
}

/* ── PACCHETTI: duplica ─────────────────────────────────────────── */

export async function duplicatePackage(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const pool = db();
  if (!pool) return;
  await pool.query(
    `insert into packages (name, tagline, price_text, includes, sort_order, active, kind)
     select name || ' (copia)', tagline, price_text, includes, sort_order + 5, false, kind from packages where id = $1`,
    [id],
  );
  await logAudit(user.email, "pacchetto.duplicato", id);
  revalidatePath("/admin/packages");
}

/* ── AMBROSIO: reset prompt al default ──────────────────────────── */

export async function resetAiPromptAction() {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  await pool.query("update ai_settings set system_prompt = null where id = 1");
  await logAudit(user.email, "ai.reset-prompt");
  revalidatePath("/admin/ai");
}

/* ── SLA: policy per priorità (Fase 1.3) ────────────────────── */

/**
 * Salva le ore [prossima risposta, risoluzione] per priorità (una riga per
 * priorità: "urgente,1,4"). Validazione stretta: priorità nota, ore intere
 * 1–336, risoluzione ≥ prossima risposta.
 */
export async function saveSlaPolicy(formData: FormData) {
  const user = await requireAdmin();
  const raw = String(formData.get("policy") ?? "");
  const policy: Record<string, { nextReplyH: number; resolveH: number }> = {};
  for (const line of raw.split("\n")) {
    const [name, nrS, rsS] = line.split(",").map((s) => s.trim());
    if (!TICKET_PRIORITIES.includes(name as (typeof TICKET_PRIORITIES)[number])) continue;
    const nr = Number(nrS);
    const rs = Number(rsS);
    if (!Number.isFinite(nr) || !Number.isFinite(rs) || nr < 1 || rs < 1 || nr > 336 || rs > 336) continue;
    if (rs < nr) continue;
    policy[name] = { nextReplyH: Math.round(nr), resolveH: Math.round(rs) };
  }
  if (!Object.keys(policy).length) return;
  const pool = db();
  if (!pool) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [SLA_POLICY_KEY, JSON.stringify(policy)],
  );
  // Stessa ragione di saveQuickReplies: il render post-revalidate rilegge fresco.
  bumpContentSettingsVersion();
  await logAudit(user.email, "ticket.sla-policy", null, JSON.stringify(policy));
  revalidatePath("/admin/settings");
  revalidatePath("/admin/tickets");
}

/* ── CRON: chiusura automatica (Fase 2, default OFF) ───────────── */

/**
 * Configura dopo quanti giorni di «In attesa cliente» chiudere i ticket
 * (0 o vuoto = disattivata). Il valore lo legge /api/cron/tick: se attiva,
 * ogni chiusura automatica finisce in audit come azione system.
 */
export async function saveAutoCloseDays(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const raw = String(formData.get("days") ?? "").trim();
  const days = Number(raw);
  // 0/vuoto = off; altrimenti 1–60 giorni.
  const value = !raw || days === 0 ? 0 : Math.round(days);
  if (!Number.isFinite(value) || value < 0 || value > 60) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ('ticket_autoclose_days', $1::jsonb, now())
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(value)],
  );
  await logAudit(user.email, "ticket.autoclose-config", null, value === 0 ? "disattivata" : `${value} giorni`);
  revalidatePath("/admin/settings");
}

export async function saveLeadFollowupHours(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const raw = String(formData.get("hours") ?? "").trim();
  const hours = Number(raw);
  // 0/vuoto = OFF (default 48 quando assente); altrimenti 1–336 ore (2 settimane).
  const value = !raw || hours === 0 ? 0 : Math.round(hours);
  if (!Number.isFinite(value) || value < 0 || value > 336) return;
  await pool.query(
    `insert into content_settings (key, value, updated_at) values ('lead_followup_hours', $1::jsonb, now())
     on conflict (key) do update set value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(value)],
  );
  await logAudit(user.email, "ambrosio.followup-config", null, value === 0 ? "disattivato" : `${value} ore`);
  revalidatePath("/admin/settings");
}

export async function unbanIpAction(formData: FormData) {
  const user = await requireAdmin();
  const ip = String(formData.get("ip") ?? "").trim();
  if (!ip) return;
  await unbanIp(ip, user.email);
  await logAudit(user.email, "shield.sblocca-ip", ip);
  revalidatePath("/admin/shield");
}

/* ── STRUMENTO SEO (meta, keyword, slug, redirect) ───────────────── */

/**
 * Salva i meta globali del sito (home) e le impostazioni sitewide.
 * Landing e redirect si gestiscono dalle loro azioni dedicate, così ogni
 * card ha un bottone e un esito chiari e l'audit registra il perimetro.
 */
export async function saveSeoGlobalAction(formData: FormData) {
  const user = await requireAdmin();
  try {
    const current = await getSeoConfig();
    const next = sanitizeSeoConfig({
      ...current,
      homeTitle: String(formData.get("homeTitle") ?? ""),
      homeDescription: String(formData.get("homeDescription") ?? ""),
      siteKeywords: String(formData.get("siteKeywords") ?? ""),
      ogSiteName: String(formData.get("ogSiteName") ?? ""),
    });
    await saveSeoConfig(next);
    await logAudit(user.email, "seo.meta-globali", null, `title: ${next.homeTitle.slice(0, 80)}`);
    revalidatePath("/admin/seo");
    revalidatePath("/", "layout");
  } catch (e) {
    console.error("[saveSeoGlobal]", e);
  }
}

/**
 * Salva l'override SEO di una landing (title, description, keyword,
 * keyword secondarie, slug personalizzato, noindex).
 */
export async function saveSeoLandingAction(formData: FormData) {
  const user = await requireAdmin();
  const slug = sanitizeSlug(String(formData.get("slugKey") ?? ""));
  if (!slug) return;
  try {
    const current = await getSeoConfig();
    const slugOverride = sanitizeSlug(String(formData.get("slugOverride") ?? ""));
    // Slug custom uguale all'originale = nessun override necessario.
    const keywordsRaw = String(formData.get("keywords") ?? "");
    const keywords = keywordsRaw
      .split(/[\n,]/)
      .map((k) => k.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 12);
    const nextMeta = {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      keyword: String(formData.get("keyword") ?? "").trim().slice(0, 80),
      keywords,
      slugOverride: slugOverride === slug ? "" : slugOverride,
      noindex: String(formData.get("noindex") ?? "") === "on",
    };
    // Storico meta: archivio lo stato corrente (o «base» se non c'era
    // override) prima di salvare, a meno che i valori siano identici.
    const prevMeta = current.landings[slug];
    const metaUnchanged =
      !!prevMeta &&
      prevMeta.title === nextMeta.title.trim() &&
      prevMeta.description === nextMeta.description.trim() &&
      prevMeta.keyword === nextMeta.keyword &&
      prevMeta.keywords.length === nextMeta.keywords.length &&
      prevMeta.keywords.every((k, i) => k === nextMeta.keywords[i]) &&
      prevMeta.slugOverride === nextMeta.slugOverride &&
      prevMeta.noindex === nextMeta.noindex;
    if (!metaUnchanged) {
      pushMetaVersion(current, slug, {
        title: prevMeta?.title ?? "",
        description: prevMeta?.description ?? "",
        keyword: prevMeta?.keyword ?? "",
        keywords: prevMeta?.keywords ?? [],
        slugOverride: prevMeta?.slugOverride ?? "",
        noindex: prevMeta?.noindex ?? false,
        archivedAt: new Date().toISOString(),
        archivedBy: user.email,
        source: prevMeta ? "override" : "base",
      });
    }
    current.landings[slug] = nextMeta;
    await saveSeoConfig(sanitizeSeoConfig(current));
    await logAudit(user.email, "seo.landing", slug, slugOverride && slugOverride !== slug ? `slug → ${slugOverride}` : undefined);
    revalidatePath("/admin/seo");
    revalidatePath("/", "layout");
  } catch (e) {
    console.error("[saveSeoLanding]", e);
  }
}

/** Ripristina i default (rimuove l'override) di una landing. */
async function removeLandingOverride(current: Awaited<ReturnType<typeof getSeoConfig>>, slug: string) {
  const landings = { ...current.landings };
  delete landings[slug];
  return landings;
}

export async function resetSeoLandingAction(formData: FormData) {
  const user = await requireAdmin();
  const slug = sanitizeSlug(String(formData.get("slugKey") ?? ""));
  if (!slug) return;
  try {
    const current = await getSeoConfig();
    // Storico: anche il reset delle meta archivia l'override rimosso.
    const prevMeta = current.landings[slug];
    if (prevMeta) {
      pushMetaVersion(current, slug, {
        title: prevMeta.title,
        description: prevMeta.description,
        keyword: prevMeta.keyword,
        keywords: prevMeta.keywords,
        slugOverride: prevMeta.slugOverride,
        noindex: prevMeta.noindex,
        archivedAt: new Date().toISOString(),
        archivedBy: user.email,
        source: "override",
      });
    }
    const landings = await removeLandingOverride(current, slug);
    await saveSeoConfig(sanitizeSeoConfig({ ...current, landings }));
    await logAudit(user.email, "seo.landing-reset", slug);
    revalidatePath("/admin/seo");
    revalidatePath("/", "layout");
  } catch (e) {
    console.error("[resetSeoLanding]", e);
  }
}

/**
 * Ripristina una versione archiviata delle META di una landing (title,
 * description, keyword, slug, noindex): archivia lo stato attuale come
 * ogni altro cambio, poi ricopia la versione. Una versione «base» (nessun
 * override) equivale al reset. Live subito su sito pubblico e admin.
 */
export async function restoreSeoMetaVersionAction(formData: FormData) {
  const user = await requireAdmin();
  const slug = sanitizeSlug(String(formData.get("slugKey") ?? ""));
  const ts = String(formData.get("archivedAt") ?? "").trim().slice(0, 40);
  if (!slug || !LANDINGS.some((l) => l.slug === slug) || !ts) return;
  try {
    const current = await getSeoConfig();
    const version = current.metaHistory[slug]?.find((v) => v.archivedAt === ts);
    if (!version) return;
    const prevMeta = current.landings[slug];
    pushMetaVersion(current, slug, {
      title: prevMeta?.title ?? "",
      description: prevMeta?.description ?? "",
      keyword: prevMeta?.keyword ?? "",
      keywords: prevMeta?.keywords ?? [],
      slugOverride: prevMeta?.slugOverride ?? "",
      noindex: prevMeta?.noindex ?? false,
      archivedAt: new Date().toISOString(),
      archivedBy: user.email,
      source: prevMeta ? "override" : "base",
    });
    const isBase = !version.title && !version.description && !version.keyword && version.keywords.length === 0 && !version.slugOverride && !version.noindex;
    if (isBase) {
      const landings = { ...current.landings };
      delete landings[slug];
      current.landings = landings;
    } else {
      current.landings[slug] = {
        title: version.title,
        description: version.description,
        keyword: version.keyword,
        keywords: version.keywords,
        slugOverride: version.slugOverride,
        noindex: version.noindex,
      };
    }
    await saveSeoConfig(sanitizeSeoConfig(current));
    await logAudit(
      user.email,
      "seo.meta-ripristino-versione",
      slug,
      `meta tornate alla versione del ${new Date(ts).toLocaleString("it-IT")} (da ${version.source})`,
    );
    revalidatePath("/admin/seo");
    revalidatePath("/", "layout");
  } catch (e) {
    console.error("[restoreSeoMetaVersion]", e);
  }
}

/**
 * Aggiunge un redirect 301 interno (da → a, entrambi path interni).
 * L'open redirect è bloccato: la destinazione deve iniziare con «/».
 */
export async function addSeoRedirectAction(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;
  const fromRaw = sanitizeSlug(String(formData.get("from") ?? ""));
  const to = String(formData.get("to") ?? "").trim().slice(0, 300);
  if (!fromRaw) return;
  if (!isValidRedirectPath(to)) {
    redirect(`/admin/seo?seo_error=${encodeURIComponent("La destinazione deve essere un percorso interno che inizia con «/» (es. /seo-salento).")}`);
  }
  try {
    const current = await getSeoConfig();
    const from = `/${fromRaw}`;
    // Stessa sorgente già presente → aggiorna la destinazione (idempotente).
    const redirects = [
      ...current.redirects.filter((r) => r.from !== from && r.from !== `/${fromRaw}/`),
      { from, to, createdAt: new Date().toISOString() },
    ].slice(0, 100);
    await saveSeoConfig(sanitizeSeoConfig({ ...current, redirects }));
    await logAudit(user.email, "seo.redirect", from, `→ ${to}`);
    revalidatePath("/admin/seo");
  } catch (e) {
    console.error("[addSeoRedirect]", e);
  }
}

/** Elimina un redirect (la regola smette di valere al prossimo deploy/cache). */
export async function deleteSeoRedirectAction(formData: FormData) {
  const user = await requireAdmin();
  const from = String(formData.get("from") ?? "").trim().slice(0, 200);
  if (!from) return;
  try {
    const current = await getSeoConfig();
    const redirects = current.redirects.filter((r) => r.from !== from);
    await saveSeoConfig(sanitizeSeoConfig({ ...current, redirects }));
    await logAudit(user.email, "seo.redirect-eliminato", from);
    revalidatePath("/admin/seo");
  } catch (e) {
    console.error("[deleteSeoRedirect]", e);
  }
}

/**
 * Genera lo slug a partire dal titolo H1 della landing (server-side,
 * così la logica di transliterazione resta in un punto solo).
 */
export async function generateSeoSlugAction(formData: FormData) {
  await requireAdmin();
  const slugKey = sanitizeSlug(String(formData.get("slugKey") ?? ""));
  const h1 = String(formData.get("h1") ?? "").trim().slice(0, 120);
  if (!slugKey || !h1) redirect(`/admin/seo?seo_error=${encodeURIComponent("Titolo mancante: impossibile generare lo slug.")}`);
  const suggested = sanitizeSlug(h1).slice(0, 60);
  redirect(`/admin/seo?slug_for=${encodeURIComponent(slugKey)}&suggested=${encodeURIComponent(suggested)}`);
}

/**
 * Audit della SEO: lista le landing con title/description fuori range
 * (title > 60 caratteri, description fuori da 120–160) — la spunta che
 * l'agenzia passa in rassegna prima di ogni rilascio.
 */
export async function seoAuditAction() {
  const user = await requireAdmin();
  const config = await getSeoConfig();
  const problems: string[] = [];
  for (const l of LANDINGS) {
    const e = effectiveLandingSeo(l, config);
    if (e.noindex) continue;
    if (e.title.length > 60) problems.push(`${e.slug}: title ${e.title.length} caratteri (> 60)`);
    if (e.description.length > 160) problems.push(`${e.slug}: description ${e.description.length} caratteri (> 160)`);
    if (e.description.length < 70) problems.push(`${e.slug}: description ${e.description.length} caratteri (< 70, troppo corta)`);
  }
  const msg = problems.length === 0
    ? `OK — tutte le ${LANDINGS.length} landing passano il controllo meta.`
    : problems.join(" · ");
  await logAudit(user.email, "seo.audit", null, msg.slice(0, 400));
  redirect(`/admin/seo?seo_audit=${encodeURIComponent(msg)}`);
}

/* ── CONTENUTI LANDING (intro/servizi/FAQ/proof/H1 in DB) ────── */

/**
 * Salva i contenuti editabili di una landing (override sui testi di
 * site.ts). Validazione server-side con limiti già visti dal client;
 * il salvataggio è all-or-nothing e la pagina pubblica è live subito.
 */
export async function saveSeoLandingContentAction(formData: FormData) {
  const user = await requireAdmin();
  const slugKey = String(formData.get("slugKey") ?? "").trim();
  if (!LANDINGS.some((l) => l.slug === slugKey)) {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Pagina non trovata."));
  }

  const intro = formData
    .getAll("intro")
    .map((x) => String(x).trim().slice(0, 2000))
    .filter(Boolean)
    .slice(0, 6);
  const services: { title: string; text: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const title = String(formData.get(`service_title_${i}`) ?? "").trim().slice(0, 120);
    const text = String(formData.get(`service_text_${i}`) ?? "").trim().slice(0, 800);
    if (title && text) services.push({ title, text });
  }
  const faq: { q: string; a: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const q = String(formData.get(`faq_q_${i}`) ?? "").trim().slice(0, 300);
    const a = String(formData.get(`faq_a_${i}`) ?? "").trim().slice(0, 1500);
    if (q && a) faq.push({ q, a });
  }
  const proof = String(formData.get("proof") ?? "").trim().slice(0, 500);
  const h1 = String(formData.get("h1") ?? "").trim().slice(0, 160);

  const config = await getSeoConfig();
  // Storico: prima di sovrascrivere, archivio lo stato CORRENTE (override
  // salvato, oppure "base" se la pagina usava i testi di codice). Se i
  // contenuti sono identici, nessuna versione duplicata (doppio click).  
  const prev = config.contents[slugKey];
  const nextContent = { intro, services, faq, proof, h1 };
  const unchanged = prev ? JSON.stringify(prev) === JSON.stringify(nextContent) : false;
  if (!unchanged) {
    pushContentVersion(config, slugKey, {
      intro: prev?.intro ?? [],
      services: prev?.services ?? [],
      faq: prev?.faq ?? [],
      proof: prev?.proof ?? "",
      h1: prev?.h1 ?? "",
      archivedAt: new Date().toISOString(),
      archivedBy: user.email,
      source: prev ? "override" : "base",
    });
  }
  config.contents[slugKey] = nextContent;
  try {
    await saveSeoConfig(config);
  } catch {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Database non configurato: i contenuti non sono stati salvati."));
  }
  revalidatePath("/", "layout");
  await logAudit(user.email, "seo.contenuti", null, `contenuti aggiornati per /${slugKey} (intro ${intro.length}, servizi ${services.length}, FAQ ${faq.length})`);
  redirect(`/admin/seo?seo_audit=${encodeURIComponent(`OK — contenuti di /${slugKey} salvati e live.`)}`);
}

/**
 * Ripristina i testi di codice (site.ts) per una landing: rimuove l'override
 * contenuti. Le meta/keyword/slug restano quelle salvate.
 */
export async function resetSeoLandingContentAction(formData: FormData) {
  const user = await requireAdmin();
  const slugKey = String(formData.get("slugKey") ?? "").trim();
  if (!LANDINGS.some((l) => l.slug === slugKey)) {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Pagina non trovata."));
  }
  const config = await getSeoConfig();
  // Storico: anche il reset è una modifica — la versione che sta per essere
  // rimossa finisce archiviata, così resta recuperabile.
  const prev = config.contents[slugKey];
  if (prev) {
    pushContentVersion(config, slugKey, {
      intro: prev.intro,
      services: prev.services,
      faq: prev.faq,
      proof: prev.proof, 
      h1: prev.h1,
      archivedAt: new Date().toISOString(),
      archivedBy: user.email,
      source: "override",
    });
  }
  delete config.contents[slugKey];
  try {
    await saveSeoConfig(config);
  } catch {
  }
  revalidatePath("/", "layout");
  await logAudit(user.email, "seo.contenuti-ripristino", null, `contenuti di /${slugKey} tornati ai testi di codice`);
  redirect(`/admin/seo?seo_audit=${encodeURIComponent(`OK — /${slugKey} usa di nuovo i testi di codice.`)}`);
}

/**
 * Ripristina una versione archiviata dei contenuti di una landing: copia
 * la versione nei contenuti correnti e — come ogni altro cambio — archivia
 * lo stato che sta sostituendo. La pagina pubblica è live subito.
 */
export async function restoreSeoContentVersionAction(formData: FormData) {
  const user = await requireAdmin();
  const slugKey = String(formData.get("slugKey") ?? "").trim();
  const ts = String(formData.get("archivedAt") ?? "").trim().slice(0, 40);
  if (!LANDINGS.some((l) => l.slug === slugKey) || !ts) {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Versione non trovata."));
  }
  const config = await getSeoConfig();
  const version = config.contentHistory[slugKey]?.find((v) => v.archivedAt === ts);
  if (!version) {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Versione non trovata o non più disponibile nello storico."));
  }
  const prev = config.contents[slugKey];
  pushContentVersion(config, slugKey, {
    intro: prev?.intro ?? [],
    services: prev?.services ?? [] ,
    faq: prev?.faq ?? [],
    proof: prev?.proof ?? "",
    h1: prev?.h1 ?? "",
    archivedAt: new Date().toISOString(),
    archivedBy: user.email,
    source: prev ? "override" : "base",
  });
  config.contents[slugKey] = {
    intro: version.intro,
    services: version.services,
    faq: version.faq,
    proof: version.proof,
    h1: version.h1,
  };
  // Avviso GSC: snapshot «prima» sincrono (best effort — un errore Search
  // Console non deve bloccare il ripristino). La misurazione «dopo» avviene
  // on-demand via measureSeoAlerts quando passano i giorni minimi.
  const positionBefore = await getGscPagePosition(`/${slugKey}`, 28, 3).catch(() => null);
  if (positionBefore && positionBefore.impressions >= PAGE_ALERT_THRESHOLDS.minImpressions) {
    config.pageAlerts[slugKey] = {
      positionBefore: positionBefore.position,
      positionAfter: 0,
      restoredAt: new Date().toISOString(),
      measuredAt: "",
      daysAfter: 0,
      restoredSource: version.source,
      restoredVersionTs: ts,
    };
  } else {
    delete config.pageAlerts[slugKey];
  }
  try {
    await saveSeoConfig(config);
  } catch {
    redirect("/admin/seo?seo_error=" + encodeURIComponent("Database non configurato: versione non ripristinata."));
  }
  revalidatePath("/", "layout");
  await logAudit(user.email, "seo.contenuti-ripristino-versione", null, `contenuti di /${slugKey} tornati alla versione del ${new Date(ts).toLocaleString("it-IT")} (da ${version.source})${positionBefore ? ` · posizione pre-ripristino: ${positionBefore.position.toFixed(1)}` : ""}`);
  redirect(`/admin/seo?seo_audit=${encodeURIComponent(`OK — contenuti di /${slugKey} ripristinati alla versione del ${new Date(ts).toLocaleString("it-IT")}.`)}`);
}

/** True se il calo supera le soglie significative dell'avviso. */
function isSignificantDrop(before: number, after: number): boolean {
  const drop = after - before;
  const dropPct = before > 0 ? (drop / before) * 100 : 0;
  return drop >= PAGE_ALERT_THRESHOLDS.minDrop && dropPct >= PAGE_ALERT_THRESHOLDS.minDropPct;
}

/**
 * Misura gli avvisi GSC in attesa (chiamata dal render della pagina SEO,
 * prima di leggere la config): per ogni ripristino maturo per giorni,
 * confronta la posizione attuale con quella pre-ripristino. Calo
 * significativo → avviso; altrimenti l'attesa si chiude in silenzio.
 * Best effort: un errore Search Console non ferma nulla; se cambia qualcosa
 * salva la config e ritorna true (il chiamante ricarica i dati).
 */
export async function measureSeoAlerts(): Promise<boolean> {
  const config = await getSeoConfig();
  const pending = Object.entries(config.pageAlerts).filter(
    ([, a]) => a.restoredAt && !a.measuredAt,
  );
  if (pending.length === 0) return false;
  let changed = false;
  for (const [slug, a] of pending) {
    const daysAfter = Math.floor((Date.now() - new Date(a.restoredAt).getTime()) / 86400000);
    if (daysAfter < PAGE_ALERT_THRESHOLDS.minDaysAfter) continue;
    try {
      const after = await getGscPagePosition(`/${slug}`, Math.max(28, daysAfter), 3);
      if (!after || after.impressions < PAGE_ALERT_THRESHOLDS.minImpressions) continue;
      if (isSignificantDrop(a.positionBefore, after.position)) {
        recordPageAlert(config, slug, {
          positionBefore: a.positionBefore,
          positionAfter: after.position,
          restoredAt: a.restoredAt,
          measuredAt: new Date().toISOString(),
          daysAfter,
          restoredSource: a.restoredSource,
          restoredVersionTs: a.restoredVersionTs,
        });
        await logAudit("system", "seo.avviso-gsc", slug, `calo posizioni dopo ripristino: ${a.positionBefore.toFixed(1)} → ${after.position.toFixed(1)} dopo ${daysAfter} giorni`);
      } else {
        delete config.pageAlerts[slug]; // ripristino ok: nessun avviso
      }
      changed = true;
    } catch {
      // GSC non raggiungibile: resta in attesa, si ritenta al prossimo accesso
    }
  }
  if (!changed) return false;
  try {
    await saveSeoConfig(sanitizeSeoConfig(config));
  } catch {
    return false;
  }
  return true;
}

/** Verifica «risolto» sull'avviso di una landing: nuova misura confrontata con il pre-ripristino. */
export async function resolveSeoPageAlertAction(formData: FormData) {
  const user = await requireAdmin();
  const slug = String(formData.get("slugKey") ?? "").trim();
  if (!LANDINGS.some((l) => l.slug === slug)) return;
  const config = await getSeoConfig();
  const alert = config.pageAlerts[slug];
  if (!alert || !alert.measuredAt) return;
  const stillFalling = await getGscPagePosition(`/${slug}`, 28, 3)
    .then((now) => now && now.impressions >= PAGE_ALERT_THRESHOLDS.minImpressions && isSignificantDrop(alert.positionBefore, now.position))
    .catch(() => null);
  if (stillFalling === null) {
    redirect(`/admin/seo?seo_error=${encodeURIComponent("Search Console non raggiungibile: riprova tra poco.")}`);
  }
  if (stillFalling) {
    redirect(`/admin/seo?seo_error=${encodeURIComponent(`/${slug} è ancora in calo: l'avviso resta attivo finché le posizioni non risalgono.`)}`);
  }
  delete config.pageAlerts[slug];
  try {
    await saveSeoConfig(sanitizeSeoConfig(config));
  } catch {
    return;
  }
  await logAudit(user.email, "seo.avviso-gsc-risolto", slug);
  revalidatePath("/admin/seo");
  redirect(`/admin/seo?seo_audit=${encodeURIComponent(`OK — avviso di /${slug} risolto.`)}`);
}

/** Segna l'avviso come falso allarme (nessuna nuova misura, solo rimozione). */
export async function dismissSeoPageAlertAction(formData: FormData) {
  const user = await requireAdmin();
  const slug = String(formData.get("slugKey") ?? "").trim();
  if (!LANDINGS.some((l) => l.slug === slug)) return;
  const config = await getSeoConfig();
  delete config.pageAlerts[slug];
  try {
    await saveSeoConfig(sanitizeSeoConfig(config));
  } catch {
    return;
  }
  await logAudit(user.email, "seo.avviso-gsc-scartato", slug);
  revalidatePath("/admin/seo");
}

/**
 * Diff tra un file di backup (testo JSON) e la config live: cosa verrebbe
 * AGGIUNTO/RIMOSSO/MODIFICATO dall'import, prima di confermarlo. Il backup
 * è sanificato come lo sarebbe all'import, quindi il diff mostra esattamente
 * cosa succederebbe. Errore gestito → messaggio azionabile in UI.
 */
export async function seoBackupDiffAction(
  backupText: string,
): Promise<
  | { ok: true; rows: Awaited<ReturnType<typeof diffSeoConfig>>; exportedAt: string | null; exportedBy: string | null }
  | { ok: false; error: string }
> {
  await requireAdmin();
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupText.slice(0, 2_000_000));
  } catch {
    return { ok: false, error: "File non leggibile: deve essere JSON valido." };
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  if (body.kind !== "seo-config-backup") {
    return { ok: false, error: "Questo non è un backup della config SEO (manca il campo kind)." };
  }
  const backup = sanitizeSeoConfig(body.config);
  const live = await getSeoConfig();
  const rows = diffSeoConfig(backup, live);
  const header = (body as { exportedAt?: unknown; exportedBy?: unknown }).exportedAt;
  const headerBy = (body as { exportedBy?: unknown }).exportedBy;
  return {
    ok: true,
    rows,
    exportedAt: typeof header === "string" ? header.slice(0, 40) : null,
    exportedBy: typeof headerBy === "string" ? headerBy.slice(0, 200) : null,
  };
}

/* ── MODALITÀ MANUTENZIONE (Tools → Manutenzione) ───────────────── */

/**
 * Salva la config della modalità manutenzione (content_settings, chiave
 * dedicata: zero migration). Attivazione e spegnimento finiscono in audit:
 * chiudere un sito pubblico è un'azione che il registro deve ricordare.
 * La cache del cancello è di 15s: la pagina pubblica segue entro poco.
 */
export async function saveMaintenanceSettings(formData: FormData) {
  const user = await requireAdmin();
  const pool = db();
  if (!pool) return;

  const active = String(formData.get("active") ?? "false").trim() === "true";
  const message = String(formData.get("message") ?? "").trim().slice(0, 280);
  const backOnline = String(formData.get("backOnline") ?? "").trim().slice(0, 60);
  const next = { active, message, backOnline };

  await pool.query(
    `insert into content_settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = $2::jsonb, updated_at = now()`,
    [MAINTENANCE_KEY, JSON.stringify(next)],
  );
  await logAudit(
    user.email,
    "maintenance.toggle",
    MAINTENANCE_KEY,
    active ? "attivata" : "spenta",
  );
  revalidatePath("/admin/tools/manutenzione");
}

