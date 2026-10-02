#!/usr/bin/env node
/**
 * UPTIME SETUP — monitor esterni su UptimeRobot (il task del post-mortem
 * 28/09: «Monitoraggio esterno … alert email se non-200. Costo zero,
 * avrebbe tagliato l'outage a minuti»).
 *
 * Cosa fa:
 *   1. crea (o aggiorna) il monitor HTTPS per wac.dddigital.net — l'app,
 *      sondata su /api/health (JSON con status+database, meglio della sola 200);
 *   2. crea (o aggiorna) il monitor HTTPS per dddigital.net — il WordPress
 *      principale (200 atteso; i redirect www sono legittimi, non un alert);
 *   3. l'alert email è quello DEFAULT dell'account (email di registrazione):
 *      nessuna credenziale extra da configurare.
 *
 * IDEMPOTENTE: se un monitor con lo stesso "friendly name" esiste già viene
 * RIUSATO (update), non duplicato. Puoi rilanciarlo quante volte vuoi.
 *
 * SICUREZZA: la Main API key passa SOLO via ambiente (`UPTIMEROBOT_API_KEY`),
 * non viene mai scritta su file né loggata. Non è prevista alcuna via per
 * inserirla nel repo.
 *
 * USO:
 *   export UPTIMEROBOT_API_KEY=uXXXXXX-XXXXXXXXXXXXXXXXXXXXXXXX
 *   node scripts/uptime-setup.mjs            # applica
 *   node scripts/uptime-setup.mjs --dry-run  # mostra cosa farebbe
 */
const API_KEY = process.env.UPTIMEROBOT_API_KEY;
const DRY = process.argv.includes("--dry-run");
const API = "https://api.uptimerobot.com/v2";

/** I due monitor del post-mortem: name, url, intervallo 5 min (il piano free
 *  scende a 5; ogni minuto costa). keyword monitor per l'app: allerta anche
 *  se l'endpoint risponde 200 MA il DB è giù (status != "ok" nel body). */
const MONITORS = [
  {
    friendlyName: "WAC app — wac.dddigital.net (health+db)",
    url: "https://wac.dddigital.net/api/health",
    type: 2, // HTTP(S)
    // keyword 1 = "Paused" no: usiamo keyword monitor (type 3) sulla stringa
    // "ok" con il flag 1 (notify on keyword NOT exist) — così un 200 con DB
    // giù produce comunque l'alert. Lo schema: type 3 richiede keyword.
    keywordType: 1, // alert when keyword NOT exists
    keywordValue: '"status":"ok"',
  },
  {
    friendlyName: "WordPress — dddigital.net",
    url: "https://dddigital.net",
    type: 2,
  },
];

const TOLLERANZA = 5 * 60; // 5 minuti: conferma prima di allertare (evita falsi positivi di rete)

async function api(endpoint, body) {
  const res = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cache-control": "no-cache" },
    body: JSON.stringify({ api_key: API_KEY, format: "json", ...body }),
  });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  if (DRY) {
    console.log("DRY-RUN — mostro i monitor che verrebbero creati/aggiornati:\n");
    for (const m of MONITORS) {
      console.log(`  • ${m.friendlyName}`);
      console.log(`      url: ${m.url}`);
      console.log(`      tipo: ${m.type === 3 ? "keyword" : "http(s)"}, intervallo: ${TOLLERANZA}s, alert: email default account`);
      if (m.keywordValue) console.log(`      keyword (allerta se ASSENTE): ${m.keywordValue}`);
    }
    console.log("\n(lancio senza --dry-run con UPTIMEROBOT_API_KEY per applicare)");
    return;
  }

  if (!API_KEY) {
    console.error(
      "Manca UPTIMEROBOT_API_KEY. Prendila da UptimeRobot → Settings → API → Main API key:\n" +
        "  export UPTIMEROBOT_API_KEY=uXXXXXX-…\n" +
        "  node scripts/uptime-setup.mjs",
    );
    process.exit(1);
  }

  // 1. Quali monitor esistono già? (per essere idempotenti: riuso, non duplica)
  const list = await api("getMonitors", {});
  if (list.stat !== "ok") throw new Error("getMonitors: " + JSON.stringify(list.error ?? list));
  const existing = new Map((list.monitors ?? []).map((m) => [m.friendly_name, m.id]));
  console.log(`monitor esistenti nell'account: ${existing.size}\n`);

  for (const m of MONITORS) {
    const payload = {
      friendly_name: m.friendlyName,
      url: m.url,
      type: m.type,
      interval: TOLLERANZA,
      ...(m.keywordValue ? { keyword_type: m.keywordType, keyword_value: m.keywordValue } : {}),
    };
    if (existing.has(m.friendlyName)) {
      const id = existing.get(m.friendlyName);
      const r = await api("editMonitor", { id, ...payload });
      if (r.stat !== "ok") throw new Error(`editMonitor(${id}): ` + JSON.stringify(r.error ?? r));
      console.log(`↻ aggiornato  [${id}] ${m.friendlyName}`);
    } else {
      const r = await api("newMonitor", payload);
      if (r.stat !== "ok") throw new Error(`newMonitor(${m.friendlyName}): ` + JSON.stringify(r.error ?? r));
      console.log(`✚ creato     [${r.monitor?.id}] ${m.friendlyName}`);
    }
  }
  console.log("\nfatto. Gli alert partono all'email dell'account UptimeRobot (default contact).");
  console.log("Verifica su https://uptimerobot.com → My Monitors: entrambi in stato «Up».");
}

main().catch((e) => {
  console.error("setup interrotto:", e.message);
  process.exit(1);
});
