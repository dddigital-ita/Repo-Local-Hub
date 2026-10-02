import nodemailer, { type Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { db } from "./db";
import { decryptKey, encryptKey } from "./ai";
import { queueGCalSyncForCallback } from "./google-calendar";
import { EMAIL_TOOLS_KEY, detectEmailAppointment, EMAIL_APPT_HOURS, type EmailToolsConfigBase } from "./email-tools-shared";

/**
 * Strumento EMAIL (admin tools): collega un server di posta reale per
 * INVIARE (SMTP) e RICEVERE (IMAP) posta elettronica dell'agenzia.
 *
 * Stesso pattern del Google Growth Kit: config su content_settings,
 * password cifrata AES-256-GCM (mai restituita al client: solo hint
 * mascherato), test su richiesta con esito registrato.
 *
 * Preset provider (in email-tools-shared.ts): compilano host e porte
 * giuste per evitare errori comuni (587 STARTTLS invio, 993 SSL ricezione).
 */

export type EmailToolsConfig = EmailToolsConfigBase;

interface StoredEmailTools {
  fromEmail?: unknown;
  fromName?: unknown;
  smtpHost?: unknown;
  smtpPort?: unknown;
  imapHost?: unknown;
  imapPort?: unknown;
  user?: unknown;
  passwordEnc?: unknown;
}

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function hintFor(value: string): string | null {
  if (!value) return null;
  return `${value.slice(0, 2)}${"•".repeat(Math.max(4, Math.min(10, value.length - 4)))}${value.slice(-2)}`;
}

export async function getEmailToolsConfig(): Promise<EmailToolsConfig> {
  const fallback: EmailToolsConfig = {
    fromEmail: process.env.EMAIL_FROM ?? "",
    fromName: "Web Agency Crema",
    smtpHost: "",
    smtpPort: 587,
    imapHost: "",
    imapPort: 993,
    user: process.env.NOTIFY_EMAIL ?? "",
    hasPassword: false,
    passwordHint: null,
  };
  const pool = db();
  if (!pool) return fallback;
  try {
    const { rows } = await pool.query<{ value: StoredEmailTools }>(
      "select value from content_settings where key = $1",
      [EMAIL_TOOLS_KEY],
    );
    const stored = rows[0]?.value;
    if (!stored || typeof stored !== "object") return fallback;
    const encrypted = clean(stored.passwordEnc, 2000);
    const password = encrypted ? decryptKey(encrypted) : null;
    const port = (v: unknown, d: number) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0 && n < 65536 ? n : d;
    };
    return {
      fromEmail: clean(stored.fromEmail, 200) || fallback.fromEmail,
      fromName: clean(stored.fromName, 100) || fallback.fromName,
      smtpHost: clean(stored.smtpHost, 200),
      smtpPort: port(stored.smtpPort, 587),
      imapHost: clean(stored.imapHost, 200),
      imapPort: port(stored.imapPort, 993),
      user: clean(stored.user, 200) || fallback.user,
      hasPassword: Boolean(password),
      passwordHint: hintFor(password ?? ""),
    };
  } catch {
    return fallback;
  }
}

/** Sanitizza e salva la config; password opzionale (vuoto = conserva). */
export async function saveEmailToolsConfig(
  input: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const pool = db();
  if (!pool) return { ok: false, error: "Database non configurato." };
  const fromEmail = clean(input.fromEmail, 200);
  if (fromEmail && !EMAIL_RE.test(fromEmail)) return { ok: false, error: "Indirizzo mittente non valido." };
  const user = clean(input.user, 200);
  const password = typeof input.password === "string" ? input.password : "";
  if ((user || password) && !clean(input.smtpHost, 200))
    return { ok: false, error: "Serve l'host SMTP per salvare le credenziali." };

  const { rows } = await pool.query<{ value: StoredEmailTools }>(
    "select value from content_settings where key = $1",
    [EMAIL_TOOLS_KEY],
  );
  const stored = (rows[0]?.value ?? {}) as StoredEmailTools;
  const next: StoredEmailTools = {
    ...stored,
    fromEmail,
    fromName: clean(input.fromName, 100) || "Web Agency Crema",
    smtpHost: clean(input.smtpHost, 200),
    smtpPort: Number(input.smtpPort) || 587,
    imapHost: clean(input.imapHost, 200),
    imapPort: Number(input.imapPort) || 993,
    user,
  };
  if (password) next.passwordEnc = encryptKey(password);
  await pool.query(
    "insert into content_settings (key, value) values ($1, $2) on conflict (key) do update set value = $2",
    [EMAIL_TOOLS_KEY, JSON.stringify(next)],
  );
  return { ok: true };
}

