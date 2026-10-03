import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, expectedTotal, guest, irelandDate, registrationBody, synthCoupon } from "../booking-fixture";

// Phase 8 booking finding gate HC-QA-034..047. The original failing-before
// regressions are unchanged (red before remediation, green after); HC-QA-047 was
// found and fixed during the remediation cross-model review. Extended scenarios
// live in booking-remediation*.spec.ts and booking-provider.spec.ts.

async function guests(playwright: any, n: number, opened: APIRequestContext[]) { return Promise.all(Array.from({ length: n }, () => guest(playwright, opened))); }

test("HC-QA-040: cancelling an experience session cancels (and tells) its active bookings", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const exp = await bookableExperience(f, { price: 0, capacity: 5 });
      const r = await f.actors.QA_USER.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { headers: { "X-Client-Id": randomUUID() }, data: experienceBody("qa_user_exp@example.test") });
      expect(r.status()).toBe(201);
      const ref = (await r.json()).ref;
      expect((await f.actors.QA_VENDOR.delete(`/api/vendor/experiences/${exp.id}/sessions/${exp.session}`)).status()).toBe(200);
      const [row] = await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]);
      await new Promise(res => setTimeout(res, 800));
      const notes = await rows(f, "SELECT id FROM notifications WHERE ref = ? AND resident_id IS NOT NULL", [ref]);
      await evidence("hc-qa-040", { bookingStatus: row.status, residentNotifications: notes.length });
      expect(row.status).toBe("cancelled");
      expect(notes.length).toBeGreaterThanOrEqual(2); // confirmation + cancellation
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-041: a pending (mid-checkout) reservation holds capacity for registrations, enrolments and experience bookings", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const [g] = await guests(playwright, 1, opened);
      const club = await bookableClub(f, { price: 0, capacity: 1 });
      await f.connection.execute(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status, registrant_type)
        VALUES (?, ?, ?, '', 'QA', 'Pending', '', 'QA', 'Pending', 'qa_pending@example.test', '0', 'QA', '', '', '', '', 1, 0, 6400, 'pending', 'confirmed', 'adult')`, [`QAP${randomUUID().slice(0, 8)}`, randomUUID(), club]);
      const program = await bookableProgram(f, { price: 0, capacity: 1 });
      await f.connection.execute("INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status) VALUES (?, ?, ?, 'QA pending', 'qa_pending@example.test', 3200, 'pending')", [randomUUID(), program.id, randomUUID()]);
      const exp = await bookableExperience(f, { price: 0, capacity: 1 });
      await f.connection.execute("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, party_size, total_cents, payment_status) VALUES (?, ?, ?, ?, 'QA pending', 'qa_pending@example.test', 1, 1280, 'pending')", [randomUUID(), exp.id, exp.session, randomUUID()]);
      const statuses = {
        registration: (await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email) })).status(),
        enrolment: (await g.ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: "QA", email: g.email } })).status(),
        experience: (await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email) })).status(),
      };
      await evidence("hc-qa-041", statuses);
      expect(statuses).toEqual({ registration: 409, enrolment: 409, experience: 409 });
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-042: the experience booking form shows the amount the server will actually charge", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const exp = await bookableExperience(f, { price: 1000, capacity: 6, payment: "cash" });
    const user = await uiActor(browser, null, "desktop");
    try {
      const { page } = user;
      await page.goto(`/experiences/${exp.id}`);
      await page.getByRole("button", { name: "Book this adventure" }).filter({ visible: true }).first().click();
      const dialog = page.getByRole("dialog");
      await page.waitForTimeout(500);
      const shown = (await dialog.locator("text=/^€\\d/").first().textContent())?.trim();
      await evidence("hc-qa-042", { shown: shown ?? "", serverTotalForOne: `€${(expectedTotal(1000) / 100).toFixed(2)}` });
      expect(shown).toBe(`€${(expectedTotal(1000) / 100).toFixed(2)}`);
    } finally { await user.close(); }
  });
});

test("HC-QA-043: a keyboard-focused control is never hidden behind the mobile consent banner", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const centre = await bookableCentre(f, { rate: 20 });
    const user = await uiActor(browser, null, "mobile", { consent: false });
    try {
      const { page } = user;
      await page.goto("/bookings");
      const clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id"));
      expect((await page.request.post("/api/bookings/checkout", { headers: { "X-Client-Id": clientId! }, data: bookingBody(centre, "qa_focus@example.test") })).status()).toBe(201);
      await page.reload();
      await page.getByRole("button", { name: /View full activity/ }).click();
      const cancel = page.getByRole("button", { name: "Cancel", exact: true }).first();
      await cancel.focus();
      const hit = await cancel.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); });
      await evidence("hc-qa-043", { focusedControlVisible: hit });
      expect(hit).toBe(true);
    } finally { await user.close(); }
  });
});

test("HC-QA-044: removing a club session does not orphan the registrations that reference it", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: null });
      const session = randomUUID();
      await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active) VALUES (?, ?, 2, '19:00', 5, 'QA', 1)", [session, club]);
      const [g] = await guests(playwright, 1, opened);
      expect((await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { sessionId: session }) })).status()).toBe(201);
      expect((await f.actors.QA_VENDOR.delete(`/api/club-sessions/${session}`)).status()).toBe(200);
      const orphans = await rows(f, "SELECT r.ref FROM registrations r LEFT JOIN club_sessions s ON s.id = r.session_id WHERE r.club_id = ? AND r.session_id IS NOT NULL AND s.id IS NULL", [club]);
      await evidence("hc-qa-044", { orphans: orphans.length });
      expect(orphans).toEqual([]);
    } finally { for (const c of opened) await c.dispose(); }
  });
});
