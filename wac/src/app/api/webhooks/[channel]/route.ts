import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  getAdapter,
  findChannelAccount,
  syncChannelAccountsFromLegacy,
  accountSecret,
  signLinkedInChallenge,
  type InboundMessage,
  type ChannelAccountRow,
} from "@/lib/channel-registry";

export const dynamic = "force-dynamic";

/**
 * WEBHOOK OMNICANALE FIRMATO (Fase 4 del desk): UNA porta per i canali
 * social/chat del registry — /api/webhooks/telegram, /api/webhooks/instagram,
 * /api/webhooks/messenger, /api/webhooks/facebook, /api/webhooks/linkedin —
 * invece di una route per provider.
 *
 * Contratto (stessa disciplina del webhook Telegram esistente):
 *  1. canale sconosciuto o senza adapter → 404 (il provider capisce subito);
 *  2. firma: l'adapter verifica l'header del provider sul CORPO GREZZO con
 *     il secret dell'account (HMAC-SHA256, confronto costante) → 403;
 *  3. dedup: (channel_account_id, provider_ref) UNIQUE su messages → il
 *     ritentativo del provider trova il conflitto e riceve 200;
 *  4. sempre 200 a pipeline accettata: un 5xx fa ritentare il provider e
 *     il dedup protegge, ma meglio non abusarne.
 *
 * LinkedIn: PRIMA dei POST, LinkedIn valida l'URL con
 * GET ?challengeCode=<uuid> — l'endpoint risponde entro 3s con
 * { challengeCode, challengeResponse } (hex HMAC-SHA256 del code col
 * clientSecret dell'account: il secret dell'app è UNO, ogni riga
 * channel_accounts lo custodisce cifrato). Senza account linkedin
 * abilitato la validazione fallisce e LinkedIn blocca l'endpoint:
 * il provisioning (riga account) precede sempre la registrazione.
 *
 * Conversazioni: il filo del mittente si ritrova per (channel, contact_handle)
 * come fa telegram-ingest — ticket nuovo se non esiste un aperto, messaggio
 * nel filo aperto altrimenti. Le impronte di Ambrosio (takeover/followup)
 * restano ignorate qui: chi riceve decide in inbox/scheda.
 */

async function insertInbound(
  channel: string,
  account: { id: string },
  msg: InboundMessage,
): Promise<{ duplicate: boolean; conversationId: string | null }> {
  const pool = db();
  if (!pool) return { duplicate: false, conversationId: null };

  // Dedup PRIMA dell'insert: il provider ritenta per ore, la UNIQUE 040
  // (channel_account_id, provider_ref) è il lock. Conflitto = già visto.
  const dup = await pool.query(
    `select 1 from messages where channel_account_id = $1 and provider_ref = $2 limit 1`,
    [account.id, msg.providerRef],
  );
  if (dup.rows.length > 0) return { duplicate: true, conversationId: null };

  // Il filo: una conversazione APERTA dello stesso canale con lo stesso
  // handle; altrimenti nuovo ticket (stessa regola di telegram-ingest).
  const open = await pool.query<{ id: string }>(
    `select id from conversations
     where channel = $1 and contact_handle = $2 and status not in ('closed','on_hold')
     order by updated_at desc limit 1`,
    [channel, msg.senderHandle],
  );
  let convId = open.rows[0]?.id ?? null;
  if (!convId) {
    const ins = await pool.query<{ id: string }>(
      `insert into conversations (channel, status, initial_query, contact_handle, created_at, updated_at)
       values ($1, 'bot', $2, $3, coalesce($4, now()), now()) returning id`,
      [channel, msg.text.slice(0, 200), msg.senderHandle, msg.sentAt ?? null],
    );
    convId = ins.rows[0].id;
  }

  // Il target dell'ON CONFLICT deve RIPETERE il WHERE dell'indice parziale
  // (messages_provider_ref_unique): senza il predicato Postgres non trova
  // «the unique constraint matching» e l'insert esplode (beccato in E2E).
  await pool.query(
    `insert into messages (conversation_id, sender, body, created_at, channel_account_id, provider_ref)
     values ($1, 'visitor', $2, coalesce($3, now()), $4, $5)
     on conflict (channel_account_id, provider_ref) where channel_account_id is not null and provider_ref is not null
     do nothing`,
    [convId, msg.text, msg.sentAt ?? null, account.id, msg.providerRef],
  );
  await pool.query(`update conversations set updated_at = now() where id = $1`, [convId]);
  return { duplicate: false, conversationId: convId };
}

