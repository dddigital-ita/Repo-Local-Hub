import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  allarmeBackupCloudPure,
  giorniTra,
  oggiRoma,
  ALARM_DOPO_GIORNI,
  parseCloudKey,
  describeCloudKey,
  CLOUD_BACKUP_PREFIX,
} from "../src/lib/backup-cloud-shared.ts";

/**
 * Rete di sicurezza del BACKUP CLOUD: la regola dell'allarme (PURO, qui)
 * e i guard che tengono insieme i pezzi impuri — la funzione server che
 * legge backup_history e il tick che la chiama dopo il backup (mai prima:
 * l'allarme non deve suonare per un ritardo del giro precedente).
 * Stessa ricetta di maintenance.test.mjs: il piano è testato senza DB né
 * S3 né Telegram, i guard testuali tengono i punti di contatto.
 */

const ROOT = process.cwd();

test("giorniTra conta le notti di calendario, immune da fusi e ora legale", () => {
  assert.equal(giorniTra("2026-09-29", "2026-09-30"), 1);
  assert.equal(giorniTra("2026-09-30", "2026-09-29"), -1);
  assert.equal(giorniTra("2026-09-30", "2026-09-30"), 0);
  // Attraverso il cambio di ora legale (ult. domenica di ottobre 2026: 25/10)
  // una notte dura 25 ore: il conteggio resta in giorni interi.
  assert.equal(giorniTra("2026-10-24", "2026-10-26"), 2);
  // L'anno nuovo non mangia un giorno.
  assert.equal(giorniTra("2026-12-31", "2027-01-01"), 1);
});

test("oggiRoma Formato ISO e fuso fisso (identico a quello usato dal backup)", () => {
  // 2026-01-01T00:30 UTC = 01:30 Roma del 1° gennaio; a Honolulu (UTC-10)
  // sarebbe ancora 31 dicembre: il fuso NON deve dipendere dalla macchina.
  const t = Date.UTC(2026, 0, 1, 0, 30);
  assert.equal(oggiRoma(t), "2026-01-01");
  // 23:30 Roma del 31/10 = 21:30 UTC stesso giorno.
  assert.equal(oggiRoma(Date.UTC(2026, 9, 31, 21, 30)), "2026-10-31");
});

test("allarme: suona al secondo giorno senza backup riuscito", () => {
  const d = allarmeBackupCloudPure({ lastOkDay: "2026-09-29", oggi: "2026-10-01", suonatoIl: null });
  assert.equal(d.giorni, 2);
  assert.equal(d.due, true, "2 giorni di fila senza backup = allarme (la soglia richiesta)");
  assert.equal(ALARM_DOPO_GIORNI, 2, "la soglia contrattuale è 2 giorni");
});

test("silenzio: backup di ieri o di oggi, nessun allarme", () => {
  assert.equal(allarmeBackupCloudPure({ lastOkDay: "2026-09-30", oggi: "2026-10-01", suonatoIl: null }).due, false);
  assert.equal(allarmeBackupCloudPure({ lastOkDay: "2026-10-01", oggi: "2026-10-01", suonatoIl: null }).due, false);
});

test("dedup: un messaggio al giorno massimo, poi si riarma il giorno dopo", () => {
  const stessoGiorno = allarmeBackupCloudPure({ lastOkDay: "2026-09-28", oggi: "2026-10-01", suonatoIl: "2026-10-01" });
  assert.equal(stessoGiorno.due, false, "già suonato oggi: il tick delle 15 dopo non ripete il lamento");
  const giornoDopo = allarmeBackupCloudPure({ lastOkDay: "2026-09-28", oggi: "2026-10-02", suonatoIl: "2026-10-01" });
  assert.equal(giornoDopo.due, true, "il giorno dopo la rete ritenta finché il backup non torna");
});

