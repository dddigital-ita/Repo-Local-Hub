/**
 * Notifica all'operatore di turno: email via Resend (se configurata) +
 * messaggio Telegram (se configurato). Entrambe best-effort: se falliscono
 * la chat continua comunque e l'errore viene loggato.
 */

interface LeadNotification {
  name: string;
  phone: string;
  service?: string;
  urgency?: string;
  budget?: string;
  existingSite?: string;
  query?: string;
  sourcePage?: string;
  operatorName?: string;
  operatorPhone?: string;
}

function buildBody(lead: LeadNotification): string {
  return [
    `NUOVO LEAD — ${lead.name} — ${lead.phone}`,
    lead.service ? `Servizio: ${lead.service}` : "",
    lead.urgency ? `Urgenza: ${lead.urgency}` : "",
    lead.budget ? `Budget: ${lead.budget}` : "",
    lead.existingSite ? `Sito esistente: ${lead.existingSite}` : "",
    lead.query ? `Ricerca: «${lead.query}»` : "",
    lead.sourcePage ? `Pagina: ${lead.sourcePage}` : "",
    lead.operatorName ? `Operatore di turno: ${lead.operatorName} (${lead.operatorPhone ?? "n/d"})` : "",
    "Apri la dashboard: /admin",
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendEmail(lead: LeadNotification, body: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!key || !to || !from) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `🔔 Nuovo lead: ${lead.name} (${lead.phone})`,
      text: body,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/**
 * Invia a una o più chat: TELEGRAM_CHAT_ID può essere un id singolo
 * oppure più id separati da virgola (es. gruppo condiviso + chat private).
 */
async function sendTelegram(lead: LeadNotification, body: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || chatIds.length === 0) return;
  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: body }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Telegram ${res.status} (chat ${chatId}): ${await res.text()}`);
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === chatIds.length) {
    throw failed[0].status === "rejected" ? failed[0].reason : new Error("Telegram: tutte le chat fallite");
  }
  if (failed.length > 0) {
    console.error("[notify] telegram: alcune chat fallite:", failed.map((f) => String((f as PromiseRejectedResult).reason)));
  }
}

/** Conferma callback al cliente (se abbiamo l'email) + promemoria all'operatore. */
export async function notifyCallback(cb: {
  slot: string;
  phone: string | null;
  email: string | null;
  query?: string;
  sourcePage?: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !cb.email) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [cb.email],
        subject: `Conferma richiamo — ${cb.slot}`,
        text: `Confermato: ti chiamiamo ${cb.slot}.\nSe l'orario non va bene, rispondi a questa email o chiama il numero del sito.`,
      }),
    });
  } catch (e) {
    console.error("[notify] callback email:", e);
  }
}

/** Best-effort: mai far bloccare la chat dalla notifica. */
export async function notifyOperator(lead: LeadNotification): Promise<{
  email: boolean;
  telegram: boolean;
}> {
  const body = buildBody(lead);
  const results = { email: false, telegram: false };
  await Promise.allSettled([
    sendEmail(lead, body).then(
      () => (results.email = true),
      (e) => console.error("[notify] email:", e),
    ),
    sendTelegram(lead, body).then(
      () => (results.telegram = true),
      (e) => console.error("[notify] telegram:", e),
    ),
  ]);
  // Canale non configurato in env = non inviato: segnalato onestamente come false
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL || !process.env.EMAIL_FROM) {
    results.email = false;
  }
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    results.telegram = false;
  }
  return results;
}

/** Allerta sicurezza: un IP è stato bannato da Shield. Best-effort. */
export async function notifyShieldBan(ban: {
  ip: string;
  reason: string;
  endpoint?: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const body = [
    "SHIELD - IP bloccato",
    "IP: " + ban.ip,
    "Motivo: " + ban.reason,
    ban.endpoint ? "Ultimo endpoint: " + ban.endpoint : "",
    "Dashboard: /admin/shield",
  ]
    .filter(Boolean)
    .join("\n");
  if (token && chatIds.length) {
    await Promise.allSettled(
      chatIds.map((chatId) =>
        fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: body }),
        }),
      ),
    );
  }
}

