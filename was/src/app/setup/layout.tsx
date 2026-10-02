import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Installazione",
  robots: { index: false, follow: false },
};

/**
 * Guard del wizard: quando il lock di completamento esiste (file o riga su
 * DB) la rotta /setup smette di esistere — 404 per chiunque, anche chi ha
 * fatto l'installazione. Il wizard è una corsa unica, come l'installer di
 * WordPress che dopo il setup chiede di cancellare la cartella install/.
 */
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const state = await setupState();
  if (state === "completed") notFound();
  return <>{children}</>;
}