test("mai riuscito: il silenzio totale è lui stesso un guasto", () => {
  const mai = allarmeBackupCloudPure({ lastOkDay: null, oggi: "2026-10-01", suonatoIl: null });
  assert.equal(mai.giorni, null);
  assert.equal(mai.due, true, "nessun backup in storia = allarme (anche solo env storage mai configurate)");
  const maiGiaSuonato = allarmeBackupCloudPure({ lastOkDay: null, oggi: "2026-10-01", suonatoIl: "2026-10-01" });
  assert.equal(maiGiaSuonato.due, false, "…ma sempre con la dedup giornaliera");
});

test("un nuovo successo spegne l'allarme senza job di reset", () => {
  const guarito = allarmeBackupCloudPure({ lastOkDay: "2026-10-01", oggi: "2026-10-01", suonatoIl: "2026-09-30" });
  assert.equal(guarito.due, false);
});

/* ── Guard dei pezzi impuri (stessa disciplina di maintenance.test.mjs) ── */

test("la funzione server segue il contratto: successo in backup_history, dedup dopo la consegna", async () => {
  const src = readFileSync(path.join(ROOT, "src/lib/backup-cloud.ts"), "utf8");
  // La fonte della verità è l'ULTIMO backup di sistema: runCloudBackup ci
  // scrive SOLO dopo la verifica del file, quindi created_by='system' È un successo.
  assert.match(src, /backup_history where created_by = 'system' order by created_at desc/, "l'ultimo successo si legge da backup_history (system)");
  // La dedup si segna DOPO la notifica consegnata: se Telegram tace, il prossimo tick riprova.
  // (ultima occorrenza della chiave = l'INSERT che segue la notifyAdmin; la prima è l'import.)
  const idxNotify = src.indexOf("notifyAdmin(");
  const idxMark = src.lastIndexOf("CLOUD_BACKUP_ALARM_KEY");
  assert.ok(idxNotify > -1, "l'allarme passa da notifyAdmin (email+Telegram)");
  assert.ok(idxMark > idxNotify, "la dedup va segnata DOPO aver notificato, non prima");
  // L'audit usa il canale dei cron, non azioni improvvisate.
  assert.match(src, /cron\.backup-cloud-allarme/);
  // La regola resta nel puro condiviso, non riscritta nel server.
  assert.match(src, /allarmeBackupCloudPure/, "il server deve usare la regola PURA testata");
});

/* ── Chiavi dei backup nel bucket (elenco + restore d'emergenza) ────── */

test("parseCloudKey riconosce solo le chiavi dei backup automatici", () => {
  assert.deepEqual(parseCloudKey("auto/db-2026-10-01-223125.json.gz"), { day: "2026-10-01", time: "223125" });
  // L'imprevisto NON passa: la UI non deve proporre il restore di ciò che non è.
  assert.equal(parseCloudKey("auto/db-2026-10-01.json.gz"), null, "manca l'ora");
  assert.equal(parseCloudKey("auto/db-2026-10-01-223125.json"), null, "non è gzip");
  assert.equal(parseCloudKey("uploads/segreto.json.gz"), null, "prefisso diverso");
  assert.equal(parseCloudKey("../../etc/passwd"), null, "path traversal escluso per costruzione");
  assert.equal(parseCloudKey("auto/db-2026-13-99-999999.json.gz"), null, "data impossibile rifiutata dalla forma");
  // Il prefisso condiviso è lo stesso del deposito (runCloudBackup).
  assert.equal(CLOUD_BACKUP_PREFIX, "auto/db-");
});

test("describeCloudKey parla italiano e torna null sulle chiavi strane", () => {
  assert.equal(describeCloudKey("auto/db-2026-10-01-223125.json.gz"), "1 ottobre 2026, 22:31");
  assert.equal(describeCloudKey("auto/not-a-backup"), null);
});

