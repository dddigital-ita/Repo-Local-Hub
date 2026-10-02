#!/usr/bin/env node
/**
 * RESET AMBIENTE DI LAVORO — cancella i dati demo e crea 3 ticket d'esempio
 * diversi tra loro (esito di Ambrosio diverso per ciascuno).
 *
 * Uso:
 *   node scripts/demo-reset.mjs            mostra i conteggi attuali (dry run)
 *   node scripts/demo-reset.mjs --yes      cancella + ricrea i 3 esempi
 *
 * Cosa cancella (dati operativi demo, NON configurazione):
 *   - DELETE in ordine FK-safe: gcal_sync_log, notion_sync_queue, telegram_*,
 *     ai_provider_log, ai_faq_usage, flash_notes, ai_proposals,
 *     client_conversations, ticket_notes, messages, email_ingest, callbacks,
 *     leads, conversations, clients
 *   - TRUNCATE per le tabelle append-only (rule no_delete blocca il DELETE):
 *     audit_log, backup_history, shield_events, shield_bans
 *
 * Note tecniche (imparate alschool):
 *   - TUTTO gira su UNA connessione dedicata (pool.connect()): con pool.query
 *     un errore butta il client e con esso la transazione aperta, e le
 *     istruzioni dopo partirebbero in autocommit.
 *   - Le tabelle di migration NON applicate in questo ambiente vengono
 *     saltate (pre-check su information_schema): nessun try/catch che
 *     nasconde errori veri.
 *   - La coppia leads ↔ callbacks ha FK circolari (leads.callback_id e
 *     callbacks.lead_id): si spezza azzerando leads.callback_id PRIMA di
 *     cancellare le callback. Neon non concede il superuser: niente
 *     «disable trigger».
 *
 * NON tocca: operators, admin_users, ai_settings, ai_faqs, ai_provider_keys,
 * content_settings, notion_settings, whatsapp_config, telegram_config,
 * packages, schema_migrations (configurazione reale del progetto).
 *
 * I 3 ticket d'esempio:
 *   1. Solo bot — domanda FAQ senza contatti, appena arrivata (stato «bot»,
 *      entro SLA: la dashboard mostra un KPI ticket «tutti entro SLA»).
 *   2. Lead hot con lead completo e portafoglio clienti collegato.
 *   3. Callback fissata (stato «callback_scheduled» + callback pendente domani).
 *
 * Richiede DATABASE_URL (la legge da .env.local se manca nell'ambiente).
 */

import { Pool } from "pg";
import { readFileSync } from "node:fs";

// carica .env.local se DATABASE_URL non è già nell'ambiente
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
      }
    }
  } catch {
    // niente .env.local: l'errore arrive sotto dal pool
  }
}

const args = process.argv.slice(2);
const dryRun = !args.includes("--yes");

// ordine FK-safe: prima i figli/log, poi le tabelle radice
const TABLES = [
  "gcal_sync_log",
  "notion_sync_queue",
  "telegram_updates",
  "telegram_chats",
  "ai_provider_log",
  "ai_faq_usage",
  "flash_notes",
  "ai_proposals",
  "client_conversations",
  "ticket_notes",
  "messages",
  "email_ingest",
  "callbacks",
  "leads",
  "conversations",
  "clients",
];

// Append-only (RULE on delete do instead nothing): il DELETE è un no-op,
// serve TRUNCATE. Non hanno FK in entrata.
const TRUNCATE_TABLES = ["audit_log", "backup_history", "shield_events", "shield_bans"];

// SSL solo se il server lo supporta: Neon lo richiede, Postgres locale no
// (dls localhost rifiuta SSL → sslmode prefer, come fa il client psql).
const localDb = /localhost|127\.0\.0\.1|::1/.test(process.env.DATABASE_URL ?? "");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ...(localDb ? {} : { ssl: { rejectUnauthorized: false } }),
});

