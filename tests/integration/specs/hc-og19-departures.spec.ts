import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import { bookableExperience, experienceBody, guest, irelandDate } from "../booking-fixture";

// OG-19 — experience departure management in a real browser: weekly repeating
// departures with a stop-sales cut-off, editing a departure's capacity (never
// below the places taken) and cut-off, and moving a booking the customer asked
// to move (refused without that confirmation). Another organisation can't
// change the departures. Synthetic cash experience, QA_VENDOR's organisation.

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Ireland wall-clock "YYYY-MM-DD HH:MM" of a stored UTC DATETIME (selected as text:
 * the harness connection would otherwise read it in the machine's own timezone). */
const dublin = (utc: string) => {
  const at = new Date(`${utc.replace(" ", "T")}Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

test("OG-19-DEPARTURES: weekly departures with a cut-off, capacity edits within places taken, and a customer-asked move", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  const opened: APIRequestContext[] = [];
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const exp = await bookableExperience(f, { price: 1000, capacity: 4, payment: "cash", date: irelandDate(14) });
    const g = await guest(playwright, opened);
    const booked = await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email, { participantName: "OG19 Mover", partySize: 2 }) });
    expect(booked.status()).toBe(201);
    const ref = (await booked.json()).ref as string;
    const first = irelandDate(21);
    const v = await staffActor(browser, "QA_VENDOR");
    try {
      await v.page.goto(`/vendor/experiences/${exp.id}`);
      await v.page.locator("button[aria-pressed]", { hasText: /^Departures$/ }).click();
      await expect(v.page.getByRole("heading", { name: "Departures" })).toBeVisible();

      // 1. Weekly repeat for 3 weeks, bookings close 24 h before each start.
      await v.page.getByRole("button", { name: "Add departure" }).click();
      await v.page.getByLabel("Departure date").fill(first);
      await v.page.getByLabel("Departure time").fill("10:00");
      await v.page.getByLabel("Repeat weekly for this many weeks").fill("3");
      await v.page.getByLabel("Stop sales this many hours before").fill("24");
      await v.page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(v.page.getByText(/· weekly/)).toHaveCount(3);
      const added = await rows(f, "SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS d, time, series_id, DATE_FORMAT(sales_close_at, '%Y-%m-%d %H:%i:%s') AS sales_close_at FROM experience_sessions WHERE experience_id = ? AND id <> ? ORDER BY date", [exp.id, exp.session]);
      expect(added.map((s) => s.d), "three weekly dates").toEqual([first, addDays(first, 7), addDays(first, 14)]);
      expect(new Set(added.map((s) => s.series_id)).size, "one series").toBe(1);
      expect(added[0].series_id).toBeTruthy();
      for (const s of added) expect(dublin(s.sales_close_at), `cut-off for ${s.d} is 24 h before, Ireland time`).toBe(`${addDays(s.d, -1)} 10:00`);

      // 2. Edit the booked departure: capacity can't go below the 2 places taken.
      await v.page.getByRole("button", { name: `Edit departure ${irelandDate(14)} 10:00` }).click();
      const dialog = v.page.getByRole("dialog");
      await dialog.getByLabel("Capacity (optional)").fill("1");
      await dialog.getByRole("button", { name: "Save departure" }).click();
      await expect(dialog.getByText(/2 places are already taken/)).toBeVisible();
      expect((await rows(f, "SELECT capacity FROM experience_sessions WHERE id = ?", [exp.session]))[0].capacity, "unchanged after the refusal").toBe(4);
      await dialog.getByLabel("Capacity (optional)").fill("6");
      await dialog.getByLabel("Stop bookings this many hours before the start (optional)").fill("48");
      await dialog.getByRole("button", { name: "Save departure" }).click();
      await expect(v.page.getByRole("dialog")).toHaveCount(0);
      const [edited] = await rows(f, "SELECT capacity, DATE_FORMAT(sales_close_at, '%Y-%m-%d %H:%i:%s') AS sales_close_at FROM experience_sessions WHERE id = ?", [exp.session]);
      expect([edited.capacity, dublin(edited.sales_close_at)]).toEqual([6, `${addDays(irelandDate(14), -2)} 10:00`]);
      await expect(v.page.getByText(new RegExp(`${irelandDate(14)} · 10:00 · cap 6`))).toBeVisible();

      // 3. Move the booking — refused until the partner confirms the customer asked.
      await v.page.locator("button[aria-pressed]", { hasText: /^Bookings$/ }).click();
      await v.page.getByRole("button", { name: "Move OG19 Mover's booking" }).click();
      const move = v.page.getByRole("dialog");
      await move.getByRole("combobox", { name: /^Move to/ }).selectOption({ label: `${addDays(first, 7)} · 10:00` });
      await move.getByLabel("Note (optional)").fill("Customer asked by phone");
      await move.getByRole("button", { name: "Move booking" }).click();
      await expect(move.getByText("Confirm the customer asked for this move")).toBeVisible();
      expect((await rows(f, "SELECT session_id FROM experience_bookings WHERE ref = ?", [ref]))[0].session_id, "not moved yet").toBe(exp.session);
      await move.getByLabel("The customer asked to move to this departure").check();
      await move.getByRole("button", { name: "Move booking" }).click();
      await expect(v.page.getByRole("dialog")).toHaveCount(0);
      const target = added.find((s) => s.d === addDays(first, 7))!;
      await expect.poll(async () => (await rows(f, "SELECT session_id FROM experience_bookings WHERE ref = ?", [ref]))[0].session_id).toBe(target.id);
      await expect(v.page.getByText(new RegExp(`OG19 Mover · party of 2 · ${addDays(first, 7)} 10:00`))).toBeVisible();
      const [audit] = await rows(f, "SELECT action, reason FROM audit_log WHERE action = 'experience_booking.moved' AND object_id = ? ORDER BY id DESC LIMIT 1", [ref]);
      expect(audit).toEqual({ action: "experience_booking.moved", reason: "Customer asked by phone" });
      f.track("audit_log", "object_id", ref);

      // 4. Server rules behind the screen.
      const [booking] = await rows(f, "SELECT id FROM experience_bookings WHERE ref = ?", [ref]);
      const noAsk = await f.actors.QA_VENDOR.post(`/api/vendor/experiences/${exp.id}/bookings/${booking.id}/move`, { data: { sessionId: exp.session } });
      expect(noAsk.status(), "a move without the customer's request is refused").toBe(400);
      const foreignEdit = await f.actors.QA_VENDOR_B.put(`/api/vendor/experiences/${exp.id}/sessions/${exp.session}`, { data: { capacity: 2 } });
      expect(foreignEdit.status(), "another organisation can't edit the departure").toBe(403);
      const foreignMove = await f.actors.QA_VENDOR_B.post(`/api/vendor/experiences/${exp.id}/bookings/${booking.id}/move`, { data: { sessionId: exp.session, customerAsked: true } });
      expect([403, 404], "or move its bookings").toContain(foreignMove.status());
      expect((await rows(f, "SELECT capacity FROM experience_sessions WHERE id = ?", [exp.session]))[0].capacity, "foreign edit changed nothing").toBe(6);
      expect((await rows(f, "SELECT session_id FROM experience_bookings WHERE ref = ?", [ref]))[0].session_id).toBe(target.id);

      await evidence("og-19-departures", { weekly: 3, cutoffHours: 24, capacityFloorEnforced: true, moveNeedsCustomerAsked: true, moved: true, foreignOrg: [403, foreignMove.status()] });
      expect(v.consoleErrors, "no page errors").toEqual([]);
    } finally {
      await v.close();
      for (const c of opened) await c.dispose();
    }
  });
});
