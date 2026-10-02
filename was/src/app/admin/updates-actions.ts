"use server";

/**
 * AZIONI DELLO STRUMENTO AGGIORNAMENTI PER DOMINIO (decisione 2026-10-01,
 * docs/DECISIONE-UPDATES-BACKUP-2026-10-01.md §9). File separato da
 * actions.ts di proposito: il hub storico resta intatto e gemello-pari,
 * queste azioni nascono con lo strumento e viaggiano identiche nei repo.
 * L'export (locale/gemello) NON è un'azione: è una GET protetta in
 * /api/admin/updates-export/[dominio].
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import {
  anteprimaImport,
  confermaImport,
  creaReleaseLabel,
  ripristinaReleaseLabel,
  ripristinaSnapshot,
  salvaSnapshot,
  scartaImport,
} from "@/lib/domain-snapshots";
import { isDominioAttivo, labelDominio, type DominioId } from "@/lib/domain-snapshots-shared";

async function richiediAdmin() {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return user;
}

function torna(messaggio: string): never {
  redirect(`/admin/tools/backup?updates_msg=${encodeURIComponent(messaggio)}`);
}

/** "Salva snapshot adesso" di un dominio attivo (dedup interno sulla lib). */
export async function snapshotSalvaAction(formData: FormData) {
  const user = await richiediAdmin();
  const dominio = String(formData.get("dominio") ?? "");
  if (!isDominioAttivo(dominio)) return;
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 200);
  const esito = await salvaSnapshot(dominio as DominioId, user.email, nota);
  if (!esito.ok) torna(`ERRORE — snapshot ${labelDominio(dominio)}: ${esito.motivo ?? "?"}`);
  await logAudit(
    user.email,
    "updates.snapshot",
    dominio,
    esito.duplicato ? "invariato: identico al precedente" : `salvato${nota ? ` — ${nota}` : ""}`,
  );
  revalidatePath("/admin/tools/backup");
  torna(
    esito.duplicato
      ? `${labelDominio(dominio)}: nessun nuovo snapshot — lo stato è identico al precedente.`
      : `Snapshot di ${labelDominio(dominio)} salvato${nota ? ` — ${nota}` : ""}.`,
  );
}

/** Ripristino di un dominio allo snapshot scelto (conferma lato client). */
export async function snapshotRipristinaAction(formData: FormData) {
  const user = await richiediAdmin();
  const dominio = String(formData.get("dominio") ?? "");
  const takenAt = String(formData.get("takenAt") ?? "").trim();
  if (!isDominioAttivo(dominio) || !takenAt) return;
  const motivo = await ripristinaSnapshot(dominio as DominioId, takenAt);
  if (motivo) {
    await logAudit(user.email, "updates.ripristino-errore", dominio, motivo.slice(0, 200));
    torna(`ERRORE — ripristino ${labelDominio(dominio)}: ${motivo}`);
  }
  await logAudit(user.email, "updates.ripristino", dominio, `ripristino allo snapshot del ${takenAt}`);
  // Il tema e l'hero vivono nel root layout: invalida sito + admin.
  revalidatePath("/", "layout");
  revalidatePath("/admin/tools/backup");
  torna(`Ripristinato ${labelDominio(dominio)} allo snapshot del ${takenAt}.`);
}

/* ── FASE 2: import dall'export «per gemello» ── */

/**
 * ANTEPRIMA: legge il file caricato (input type=file), valida, calcola il
 * diff e lo stasha. NON scrive nulla: la conferma è un secondo gesto.
 */