/* ── Ticketing: «il cliente attende una risposta» ────────────────── */

function sendAdminEmail(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!key || !to || !from) return Promise.resolve(false);
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  }).then(
    async (res) => {
      if (!res.ok) console.error("[notify] admin email:", res.status, await res.text());
      return res.ok;
    },
    (e) => {
      console.error("[notify] admin email:", e);
      return false;
    },
  );
}

function sendAdminTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || chatIds.length === 0) return Promise.resolve(false);
  return Promise.allSettled(
    chatIds.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`Telegram ${res.status} (chat ${chatId}): ${await res.text()}`);
      }),
    ),
  ).then((results) => {
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) console.error("[notify] admin telegram:", failed.map((f) => String((f as PromiseRejectedResult).reason)));
    return failed.length < chatIds.length; // almeno una chat consegnata
  });
}

/**
 * Handoff di Ambrosio al team: la AI non sa (o non può) gestire il cliente e
 * il ticket passa a uno umano. Email + Telegram con motivo, canale e link
 * diretto al ticket: chi è in turno vede SUBITO che c'è un caso da prendere,
 * senza aspettare di aprire la inbox. Dedup: una notifica per fase di attesa
 * (si riarma quando il ticket torna ad Ambrosio o viene risposto).
 * Best-effort: un fallimento non tocca la risposta già pronta per il cliente.
 */
export async function notifyHandoff(t: {
  ticketId: string;
  number: number;
  customerName: string | null;
  reason: string;
  channel: string;
  baseUrl?: string;
}): Promise<boolean> {
  const who = t.customerName ? `${t.customerName} (#${t.number})` : `#${t.number}`;
  const link = `${t.baseUrl ?? ""}/admin/tickets?t=${t.ticketId}`;
  const text = [
    `🤝 Ambrosio passa il turno — ticket ${who}`,
    `Motivo: ${t.reason}`,
    `Canale: ${t.channel} · Apri: ${link}`,
  ].join("\n");
  const [email, tg] = await Promise.allSettled([
    sendAdminEmail(`🤝 Handoff Ambrosio — ticket ${who}`, text),
    sendAdminTelegram(text),
  ]);
  return (
    (email.status === "fulfilled" && email.value) || (tg.status === "fulfilled" && tg.value)
  );
}

/**
 * Ticket in attesa di risposta: il campanello che mancava. Un cliente ha
 * scritto e nessun umano ha replicato: email + Telegram con link diretto al
 * ticket. Best-effort: un fallimento non deve MAI rompere la chat.
 */
export async function notifyAwaitingReply(t: {
  number: number;
  ticketId: string;
  customerName: string | null;
  snippet: string;
  baseUrl?: string;
}): Promise<boolean> {
  const label = t.customerName ? `${t.customerName} (#${t.number})` : `#${t.number}`;
  const link = `${t.baseUrl ?? ""}/admin/tickets?t=${t.ticketId}`;
  const text = [
    `⏰ Risposta attesa — ticket ${label}`,
    `«${t.snippet.slice(0, 140)}»`,
    link,
  ].join("\n");
  const [email, tg] = await Promise.allSettled([
    sendAdminEmail(`⏰ Ticket ${label} attende una risposta`, text),
    sendAdminTelegram(text),
  ]);
  return (
    (email.status === "fulfilled" && email.value) || (tg.status === "fulfilled" && tg.value)
  );
}

/**
 * Avviso amministrativo generico (cron Fase 2: SLA, callback mancate,
 * reminder): stesso canale email+Telegram, consegnato se ALMENO uno dei due
 * canali è configurato e riesce. Best-effort, mai bloccante.
 */
export async function notifyAdmin(subject: string, text: string): Promise<boolean> {
  const [email, tg] = await Promise.allSettled([
    sendAdminEmail(subject, text),
    sendAdminTelegram(text),
  ]);
  return (
    (email.status === "fulfilled" && email.value) || (tg.status === "fulfilled" && tg.value)
  );
}
