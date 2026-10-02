import {
  Activity,
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarClock,
  Construction,
  FileSearch,
  FileText,
  FlaskConical,
  Gauge,
  Globe,
  GraduationCap,
  KeyRound,
  Layers,
  Mail,
  MessageCircle,
  MessagesSquare,
  Package,
  Palette,
  PhoneCall,
  ScrollText,
  Settings2,
  ShieldCheck,
  Smile,
  Sparkles,
  Target,
  Ticket,
  Timer,
  TimerReset,
  UserCircle,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { integrationDestinations } from "@/lib/integrations-registry";

/**
 * Catalogo condiviso delle destinazioni rapide (command palette ⌘K): tutte
 * le schede di Tools, Impostazioni e Ambrosio più le aree della nav. Ogni
 * voce porta le KEYWORDS usate dal filtro fuzzy: anche «smtp», «faq» o
 * «autoclose» trovano la scheda giusta senza sapere come si chiama la pagina.
 */

export type AdminDestination = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Gruppo mostrato nella palette (e ordine di aggregazione). */
  group: "Panoramica" | "Gestione" | "Ambrosio AI" | "Impostazioni" | "Tools" | "Integrazioni" | "Sistema";
  /** Parole chiave extra per la ricerca ( italiano + tecnico). */
  keywords: string;
};