async function loadPassword(): Promise<string | null> {
  const pool = db();
  if (!pool) return null;
  const { rows } = await pool.query<{ value: StoredEmailTools }>(
    "select value from content_settings where key = $1",
    [EMAIL_TOOLS_KEY],
  );
  const encrypted = clean(rows[0]?.value?.passwordEnc, 2000);
  return encrypted ? decryptKey(encrypted) : null;
}

async function getTransport(config: EmailToolsConfig, password: string): Promise<Transporter> {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

export interface EmailTestResult {
  ok: boolean;
  smtp: { ok: boolean; message: string };
  imap: { ok: boolean; message: string };
}

/** Test live di SMTP (verify) e IMAP (connect + logout). */
export async function testEmailConnection(
  config: EmailToolsConfig,
  recipient?: string,
): Promise<EmailTestResult> {
  const result: EmailTestResult = {
    ok: false,
    smtp: { ok: false, message: "Configurazione incompleta." },
    imap: { ok: false, message: "Configurazione incompleta." },
  };
  const password = await loadPassword();
  if (!config.smtpHost || !config.user || !password) {
    result.smtp.message = "Completa host SMTP, utente e password.";
    return result;
  }

  // SMTP: verify() apre e chiude la connessione senza inviare nulla…
  try {
    const transport = await getTransport(config, password);
    await transport.verify();
    result.smtp = { ok: true, message: `Connesso a ${config.smtpHost}:${config.smtpPort}` };
  } catch (e) {
    result.smtp = { ok: false, message: e instanceof Error ? e.message : "Errore SMTP" };
  }

  // …poi un invio REALE al destinatario scelto (o a se stessi): il test
  // che conta è quello che finisce nella casella.
  if (result.smtp.ok && recipient) {
    try {
      const transport = await getTransport(config, password);
      await transport.sendMail({
        from: `"${config.fromName}" <${config.fromEmail || config.user}>`,
        to: recipient,
        subject: "Test di invio · Strumento email",
        text: `Email di prova inviata dal pannello Strumenti il ${new Date().toLocaleString("it-IT")}. Se la leggi, l'invio funziona.`,
      });
      result.smtp.message += ` · inviata a ${recipient}`;
    } catch (e) {
      result.smtp = { ok: false, message: e instanceof Error ? e.message : "Errore invio" };
    }
  }

  // IMAP: connessione reale + logout pulito.
  if (config.imapHost && config.user && password) {
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      auth: { user: config.user, pass: password },
      tls: { rejectUnauthorized: false },
      logger: false,
    });
    try {
      await client.connect();
      await client.logout();
      result.imap = { ok: true, message: `Connesso a ${config.imapHost}:${config.imapPort}` };
    } catch (e) {
      result.imap = { ok: false, message: e instanceof Error ? e.message : "Errore IMAP" };
      try { client.close(); } catch { /* già chiuso */ }
    }
  } else {
    result.imap = { ok: false, message: "Host IMAP non configurato (ricezione disattivata)." };
  }

  result.ok = result.smtp.ok;
  return result;
}

/** Invia una email con la config salvata (usato dal pannello e da futuri flussi).
 *  Con `html` invia multipart alternativo: i client di posta mostrano
 *  l'HTML e usano il testo come fallback (client testuali, antispam). */
export async function sendEmailViaTools(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const config = await getEmailToolsConfig();
  const password = await loadPassword();
  if (!config.smtpHost || !config.user || !password)
    return { ok: false, error: "Email non configurata: completa server e credenziali." };
  try {
    const transport = await getTransport(config, password);
    const info = await transport.sendMail({
      from: `"${config.fromName}" <${config.fromEmail || config.user}>`,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Errore invio" };
  }
}

/* ══ EMAIL FORMATTATA (WpEditor) ════════════════════════════════════
 * L'editor produce HTML (bold, elenchi, link…): quello che arriva al
 * cliente deve essere SOLO tag sicuri. Whitelist stretta, niente
 * dipendenze: un sanitizer dedicato di ~30 righe è più auditable di
 * una libreria per quattro tag.
 */

const EMAIL_ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "s", "u",
  "ul", "ol", "li", "blockquote", "code", "pre", "a",
]);
const EMAIL_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
};

