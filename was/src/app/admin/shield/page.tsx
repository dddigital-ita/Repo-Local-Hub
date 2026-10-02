import Link from "next/link";
import { Ban, ShieldCheck, ShieldAlert, ShieldHalf, Trash2, ScanEye, Filter, MailWarning } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getShieldStats, getResetAttempts } from "@/lib/shield";
import { UiIcon, type IconName } from "@/components/icon-registry";
import { activeTurnstileSiteKey } from "@/lib/turnstile";
import { getTurnstileSettings } from "@/lib/turnstile-settings";
import { unbanIpAction } from "../actions";
import { GlassButton, GlassCard as Card, GlassSectionHeader } from "@/components/glass";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, { label: string; tone: string; icon?: IconName }> = {
  rate_limit: { label: "Rate limit", tone: "bg-amber-100/90 text-amber-700" },
  honeypot: { label: "Honeypot", tone: "bg-violet-100/90 text-violet-700" },
  bad_payload: { label: "Payload sospetto", tone: "bg-orange-100/90 text-orange-700" },
  ban: { label: "Ban", tone: "bg-red-100/90 text-red-700", icon: "ban" },
  unban: { label: "Sblocco", tone: "bg-green-100/90 text-green-700" },
};

export default async function ShieldPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; saved?: string; kind?: string }>;
}) {
  await requireAdmin();
  const pool = db();
  if (!pool)
    return <p className="text-sm text-red-600">Database non configurato (vedi SETUP.md → Neon).</p>;

  const { err, saved, kind } = await searchParams;
  const stats = await getShieldStats(kind ?? null);
  const resets = await getResetAttempts();
  const captchaSiteKey = await activeTurnstileSiteKey();
  const captchaSettings = await getTurnstileSettings();
  const captchaOn = Boolean(captchaSiteKey);
  const protectedEndpoints = [
    ["/admin/login", "Login team (captcha + rate limit)", "8/ora per IP"],
    ["/api/chat/init", "Apertura chat", "20/min per IP"],
    ["/api/chat/message", "Messaggi chat", "40/min per IP"],
    ["/api/chat/ai", "Domande ad Ambrosio", "10/min per IP"],
    ["/api/lead", "Salvataggio lead", "5/ora per IP"],
    ["/api/callback", "Richieste callback", "5/ora per IP"],
  ] as const;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900">
          <ShieldCheck className="h-6 w-6 text-[#34C759]" aria-hidden />
          Shield Security
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Scudo attivo su chat, lead, callback, Ambrosio e login team. Ban automatico dopo 3 violazioni in 10
          minuti (24 ore).
        </p>
      </div>

      {err && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{err}</p>
      )}
      {saved === "captcha" && (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">
          Chiavi captcha salvate: il widget è attivo su login, chat e lead.
        </p>
      )}

      {/* Stato */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="text-center">
          <p className="text-3xl font-bold text-slate-900">{stats.events24h}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">eventi bloccati (24h)</p>
        </Card>
        <Card className="text-center">
          <p className="text-3xl font-bold text-slate-900">{stats.activeBans.length}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">IP bannati ora</p>
        </Card>
        <Card className="text-center">
          <p className="flex items-center justify-center gap-1.5 text-2xl font-bold text-[#34C759]">
            <ShieldCheck className="h-6 w-6" aria-hidden />
            Attivo
          </p>
          <p className="mt-1 text-xs font-medium text-slate-500">5 endpoint + login + {captchaOn ? "Turnstile" : "honeypot"}</p>
        </Card>
      </div>

      {/* Endpoint protetti */}
      <Card>
        <GlassSectionHeader icon={ShieldHalf} title="Cosa protegge" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {protectedEndpoints.map(([ep, label, limit]) => (
            <div key={ep} className="flex items-center justify-between rounded-xl bg-white/60 px-3 py-2 ring-1 ring-white/50">
              <span className="text-sm text-slate-700">{label}</span>
              <span className="text-right">
                <code className="text-[11px] text-slate-400">{ep}</code>
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  {limit}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          In più: header di sicurezza su tutto il sito (anti-clickjacking, nosniff, referrer privacy,
          HSTS), honeypot nei form e captcha invisibile Cloudflare Turnstile
          {captchaOn ? " attivo" : " (configura le chiavi qui sotto)"}. Le violazioni
          ripetute finiscono nel log qui sotto con IP, endpoint e dettaglio.
        </p>
      </Card>

      {/* Captcha invisibile: stato + rimando all'editor (scheda Cloudflare) */}
      <Card>
        <GlassSectionHeader
          icon={ScanEye}
          tone={captchaOn ? "bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100" : "bg-amber-50 text-amber-500 ring-1 ring-amber-100"}
          title="Captcha invisibile (Cloudflare Turnstile)"
          right={
            <Link
              href="/admin/settings/cloudflare"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/60 px-4 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-white/50 transition hover:bg-white/90"
            >
              <ScanEye className="h-4 w-4" aria-hidden />
              Gestisci da Impostazioni → Cloudflare
            </Link>
          }
        />
        <p className="mt-1 text-sm text-slate-500">
          Blocca bot e script automatici su <strong>login team, chat e lead</strong> senza alcuna
          interazione visibile per le persone vere. Attivo solo con ENTRAMBE le chiavi; le richieste
          con token mancante vengono rifiutate senza bannare (timing dello script lazy).
          Le chiavi si salvano ora nella scheda{" "}
          <Link href="/admin/settings/cloudflare" className="font-semibold text-brand-700 hover:underline">
            Impostazioni → Cloudflare
          </Link>{" "}
          (secret cifrata AES-256-GCM, ogni modifica in audit).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              captchaOn ? "bg-emerald-100/90 text-emerald-700" : "bg-amber-100/90 text-amber-700"
            }`}
          >
            {captchaOn ? "Attivo" : "Non configurato"}
          </span>
          {captchaSettings.fromDb && (
            <span className="rounded-full bg-sky-100/90 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
              chiavi da Cloudflare (DB)
            </span>
          )}
          {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              chiavi da environment (prioritaria)
            </span>
          )}
          {captchaSiteKey && (
            <code className="text-[11px] text-slate-400">site: {captchaSiteKey.slice(0, 8)}…</code>
          )}
          {captchaSettings.secretHint && (
            <code className="text-[11px] text-slate-400">secret: {captchaSettings.secretHint}</code>
          )}
        </div>
      </Card>

      {/* Ban attivi */}
      <Card>
        <GlassSectionHeader
          icon={Ban}
          tone="bg-red-50 text-red-500 ring-1 ring-red-100"
          title="IP bannati"
        />
        {stats.activeBans.length ? (
          <div className="mt-2 space-y-2">
            {stats.activeBans.map((b) => (
              <div key={b.ip} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50/80 px-3 py-2 ring-1 ring-red-100">
                <div>
                  <code className="text-sm font-semibold text-slate-800">{b.ip}</code>
                  <p className="text-xs text-slate-500">{b.reason}</p>
                  <p className="text-[11px] text-slate-400">
                    scadenza: {new Date(b.expires_at).toLocaleString("it-IT")}
                  </p>
                </div>
                <form action={unbanIpAction}>
                  <input type="hidden" name="ip" value={b.ip} />
                  <GlassButton type="submit" variant="glass" size="sm">
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Sblocca
                  </GlassButton>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Nessun IP bloccato: la strada è libera ai clienti veri.</p>
        )}
      </Card>

      {/* Reset password: tentativi recenti (spam a colpo d'occhio) */}
      <Card>
        <GlassSectionHeader
          icon={MailWarning}
          tone={resets.falliti24h > 0 ? "bg-amber-50 text-amber-500 ring-1 ring-amber-100" : "bg-sky-50 text-sky-500 ring-1 ring-sky-100"}
          title="Reset password — tentativi recenti"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${resets.last24h > 0 ? "bg-slate-100/90 text-slate-600" : "bg-slate-50 text-slate-400"}`}>
            {resets.last24h} richieste (24h)
          </span>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${resets.falliti24h > 0 ? "bg-amber-100/90 text-amber-700" : "bg-slate-50 text-slate-400"}`}>
            {resets.falliti24h} invii falliti (24h)
          </span>
          {resets.falliti24h >= 3 && (
            <span className="rounded-full bg-red-100/90 px-2.5 py-1 text-[11px] font-semibold text-red-700">
              possibile spam: controlla SMTP e rate limit
            </span>
          )}
        </div>
        {resets.attempts.length ? (
          <div className="mt-2 divide-y divide-white/50">
            {resets.attempts.map((a, i) => {
              const meta =
                a.outcome === "ok"
                  ? { label: "email inviata", tone: "bg-emerald-100/90 text-emerald-700" }
                  : a.outcome === "fallito"
                    ? { label: "invio fallito", tone: "bg-amber-100/90 text-amber-700" }
                    : a.outcome === "reset_done"
                      ? { label: "password cambiata", tone: "bg-sky-100/90 text-sky-700" }
                      : { label: a.outcome, tone: "bg-slate-100 text-slate-600" };
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>
                    {meta.label}
                  </span>
                  <code className="text-xs font-semibold text-slate-700">{a.actor}</code>
                  {a.detail && a.outcome === "fallito" && (
                    <span className="text-xs text-slate-400">· {a.detail}</span>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {new Date(a.created_at).toLocaleString("it-IT")}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Nessun tentativo di reset nelle ultime 48 ore. Se qualcuno bombardasse la pagina,
            le richieste comparirebbero qui (e i bot restano bloccati dal captcha/rate limit).
          </p>
        )}
      </Card>

      {/* Eventi recenti (filtrabili per tipo) */}
      <Card>
        <GlassSectionHeader
          icon={ShieldAlert}
          tone="bg-amber-50 text-amber-500 ring-1 ring-amber-100"
          title={stats.kindFilter ? `Eventi recenti — solo ${KIND_LABEL[stats.kindFilter]?.label ?? stats.kindFilter}` : "Eventi recenti"}
        />

        {/* Conteggi 7 giorni per tipo: cliccabili come filtri della lista. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <Filter className="size-3" aria-hidden />
            7 giorni:
          </span>
          <Link
            href="/admin/shield"
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              stats.kindFilter === null
                ? "bg-brand-600 text-white shadow-glass-btn"
                : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/90"
            }`}
          >
            Tutti
          </Link>
          {stats.byKind7d.map(({ kind: k, n }) => {
            const meta = KIND_LABEL[k] ?? { label: k, tone: "bg-slate-100/90 text-slate-600" };
            const active = stats.kindFilter === k;
            return (
              <Link
                key={k}
                href={`/admin/shield?kind=${encodeURIComponent(k)}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  active ? "bg-brand-600 text-white shadow-glass-btn" : `${meta.tone} hover:brightness-95`
                }`}
              >
                {meta.icon && <UiIcon name={meta.icon} size={10} />}
                {meta.label}
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] ${
                    active ? "bg-white/25 text-white" : n > 0 ? "bg-white/70 text-slate-700" : "bg-white/40 text-slate-400"
                  }`}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-2 divide-y divide-white/50">
          {stats.recent.map((e, i) => {
            const meta = KIND_LABEL[e.kind] ?? { label: e.kind, tone: "bg-slate-100 text-slate-600" };
            return (
              <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 text-sm">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>
                  {meta.icon && <UiIcon name={meta.icon} size={10} />}
                  {meta.label}
                </span>
                <code className="text-xs font-semibold text-slate-700">{e.ip}</code>
                <span className="text-xs text-slate-500">{e.endpoint ?? ""}</span>
                {e.detail && <span className="text-xs text-slate-400">· {e.detail}</span>}
                <span className="ml-auto text-[11px] text-slate-400">
                  {new Date(e.created_at).toLocaleString("it-IT")}
                </span>
              </div>
            );
          })}
          {!stats.recent.length && (
            <p className="py-2 text-sm text-slate-500">
              {stats.kindFilter
                ? `Nessun evento di tipo «${KIND_LABEL[stats.kindFilter]?.label ?? stats.kindFilter}» nel log recente.`
                : "Ancora nessun evento sospetto. Quando un bot tenta di spammare, lo vedi qui."}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
