import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";
import { businessUiActor } from "../product-fixture";
import { stripeUiActor } from "../stripe-fixture";
import { connectedPreflight } from "../runtime";

// Trust & Retention — organiser → confirmed attendee → review, through the
// real partner and resident UIs in the isolated QA environment. A past group
// booking (3 people) was checked in at the door; that alone doesn't open a
// review. The partner confirms the holder (only), the resident sees
// "Attendance confirmed — you can review it", reviews, and sees "Review
// submitted". No email leaves the QA backend (no SMTP).

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "trust");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("Trust confirm: the organiser confirms the holder of a group booking and the resident reviews without a request", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const tag = randomUUID().slice(0, 8);
    const resident = personas.QA_USER.id;
    const expId = `qa-trust-exp-${tag}`;
    const sessId = `qa-trust-sess-${tag}`;
    const ref = `QA-TC-${tag}`;
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await f.connection.execute(
      `INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
       VALUES (?, ?, ?, 'Howth', 'Dublin', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved')`,
      [expId, personas.QA_VENDOR.id, `QA Trust Kayak ${tag}`]
    );
    await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')", [sessId, expId, past]);
    await f.connection.execute(
      "INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, ?, 'Róisín Holder', ?, '', 3, 0, 'paid', 'confirmed')",
      [ref, expId, sessId, `qa-trust-client-${tag}`, resident, env.QA_USER_EMAIL]
    );
    await f.connection.execute("INSERT INTO attendance (kind, ref, status, source) VALUES ('experience', ?, 'present', 'qr')", [ref]);
    for (const [t, c, id] of [
      ["experiences", "id", expId], ["experience_sessions", "experience_id", expId], ["experience_bookings", "ref", ref], ["attendance", "ref", ref],
      ["attendance_corrections", "ref", ref], ["reviews", "listing_id", expId],
    ]) f.track(t, c, id);

    const res = await stripeUiActor(browser, "QA_USER", "desktop");
    const partner = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      // Resident before: the door check-in doesn't open a review.
      await res.page.goto(`/bookings/experience/${ref}`);
      await expect(res.page.getByText(/checked the booking in, but their record doesn't say who came/)).toBeVisible();
      await expect(res.page.getByText("Not confirmed yet")).toBeVisible();

      // Partner confirms the holder only.
      const p = partner.page;
      await p.goto("/vendor?tab=bookings");
      const panel = p.getByRole("region", { name: /Confirm who attended/ }).or(p.locator("section", { hasText: "Confirm who attended" })).first();
      const row = p.locator("li", { hasText: `QA Trust Kayak ${tag}` });
      await expect(row).toContainText("Róisín Holder");
      await expect(row).toContainText("booked for 3 people");
      await expect(row).toContainText("Booking checked in at the door");
      await shot(p, "confirm-panel-before");
      await row.getByRole("button", { name: /Confirm Róisín Holder attended/ }).click();
      const dialog = p.getByRole("alertdialog");
      await expect(dialog).toContainText("doesn't mark the other 2 people");
      await page_keyboard_escape_check(p, dialog);
      await row.getByRole("button", { name: /Confirm Róisín Holder attended/ }).click();
      await dialog.getByRole("button", { name: "Confirm attended" }).click();
      await expect(p.getByText("Róisín Holder is confirmed.")).toBeVisible();
      await expect(panel).toBeVisible();
      const [conf] = await f.connection.query<any[]>("SELECT id, origin, resident_id FROM attendance_corrections WHERE kind = 'experience' AND ref = ? AND status = 'accepted'", [ref]);
      expect(conf).toHaveLength(1);
      expect(conf[0]).toMatchObject({ origin: "organiser", resident_id: resident });
      f.track("audit_log", "object_id", String(conf[0].id));
      f.track("notifications", "ref", String(conf[0].id));

      // Resident after: confirmed, review available, no request needed.
      await res.page.goto(`/bookings/experience/${ref}`);
      await expect(res.page.getByText("Attendance confirmed — you can review it")).toBeVisible();
      f.track("review_invitations", "occurrence_ref", ref);
      f.track("notifications", "ref", `experience/${ref}`);
      await shot(res.page, "confirm-resident-available");
      await res.page.getByRole("link", { name: "Review this visit" }).click();
      await res.page.getByRole("radio", { name: "5 stars" }).check();
      await res.page.getByLabel(/Name to show/).fill("Róisín");
      await res.page.getByRole("button", { name: "Post review" }).click();
      await expect(res.page.getByText("Thanks — your review is live.")).toBeVisible();
      await expect(res.page.getByText("Verified attendance").first()).toBeVisible();
      await res.page.goto(`/bookings/experience/${ref}`);
      await expect(res.page.getByText("Review submitted")).toBeVisible();
      await shot(res.page, "confirm-resident-submitted");
      const [rv] = await f.connection.query<any[]>("SELECT id FROM reviews WHERE listing_id = ?", [expId]);
      f.track("review_claims", "review_id", String(rv[0].id));

      // Partner list now shows confirmed + review submitted.
      await p.goto("/vendor?tab=bookings");
      await p.getByRole("button", { name: /Last 60 days/ }).click();
      await expect(p.locator("li", { hasText: `QA Trust Kayak ${tag}` })).toContainText("Review submitted");
      await shot(p, "confirm-panel-after");
    } finally {
      await res.close();
      await partner.close();
    }
  });
});

async function page_keyboard_escape_check(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  await expect.poll(() => page.evaluate(() => !!document.querySelector('[role="alertdialog"]')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
