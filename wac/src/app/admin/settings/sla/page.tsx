import type { Metadata } from "next";
import { Timer } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import SlaPolicyEditor from "@/components/sla-policy-editor";
import { requireAdmin } from "@/lib/admin";
import { getSlaPolicy } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Policy SLA · Impostazioni", robots: { index: false } };

export default async function SlaPage() {
  await requireAdmin();
  const sla = await getSlaPolicy();

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Timer}
        title="Policy SLA per priorità"
        subtitle="Quante ore hanno gli agenti per rispondere al cliente e per risolvere il ticket, in base alla priorità. I badge «scade presto» e «in ritardo» nella lista ticket usano questi valori (il primo contatto resta a 2 ore)."
      />

      <Card>
        <SlaPolicyEditor initial={sla} />
      </Card>
    </div>
  );
}
