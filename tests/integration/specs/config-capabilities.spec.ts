import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";

// Configuration framework Phases C–D (docs/participation-expansion/14): an
// admin gives a synthetic organisation the Event organiser template from the
// organisation record page (review, impact, reason, save), the change is
// audited, and the partner's own workspace and API follow it. Synthetic
// organisation and owner only; QA_VENDOR's organisation is never changed.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-CAPABILITIES: admin applies a template with review; the partner workspace and API follow it", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const orgId = randomUUID(), ownerId = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_cfg_${ownerId.slice(0, 8)}@example.test`;
    await f.connection.execute("INSERT INTO organisations (id, name, kind) VALUES (?, 'QA Cultural Association', 'vendor')", [orgId]);
    await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, business_name, org_id, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', 'QA Cfg Owner', 'QA Cultural Association', ?, 0)", [ownerId, email, bcrypt.hashSync(password, 10), orgId]);
    f.track("organisations", "id", orgId); f.track("feature_flags", "org_id", orgId); f.track("org_capability_limits", "org_id", orgId);
    f.track("audit_log", "object_id", orgId); f.track("users", "id", ownerId); f.track("sessions", "user_id", ownerId);

    const admin = await staffActor(browser, "QA_ADMIN");
    try {
      const { page } = admin;
      await page.goto(`/admin?tab=organisations&record=org:${orgId}`);
      await expect(page.getByRole("heading", { name: "QA Cultural Association" })).toBeVisible();
      await expect(page.getByText("Community centres and rooms")).toBeVisible();
      await page.getByLabel("Starting template").selectOption("event_organiser");
      await expect(page.getByLabel("Community centres and rooms")).not.toBeChecked();
      await expect(page.getByLabel("Community events")).toBeChecked();
      await page.getByRole("button", { name: "Review capability changes" }).click();
      const review = page.getByRole("region", { name: "Review the change" });
      await expect(review).toContainText("Switching off");
      await expect(review).toContainText("Community centres and rooms");
      await expect(review).toContainText("Programmes");
      await page.getByLabel(/^Reason/).fill("Onboarding a cultural association");
      await shot(page, "01-admin-review");
      await page.getByRole("button", { name: "Save capabilities" }).click();
      await expect(page.getByRole("button", { name: "Review capability changes" })).toBeVisible();
      await shot(page, "02-admin-saved");
      expect(admin.consoleErrors).toEqual([]);
    } finally { await admin.close(); }

    const flags = await rows(f, "SELECT flag_key, enabled FROM feature_flags WHERE org_id = ? ORDER BY flag_key", [orgId]);
    // Only real changes are stored: what the template turns off. Capabilities it keeps stay at the default (no row).
    expect(Object.fromEntries(flags.map((r) => [r.flag_key, r.enabled]))).toEqual({ clubs: 0, open_booking: 0, programs: 0, venues: 0, volunteering: 0 });
    const [audit] = await rows(f, "SELECT reason, new_value FROM audit_log WHERE object_id = ? AND action = 'org.capabilities_changed'", [orgId]);
    expect(audit.reason).toBe("Onboarding a cultural association");
    expect(JSON.parse(audit.new_value).template).toBe("event_organiser");

    const partner = await staffActor(browser, "QA_CFG", { credentials: { email, password } });
    try {
      const { page } = partner;
      expect((await partner.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
      await page.goto("/vendor");
      const nav = page.getByRole("navigation").filter({ hasText: "Overview" }).first();
      const item = (name: string) => nav.locator("a, button").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) });
      await expect(item("Experiences")).toBeVisible();
      // "Listings" is also a group heading; the nav item itself must be gone.
      await expect(item("Listings")).toHaveCount(0);
      await expect(item("Programmes")).toHaveCount(0);
      await shot(page, "03-partner-nav");
      const centre = await page.request.post("/api/vendor/centres", { data: { name: "Not allowed" } });
      expect([centre.status(), (await centre.json()).capabilityOff]).toEqual([403, "venues"]);
      const org = await (await page.request.get("/api/vendor/org")).json();
      expect(org.capabilities).toMatchObject({ venues: false, programs: false, experiences: true });
      expect(partner.consoleErrors).toEqual([]);
    } finally { await partner.close(); }
  });
});
