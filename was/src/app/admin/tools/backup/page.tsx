import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { listBackups, currentVersion, installedNextVersion, getBackupReminderDays } from "@/lib/maintenance";
import BackupPanel from "@/components/backup-panel";
import UpdatesDomainPanel from "@/components/updates-domain-panel";
import { listReleaseLabels, listSnapshots, leggiImportPending } from "@/lib/domain-snapshots";
import { DOMINI } from "@/lib/domain-snapshots-shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Backup e aggiornamenti · Tools", robots: { index: false } };

export default async function BackupToolPage({
  searchParams,
}: {
  searchParams: Promise<{
    backup_test?: string;
    backup_download?: string;
    version_test?: string;
    restore_error?: string;
    restore_done?: string;
    updates_msg?: string;
  }>;
}) {
  await requireAdmin();
  const { backup_test, backup_download, version_test, restore_error, restore_done, updates_msg } = await searchParams;
  const pool = db();
  const dbOk = Boolean(pool);
  const backups = dbOk ? await listBackups() : [];
  const reminderDays = await getBackupReminderDays();
  const appVersion = currentVersion();
  const nextVersion = installedNextVersion();

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
          <CalendarClock className="h-6 w-6 text-brand-600" aria-hidden />
          Backup e aggiornamenti
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Export JSON completo del database, storico, ripristino guidato e controllo versione: la repository di
          verità resta Neon, qui c&apos;è la storia e il gesto operativo.
        </p>
      </div>

      <Card>
        <BackupPanel
          backups={backups}
          dbOk={dbOk}
          appVersion={appVersion}
          nextVersion={nextVersion}
          reminderDays={reminderDays}
          versionMessage={version_test}
          backupMessage={backup_test}
          downloadId={backup_download}
          restoreError={restore_error}
          restoreDone={restore_done}
        />
      </Card>

      <Card>
        <UpdatesDomainPanel
          dbOk={dbOk}
          updatesMessage={updates_msg}
          pending={dbOk ? await leggiImportPending() : null}
          release={dbOk ? await listReleaseLabels() : []}
          storici={Object.fromEntries(
            await Promise.all(DOMINI.map(async (d) => [d.id, dbOk ? await listSnapshots(d.id) : []])),
          )}
        />
      </Card>
    </div>
  );
}
