import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  BookOpen,
  Bot,
  GraduationCap,
  LayoutGrid,
  MousePointerClick,
  type LucideIcon,
} from "lucide-react";
import { GlassCard as Card, GlassSectionHeader } from "@/components/glass";
import { HubCount } from "@/components/settings-hub";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manuale Operativo · Tools", robots: { index: false } };

/* ════════════════════════════════════════════════════════════════════
 * MANUALE OPERATIVO — la sezione di formazione dentro Tools.
 * Solo lettura: ogni voce spiega COSA FA e DOVE SI TROVA, con link
 * diretto alla scheda. Nessun dato live, nessun form: si legge, si
 * clicca, si torna. Il testo è volutamente SEMPLICE: frasi brevi,
 * niente gergo, la stessa voce del resto dell'admin.
 * ════════════════════════════════════════════════════════════════════ */

/** Un passo del manuale: titolo, spiegazione e link alla scheda reale. */
interface Passo {
  title: string;
  text: string;
  /** Link opzionale alla scheda operativa (deep link dalla voce). */
  href?: string;
  label?: string;
}

/** Blocco di istruzioni del manuale (un capitolo). */
interface Blocco {
  Icon: LucideIcon;
  title: string;
  intro: string;
  passi: Passo[];
}

const AMBROSIO: Blocco = {
  Icon: Bot,
  title: "Come si usa Ambrosio AI",
  intro:
    "Ambrosio è l'assistente AI dell'agenzia: risponde ai clienti quando il team è fuori turno — la notte, il weekend, nelle ore libere. Non sostituisce nessuno: tiene il posto finché una persona non rientra.",
  passi: [
    {
      title: "1 · Accendila una volta sola",
      text: "Apri la pagina Ambrosio · AI e guarda la riga di stato: se vedi «Disattivata», entra in Configurazione, metti la spunta Attiva e salva. Serve anche una chiave API salvata: senza, Ambrosio non può rispondere.",
      href: "/admin/ai/configurazione",
      label: "Configurazione",
    },
    {
      title: "2 · Instradala con i tre livelli",
      text: "Autonomia sceglie quanto Ambrosio può fare da sola. Livello 1: solo contatto. Livello 2: qualifica il cliente, poi passa la mano al team. Livello 3: gestisce anche il take-over dei ticket in ritardo e prepara una proposta con preventivo in bozza.",
      href: "/admin/ai/autonomia",
      label: "Autonomia",
    },
    {
      title: "3 · Istruzionala con i Documenti",
      text: "Le risposte ufficiali dell'agenzia — prezzi, garanzie, procedure — vanno scritte nei Documenti. Ambrosio non improvvisa: usa quei testi come verità. Un documento ben scritto vale cento risposte giuste.",
      href: "/admin/ai/documenti",
      label: "Documenti",
    },
    {
      title: "4 · Insegnale con l'Addestramento",
      text: "Ogni domanda vera di un cliente finisce nell'Addestramento: da lì la trasformi in risposta ufficiale (FAQ), anche con una bozza pronta da verificare. Più lo usi, più Ambrosio risponde come il team.",
      href: "/admin/ai/addestramento",
      label: "Addestramento",
    },
    {
      title: "5 · Provala senza rischi",
      text: "Prima di lasciarla sola con i clienti, fai una Prova dal vivo: scrivi una domanda come farebbe un cliente e leggi cosa risponde. Il test non tocca dati veri.",
      href: "/admin/ai/test",
      label: "Prova dal vivo",
    },
    {
      title: "6 · Tienila d'occhio ogni giorno",
      text: "La pagina Ambrosio · AI mostra le statistiche degli ultimi 30 giorni: conversazioni gestite, chat notturne, lead generati. Se una proposta è in attesa la trovi in Proposte: la revisione è sempre del team, prima di inviare.",
      href: "/admin/ai",
      label: "Ambrosio · AI",
    },
  ],
};

