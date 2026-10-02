import type { Metadata } from "next";
import Link from "next/link";
import Chat from "@/components/chat/Chat";
import { teamCards } from "@/lib/operators";
import { getChatEmojis } from "@/lib/tickets";
import { Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "Consulenza in chat col team",
  description:
    "Chatta col team: 4 domande da 10 secondi e ti richiamiamo con un preventivo vero.",
  robots: { index: false, follow: false },
};

export default async function ConsulenzaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  // Emoji del picker: set personalizzato dall'admin, default se il DB non c'è.
  const emojis = await getChatEmojis().catch(() => undefined);

  return (
    <main className="flex flex-1 flex-col md:py-10">
      <Container className="flex min-h-[70vh] flex-1 flex-col md:max-w-2xl">
        <div className="hidden md:flex items-center justify-between pb-4">
          <p className="text-sm font-semibold text-slate-900">Consulenza in chat</p>
          <Link href="/" className="text-sm text-brand-700 hover:underline">
            ← Torna al sito
          </Link>
        </div>
        <div className="glass-strong flex flex-1 flex-col overflow-hidden rounded-none md:rounded-3xl">
          {q ? (
            <Chat query={q} sourcePage="/" team={teamCards()} emojis={emojis} />
          ) : (
            <NoQuery />
          )}
        </div>
    </Container>
    </main>
  );
}

function NoQuery() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="text-lg font-medium text-slate-700">Dimmi cosa cerchi 👇</p>
      <p className="max-w-sm text-sm text-slate-500">
        Torna alla <Link href="/" className="text-brand-700 underline">home</Link> e usa la barra di
        ricerca: si apre la chat con la tua richiesta già scritta.
      </p>
    </div>
  );
}
