import { NextResponse, type NextRequest } from "next/server";
import { LANDINGS } from "@/lib/site";
import {
  MAINTENANCE_KEY,
  MAINTENANCE_TITLE,
  MAINTENANCE_DEFAULT_SUB,
  sanitizeMaintenanceConfig,
  type MaintenanceConfig,
} from "@/lib/maintenance-shared";
import { contacts, site } from "@/lib/site";

/**
 * Proxy (ex middleware, convenzione Next 16):
 * 1. MODALITÀ MANUTENZIONE: se attiva, ogni percorso pubblico riceve una
 *    pagina HTML di manutenzione con 503 (il crawler capisce «torna presto»,
 *    non deindicizza; i visitatori vedono contatti e CTA). L'HTML è GENERATO
 *    QUI e non importa il layout: zero dipendenze da chat, banner cookie o
 *    tema — una pagina che deve funzionare quando il resto può non farlo.
 * 2. REDIRECT 301 configurati da admin (content_settings `seo_config` → redirects).
 * 3. Vecchi slug delle landing rinominate: chi segue un backlink o la vecchia
 *    sitemap non trova un 404 ma il nuovo URL (301 → niente perdita SEO).
 *
 * Il proxy NON può né usare `pg` né importare moduli che lo fanno
 * (lib/seo.ts → lib/db.ts): la config la legge via rotta interna
 * /api/seo/config e /api/maintenance/config (cache in-process 60s; in
 * caso di errore → nessun blocco, nessun redirect: il sito funziona
 * degradato APERTO come da convenzione — la manutenzione si accende
 * volontariamente, non per incidente).
 */

type Snapshot = {
  redirects: { from: string; to: string }[];
  slugMap: Record<string, string>;
  maintenance: MaintenanceConfig;
};

const MAINTENANCE_TTL_MS = 15_000; // il toggle admin diventa pubblico entro ~15s
const SEO_TTL_MS = 60_000;

let seoCache: { data: Snapshot["redirects"]; slugMap: Snapshot["slugMap"]; at: number } | null = null;
let maintenanceCache: { data: MaintenanceConfig; at: number } | null = null;

/** Manutenzione: rotta dedicata, cache BREVE (accendere/spegnere deve
 *  arrivare in pubblico quasi subito; un fallimento qui NON blocca mai). */
async function loadMaintenance(request: NextRequest): Promise<MaintenanceConfig> {
  if (maintenanceCache && Date.now() - maintenanceCache.at < MAINTENANCE_TTL_MS) return maintenanceCache.data;
  try {
    const url = new URL("/api/maintenance/config", request.nextUrl.origin);
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const parsed = sanitizeMaintenanceConfig(data[MAINTENANCE_KEY]);
      maintenanceCache = { data: parsed, at: Date.now() };
      return parsed;
    }
  } catch {
    // API non raggiungibile (avvio a freddo, DB assente): sito aperto.
  }
  return sanitizeMaintenanceConfig(null);
}

async function loadSeo(request: NextRequest): Promise<Pick<Snapshot, "redirects" | "slugMap">> {
  if (seoCache && Date.now() - seoCache.at < SEO_TTL_MS) {
    return { redirects: seoCache.data, slugMap: seoCache.slugMap };
  }
  try {
    const url = new URL("/api/seo/config", request.nextUrl.origin);
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = (await res.json()) as {
        redirects?: { from: string; to: string }[];
        landings?: Record<string, { slugOverride?: string }>;
      };
      const data2 = {
        redirects: data.redirects ?? [],
        slugMap: Object.fromEntries(
          Object.entries(data.landings ?? {})
            .filter(([, v]) => v.slugOverride)
            .map(([k, v]) => [k, v.slugOverride as string]),
        ),
      };
      seoCache = { data: data2.redirects, slugMap: data2.slugMap, at: Date.now() };
      return data2;
    }
  } catch {
    // API non raggiungibile: nessun redirect.
  }
  return { redirects: [], slugMap: {} };
}

/** Escape HTML minimo per i testi dell'agenzia (attributi e nodi testo). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pagina di manutenzione: HTML autonomo, stessa disciplina grafica del sito
 *  (aurora, vetro, brand), senza alcuna dipendenza dal layout Next. */