/** HTML → testo piano (fallback multipart e banale da leggere). */
export function htmlToEmailText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<blockquote[^>]*>/gi, "“")
    .replace(/<\/blockquote>/gi, "”\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Sanitizer whitelist-only per l'email formattata: spoglia ogni tag
 * fuori lista (mantenendo il contenuto), ogni attributo fuori mappa e
 * ogni href non http(s) o mailto (javascript:, data:, vbscript: = via).
 */
export function sanitizeEmailHtml(input: string, maxLen = 20_000): string {
  let html = input.slice(0, maxLen);
  // Rimuove blocchi interi pericolosi CON contenuto (script/style/iframe…).
  html = html.replace(/<\s*(script|style|iframe|object|embed|svg|math|template|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed|svg|math|template|form)[^>]*>/gi, "");
  // Commenti e doctype non appartengono a un'email.
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!(?:doctype|\[)[^>]*>/gi, "");
  // Tokenizza i tag rimanenti: whilitelist su nome e attributi.
  html = html.replace(/<\s*(\/?)([a-zA-Z0-9]+)((?:\s+[^<>]*?)?)\s*(\/?)>/g, (_m, close, rawName, attrs, selfClose) => {
    const tag = rawName.toLowerCase();
    if (!EMAIL_ALLOWED_TAGS.has(tag)) return ""; // tag fuori lista: spoglia, tiene il testo
    if (close) return `</${tag}>`;
    let cleanAttrs = "";
    const allowed = EMAIL_ALLOWED_ATTRS[tag];
    if (allowed && attrs) {
      const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(attrs))) {
        const name = m[1].toLowerCase();
        if (!allowed.has(name)) continue;
        const value = (m[3] ?? m[4] ?? m[5] ?? "").trim();
        if (name === "href") {
          // Solo http(s) e mailto: niente javascript:/data:/vbscript:.
          const safe = /^(https?:\/\/|mailto:)/i.test(value) && !/[\u0000-\u001f"'<>]/.test(value);
          if (!safe) continue;
          cleanAttrs += ` href="${value.replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, "&amp;")}"`;
        }
      }
    }
    return `<${tag}${cleanAttrs}${selfClose ? " /" : ""}>`;
  });
  return html.trim();
}

