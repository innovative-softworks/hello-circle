import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableExperience, irelandDate } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Configuration framework Phase G (docs/participation-expansion/17): the visual
// form builder end to end — the category's suggested template fills a draft,
// the partner adds a question shown only on a "Yes", previews desktop and
// phone, publishes, checks the history, saves/duplicates/archives an own
// template; a guest answers the live form (condition and sections); a second
// published version leaves the guest's earlier answers as they were.
// Synthetic listing of QA_VENDOR; the seeded category's suggested form is
// restored afterwards.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-FORMS: template → draft → condition → preview → publish → history → templates → guest answers → new version keeps old answers", async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.events": true, "participation.attendees": true });
    const [cat] = await rows(f, "SELECT suggested_form FROM taxonomy_categories WHERE id = 'culture-faith-celebrations'", []);
    await f.connection.execute("UPDATE taxonomy_categories SET suggested_form = 'event_registration' WHERE id = 'culture-faith-celebrations'");
    try {
      const exp = await bookableExperience(f, { price: 0, capacity: 20, payment: "cash", date: irelandDate(9) });
      await f.connection.execute("UPDATE experiences SET kind = 'event' WHERE id = ?", [exp.id]);
      await f.connection.execute("INSERT INTO listing_taxonomy (listing_type, listing_id, category_id, subcategory_id, assigned_by) VALUES ('experience', ?, 'culture-faith-celebrations', NULL, 'admin')", [exp.id]);
      for (const [t, c] of [["registration_questions", "listing_id"], ["registration_form_drafts", "listing_id"], ["listing_taxonomy", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, exp.id);

      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        await page.goto(`/vendor/experiences/${exp.id}`);
        await page.getByRole("button", { name: "Questions" }).or(page.getByRole("tab", { name: "Questions" })).first().click();
        // The category's suggested template comes first and fills the draft.
        const picker = page.getByLabel("Start from a template");
        await expect(picker.locator("option").nth(1)).toContainText("suggested for this category");
        await picker.selectOption({ label: "Event registration — suggested for this category" });
        await expect(page.getByText(/Draft filled from "Event registration"/)).toBeVisible();
        await expect(page.getByRole("heading", { name: "Getting there" })).toBeVisible();
        // A question shown only when the guest stays for lunch.
        await page.getByRole("button", { name: "Add your own question" }).click();
        await page.getByLabel(/^Question\b/).last().fill("Will you stay for lunch?");
        await page.getByLabel(/^Why you're asking/).last().fill("Catering numbers");
        await page.getByLabel(/^Asked$/).last().selectOption("booking");
        await page.getByLabel(/^Answer$/).last().selectOption("radio");
        await page.getByLabel(/^Choices/).last().fill("Yes\nNo");
        await page.getByLabel(/^Section/).last().fill("Lunch");
        await page.getByRole("button", { name: "Add your own question" }).click();
        await page.getByLabel(/^Question\b/).last().fill("How many lunch portions?");
        await page.getByLabel(/^Why you're asking/).last().fill("Catering numbers");
        await page.getByLabel(/^Asked$/).last().selectOption("booking");
        await page.getByLabel(/^Answer$/).last().selectOption("number");
        await page.getByLabel(/^Section/).last().fill("Lunch");
        await page.getByLabel(/^Only show when/).last().selectOption({ label: "Will you stay for lunch?" });
        await page.getByRole("checkbox", { name: "Yes", exact: true }).last().check();
        await page.getByLabel("Must be answered").last().check();
        await page.getByRole("button", { name: "Save draft" }).click();
        await expect(page.getByText(/Draft saved/).first()).toBeVisible();
        // Nothing is live yet.
        const pub0 = await (await page.request.get(`/api/experiences/${exp.id}`)).json();
        expect(pub0.registration.attendeeDetails.questions).toEqual([]);
        // Preview: the portions question appears only after "Yes".
        await page.getByRole("button", { name: "Preview" }).click();
        const pv = page.getByRole("region", { name: "Form preview" });
        await expect(pv.getByText("How many lunch portions?")).toHaveCount(0);
        await pv.getByRole("radio", { name: "Yes" }).check();
        await expect(pv.getByText(/How many lunch portions\?/)).toBeVisible();
        await shot(page, "10-builder-preview-desktop");
        await pv.getByLabel("Phone").check();
        await shot(page, "11-builder-preview-phone");
        await page.getByRole("button", { name: "Close preview" }).click();
        // Publish, then the history.
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Published as version 1" })).toBeVisible();
        await page.getByText("Version history").click();
        await expect(page.getByText(/Version 1 · live/)).toBeVisible();
        // Own templates: save, duplicate, archive the copy.
        await page.getByText(/^Your templates/).click();
        await page.getByLabel("Save this form as a template").fill("QA Vratham form");
        await page.getByRole("button", { name: "Save as template" }).click();
        await expect(page.getByText(/Saved as template "QA Vratham form"/)).toBeVisible();
        await page.getByRole("button", { name: "Duplicate QA Vratham form" }).click();
        await page.getByRole("button", { name: "Archive QA Vratham form (copy)" }).click();
        await expect(page.getByText(/QA Vratham form \(copy\).*archived/)).toBeVisible();
        await shot(page, "12-builder-published");
        const templates = await rows(f, "SELECT id, name, status FROM registration_form_templates WHERE name LIKE 'QA Vratham form%' ORDER BY name", []);
        for (const t of templates) f.track("registration_form_templates", "id", t.id);
        expect(templates.map((t) => [t.name, t.status])).toEqual([["QA Vratham form", "active"], ["QA Vratham form (copy)", "archived"]]);
        expect(staff.consoleErrors).toEqual([]);
      } finally { await staff.close(); }

      // Guest on a phone: sections, and the lunch rule.
      const guest = await uiActor(browser, null, "mobile");
      let ref = "";
      try {
        const { page } = guest;
        await page.goto(`/events/${exp.id}`);
        await page.waitForTimeout(600);
        await page.locator(".mobile-join-bar").getByRole("button", { name: "Register for this event" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.locator('input[autocomplete="name"]').fill("QA Forms Guest");
        await expect(dialog.getByRole("heading", { name: "Lunch" })).toBeVisible();
        await expect(dialog.getByText("How many lunch portions?")).toHaveCount(0);
        await dialog.getByRole("radio", { name: "Yes" }).check();
        await dialog.getByLabel(/^How many lunch portions/).fill("2");
        await dialog.locator('input[type="email"]').first().fill("qa_forms@example.test");
        await dialog.getByRole("checkbox", { name: /^I agree to the booking terms/ }).check();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, "13-guest-conditional-phone");
        await dialog.getByRole("button", { name: /^(Register|Continue to pay)$/ }).click();
        await expect(page.getByRole("heading", { name: "You're booked." })).toBeVisible();
        const clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id"));
        [{ ref }] = (await rows(f, "SELECT ref FROM experience_bookings WHERE experience_id = ? AND client_id = ?", [exp.id, clientId])) as { ref: string }[];
        for (const [t, c] of [["registration_answers", "source_ref"], ["booking_attendees", "source_ref"], ["order_acknowledgements", "source_ref"], ["experience_booking_participants", "booking_ref"]]) f.track(t, c, ref);
        const answers = await rows(f, "SELECT label_snapshot, value_text FROM registration_answers WHERE source_ref = ? ORDER BY id", [ref]);
        expect(answers.map((a) => [a.label_snapshot, a.value_text])).toEqual(expect.arrayContaining([["Will you stay for lunch?", "Yes"], ["How many lunch portions?", "2"]]));
        expect(guest.consoleErrors).toEqual([]);
      } finally { await guest.close(); }

      // A new version without the portions question leaves the guest's answer as given.
      const api = await staffActor(browser, "QA_VENDOR");
      try {
        const live = await (await api.context.request.get(`/api/vendor/experiences/${exp.id}/questions`)).json();
        const kept = live.questions.filter((q: { label: string }) => q.label !== "How many lunch portions?");
        expect((await api.context.request.put(`/api/vendor/experiences/${exp.id}/questions/draft`, { data: { questions: kept } })).status()).toBe(200);
        const pub = await api.context.request.post(`/api/vendor/experiences/${exp.id}/questions/publish`);
        expect((await pub.json()).version).toBe(2);
      } finally { await api.close(); }
      const [still] = await rows(f, "SELECT label_snapshot, value_text, questions_version FROM registration_answers WHERE source_ref = ? AND label_snapshot = 'How many lunch portions?'", [ref]);
      expect(still).toMatchObject({ value_text: "2", questions_version: 1 });
    } finally {
      await f.connection.execute("UPDATE taxonomy_categories SET suggested_form = ? WHERE id = 'culture-faith-celebrations'", [cat.suggested_form ?? null]);
      await restoreSwitches();
    }
  });
});
