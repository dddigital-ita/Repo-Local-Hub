import { test, expect, type Page } from "@playwright/test";

/**
 * E2E del flusso consenso cookie (GDPR) — il percorso completo:
 * 1. primo visitatore senza cookie → banner, nessuna misurazione
 * 2. «Solo necessari» → denied, banner via, resta dopo il reload
 * 3. «Accetta tutti» → granted, il consenso è persistente
 * 4. cambio idea dal footer («Preferenze cookie») → riapre, la nuova scelta
 *    vince su quella vecchia
 *
 * I test NON dipendono dall'ordine: ogni scenario riceve da Playwright un
 * BrowserContext fresco, quindi parte SENZA cookie di consenso. Le assert di
 * persistenza (reload) valgono dentro il contesto, dove il cookie scritto
 * dall'app deve sopravvivere alla navigazione.
 */

const BANNER = "[aria-label='Preferenze cookie']";
const GRANT = "Accetta tutti";
const DENY = "Solo necessari";

async function consentCookie(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const hit = cookies.find((c) => c.name === "cc_consent");
  return hit?.value ?? null;
}

test.describe("consenso cookie", () => {
  // Nessun init script: cancellare il cookie a ogni load renderebbe vacue
  // l'asserzione di persistenza sul reload (l'init script girerebbe anche lì).

  test("primo visitatore: banner visibile, nessuna misurazione", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();

    // GDPR: nessuno script di misurazione prima del consenso.
    const google = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).some(
        (s) => s.src.includes("googletagmanager"),
      ),
    );
    expect(google).toBe(false);
    expect(await consentCookie(page)).toBeNull();
  });

  test("«Solo necessari» → denied, banner chiuso, scelta persistente", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator(BANNER);
    await banner.getByRole("button", { name: DENY }).click();
    await expect(banner).toBeHidden();
    expect(await consentCookie(page)).toBe("denied");

    // La scelta regge al ricaricamento: niente banner di nuovo.
    await page.reload();
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await consentCookie(page)).toBe("denied");
  });

  test("«Accetta tutti» → granted e persistente", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator(BANNER);
    await banner.getByRole("button", { name: GRANT }).click();
    await expect(banner).toBeHidden();
    expect(await consentCookie(page)).toBe("granted");

    await page.reload();
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await consentCookie(page)).toBe("granted");
  });

  test("cambio idea dal footer: riapre il banner e la nuova scelta vince", async ({ page }) => {
    await page.goto("/");
    await page.locator(BANNER).getByRole("button", { name: GRANT }).click();
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await consentCookie(page)).toBe("granted");

    // Nel footer il link «Cookie policy» è diventato bottone «Preferenze
    // cookie» per chi ha già scelto: lo clicco, il banner RIAPRE.
    const prefs = page.getByRole("button", { name: "Preferenze cookie" });
    await expect(prefs).toBeVisible();
    await prefs.click();
    await expect(page.locator(BANNER)).toBeVisible();

    // La nuova scelta vince su quella vecchia.
    await page.locator(BANNER).getByRole("button", { name: DENY }).click();
    await expect(page.locator(BANNER)).toBeHidden();
    expect(await consentCookie(page)).toBe("denied");
  });
});
