/**
 * AUTONOMIA AMBROSIO — cuore PURO (zero import), il taglio del repo per i
 * layer testabili (come settings-status.ts e clients-shared.ts).
 *
 * 3 livelli di gestione attivabili che lasciano spazio all'umano:
 * - L1 CONTATTO: prende solo contatto e fissa richiamata in 4 domande;
 * - L2 QUALIFICA: risponde in automatico, max 4 mosse, poi passa al team;
 * - L3 PROPOSTA: autonomia completa: dopo lo scadere della SLA raccoglie le
 *   informazioni giuste e prepara una proposta scritta con preventivo.
 *
 * Le funzioni qui derivano il comportamento dagli INPUT (nessuna lettura
 * DB): la persistenza sta in ai_settings (migration 028), l'uso server in
 * ambrosio-server.ts, il test in tests/ambrosio-autonomy.test.mjs.
 */

export type AmbrosioLevel = 1 | 2 | 3;

export const AMBROSIO_LEVELS: readonly {
  level: AmbrosioLevel;
  key: "contatto" | "qualifica" | "proposta";
  name: string;
  tagline: string;
  tone: string;
}[] = [
  {
    level: 1,
    key: "contatto",
    name: "L1 · Contatto",
    tagline: "Prende contatto e fissa la richiamata in 4 domande: il resto lo fa il team.",
    tone: "bg-sky-50/90 text-sky-700 ring-1 ring-sky-200/70",
  },
  {
    level: 2,
    key: "qualifica",
    name: "L2 · Qualifica",
    tagline: "Risponde in automatico entro un tetto di mosse, poi passa al team.",
    tone: "bg-violet-50/90 text-violet-700 ring-1 ring-violet-200/70",
 },
  {
    level: 3,
    key: "proposta",
    name: "L3 · Proposta",
    tagline: "Autonomia completa: superata la SLA prepara una proposta con preventivo (in bozza, sempre revisionata dal team).",
    tone: "bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/70",
  },
];

/* ── Accessi (tool) per livello ───────────────────────────────────── */

export type AmbrosioAccess =
  | "salva_lead"
  | "fissa_callback"
  | "aggiorna_ticket"
  | "nota_interna"
  | "handoff"
  | "cerca_cliente"
  | "cerca_slot"
  | "prenota_appuntamento"
  | "prepara_proposta";

/** Descrizioni per la lista accessi mostrata in /admin/operators e /admin/ai/autonomia. */
export const ACCESS_LABELS: Record<AmbrosioAccess, string> = {
  salva_lead: "Salvare lead (nome, telefono, consenso esplicito)",
  fissa_callback: "Fissare richiamate (slot reali, dopo un sì esplicito)",
  aggiorna_ticket: "Alzare priorità ticket (mai abbassarla)",
  nota_interna: "Scrivere note interne per il team",
  handoff: "Passare il turno a una persona (con motivo e contesto)",
  cerca_cliente: "Consultare il portafoglio clienti (sola lettura)",
  cerca_slot: "Consultare gli slot liberi dell'agenda (sola lettura, Calendar Hub)",
  prenota_appuntamento: "Prenotare un appuntamento in agenda su uno slot libero (Calendar Hub)",
  prepara_proposta: "Preparare proposte con preventivo (bozza, sempre revisionata dal team)",
};

/**
 * LIVELLI → ACCESSI (chiusura per inclusione: un livello superiore ha SEMPRE
 * gli accessi del livello inferiore). L1 = nessun tool: prende contatto,
 * qualifica con le 4 domande e il consenso, fissa richiamata solo se il
 * cliente accetta — il gesto L1 ammesso è solo il MESAGGIO di chiusura che
 * la chat scriptata già fa (non serve un tool per promettere un richiamo).
 */
export function accessList(level: AmbrosioLevel): AmbrosioAccess[] {
  const l2: AmbrosioAccess[] = [
    "salva_lead",
    "fissa_callback",
    "aggiorna_ticket",
    "nota_interna",
    "handoff",
    "cerca_cliente",
    "cerca_slot",
  ];
  if (level === 1) return [];
  if (level === 2) return l2;
  return [...l2, "prepara_proposta"];
}

export function accessAllowed(level: AmbrosioLevel, fn: string): boolean {
  return (accessList(level) as string[]).includes(fn);
}

/* ── Tetto mosse (L2) e handoff forzato ───────────────────────────── */

export const MOVES_CAP_DEFAULT = 4;
export const MOVES_CAP_MIN = 2;
export const MOVES_CAP_MAX = 10;

