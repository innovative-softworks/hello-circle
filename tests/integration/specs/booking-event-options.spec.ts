import { expect } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll } from "../lifecycle-ui-fixture";
import { bookableExperience, expectedTotal } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Participation Expansion Phase 1 (docs/participation-expansion/07, 09) —
// community events with registration options, in the real browser against the
// isolated QA stack. Cash listings only: no payment provider is involved (the
// Stripe paths are covered by the server suite and qa:stripe). Switches are
// set in the QA database for this batch and restored afterwards.

const OPTIONS = [
  { kind: "option", label: "Participate in Pooja", description: "Pooja kit and lunch included", priceMinor: 7100, priceBasis: "per_person" },
  { kind: "option", label: "Individual Darshan", description: "Lunch included", priceMinor: 1100, priceBasis: "per_person", capacity: 20 },
  { kind: "addon", label: "Prasadam pack", description: "", priceMinor: 500, priceBasis: "per_booking", maxPerOrder: 2 },
];

async function eventWithOptions(f: Parameters<Parameters<typeof withActors>[2]>[0], withOptions = true) {
  const exp = await bookableExperience(f, { price: 0, capacity: 40, payment: "cash" });
  await f.connection.execute("UPDATE experiences SET kind = 'event' WHERE id = ?", [exp.id]);
  f.track("offering_options", "listing_id", exp.id);
  if (withOptions) {
    const saved = await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${exp.id}/options`, { data: { options: OPTIONS, version: 0 } });
    expect(saved.status(), "partner saves options").toBe(200);
  }
  return exp;
}

test("BK-EVENT-PARTNER: a partner adds registration options in the Registration tab", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restore = await setSwitches(f.connection, { "participation.events": true, "participation.options": true });
    try {
      const exp = await eventWithOptions(f, false);
      const staff = await staffActor(browser, "QA_VENDOR");
      try {
        const { page } = staff;
        await page.goto(`/vendor/experiences/${exp.id}`);
        await page.getByRole("button", { name: "Registration" }).or(page.getByRole("tab", { name: "Registration" })).first().click();
        await page.getByRole("button", { name: "Add an option" }).click();
        await page.getByRole("button", { name: "Add an extra" }).click();
        await page.getByLabel(/^Name/).nth(0).fill("Individual Darshan");
        await page.getByLabel(/^Price \(€\)/).nth(0).fill("11.00");
        await page.getByLabel(/^Name/).nth(1).fill("Prasadam pack");
        await page.getByLabel(/^Price \(€\)/).nth(1).fill("5");
        await page.getByRole("button", { name: "Save options" }).click();
        await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
        const saved = await rows(f, "SELECT label, price_minor, kind, active FROM offering_options WHERE listing_id = ? ORDER BY sort_order", [exp.id]);
        expect(saved).toEqual([
          { label: "Individual Darshan", price_minor: 1100, kind: "option", active: 1 },
          { label: "Prasadam pack", price_minor: 500, kind: "addon", active: 1 },
        ]);
        expect(staff.consoleErrors).toEqual([]);
      } finally { await staff.close(); }
    } finally { await restore(); }
  });
});

for (const viewport of ["desktop", "mobile"] as const) {
  test(`BK-EVENT-${viewport.toUpperCase()}: a guest chooses options, sees server totals, and finds the lines in My Life`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const restore = await setSwitches(f.connection, { "participation.events": true, "participation.options": true });
      try {
        const exp = await eventWithOptions(f);
        const user = await uiActor(browser, null, viewport);
        try {
          const { page } = user;
          await page.goto("/events");
          await expect(page.getByRole("heading", { name: "Community events" })).toBeVisible();
          await page.goto(`/events/${exp.id}`);
          await expect(page.getByRole("heading", { name: exp.title }).first()).toBeVisible();
          await page.waitForTimeout(600);
          const cta = viewport === "mobile"
            ? page.locator(".mobile-join-bar").getByRole("button", { name: "Register for this event" })
            : page.getByRole("button", { name: "Register for this event" }).filter({ visible: true }).first();
          await cta.click();
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("button", { name: "Add one Participate in Pooja" }).click();
          await dialog.getByRole("button", { name: "Add one Individual Darshan" }).click();
          await dialog.getByRole("button", { name: "Add one Prasadam pack" }).click();
          await dialog.locator('input[autocomplete="name"]').fill("QA event booker");
          await dialog.getByLabel("Name for person 2").fill("QA second person");
          await dialog.locator('input[type="email"]').fill(`qa_event_${viewport}@example.test`);
          await dialog.getByRole("checkbox", { name: /^I agree to the booking terms/ }).check();
          const total = expectedTotal(7100 + 1100 + 500);
          await expect(dialog.getByTestId("booking-total")).toHaveText(`€${(total / 100).toFixed(2)}`);
          await expect(dialog.getByTestId("checkout-lines")).toContainText("Individual Darshan × 1");
          if (viewport === "mobile") expect(await noHorizontalScroll(page), "no sideways scroll on a phone").toBe(true);
          await dialog.getByRole("button", { name: /^(Register|Continue to pay)$/ }).click();
          await expect(page.getByRole("heading", { name: "You're booked." })).toBeVisible();
          const clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id"));
          const [booked] = await rows(f, "SELECT ref, pricing_mode, party_size, total_cents, payment_status FROM experience_bookings WHERE session_id = ? AND client_id = ?", [exp.session, clientId]);
          expect(booked).toMatchObject({ pricing_mode: "lines", party_size: 2, total_cents: total, payment_status: "paid" });
          const lines = await rows(f, "SELECT label_snapshot, quantity, unit_minor FROM order_lines WHERE source_type = 'experience' AND source_ref = ? ORDER BY line_no", [booked.ref]);
          expect(lines.map((l) => [l.label_snapshot, l.quantity, l.unit_minor])).toEqual([["Participate in Pooja", 1, 7100], ["Individual Darshan", 1, 1100], ["Prasadam pack", 1, 500]]);
          f.track("order_lines", "source_ref", booked.ref);
          await page.goto(`/bookings/experience/${booked.ref}`);
          await expect(page.getByText("Event registration").first()).toBeVisible();
          await expect(page.getByTestId("booking-lines")).toContainText("Participate in Pooja × 1");
          expect(user.consoleErrors).toEqual([]);
        } finally { await user.close(); }
      } finally { await restore(); }
    });
  });
}

test("BK-EVENT-OFF: with the switches off, events leave public lists and options can't be booked", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const restoreOn = await setSwitches(f.connection, { "participation.events": true, "participation.options": true });
    let exp: Awaited<ReturnType<typeof eventWithOptions>>;
    try {
      exp = await eventWithOptions(f);
    } finally { await restoreOn(); }
    const restore = await setSwitches(f.connection, { "participation.events": false, "participation.options": false });
    try {
      const list = await f.actors.QA_VENDOR.get("/api/experiences");
      expect((await list.json()).some((e: { id: string }) => e.id === exp!.id), "event hidden from public lists").toBe(false);
      const user = await uiActor(browser, null, "desktop");
      try {
        const { page } = user;
        await page.goto(`/events/${exp!.id}`); // a direct link still opens
        await expect(page.getByRole("heading", { name: exp!.title }).first()).toBeVisible();
        await page.getByRole("button", { name: "Register for this event" }).filter({ visible: true }).first().click();
        await expect(page.getByRole("dialog").getByRole("status").filter({ hasText: "paused" })).toBeVisible();
        const quote = await f.actors.QA_VENDOR.post(`/api/experiences/${exp!.id}/sessions/${exp!.session}/quote`, { data: { partySize: 2 } });
        expect(quote.status(), "never sold at one price while paused").toBe(409);
      } finally { await user.close(); }
    } finally { await restore(); }
  });
});
