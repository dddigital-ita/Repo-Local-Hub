import { BarChart3, CalendarClock, FolderSync, NotebookPen, type LucideIcon } from "lucide-react";

/**
 * REGISTRO DELLE INTEGRAZIONI — defs pure (niente DB, niente "use server"):
 * aggiungere un'integrazione (Google Drive, fatturazione, zapier…) significa
 * aggiungere UNA riga qui e un reader di stato in `integrations-status.ts`.
 * L'hub Impostazioni sezione «Integrazioni» e la command palette si popolano
 * da sole, senza toccare UI.
 */

export type IntegrationDef = {
  /** Slug usato per abbinare def ↔ stato del reader. */
  key: string;
  href: string;
  label: string;
  Icon: LucideIcon;
  tone: string;
  text: string;
  keywords: string;
};

export const INTEGRATION_DEFS: IntegrationDef[] = [
  {
    key: "notion",
    href: "/admin/notion",
    label: "Notion",
    Icon: NotebookPen,
    tone: "bg-white/70 text-slate-800",
    text: "Lead e schede cliente sincronizzati nel workspace Notion: integrazione, mapping proprietà e coda di sync.",
    keywords: "sync sincronizzazione workspace lead integrazione notion",
  },
  {
    key: "gcal",
    href: "/admin/settings/google-calendar",
    label: "Google Calendar",
    Icon: CalendarClock,
    tone: "bg-white/70 text-blue-600",
    text: "Appuntamenti dell'agenzia (team e Ambrosio AI) sincronizzati su Google Calendar, con mirror opzionale su Notion.",
    keywords: "google calendar appuntamenti eventi callback sincronizzazione integrazione agenzia",
  },
  {
    key: "google",
    href: "/admin/tools/google",
    label: "Google growth kit",
    Icon: BarChart3,
    tone: "bg-white/70 text-blue-600",
    text: "GA4, Tag Manager, Search Console e PageSpeed collegati al sito: misura, SEO e performance.",
    keywords: "google ga4 analytics tag manager search console pagespeed integrazione",
  },
  {
    key: "drive",
    href: "/admin/settings/drive",
    label: "Google Drive",
    Icon: FolderSync,
    tone: "bg-white/70 text-emerald-600",
    text: "Cartella Drive condivisa via account di servizio: qui finiranno foto, documenti e pratiche cliente.",
    keywords: "google drive cartella file foto documenti upload service account integrazione",
  },
];

/** Le integrazioni come destinazioni della command palette (gruppo dedicato). */
export function integrationDestinations(): {
  href: string;
  label: string;
  Icon: LucideIcon;
  group: "Integrazioni";
  keywords: string;
}[] {
  return INTEGRATION_DEFS.map((d) => ({
    href: d.href,
    label: d.label,
    Icon: d.Icon,
    group: "Integrazioni" as const,
    keywords: d.keywords,
  }));
}
