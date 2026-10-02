import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Palette } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import { getSiteTheme } from "@/lib/theme";
import { db } from "@/lib/db";
import ThemeEditor from "@/components/theme-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tema grafico · Tools", robots: { index: false } };

export default async function ThemeToolPage() {
  await requireAdmin();
  const theme = await getSiteTheme();
  const dbOk = Boolean(db());

  return (
    <div className="space-y-6">
      {/* ── Header di pagina scheda: back-link verso l'hub + titolo ── */}
      <div>
        <Link
          href="/admin/tools"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Tools
        </Link>
        <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <Palette className="h-6 w-6 text-brand-600" aria-hidden />
          Tema grafico
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Aspetto di TUTTO il sito (pagine pubbliche + admin). L&apos;anteprima è live ma non persistente: premi
          «Salva tema» per applicarla a tutti.
        </p>
      </div>

      <Card>
        <ThemeEditor saved={theme} dbOk={dbOk} />
      </Card>
    </div>
  );
}
