/**
 * CUORE PURO DELL'HERO ANIMATO — importabile dai componenti client
 * (nessun db). La lettura/persistenza sta in `hero.ts` (server-only),
 * sullo stesso taglio di theme-shared.ts / theme.ts.
 *
 * «Serissimo stile Apple»: niente particelle disordinate — scia di luce
 * sottile che segue il mouse, reveal in sequenza del titolo, caret che
 * scrive il placeholder, vetro con sheen. Tutto governato da token CSS
 * e spento sotto prefers-reduced-motion.
 */

import type { AbMode } from "./ab-shared";

export const HERO_KEY = "site_hero";

/** Gli 8 template proposti dall'admin (attivi: pubblicabili).
 *  I primi 4 sono i «serissimi» originali; i 4 nuovi portano grafica di
 *  nuova generazione (particelle, parallasse, dot-grid, aurora) sempre
 *  dentro le regole di casa: solo transform/opacity, zero layout thrash,
 *  pause fuori schermo e reduced-motion. */
export const HERO_TEMPLATES = [
  "spotlight",
  "caret",
  "lens",
  "gradient-flow",
  "particles",
  "parallax-orbit",
  "dot-grid",
  "aurora",
] as const;
export type HeroTemplate = (typeof HERO_TEMPLATES)[number];

/** I 5 temi del cursore (sezione dedicata in fondo all'editor).
 *  «glow» è la scia che c'è già: resta il default, i salvataggi vecchi
 *  senza il campo cursor degradano lì senza migration. «none» = cursore
 *  standard, nessun effetto (il toggle Statico dell'editor). */
export const HERO_CURSORS = ["glow", "lens", "comet", "elastic", "none"] as const;
export type HeroCursor = (typeof HERO_CURSORS)[number];

export const HERO_CURSOR_LABELS: Record<HeroCursor, string> = {
  glow: "Glow soffuso",
  lens: "Lente d'ingrandimento",
  comet: "Cometa",
  elastic: "Elastica",
  none: "Nessuno (statico)",
};

export const HERO_CURSOR_META: Record<
  HeroCursor,
  { name: string; sub: string; description: string }
> = {
  glow: {
    name: "Glow",
    sub: "Alone che segue",
    description:
      "Un alone di luce morbido segue il puntatore con inerzia: niente punto, solo la luce che accompagna il movimento.",
  },
  lens: {
    name: "Lens",
    sub: "Lente d'ingrandimento",
    description:
      "Una lente con manico segue il puntatore e si prensa sui pulsanti e link, come per leggere meglio: micro-dettaglio professionale.",
  },
  comet: {
    name: "Comet",
    sub: "Scia fluida",
    description:
      "Una cometa luminosa segue il puntatore con una scia che si allunga con la velocità e punta sempre nella direzione di volo.",
  },
  elastic: {
    name: "Elastic",
    sub: "Molla morbida",
    description:
      "Un punto elastico che resta indietro di un attimo e si stira nella direzione del movimento: fisica, non effetti.",
  },
  none: {
    name: "Nessuno",
    sub: "Puntatore standard",
    description:
      "Nessun effetto: il cursore resta quello del sistema, com'era prima dell'hero animato.",
  },
};

/** Font dei titoli (system-ui = Geist attuale; gli altri sono Google Fonts). */
export const HERO_FONTS = ["system", "inter", "manrope", "playfair"] as const;
export type HeroFont = (typeof HERO_FONTS)[number];

export const HERO_FONT_LABELS: Record<HeroFont, string> = {
  system: "Di sistema (Geist)",
  inter: "Inter",
  manrope: "Manrope",
  playfair: "Playfair Display",
};

/** Direzione della sfumatura animata del template gradient-flow. */
export const HERO_GRADIENT_DIRECTIONS = ["horizontal", "vertical", "diagonal"] as const;
export type HeroGradientDirection = (typeof HERO_GRADIENT_DIRECTIONS)[number];

export const HERO_GRADIENT_LABELS: Record<HeroGradientDirection, string> = {
  horizontal: "Orizzontale",
  vertical: "Verticale",
  diagonal: "Diagonale",
};