export async function GET(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;

  // LinkedIn webhook validation: GET ?challengeCode=<uuid> →
  // { challengeCode, challengeResponse } entro 3 secondi.
  if (channel === "linkedin") {
    const challengeCode = new URL(req.url).searchParams.get("challengeCode");
    if (challengeCode) {
      const pool = db();
      if (!pool) return Response.json({ ok: false, error: "db_non_configurato" }, { status: 500 });
      const acc = await pool.query<Pick<ChannelAccountRow, "credentials">>(
        `select credentials from channel_accounts where channel = 'linkedin' and enabled limit 1`,
      );
      const secret = acc.rows[0] ? accountSecret(acc.rows[0]) : null;
      if (!secret) {
        // Nessun account linkedin abilitato: LinkedIn fallisce la
        // validazione (e dopo 3 volte blocca l'endpoint). Segnale
        // chiaro: il provisioning della chiave API precede la
        // registrazione del webhook.
        return Response.json({ ok: false, error: "nessun_account_linkedin" }, { status: 500 });
      }
      return Response.json({ challengeCode, challengeResponse: signLinkedInChallenge(challengeCode, secret) });
    }
  }

  // Ping di setup (come il GET del webhook Telegram): dice se il canale è nel registry.
  const adapter = getAdapter(channel);
  return Response.json({ ok: true, channel, registered: Boolean(adapter) });
}

export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  const adapter = getAdapter(channel);
  if (!adapter) {
    return Response.json({ ok: false, error: "canale_sconosciuto" }, { status: 404 });
  }

  const pool = db();
  if (!pool) return Response.json({ ok: true, error: "db_non_configurato" });

  // L'account: il payload dice chi riceve (entry.id per Meta, chat per
  // Telegram) ma la VERIFICA viene prima del parse — per gli adapter Meta
  // servirebbe il corpo per trovare l'account, quindi: corpo grezzo → parse
  // soft per external_id → verifica firma con QUEL account → re-parse per
  // i messaggi. Il corpo grezzo è la materia dell'HMAC: mai riparsare prima
  // della verifica.
  const rawBody = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: true }); // corpo non-JSON: nulla da fare, 200
  }

  // external_id dal payload (per Meta: entry[].id; per Telegram l'account
  // sintetico del bot è unico — rispecchiato da telegram_chats).
  let externalId: string | null = null;
  if (channel === "telegram") {
    await syncChannelAccountsFromLegacy();
    const first = adapter.parseInbound(
      { id: "", channel: "telegram", external_id: "", label: null, credentials: {}, enabled: true },
      payload,
    );
    // L'handle del mittente identifica il filo, ma l'ACCOUNT telegram è il
    // bot stesso: lo prendo dal mirror (un solo account sintetico per chat
    // conosciuta; se il mittente è nuovo, la conversazione nasce senza
    // account e il canale legacy continua a gestirla).
    const handle = first[0]?.senderHandle;
    if (handle) {
      const acc = await pool.query<{ id: string }>(
        `select id from channel_accounts where channel = 'telegram' and external_id = $1 limit 1`,
        [handle],
      );
      if (acc.rows[0]?.id) externalId = handle;
    }
    if (!externalId) {
      const anyAcc = await pool.query<{ external_id: string }>(
        `select external_id from channel_accounts where channel = 'telegram' and enabled limit 1`,
      );
      externalId = anyAcc.rows[0]?.external_id ?? null;
    }
  } else {
    // L'account ricevente lo dice il payload: entry[].id per Meta
    // (Instagram/Messenger/Facebook), organizationalEntity per
    // LinkedIn. Ogni adapter ha IL SUO estrattore — nessun if per
    // provider qui.
    externalId = adapter.externalIdFrom?.(payload) ?? null;
  }
  if (!externalId) return Response.json({ ok: true }); // payload non pertinente

  const account = await findChannelAccount(channel, externalId);
  if (!account) {
    // Account non configurato: 200 (il provider non ritenta per un setup
    // mancante) ma audit: è un segnale di configurazione da completare.
    await logAudit("system", "webhook.account_sconosciuto", null, `${channel} external_id=${externalId}`).catch(() => {});
    return Response.json({ ok: true, error: "account_non_configurato" });
  }

  // FIRMA sul corpo grezzo con il secret dell'account (403 se sbagliata).
  if (!adapter.verifySignature(account, rawBody, req.headers)) {
    console.warn(`[webhooks/${channel}] firma non valida per l'account ${account.external_id}`);
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const messages = adapter.parseInbound(account, JSON.parse(rawBody));
  if (messages.length === 0) return Response.json({ ok: true });

  let accepted = 0;
  let duplicated = 0;
  for (const msg of messages) {
    const res = await insertInbound(channel, account, msg);
    if (res.duplicate) duplicated++;
    else if (res.conversationId) accepted++;
  }
  if (accepted > 0) {
    await logAudit("system", `webhook.${channel}`, null, `${accepted} messaggio/i accettati (${duplicated} duplicati)`).catch(() => {});
  }
  return Response.json({ ok: true, accepted, duplicated });
}
