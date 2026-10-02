import type { Metadata } from "next";
import { Send } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import TelegramPanel from "@/components/telegram-panel";
import { requireAdmin } from "@/lib/admin";
import { getTelegramConfigView } from "@/lib/telegram-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Telegram · Impostazioni", robots: { index: false } };

export default async function TelegramPage({
  searchParams,
}: {
  searchParams: Promise<{ telegram_test?: string }>;
}) {
  await requireAdmin();
  const { telegram_test } = await searchParams;
  const config = await getTelegramConfigView();

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Send}
        tone="text-sky-600"
        title="Telegram"
        subtitle="Il canale dove Ambrosio parla con i clienti fuori turno e il team riceve notifiche e digest. Token e segreti cifrati nel database."
      />

      <Card>
        <TelegramPanel config={config} testMessage={telegram_test} />
      </Card>
    </div>
  );
}
