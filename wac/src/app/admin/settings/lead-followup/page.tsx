import type { Metadata } from "next";
import { Timer } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import LeadFollowupForm from "@/components/lead-followup-form";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Follow-up lead · Impostazioni", robots: { index: false } };

export default async function LeadFollowupPage() {
  await requireAdmin();
  const pool = db();
  let followupHours: number | null = 48;
  if (pool) {
    try {
      const { rows } = await pool.query<{ value: unknown }>(
        "select value from content_settings where key = 'lead_followup_hours'",
      );
      const n = Number(rows[0]?.value);
      followupHours = Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      // tabella non ancora migrata: predisposizione senza errori
    }
  }

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Timer}
        tone="text-violet-600"
        title="Follow-up ai lead spariti (Ambrosio)"
        subtitle="Se un visitatore lascia i contatti e poi non scrive più, Ambrosio lascia UN solo messaggio nella chat che ritroverà riaprendo il widget: un gentile ricordo, senza pressione, con l'invito a farsi richiamare. Il messaggio parte solo fuori dai turni umani e mai se nel frattempo qualcuno ha già risposto."
      />

      <Card>
        <LeadFollowupForm initialHours={followupHours} />
      </Card>
    </div>
  );
}
