import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { env, expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableExperience, irelandDate } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Participation Phase 2 (docs/participation-expansion/12) — attendees,
// registration questions and door check-in, in the real browser against the
// isolated QA stack, one test per role. Cash listing (no payment provider).
// Each screen is saved under this test's output folder (phase2-*.png).

type F = Parameters<Parameters<typeof withActors>[2]>[0];
const SW = { "participation.events": true, "participation.options": true, "participation.attendees": true, "participation.checkin": true };

// Screens go to the gitignored QA data folder (copied into docs by hand after review).
const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/phase2-${name}.png`, fullPage: true });
}

/** A community event today at 23:59 with Adult and Child options. */
async function eventToday(f: F) {
  const exp = await bookableExperience(f, { price: 0, capacity: 40, payment: "cash", date: irelandDate(0) });
  await f.connection.execute("UPDATE experiences SET kind = 'event', price_cents = 1000 WHERE id = ?", [exp.id]);
  await f.connection.execute("UPDATE experience_sessions SET time = '23:59' WHERE id = ?", [exp.session]);
  for (const [t, c] of [["offering_options", "listing_id"], ["registration_questions", "listing_id"], ["listing_staff_assignments", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, exp.id);
  const saved = await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${exp.id}/options`, {
    data: { version: 0, options: [
      { kind: "option", label: "Adult", description: "Lunch included", priceMinor: 1000, priceBasis: "per_person", ageBand: "adult" },
      { kind: "option", label: "Child", description: "Under 12", priceMinor: 500, priceBasis: "per_person", ageBand: "child" },
    ] },
  });
  expect(saved.status(), "options saved").toBe(200);
  const ids = Object.fromEntries((await saved.json()).options.map((o: { label: string; id: string }) => [o.label, o.id]));
  return { ...exp, adult: ids.Adult as string, child: ids.Child as string };
}

