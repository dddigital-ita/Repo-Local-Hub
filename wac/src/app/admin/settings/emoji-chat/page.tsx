import type { Metadata } from "next";
import { Smile } from "lucide-react";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";
import ChatEmojiEditor from "@/components/chat-emoji-editor";
import { requireAdmin } from "@/lib/admin";
import { CHAT_EMOJIS_DEFAULT, CHAT_EMOJIS_MAX, getChatEmojis } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Emoji della chat · Impostazioni", robots: { index: false } };

export default async function ChatEmojiPage() {
  await requireAdmin();
  const emojis = await getChatEmojis();
  const customized = emojis.join("\n") !== CHAT_EMOJIS_DEFAULT.join("\n");

  return (
    <div className="space-y-6">
      <SubPageHeader
        backHref="/admin/settings"
        backLabel="Impostazioni"
        Icon={Smile}
        title="Emoji della chat pubblica"
        subtitle={`Le emoticon del picker nel composer della chat pubblica: cercale nel catalogo in italiano, digitalle o riordinale con le frecce. La sequenza è il menu dei visitatori — fino a ${CHAT_EMOJIS_MAX}.`}
      />

      <Card>
        <ChatEmojiEditor initial={emojis} max={CHAT_EMOJIS_MAX} defaults={CHAT_EMOJIS_DEFAULT} />
        <p className="mt-3 text-xs text-slate-400">
          {`Il catalogo e il picker pubblico condividono una fonte sola: ogni emoji cercabile in italiano nel composer è nel catalogo, e viceversa. Ogni voce vale fino a 8 code point (le emoji composte con modificatore o ZWJ ne contano 3–4) e l'ordine delle righe è l'ordine del menu nel composer. Le modifiche valgono subito: la chat legge il set a ogni richiesta. Con zero emoji salvate il picker torna sulle ${CHAT_EMOJIS_DEFAULT.length} predefinite. ${
            customized
              ? "Set personalizzato attivo."
              : "Stai usando il set predefinito: salvalo per personalizzarlo."
          }`}
        </p>
      </Card>
    </div>
  );
}
