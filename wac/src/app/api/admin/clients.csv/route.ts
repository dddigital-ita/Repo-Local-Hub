import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";
import { listClients, clientTypeLabel, channelLabel } from "@/lib/clients";
import { clientTypePure, clientsTypeTimelinePure, type TipoMeseRow } from "@/lib/clients-shared";
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/tickets";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Le date dal driver arrivano Date (dev) o stringa (dipende dal path):
 * il CSV vuole la stessa risposta in entrambi i casi — giorno ISO o vuoto.
 */
function csvGiorno(v: unknown): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function csvResponse(csv: string, filename: string) {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * EXPORT CSV DEL PORTAFOGLIO — tre viste, una route:
 *
 *  1) ?id=<uuid>       → la STORIA del cliente: tutti i suoi ticket con
 *                        stato/priorità/canale in etichette UI, uno per riga.
 *  2) ?agg=tipo-mese   → aggregato PER TIPO NEL TEMPO: portafoglio
 *                        cumulativo a fine mese (coorte 038) — la crescita
 *                        di azienda/privato/ente/da-classificare.
 *  3) nessun parametro → la lista segmentata com'era: stessi filtri della
 *                        vista (q/aperti/ordina/tipo/senza-ditta).
 *
 * Tre file con nomi diversi: chi li riceve sa sempre cosa ha aperto.
 */
export async function GET(req: Request) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pool = db();
  if (!pool) return NextResponse.json({ error: "database_not_configured" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);

  /* ── 1 · Storia del cliente (?id=) ──────────────────────────────── */
  const id = searchParams.get("id");
  if (id) {
    const head = await pool.query<{ name: string; client_type: string | null; company_name: string | null }>(
      "select name, client_type, company_name from clients where id = $1",
      [id],
    );
    const cliente = head.rows[0];
    if (!cliente) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const tickets = await pool.query<{
      number: number;
      status: string;
      priority: string;
      channel: string | null;
      initial_query: string | null;
      created_at: string;
      closed_at: string | null;
    }>(
      `select c.number, c.status, c.priority, c.channel, c.initial_query, c.created_at, c.closed_at
       from client_conversations cc
       join conversations c on c.id = cc.conversation_id
       where cc.client_id = $1
       order by c.created_at asc`,
      [id],
    );

    const cols = ["ticket", "stato", "priorita", "canale", "aperto_il", "chiuso_il", "richiesta"];
    const lines = [
      `# Cliente;${csvCell(cliente.name)}`,
      `# Tipo;${csvCell(clientTypeLabel(cliente.client_type))}`,
      ...(cliente.company_name ? [`# Ditta;${csvCell(cliente.company_name)}`] : []),
      cols.join(";"),
      ...tickets.rows.map((t) =>
        [
          `#${t.number}`,
          STATUS_LABEL[t.status] ?? t.status,
          PRIORITY_LABEL[t.priority] ?? t.priority,
          channelLabel(t.channel),
          csvGiorno(t.created_at),
          csvGiorno(t.closed_at),
          t.initial_query,
        ]
          .map(csvCell)
          .join(";"),
      ),
    ];
    return csvResponse(
      "\uFEFF" + lines.join("\n"),
      `cliente-${cliente.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${today}.csv`,
    );
  }

  /* ── 2 · Aggregato per tipo nel tempo (?agg=tipo-mese) ─────────── */
  if (searchParams.get("agg") === "tipo-mese") {
    const since = searchParams.get("da"); // YYYY-MM, opzionale
    const dal = since && /^\d{4}-\d{2}$/.test(since) ? `${since}-01` : null;
    const { rows } = await pool.query<{ mese: string; client_type: string | null; n: number }>(
      `select to_char(first_seen_at, 'YYYY-MM') as mese, client_type, count(*)::int as n
       from clients
       ${dal ? "where first_seen_at >= $1" : ""}
       group by 1, 2
       order by 1`,
      dal ? [dal] : [],
    );
    const timeline = clientsTypeTimelinePure(rows as TipoMeseRow[]);
    const cols = ["mese", "azienda", "privato", "ente_pubblico", "da_classificare", "totale"];
    const csv =
      "\uFEFF" +
      [cols.join(";"), ...timeline.map((r) => [r.mese, r.azienda, r.privato, r.ente_pubblico, r.da_classificare, r.totale].join(";"))].join("\n");
    return csvResponse(csv, `portafoglio-per-tipo-${today}.csv`);
  }

  /* ── 3 · Lista segmentata (stessi filtri della vista) ──────────── */
  const q = searchParams.get("q") ?? undefined;
  const openOnly = searchParams.get("aperti") === "1";
  const sort = searchParams.get("ordina") === "budget" ? "budget" : undefined;
  const tipoParam = searchParams.get("tipo");
  const tipo = tipoParam === "nessuno" ? "nessuno" : clientTypePure(tipoParam) ?? undefined;
  const senzaDitta = searchParams.get("senza-ditta") === "1";
  const limit = Math.min(5000, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "1000", 10) || 1000));

  const rows = await listClients(q, limit, openOnly, sort, tipo, senzaDitta);

  const cols = [
    "name",
    "tipo",
    "company_name",
    "email",
    "phone",
    "budget_dichiarato",
    "ticket_count",
    "open_tickets",
    "canali",
    "primo_visto",
    "ultimo_visto",
  ];
  const lines = [cols.join(";")];
  for (const c of rows) {
    lines.push(
      [
        c.name,
        clientTypeLabel(c.client_type),
        c.company_name,
        c.contact_email ?? c.email_norm,
        c.phone_e164,
        c.budget_total != null ? c.budget_total : "",
        c.ticket_count,
        c.open_tickets,
        (c.channels ?? []).join(" · "),
        csvGiorno(c.first_seen_at),
        csvGiorno(c.last_seen_at),
      ]
        .map(csvCell)
        .join(";"),
    );
  }

  // Il nome dice TUTTO il segmento (anche aperti/ordina, non solo tipo e
  // senza-ditta): chi riceve il file sa cosa contiene senza aprirlo — la
  // stessa filosofia dei tre rami in cima. I nomi dei segmenti esistenti
  // restano identici (le parti nuove si aggiungono solo se presenti).
  const segmento = [
    senzaDitta ? "aziende-senza-ditta" : null,
    tipo ? `tipo-${tipo === "nessuno" ? "da-classificare" : tipo}` : null,
    openOnly ? "aperti" : null,
    sort === "budget" ? "budget" : null,
  ]
    .filter(Boolean)
    .join("-");

  return csvResponse("\uFEFF" + lines.join("\n"), `clienti-${segmento || "tutti"}-${today}.csv`);
}
