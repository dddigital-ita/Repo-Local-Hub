import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import QuickRepliesEditor from "@/components/quick-replies-editor";
import { requireAdmin } from "@/lib/admin";
import { QUICK_REPLIES_DEFAULT, QUICK_REPLIES_MAX, getQuickReplies } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Risposte rapide · Impostazioni", robots: { index: false } };

export default async function QuickRepliesPage() {
  await requireAdmin();
  const replies = await getQuickReplies();
  const customized = replies.join("\n") !== QUICK_REPLIES_DEFAULT.join("\n");

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={MessagesSquare}
        title="Risposte rapide del ticketing"
        subtitle={`Frasi pronte che gli agenti cliccano invece di riscriverle, visibili sotto il campo risposta di ogni ticket. Una per riga, fino a ${QUICK_REPLIES_MAX}.`}
      />

      <Card>
        <QuickRepliesEditor initial={replies} />
        <p className="mt-3 text-xs text-slate-400">
          {customized
            ? "Set personalizzato: le modifiche valgono subito per tutti gli agenti."
            : "Stai usando le frasi predefinite: salvale per personalizzarle."}
        </p>
      </Card>
    </div>
  );
}
