import { GraduationCap } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { getAiFaqs, getAiSettings, getAiStats, getFaqUsageStats, rankFaqSuggestions } from "@/lib/ai";
import { getToolUsageStats } from "@/lib/ai-tools";
import AiFaqSection from "@/components/ai-faq-editor";
import FaqUsageTable from "@/components/ai-faq-usage";
import ToolUsageTable from "@/components/ai-tool-usage";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Addestramento · Ambrosio AI", robots: { index: false } };

export default async function AiTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; draft?: string; note?: string; faq_draft_error?: string }>;
}) {
  await requireAdmin();
  const ai = await getAiSettings();
  const stats = await getAiStats(30);
  const faqs = await getAiFaqs();
  const faqUsage = await getFaqUsageStats(30);
  const toolUsage = await getToolUsageStats(30);
  const { q, draft, note, faq_draft_error } = await searchParams;
  const suggestions = rankFaqSuggestions(stats.questionCounts, faqs);

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/ai"
        backLabel="Ambrosio · AI"
        Icon={GraduationCap}
        tone="text-violet-600"
        title="Cosa sa rispondere Ambrosio"
        subtitle="Le risposte ufficiali che Ambrosio usa al posto di improvvisare: prezzi veri, tempi, e l'invito a fissare l'appuntamento. Clicca una domanda vera per trasformarla in risposta vincente: entra nel prompt di sistema in automatico."
      />

      <section className="glass-solid rounded-3xl p-5">
        <AiFaqSection
          faqs={faqs}
          suggestions={suggestions}
          aiDraft={draft ? { q: q ?? "", draft, note } : null}
          draftError={faq_draft_error ?? null}
        />
        <FaqUsageTable rows={faqUsage} days={30} />
        <ToolUsageTable stats={toolUsage} />
      </section>

      {/* Il primario resta leggibile qui: la bozza AI parte dal provider attivo. */}
      <p className="px-1 text-xs text-slate-500">
        Le bozze AI usano il provider primario ({ai?.provider ?? "non configurato"}). Per cambiarlo:
        «Intelligenze multiple» dalla pagina di Ambrosio.
      </p>
    </div>
  );
}