/** Tetto mosse validato (default 4, min 2, max 10; assente = default). */
export function movesCapValidated(cap: unknown): number {
  // null/undefined/"" → assente (Number darebbe 0, che NON è un valore:
  // il default è 4, non il minimo). NaN e stringhe non numeriche idem.
  if (cap === null || cap === undefined || cap === "") return MOVES_CAP_DEFAULT;
  const n = Math.round(Number(cap));
  if (!Number.isFinite(n) || n <= 0) return MOVES_CAP_DEFAULT;
  return Math.min(MOVES_CAP_MAX, Math.max(MOVES_CAP_MIN, n));
}

/** Mosse fatte da Ambrosio nella conversazione: ogni risposta di bot conta 1. */
export function countMoves(answers: number): number {
  return Math.max(0, Math.round(Number(answers) || 0));
}

export interface MovesDecision {
  /** true = Ambrosio può ancora rispondere da solo. */
  allowed: boolean;
  /** Mosse fatte / tetto, per la pill «3/4 mosse». */
  used: number;
  cap: number;
  /** A tetto raggiunto: Ambrosio passa il turno (l'umano rientra). */
  handoff: boolean;
  reason: string;
}

/**
 * Regola del L2: dentro il tetto si risponde; al tetto si passa al team.
 * La mano all'umano è garantita anche L2: mai una chat che la AI tiene
 * chiusa all'infinito.
 */
export function movesDecision(answers: number, cap: unknown): MovesDecision {
  const used = countMoves(answers);
  const c = movesCapValidated(cap);
  const allowed = used < c;
  return {
    allowed,
    used,
    cap: c,
    handoff: !allowed,
    reason: allowed
      ? `mosse ${used + 1}/${c}`
      : `tetto mosse raggiunto (${used}/${c}): passaggio al team`,
  };
}

/* ── Blocchi prompt per livello ───────────────────────────────────── */

/** Regola operativa del livello (injected nel prompt di sistema). */
export function levelPromptBlock(level: AmbrosioLevel, cap: number): string {
  const c = movesCapValidated(cap);
  switch (level) {
    case 1:
      return `\n\n<livello>\nLIVELLO 1 · CONTATTO — il tuo unico obiettivo è aprire la conversazione e fissare una richiamata con una persona vera.
Fai AL MASSIMO 4 domande, UNA alla volta, e bastano per decidere:
1) il servizio richiesto (cosa deve fare il sito o il progetto);
2) i tempi (entro quando serve);
3) se esiste già un sito e come si chiama l'attività;
4) come raggiungerlo: nome e numero di telefono.
Dopo la quarta domanda (o prima, se il cliente li ha già dati): chiedi il CONSENSO esplicito alla richiamata («posso registrare i tuoi contatti per farti richiamare? Deve essere un tuo sì esplicito»).\nChiedi i contatti AL MASSIMO UNA volta per risposta: una sola domanda chiara su nome/telefono/consenso, mai ripetuta nello stesso messaggio — e non tornare a chiederli se il cliente li ha già dati.
Esempio di chiusura corretta: «Se ti va, lasciami nome e numero: posso registrarli per farti richiamare?» — UNA frase sola di richiesta, mai due.
Se il cliente non vuole essere richiamato ma continua a scrivere: resta in conversazione, non lasciarlo solo, prometti al massimo un richiamo nel prossimo turno.
Non dare preventivi, non promettere orari oltre gli slot, non descrivere procedure interne: al resto risponde il team al richiamo.
</livello>`;
    case 2:
      return `\n\n<livello>\nLIVELLO 2 · QUALIFICA — rispondi in automatico e risolvi in poche mosse: hai un tetto di ${c} risposte, poi la conversazione passa a una persona.
Usa le mosse per: rispondere alle domande con FAQ e catalogo ufficiale (pacchetti E servizi dell'agenzia, col nome esatto e il prezzo scritto nel catalogo), salvare il lead (sempre col consenso), fissare la richiamata (solo dopo un sì esplicito), alzare la priorità se l'urgenza è reale, scrivere la nota interna per il team.
Conta le tue risposte: a 2-3 mosse dovresti già avere nome, telefono e consenso; se il cliente continua a chiedere e le mosse stanno per finire, usa l'ultima per il CONSENSO e la richiamata, non per altro.
Chiedi i contatti AL MASSIMO UNA volta per risposta: una sola domanda chiara su nome/telefono/consenso, mai ripetuta nello stesso messaggio — e non tornare a chiederli se il cliente li ha già dati.
Esempio di chiusura corretta: «Se ti va, lasciami nome e numero: posso registrarli per farti richiamare?» — UNA frase sola di richiesta, mai due.
Non inventare ciò che non sai: meglio una richiamata vera che una risposta sbagliata.
</livello>`;
    default:
      return `\n\n<livello>\nLIVELLO 3 · PROPOSTA — autonomia completa: oltre a qualificare (tetto ${c} mosse come L2), quando la SLA di risposta è superata raccogli le informazioni giuste e prepari una PROPOSTA SCRITTA con preventivo.
Per la proposta ti servono: servizio, ambito (pagine/e-commerce/SEO), tempi, budget indicato, nome e telefono (col consenso). Se manca un dato, chiedilo PRIMA di scrivere la proposta.
Chiamando prepara_proposta la proposta nasce in BOZZA: non è un preventivo firmato e non è mai inviata da sola — la revisiona il team. Con il cliente: di' che prepari «una proposta scritta senza impegno», mai che è già un prezzo definitivo.
Superata la SLA: non aspettarti oltre — riassumi il caso, prepara la bozza e passa il turno.
</livello>`;
  }
}

