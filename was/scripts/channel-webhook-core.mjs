/**
 * CORE PURO del canale webhook (Fase 4): firma HMAC e parser inbound —
 * ZERO import (nemmeno DB): Node lo esegue nativamente (node --test) e il
 * registry TS lo importa/riesporta. La lezione del config Playwright vale
 * qui: la logica testabile sta in un modulo che non passa da nessun loader
 * né alias.
 *
 * Firma: HMAC-SHA256 sul corpo GREZZO col prefisso «sha256=» — lo schema di
 * Meta (X-Hub-Signature-256) normalizzato in una verifica unica qui. Gli
 * adapter la leggono dall'header del proprio provider.
 */

import { createHmac } from "node:crypto";

export function signWebhookBody(secret, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Confronto in tempo costante (stessa ricetta del webhook Telegram). */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyHmac(secret, rawBody, got) {
  if (!secret || !got) return false;
  return safeEqual(got, signWebhookBody(secret, rawBody));
}

/**
 * Parser Meta (Instagram/Messenger): entry[]/messaging[], solo messaggi
 * reali (no echo) dell'account ricevente (entry.id === external_id).
 */
export function parseMetaInbound(externalId, payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    if (!entry?.id || entry.id !== externalId) continue;
    for (const evt of entry.messaging ?? []) {
      const m = evt?.message;
      if (!m || m.is_echo || !m.mid || !m.text || !evt.sender?.id) continue;
      out.push({
        providerRef: m.mid,
        senderHandle: evt.sender.id,
        senderName: null, // il profilo si risolve via Graph API (Fase 5 outbound)
        text: m.text,
        sentAt: evt.timestamp ? new Date(evt.timestamp).toISOString() : undefined,
      });
    }
  }
  return out;
}

/**
 * external_id Meta: l'id dell'account ricevente (entry[].id —
 * pagina Facebook, pagina Instagram, app Messenger).
 */
export function metaExternalId(payload) {
  const id = payload?.entry?.[0]?.id;
  return id == null ? null : String(id);
}

/**
 * LinkedIn — Organization Social Action Notifications.
 *
 * Firma: X-LI-Signature = hex(HMAC-SHA256("hmacsha256=" + corpo
 * GREZZO, clientSecret)). L'header contiene SOLO l'hex digest:
 * il prefisso «hmacsha256=» serve solo nel string-to-sign.
 * Il corpo va usato esattamente come ricevuto (mai riparsato).
 */
export function signLinkedInBody(secret, rawBody) {
  return createHmac("sha256", secret).update(`hmacsha256=${rawBody}`, "utf8").digest("hex");
}

export function verifyLinkedInSignature(secret, rawBody, got) {
  if (!secret || !got) return false;
  return safeEqual(got, signLinkedInBody(secret, rawBody));
}

/**
 * Validazione dell'endpoint (GET ?challengeCode=<uuid>): entro 3
 * secondi l'endpoint risponde { challengeCode, challengeResponse }
 * con challengeResponse = hex(HMAC-SHA256(challengeCode, clientSecret)).
 */
export function signLinkedInChallenge(challengeCode, secret) {
  return createHmac("sha256", secret).update(String(challengeCode), "utf8").digest("hex");
}

/**
 * external_id LinkedIn: l'URN dell'organizzazione
 * (urn:li:organization:<id>) — la chiave di provisioning dell'account.
 */
export function linkedinExternalId(payload) {
  const events = Array.isArray(payload) ? payload : (payload?.events ?? []);
  const first = events.find((e) => e?.organizationalEntity);
  return first ? String(first.organizationalEntity) : null;
}

/**
 * Parser LinkedIn: notifiche in batch (payload.events, o array al
 * top level). Di un'azione social (LIKE, COMMENT, SHARE, …) entra
 * nel desk SOLO ciò che ha un testo — il commento, la condivisione
 * con caption: il like non è un messaggio. provider_ref =
 * notificationId (la chiave di dedup documentata da LinkedIn);
 * mittente = owner URN dell'attività generata (urn:li:person:<id>).
 */
export function parseLinkedInInbound(payload) {
  const out = [];
  const events = Array.isArray(payload) ? payload : (payload?.events ?? []);
  for (const evt of events) {
    if (!evt || typeof evt !== "object") continue;
    const act = evt.decoratedGeneratedActivity;
    const text = typeof act?.text === "string" ? act.text.trim() : "";
    const owner = typeof act?.owner === "string" ? act.owner : null;
    if (!text || !owner) continue;
    out.push({
      providerRef: evt.notificationId != null ? String(evt.notificationId) : (typeof evt.generatedActivity === "string" ? evt.generatedActivity : ""),
      senderHandle: owner.includes(":") ? owner.split(":").pop() : owner,
      senderName: null, // il profilo si risolve via API (Fase 5 outbound)
      text,
      sentAt: typeof evt.lastModifiedAt === "number" ? new Date(evt.lastModifiedAt).toISOString() : undefined,
    });
  }
  return out;
}

/**
 * Parser Telegram: solo chat private con testo; provider_ref = «chat_id:
 * message_id» (per ACCOUNT: il chat_id identifica il filo e l'account
 * sintetico che il registry rispecchia da telegram_chats).
 */
export function parseTelegramInbound(payload) {
  const m = payload?.message;
  if (!m?.chat || m.chat.type !== "private" || !m.text || typeof m.chat.id !== "number" || typeof m.message_id !== "number") {
    return [];
  }
  return [
    {
      providerRef: `${m.chat.id}:${m.message_id}`,
      senderHandle: String(m.chat.id),
      senderName: m.chat.first_name ?? m.chat.username ?? null,
      text: m.text,
      sentAt: m.date ? new Date(m.date * 1000).toISOString() : undefined,
    },
  ];
}
