import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "Informativa sul trattamento dei dati personali ai sensi del Regolamento UE 2016/679 (GDPR).",
  alternates: { canonical: "/privacy-policy" },
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. Titolare del trattamento",
    body: [
      `Il trattamento dei dati personali raccolti tramite questo sito è curato dal titolare: ${site.privacyController.name}, ${site.privacyController.address}.`,
      `Sito web: ${site.privacyController.website} — Email: ${site.privacyController.email}.`,
      `Questo sito (${site.legalName}) è «a branch by DDDigital»: per qualsiasi richiesta su privacy e dati personali il riferimento è il titolare qui sopra.`,
    ],
  },
  {
    title: "2. Quali dati trattiamo e perché",
    body: [
      "Attraverso la chat del sito raccogliamo esclusivamente i dati che decidi di inserire: nome, numero di telefono e le risposte alle domande di qualificazione (servizio richiesto, urgenza, budget indicativo).",
      "Finalità: ricontattarti per fornire le informazioni o il preventivo che hai richiesto. Base giuridica: il tuo consenso, espresso con la spunta nella chat prima dell'invio (art. 6.1.a GDPR).",
      "Nessun dato viene raccolto prima del consenso: la chat funziona anche senza inserire nulla, e il rifiuto non impedisce la navigazione.",
    ],
  },
  {
    title: "3. Cookie e misurazione",
    body: [
      "Usiamo cookie tecnici necessari al funzionamento del sito. Gli strumenti statistici (Google Analytics 4, Google Tag Manager) vengono attivati solo dopo il tuo consenso esperto tramite il banner: prima del consenso nessuno script di misurazione viene caricato.",
      "Dettagli nella Cookie policy.",
    ],
  },
  {
    title: "4. Dove conserviamo i dati",
    body: [
      "I dati della chat e dei lead sono conservati su Neon (database PostgreSQL ospitato nell'Unione Europea). Le notifiche email sono gestite tramite Resend. Entrambi i fornitori garantiscono misure adeguate ai sensi degli artt. 28 e 32 GDPR.",
    ],
  },
  {
    title: "5. Conservazione",
    body: [
      "Conserviamo i dati dei lead per 24 mesi dall'ultimo contatto utile, poi li cancelliamo. Puoi chiedere la cancellazione immediata in qualsiasi momento.",
    ],
  },
  {
    title: "6. I tuoi diritti",
    body: [
      "Puoi esercitare in ogni momento i diritti di accesso, rettifica, cancellazione, limitazione, portabilità e opposizione (artt. 15–22 GDPR) scrivendo al titolare del trattamento: " + site.privacyController.email + ".",
      "Hai inoltre il diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).",
    ],
  },
  {
    title: "7. Comunicazioni",
    body: [
      "Non vendiamo né cediamo i tuoi dati a terzi per finalità di marketing. I dati vengono mostrati esclusivamente agli operatori dell'agenzia che seguono la tua richiesta.",
    ],
  },
];

export default function PrivacyPolicyPage() {
  return (
    <main>
      <Container className="max-w-3xl py-14">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Privacy policy</h1>
        <p className="mt-2 text-sm text-slate-500">
          Informativa breve ai sensi dell&apos;art. 13 del Regolamento UE 2016/679 (GDPR).
        </p>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-bold text-slate-900">{s.title}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-2 text-[15px] leading-relaxed text-slate-700">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
        <p className="mt-12 text-xs text-slate-400">Ultimo aggiornamento: {new Date().toLocaleDateString("it-IT")}</p>
      </Container>
    </main>
  );
}
