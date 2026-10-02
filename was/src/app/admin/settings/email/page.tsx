import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import EmailToolsPanel from "@/components/email-tools-panel";
import { requireAdmin } from "@/lib/admin";
import { getEmailToolsConfig } from "@/lib/email-tools";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Posta elettronica · Impostazioni", robots: { index: false } };

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email_test?: string }>;
}) {
  await requireAdmin();
  const { email_test } = await searchParams;
  const email = await getEmailToolsConfig();

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Mail}
        tone="text-blue-600"
        title="Posta elettronica"
        subtitle="Il canale email dell'agenzia: SMTP per inviare, IMAP per ricevere. Le email dei clienti diventano ticket."
      />

      <Card>
        <EmailToolsPanel config={email} testMessage={email_test} />
      </Card>
    </div>
  );
}