export interface HeroConfig {
  /** false = resta l'hero statico di oggi (default: nessun cambiamento). */
  enabled: boolean;
  template: HeroTemplate;
  eyebrow: string;
  title: string;
  /** Riga evidenziata col colore brand (seconda riga dell'attuale h1). */
  titleHighlight: string;
  subtitle: string;
  /** Placeholder della barra (animato a caret nei template che lo prevedono). */
  placeholder: string;
  /** Tema del cursore mentre l'hero è a schermo (default: la scia glow di oggi). */
  cursor: HeroCursor;
  /** Colore del cursore: hex #rrggbb, vuoto = token brand. */
  cursorAccent: string;
  font: HeroFont;
  /** Colore della riga evidenziata e degli accenti: hex #rrggbb, vuoto = token brand. */
  accent: string;
  gradient: HeroGradientDirection;
  /**
   * Test A/B (GA4): «on» = metà dei visitatori vede l'hero statico, l'altra
   * l'animato, con confronto diretto su search_start (dimensione hero_variant).
   * «off» = tutti vedono quello che dice `enabled` (comportamento pre-A/B).
   */
  abTest: AbMode;
}

export const DEFAULT_HERO: HeroConfig = {
  enabled: false,
  template: "spotlight",
  eyebrow: "Agenzia web con sede a Crema",
  title: "Cerchi una web agency a Crema?",
  titleHighlight: "Scrivilo nella barra, ti rispondiamo davvero.",
  subtitle:
    "Siti web in 7 giorni, e-commerce e SEO locale. Niente form da compilare: cerca, chatta in 4 domande e una persona vera ti richiama.",
  placeholder: "Cosa stai cercando? Es. «sito web per il mio ristorante»",
  font: "system",
  accent: "",
  gradient: "horizontal",
  cursor: "glow",
  cursorAccent: "",
  abTest: "off",
};

export const HERO_TEMPLATE_META: Record<
  HeroTemplate,
  { name: string; sub: string; description: string }
> = {
  particles: {
    name: "Particles",
    sub: "Costellazione viva",
    description:
      "Una trama di particelle che fluttua lentamente e si connette al puntatore con fili di luce: profondità senza rumore.",
  },
  "parallax-orbit": {
    name: "Parallasse",
    sub: "Orbite in profondità",
    description:
      "Tre strati di sfere luminose scorrono a velocità diverse col mouse e allo scroll: l'uno dietro l'altro, mai sul testo.",
  },
  "dot-grid": {
    name: "Dot grid",
    sub: "Griglia magnetica",
    description:
      "Una griglia di puntini che si accende e si solleva dove passa il cursore, come onde sulla sabbia.",
  },
  aurora: {
    name: "Aurora",
    sub: "Alba in movimento",
    description:
      "Bande di luce lentissime che si alternano dietro il titolo, come un'alba in time-lapse. Solo CSS, zero canvas.",
  },
  spotlight: {
    name: "Spotlight",
    sub: "Vetro sotto luce",
    description:
      "Il titolo entra con un bagliore che si sposta sulla superficie di vetro; la scia del mouse illumina il vetro attorno alla barra.",
  },
  caret: {
    name: "Caret",
    sub: "Si scrive da solo",
    description:
      "Il testo suggerito si scrive carattere per carattere nella barra, come se qualcuno stesse già cercando: invito immediato all'azione.",
  },
  lens: {
    name: "Lens",
    sub: "Anello attorno alla barra",
    description:
      "Un anello luminoso ruota attorno alla barra di ricerca e la scia del mouse la deforma leggermente, come una lente.",
  },
  "gradient-flow": {
    name: "Gradient flow",
    sub: "Sfumatura che scorre",
    description:
      "Il titolo è una sfumatura animata che scorre lentamente; sotto, la barra segue il mouse con un riflesso soffuso.",
  },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validHex(v: unknown): string | null {
  return typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : null;
}

function clampStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Normalizza un qualunque input (DB, form, restore) a HeroConfig valida:
 * mai lancia, tutto il resto del sito degrada ai default — stesso contratto
 * di getSiteTheme.
 */
export function sanitizeHeroConfig(raw: unknown): HeroConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_HERO };
  const r = raw as Partial<HeroConfig>;
  const template = HERO_TEMPLATES.includes(r.template as HeroTemplate)
    ? (r.template as HeroTemplate)
    : DEFAULT_HERO.template;
  const font = HERO_FONTS.includes(r.font as HeroFont) ? (r.font as HeroFont) : DEFAULT_HERO.font;
  const gradient = HERO_GRADIENT_DIRECTIONS.includes(r.gradient as HeroGradientDirection)
    ? (r.gradient as HeroGradientDirection)
    : DEFAULT_HERO.gradient;
  const cursor = HERO_CURSORS.includes(r.cursor as HeroCursor)
    ? (r.cursor as HeroCursor)
    : DEFAULT_HERO.cursor;
  return {
    enabled: r.enabled === true,
    template,
    eyebrow: clampStr(r.eyebrow, 90),
    title: clampStr(r.title, 120),
    titleHighlight: clampStr(r.titleHighlight, 160),
    subtitle: clampStr(r.subtitle, 280),
    placeholder: clampStr(r.placeholder, 90),
    font,
    accent: validHex(r.accent) ?? "",
    gradient,
    cursor,
    cursorAccent: validHex(r.cursorAccent) ?? "",
    abTest: r.abTest === "on" ? "on" : "off",
  };
}

