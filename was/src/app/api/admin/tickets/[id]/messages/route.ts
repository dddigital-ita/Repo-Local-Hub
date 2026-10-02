import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Feed messaggi del ticket per il pannello admin (sessione richiesta).
 * Ritorna l'intera conversazione (visitatore + bot + operatore) con autore,
 * così il dettaglio resta aggiornato via polling senza rinfrescare la pagina.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { id: conversationId } = await ctx.params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const pool = db();
  if (!pool) return NextResponse.json({ ok: false }, { status: 503 });

  const { rows } = await pool.query<{
    id: string;
    sender: string;
    body: string;
    author: string | null;
    created_at: string;
  }>(
    "select id, sender, body, author, created_at from messages where conversation_id = $1 order by created_at",
    [conversationId],
  );
  return NextResponse.json({ ok: true, messages: rows });
}
