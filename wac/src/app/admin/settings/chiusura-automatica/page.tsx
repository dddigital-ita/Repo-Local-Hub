import type { Metadata } from "next";
import { TimerReset } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import AutoCloseForm from "@/components/auto-close-form";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chiusura automatica · Impostazioni", robots: { index: false } };

export default async function AutoClosePage() {
  await requireAdmin();
  const pool = db();
  let autoCloseDays = 0;
  if (pool) {
    try {
      const { rows } = await pool.query<{ value: unknown }>(
        "select value from content_settings where key = 'ticket_autoclose_days'",
      );
      autoCloseDays = Number(rows[0]?.value) || 0;
    } catch {
      // tabella non ancora migrata: predisposizione senza errori
    }
  }

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={TimerReset}
        title="Chiusura automatica (opzionale)"
        subtitle="Chiude in automatico i ticket «In attesa cliente» dopo N giorni di silenzio del cliente. Il cron la esegue e ogni chiusura finisce nell'audit come azione di sistema. Se il cliente risponde, la riapertura automatica riporta il ticket in coda."
      />

      <Card>
        <AutoCloseForm initialDays={autoCloseDays} />
      </Card>
    </div>
  );
}