try {
  // ── 1. PULIZIA ──────────────────────────────────────────────────
  // Tabelle realmente presenti: le migration mancanti si saltano, senza
  // try/catch silenziosi che nasconderebbero errori veri.
  const probe = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  const present = new Set(probe.rows.map((r) => r.table_name));

  if (dryRun) {
    console.log("── Stato attuale ──");
    for (const t of TABLES) {
      if (!present.has(t)) continue;
      const { rows } = await pool.query(`select count(*)::int as n from ${t}`);
      if (rows[0].n > 0) console.log(`  ${t.padEnd(22)} ${rows[0].n}`);
    }
    for (const t of TRUNCATE_TABLES) {
      if (!present.has(t)) continue;
      const { rows } = await pool.query(`select count(*)::int as n from ${t}`);
      if (rows[0].n > 0) console.log(`  ${t.padEnd(22)} ${rows[0].n}  (truncate)`);
    }
    console.log("\nDRY RUN — niente cancellato. Per eseguire davvero:");
    console.log("  node scripts/demo-reset.mjs --yes");
  } else {
    console.log("Cancellazione in corso…");

    // Connessione dedicata: begin/deletes/insert/commit sulla STESSA socket,
    // così la transazione regge fino al commit (vedi note in testa).
    const client = await pool.connect();
    try {
      await client.query("begin");

      // FK circolari callbacks ↔ leads: si spezzano azzerando il riferimento
      // leads.callback_id (un UPDATE banale, nessun privilegio speciale).
      await client.query("update leads set callback_id = null where callback_id is not null");

      for (const t of TABLES) {
        if (!present.has(t)) continue;
        const res = await client.query(`delete from ${t}`);
        if (res.rowCount > 0) console.log(`  ${t.padEnd(22)} ${res.rowCount} righe cancellate`);
      }
      for (const t of TRUNCATE_TABLES) {
        if (!present.has(t)) continue;
        await client.query(`truncate table ${t}`);
        console.log(`  ${t.padEnd(22)} svuotata (truncate)`);
      }

      // ── 2. I 3 TICKET D'ESEMPIO ─────────────────────────────────

      // ── ESEMPIO 1: ticket gestito dal solo bot (nessun contatto) ──
      const t1 = await client.query(
        "insert into conversations (initial_query, source_page, status, priority, created_at) values ($1,$2,'bot','normale', now() - interval '30 minutes') returning id, number, initial_query",
        ["quanto costa un sito vetrina", "/prezzi"],
      );
      await client.query(
        "insert into messages (conversation_id, sender, body, created_at) values ($1,'visitor','Quanto costa un sito vetrina?', now() - interval '30 minutes'), ($1,'bot','Dipende dalle pagine e dalle funzioni: per un vetrina si parte da 800 €. Vuoi che ti chiami?', now() - interval '30 minutes' + interval '1 minute')",
        [t1.rows[0].id],
      );

      // ── ESEMPIO 2: lead HOT con scheda completa + cliente nel portafoglio ──
      const t2 = await client.query(
        "insert into conversations (initial_query, source_page, status, priority, created_at) values ($1,$2,'lead_captured','alta', now() - interval '1 day') returning id, number, initial_query",
        ["sito e-commerce per negozio di abbigliamento", "/ecommerce-lecce-salento"],
      );
      await client.query(
        "insert into messages (conversation_id, sender, body, created_at) values ($1,'visitor','Ho un negozio di abbigliamento e vorrei vendere online, è urgente', now() - interval '1 day'), ($1,'bot','Perfetto: quante referenze vuoi gestire?', now() - interval '1 day' + interval '1 minute'), ($1,'visitor','circa 500 prodotti, budget fino a 8000 euro', now() - interval '1 day' + interval '2 minutes')",
        [t2.rows[0].id],
      );
      // L'id del lead serve solo alla INSERT (nessuna callback da collegare
      // qui: è l'esempio 3 a fissarla): underscore come da convenzione lint.
      const _l2 = await client.query(
        "insert into leads (conversation_id, name, phone, service, urgency, budget, consent, hot, status, initial_query, source_page, created_at) values ($1,$2,$3,$4,$5,$6,true,true,'nuovo',$7,$8, now() - interval '1 day') returning id",
        [t2.rows[0].id, "Giulia Bianchi", "+393331234567", "e-commerce", "entro 1 mese", "5-8k €", "sito e-commerce per negozio di abbigliamento", "/ecommerce-lecce-salento"],
      );
      const c2 = await client.query(
        "insert into clients (name, phone_e164, company_name, notes) values ($1,$2,$3,$4) returning id",
        ["Giulia Bianchi", "+393331234567", "Boutique Bianchi", "Lead caldo: e-commerce con ~500 referenze."],
      );
      await client.query("insert into client_conversations (conversation_id, client_id) values ($1,$2)", [t2.rows[0].id, c2.rows[0].id]);

      // ── ESEMPIO 3: callback fissata per domani (fuori turno) ──────
      const t3 = await client.query(
        "insert into conversations (initial_query, source_page, status, priority, created_at) values ($1,$2,'callback_scheduled','normale', now() - interval '3 days') returning id, number, initial_query",
        ["restyling sito WordPress", "/restyling-sito-web-salento"],
      );
      await client.query(
        "insert into messages (conversation_id, sender, body, created_at) values ($1,'visitor','Vorrei un preventivo per rinnovare il mio sito, ma sono in ufficio tutto il giorno', now() - interval '3 days'), ($1,'bot','Nessun problema: ti richiamiamo domani in mattinata?', now() - interval '3 days' + interval '1 minute'), ($1,'visitor','Sì, perfetto grazie', now() - interval '3 days' + interval '2 minutes')",
        [t3.rows[0].id],
      );
      const l3 = await client.query(
        "insert into leads (conversation_id, name, phone, service, urgency, budget, consent, hot, status, initial_query, source_page, created_at) values ($1,$2,$3,$4,$5,$6,true,false,'contattato',$7,$8, now() - interval '3 days') returning id",
        [t3.rows[0].id, "Luca Verdi", "+393487654321", "restyling", "entro 3 mesi", "2-5k €", "restyling sito WordPress", "/restyling-sito-web-salento"],
      );
      const cb3 = await client.query(
        "insert into callbacks (conversation_id, lead_id, scheduled_at, slot_label, status, notes) values ($1,$2, date_trunc('day', now()) + interval '1 day' + interval '10 hours', 'Domani mattina ~10:00', 'pending', 'Preferisce essere richiamato sul fisso in mattinata.') returning id",
        [t3.rows[0].id, l3.rows[0].id],
      );
      await client.query("update leads set callback_id = $1 where id = $2", [cb3.rows[0].id, l3.rows[0].id]);

      await client.query("commit");

      console.log("\n✅ Ambiente pronto: 3 ticket d'esempio creati.");
      console.log(`  #${t1.rows[0].number}  solo bot          — «${t1.rows[0].initial_query}»`);
      console.log(`  #${t2.rows[0].number}  lead hot + cliente — «${t2.rows[0].initial_query}»`);
      console.log(`  #${t3.rows[0].number}  callback fissata   — «${t3.rows[0].initial_query}»`);
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {
        // rollback best-effort
      }
      throw e;
    } finally {
      client.release();
    }
  }
} catch (e) {
  console.error("Errore:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
