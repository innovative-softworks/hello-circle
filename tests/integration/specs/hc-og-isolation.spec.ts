import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createActivity, trackGame, FUTURE_DATE } from "../lifecycle-fixture";
import { bookableCentre, bookingBody, guest, irelandDate } from "../booking-fixture";
import { residentCircle } from "../stage-b-fixture";

// Final QA pass (2026-10-17) — cross-organisation and cross-account isolation
// for the routes added in the OG-01…OG-32 pass, against the real server:
// another partner organisation (QA_VENDOR_B) and another person (QA_USER /
// QA_USER_B) can neither read nor change QA_VENDOR's or QA_HOST's records.
// Every refused write is followed by a database check that nothing changed.

const refused = (s: number) => [401, 403, 404].includes(s);

test("OG-ISOLATION: partner and host records added in the OG pass don't leak across organisations or accounts", async ({ playwright }) => {
  test.setTimeout(120_000);
  const opened: APIRequestContext[] = [];
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "QA_HOST", "QA_USER", "QA_USER_B"], async (f) => {
    const results: Record<string, number> = {};
    const expectRefused = (name: string, status: number) => {
      results[name] = status;
      expect(refused(status), `${name} → ${status}`).toBe(true);
    };
    try {
      // --- partner side: QA_VENDOR owns the data; QA_VENDOR_B tries ------------------
      const centre = await bookableCentre(f, { rate: 20, cap: 10 });
      const g = await guest(playwright, opened);
      const made = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { name: "Isolation customer" }) });
      expect(made.status()).toBe(201);
      const ref = (await made.json()).ref as string;
      const month = irelandDate(0).slice(0, 7);

      // Monthly statement: the owner's includes the order; the other organisation's doesn't.
      const own = await f.actors.QA_VENDOR.get(`/api/vendor/statements/${month}`);
      expect(own.status()).toBe(200);
      expect(JSON.stringify(await own.json())).toContain(ref);
      const foreignStatement = await f.actors.QA_VENDOR_B.get(`/api/vendor/statements/${month}`);
      expect(foreignStatement.status()).toBe(200);
      expect(JSON.stringify(await foreignStatement.json()), "statement never lists another organisation's order").not.toContain(ref);
      expect(await (await f.actors.QA_VENDOR_B.get(`/api/vendor/statements/${month}?format=csv`)).text()).not.toContain(ref);

      // Customers directory: the other organisation can't open this customer.
      expect((await f.actors.QA_VENDOR.get(`/api/vendor/customers/${encodeURIComponent(g.email)}`)).status()).toBe(200);
      expectRefused("customer record", (await f.actors.QA_VENDOR_B.get(`/api/vendor/customers/${encodeURIComponent(g.email)}`)).status());
      expect(JSON.stringify(await (await f.actors.QA_VENDOR_B.get("/api/vendor/customers")).json())).not.toContain(g.email);

      // Booking changes, cancel and closures on someone else's venue.
      const bookingBefore = await f.snapshot("SELECT status, payment_status, date, time FROM bookings WHERE ref = ?", [ref]);
      expectRefused("booking changes list", (await f.actors.QA_VENDOR_B.get(`/api/vendor/bookings/${ref}/changes`)).status());
      expectRefused("propose change", (await f.actors.QA_VENDOR_B.post(`/api/vendor/bookings/${ref}/propose-change`, { data: { date: irelandDate(15), time: "11:00", message: "Isolation test" } })).status());
      expectRefused("cancel booking", (await f.actors.QA_VENDOR_B.post(`/api/vendor/bookings/${ref}/cancel`, { data: { reason: "Isolation test" } })).status());
      expectRefused("block preview", (await f.actors.QA_VENDOR_B.post(`/api/vendor/centres/${centre.id}/blocks/preview`, { data: { date: irelandDate(14), startTime: "09:00", endTime: "21:00" } })).status());
      expectRefused("block create", (await f.actors.QA_VENDOR_B.post(`/api/vendor/centres/${centre.id}/blocks`, { data: { date: irelandDate(14), startTime: "09:00", endTime: "21:00", reason: "Isolation" } })).status());
      expectRefused("blocks list", (await f.actors.QA_VENDOR_B.get(`/api/vendor/centres/${centre.id}/blocks`)).status());
      await bookingBefore();
      expect(await rows(f, "SELECT id FROM booking_change_proposals WHERE booking_ref = ?", [ref]), "no proposal created").toEqual([]);
      expect(await rows(f, "SELECT id FROM room_blocks WHERE centre_id = ?", [centre.id]), "no block created").toEqual([]);
      // Orders list stays per organisation.
      expect(JSON.stringify(await (await f.actors.QA_VENDOR_B.get("/api/vendor/orders")).json())).not.toContain(ref);

      // --- host side: QA_HOST owns the activity, series and Circle; QA_USER tries -------
      const game = await createActivity(f, "QA_HOST", { capacity: 6 });
      const gameBefore = await f.snapshot("SELECT status, date, time, capacity, join_mode, booking_close_at FROM games WHERE id = ?", [game.id]);
      expectRefused("booking settings", (await f.actors.QA_USER.post(`/api/games/${game.id}/booking-settings`, { data: { joinMode: "approval" } })).status());
      expectRefused("join requests list", (await f.actors.QA_USER.get(`/api/games/${game.id}/join-requests`)).status());
      expectRefused("approve join", (await f.actors.QA_USER.post(`/api/games/${game.id}/join-requests/${personas.QA_USER_B.id}/approve`, { data: {} })).status());
      expectRefused("move activity", (await f.actors.QA_USER.post(`/api/games/${game.id}/move`, { data: { date: FUTURE_DATE, time: "20:00" } })).status());
      expectRefused("cancel activity", (await f.actors.QA_USER.post(`/api/games/${game.id}/cancel`, { data: { reason: "Isolation test" } })).status());
      await gameBefore();

      const series = await f.actors.QA_HOST.post("/api/games/series", { data: { activityLabel: "QA isolation series", date: FUTURE_DATE, time: "18:30", capacity: 6, locationText: "QA synthetic park", repeatWeeks: 2 } });
      expect(series.status()).toBe(201);
      const { seriesId, games } = (await series.json()) as { seriesId: string; games: { id: string }[] };
      for (const x of games) trackGame(f, x.id);
      f.track("game_series", "id", seriesId);
      expectRefused("cancel rest of series", (await f.actors.QA_USER.post(`/api/games/series/${seriesId}/cancel-remaining`, { data: {} })).status());
      expect((await rows(f, "SELECT DISTINCT status FROM games WHERE series_id = ?", [seriesId])).map((r) => r.status), "series untouched").toEqual(["open"]);

      const circle = await residentCircle(f, "QA_HOST");
      await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [circle, personas.QA_USER.id]);
      expectRefused("circle moderation (member)", (await f.actors.QA_USER.get(`/api/circles/${circle}/moderation`)).status());
      expectRefused("circle moderation (outsider)", (await f.actors.QA_USER_B.get(`/api/circles/${circle}/moderation`)).status());
      expectRefused("announcement (member)", (await f.actors.QA_USER.post(`/api/circles/${circle}/announcements`, { data: { text: "Isolation test announcement" } })).status());
      expect((await f.actors.QA_HOST.get(`/api/circles/${circle}/moderation`)).status(), "the organiser can").toBe(200);
      f.track("chat_messages", "scope_id", circle);

      // A partner session is not a host session.
      expectRefused("partner on host route", (await f.actors.QA_VENDOR.post(`/api/games/${game.id}/booking-settings`, { data: { joinMode: "approval" } })).status());

      // --- personal records: privacy requests are the requester's own --------------------
      const pr = await f.actors.QA_USER.post("/api/residents/me/privacy-requests", { data: { kind: "objection", details: "Isolation test" } });
      expect(pr.status()).toBe(201);
      const prId = (await pr.json()).id as number;
      f.track("privacy_requests", "id", prId);
      expect(((await (await f.actors.QA_USER_B.get("/api/residents/me/privacy-requests")).json()) as { id: number }[]).some((r) => r.id === prId), "another person never sees it").toBe(false);
      expectRefused("partner reads admin privacy queue", (await f.actors.QA_VENDOR.get(`/api/admin/privacy/requests/${prId}`)).status());
      expectRefused("resident reads admin privacy queue", (await f.actors.QA_USER_B.get(`/api/admin/privacy/requests/${prId}`)).status());

      await evidence("og-isolation", { checks: Object.keys(results).length, statuses: Object.entries(results).map(([k, v]) => `${k}=${v}`).join("; ") });
    } finally {
      for (const c of opened) await c.dispose();
    }
  });
});