async function questions(f: F, id: string) {
  const r = await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${id}/questions`, {
    data: { version: 0, questions: [
      { scope: "attendee", inputType: "text", label: "Name on badge", purpose: "Printed on your name badge", doorVisible: true },
      { scope: "attendee", appliesTo: "child", inputType: "number", label: "Age", purpose: "To group children for activities", min: 0, max: 17, required: true },
      { scope: "booking", inputType: "select", label: "How will you travel?", purpose: "To plan parking", choices: ["Car", "Bus", "Walking"], required: true },
    ] },
  });
  expect(r.status(), "questions saved").toBe(200);
  const body = await r.json();
  return { version: body.version as number, keys: Object.fromEntries(body.questions.map((q: { label: string; key: string }) => [q.label, q.key])) as Record<string, string> };
}

function trackBooking(f: F, ref: string) {
  for (const [t, c] of [["order_lines", "source_ref"], ["order_acknowledgements", "source_ref"], ["booking_attendees", "source_ref"], ["registration_answers", "source_ref"], ["attendee_checkins", "source_ref"], ["attendance", "ref"], ["experience_booking_participants", "booking_ref"], ["audit_log", "object_id"]]) f.track(t, c, ref);
}

test("P2-PARTNER: a manager builds questions; a sensitive question is refused", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restore = await setSwitches(f.connection, SW);
    try {
      const exp = await eventToday(f);
      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        await page.goto(`/vendor/experiences/${exp.id}`);
        await page.getByRole("button", { name: "Questions" }).or(page.getByRole("tab", { name: "Questions" })).first().click();
        await page.getByRole("button", { name: "Add your own question" }).click();
        await page.getByLabel(/^Question\b/).first().fill("Name on badge");
        await page.getByLabel(/^Why you're asking/).first().fill("Printed on your name badge");
        await page.getByLabel("Show the answer to door staff").first().check();
        await page.getByRole("button", { name: "Save questions" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
        await shot(page, "01-partner-questions");
        await page.getByRole("button", { name: "Add your own question" }).click();
        await page.getByLabel(/^Question\b/).nth(1).fill("Any allergies?");
        await page.getByLabel(/^Why you're asking/).nth(1).fill("For the kitchen");
        await page.getByRole("button", { name: "Save questions" }).click();
        await expect(page.getByText(/sensitive/).first()).toBeVisible();
        await shot(page, "02-partner-sensitive-refused");
        const saved = await rows(f, "SELECT label, door_visible FROM registration_questions WHERE listing_id = ? AND active = 1", [exp.id]);
        expect(saved).toEqual([{ label: "Name on badge", door_visible: 1 }]);
        expect(staff.consoleErrors).toEqual([]);
      } finally { await staff.close(); }
    } finally { await restore(); }
  });
});

for (const viewport of ["desktop", "mobile"] as const) {
  test(`P2-RESIDENT-${viewport.toUpperCase()}: a guest says who is coming, answers, and sees it in My Life`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const restore = await setSwitches(f.connection, SW);
      try {
        const exp = await eventToday(f);
        await questions(f, exp.id);
        const user = await uiActor(browser, null, viewport);
        try {
          const { page } = user;
          await page.goto(`/events/${exp.id}`);
          await expect(page.getByRole("heading", { name: exp.title }).first()).toBeVisible();
          await page.waitForTimeout(600);
          const cta = viewport === "mobile"
            ? page.locator(".mobile-join-bar").getByRole("button", { name: "Register for this event" })
            : page.getByRole("button", { name: "Register for this event" }).filter({ visible: true }).first();
          await cta.click();
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("button", { name: "Add one Adult" }).click();
          await dialog.getByRole("button", { name: "Add one Child" }).click();
          await dialog.locator('input[autocomplete="name"]').fill("QA Parent");
          await expect(dialog.getByLabel("Name for person 1")).toHaveValue("QA Parent");
          await dialog.getByLabel("Name for person 2").fill("QA Kid");
          await dialog.getByLabel(/Who looks after QA Kid/).selectOption("1");
          await dialog.getByLabel(/^Age/).fill("7");
          await dialog.getByLabel(/^How will you travel/).selectOption("Bus");
          await dialog.getByLabel(/^Name on badge/).first().fill("Parent QA");
          await dialog.locator('input[type="email"]').fill(`qa_p2_${viewport}@example.test`);
          await dialog.getByRole("checkbox", { name: /^I agree to the booking terms/ }).check();
          if (viewport === "mobile") expect(await noHorizontalScroll(page), "no sideways scroll on a phone").toBe(true);
          await shot(page, `03-resident-whos-coming-${viewport}`);
          await dialog.getByRole("button", { name: /^(Register|Continue to pay)$/ }).click();
          await expect(page.getByRole("heading", { name: "You're booked." })).toBeVisible();
          const clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id"));
          const [booked] = await rows(f, "SELECT ref, party_size FROM experience_bookings WHERE session_id = ? AND client_id = ?", [exp.session, clientId]);
          trackBooking(f, booked.ref);
          expect(booked.party_size).toBe(2);
          const people = await rows(f, "SELECT attendee_no, person_type, name, guardian_kind, guardian_attendee_no FROM booking_attendees WHERE source_ref = ? ORDER BY attendee_no", [booked.ref]);
          expect(people).toEqual([
            { attendee_no: 1, person_type: "adult", name: "QA Parent", guardian_kind: null, guardian_attendee_no: null },
            { attendee_no: 2, person_type: "child", name: "QA Kid", guardian_kind: "attendee", guardian_attendee_no: 1 },
          ]);
          expect((await rows(f, "SELECT COUNT(*) AS n FROM registration_answers WHERE source_ref = ?", [booked.ref]))[0].n).toBe(3);
          await page.goto(`/bookings/experience/${booked.ref}`);
          const who = page.getByTestId("booking-people");
          await expect(who).toContainText("QA Kid");
          await expect(who).toContainText("with QA Parent");
          await expect(who).toContainText("Age: 7");
          await shot(page, `04-mylife-whos-coming-${viewport}`);
          if (viewport === "mobile") expect(await noHorizontalScroll(page)).toBe(true);
          expect(user.consoleErrors).toEqual([]);
        } finally { await user.close(); }
      } finally { await restore(); }
    });
  });
}

test("P2-DOOR: check-in-only staff check in part of a group on a phone, and are refused everything else", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restore = await setSwitches(f.connection, SW);
    try {
      const exp = await eventToday(f);
      const q = await questions(f, exp.id);
      // Two bookings made through the real API: a family of two, and one that's then cancelled.
      const guestCtx = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, extraHTTPHeaders: { "X-Client-Id": randomUUID() } });
      const body = (name: string, email: string) => ({
        participantName: name, email, acceptedTerms: true, questionsVersion: q.version,
        lines: [{ optionId: exp.adult, quantity: 1 }, { optionId: exp.child, quantity: 1 }],
        attendees: [{ name }, { name: `${name} Junior`, guardian: 1 }],
        answers: { booking: { [q.keys["How will you travel?"]]: "Car" }, attendees: [{ [q.keys["Name on badge"]]: `${name} (badge)` }, { [q.keys.Age]: 6 }] },
      });
      const fam = await guestCtx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: body("Door Family", "qa_door_fam@example.test") });
      expect(fam.status()).toBe(201);
      const famRef = (await fam.json()).ref as string;
      const gone = await guestCtx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: body("Door Cancelled", "qa_door_cx@example.test") });
      const goneRef = (await gone.json()).ref as string;
      trackBooking(f, famRef); trackBooking(f, goneRef);
      await f.connection.execute("UPDATE experience_bookings SET status = 'cancelled' WHERE ref = ?", [goneRef]);
      await guestCtx.dispose();

      // A real Check-in only member of QA_VENDOR's organisation, assigned to today only.
      const [owner] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_door_${id.slice(0, 8)}@example.test`;
      await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', 'QA Door Volunteer', ?, 'checkin_staff', 1)", [id, email, bcrypt.hashSync(password, 10), owner.org_id]);
      f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
      expect((await f.actors.QA_VENDOR.post(`/api/vendor/experiences/${exp.id}/checkin-staff`, { data: { userId: id, sessionId: exp.session } })).status()).toBe(201);

      const door = await staffActor(browser, "QA_DOOR", { credentials: { email, password }, viewport: "mobile" });
      try {
        const { page } = door;
        expect((await door.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
        // Money, contacts and the rest of the workspace are closed to this role.
        for (const path of [`/api/vendor/experiences/${exp.id}/bookings`, `/api/vendor/experiences/${exp.id}/attendees`, "/api/vendor/payments", "/api/vendor/orders", "/api/vendor/stats"]) {
          expect([path, (await page.request.get(path)).status()]).toEqual([path, 403]);
        }
        await page.goto("/vendor");
        await expect(page).toHaveURL(/\/vendor\/door$/);
        await shot(page, "05-door-home-mobile");
        await page.getByRole("link", { name: "Open door mode" }).first().click();
        await expect(page.getByRole("heading", { name: exp.title })).toBeVisible();
        await expect(page.getByText(/^0\s*\/\s*2/)).toBeVisible();
        const sessionJson = await page.request.get(`/api/vendor/door/sessions/${exp.session}`);
        expect(await sessionJson.text()).not.toMatch(/email|phone|cents|total|amount|price/i);
        await page.getByLabel("Search by name or booking reference").fill("Door Family");
        await page.getByRole("button", { name: /^Door Family, 0 of 2 checked in/ }).click();
        await expect(page.getByText("Door Family (badge)")).toBeVisible();
        // Only the parent arrives first.
        await page.getByRole("checkbox", { name: "Arriving now: Door Family Junior, child" }).uncheck();
        await page.getByRole("button", { name: "Check in 1 of 2" }).click();
        await expect(page.getByRole("alert")).toContainText("1 checked in");
        await expect(page.getByText(/^1\s*\/\s*2/)).toBeVisible();
        await shot(page, "06-door-partial-group-mobile");
        expect(await noHorizontalScroll(page)).toBe(true);
        // A cancelled booking typed in at the door.
        await page.getByLabel("Search by name or booking reference").fill(goneRef);
        await page.getByLabel("Search by name or booking reference").press("Enter");
        await expect(page.getByRole("alert")).toContainText("cancelled");
        await shot(page, "07-door-cancelled-refused-mobile");
        const checks = await rows(f, "SELECT attendee_no, method FROM attendee_checkins WHERE source_ref = ?", [famRef]);
        expect(checks).toEqual([{ attendee_no: 1, method: "manual" }]);
        expect(door.consoleErrors).toEqual([]);
      } finally { await door.close(); }

      // The manager sees the attendance on the record page.
      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        await page.goto(`/vendor/experiences/${exp.id}`);
        await page.getByRole("button", { name: "Attendees" }).or(page.getByRole("tab", { name: "Attendees" })).first().click();
        await expect(page.getByText("Door Family Junior").first()).toBeVisible();
        await expect(page.getByText(/1 of 2 checked in/).first()).toBeVisible();
        await shot(page, "08-partner-attendees");
        expect(staff.consoleErrors).toEqual([]);
      } finally { await staff.close(); }
    } finally { await restore(); }
  });
});
