import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableClub, bookableProgram, irelandDate } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Phase H (docs/participation-expansion/19): the one form builder on a club,
// a hall and a programme — the partner adds questions on the listing's own
// Questions tab / section and publishes; a guest answers them inside the
// usual registration, booking and enrolment flows (phone width); the answers
// are stored with the order and listed for the partner. Synthetic listings of
// QA_VENDOR, free or cash (no payment provider).

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

async function ownQuestion(page: Page, q: { label: string; why: string; asked?: "booking" | "attendee"; type: string; choices?: string; who?: "all" | "adult" | "child"; required?: boolean }) {
  await page.getByRole("button", { name: "Add your own question" }).click();
  await page.getByLabel(/^Question\b/).last().fill(q.label);
  await page.getByLabel(/^Why you're asking/).last().fill(q.why);
  if (q.asked) await page.getByLabel(/^Asked$/).last().selectOption(q.asked);
  await page.getByLabel(/^Answer$/).last().selectOption(q.type);
  if (q.choices) await page.getByLabel(/^Choices/).last().fill(q.choices);
  if (q.who) await page.getByLabel(/^Who answers/).last().selectOption(q.who);
  if (q.required) await page.getByLabel("Must be answered").last().check();
}
const seedDraft = (page: Page, key: string, value: Record<string, unknown>) =>
  page.addInitScript(([k, v]) => { try { sessionStorage.setItem(`hc_booking_draft:${k}`, JSON.stringify({ savedAt: Date.now(), value: v })); } catch { /* storage unavailable */ } }, [key, value] as const);

test("CFG-UNIVERSAL: club, hall and programme forms — partner publishes, guest answers in the usual flow, partner reads the answers", async ({ playwright, browser }) => {
  test.setTimeout(300_000);
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.attendees": true });
    try {
      const clubId = await bookableClub(f, { price: 0, payment: "cash" });
      await f.connection.execute("UPDATE clubs SET audience = 'kids' WHERE id = ?", [clubId]);
      const centre = await bookableCentre(f, { payment: "cash", rate: 20, cap: 10 });
      const program = await bookableProgram(f, { price: 0 });
      const sessionId = randomUUID();
      await f.connection.execute("INSERT INTO program_sessions (id, program_id, date, time) VALUES (?, ?, ?, '10:00')", [sessionId, program.id, irelandDate(10)]);
      f.track("program_sessions", "id", sessionId);
      for (const lid of [clubId, centre.id, program.id]) for (const [t, c] of [["registration_questions", "listing_id"], ["registration_form_drafts", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, lid);

      // --- partner: three listings, one builder ---------------------------------
      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        page.setDefaultTimeout(15_000);
        // Club: a question about the child and one for the guardian.
        await page.goto(`/vendor/clubs/${clubId}`);
        await page.getByRole("tab", { name: "Questions" }).or(page.getByRole("button", { name: "Questions" })).first().click();
        await ownQuestion(page, { label: "Kit size", why: "So we order the right kit", asked: "attendee", type: "select", choices: "Small\nMedium\nLarge", who: "child", required: true });
        await ownQuestion(page, { label: "How did you hear about us?", why: "To know what works", asked: "booking", type: "radio", choices: "A friend\nSocial media\nSchool" });
        await page.getByRole("button", { name: "Preview" }).click();
        await expect(page.getByRole("region", { name: "Form preview" }).getByText(/a sample child/)).toBeVisible();
        await shot(page, "20-club-builder-preview");
        await page.getByRole("button", { name: "Close preview" }).click();
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Published as version 1" })).toBeVisible();
        // A repeat of the club form's own fields is refused when published.
        await ownQuestion(page, { label: "Date of birth", why: "Age groups", asked: "attendee", type: "date" });
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByText(/already asks for this/).first()).toBeVisible();
        // The refused draft stays a draft (never live); the live form is still version 1.
        expect((await (await page.request.get(`/api/clubs/${clubId}`)).json()).registrationForm.questions).toHaveLength(2);

        // Hall: once per booking only.
        await page.goto(`/vendor/centres/${centre.id}`);
        await page.getByRole("tab", { name: "Questions" }).or(page.getByRole("button", { name: "Questions" })).first().click();
        await ownQuestion(page, { label: "Will you need the kitchen?", why: "So the caretaker opens it", type: "radio", choices: "Yes\nNo", required: true });
        await expect(page.getByLabel(/^Asked$/).last().locator("option")).toHaveText(["Once per booking"]);
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Published as version 1" })).toBeVisible();
        await shot(page, "21-hall-builder-published");

        // Programme: a children-only question.
        await page.goto(`/vendor/programs/${program.id}`);
        await expect(page.getByRole("heading", { name: "Enrolment questions" })).toBeVisible();
        await ownQuestion(page, { label: "Swimming level", why: "To put people in the right group", asked: "attendee", type: "radio", choices: "New to it\nConfident", who: "child", required: true });
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Published as version 1" })).toBeVisible();
        expect(staff.consoleErrors).toEqual([]);
      } finally { await staff.close(); }

      // --- guest on a phone: the usual flows with the questions in them ---------
      // A signed-in resident (the launch gate admits residents; the flows are the same for guests).
      const guest = await uiActor(browser, "QA_USER", "mobile");
      try {
        const { page } = guest;
        page.setDefaultTimeout(15_000);
        const email = `qa_uf_${randomUUID().slice(0, 6)}@example.test`;
        // Club registration: the questions sit on the review step.
        await seedDraft(page, `club:${clubId}`, { registrantType: "child", first: "Aoife", last: "QA", dob: "2016-05-01", team: "U10", contact: { name: "QA Parent", email, phone: "0850000000" }, ecName: "QA Gran", ecPhone: "0850000001", ecRel: "Grandparent" });
        await page.goto(`/register/${clubId}`);
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText("A few questions from the organiser")).toBeVisible();
        await page.getByRole("checkbox", { name: /I consent/ }).check();
        // A required answer is asked for before anything is sent.
        await page.getByRole("button", { name: /Confirm registration/ }).click();
        await expect(page.getByText(/answer "Kit size"/).first()).toBeVisible();
        await page.getByLabel(/^Kit size/).selectOption("Medium");
        await page.getByRole("radio", { name: "A friend" }).check();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, "22-guest-club-questions-phone");
        await page.getByRole("button", { name: /Confirm registration/ }).click();
        await expect.poll(async () => (await rows(f, "SELECT ref FROM registrations WHERE club_id = ?", [clubId])).length).toBe(1);
        const [{ ref: regRef }] = (await rows(f, "SELECT ref FROM registrations WHERE club_id = ?", [clubId])) as { ref: string }[];
        for (const t of ["registration_answers", "order_acknowledgements"]) f.track(t, "source_ref", regRef);
        f.track("registrations", "ref", regRef);
        const regAnswers = await rows(f, "SELECT attendee_no, label_snapshot, value_text FROM registration_answers WHERE source_type = 'registration' AND source_ref = ? ORDER BY attendee_no", [regRef]);
        expect(regAnswers.map((a) => [a.attendee_no, a.label_snapshot, a.value_text])).toEqual([[0, "How did you hear about us?", "A friend"], [1, "Kit size", "Medium"]]);

        // Hall booking: the question is on the details step.
        await seedDraft(page, `venue:${centre.id}`, { roomId: centre.room, date: irelandDate(16), time: "10:00", duration: 1, eventType: "Party", guests: 3, contact: { name: "QA Hall Booker", email, phone: "0850000000" }, notes: "" });
        await page.goto(`/book/${centre.id}`);
        await page.getByRole("button", { name: "Continue" }).click();
        await expect(page.getByText("A few questions from the venue")).toBeVisible();
        await page.getByRole("radio", { name: "Yes" }).check();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, "23-guest-hall-question-phone");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.getByRole("checkbox").last().check();
        await page.getByRole("button", { name: /Confirm booking/ }).click();
        await expect.poll(async () => (await rows(f, "SELECT ref FROM bookings WHERE centre_id = ?", [centre.id])).length).toBe(1);
        const [{ ref: hallRef }] = (await rows(f, "SELECT ref FROM bookings WHERE centre_id = ?", [centre.id])) as { ref: string }[];
        for (const t of ["registration_answers", "order_acknowledgements"]) f.track(t, "source_ref", hallRef);
        expect((await rows(f, "SELECT attendee_no, value_text FROM registration_answers WHERE source_type = 'booking' AND source_ref = ?", [hallRef])).map((a) => [a.attendee_no, a.value_text])).toEqual([[0, "Yes"]]);

        // Programme enrolment: a child is asked; the question appears once a date of birth says so.
        await page.goto(`/programs/${program.id}`);
        await page.getByRole("button", { name: "Enrol", exact: true }).filter({ visible: true }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.locator("#prog-participant").fill("Cian QA");
        await expect(dialog.getByText("Swimming level")).toHaveCount(0);
        await dialog.locator("#prog-dob").fill("2015-06-01");
        await dialog.getByRole("radio", { name: "Confident" }).check();
        await dialog.locator("#prog-email").fill(email);
        await dialog.locator("#prog-terms").check();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, "24-guest-programme-question-phone");
        await dialog.getByRole("button", { name: "Enrol", exact: true }).click();
        await expect.poll(async () => (await rows(f, "SELECT ref FROM program_enrollments WHERE program_id = ?", [program.id])).length).toBe(1);
        const [{ ref: progRef }] = (await rows(f, "SELECT ref FROM program_enrollments WHERE program_id = ?", [program.id])) as { ref: string }[];
        for (const t of ["registration_answers", "order_acknowledgements"]) f.track(t, "source_ref", progRef);
        expect((await rows(f, "SELECT attendee_no, value_text FROM registration_answers WHERE source_type = 'program' AND source_ref = ?", [progRef])).map((a) => [a.attendee_no, a.value_text])).toEqual([[1, "Confident"]]);
        expect(guest.consoleErrors).toEqual([]);
      } finally { await guest.close(); }

      // --- partner reads the club answers -------------------------------------
      const review = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = review;
        page.setDefaultTimeout(15_000);
        await page.goto(`/vendor/clubs/${clubId}`);
        await page.getByRole("tab", { name: "Questions" }).or(page.getByRole("button", { name: "Questions" })).first().click();
        const answers = page.getByRole("region", { name: "Answers" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Answers" }) })).first();
        await expect(answers.getByText("Aoife QA")).toBeVisible();
        await expect(answers.getByText("Medium")).toBeVisible();
        await shot(page, "25-club-answers-partner");
        expect(review.consoleErrors).toEqual([]);
      } finally { await review.close(); }
    } finally {
      await restoreSwitches();
    }
  });
});
