"use client";

import type { ComponentType, SVGProps } from "react";
import type { Icon as PhIcon, IconProps as PhIconProps } from "@phosphor-icons/react/dist/lib/types";
import { CheckIcon as PhCheck } from "@phosphor-icons/react/dist/csr/Check";
import { MinusIcon as PhMinus } from "@phosphor-icons/react/dist/csr/Minus";
import { WarningIcon as PhWarning } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon as PhX } from "@phosphor-icons/react/dist/csr/X";
import { CircleIcon as PhCircle } from "@phosphor-icons/react/dist/csr/Circle";
import { GlobeIcon as PhGlobe } from "@phosphor-icons/react/dist/csr/Globe";
import { ChatCircleIcon as PhChatCircle } from "@phosphor-icons/react/dist/csr/ChatCircle";
import { TargetIcon as PhTarget } from "@phosphor-icons/react/dist/csr/Target";
import { SunIcon as PhSun } from "@phosphor-icons/react/dist/csr/Sun";
import { MoonIcon as PhMoon } from "@phosphor-icons/react/dist/csr/Moon";
import { WifiHighIcon as PhWifiHigh } from "@phosphor-icons/react/dist/csr/WifiHigh";
import { ProhibitIcon as PhProhibit } from "@phosphor-icons/react/dist/csr/Prohibit";
import {
  IconBrandWhatsapp,
  IconBrandTelegram,
  IconCircleCheck,
  IconCircleX,
  IconCircleMinus,
  IconFlag,
} from "@tabler/icons-react";

/**
 * REGISTRY CENTRALE DELLE ICONE (Prompt «registry icone admin»).
 *
 * Due famiglie, due ruoli:
 * - Phosphor: icone «concetto» (stato, esito, canale) — tratto pieno, alta leggibilità a 10-14px;
 * - Tabler: icone «brand» e pillole di esito — tratto 2px coerente con lucide (già in uso).
 *
 * L'admin NON importa più le librerie direttamente e non usa glifi emoji
 * come icone: passa da qui, così cambiare famiglia (o pesi/dimensioni di
 * casa) è un edit in un file solo. Il registro espone solo icone semantiche
 * (cosa significa, non come si chiama nel pacchetto).
 *
 * ⚠️ Deep import Phosphor: il barrel del pacchetto esporta i .d.ts con
 * percorsi relativi SENZA estensione, che sotto `moduleResolution: NodeNext`
 * (tsconfig di casa) non risolvono — i membri sparirebbero dal typing.
 * I deep import passano dall'exports map `./dist/csr/*` del pacchetto,
 * che punta dritta al file tipizzato giusto. Il runtime è identico.
 *
 * TUTTE le icone ereditano currentColor e sono aria-hidden: il significato
 * sta nel testo accanto, mai nel glifo (accessibilità, come da convenzione
 * delle icone lucide già presenti).
 */

export type IconComponentType = ComponentType<{
  size?: string | number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

function phosphor(Icon: PhIcon, presetWeight?: PhIconProps["weight"]): IconComponentType {
  return function PhosphorIcon({ size, className, ...rest }) {
    return <Icon size={size ?? "1em"} weight={presetWeight} className={className} aria-hidden {...rest} />;
  };
}

/** Le props delle icone Tabler non sono esportate: il contratto utile è questo. */
type TablerIconComponent = ComponentType<{ size?: string | number; className?: string }>;

function tabler(Icon: TablerIconComponent): IconComponentType {
  return function TablerIcon({ size, className, ...rest }) {
    return <Icon size={size ?? "1em"} className={className} {...rest} />;
  };
}

/** Icone semantiche dell'admin: la chiave dice COSA comunica, non come. */
export const icons = {
  /** Esito positivo (accesso concesso, test ok, salvataggio riuscito). */
  check: phosphor(PhCheck),
  /** Esito positivo in pillola (cerchio pieno, micro-formato). */
  checkCircle: tabler(IconCircleCheck),
  /** Assenza/neutralità (accesso non concesso, livello non attivo). */
  minus: phosphor(PhMinus),
  minusCircle: tabler(IconCircleMinus),
  /** Errore (riga di log fallita, esito negativo in pillola). */
  x: phosphor(PhX),
  xCircle: tabler(IconCircleX),
  /** Avviso (riga di log di warning, attenzione). */
  warning: phosphor(PhWarning),
  /** Punto neutro (riga di log informativa, stato indifferente). */
  dot: phosphor(PhCircle),
  /** Punto attivo pieno (operatore in turno). */
  dotFilled: phosphor(PhCircle, "fill"),
  /** Bannato (shield: evento di ban). */
  ban: phosphor(PhProhibit),
  /** Lingua / traduzione / sito esterno (FAQ tradotte, sito web). */
  globe: phosphor(PhGlobe),
  /** Canale chat web. */
  chat: phosphor(PhChatCircle),
  /** Canale WhatsApp. */
  whatsapp: tabler(IconBrandWhatsapp),
  /** Canale Telegram. */
  telegram: tabler(IconBrandTelegram),
  /** Obiettivo centrato (tutte le keyword coperte, conferme positive). */
  target: phosphor(PhTarget),
  /** Modalità chiara. */
  sun: phosphor(PhSun),
  /** Modalità scura. */
  moon: phosphor(PhMoon),
  /** Connessione attiva (webhook Telegram configurato e verificato). */
  webhook: phosphor(PhWifiHigh),
  /** Bandiera (lingue del canale, team nazionali). */
  flag: tabler(IconFlag),
} satisfies Record<string, IconComponentType>;

export type IconName = keyof typeof icons;

/** Props comuni delle icone semantiche (dimensione e classe Tailwind). */
export type UiIconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  /** Dimensione in px (default 14, la misura di casa dell'admin). */
  size?: number;
  className?: string;
};

/**
 * Componente UI: <UiIcon name="check" />. Il significato resta leggibile
 * nel codice («name="ban"»), la famiglia grafica vive qui dentro.
 */
export function UiIcon({ name, size = 14, className }: UiIconProps) {
  const Icon = icons[name];
  return <Icon size={size} className={className} aria-hidden />;
}
