import { BarChart3, CalendarClock, CalendarDays, Cloud, FolderSync, NotebookPen, type LucideIcon } from "lucide-react";

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
    href: "/admin/settings/google",
    label: "Google growth kit",
    Icon: BarChart3,
    tone: "bg-white/70 text-blue-600",
    text: "Le quattro skill Google in una pagina: recensioni, Analytics 4, Workspace e SEO (Search Console, PageSpeed, CrUX), più la configurazione dei tag.",
    keywords: "google ga4 analytics tag manager search console pagespeed recensioni reviews workspace crux integrazione",
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
  {
    key: "onedrive",
    href: "/admin/settings/onedrive",
    label: "OneDrive",
    Icon: Cloud,
    tone: "bg-white/70 text-sky-600",
    text: "Libreria documenti Microsoft via Graph API (app Entra ID): qui finiranno foto, documenti e pratiche cliente.",
    keywords: "microsoft onedrive sharepoint graph file documenti upload azure app integrazione",
  },
  {
    key: "ical",
    href: "/admin/calendario",
    label: "iCal",
    Icon: CalendarDays,
    tone: "bg-white/70 text-violet-600",
    text: "Sorgenti iCal (calendari esterni del team) in pull e feed .ics in abbonamento: un solo tempo dell'agenzia.",
    keywords: "ical icalendar feed calendario sorgenti import sync sincronizzazione abbonamento integrazione",
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
