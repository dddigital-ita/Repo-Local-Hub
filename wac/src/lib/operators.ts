import fs from "node:fs";
import path from "node:path";
import { DEFAULT_OPERATORS, type Operator } from "./chat-script";
import { site } from "./site";

/**
 * Operatori: prima prova la tabella `operators` su Neon (editabile da /admin),
 * altrimenti le variabili OPERATOR_A / OPERATOR_B, altrimenti i default dello script.
 * Formato env: "Nome,+393331234567,9,13" (nome, telefono, inizio turno, fine turno [, whatsapp]).
 */
export function operatorsFromEnv(): Operator[] {
  const a = parseOperator("A", process.env.OPERATOR_A);
  const b = parseOperator("B", process.env.OPERATOR_B);
  const list = [a, b].filter(Boolean) as Operator[];
  return list.length ? list : DEFAULT_OPERATORS;
}

function parseOperator(id: string, raw?: string): Operator | null {
  if (!raw) return null;
  const [firstName, phone, start, end, whatsapp] = raw.split(",").map((s) => s?.trim());
  if (!firstName || !phone) return null;
  return {
    id,
    firstName,
    phone,
    whatsapp: whatsapp || undefined,
    shiftStart: Number(start ?? 9),
    shiftEnd: Number(end ?? 18),
    active: true,
  };
}

/** Ora locale in Italia per calcolare i turni server-side. */
export function nowInRome(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
}

export function isOnDuty(op: Operator, now: Date): boolean {
  if (!op.active) return false;
  const h = now.getHours();
  return op.shiftStart <= op.shiftEnd
    ? h >= op.shiftStart && h < op.shiftEnd
    : h >= op.shiftStart || h < op.shiftEnd;
}

export function onDutyOperator(ops: Operator[], now: Date): Operator | null {
  return ops.find((o) => isOnDuty(o, now)) ?? null;
}

export function whatsappLink(op: Operator): string {
  const num = (op.whatsapp ?? op.phone).replace(/\D/g, "");
  return `https://wa.me/${num}`;
}

// ── Card team per la UI (home + splash ricerca) ──────────────────────

export interface TeamCard {
  id: string;
  name: string;
  role: string;
  availability: string;
  photo: string | null; // /team/a.jpg se il file esiste
}

const ROLES: Record<string, string> = {
  A: "Progetti e preventivi",
  B: "SEO ed e-commerce",
};

function hh(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

function photoIfExists(opId: string): string | null {
  try {
    const file = opId === "A" ? "a.jpg" : opId === "B" ? "b.jpg" : `${opId}.jpg`;
    return fs.existsSync(path.join(process.cwd(), "public", "team", file))
      ? `/team/${file}`
      : null;
  } catch {
    return null;
  }
}

/**
 * Card del team VERO per la UI. Se gli operatori non sono ancora configurati
 * (env vuota) mostriamo una card generica onesta, mai nomi inventati.
 */
export function teamCards(): TeamCard[] {
  const envOps = [parseOperator("A", process.env.OPERATOR_A), parseOperator("B", process.env.OPERATOR_B)].filter(
    Boolean,
  ) as Operator[];

  if (envOps.length) {
    return envOps.map((o) => ({
      id: o.id,
      name: o.firstName,
      role: ROLES[o.id] ?? "Consulenza",
      availability: `Turno ${hh(o.shiftStart)}–${hh(o.shiftEnd)}`,
      photo: photoIfExists(o.id),
    }));
  }

  return [
    {
      id: "team",
      name: `Il team di ${site.name}`,
      role: "Ti risponde una persona vera",
      availability: "Lun–Ven · orario di ufficio",
      photo: null,
    },
  ];
}
