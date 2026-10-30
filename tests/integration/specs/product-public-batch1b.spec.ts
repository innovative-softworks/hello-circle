import { env, expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { shot } from "../revenue-fixture";
import { test } from "../lifecycle-fixture";
import { noHorizontalScroll, uiActor } from "../lifecycle-ui-fixture";

// Public-site batch 1, part B (PUB-21/22/23) — its own file so the batch gets
// a fresh backend and stays within the real 10-login password limiter.

test("PUB-21/22/23: Saved copy, credit tab only when enabled, profile email row not clipped on phones", async ({ browser }) => {
  const phone = await uiActor(browser, "QA_USER", "mobile");
  let clipped = true;
  try {
    const { page } = phone;
    await page.goto("/profile?tab=account");
    // Account redesign (2026-10-24): settings rows are .acct-row (stacked on phones).
    const row = page.locator(".acct-row--stack", { hasText: "Used to sign in" });
    const email = row.getByText(env.QA_USER_EMAIL, { exact: true });
    await expect(email).toBeVisible();
    clipped = await email.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.scrollWidth > el.clientWidth + 1 || r.right > window.innerWidth + 1;
    });
    expect(clipped, "email not clipped at 390px").toBe(false);
    // The verification badge sits fully inside the screen width (it used to be cut off).
    const badge = row.getByText(/^\s*(Verified|Not verified)\s*$/);
    await badge.scrollIntoViewIfNeeded();
    const box = (await badge.boundingBox())!;
    expect(box.x >= 0 && box.x + box.width <= 390 + 1, "verification badge within the 390px screen").toBe(true);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, "pub-profile-email-mobile");
  } finally { await phone.close(); }

  const desk = await uiActor(browser, "QA_USER", "desktop");
  try {
    const { page, context } = desk;
    const credits = await (await context.request.get("/api/credits/me")).json() as { enabled: boolean };
    // Saved moved into My Life (sidebar merge 2026-10-24); the old account link redirects there.
    await page.goto("/profile?tab=favourites");
    await expect(page).toHaveURL(/\/bookings\?tab=saved/);
    await expect(page.getByRole("heading", { level: 2, name: /^Saved · \d+$/ })).toBeVisible();
    // Credit is a view of Payments, offered only when the server says credits are on.
    await page.goto("/profile?tab=payment");
    const views = page.getByRole("group", { name: "Payments" });
    await expect(views.getByRole("button", { name: "Cards" })).toBeVisible();
    await expect(views.getByRole("button", { name: "Credit" })).toHaveCount(credits.enabled ? 1 : 0);
    await page.goto("/bookings?tab=saved");
    await expect(page.getByText("Tap the heart on a centre or club to save it here.")).toHaveCount(0);
    const saved = await (await context.request.get("/api/favourites")).json() as unknown[];
    if (saved.length === 0) await expect(page.getByText("Nothing saved yet")).toBeVisible();
    await evidence("pub-21-22-23", { creditsEnabled: credits.enabled, emailClipped: clipped });
  } finally { await desk.close(); }
});
