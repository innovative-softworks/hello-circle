import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";
import { connectedPreflight } from "../runtime";

// Trust & Retention — venue and club "What to expect" in the isolated QA
// environment. The runner sets VITE_VENUE_PAGES_PUBLIC=true for this batch's
// child process only (tests/integration/run.ts); dev and launch flags are
// unchanged. The partner sets "who welcomes newcomers" through the real
// editor endpoints; the page is read signed out at 1280, 820 and 375 px.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "trust");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("Trust venue/club: what to expect, newcomer line, missing vs not applicable, responsive and keyboard", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const tag = randomUUID().slice(0, 8);
    const vendor = personas.QA_VENDOR.id;
    const centreId = `qa-trust-centre-${tag}`;
    const clubId = `qa-trust-club-${tag}`;
    await f.connection.execute(
      "INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, opens_at, closes_at, accessibility) VALUES (?, ?, 'Rathmines', 'Dublin', 0, 0, 40, 2000, 'Pat', '', '', 'A hall for trust QA.', ?, 'approved', '09:00', '21:00', 'Step-free entrance')",
      [centreId, `QA Trust Hall ${tag}`, vendor]
    );
    await f.connection.execute(
      "INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, audience) VALUES (?, ?, 'Rowing', 'Ringsend', 'Dublin', '18+', 120, 'year', 1, '', '', 'A club for trust QA.', ?, 'approved', 'adults')",
      [clubId, `QA Trust Rowing ${tag}`, vendor]
    );
    for (const [t, c, id] of [["centres", "id", centreId], ["rooms", "centre_id", centreId], ["clubs", "id", clubId], ["listing_attributes", "listing_id", clubId], ["audit_log", "object_id", centreId], ["audit_log", "object_id", clubId]]) f.track(t, c, id);

    // Real partner save paths, including the refusal of contact details.
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/centres/${centreId}`, { data: { newcomerWelcome: "Ring 087 123 4567" } })).status()).toBe(400);
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/centres/${centreId}`, { data: { newcomerWelcome: `Pat, the caretaker, opens up and shows first-time hirers around ${tag}` } })).status()).toBe(200);
    const club = await f.actors.QA_VENDOR.put(`/api/vendor/participation/club/${clubId}`, { data: { attributes: ["come_alone", "beginner_friendly"], newcomerWelcome: `Coach Niamh meets newcomers at the boathouse door ${tag}` } });
    expect(club.status()).toBe(200);

    const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, serviceWorkers: "block" });
    await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
    await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
    const page = await context.newPage();
    try {
      for (const w of [1280, 820, 375]) {
        await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
        await page.goto(`/centres/${centreId}`);
        const venue = page.getByRole("region", { name: "Before you book" });
        await expect(venue).toBeVisible();
        await expect(venue).toContainText(`Pat, the caretaker, opens up and shows first-time hirers around ${tag}`);
        await expect(venue).toContainText("Step-free entrance");
        await expect(venue).toContainText("Not applicable"); // beginners / on your own: a room hire
        await expect(venue).toContainText("Not provided by the venue"); // facilities left empty
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await shot(page, `venue-${w}`);

        await page.goto(`/clubs/${clubId}`);
        const clubSection = page.getByRole("region", { name: "What to expect" });
        await expect(clubSection).toBeVisible();
        await expect(clubSection).toContainText(`Coach Niamh meets newcomers at the boathouse door ${tag}`);
        await expect(clubSection).toContainText("Adults · ages 18+");
        await expect(clubSection).toContainText("people often come on their own");
        await expect(clubSection).toContainText("Not provided by the club"); // first-timers, accessibility, included
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await shot(page, `club-${w}`);
      }
      // Keyboard: the support link at the end of the list is reachable and shows focus.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/centres/${centreId}`);
      const support = page.getByRole("region", { name: "Before you book" }).getByRole("link", { name: "contact HelloCircle support" });
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await support.evaluate((el) => el === document.activeElement);
      }
      expect(reached, "support link reachable by Tab").toBe(true);
      const focus = await support.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { fv: el.matches(":focus-visible"), outline: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, shadow: cs.boxShadow, focusVar: getComputedStyle(document.documentElement).getPropertyValue("--color-focus"), parent: el.parentElement?.className };
      });
      const checked = await connectedPreflight();
      await checked.connection.end();
      (await import("node:fs")).writeFileSync(path.join(checked.manifest.dataDir, "evidence", "trust", "focus-debug.json"), JSON.stringify(focus));
      const outline = focus.outline;
      expect(outline).not.toBe("none");
    } finally {
      await context.close();
    }
  });
});
