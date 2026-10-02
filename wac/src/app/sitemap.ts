import type { MetadataRoute } from "next";
import { LANDINGS, site } from "@/lib/site";
import { effectiveLandingSeo, getSeoConfig } from "@/lib/seo";

/**
 * Sitemap dinamica: rispetta le personalizzazioni dello strumento SEO
 * (slug personalizzati, noindex). Senza DB o senza override produce
 * esattamente la sitemap di prima.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const seo = await getSeoConfig();
  const landings = LANDINGS.flatMap((l) => {
    const e = effectiveLandingSeo(l, seo);
    if (e.noindex) return []; // esclusa dall'indicizzazione → fuori dalla sitemap
    return [{ url: `${site.url}/${e.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 }];
  });
  return [
    { url: site.url, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...landings,
    { url: `${site.url}/privacy-policy`, lastModified: now, priority: 0.2 },
    { url: `${site.url}/cookie-policy`, lastModified: now, priority: 0.2 },
  ];
}