/* ── Take-over SLA (L3) ───────────────────────────────────────────── */

/** Il take-over scatta solo a L3 e con lo switch attivo. */
export function takeoverEnabled(level: AmbrosioLevel, switchOn: boolean): boolean {
  return level === 3 && switchOn;
}

export interface TakeoverPromptContext {
  leadName: string | null;
  initialQuery: string | null;
  service: string | null;
  budget: string | null;
  urgency: string | null;
  language: string;
  /** Nome degli operatori del prossimo turno (per non promettere l'impossibile). */
  nextOperator: string | null;
}

/** Messaggio di Ambrosio nel thread quando prende in carico un ticket scaduto SLA. */
export function takeoverAnnouncement(ctx: TakeoverPromptContext): string {
  const who = ctx.nextOperator ? `${ctx.nextOperator} del team` : "il team";
  const name = ctx.leadName ? ` ${ctx.leadName}` : "";
  return (
    `Ciao${name}! Sono Ambrosio 😊 Vedo che la richiesta è rimasta in sospeso più del previsto: ` +
    `prendo io la mano. Per prepararle una proposta scritta e senza impegno mi servono pochi dettagli ` +
    `(servizio, tempi, budget indicato): se preferisce, ${who} può richiamarla al primo turno utile. ` +
    `Come preferisce procedere?`
  );
}

/** Blocco prompt del take-over (iniettato SOLO a L3 con switch attivo). */
export function takeoverPromptBlock(): string {
  return `\n\n<takeover>\nTAKE-OVER SLA: stai subentrando su un ticket che ha superato la finestra di risposta.
Obiettivo: in 2-3 domande al massimo, raccogli le informazioni giuste per la proposta (servizio, tempi, budget, contatti col consenso).
POI DEVI CHIAMARE il tool prepara_proposta: la proposta scritta con il preventivo esiste SOLO se il tool lo registra per il team — una proposta scritta solo in chat NON esiste per nessuno. Questo è il tuo compito finale, non saltarlo.
Non ripetere le domande a cui il cliente ha già risposto. Restare nel ruolo: niente promesse di prezzo definitivo, niente invii — la proposta resta una bozza per il team.
</takeover>`;
}

/* ── Documenti (istruzione) ───────────────────────────────────────── */

export type DocCategory = "operativo" | "commerciale" | "tecnico" | "procedura";

export const DOC_CATEGORIES: readonly { key: DocCategory; label: string }[] = [
  { key: "operativo", label: "Operativo" },
  { key: "commerciale", label: "Commerciale" },
  { key: "tecnico", label: "Tecnico" },
  { key: "procedura", label: "Procedura" },
];

export const DOC_LANGS = ["it", "en", "de", "fr", "es"] as const;
export type DocLang = (typeof DOC_LANGS)[number];

export const DOC_BODY_MAX = 8000;
export const DOC_TITLE_MAX = 150;

export interface SanitizedDoc {
  title: string;
  body: string;
  category: DocCategory;
  lang: DocLang;
  priority: number;
  active: boolean;
}

/** Sanitizza l'input di un documento: null = rifiuta (campi essenziali vuoti). */
export function sanitizeDoc(raw: {
  title?: unknown;
  body?: unknown;
  category?: unknown;
  lang?: unknown;
  priority?: unknown;
  active?: unknown;
}): SanitizedDoc | null {
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, DOC_TITLE_MAX) : "";
  const body = typeof raw.body === "string" ? raw.body.trim().slice(0, DOC_BODY_MAX) : "";
  if (!title || !body) return null;
  const cat = DOC_CATEGORIES.find((c) => c.key === raw.category)?.key ?? "operativo";
  const lang = (DOC_LANGS as readonly string[]).includes(raw.lang as DocLang) ? (raw.lang as DocLang) : "it";
  const pr = Math.round(Number(raw.priority));
  const priority = Number.isFinite(pr) ? Math.min(50, Math.max(1, pr)) : 10;
  const active = raw.active === undefined ? true : Boolean(raw.active);
  return { title, body, category: cat, lang, priority, active };
}

