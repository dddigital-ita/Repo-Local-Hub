import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import { getGoogleToolsConfig } from "@/lib/google-tools";
import GoogleToolsPanel from "@/components/google-tools-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Google growth kit · Tools", robots: { index: false } };

export default async function GoogleToolPage({
  searchParams,
}: {
  searchParams: Promise<{ google_test?: string }>;
}) {
  await requireAdmin();
  const { google_test } = await searchParams;
  const google = await getGoogleToolsConfig();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/tools"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Tools
        </Link>
        <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <BarChart3 className="h-6 w-6 text-brand-600" aria-hidden />
          Google growth kit
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Misurazione, SEO e performance in un unico posto: GA4, Tag Manager, Search Console e PageSpeed.
        </p>
      </div>

      <Card>
        <GoogleToolsPanel config={google} testMessage={google_test} />
      </Card>
    </div>
  );
}
