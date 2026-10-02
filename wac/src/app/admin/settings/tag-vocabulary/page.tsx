import type { Metadata } from "next";
import { Tags } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import TicketTagVocabularyEditor from "@/components/ticket-tag-vocabulary-editor";
import { requireAdmin } from "@/lib/admin";
import { getTicketTagVocabulary } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Vocabolario dei tag · Impostazioni", robots: { index: false } };

export default async function TicketTagVocabularyPage() {
  await requireAdmin();
  const tags = await getTicketTagVocabulary();

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Tags}
        title="Vocabolario dei tag del ticketing"
        subtitle={`I tag suggeriti dalla datalist nell'editor dei tag di ogni ticket. Uno per riga, fino a 30: sono etichette, non frasi (max 30 caratteri ciascuno).`}
      />

      <Card>
        <TicketTagVocabularyEditor initial={tags} />
        <p className="mt-3 text-xs text-slate-400">
          Spazi e maiuscole sono normalizzati in automatico (es. «Preventivo
          immediato» diventa <code className="rounded bg-white/60 px-1">preventivo-immediato</code>):
          il vocabolario combacia sempre con i tag applicati ai ticket, così il
          filtro <code className="rounded bg-white/60 px-1">?tag=</code> della
          inbox trova tutto. A differenza delle risposte rapide non esistono tag
          predefiniti: con zero tag salvati gli agenti scrivono liberamente.
        </p>
      </Card>
    </div>
  );
}