/** Wrappa l'HTML del WpEditor in un guscio email minimale e leggibile. */
export function buildEmailHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="it"><body style="margin:0;padding:0;background:#f1f5f9;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">
<div style="background:#ffffff;border-radius:12px;padding:24px 28px;">${bodyHtml}</div>
<div style="padding:16px 4px;font-size:12px;color:#64748b;">Hai ricevuto questa email dal ticketing di Web Agency Crema — rispondi a questa email per continuare la conversazione.</div>
</div>
</body></html>`;
}

/* ══ CANALE EMAIL DEI TICKET ═══════════════════════════════════════════
 * Le email in ricezione diventano ticket (o risposte dentro un ticket
 * esistente se sono «Re: [#N]»), come in Zendesk/Freshdesk: il caso è il
 * ticket, l'email è solo il canale con cui il cliente lo alimenta.
 */

/** Estrae il testo dal sorgente MIME: prima text/plain, poi text/html spogliato. */
function extractText(source: Buffer): string {
  const raw = source.toString("utf8");
  const plainMatch = raw.match(/content-type: text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
  if (plainMatch?.[1]) return decodeQuotedPrintable(plainMatch[1]);
  const htmlMatch = raw.match(/content-type: text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
  if (htmlMatch?.[1]) {
    return decodeQuotedPrintable(htmlMatch[1])
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeQuotedPrintable(s: string): string {
  if (!s.includes("=")) return s;
  const withoutSoftBreaks = s.replace(/=\r?\n/g, "");
  try {
    const bytes: number[] = [];
    for (let i = 0; i < withoutSoftBreaks.length; i++) {
      const ch = withoutSoftBreaks[i];
      if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
        bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(ch.charCodeAt(0) & 0xff);
    }
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return withoutSoftBreaks;
  }
}

export interface IngestResult {
  fetched: number;   // email viste in casella
  queued: number;    // nuove accodate (dedup Message-ID)
  created: number;   // nuovi ticket aperti
  replied: number;   // risposte dentro ticket esistenti («Re: [#N]»)
  errors: string[];
}

/**
 * Polling della casella: scarica i messaggi NON ancora visti (dedup sul
 * Message-ID in email_ingest), li accoda e li trasforma:
 *  - oggetto «Re: [#N]» / «[#N]» → risposta dentro il ticket #N
 *  - altro                      → NUOVO ticket, canale 'email'
 */
export async function ingestEmails(limit = 15): Promise<IngestResult> {
  const empty: IngestResult = { fetched: 0, queued: 0, created: 0, replied: 0, errors: [] };
  const config = await getEmailToolsConfig();
  const password = await loadPassword();
  if (!config.imapHost || !config.user || !password)
    return { ...empty, errors: ["Ricezione non configurata."] };
  const pool = db();
  if (!pool) return { ...empty, errors: ["Database non configurato."] };

  const result: IngestResult = { ...empty };
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    auth: { user: config.user, pass: password },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    result.fetched = box.exists;
    if (!box.exists) {
      await client.logout();
      return result;
    }
    const seqFrom = Math.max(1, box.exists - limit + 1);
    const staged: Array<{
      messageId: string; from: string; fromName: string | null; subject: string;
      text: string; receivedAt: Date | null; ticketId: string | null; replyToTicketNumber: number | null;
    }> = [];
    for await (const msg of client.fetch({ seq: `${seqFrom}:*` }, { envelope: true, source: true })) {
      const env = msg.envelope;
      const messageId = env?.messageId?.trim();
      if (!messageId) continue; // senza Message-ID non c'è dedup: si salta
      const from = env?.from?.[0];
      const address = from?.address ?? "";
      const subject = env?.subject ?? "(senza oggetto)";
      // Dedup: già accodata in un ciclo precedente?
      const known = await pool.query("select 1 from email_ingest where message_id = $1", [messageId]);
      if (known.rows.length) continue;
      // Thread esistente? «Re: [#N] …» punta al ticket #N.
      const ref = subject.match(/\[#(\d+)\]/);
      let ticketId: string | null = null;
      let replyToTicketNumber: number | null = null;
      if (ref) {
        const tk = await pool.query<{ id: string }>(
          "select id from conversations where number = $1 and channel = 'email'",
          [Number(ref[1])],
        );
        if (tk.rows[0]) {
          ticketId = tk.rows[0].id;
          replyToTicketNumber = Number(ref[1]);
        }
      }
      staged.push({
        messageId,
        from: address,
        fromName: from?.name?.trim() || null,
        subject,
        text: extractText(msg.source ?? Buffer.alloc(0)).slice(0, 20_000),
        receivedAt: env?.date ? new Date(env.date) : null,
        ticketId,
        replyToTicketNumber,
      });
      result.queued++;
    }
    await client.logout();

    // Fuori dalla connessione IMAP: accoda e trasforma.
    for (const s of staged) {
      try {
        await pool.query(
          `insert into email_ingest (message_id, from_address, from_name, subject, body_text, received_at)
           values ($1,$2,$3,$4,$5,$6) on conflict (message_id) do nothing`,
          [s.messageId, s.from, s.fromName, s.subject, s.text, s.receivedAt],
        );
        if (s.replyToTicketNumber && s.ticketId) {
          // Risposta del cliente dentro un ticket esistente.
          await pool.query(
            "insert into messages (conversation_id, sender, body, email_message_id) values ($1, 'customer', $2, $3)",
            [s.ticketId, s.text, s.messageId],
          );
          await pool.query(
            `update conversations set status = 'open', sla_next_reply_due = now() + interval '4 hours',
                    awaiting_notified_at = null, archived_at = null, updated_at = now()
             where id = $1`,
            [s.ticketId],
          );
          // APPUNTAMENTO VIA EMAIL (se attivo): una conferma con orario del
          // cliente diventa una callback → stesso hook Google Calendar degli
          // altri canali (widget, Ambrosio, team). Non bloccante; dedup:
          // con già una callback pendente sul ticket NON se ne crea un'altra.
          const appt = detectEmailAppointment(s.text);
          if (appt.confirmed) {
            const dup = await pool.query("select 1 from callbacks where conversation_id = $1 and status = 'pending' limit 1", [s.ticketId]);
            if (!dup.rows.length) {
              try {
                const when = new Date(Date.now() + EMAIL_APPT_HOURS * 60 * 60_000);
                const cb = await pool.query<{ id: string }>(
                  `insert into callbacks (conversation_id, scheduled_at, slot_label, notes)
                   values ($1, $2, $3, 'confermata via email') returning id`,
                  [s.ticketId, when, appt.slotLabel],
                );
                await pool.query(
                  "update conversations set status = 'callback_scheduled', callback_slot = $2 where id = $1",
                  [s.ticketId, appt.slotLabel],
                );
                await queueGCalSyncForCallback(pool, cb.rows[0].id, "create");
              } catch (e) {
                result.errors.push(`appuntamento email: ${e instanceof Error ? e.message : "errore"}`);
              }
            }
          }
          await pool.query("update email_ingest set processed_at = now(), ticket_id = $2 where message_id = $1", [s.messageId, s.ticketId]);
          result.replied++;
        } else {
          // Nuovo ticket: il caso (case) nasce dall'email.
          const ins = await pool.query<{ id: string; number: number }>(
            `insert into conversations (channel, status, initial_query, contact_email)
             values ('email', 'open', $1, $2) returning id, number`,
            [s.subject, s.from],
          );
          const tk = ins.rows[0];
          await pool.query(
            "insert into messages (conversation_id, sender, body, email_message_id) values ($1, 'customer', $2, $3)",
            [tk.id, s.text, s.messageId],
          );
          await pool.query("update email_ingest set processed_at = now(), ticket_id = $2 where message_id = $1", [s.messageId, tk.id]);
          result.created++;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "errore ignoto";
        result.errors.push(message);
        await pool.query("update email_ingest set error = $2 where message_id = $1", [s.messageId, message]).catch(() => {});
      }
    }
    return result;
  } catch (e) {
    try { client.close(); } catch { /* già chiuso */ }
    return { ...result, errors: [...result.errors, e instanceof Error ? e.message : "Errore IMAP"] };
  }
}



export interface InboxMessage {
  from: string;
  subject: string;
  date: string | null;
  snippet: string;
  mailbox: string;
}

/** Ricezione: ultimi messaggi INBOX via IMAP (solo lettura, niente flag). */
export async function fetchInbox(limit = 10): Promise<{ ok: boolean; messages?: InboxMessage[]; error?: string }> {
  const config = await getEmailToolsConfig();
  const password = await loadPassword();
  if (!config.imapHost || !config.user || !password)
    return { ok: false, error: "Ricezione non configurata: completa host IMAP e credenziali." };
  const messages: InboxMessage[] = [];
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    auth: { user: config.user, pass: password },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    const total = box.exists;
    if (total) {
      const seqFrom = Math.max(1, total - limit + 1);
      for await (const msg of client.fetch({ seq: `${seqFrom}:*` }, { envelope: true, source: true })) {
        const env = msg.envelope;
        const body = (msg.source ?? Buffer.alloc(0)).toString("utf8");
        messages.push({
          from: env?.from?.[0]
            ? `${env.from[0].name ?? ""} <${env.from[0].address ?? ""}>`.trim()
            : "mittente sconosciuto",
          subject: env?.subject ?? "(senza oggetto)",
          date: env?.date ? new Date(env.date).toISOString() : null,
          snippet: body
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .slice(0, 160),
          mailbox: "INBOX",
        });
      }
    }
    await client.logout();
    return { ok: true, messages: messages.reverse() }; // i più recenti prima
  } catch (e) {
    try { client.close(); } catch { /* già chiuso */ }
    return { ok: false, error: e instanceof Error ? e.message : "Errore ricezione" };
  }
}