/** Testi vuoti → default (l'utente può svuotare un campo e non rompere la pagina). */
export function heroWithFallbacks(c: HeroConfig): HeroConfig {
  const f = { ...c };
  if (!f.eyebrow) f.eyebrow = DEFAULT_HERO.eyebrow;
  if (!f.title) f.title = DEFAULT_HERO.title;
  if (!f.titleHighlight) f.titleHighlight = DEFAULT_HERO.titleHighlight;
  if (!f.subtitle) f.subtitle = DEFAULT_HERO.subtitle;
  if (!f.placeholder) f.placeholder = DEFAULT_HERO.placeholder;
  return f;
}

/**
 * Variabili CSS inline per l'hero (accento + delay di reveal).
 * Dal colore (accento o cursore) derivo anche le RGB grezze «senza funzione»
 * (--hero-accent-rgb / --hero-cursor-rgb): servono al CSS per scrivere
 * rgb(var(…) / 0.35) con qualunque alpha, senza duplicare la palette.
 */
export function heroVars(c: HeroConfig): Record<string, string> {
  const vars: Record<string, string> = { "--hero-delay": "0.15" };
  if (c.accent) vars["--hero-accent"] = hexToRgbTriplet(c.accent);
  if (c.cursorAccent) vars["--hero-cursor-rgb"] = hexToRgbTriplet(c.cursorAccent);
  return vars;
}

export function hexToRgbTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

/**
 * Stato dell'hero per la pill dell'hub Tools (stesso contratto di
 * themeStatus): attivo = verde «Attivo · <Template>»; spento = grigio
 * «Statico» — è il default DI PROPOSITO, non un'incompletezza. Con il
 * test A/B acceso lo stato dice esplicitamente «A/B» così chi guarda
 * l'hub sa che la home sta girando divisa in due.
 */
export function heroStatus(c: {
  enabled: boolean;
  template: HeroTemplate;
  abTest?: AbMode;
} | null): HubCardStatusLite {
  if (!c || (!c.enabled && c.abTest !== "on")) {
    return { key: "hero", ok: false, warn: false, label: "Statico", counts: [] };
  }
  if (c.abTest === "on") {
    const name = HERO_TEMPLATE_META[c.template]?.name ?? c.template;
    return { key: "hero", ok: true, warn: false, label: `A/B · ${name}`, counts: [] };
  }
  const name = HERO_TEMPLATE_META[c.template]?.name ?? c.template;
  return { key: "hero", ok: true, warn: false, label: `Attivo · ${name}`, counts: [] };
}

/** Tipo minimo dell'hub (evita l'import circolare con settings-status). */
export interface HubCardStatusLite {
  key: string;
  ok: boolean;
  warn: boolean;
  label: string;
  counts: { n: number; label: string }[];
}
