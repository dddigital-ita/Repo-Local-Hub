import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import AppleToggle from "@/components/toggle";
import OperatorShiftEditor from "@/components/operator-tools";
import { Phone, Clock3, Bot, ShieldCheck } from "lucide-react";
import { UiIcon } from "@/components/icon-registry";
import { nowInRome, onDutyOperator, operatorsFromEnv } from "@/lib/operators";
import { GlassCard as Card } from "@/components/glass";
import { getAutonomyConfig } from "@/lib/ambrosio-server";
import { AMBROSIO_LEVELS, ACCESS_LABELS, accessList } from "@/lib/ambrosio-autonomy";
import Link from "next/link";

export const dynamic = "force-dynamic";

function hh(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

export default async function OperatorsPage() {
  await requireAdmin();
  const pool = db();
  const now = nowInRome();

  let display: {
    id: string;
    name: string;
    phone: string;
    shiftStart: number;
    shiftEnd: number;
    active: boolean;
    override: boolean | null;
    fromDb: boolean;
  }[] = [];

  if (pool) {
    try {
      const { rows } = await pool.query<{
        id: string;
        first_name: string;
        phone: string;
        shift_start: number;
        shift_end: number;
        active: boolean;
        available_override: boolean | null;
      }>("select * from operators order by shift_start");
      display = rows.map((r) => ({
        id: r.id,
        name: r.first_name,
        phone: r.phone,
        shiftStart: r.shift_start,
        shiftEnd: r.shift_end,
        active: r.active,
        override: r.available_override,
        fromDb: true,
      }));
    } catch {
      /* tabella non ancora creata */
    }
  }

  if (!display.length) {
    display = operatorsFromEnv().map((o) => ({
      id: o.id,
      name: o.firstName,
      phone: o.phone,
      shiftStart: o.shiftStart,
      shiftEnd: o.shiftEnd,
      active: o.active,
      override: null,
      fromDb: false,
    }));
  }

  const onDuty = onDutyOperator(
    display.map((d) => ({
      id: d.id,
      firstName: d.name,
      phone: d.phone,
      whatsapp: undefined,
      shiftStart: d.shiftStart,
      shiftEnd: d.shiftEnd,
      active: d.active && d.override !== false,
    })),
    now,
  );

  // AMBROSIO tra gli operatori: livello attivo + lista accessi (il catalogo
  // è lo stesso della scheda Autonomia — un solo posto decide cosa può fare).
  let ambrosio: { level: number; movesCap: number; takeoverSla: boolean; docs: string | null } | null = null;
  try {
    const cfg = await getAutonomyConfig();
    ambrosio = { level: cfg.level, movesCap: cfg.movesCap, takeoverSla: cfg.takeoverSla, docs: cfg.takeoverDocs };
  } catch {
    ambrosio = null;
  }
  const ambLevel = AMBROSIO_LEVELS.find((l) => l.level === (ambrosio?.level ?? 1)) ?? AMBROSIO_LEVELS[0];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-900">Operatori e turni</h1>
      <p className="text-sm text-slate-500">
        Ora a Roma: {now.toLocaleTimeString("it-IT")} ·{" "}
        {onDuty ? (
          <span className="inline-flex items-center gap-1 text-green-600">
            <UiIcon name="checkCircle" size={12} />
            {onDuty.firstName} è in turno
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-red-600">
            <UiIcon name="xCircle" size={12} />
            nessuno in turno
          </span>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {display.map((o) => {
          const isOnDuty = onDuty?.id === o.id;
          return (
            <Card key={o.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {o.name}{" "}
                    {isOnDuty && (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <UiIcon name="dotFilled" size={11} />
                        in turno
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
                    <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    {o.phone}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock3 className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    {o.fromDb ? (
                      <OperatorShiftEditor operatorId={o.id} start={o.shiftStart} end={o.shiftEnd} />
                    ) : (
                      <span>Turno {hh(o.shiftStart)}–{hh(o.shiftEnd)}</span>
                    )}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-xs">
                    <a
                      href={`https://wa.me/${o.phone.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:underline"
                    >
                      WhatsApp
                    </a>
                  </p>
                </div>
                {o.fromDb ? (
                  <AppleToggle
                    id={o.id}
                    on={o.override !== false && o.active}
                    label={`Disponibilità di ${o.name}`}
                  />
                ) : (
                  <span className="rounded-full bg-slate-100/90 px-3 py-1.5 text-xs text-slate-500 backdrop-blur-xl">da env</span>
                )}
              </div>
              {o.override === false && (
                <p className="mt-2 text-xs text-amber-600">
                  Disponibilità tolta a mano: la chat lo tratta come fuori turno anche nell&apos;orario.
                </p>
              )}
            </Card>
          );
        })}
      </div>
      {/* ── Card AMBROSIO (operatore AI) ── */}
      {ambrosio && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Bot className="h-4 w-4 text-violet-600" aria-hidden />
                Ambrosio <span className="text-slate-400">· operatore AI</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Copre i turni scoperti quando nessun umano è in turno. {ambLevel.tagline}
              </p>
              <p className="mt-2 flex items-center gap-2 text-xs">
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${ambLevel.tone}`}>
                  {ambLevel.name}
                </span>
                {ambrosio.takeoverSla && ambrosio.level === 3 && (
                  <span className="rounded-full bg-emerald-50/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/70">
                    Take-over SLA attivo
                  </span>
                )}
              </p>
              <details className="mt-2">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  Accessi di Ambrosio ({accessList(ambrosio.level as 1 | 2 | 3).length})
                </summary>
                <ul className="mt-2 space-y-1 border-l-2 border-violet-100 pl-3">
                  {Object.entries(ACCESS_LABELS).map(([fn, label]) => {
                    const allowed = accessList(ambrosio!.level as 1 | 2 | 3).some((x) => x === fn);
                    return (
                      <li key={fn} className="flex items-center gap-2 text-xs">
                        <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${allowed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`} aria-hidden>
                          <UiIcon name={allowed ? "check" : "minus"} size={9} />
                        </span>
                        <span className={allowed ? "text-slate-700" : "text-slate-400"}>{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </details>
              <p className="mt-2 text-xs text-slate-500">
                Configura livello e accessi in{" "}
                <Link href="/admin/ai/autonomia" className="font-medium text-violet-600 hover:underline">
                  Autonomia AI
                </Link>{" "}
                · Istruzionalo in{" "}
                <Link href="/admin/ai/documenti" className="font-medium text-violet-600 hover:underline">
                  Documenti
                </Link>
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-violet-50/90 px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200/70">24/7</span>
          </div>
        </Card>
      )}

      <p className="text-xs text-slate-400">
        Turni e nomi si modificano nella tabella <code>operators</code> su Neon (o nelle env
        OPERATOR_A / OPERATOR_B se il database non è collegato).
      </p>
    </div>
  );
}
