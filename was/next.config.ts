import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace root esplicita: il package-lock.json spurio in ~/ altrimenti
  // fa inferire la HOME come root e rompe build traces e chunk in produzione.
  outputFileTracingRoot: __dirname,

  // Produzione isolata dal dev: il supervisore locale tiene `next dev` sulla
  // .next condivisa e la contamina in continuazione. Con WAC_DIST_DIR la build
  // di produzione vive in una cartella propria; sul deploy la variabile non
  // c'è e si usa la .next standard.
  ...(process.env.WAC_DIST_DIR ? { distDir: process.env.WAC_DIST_DIR } : {}),

  // Nessun flag sperimentale: le transizioni pagina usano la View Transitions
  // API nativa del browser via <ViewTransitions /> (src/components).

  // Shield Security: header di sicurezza su tutte le risposte.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Il sito non deve mai essere incorniciato da altri siti (clickjacking)
          { key: "X-Frame-Options", value: "DENY" },
          // Il browser non deve "indovinare" i tipi dei file
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nessun referrer verso siti esterni (privacy dei visitatori)
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disattiva API del browser non usate (fotocamera, microfono, geolocalizzazione precisa)
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS sempre (dopo il deploy su dominio; in locale è inerte)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