function maintenanceHtml(config: MaintenanceConfig): string {
  const sub = config.message || MAINTENANCE_DEFAULT_SUB;
  const back = config.backOnline;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(MAINTENANCE_TITLE)} · ${esc(site.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; }
  html { height: 100%; }
  body {
    min-height: 100dvh; display: flex; flex-direction: column;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a; background: #eef2ff; position: relative; overflow-x: hidden;
    -webkit-font-smoothing: antialiased; line-height: 1.5;
  }
  .aurora {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(60rem 40rem at 85% -10%, rgba(59, 130, 246, 0.16), transparent 60%),
      radial-gradient(50rem 36rem at -10% 20%, rgba(129, 140, 248, 0.18), transparent 60%),
      radial-gradient(44rem 30rem at 50% 120%, rgba(56, 189, 248, 0.14), transparent 60%);
  }
  main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 20px; position: relative; z-index: 1; }
  .card {
    width: 100%; max-width: 640px; text-align: center; padding: 48px 28px;
    background: rgba(255, 255, 255, 0.62); border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 32px; box-shadow: 0 24px 60px -24px rgba(15, 23, 42, 0.25);
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  }
  .logo { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; }
  .logo-mark {
    width: 52px; height: 52px; border-radius: 16px; background: #2653df; color: #fff;
    display: grid; place-items: center; font-weight: 800; font-size: 22px;
    box-shadow: 0 10px 24px -10px rgba(38, 83, 223, 0.55);
  }
  .logo-name { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
  .logo-sub { font-size: 12px; color: #475569; }
  h1 { margin-top: 28px; font-size: clamp(26px, 5vw, 36px); font-weight: 800; letter-spacing: -0.03em; }
  .sub { margin: 14px auto 0; max-width: 46ch; font-size: 15px; color: #334155; }
  .cta-row { margin-top: 30px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 48px; padding: 12px 22px; border-radius: 999px; text-decoration: none;
    font-size: 14px; font-weight: 700;
  }
  .btn-wa { background: #2653df; color: #fff; box-shadow: 0 12px 28px -12px rgba(38, 83, 223, 0.55); }
  .btn-wa:hover { background: #1d43ba; }
  .btn-tel { background: rgba(255, 255, 255, 0.75); color: #1e293b; border: 1px solid rgba(15, 23, 42, 0.12); }
  .btn-tel:hover { background: #fff; }
  .info { margin-top: 26px; font-size: 14px; color: #475569; }
  .info a { color: #2653df; font-weight: 600; text-decoration: none; }
  .info a:hover { text-decoration: underline; }
  .back { margin-top: 10px; font-size: 13px; color: #64748b; }
  footer { position: relative; z-index: 1; padding: 18px 16px 26px; text-align: center; font-size: 12px; color: #475569; }
  footer b { font-weight: 600; color: #334155; }
  @media (prefers-reduced-motion: no-preference) {
    .card { animation: rise 0.5s ease-out both; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  }
</style>
</head>
<body>
<div class="aurora" aria-hidden="true"></div>
<main>
  <section class="card" aria-labelledby="m-title">
    <a class="logo" href="/">
      <span class="logo-mark" aria-hidden="true">W</span>
      <span>
        <span class="logo-name">${esc(site.name)}</span><br>
        <span class="logo-sub">Agenzia web · Crema</span>
      </span>
    </a>
    <h1 id="m-title">${esc(MAINTENANCE_TITLE)}</h1>
    <p class="sub">${esc(sub)}</p>
    <div class="cta-row">
      <a class="btn btn-wa" href="${contacts.whatsapp}" rel="noopener">WhatsApp</a>
      <a class="btn btn-tel" href="${contacts.telHref}">${esc(contacts.phoneDisplay)}</a>
    </div>
    <p class="info">
      Oppure scrivi a <a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
    </p>
    ${back ? `<p class="back">Torniamo online: ${esc(back)}</p>` : ""}
  </section>
</main>
<footer>© ${new Date().getFullYear()} ${esc(site.name)} — <b>a branch by DDDigital</b></footer>
</body>
</html>`;
}

export async function proxy(request: NextRequest) {
  // Solo GET: i gate non interferiscono con POST/API admin.
  if (request.method !== "GET") return NextResponse.next();

  const { pathname } = request.nextUrl;
  // /admin non passa di qui (matcher), ma per sicurezza non tocciamo i path
  // con estensione file (asset statici già esclusi dal matcher).
  if (pathname.includes(".")) return NextResponse.next();

  const snap = await loadMaintenance(request);

  // 0) MODALITÀ MANUTENZIONE: la pagina html è servita su QUALSIASI path
  //    pubblico, così i vecchi bookmark continuano a funzionare senza
  //    redirect (che falserebbero i report SEO). /maintenance reale resta
  //    montata come anteprima/backup React: qui non arriva mai (matcher).
  if (snap.active) {
    return new NextResponse(maintenanceHtml(snap), {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "3600",
      },
    });
  }

  const lower = pathname.toLowerCase();

  // 1) Redirect espliciti da admin (match esatto sul path).
  const seo = await loadSeo(request);
  const hit = seo.redirects.find((r) => r.from.toLowerCase() === lower);
  if (hit && hit.to && hit.to !== lower) {
    const url = request.nextUrl.clone();
    url.pathname = hit.to;
    return NextResponse.redirect(url, 301);
  }

  // 2) Landing rinominate: /vecchio-slug → 301 → /nuovo-slug.
  const base = LANDINGS.find((l) => `/${l.slug}` === lower);
  if (base) {
    const target = seo.slugMap[base.slug];
    if (target) {
      const url = request.nextUrl.clone();
      url.pathname = `/${target}`;
      return NextResponse.redirect(url, 301);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Tutto tranne API, asset Next, file statici e l'admin (mai rediretto:
  // una regola SEO non deve poter mandare in tilt la dashboard). /maintenance
  // reale resta fuori dal cancello: è l'anteprima React della pagina.
  matcher: ["/((?!api|admin|_next/static|_next/image|maintenance|favicon.ico|icon.svg|apple-touch-icon.png|site.webmanifest|og).*)"],
};
