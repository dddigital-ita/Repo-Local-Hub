import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import WhatsappReadyCard from "@/components/whatsapp-ready-card";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "WhatsApp Business · Impostazioni", robots: { index: false } };

export default async function WhatsappPage() {
  await requireAdmin();
  const pool = db();
  let waConfigured = false;
  let waEnabled = false;
  if (pool) {
    try {
      const wa = await pool.query<{ phone_number_id: string | null; waba_token_enc: string | null; enabled: boolean }>(
        "select phone_number_id, waba_token_enc, enabled from whatsapp_config where id = 1",
      );
      waConfigured = Boolean(wa.rows[0]?.phone_number_id && wa.rows[0]?.waba_token_enc);
      waEnabled = Boolean(wa.rows[0]?.enabled);
    } catch {
      // tabella non ancora migrata: predisposizione senza errori
    }
  }

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={MessageCircle}
        tone="text-emerald-600"
        title="WhatsApp Business (predisposto)"
        subtitle="Il quarto canale dell'agenzia: pronto nel codice, attivabile appena l'account Meta Cloud esiste."
      />

      <Card>
        <WhatsappReadyCard configured={waConfigured} enabled={waEnabled} />
      </Card>
    </div>
  );
}
