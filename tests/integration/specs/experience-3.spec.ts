import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { test, withActors, createCircle, rows } from "../lifecycle-fixture";
import { noHorizontalScroll, overflowingElements, uiActor } from "../lifecycle-ui-fixture";

// Experience 3.0 (docs/experience-3/) in a real browser against the isolated
// QA backend: Going solo in Free Time Mode, spot alerts on a full departure,
// Get ready on a booking, Activity Passport, Plan My Day (save), and a
// Circle-to-Circle activity seen by the partner Circle. The switches are
// default-off, so this spec turns them on for its run and off again after.

const FLAGS = ["experience.smart_match", "experience.go_solo", "experience.collections", "experience.spot_alerts", "experience.adventure_readiness", "experience.programme_journey", "experience.activity_passport", "experience.plan_my_day", "circles.collaboration"];

async function setFlags(f: { connection: { query: (sql: string, values?: unknown[]) => Promise<unknown> } }, on: boolean) {
  for (const key of FLAGS) await f.connection.query("INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, on ? "true" : "false"]);
  await new Promise((r) => setTimeout(r, 5500));
}

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test("EX3: going solo, spot alert, get ready, passport, plan my day, Circle-to-Circle", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const t = randomUUID().slice(0, 8);
    const county = `Ex3shire-${t}`;
    const vendor = `qa-ex3-vendor-${t}`;
    const ids = { walk: `qa-ex3-walk-${t}`, swim: `qa-ex3-swim-${t}`, kayak: `qa-ex3-kayak-${t}` };
    const s = { walk: `qa-ex3-sw-${t}`, swim: `qa-ex3-ss-${t}`, kayak: `qa-ex3-sk-${t}`, past: `qa-ex3-sp-${t}` };
    const q = (sql: string, v: unknown[] = []) => f.connection.query(sql, v);
    f.track("users", "id", vendor);
    for (const id of Object.values(ids)) {
      f.track("experience_bookings", "experience_id", id);
      f.track("experience_sessions", "experience_id", id);
      f.track("listing_attributes", "listing_id", id);
      f.track("experiences", "id", id);
    }
    for (const id of Object.values(s)) f.track("experience_spot_alerts", "session_id", id);
    f.track("day_plans", "resident_id", personas.QA_USER.id);
    await setFlags(f, true);
    try {
      await q("INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'QA Ex3 Vendor')", [vendor, `${vendor}@example.test`]);
      const mk = (id: string, title: string, kind: string, mins: number, price: number, cap: number, lat: number, lng: number) =>
        q(
          `INSERT INTO experiences (id, vendor_id, kind, title, county, area, lat, lng, location_source, meeting_point, duration_minutes, price_cents, capacity, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
           VALUES (?, ?, ?, ?, ?, 'QA', ?, ?, 'confirmed', 'QA meeting point by the clock', ?, ?, ?, '', '', '', '', '', 'QA boots and a rain jacket', '', 'QA stay on the path', 'QA harbour route in wind', '', '', 'approved')`,
          [id, vendor, kind, title, county, lat, lng, mins, price, cap]
        );
      await mk(ids.walk, `QA Ex3 walk ${t}`, "adventure", 90, 0, 10, 53.3786, -6.0583);
      await mk(ids.swim, `QA Ex3 swim ${t}`, "experience", 60, 1200, 10, 53.3907, -6.1118);
      await mk(ids.kayak, `QA Ex3 kayak ${t}`, "adventure", 120, 3000, 1, 53.3893, -6.0659);
      await q("INSERT INTO listing_attributes (listing_type, listing_id, attr) VALUES ('experience', ?, 'come_alone')", [ids.swim]);
      const sess = (id: string, e: string, date: string, time: string) => q("INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, ?)", [id, e, date, time]);
      await sess(s.walk, ids.walk, day(3), "10:00");
      await sess(s.swim, ids.swim, day(3), "12:30");
      await sess(s.kayak, ids.kayak, day(3), "15:00");
      await sess(s.past, ids.walk, day(-9), "10:00");
      await q("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'x', ?, 'B', 'b@example.test', 'paid')", [`qa-ex3-eb-k-${t}`, ids.kayak, s.kayak, personas.QA_USER_B.id]);
      await q("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'x', ?, 'U', 'u@example.test', 'paid')", [`qa-ex3-eb-w-${t}`, ids.walk, s.walk, personas.QA_USER.id]);
      await q("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, payment_status) VALUES (?, ?, ?, 'x', ?, 'U', 'u@example.test', 'paid')", [`qa-ex3-eb-p-${t}`, ids.walk, s.past, personas.QA_USER.id]);
      f.track("attendance", "ref", `qa-ex3-eb-p-${t}`);
      await q("INSERT INTO attendance (kind, ref, checked_in_by, status) VALUES ('experience', ?, ?, 'present')", [`qa-ex3-eb-p-${t}`, vendor]);

      const ui = await uiActor(browser, "QA_USER", "desktop");
      try {
        const { page } = ui;
        // Going solo: only the host-marked "come alone" listing.
        const solo = (await (await f.actors.QA_USER.get(`/api/discover/free-time?county=${county}&solo=1&limit=12`)).json()) as { id: string }[];
        expect(solo.map((r) => r.id)).toEqual([s.swim]);
        await page.goto("/free-time");
        await page.getByRole("button", { name: "Half a day" }).click();
        await page.getByRole("button", { name: "Anywhere nearby" }).click();
        await page.getByRole("button", { name: "Surprise me" }).click();
        await page.getByRole("button", { name: "I'm going solo" }).click();
        await expect(page.getByText(/Nobody else is told you're coming alone/)).toBeVisible();

        // Spot alert on the full kayak.
        await page.goto(`/adventures/${ids.kayak}`);
        await page.getByRole("button", { name: /Tell me if a place opens/ }).first().click();
        await expect.poll(async () => (await rows(f, "SELECT COUNT(*) AS n FROM experience_spot_alerts WHERE session_id = ? AND resident_id = ?", [s.kayak, personas.QA_USER.id]))[0].n).toBe(1);

        // Get ready on the booked walk.
        await page.goto(`/bookings/experience/qa-ex3-eb-w-${t}`);
        await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible();
        await expect(page.getByText("QA boots and a rain jacket")).toBeVisible();

        // Passport lists the checked-in past walk.
        await page.goto("/my-life/passport");
        await expect(page.getByText(`QA Ex3 walk ${t}`).first()).toBeVisible();

        // Plan My Day → save.
        await page.goto("/plan-my-day");
        await page.locator("#pmd-date").fill(day(3));
        await page.getByRole("button", { name: "Plan my day", exact: true }).click();
        await expect(page.getByText(/rough estimate/i).first()).toBeVisible();
        await page.getByRole("button", { name: "Save this plan" }).click();
        await expect.poll(async () => (await rows(f, "SELECT COUNT(*) AS n FROM day_plans WHERE resident_id = ?", [personas.QA_USER.id]))[0].n).toBeGreaterThan(0);

        await page.setViewportSize({ width: 390, height: 844 });
        for (const p of ["/plan-my-day", "/my-life/passport", `/adventures/${ids.kayak}`]) {
          await page.goto(p);
          expect(await noHorizontalScroll(page), `${p}: ${(await overflowingElements(page)).join(", ")}`).toBe(true);
        }
        expect(ui.consoleErrors).toEqual([]);
      } finally {
        await ui.close();
      }

      // Circle-to-Circle: both organisers agree; the partner Circle's member sees it.
      const a = await createCircle(f, "QA_HOST", { joinMode: "approval" });
      const b = await createCircle(f, "QA_USER", { joinMode: "approval" });
      f.track("circle_collaborations", "proposer_circle_id", a.id);
      f.track("games", "circle_id", a.id);
      const prop = await f.actors.QA_HOST.post(`/api/circles/${a.id}/collaborations`, { data: { partnerCircleId: b.id, title: `QA joint ${t}`, proposedDate: day(4) } });
      expect(prop.status()).toBe(201);
      const { id: cid } = await prop.json();
      expect((await f.actors.QA_USER_B.post(`/api/circles/${b.id}/collaborations/${cid}/respond`, { data: { accept: true } })).status()).toBe(403);
      expect((await f.actors.QA_USER.post(`/api/circles/${b.id}/collaborations/${cid}/respond`, { data: { accept: true } })).status()).toBe(200);
      const game = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA joint ${t}`, date: day(4), time: "10:00", capacity: 8, locationText: "QA beach", circleId: a.id, collaborationId: cid } });
      expect(game.status()).toBe(201);
      const g = await game.json();
      f.track("game_participants", "game_id", g.id);
      expect((await f.actors.QA_USER.get(`/api/games/${g.id}`)).status()).toBe(200);
      expect((await f.actors.QA_USER_B.get(`/api/games/${g.id}`)).status()).toBe(404);
      const partner = await uiActor(browser, "QA_USER", "mobile");
      try {
        await partner.page.goto(`/games/${g.id}`);
        await expect(partner.page.getByText(/Together with/)).toBeVisible();
      } finally {
        await partner.close();
      }
    } finally {
      await setFlags(f, false);
    }
  });
});
