"use client";

import { useState } from "react";
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  UserCog,
  Globe,
  ArrowRight,
  RotateCw,
  Lock,
} from "lucide-react";
import { testConnectionAction, installAction, type InstallRequest } from "./actions";
import type { DbProbe, StepLog } from "@/lib/setup";
import { UiIcon, type IconName } from "@/components/icon-registry";

/**
 * WIZARD D'INSTALLAZIONE (/setup) — stile WordPress: tre passi guidati,
 * test del database in tempo reale, installazione automatica (schema +
 * super admin + env) e log trasparente di ogni operazione.
 *
 * La pagina gira SENZA database: è il punto del sito che non lo presume.
 * Il layout di guardia la rende irraggiungibile (404) dopo il completamento.
 */

const LEVEL_ICON: Record<string, IconName> = { ok: "check", info: "dot", warn: "warning", error: "x" };

function Field({
  id,
  label,
  hint,
  type = "text",
  value,
  onChange,
  placeholder,
  required = true,
}: {
  id: string;
  label: string;
  hint?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={type === "password" ? "new-password" : "off"}
        className="mt-1 w-full rounded-2xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm outline-none backdrop-blur-xl transition focus:border-brand-400/70 focus:bg-white/70"
      />
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function SetupWizard() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 2 — database
  const [dsn, setDsn] = useState("postgresql://utente:password@localhost:5432/nomedatabase");
  const [probe, setProbe] = useState<DbProbe | null>(null);
  const [probing, setProbing] = useState(false);

  // Step 3 — sito + admin
  const [siteUrl, setSiteUrl] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [password2, setPassword2] = useState("");

  // Step 4 — installazione
  const [installing, setInstalling] = useState(false);
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [installError, setInstallError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function runProbe() {
    setProbing(true);
    setProbe(null);
    try {
      const result = await testConnectionAction(dsn);
      setProbe(result);
    } finally {
      setProbing(false);
    }
  }

  function validationError(): string | null {
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/.test(siteUrl.trim())) return "Inserisci un URL del sito valido (https://www.dominio.com).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail.trim())) return "Inserisci un'email valida per il super admin.";
    if (adminPassword.length < 8) return "La password deve essere di almeno 8 caratteri.";
    if (adminPassword !== password2) return "Le due password non coincidono.";
    return null;
  }

  async function runInstall() {
    const invalid = validationError();
    if (invalid) {
      setInstallError(invalid);
      return;
    }
    setInstallError(null);
    setInstalling(true);
    setLogs([]);
    try {
      const payload: InstallRequest = { siteUrl, dsn, adminEmail, adminPassword };
      const result = await installAction(payload);
      setLogs(result.logs);
      if (result.ok) {
        setDone(true);
      } else {
        setInstallError(result.error ?? "Installazione fallita: vedi il log.");
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Errore di rete durante l'installazione.");
    } finally {
      setInstalling(false);
    }
  }

  return (
    <main className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
      <div className="glass w-full max-w-2xl p-8 shadow-glass">
        {/* Intestazione */}
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600/90 text-white shadow-glass-btn">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Installazione del sito</h1>
            <p className="text-sm text-slate-500">Configurazione guidata — dura meno di cinque minuti.</p>
          </div>
        </div>

        {/* Stepper */}
        <ol className="mt-6 flex items-center gap-2 text-xs font-medium text-slate-500">
          {[
            { n: 1 as const, label: "Benvenuto" },
            { n: 2 as const, label: "Database" },
            { n: 3 as const, label: "Sito e admin" },
            { n: 4 as const, label: "Installazione" },
          ].map((s, i) => (
            <li key={s.n} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-4 bg-slate-300" aria-hidden />}
              <span
                className={`grid h-6 w-6 place-items-center rounded-full ${
                  step >= s.n ? "bg-brand-600/90 text-white" : "bg-white/60 text-slate-400"
                }`}
              >
                {step > s.n ? <UiIcon name="check" size={12} /> : s.n}
              </span>
              <span className={step === s.n ? "text-slate-900" : ""}>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6">
          {/* ── PASSO 1 — Benvenuto ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-600">
                Questo installer prepara tutto da solo: <strong>schema del database</strong>,{" "}
                <strong>account super admin</strong> e <strong>configurazione</strong>. Prima di iniziare, dal
                pannello di hosting:
              </p>
              <ol className="list-inside list-decimal space-y-1.5 rounded-2xl bg-white/50 p-4 text-sm text-slate-600">
                <li>
                  Crea il database con <strong>PostgreSQL Database Wizard</strong> (annotati nome database, utente
                  e password);
                </li>
                <li>
                  in <strong>Setup Node.js App</strong> crea l&apos;applicazione puntata alla cartella del sito con
                  startup file <code className="rounded bg-slate-100 px-1">server.js</code>;
                </li>
                <li>apri questa pagina dal dominio del sito.</li>
              </ol>
              <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Al termine il wizard si chiude per sempre: la pagina diventa irraggiungibile e le impostazioni si
                  gestiscono da <strong>/admin</strong>.
                </span>
              </p>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
              >
                Iniziamo <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── PASSO 2 — Database ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Database className="h-4 w-4" /> Connessione al database PostgreSQL
              </div>
              <Field
                id="dsn"
                label="Connection string"
                type="text"
                value={dsn}
                onChange={(v) => {
                  setDsn(v);
                  setProbe(null);
                }}
                placeholder="postgresql://utente:password@localhost:5432/nomedatabase"
                hint="Dal Database Wizard del pannello: nome database, utente e password. L'host su cPanel è quasi sempre «localhost»."
              />
              <button
                type="button"
                onClick={runProbe}
                disabled={probing}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 disabled:opacity-60"
              >
                {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {probing ? "Verifica in corso…" : "Verifica la connessione"}
              </button>

              {probe && (
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    probe.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {probe.ok ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <div>
                      {probe.ok ? (
                        <>
                          <p className="font-semibold">Connessione riuscita</p>
                          <p className="mt-0.5 text-xs">
                            {probe.server} · database «{probe.database}» · utente «{probe.user}»
                            {probe.ssl ? " · SSL" : ""}
                          </p>
                        </>
                      ) : (
                        <p>{probe.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-full bg-white/60 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-white/80"
                >
                  Indietro
                </button>
                <button
                  type="button"
                  disabled={!probe?.ok}
                  onClick={() => setStep(3)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continua <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASSO 3 — Sito e super admin ── */}
          {step === 3 && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const invalid = validationError();
                if (invalid) setInstallError(invalid);
                else setStep(4);
              }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <UserCog className="h-4 w-4" /> Sito e account super admin
              </div>
              <Field
                id="siteUrl"
                label="Indirizzo del sito"
                type="url"
                value={siteUrl}
                onChange={setSiteUrl}
                placeholder="https://www.dominio.com"
                hint="Usato per i link nelle email, sitemap e dati strutturati."
              />
              <div className="rounded-2xl bg-white/50 p-4">
                <Field
                  id="adminEmail"
                  label="Email del super admin"
                  type="email"
                  value={adminEmail}
                  onChange={setAdminEmail}
                  placeholder="tu@email.com"
                  hint="Con quest'email entrerai su /admin dopo l'installazione."
                />
                <div className="mt-4">
                  <Field
                    id="adminPassword"
                    label="Password del super admin"
                    type="password"
                    value={adminPassword}
                    onChange={setAdminPassword}
                    hint="Minimo 8 caratteri: scegli una password lunga, la potrai cambiare dall'admin."
                  />
                </div>
                <div className="mt-4">
                  <Field
                    id="adminPassword2"
                    label="Conferma password"
                    type="password"
                    value={password2}
                    onChange={setPassword2}
                    required={false}
                  />
                </div>
              </div>
              {installError && (
                <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{installError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-full bg-white/60 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:bg-white/80"
                >
                  Indietro
                </button>
                <button
                  type="submit"
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
                >
                  Vai all&apos;installazione <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}

          {/* ── PASSO 4 — Installazione ── */}
          {step === 4 && (
            <div className="space-y-4">
              {!done && (
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Globe className="h-4 w-4" /> Installazione in corso
                </div>
              )}
              {done && (
                <div className="rounded-2xl bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                  <p className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-5 w-5" /> Installazione completata
                  </p>
                  <p className="mt-2 leading-relaxed">
                    Ultimo passo, dal pannello: <strong>Setup Node.js App → Restart</strong>. Poi entra su{" "}
                    <code className="rounded bg-white/70 px-1">/admin</code> con l&apos;email e la password che hai
                    scelto. Questa pagina non è più raggiungibile.
                  </p>
                  <p className="mt-2 text-xs text-emerald-700">
                    Per le email di notifica: la chiave Resend si configura dopo da /admin (o in .env.local).
                  </p>
                </div>
              )}
              {installError && !done && (
                <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {installError}
                  <button
                    type="button"
                    onClick={runInstall}
                    className="mt-2 flex items-center gap-1.5 font-semibold text-red-700 underline"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Riprova
                  </button>
                </p>
              )}
              {logs.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded-2xl bg-slate-900/95 p-4 font-mono text-xs leading-relaxed text-slate-100">
                  {logs.map((l, i) => (
                    <p key={i} className={l.level === "error" ? "text-red-300" : l.level === "warn" ? "text-amber-300" : l.level === "ok" ? "text-emerald-300" : "text-slate-300"}>
                      <span className="text-slate-500"><UiIcon name={LEVEL_ICON[l.level] ?? "dot"} size={11} className="inline" /></span>{" "}
                      <span className="text-slate-500">[{l.step}]</span> {l.message}
                    </p>
                  ))}
                  {installing && (
                    <p className="flex items-center gap-2 text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> lavoro in corso…
                    </p>
                  )}
                </div>
              )}
              {!installing && !done && logs.length === 0 && (
                <div className="rounded-2xl bg-white/50 p-4 text-sm text-slate-600">
                  <p className="font-semibold">Cosa farà l&apos;installer:</p>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed text-slate-500">
                    <li>verificherà la connessione al database;</li>
                    <li>applicherà lo schema completo (migration idempotenti);</li>
                    <li>creerà l&apos;account super admin;</li>
                    <li>scriverà la configurazione e chiuderà il wizard per sempre.</li>
                  </ol>
                </div>
              )}
              {!done && !installing && (
                <button
                  type="button"
                  onClick={runInstall}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-600/90 px-5 py-3 text-sm font-semibold text-white shadow-glass-btn backdrop-blur-xl transition hover:bg-brand-500/90"
                >
                  <Database className="h-4 w-4" /> Avvia l&apos;installazione
                </button>
              )}
              {!installing && !done && (
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="w-full text-center text-xs font-medium text-slate-400 hover:text-slate-600"
                >
                  ← Torna ai dati del sito
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-slate-400">
        Installer del sito · la rotta viene disattivata automaticamente al termine
      </p>
    </main>
  );
}
