import { test, expect } from "../fixtures/browser";

test("QA-SMK-002: landing assets and partner navigation @mock", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Get discovered.*Get booked.*Grow your community/i })).toBeVisible();
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  const logo = await page.request.get("/favicon.svg");
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toContain("image/svg+xml");
  await page.getByRole("link", { name: /Already list with us.*Partner sign in/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Manage your HelloCircle business" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("QA-AUTH-001a: resident sign-in form and account navigation @mock", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/signin\/create$/);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
});

for (const destination of ["/vendor", "/admin"]) {
  test(`QA-AUTH-011a: guest ${destination} redirects to login @mock`, async ({ page }) => {
    await page.goto(destination);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Manage your HelloCircle business" })).toBeVisible();
  });
}

test("QA-UX-001a: sign-in form fits the configured viewport @mock", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
});
