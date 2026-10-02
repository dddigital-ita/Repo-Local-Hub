import { NextResponse } from "next/server";
import { getSystemHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — stato del sistema (per monitoraggi uptime, niente dati sensibili).
 * La logica vive nel lettore condiviso `lib/health.ts`: la stessa verità è
 * mostrata anche nella scheda admin «Inventario» di Ambrosio, senza self-HTTP.
 */
export async function GET() {
  const health = await getSystemHealth();
  const ok = health.database !== "down";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      database: health.database,
      operatorsOnDuty: health.operatorsOnDuty,
      notify: health.notify,
      timestamp: health.timestamp,
    },
    { status: ok ? 200 : 503 },
  );
}