const SITO: Blocco = {
  Icon: LayoutGrid,
  title: "Come si usa il sito (admin)",
  intro:
    "L'admin segue una regola sola: una scheda = una pagina. Apri, regoli, chiudi. Tutto il resto — dove sta ogni cosa e in che ordine lavorare — viene da qui.",
  passi: [
    {
      title: "Panoramica — cosa succede oggi",
      text: "È la prima pagina che vedi: agenda del giorno, ticket in attesa, promesse da mantenere. Se qualcosa è in ritardo, qui lo vedi prima ancora di cercarlo.",
      href: "/admin",
      label: "Panoramica",
    },
    {
      title: "Gestione — il lavoro di ogni giorno",
      text: "Ticket per le conversazioni, Clienti per il portafoglio, Lead per i contatti da coltivare, Callback per le richiamate, Operatori per i turni, Pacchetti per il listino.",
      href: "/admin/tickets",
      label: "Ticket",
    },
    {
      title: "Ambrosio AI — l'assistente",
      text: "La sezione viola della nav: stato, statistiche e le sette schede di gestione (Autonomia, Documenti, Proposte, Addestramento…). Il capitolo 1 di questo manuale la spiega in dettaglio.",
      href: "/admin/ai",
      label: "Ambrosio · AI",
    },
    {
      title: "Impostazioni — come si comporta il sistema",
      text: "Risposte rapide, SLA, email, WhatsApp e Google growth kit (Impostazioni › Integrazioni): si toccano una volta e poi restano. Le trovi nella nav, sezione Impostazioni.",
      href: "/admin/settings",
      label: "Impostazioni",
    },
    {
      title: "Tools — le configurazioni grosse",
      text: "Tema grafico, Hero animato, Backup: cambiano tutto il sito, si usano raramente. Le pagine di sistema (Notion, SEO, Audit) stanno nella stessa pagina, più in basso.",
      href: "/admin/tools",
      label: "Tools",
    },
    {
      title: "Trova tutto con ⌘K (o Ctrl+K)",
      text: "Non ricordi dove sta una scheda? Premi ⌘K e scrivi una parola: «smtp», «faq», «tema». La palette apre direttamente la pagina giusta.",
      href: "/admin",
      label: "Prova ora",
    },
    {
      title: "Sicurezza e tracce",
      text: "Audit registra chi ha fatto cosa; Shield blocca gli abusi; Utenti gestisce account e ruoli; l'Area personale tiene i tuoi dati. Sono pagine di servizio: si aprono quando serve, non ogni giorno.",
      href: "/admin/audit",
      label: "Audit",
    },
  ],
};

/** Voce di glossario: parola tecnica → spiegazione da una riga. */
const GLOSSARIO: { term: string; def: string }[] = [
  { term: "SLA", def: "la finestra massima per rispondere a un ticket: superata, l'agenda te lo segnala." },
  { term: "Lead", def: "un contatto ancora da trasformare in cliente: temperatura e follow-up dicono quanto è caldo." },
  { term: "Callback", def: "una telefonata promessa a orario preciso, con slot e esito." },
  { term: "Handoff", def: "il passaggio di consegne: Ambrosio lascia la mano al team quando non sa o non può." },
  { term: "FAQ addestrate", def: "le risposte ufficiali scritte dal team: Ambrosio le usa invece di improvvisare." },
  { term: "Take-over", def: "quando Ambrosio prende in carico un ticket rimasto troppo a lungo senza risposta (solo Livello 3)." },
  { term: "Audit", def: "il registro di ogni azione fatta nell'admin: chi, cosa, quando." },
  { term: "Shield", def: "il scudo anti-abusi: blocca chi manda troppi messaggi o tenta accessi a raffica." },
];