export const ADMIN_DESTINATIONS: AdminDestination[] = [
  // ── Panoramica + Gestione (nav quotidiana) ──────────────────────
  { href: "/admin", label: "Panoramica", Icon: Layers, group: "Panoramica", keywords: "home dashboard riepilogo oggi" },
  { href: "/admin/tickets", label: "Ticket", Icon: Ticket, group: "Gestione", keywords: "inbox conversazioni chat supporto" },
  { href: "/admin/clients", label: "Clienti", Icon: Briefcase, group: "Gestione", keywords: "portafoglio contatti anagrafica aziende" },
  { href: "/admin/leads", label: "Lead", Icon: Target, group: "Gestione", keywords: "contatti prospect temperatura recall" },
  { href: "/admin/callbacks", label: "Callback", Icon: PhoneCall, group: "Gestione", keywords: "richiamate telefonate esiti slot" },
  { href: "/admin/operators", label: "Operatori", Icon: Users, group: "Gestione", keywords: "turni team agenti disponibilità" },
  { href: "/admin/packages", label: "Pacchetti", Icon: Package, group: "Gestione", keywords: "prezzi listino offerte servizi" },

  // ── Ambrosio AI ──────────────────────────────────────────────────
  { href: "/admin/ai", label: "Ambrosio · AI", Icon: Sparkles, group: "Ambrosio AI", keywords: "bot assistente dashboard statistiche" },
  { href: "/admin/ai/autonomia", label: "Autonomia AI", Icon: Gauge, group: "Ambrosio AI", keywords: "livelli autonomia mosse take-over sla contatto qualifica proposta accessi" },
  { href: "/admin/ai/documenti", label: "Documenti AI", Icon: BookOpen, group: "Ambrosio AI", keywords: "documenti biblioteca istruzione procedure politiche conoscenza" },
  { href: "/admin/ai/proposte", label: "Proposte AI", Icon: FileText, group: "Ambrosio AI", keywords: "proposte preventivi bozze revisione offerte" },
  { href: "/admin/ai/addestramento", label: "Addestramento FAQ", Icon: GraduationCap, group: "Ambrosio AI", keywords: "faq risposte ufficiali domande bozze uso tool" },
  { href: "/admin/ai/configurazione", label: "Configurazione AI", Icon: Settings2, group: "Ambrosio AI", keywords: "prompt provider modello chiave api temperature attiva" },
  { href: "/admin/ai/provider", label: "Intelligenze multiple", Icon: KeyRound, group: "Ambrosio AI", keywords: "provider fallback chiavi primario openai anthropic custom" },
  { href: "/admin/ai/test", label: "Prova dal vivo", Icon: FlaskConical, group: "Ambrosio AI", keywords: "test domanda risposta simulazione" },
  { href: "/admin/ai/inventario", label: "Inventario AI", Icon: Activity, group: "Ambrosio AI", keywords: "inventario mappa funzioni salute stato moduli diagnostica health audit" },

  // ── Impostazioni ─────────────────────────────────────────────────
  { href: "/admin/settings", label: "Impostazioni", Icon: Settings2, group: "Impostazioni", keywords: "configurazioni hub schede" },
  { href: "/admin/settings/risposte-rapide", label: "Risposte rapide", Icon: MessagesSquare, group: "Impostazioni", keywords: "frasi pronte quick replies canned ticketing" },
  { href: "/admin/settings/emoji-chat", label: "Emoji della chat", Icon: Smile, group: "Impostazioni", keywords: "emoji emoticon smiley picker composer chat pubblica visitatore" },
  { href: "/admin/settings/sla", label: "Policy SLA", Icon: Timer, group: "Impostazioni", keywords: "sla priorità ore risposta risoluzione scadenze" },
  { href: "/admin/settings/chiusura-automatica", label: "Chiusura automatica", Icon: TimerReset, group: "Impostazioni", keywords: "autoclose cron ticket silenzio giorni" },
  { href: "/admin/settings/email", label: "Posta elettronica", Icon: Mail, group: "Impostazioni", keywords: "email smtp imap posta casella sincronizzazione canale" },
  { href: "/admin/settings/whatsapp", label: "WhatsApp Business", Icon: MessageCircle, group: "Impostazioni", keywords: "whatsapp meta cloud webhook predisposizione canale" },
  { href: "/admin/settings/cloudflare", label: "Cloudflare (Turnstile)", Icon: Globe, group: "Impostazioni", keywords: "cloudflare turnstile captcha invisibile bot anti-bot chiavi site secret protezione" },
  { href: "/admin/settings/lead-followup", label: "Follow-up lead", Icon: Timer, group: "Impostazioni", keywords: "followup ambrosio lead spariti ricordo ore" },

  // ── Tools + Sistema ──────────────────────────────────────────────
  { href: "/admin/profilo", label: "Area personale", Icon: UserCircle, group: "Sistema", keywords: "profilo area personale account dati anagrafici partita iva telefono indirizzo nome cognome" },
  { href: "/admin/utenti", label: "Utenti", Icon: UserCog, group: "Sistema", keywords: "utenti account team ruoli super admin permessi crea disattiva reset password" },
  { href: "/admin/tools", label: "Tools", Icon: Wrench, group: "Tools", keywords: "strumenti hub schede" },
  { href: "/admin/tools/theme", label: "Tema grafico", Icon: Palette, group: "Tools", keywords: "tema palette colori dark light aspetto brand" },
  { href: "/admin/tools/hero", label: "Hero animato", Icon: Sparkles, group: "Tools", keywords: "hero apertura home animazione template scia mouse barra ricerca testi" },
  { href: "/admin/tools/backup", label: "Backup e aggiornamenti", Icon: CalendarClock, group: "Tools", keywords: "export json ripristino versione next storico" },
  { href: "/admin/tools/manutenzione", label: "Modalità manutenzione", Icon: Construction, group: "Tools", keywords: "manutenzione manutenzione sito chiusura 503 pagina sostitutiva offline works in progress sos chiuso temporaneo" },
  { href: "/admin/tools/google", label: "Google growth kit", Icon: BarChart3, group: "Tools", keywords: "ga4 tag manager search console pagespeed analytics" },
  { href: "/admin/tools/manuale", label: "Manuale Operativo", Icon: GraduationCap, group: "Tools", keywords: "manuale operativo formazione guida manual istruzioni come si usa aiuto tutorial" },
  { href: "/admin/seo", label: "SEO", Icon: FileSearch, group: "Sistema", keywords: "meta landing redirect search console query" },
  { href: "/admin/shield", label: "Shield", Icon: ShieldCheck, group: "Sistema", keywords: "rate limiting ban sicurezza ip eventi" },
  { href: "/admin/audit", label: "Audit", Icon: ScrollText, group: "Sistema", keywords: "log registro azioni chi ha fatto cosa append-only" },
  { href: "/admin/sicurezza", label: "Sicurezza", Icon: ShieldCheck, group: "Sistema", keywords: "password sessioni logout account credenziali sicurezza" },

  // ── Integrazioni: DAL REGISTRO — una nuova integrazione (Drive,
  //    fatturazione…) arriva qui da sola, senza toccare questo file.
  ...integrationDestinations(),
];

/**
 * Filtro fuzzy semplice ma efficace: ogni parola della query deve comparire
 * in (label + keywords). «sla rap» trova «Policy SLA», «smtp» trova la
 * scheda email, «faq» l'addestramento. Case-insensitive, nessuna dipendenza.
 */
/**
 * Etichetta canonica di una destinazione: la stessa usata dalla palette.
 * Chi ha un href (chip della Panoramica, deep link futuri) non inventa nomi:
 * un solo catalogo dice come si chiama ogni scheda.
 */
export function destinationLabel(href: string): string {
  return ADMIN_DESTINATIONS.find((d) => d.href === href)?.label ?? href;
}

export function filterDestinations(query: string): AdminDestination[] {
  const q = query.trim().toLowerCase();
  if (!q) return ADMIN_DESTINATIONS;
  const words = q.split(/\s+/);
  return ADMIN_DESTINATIONS.filter((d) => {
    const haystack = `${d.label} ${d.group} ${d.keywords}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
