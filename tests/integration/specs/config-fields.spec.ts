import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor } from "../lifecycle-ui-fixture";
import { bookableExperience, irelandDate } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Configuration framework Phase F (docs/participation-expansion/16): the field
// registry end to end. Admin switches on an admin-only ready-made field
// (restored afterwards); the partner builds a form from a ready-made field and
// their own multi-select question, and is refused an identity-document
// question; a guest answers on the booking form; the partner's export follows
// the export rules. Cash event; QA_VENDOR's own synthetic listing.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-FIELDS: admin field policy, partner ready-made + own fields, sensitive refusal, guest answers, export rules", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.events": true, "participation.attendees": true });
    const admin = await staffActor(browser, "QA_ADMIN");
    const original = await (await admin.context.request.get("/api/admin/fields")).json();
    try {
      const exp = await bookableExperience(f, { price: 0, capacity: 20, payment: "cash", date: irelandDate(12) });
      await f.connection.execute("UPDATE experiences SET kind = 'event' WHERE id = ?", [exp.id]);
      for (const [t, c] of [["registration_questions", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, exp.id);

      // Admin: allow the admin-only "Emergency contact" field.
      const { page: ap } = admin;
      await ap.goto("/admin?tab=settings&section=fields");
      await ap.getByRole("checkbox", { name: "Partners can use Emergency contact (name and phone)" }).check();
      await ap.getByLabel(/^Reason/).fill("QA: emergency contacts for events");
      await shot(ap, "07-admin-field-policy");
      await ap.getByRole("button", { name: "Save field policy" }).click();
      await expect(ap.getByRole("button", { name: "Save field policy" })).toBeDisabled();
      const [audit] = await rows(f, "SELECT reason FROM audit_log WHERE action = 'fields.policy_changed' ORDER BY id DESC LIMIT 1", []);
      expect(audit.reason).toBe("QA: emergency contacts for events");

      // Partner: a ready-made field, then an identity question that's refused, then their own multi-select.
      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        await page.goto(`/vendor/experiences/${exp.id}`);
        await page.getByRole("button", { name: "Questions" }).or(page.getByRole("tab", { name: "Questions" })).first().click();
        await page.getByLabel("Or a ready-made field").selectOption({ label: "T-shirt size" });
        await page.getByRole("button", { name: "Add field" }).click();
        await page.getByRole("button", { name: "Add your own question" }).click();
        await page.getByLabel(/^Question\b/).last().fill("Your PPS number");
        await page.getByLabel(/^Why you're asking/).last().fill("For our records");
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByText(/identity-document details can't be collected/).first()).toBeVisible();
        await page.getByLabel(/^Question\b/).last().fill("Which sessions will you join?");
        await page.getByLabel(/^Why you're asking/).last().fill("To plan numbers for each session");
        await page.getByLabel(/^Answer$/).last().selectOption("multi_select");
        await page.getByLabel(/^Choices/).last().fill("Morning\nAfternoon");
        await page.getByLabel("Include in the attendee export").last().check();
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Published as version" })).toBeVisible();
        await shot(page, "08-partner-fields");
        const saved = await rows(f, "SELECT field_key, input_type, exportable FROM registration_questions WHERE listing_id = ? AND active = 1 ORDER BY sort_order", [exp.id]);
        expect(saved).toEqual([{ field_key: "tshirt_size", input_type: "select", exportable: 0 }, { field_key: null, input_type: "multi_select", exportable: 1 }]);
        expect(staff.consoleErrors).toEqual([]);

        // Guest: answers on the booking form.
        const user = await uiActor(browser, null, "desktop");
        try {
          const g = user.page;
          await g.goto(`/events/${exp.id}`);
          await g.waitForTimeout(600);
          await g.getByRole("button", { name: "Register for this event" }).filter({ visible: true }).first().click();
          const dialog = g.getByRole("dialog");
          await dialog.locator('input[autocomplete="name"]').fill("QA Fields Guest");
          await dialog.getByLabel(/^T-shirt size/).selectOption("M");
          await dialog.getByRole("checkbox", { name: "Morning" }).check();
          await dialog.getByRole("checkbox", { name: "Afternoon" }).check();
          await dialog.locator('input[type="email"]').first().fill("qa_fields@example.test");
          await dialog.getByRole("checkbox", { name: /^I agree to the booking terms/ }).check();
          await shot(g, "09-guest-fields");
          await dialog.getByRole("button", { name: /^(Register|Continue to pay)$/ }).click();
          await expect(g.getByRole("heading", { name: "You're booked." })).toBeVisible();
          const clientId = await g.evaluate(() => localStorage.getItem("hello_circle_client_id"));
          const [booked] = await rows(f, "SELECT ref FROM experience_bookings WHERE experience_id = ? AND client_id = ?", [exp.id, clientId]);
          for (const [t, c] of [["registration_answers", "source_ref"], ["booking_attendees", "source_ref"], ["order_acknowledgements", "source_ref"], ["experience_booking_participants", "booking_ref"]]) f.track(t, c, booked.ref);
          const answers = await rows(f, "SELECT input_type_snapshot AS t, value_text AS v FROM registration_answers WHERE source_ref = ? ORDER BY id", [booked.ref]);
          expect(answers.map((a) => [a.t, a.v])).toEqual(expect.arrayContaining([["select", "M"], ["multi_select", '["Morning","Afternoon"]']]));
          await g.goto(`/bookings/experience/${booked.ref}`);
          await expect(g.getByTestId("booking-people")).toContainText("Morning, Afternoon");
          expect(user.consoleErrors).toEqual([]);
        } finally { await user.close(); }

        // Export: only the question marked exportable (and allowed by the policy).
        const csv = await (await page.request.get(`/api/vendor/experiences/${exp.id}/attendees.csv`)).text();
        expect(csv).toContain('"Which sessions will you join?"');
        expect(csv).toContain('"Morning, Afternoon"');
        expect(csv).not.toContain('"T-shirt size"');
        expect(csv).not.toContain("qa_fields@example.test");
      } finally { await staff.close(); }
    } finally {
      // Put the shared QA field policy back exactly as it was.
      const now = await (await admin.context.request.get("/api/admin/fields")).json();
      const back = await admin.context.request.put("/api/admin/fields/policy", { data: { version: now.policy.version, library: original.policy.library, customTypes: original.policy.customTypes, classes: original.policy.classes, reason: "QA restore" } });
      expect(back.status()).toBe(200);
      await admin.close();
      await restoreSwitches();
    }
  });
});
