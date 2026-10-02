import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { GlassCard as Card, GlassNotice } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import { getHeroConfig } from "@/lib/hero";
import { db } from "@/lib/db";
import HeroEditor from "@/components/hero-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Hero animato · Tools", robots: { index: false } };

export default async function HeroToolPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAdmin();
  const { saved } = await searchParams;
  const hero = await getHeroConfig();
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
          <Sparkles className="h-6 w-6 text-brand-600" aria-hidden />
          Hero animato
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          L&apos;apertura «serissima stile Apple» della home: 4 template, testi e colori
          modificabili. Finché non è attivo, la home resta esattamente com&apos;è.
        </p>
      </div>

      {saved && (
        <GlassNotice tone="success">
          Hero salvato: la home pubblica si aggiorna entro pochi secondi (revalidate).
        </GlassNotice>
      )}

      <Card>
        <HeroEditor saved={hero} dbOk={dbOk} />
      </Card>
    </div>
  );
}
