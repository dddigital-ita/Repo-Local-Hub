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
        subtitle={`Le emoticon che i visitatori vedono nel picker del composer della chat, nell'ordine scelto. Cercale nel catalogo o digitalle, riordinalo con le frecce: fino a ${CHAT_EMOJIS_MAX}.`}
      />

      <Card>
        <ChatEmojiEditor initial={emojis} max={CHAT_EMOJIS_MAX} defaultCount={CHAT_EMOJIS_DEFAULT.length} />
        <p className="mt-3 text-xs text-slate-400">
          {customized
            ? "Set personalizzato: vale subito per tutte le nuove chat."
            : "Stai usando il set predefinito: salvalo per personalizzarlo."}
        </p>
      </Card>
    </div>
  );
}
