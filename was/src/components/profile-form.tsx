"use client";

import { useRef, useState } from "react";
import { Save } from "lucide-react";
import { toastSaved } from "@/components/admin-toaster";
import { updateProfileAction } from "@/app/admin/profilo/actions";

/**
 * Form dell'Area personale: i campi anagrafici dell'utente (nome, cognome,
 * P.IVA, telefono, via…). È un form PROGRESSIVAMENTE MIGLIORATO: senza JS
 * funziona lo stesso (action server), con JS aggiunge feedback di salvataggio
 * (toast) e disabilita il bottone quando non c'è nulla da salvare.
 * Email e ruolo sono FUORI dal form: sono identità, non anagrafica.
 */

export interface ProfileValues {
  firstName: string;
  lastName: string;
  vatNumber: string;
  fiscalCode: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  bio: string;
}

const FIELD_CLASS =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100";

function Field({
  id,
  label,
  value,
  hint,
  maxLength,
  className = "",
  autoComplete,
  textArea,
}: {
  id: keyof ProfileValues;
  label: string;
  value: string;
  hint?: string;
  maxLength?: number;
  className?: string;
  autoComplete?: string;
  textArea?: boolean;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-xs font-bold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {textArea ? (
        <textarea id={id} name={id} defaultValue={value} maxLength={maxLength} rows={3} className={FIELD_CLASS} />
      ) : (
        <input
          id={id}
          name={id}
          type={id === "phone" ? "tel" : "text"}
          defaultValue={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          className={FIELD_CLASS}
        />
      )}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export default function ProfileForm({ initial }: { initial: ProfileValues }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  return (
    <form
      ref={formRef}
      action={async (fd: FormData) => {
        await updateProfileAction(fd);
        toastSaved("profilo_salvato");
        setDirty(false);
      }}
      onChange={() => setDirty(true)}
      className="mt-4 grid gap-4 sm:grid-cols-2"
    >
      <Field id="firstName" label="Nome" value={initial.firstName} maxLength={80} autoComplete="given-name" />
      <Field id="lastName" label="Cognome" value={initial.lastName} maxLength={80} autoComplete="family-name" />
      <Field id="vatNumber" label="Partita IVA" value={initial.vatNumber} maxLength={20} hint="11 cifre, senza spazi" />
      <Field id="fiscalCode" label="Codice fiscale" value={initial.fiscalCode} maxLength={20} />
      <Field id="phone" label="Numero di telefono" value={initial.phone} maxLength={30} autoComplete="tel" />
      <Field id="address" label="Via e numero civico" value={initial.address} maxLength={160} autoComplete="street-address" />
      <Field id="city" label="Città" value={initial.city} maxLength={80} autoComplete="address-level2" />
      <div className="grid grid-cols-2 gap-4">
        <Field id="province" label="Provincia" value={initial.province} maxLength={3} hint="Sigla (es. CR)" />
        <Field id="postalCode" label="CAP" value={initial.postalCode} maxLength={10} autoComplete="postal-code" />
      </div>
      <Field id="bio" label="Note" value={initial.bio} maxLength={500} textArea className="sm:col-span-2" />

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={!dirty}
          className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save className="size-4" aria-hidden />
          Salva dati personali
        </button>
        <p className="mt-2 text-xs text-slate-400">
          L&apos;email si cambia nella scheda qui sopra; il ruolo si gestisce da Utenti (solo super admin) e la password da Sicurezza.
        </p>
      </div>
    </form>
  );
}