export async function importAnteprimaAction(formData: FormData) {
  const user = await richiediAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) torna("ERRORE — nessun file selezionato per l'import.");
  if (file.size > 2 * 1024 * 1024) torna("ERRORE — file troppo grande (limite 2 MB): non sembra un export di dominio.");
  const raw = await file.text();
  const esito = await anteprimaImport(raw, user.email);
  if (!esito.ok) {
    await logAudit(user.email, "updates.import-errore", null, esito.errore.slice(0, 200));
    torna(`ERRORE — import rifiutato: ${esito.errore}`);
  }
  await logAudit(
    user.email,
    "updates.import-anteprima",
    esito.pending.dominio,
    `diff: ${esito.pending.righe.filter((r) => r.stato !== "uguale").length} righe cambiate`,
  );
  revalidatePath("/admin/tools/backup");
  // L'anteprima si mostra sulla pagina (pannello legge leggiImportPending).
}

/** CONFERMA: snapshot pre-import automatico + scrittura del payload mergiato. */
export async function importConfermaAction(formData: FormData) {
  const user = await richiediAdmin();
  const sha256 = String(formData.get("sha256") ?? "");
  const esito = await confermaImport(sha256, user.email);
  if (!esito.ok) {
    await logAudit(user.email, "updates.import-errore", null, (esito.motivo ?? "?").slice(0, 200));
    torna(`ERRORE — import non riuscito: ${esito.motivo}`);
  }
  await logAudit(user.email, "updates.import", null, `import confermato (sha ${sha256.slice(0, 8)})`);
  revalidatePath("/", "layout");
  revalidatePath("/admin/tools/backup");
  torna("Import applicato: snapshot pre-import salvato nello storico come rete di rollback.");
}

/** SCARTA l'anteprima senza scrivere nulla. */
export async function importScartaAction() {
  const user = await richiediAdmin();
  await scartaImport();
  await logAudit(user.email, "updates.import-scarta", null, "anteprima scartata");
  revalidatePath("/admin/tools/backup");
  torna("Import scartato: nessuna modifica applicata.");
}

/* ── FASE 3: etichette di release ── */

/** Crea un'etichetta di release: snapshot correnti di TUTTI i domini, raggruppati sotto un nome. */
export async function releaseCreaAction(formData: FormData) {
  const user = await richiediAdmin();
  const nome = String(formData.get("nome") ?? "");
  const nota = String(formData.get("nota") ?? "").trim().slice(0, 200);
  const esito = await creaReleaseLabel(nome, nota, user.email);
  if (!esito.ok) {
    await logAudit(user.email, "updates.release-errore", null, (esito.motivo ?? "?").slice(0, 200));
    torna(`ERRORE — etichetta di release: ${esito.motivo}`);
  }
  await logAudit(
    user.email,
    "updates.release",
    nome.trim(),
    `etichetta su ${esito.nDomini ?? "?"} domini${nota ? ` — ${nota}` : ""}`,
  );
  revalidatePath("/admin/tools/backup");
  torna(`Etichetta di release «${nome.trim()}» creata: snapshot correnti di tutti i domini raggruppati.`);
}

/** Ripristino coordinato: ogni dominio torna allo snapshot che l'etichetta congela (conferma lato client). */
export async function releaseRipristinaAction(formData: FormData) {
  const user = await richiediAdmin();
  const nome = String(formData.get("nome") ?? "").trim();
  const esito = await ripristinaReleaseLabel(nome);
  if (!esito.ok) {
    await logAudit(user.email, "updates.release-ripristino-errore", null, `${nome}: ${esito.motivo ?? "?"}`.slice(0, 200));
    torna(`ERRORE — ripristino coordinato «${nome}»: ${esito.motivo}`);
  }
  const resoconto = [
    esito.ripristinati.length ? `ripristinati: ${esito.ripristinati.join(", ")}` : "",
    esito.saltati.length ? `saltati: ${esito.saltati.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  await logAudit(user.email, "updates.release-ripristino", nome, resoconto.slice(0, 200));
  // I domini includono tema e hero (root layout): invalida sito + admin.
  revalidatePath("/", "layout");
  revalidatePath("/admin/tools/backup");
  torna(`Ripristino coordinato a «${nome}» completato. ${resoconto}`);
}