test("listCloudBackups e readCloudBackupJson esistono e sono server-only", async () => {
  const src = readFileSync(path.join(ROOT, "src/lib/backup-cloud.ts"), "utf8");
  assert.match(src, /export async function listCloudBackups/, "elenco dei backup nel bucket per la UI admin");
  assert.match(src, /export async function readCloudBackupJson/, "lettura scompattata per il piano di restore");
  // La lettura verifica l'identità del file PRIMA di decomprimere: un backup
  // corrotto non arriva mai al piano, tanto meno al restore.
  const idxHead = src.indexOf("HeadObjectCommand");
  const idxGunzip = src.indexOf("gunzipSync(gz");
  assert.ok(idxHead > -1 && idxGunzip > -1, "head per lo sha256 atteso, poi gunzip");
  assert.ok(src.indexOf("digest !== expected") > -1, "confronto sha256 atteso vs calcolato");
  assert.ok(src.indexOf("digest !== expected") < idxGunzip, "il confronto precede la decompressione");
  // L'inventario usa il parser PURO condiviso: chiavi impresentabili escluse.
  assert.match(src, /parseCloudKey/, "l'elenco filtra con parseCloudKey");
});

test("le rotte admin del cloud backup sono autenticate e il piano riusa planRestore", () => {
  const plan = readFileSync(path.join(ROOT, "src/app/api/admin/cloud-backup/plan/route.ts"), "utf8");
  const list = readFileSync(path.join(ROOT, "src/app/api/admin/cloud-backup/list/route.ts"), "utf8");
  for (const [name, src] of [["plan", plan], ["list", list]]) {
    assert.match(src, /getAdminUser/, `${name}: solo sessione admin`);
    assert.match(src, /unauthorized/, `${name}: 401 esplicito`);
  }
  // Il piano cloud rifiuta chiavi fuori forma PRIMA di toccare il bucket.
  assert.ok(
    plan.indexOf("parseCloudKey(key)") < plan.indexOf("readCloudBackupJson(key)"),
    "la chiave è validata prima della lettura S3",
  );
  assert.match(plan, /planRestore/, "stessa pipeline del piano da file");
});

test("la UI cloud riusa la conferma RIPRISTINA e non aggira la server action", () => {
  const ui = readFileSync(path.join(ROOT, "src/components/restore-section.tsx"), "utf8");
  assert.match(ui, /api\/admin\/cloud-backup\/list/, "elenco dal bucket");
  assert.match(ui, /api\/admin\/cloud-backup\/plan/, "piano dal bucket");
  assert.match(ui, /restoreConfirmAction/, "l'esecuzione resta la server action esistente");
  assert.match(ui, /sha256\.slice\(0, 12\)/, "dimensione e sha256 mostrati per ogni backup");
  // Una sola fonte di verità per il form di conferma (file e cloud condividono RestoreConfirm).
  assert.match(ui, /function RestoreConfirm/, "il form di conferma è condiviso");
  const idxForm = ui.indexOf("function RestoreConfirm");
  assert.ok(idxForm < ui.indexOf("form action={restoreConfirmAction}"), "il form vive dentro il componente condiviso");
});

test("il tick chiama l'allarme DOPO il backup e lo espone nel summary", () => {
  const src = readFileSync(path.join(ROOT, "src/app/api/cron/tick/route.ts"), "utf8");
  const idxBackup = src.indexOf("runCloudBackup(\"system\")");
  const idxAlarm = src.indexOf("allarmeBackupCloudSeDovuto(\"system\")");
  assert.ok(idxBackup > -1, "il tick deve eseguire il backup");
  assert.ok(idxAlarm > idxBackup, "l'allarme va valutato DOPO il backup del giro: non deve suonare per un ritardo del giro precedente");
  assert.match(src, /cloudBackupAlarm/, "l'esito arriva nel summary del tick");
  // Best-effort: dentro try/catch come ogni altro automatismo del tick.
  assert.match(src, /cloud backup alarm skip/);
});
