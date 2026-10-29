import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";
import { businessUiActor } from "../product-fixture";
import { stripeUiActor } from "../stripe-fixture";
import { connectedPreflight } from "../runtime";

// Trust & Retention — the resident journey in the isolated QA environment:
// join → "Your next plan" (incl. the day-of view) → organiser confirms →
// exactly one in-app invitation → review → go again + follow; and a resident
// who turned review invitations off gets none. No email leaves the QA backend.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "trust");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

function dublin(offsetMinutes: number) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
const dayOffset = (days: number) => dublin(days * 1440).date;

test("Trust journey: next plan → confirmed → one invitation → review → go again / follow; preference off sends none", async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const tag = randomUUID().slice(0, 8);
    const exp = `qa-trust-jx-${tag}`;
    const game = `qa-trust-jg-${tag}`;
    const later = dublin(180); // a Session later today (or just after midnight)
    await f.connection.execute(
      `INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, duration_minutes, meeting_point, newcomer_welcome)
       VALUES (?, ?, ?, 'Howth', 'Dublin', 'b', 'd', '', '', '', 'Towel', '', '', '', '', '', 'approved', 8, 4500, 120, 'Howth pier', 'Guide Ciara meets first-timers')`,
      [exp, personas.QA_VENDOR.id, `QA Journey Kayak ${tag}`]
    );
    await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00'), (?, ?, ?, '10:00')", [`${exp}-past`, exp, dayOffset(-3), `${exp}-next`, exp, dayOffset(9)]);
    for (const [ref, who, email] of [[`QA-JA-${tag}`, personas.QA_USER.id, env.QA_USER_EMAIL], [`QA-JB-${tag}`, personas.QA_USER_B.id, env.QA_USER_B_EMAIL]]) {
      await f.connection.execute(
        "INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, '', 2, 9000, 'paid', 'confirmed')",
        [ref, exp, `${exp}-past`, `qa-jc-${tag}`, who, who === personas.QA_USER.id ? "QA User A" : "QA User B", email]
      );
      f.track("attendance", "ref", ref);
      f.track("attendance_corrections", "ref", ref);
      f.track("review_invitations", "occurrence_ref", ref);
      f.track("notifications", "ref", `experience/${ref}`);
    }
    await f.connection.execute(
      "INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, price_cents, duration_minutes, meeting_instructions, equipment_needed, newcomer_welcome) VALUES (?, ?, ?, 'Phoenix Park, main gate', ?, ?, 10, 'open', 'public', 0, 60, 'By the main gate', 'Water', 'The host waits at the gate')",
      [game, personas.QA_HOST.id, `QA Journey Run ${tag}`, later.date, later.time]
    );
    await f.connection.execute("INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)", [game, personas.QA_HOST.id]);
    for (const [t, c, id] of [["experiences", "id", exp], ["experience_sessions", "experience_id", exp], ["experience_bookings", "experience_id", exp], ["reviews", "listing_id", exp], ["games", "id", game], ["game_participants", "game_id", game], ["follows", "followed_id", personas.QA_VENDOR.id]]) f.track(t, c, id);

    // B starts with review invitations on (a previous run may have left them off) and is restored after.
    const [prefRow] = await f.connection.query<any[]>("SELECT notification_prefs as p FROM residents WHERE id = ?", [personas.QA_USER_B.id]);
    const prefsBefore: string | null = prefRow[0]?.p ?? null;
    const prefsOn = { ...(prefsBefore ? JSON.parse(prefsBefore) : {}), reviewInvites: true };
    await f.connection.execute("UPDATE residents SET notification_prefs = ? WHERE id = ?", [JSON.stringify(prefsOn), personas.QA_USER_B.id]);
    const a = await stripeUiActor(browser, "QA_USER", "desktop");
    const b = await stripeUiActor(browser, "QA_USER_B", "mobile");
    const partner = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      // 1. Join through the real API → it becomes the next plan.
      const joined = await a.context.request.post(`/api/games/${game}/join`);
      expect([200, 201]).toContain(joined.status());
      for (const w of [1280, 820, 390]) {
        await a.page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
        await a.page.goto("/my-life");
        const plan = a.page.getByRole("region", { name: "Your next plan" }).or(a.page.locator("section", { has: a.page.getByRole("heading", { name: "Your next plan" }) })).first();
        await expect(plan).toContainText(`QA Journey Run ${tag}`);
        await expect(plan).toContainText("By the main gate");
        await expect(plan).toContainText("The host waits at the gate");
        if (later.date === dublin(0).date) {
          await expect(plan).toContainText("Today");
          await expect(plan.getByRole("link", { name: "Directions" })).toBeVisible();
        }
        expect(await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await shot(a.page, `journey-next-plan-${w}`);
      }
      await a.page.setViewportSize({ width: 1280, height: 900 });
      await expect(a.page.getByText("Attendance not confirmed yet").first()).toBeVisible();

      // 2. Resident B turns review invitations off in the real settings page.
      await b.page.goto("/profile?tab=notificationPrefs");
      const sw = b.page.getByRole("checkbox", { name: "Review invitations" });
      await expect(sw).toBeChecked();
      await sw.press("Space"); // keyboard, like a real user
      await expect(sw).not.toBeChecked();
      await expect(b.page.getByText("Saved").first()).toBeVisible();
      await shot(b.page, "journey-pref-off");

      // 3. The organiser confirms both holders (dialog: focus inside, Escape closes).
      const p = partner.page;
      await p.goto("/vendor?tab=bookings");
      const rowA = p.locator("li", { hasText: "QA User A" }).filter({ hasText: `QA Journey Kayak ${tag}` });
      await rowA.getByRole("button", { name: /Confirm QA User A attended/ }).click();
      const dialog = p.getByRole("alertdialog");
      await expect(dialog).toContainText("doesn't mark the other 1 people");
      await expect.poll(() => p.evaluate(() => !!document.querySelector('[role="alertdialog"]')?.contains(document.activeElement))).toBe(true);
      await p.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await rowA.getByRole("button", { name: /Confirm QA User A attended/ }).click();
      await dialog.getByRole("button", { name: "Confirm attended" }).click();
      await expect(p.getByText("QA User A is confirmed.")).toBeVisible();
      const rowB = p.locator("li", { hasText: "QA User B" }).filter({ hasText: `QA Journey Kayak ${tag}` });
      await rowB.getByRole("button", { name: /Confirm QA User B attended/ }).click();
      await p.getByRole("alertdialog").getByRole("button", { name: "Confirm attended" }).click();
      await expect(p.getByText("QA User B is confirmed.")).toBeVisible();
      await shot(p, "journey-partner-confirmed");

      // 4. Exactly one invitation for A; none for B (preference off).
      const [invA] = await f.connection.query<any[]>("SELECT status FROM review_invitations WHERE occurrence_ref = ?", [`QA-JA-${tag}`]);
      expect(invA.map((r: any) => r.status)).toEqual(["sent"]);
      const [invB] = await f.connection.query<any[]>("SELECT status, reason FROM review_invitations WHERE occurrence_ref = ?", [`QA-JB-${tag}`]);
      expect(invB[0]).toMatchObject({ status: "skipped", reason: "preference_off" });
      const [notesA] = await f.connection.query<any[]>("SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'review_invite' AND ref = ?", [personas.QA_USER.id, `experience/QA-JA-${tag}`]);
      expect(Number(notesA[0].n)).toBe(1);
      const [notesB] = await f.connection.query<any[]>("SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'review_invite'", [personas.QA_USER_B.id]);
      expect(Number(notesB[0].n)).toBe(0);

      // 5. A reviews from My Life; then follows the organiser from the success state.
      await a.page.goto("/my-life");
      await expect(a.page.getByText("Attended · review it").first()).toBeVisible();
      await a.page.getByRole("link", { name: "Write a review" }).first().click();
      await a.page.getByRole("radio", { name: "4 stars" }).check();
      await a.page.getByLabel(/Name to show/).fill("QA A");
      await a.page.getByRole("button", { name: "Post review" }).click();
      await expect(a.page.getByText("Thanks — your review is live.")).toBeVisible();
      await expect(a.page.getByText("Verified attendance").first()).toBeVisible();
      await a.page.getByRole("button", { name: /Follow/ }).first().click();
      await expect(a.page.getByRole("button", { name: /Following/ }).first()).toBeVisible();
      await shot(a.page, "journey-reviewed-followed");

      // 6. Back on My Life: review submitted, the next session to go again, and the same follow state.
      await a.page.goto("/my-life");
      const visit = a.page.locator("article.cr-row", { hasText: `QA Journey Kayak ${tag}` }).first();
      await expect(visit).toContainText("Reviewed");
      await expect(visit).toContainText("Go again");
      await expect(visit.getByRole("link").filter({ hasText: /, 10:00/ })).toBeVisible();
      await expect(visit.getByRole("button", { name: /Following/ })).toBeVisible();
      await shot(a.page, "journey-my-life-after");
    } finally {
      await f.connection.execute("UPDATE residents SET notification_prefs = ? WHERE id = ?", [prefsBefore, personas.QA_USER_B.id]);
      await a.close();
      await b.close();
      await partner.close();
    }
  });
});
