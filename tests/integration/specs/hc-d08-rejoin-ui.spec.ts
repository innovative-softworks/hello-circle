import { mkdirSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { syntheticOrg } from "../org-fixture";
import { connectedPreflight } from "../runtime";

// D-08 follow-up — the returning-member invitation form in the browser: a
// removed team member opens a fresh invitation, sees the rejoin variant (no
// new account fields, their existing password), gets an inline error for a
// wrong password (nothing changes), then rejoins. Synthetic data only.
// Limiter (10 per IP; accept-invite counts): owner login + 3 acceptances = 4.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function visitor(browser: Browser, mobile: boolean) {
  const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile && browser.browserType().name() !== "firefox", hasTouch: mobile, serviceWorkers: "block" });
  await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
  await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  return { context, page: await context.newPage() };
}

test("D08-REJOIN-UI: a removed member's fresh invitation asks for their existing password; a wrong one is refused inline, the right one rejoins", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, [], async (f) => {
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager"], ["owner"]);
      const [owner, member] = [org.owner, org.staff[0]];
      const rv = Number((await rows(f, "SELECT row_version FROM users WHERE id = ?", [member.id]))[0].row_version);
      expect((await owner.ctx!.delete(`/api/vendor/org/staff/${member.id}`, { data: { rowVersion: rv } })).status()).toBe(200);
      expect((await owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: member.email, platformRole: "finance" } })).status()).toBe(201);
      const [{ token }] = await rows(f, "SELECT token FROM org_invites WHERE org_id = ? AND LOWER(email) = ? AND status = 'pending'", [org.id, member.email]);
      f.track("org_invites", "token", token);
      f.track("audit_log", "object_id", member.id);

      for (const mobile of [true, false]) {
        const v = await visitor(browser, mobile);
        try {
          const page = v.page;
          await page.goto(`/accept-invite?token=${token}`);
          await expect(page.getByText(/You already have a HelloCircle account/)).toBeVisible();
          await expect(page.getByText(/invited back as/)).toBeVisible();
          await expect(page.getByLabel("Your name")).toHaveCount(0); // no new-account fields
          const password = page.getByLabel("Your HelloCircle password");
          await expect(password).toBeVisible();
          await expect(password).toHaveAttribute("autocomplete", "current-password");
          if (mobile) await shot(page, "d08-rejoin-form-mobile");
          await password.fill("not-the-password-123");
          await page.getByLabel(/I agree to HelloCircle/).check();
          await page.getByRole("button", { name: /Accept & rejoin/ }).click();
          await expect(page.getByText("That isn't the password for your HelloCircle account")).toBeVisible();
          await expect(page).toHaveURL(/accept-invite/);
          expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [member.id]))[0].org_id, "a wrong password changes nothing").toBeNull();
          await shot(page, `d08-rejoin-wrong-password${mobile ? "-mobile" : ""}`);
          if (mobile) continue;

          await password.fill(member.password);
          await page.getByRole("button", { name: /Accept & rejoin/ }).click();
          await page.waitForURL(/\/vendor/);
          expect((await rows(f, "SELECT org_id, platform_role FROM users WHERE id = ?", [member.id]))[0]).toEqual({ org_id: org.id, platform_role: "finance" });
          await shot(page, "d08-rejoin-success");
          // The used link now shows the invalid state.
          await page.goto(`/accept-invite?token=${token}`);
          await expect(page.getByText(/no longer valid/i).first()).toBeVisible();
        } finally {
          await v.context.close();
        }
      }
      await evidence("d08-rejoin-ui", { rejoinVariant: true, wrongPassword: "inline error, unchanged", success: "/vendor", usedLink: "invalid" });
    });
  } finally {
    for (const c of opened) await c.dispose();
  }
});
