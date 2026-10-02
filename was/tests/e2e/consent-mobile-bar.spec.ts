import { test, expect, type Page } from "@playwright/test";

/**
 * Barra sottile mobile del banner cookie (scelta utente: «Barra sottile su
 * mobile» — see consent.tsx):
 *
 *  - su <640px il banner si riduce a una riga (~52px) in basso: testo breve
 *    + azioni inline, tap-target ≥40px — le azioni delle card della inbox
 *    NON vengono più coperte/intercettate;
 *  - da sm: (640px+) il banner completo resta invariato (paragrafo lungo +
 *    bottoni su seconda riga);
 *  - il FLUSSO di consenso è intatto: «Accetta tutti» → cookie cc_consent=
 *    granted + banner nascosto (le stesse asserzioni di consent.spec).
 *
 * Nota di affidabilità: il banner monta su «primo evento utente» (gesto
 * reale: click/keydown), NON al load — lo stimoliamo con un click reale
 * sulla pagina (che il wheel/headless-only non innesca) e aspettiamo il
 * montaggio con attesa larga.
 *
 * Convenzioni repo: marker non necessario (nessun dato di prova nel DB, il
 * consenso vive nel BROWSER del contesto effimero).
 */
const BANNER = "[aria-label='Preferenze cookie']";

/** Il banner monta al primo GESTO reale (click): un click fuori dal banner
    (sull'header) lo innescia senza navigare. Attesa larga: idratazione. */
async function showBanner(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  await page.locator("header").first().click({ position: { x: 10, y: 10 } });
  await page.locator(BANNER).waitFor({ state: "visible", timeout: 12_000 });
}

test.describe("barra sottile mobile del banner cookie", () => {
  test("mobile 390×844: barra sottile — altezza contenuta e bottoni inline ≥40px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await showBanner(page);

    const bar = page.locator(BANNER);
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    // BARRA: ~52px (una riga di testo + padding). Il banner intero era
    // 200-280px (25-30% del viewport).
    expect(box!.height).toBeLessThanOrEqual(80);
    // Full-width su mobile (inset-x-2): margini piccoli, non un pannello centrale.
    expect(box!.width).toBeGreaterThanOrEqual(350);

    // I due bottoni sono inline e tappabili.
    const grant = bar.getByRole("button", { name: "Accetta tutti" });
    const deny = bar.getByRole("button", { name: "Solo necessari" });
    await expect(grant).toBeVisible();
    await expect(deny).toBeVisible();
    const gb = await grant.boundingBox();
    expect(gb!.height).toBeGreaterThanOrEqual(40);
    // Testo breve: il paragrafo lungo è hidden sm:block (nascosto su mobile).
    await expect(bar.getByText(/cookie statistici/)).toBeHidden();
    await expect(bar.getByText(/Cookie tecnici \+ statistici/)).toBeVisible();
  });

  test("mobile: il flusso di consenso resta intatto (grant → cookie + chiusura)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await showBanner(page);
    const bar = page.locator(BANNER);

    await bar.getByRole("button", { name: "Accetta tutti" }).click();
    await expect(bar).toBeHidden();
    const cookies = await page.context().cookies();
    const consent = cookies.find((c) => c.name === "cc_consent");
    expect(consent?.value).toBe("granted");
  });

  test("desktop 1280×800: banner completo invariato (paragrafo lungo visibile)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await showBanner(page);

    const bar = page.locator(BANNER);
    await expect(bar).toBeVisible();
    // Da sm: il paragrafo lungo torna visibile e quello breve sparisce.
    await expect(bar.getByText(/cookie statistici \(Google Analytics/)).toBeVisible();
    await expect(bar.getByText(/Cookie tecnici \+ statistici/)).toBeHidden();
    // Altezza libera (non vincolata dalla barra): il banner completo.
    const box = await bar.boundingBox();
    expect(box!.height).toBeGreaterThan(80);
  });
});
