"use client";

import { useState } from "react";
import { Bot, KeyRound, LoaderCircle, Save, Send, Users } from "lucide-react";
import { GlassBadge, GlassButton, GlassSectionHeader } from "@/components/glass";
import { saveTelegramConfigAction, testTelegramAction, detectTelegramChatsAction } from "@/app/admin/settings/telegram/actions";
import type { TelegramConfigView } from "@/lib/telegram-config";

const inputCls =
  "mt-1 w-full rounded-2xl border border-white/70 bg-white/65 px-3 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-brand-400 focus:bg-white";

export default function TelegramPanel({ config, testMessage }: { config: TelegramConfigView; testMessage?: string }) {
  const [saving, setSaving] = useState(false);
  const connected = Boolean(config.hasToken && config.teamChatIds.length > 0);

  return (
    <div className="space-y-4">
      <GlassSectionHeader
        icon={Bot}
        title="Canale Telegram"
        subtitle="Token del bot, chat del team e secret del webhook: la configurazione vive nel database, cifrata."
        right={
          <GlassBadge className="px-3 py-1.5 font-semibold ring-1 ring-brand-100 text-brand-700 glass-badge-brand">
            {connected ? "Canale collegato" : "Da collegare"}
          </GlassBadge>
        }
      />

      {testMessage && (
        <div
          className={`rounded-2xl px-3.5 py-3 text-sm font-medium ring-1 ${
            testMessage.startsWith("Messaggio di prova inviato") || testMessage.includes("salvata")
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {testMessage}
        </div>
      )}

      {config.fromDb ? null : (
        <div className="rounded-2xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
          Attualmente il canale usa le <strong>variabili d&apos;ambiente</strong> (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).
          Salvando qui sotto la configurazione passa al database: l&apos;env resta come ripiego se la scheda viene disattivata.
        </div>
      )}

      {/* Configurazione: token, chat, secret */}
      <form
        action={saveTelegramConfigAction}
        onSubmit={() => setSaving(true)}
        className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <Bot className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Configurazione bot</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Token e secret vengono <strong>cifrati</strong> e non vengono mai mostrati per intero. Lascia vuoto un
              segreto per conservare quello salvato.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
            Token del bot{" "}
            <span className="font-normal text-slate-400">
              {config.tokenHint ? `· salvato ${config.tokenHint}, lascia vuoto per conservare` : "(da @BotFather)"}
            </span>
            <input
              name="botToken"
              type="password"
              autoComplete="off"
              placeholder={config.tokenHint ? `${config.tokenHint} · vuoto = invariato` : "123456789:ABCdef…"}
              className={inputCls}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
            Chat del team (separate da virgola){" "}
            <span className="font-normal text-slate-400">· numeri (anche negativi per gruppi) o @nomepubblico</span>
            <input
              name="teamChatIds"
              defaultValue={config.teamChatIdsCsv}
              placeholder="555000111, -1001234567890"
              className={inputCls}
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 sm:col-span-2">
            Secret del webhook{" "}
            <span className="font-normal text-slate-400">
              {config.webhookSecretHint ? `· salvato ${config.webhookSecretHint}, vuoto = invariato` : "(openssl rand -hex 32; opzionale ma consigliato)"}
            </span>
            <input
              name="webhookSecret"
              type="password"
              autoComplete="off"
              placeholder={config.webhookSecretHint ? `${config.webhookSecretHint} · vuoto = invariato` : "esadecimale casuale"}
              className={inputCls}
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={config.enabled}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Canale attivo (il webhook e il digest usano questa configurazione)
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400">I segreti restano server-side cifrati: il browser non li riceve mai.</p>
          <GlassButton type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salva configurazione
          </GlassButton>
        </div>
      </form>

      {/* Rileva chat: getUpdates del bot, la lista che chiedeva lo script CLI */}
      <form action={detectTelegramChatsAction} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
              <Users className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Rileva le chat del bot</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Scrivi un messaggio al bot (o aggiungilo a un gruppo), poi premi qui: ti mostro i Chat ID da copiare
                nel campo «Chat del team».
              </p>
            </div>
          </div>
          <GlassButton type="submit" variant="glass">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Rileva chat
          </GlassButton>
        </div>
      </form>

      {/* Test live: invio reale */}
      <form action={testTelegramAction} className="rounded-3xl border border-white/60 bg-white/45 p-4 ring-1 ring-white/40 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
            <KeyRound className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900">Testa l&apos;invio</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Manda un messaggio di prova reale: di default alla prima chat del team, oppure a una chat specifica.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 text-xs font-semibold text-slate-600 sm:max-w-xs">
                Chat di destinazione (opzionale)
                <input
                  name="testChatId"
                  placeholder={config.teamChatIds[0] ?? "555000111"}
                  className={inputCls}
                />
              </label>
              <GlassButton type="submit" variant="glass">
                <Send className="h-3.5 w-3.5" aria-hidden />
                Invia messaggio di prova
              </GlassButton>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
