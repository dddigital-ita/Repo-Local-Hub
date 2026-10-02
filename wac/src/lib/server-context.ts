import {
  getCallbackSlots,
  getClosing,
  type ChatContext,
  type Operator,
} from "./chat-script";
import { onDutyOperator, operatorsFromEnv, whatsappLink } from "./operators";
import { db } from "./db";
import { site } from "./site";

/** Operatori dalla tabella `operators`, fallback env. */
export async function loadOperators(): Promise<Operator[]> {
  const pool = db();
  if (pool) {
    try {
      const { rows } = await pool.query<{
        id: string;
        first_name: string;
        phone: string;
        whatsapp: string | null;
        shift_start: number;
        shift_end: number;
        active: boolean;
        available_override: boolean | null;
      }>(
        "select id, first_name, phone, whatsapp, shift_start, shift_end, active, available_override from operators order by shift_start",
      );
      if (rows.length) {
        return rows.map((o) => ({
          id: o.id,
          firstName: o.first_name,
          phone: o.phone,
          whatsapp: o.whatsapp ?? undefined,
          shiftStart: o.shift_start,
          shiftEnd: o.shift_end,
          active: o.active && o.available_override !== false,
        }));
      }
    } catch (e) {
      console.error("[loadOperators]", e);
    }
  }
  return operatorsFromEnv();
}

export async function buildChatContext(query: string, now: Date): Promise<ChatContext> {
  const operators = await loadOperators();
  return {
    agencyName: site.name,
    query,
    operators,
    now,
    privacyUrl: "/privacy-policy",
    privacyEmail: site.privacyEmail,
  };
}

export { getClosing, getCallbackSlots, onDutyOperator, whatsappLink };
