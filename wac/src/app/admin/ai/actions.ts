"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { saveAutonomyConfig, saveDocument, deleteDocument, setProposalStatus } from "@/lib/ambrosio-server";
import type { AmbrosioLevel } from "@/lib/ambrosio-autonomy";

/**
 * SERVER ACTIONS DELLA SEZIONE AI (migration 028): autonomia, documenti,
 * proposte. Vivono qui e non nel actions.ts generale: è il confine di dominio
 * della sezione /admin/ai, dove tutto ciò che decide cosa può fare Ambrosio
 * resta raggiungibile e revisionabile in un solo posto.
 */

/* ── AUTONOMIA AMBROSIO: livello, mosse, take-over ───────────────── */

export async function saveAutonomyAction(formData: FormData) {
  const user = await requireAdmin();
  const level = Number(formData.get("level") ?? 1);
  if (![1, 2, 3].includes(level)) return;
  try {
    await saveAutonomyConfig({
      level: level as AmbrosioLevel,
      movesCap: formData.get("movesCap"),
      takeoverSla: String(formData.get("takeoverSla") ?? "") === "on",
      takeoverDocs: String(formData.get("takeoverDocs") ?? ""),
    });
    await logAudit(user.email, "ambrosio.autonomia", null, `livello ${level}`);
    revalidatePath("/admin/ai");
    revalidatePath("/admin/ai/autonomia");
    revalidatePath("/admin/operators");
  } catch (e) {
    console.error("[saveAutonomy]", e);
  }
}

/* ── DOCUMENTI AMBROSIO: la biblioteca che lo istruisce ──────────── */

export async function saveAiDocumentAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "") || undefined;
  try {
    await saveDocument({
      id,
      title: formData.get("title"),
      body: formData.get("body"),
      category: formData.get("category"),
      lang: formData.get("lang"),
      priority: formData.get("priority"),
      active: String(formData.get("active") ?? "") === "on",
    });
    await logAudit(user.email, id ? "ambrosio.doc-modifica" : "ambrosio.doc-crea", id ?? null, String(formData.get("title") ?? ""));
    revalidatePath("/admin/ai/documenti");
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[saveAiDocument]", e);
  }
}

export async function deleteAiDocumentAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deleteDocument(id);
    await logAudit(user.email, "ambrosio.doc-elimina", id);
    revalidatePath("/admin/ai/documenti");
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[deleteAiDocument]", e);
  }
}

/* ── PROPOSTE AMBROSIO: revisione umana della bozza (L3) ─────────── */

export async function setProposalStatusAction(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  try {
    await setProposalStatus(id, status);
    await logAudit(user.email, "ambrosio.proposta-stato", id, status);
    revalidatePath("/admin/ai/proposte");
    revalidatePath("/admin/ai");
  } catch (e) {
    console.error("[setProposalStatus]", e);
  }
}
