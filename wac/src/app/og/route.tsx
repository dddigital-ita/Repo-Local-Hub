import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

// Su Next 16 il runtime di default (Node) supporta next/og: la dichiarazione
// "edge" era il motivo dell'avviso di deprecazione Edge e disabilitava la
// generazione statica della rotta.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title =
    searchParams.get("title")?.slice(0, 80) ?? `${site.name} — Agenzia web a Crema`;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #eef4ff 0%, #ffffff 55%, #dce7fd 100%)",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: "#2653df",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            {site.name.slice(0, 1)}
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "#1c2c64" }}>{site.name}</div>
        </div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 800, color: "#141d3c", lineHeight: 1.1 }}>
          {title}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#475569", fontSize: 24 }}>
          <div>Siti web · E-commerce · SEO — Crema, Cremona, Lodi</div>
          <div style={{ color: "#2653df", fontWeight: 700 }}>{new URL(site.url).hostname}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