export default async function ManualePage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      {/* ── Header di pagina (stesso pattern dell'hub Tools) ──────────── */}
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <GraduationCap className="h-6 w-6 text-brand-600" aria-hidden />
          Manuale Operativo
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          La formazione in due capitoli: come si usa Ambrosio AI e come si usa il sito. Frasi brevi, nessun gergo:
          se una voce non è chiara, il glossario in fondo risponde.
        </p>
      </div>

      {/* ── Indice rapido: i due capitoli ─────────────────────────────── */}
      <Card>
        <GlassSectionHeader
          icon={BookOpen}
          title="Indice"
          subtitle="Due capitoli, nessun prerequisito: si leggono in ordine o a salti."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            {
              Icon: Bot,
              tone: "bg-white/70 text-violet-600",
              title: "Capitolo 1 · Ambrosio AI",
              text: "Accenderla, istruirla, controllarla: il minimo per lasciarla lavorare con i clienti.",
              anchor: "cap-ambrosio",
            },
            {
              Icon: LayoutGrid,
              tone: "bg-white/70 text-brand-700",
              title: "Capitolo 2 · Il sito in generale",
              text: "Dove sta ogni cosa e in che ordine lavorare: Panoramica, Gestione, Impostazioni, Tools.",
              anchor: "cap-sito",
            },
          ].map(({ Icon, tone, title, text, anchor }) => (
            <a
              key={anchor}
              href={`#${anchor}`}
              className="group flex items-start gap-3 rounded-2xl bg-white/55 p-4 ring-1 ring-white/60 transition hover:bg-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-slate-900/5 ${tone}`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {title}
                  <ArrowDown
                    className="h-3.5 w-3.5 text-slate-400 transition group-hover:translate-y-0.5 group-hover:text-brand-600"
                    aria-hidden
                  />
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{text}</span>
              </span>
            </a>
          ))}
        </div>
      </Card>

      {/* ── Capitolo 1 · Ambrosio AI ──────────────────────────────────── */}
      <Card>
        <div id="cap-ambrosio" className="scroll-mt-24">
          <GlassSectionHeader
            icon={AMBROSIO.Icon}
            tone="bg-white/70 text-violet-600"
            title={`Capitolo 1 · ${AMBROSIO.title}`}
            subtitle={AMBROSIO.intro}
            right={<HubCount n={AMBROSIO.passi.length} label="passi" />}
          />
        </div>
        <ol className="mt-4 space-y-3">
          {AMBROSIO.passi.map(({ title, text, href, label }) => (
            <li key={title} className="rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {text}
                {href && (
                  <>
                    {" "}
                    <Link
                      href={href}
                      className="font-semibold text-violet-700 transition hover:text-violet-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                    >
                      Apri {label}
                    </Link>
                    .
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── Capitolo 2 · Il sito in generale ──────────────────────────── */}
      <Card>
        <div id="cap-sito" className="scroll-mt-24">
          <GlassSectionHeader
            icon={SITO.Icon}
            tone="bg-white/70 text-brand-700"
            title={`Capitolo 2 · ${SITO.title}`}
            subtitle={SITO.intro}
            right={<HubCount n={SITO.passi.length} label="voci" />}
          />
        </div>
        <ol className="mt-4 space-y-3">
          {SITO.passi.map(({ title, text, href, label }) => (
            <li key={title} className="rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
              <p className="text-sm font-semibold text-slate-900">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                {text}
                {href && (
                  <>
                    {" "}
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1 font-semibold text-brand-700 transition hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      Apri {label}
                      <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                    .
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── Glossario: la parola tecnica tradotta in italiano semplice ── */}
      <Card>
        <GlassSectionHeader
          icon={BookOpen}
          title="Glossario"
          subtitle="Le parole dell'admin, spiegate in una riga: nessuno nasce imparato."
        />
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {GLOSSARIO.map(({ term, def }) => (
            <div key={term} className="rounded-2xl bg-white/55 p-4 ring-1 ring-white/60">
              <dt className="text-sm font-bold text-slate-900">{term}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{def}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ── Nota di chiusura ──────────────────────────────────────────── */}
      <p className="px-1 text-[11px] leading-relaxed text-slate-500">
        Manuale di sola lettura: nessun pulsante salva qui. Le schede collegate restano le pagine ufficiali: se
        questa guida e una scheda non coincidono, fa fede la scheda.
      </p>
    </div>
  );
}