/** Formatta un documento per il prompt: L3 cita «secondo il documento X». */
export function docPromptLine(d: { title: string; body: string; lang: DocLang; category: string }): string {
  const cat = DOC_CATEGORIES.find((c) => c.key === d.category)?.label ?? "Operativo";
  return `◆ ${d.title} (${cat}, ${d.lang})\n${d.body}`;
}

/**
 * Blocco documenti per il prompt di sistema. La citazione «secondo il
 * documento X» è ammessa SOLO a L3: a L1/L2 la biblioteca resta interna
 * (il cliente non deve nominare pagine che non può leggere).
 */
export function docsPromptBlock(docs: { title: string; body: string; lang: DocLang; category: string }[], level: AmbrosioLevel): string {
  if (!docs.length) return "";
  const citation =
    level === 3
      ? "Quando usi una di queste informazioni, puoi citare la fonte con parole tue («come da nostro protocollo…»): sono materiali interni."
      : "Usa queste informazioni nella risposta ma NON nominarle come documenti interni né citarli per titolo.";
  return `\n\nDOCUMENTI INTERNI (usali come verità dell'agenzia in aggiunta alle FAQ):\n${citation}\n\n${docs.map(docPromptLine).join("\n\n")}`;
}

/* ── Proposte/preventivi (L3) ─────────────────────────────────────── */

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  draft: "Bozza",
  approved: "Approvata",
  sent: "Inviata",
  won: "Accettata",
  lost: "Persa",
};

export const PROPOSAL_TONE: Record<string, string> = {
  draft: "bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/70",
  approved: "bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/70",
  sent: "bg-sky-50/90 text-sky-700 ring-1 ring-sky-200/70",
  won: "bg-emerald-600/90 text-white ring-1 ring-emerald-700/70",
  lost: "bg-slate-100/80 text-slate-500 ring-1 ring-slate-200/70",
};

export const PROPOSAL_STATUSES = ["draft", "approved", "sent", "won", "lost"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_TITLE_MAX = 150;
export const PROPOSAL_BODY_MAX = 12000;

export interface ProposalItem {
  label: string;
  price: string;
}

/** Parser degli item proposti dal modello: massimo 8 righe, etichette corte. */
export function parseProposalItems(raw: unknown): ProposalItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalItem[] = [];
  for (const it of raw.slice(0, 8)) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    const rec = it as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim().slice(0, 80) : "";
    const price = typeof rec.price === "string" ? rec.price.trim().slice(0, 40) : "";
    if (label && price) out.push({ label, price });
  }
  return out;
}

/** Sanitizza il corpo di una proposta: i tag pericolosi sono neutralizzati. */
export function sanitizeProposalBody(body: string): string {
  return body
    .replace(/<\s*script/gi, "&lt;script")
    .replace(/<\s*\/\s*script/gi, "&lt;/script")
    .replace(/<\s*iframe/gi, "&lt;iframe")
    .replace(/<\s*img/gi, "&lt;img")
    .slice(0, PROPOSAL_BODY_MAX);
}

/** Parser del blocco <proposal>...</proposal> emesso da Ambrosio. */
export interface ParsedProposal {
  title: string;
  body: string;
  items: ProposalItem[];
}

export function parseProposalBlock(reply: string): { clean: string; proposal: ParsedProposal | null } {
  const m = reply.match(/<proposal>\s*([\s\S]*?)\s*<\/proposal>/);
  if (!m) return { clean: reply.trim(), proposal: null };
  const raw = m[1];
  const title = raw.match(/^TITOLO\s*=\s*(.+)$/im)?.[1]?.trim() ?? "";
  const itemsRaw: ProposalItem[] = [];
  for (const im of raw.matchAll(/^ITEM\s*=\s*(.+)$/gim)) {
    const [label, ...rest] = im[1].split("|");
    const price = rest.join("|").trim();
    if (label?.trim() && price) itemsRaw.push({ label: label.trim(), price });
  }
  const bodyStart = raw.search(/^TESTO\s*=/im);
  const body = bodyStart >= 0 ? raw.slice(raw.indexOf("=", bodyStart) + 1).trim() : raw.trim();
  const clean = reply.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim();
  if (!title || !body) return { clean, proposal: null };
  return {
    clean,
    proposal: { title: title.slice(0, PROPOSAL_TITLE_MAX), body: sanitizeProposalBody(body), items: parseProposalItems(itemsRaw) },
  };
}

/* ── Etichette per la card operatori ──────────────────────────────── */

/** Nome corto del livello (per la card in /admin/operators). */
export function levelLabel(level: AmbrosioLevel): string {
  return AMBROSIO_LEVELS.find((l) => l.level === level)?.name ?? "L1 · Contatto";
}
