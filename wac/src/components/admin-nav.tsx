"use client";

import AdminCommandPalette from "@/components/admin-command-palette";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Ticket,
  Target,
  PhoneCall,
  Users,
  Package,
  Sparkles,
  Settings,
  Wrench,
  Layers,
  Briefcase,
  LogOut,
  UserCircle,
  UserCog,
} from "lucide-react";

/**
 * Nav admin stile macOS/iOS (file 1: identità+uscita, file 2: aree) con
 * MACRO-AREE: le 13 pagine non stanno più tutte in riga — le operative
 * quotidiane stanno in prima riga e i GRUPPI stanno in menu disclosure.
 *
 * - Panoramica · Gestione ▾ (Ticket, Lead, Callback, Operatori, Pacchetti)
 *   · Ambrosio AI · Impostazioni · Tools
 * - Notion, SEO e Audit sono SEZIONI DI TOOLS (pagine di sistema:
 *   si raggiungono da /admin/tools, dove vivono come card — non sono
 *   navigazione quotidiana); Shield vive in Impostazioni › Protezione.
 *
 * Il pulsante di gruppo porta il nome della pagina attiva (aria-current) e
 * la pillola animata (layoutId condiviso) scivola anche dentro i menu:
 * la pagina su cui sei non è mai anonima dietro i tre punti.
 */

type NavItem = { href: string; label: string; Icon: typeof Ticket };

const FLAT: NavItem[] = [
  { href: "/admin", label: "Panoramica", Icon: LayoutDashboard },
  { href: "/admin/ai", label: "Ambrosio AI", Icon: Sparkles },
  { href: "/admin/settings", label: "Impostazioni", Icon: Settings },
  { href: "/admin/tools", label: "Tools", Icon: Wrench },
];

const GESTIONE: NavItem[] = [
  { href: "/admin/tickets", label: "Ticket", Icon: Ticket },
  { href: "/admin/clients", label: "Clienti", Icon: Briefcase },
  { href: "/admin/leads", label: "Lead", Icon: Target },
  { href: "/admin/callbacks", label: "Callback", Icon: PhoneCall },
  { href: "/admin/operators", label: "Operatori", Icon: Users },
  { href: "/admin/packages", label: "Pacchetti", Icon: Package },
];

/** Area personale: per ogni utente autenticato. */
const PROFILI: NavItem[] = [{ href: "/admin/profilo", label: "Area personale", Icon: UserCircle }];

/** Gestione utenti: SOLO super admin. */
const UTENTI: NavItem[] = [{ href: "/admin/utenti", label: "Utenti", Icon: UserCog }];

/** Se una pagina di un gruppo è attiva, il pulsante la nomina. */
function activeIn(items: NavItem[], pathname: string): NavItem | undefined {
  return items.find((it) =>
    it.href === "/admin" ? pathname === "/admin" : pathname.startsWith(it.href),
  );
}

export default function AdminNav({ email, role }: { email: string; role?: string }) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  // Il menu si chiude al cambio pagina: il valore è DERIVATO dal pathname
  // (reset in render con confronto del path precedente, pattern dei docs) —
  // mai un setState in effect, che produrrebbe un render extra a navigazione.
  const [menuState, setMenuState] = useState<{
    forPathname: string;
    openMenu: "gestione" | null;
  }>({ forPathname: pathname, openMenu: null });
  const openMenu = menuState.forPathname === pathname ? menuState.openMenu : null;
  const setOpenMenu = useCallback((v: "gestione" | null) => {
    setMenuState({ forPathname: pathname, openMenu: v });
  }, [pathname]);
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [openMenu, setOpenMenu]);

  const gestioneActive = activeIn(GESTIONE, pathname);
  const pill = (
    <motion.span
      layoutId="admin-nav-pill"
      className="absolute inset-0 rounded-full bg-white shadow-sm ring-1 ring-slate-200/70"
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
    />
  );

  return (
    <header className="sticky top-2 z-40 mx-auto w-full max-w-6xl px-3 sm:px-6">
      <div className="glass-strong rounded-3xl px-3 py-2 sm:px-4">
        {/* File 1: identità + uscita */}
        <div className="flex items-center justify-between gap-3">
          <Link href="/admin" className="flex min-w-0 items-baseline gap-1.5 px-1 py-0.5">
            <span className="shrink-0 text-sm font-bold text-slate-900">Admin</span>
            <span className="truncate text-xs font-normal text-slate-400">{email}</span>
          </Link>
          {/* Ricerca rapida: salto diretto a qualsiasi scheda (⌘K). */}
          <AdminCommandPalette />
          <form action="/admin/logout" method="post" className="shrink-0">
            <button
              type="submit"
              aria-label="Esci dall'area team"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-500 transition hover:bg-white/60 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Esci</span>
            </button>
          </form>
        </div>

        {/* File 2: macro-aree — flat + gruppi. Su mobile restano le icone
            (flex-wrap per sicurezza se non entrassero). */}
        <nav
          aria-label="Navigazione admin"
          className="-mx-1 mt-1 flex flex-wrap items-center justify-center gap-0.5 px-1 pb-0.5 sm:flex-nowrap sm:justify-start"
        >
          {FLAT.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                  active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {active && pill}
                <Icon className="relative z-10 h-4 w-4" aria-hidden />
                <span className={`relative z-10 hidden sm:inline ${active ? "font-semibold" : ""}`}>
                  {label}
                </span>
              </Link>
            );
          })}

          {/* Area personale: sempre disponibile per l'utente connesso. */}
          {PROFILI.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                  active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {active && pill}
                <Icon className="relative z-10 h-4 w-4" aria-hidden />
                <span className={`relative z-10 hidden sm:inline ${active ? "font-semibold" : ""}`}>
                  {label}
                </span>
              </Link>
            );
          })}

          {/* Utenti: solo per i super admin (gestione sito e account). */}
          {role === "super_admin" &&
            UTENTI.map(({ href, label, Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                    active ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {active && pill}
                  <Icon className="relative z-10 h-4 w-4" aria-hidden />
                  <span className={`relative z-10 hidden sm:inline ${active ? "font-semibold" : ""}`}>
                    {label}
                  </span>
                </Link>
              );
            })}

          {/* Gruppo «Gestione»: disclosure nativo con le pagine operative
              quotidiane. La pillola (layoutId condiviso) scivola qui dentro
              quando una pagina del gruppo è attiva. */}
          <div ref={menuRef} className="relative sm:ml-auto">
            <button
              type="button"
              aria-expanded={openMenu === "gestione"}
              aria-haspopup="true"
              aria-current={gestioneActive ? "page" : undefined}
              onClick={() => setOpenMenu(openMenu === "gestione" ? null : "gestione")}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                gestioneActive
                  ? "relative text-slate-900"
                  : "text-slate-500 hover:bg-white/60 hover:text-slate-900"
              }`}
            >
              {gestioneActive && pill}
              <Layers className="relative z-10 h-4 w-4" aria-hidden />
              <span className={`relative z-10 hidden sm:inline ${gestioneActive ? "font-semibold" : ""}`}>
                {gestioneActive ? gestioneActive.label : "Gestione"}
              </span>
              <span className="sr-only">
                {gestioneActive ? " — sezione del menu Gestione" : " — apre il menu Gestione"}
              </span>
            </button>

            {openMenu === "gestione" && (
              <div className="glass-strong absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl p-1.5 shadow-glass">
                {GESTIONE.map(({ href, label, Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                        active
                          ? "bg-white font-semibold text-slate-900 ring-1 ring-slate-200/70"
                          : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
