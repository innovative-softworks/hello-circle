import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { centreFor, experienceFor, paidBooking, programFor } from "../stage-b-fixture";
import { bookableCentre } from "../booking-fixture";
import { businessUiActor, focused, tabTo, unlabeledControls } from "../product-fixture";

// Phase 10A vendor surfaces — HC-QA-061 (experience editor shows NaN/defaults
// instead of the persisted price), and the vendor halves of HC-QA-066
// (booking rows), HC-QA-067 (gallery upload) and HC-QA-068 (programme form
// labels). Synthetic QA_VENDOR resources, exact-ID cleanup.

test("HC-QA-061: the experience editor shows the persisted price and duration", async ({ playwright, browser }) => {
  test.setTimeout(60_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const id = await experienceFor(f, "QA_VENDOR");
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${id}`, { data: { title: "QA priced hike", blurb: "Synthetic", priceCents: 1250, durationMinutes: 180, meetingPoint: "QA car park", capacity: 6 } })).status()).toBe(200);
    const api = await (await f.actors.QA_VENDOR.get(`/api/vendor/experiences/${id}`)).json();
    expect({ priceCents: api.priceCents, durationMinutes: api.durationMinutes, meetingPoint: api.meetingPoint, capacity: api.capacity }).toEqual({ priceCents: 1250, durationMinutes: 180, meetingPoint: "QA car park", capacity: 6 });
    const ui = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/vendor/experiences/${id}`);
      await expect(page.getByRole("button", { name: /Save & continue/ }).last()).toBeVisible();
      for (let i = 0; i < 6 && !(await page.getByText("Review your listing.").isVisible().catch(() => false)); i++) {
        const next = page.getByRole("button", { name: /Save & continue/ }).last();
        await next.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
      await expect(page.getByText("€12.50/person · cap 6 · 180 min")).toBeVisible();
      await expect(page.getByText(/NaN/)).toHaveCount(0);
      // Stored data untouched by the resumed walk-through.
      expect((await rows(f, "SELECT price_cents, duration_minutes, meeting_point FROM experiences WHERE id = ?", [id]))[0]).toEqual({ price_cents: 1250, duration_minutes: 180, meeting_point: "QA car park" });
      await evidence("hc-qa-061", { shown: "€12.50 · 180 min", stored: 1250 });
    } finally { await ui.close(); }
  });
});

test("HC-QA-061-EDIT: edit, reload, legitimate zero and invalid values keep the server authoritative", async ({ playwright, browser }) => {
  test.setTimeout(60_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const id = await experienceFor(f, "QA_VENDOR");
    await f.connection.execute("UPDATE experiences SET status = 'approved', kind = 'adventure', title = 'QA settings hike', blurb = 'Synthetic', price_cents = 2500, duration_minutes = 180, capacity = 8 WHERE id = ?", [id]);
    const ui = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/vendor/experiences/${id}`);
      await expect(page.getByText("€25.00/person · cap 8 · 180 min")).toBeVisible();
      // Edit the price to a decimal value through the settings editor.
      // Settings sections: the "Edit →" right after the PRICING & CAPACITY summary.
      const edits = page.getByRole("button", { name: /^Edit/ });
      const pricingIndex = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button")).filter((b) => /^Edit/.test(b.textContent?.trim() ?? ""));
        return buttons.findIndex((b) => /PRICING & CAPACITY/i.test(b.parentElement?.parentElement?.textContent ?? ""));
      });
      expect(pricingIndex, "pricing section Edit found").toBeGreaterThanOrEqual(0);
      await edits.nth(pricingIndex).focus();
      await page.keyboard.press("Enter");
      const price = page.getByLabel("Price per person (€)");
      await expect(price).toHaveValue("25", { timeout: 5_000 });
      await price.fill("12.5");
      const save = page.getByRole("button", { name: /^Save/ }).last();
      await save.focus({ timeout: 5_000 });
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await rows(f, "SELECT price_cents FROM experiences WHERE id = ?", [id]))[0].price_cents).toBe(1250);
      await page.reload();
      await expect(page.getByText("€12.50/person · cap 8 · 180 min")).toBeVisible();
      // Zero is a legitimate free price.
      expect((await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${id}`, { data: { priceCents: 0 } })).status()).toBe(200);
      await page.reload();
      await expect(page.getByText("€0.00/person · cap 8 · 180 min")).toBeVisible();
      // Invalid values are rejected and never overwrite stored data.
      for (const bad of [{ priceCents: -500 }, { priceCents: 12.5 }, { durationMinutes: -10 }, { capacity: 0 }]) {
        expect((await f.actors.QA_VENDOR.put(`/api/vendor/experiences/${id}`, { data: bad })).status(), JSON.stringify(bad)).toBe(400);
      }
      expect((await rows(f, "SELECT price_cents, duration_minutes, capacity FROM experiences WHERE id = ?", [id]))[0]).toEqual({ price_cents: 0, duration_minutes: 180, capacity: 8 });
    } finally { await ui.close(); }
  });
});

test("HC-QA-066-VENDOR: a booking's details open from the keyboard (desktop table and mobile card)", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const centre = await bookableCentre(f);
    const ref = await paidBooking(f, centre);
    for (const viewport of ["desktop", "mobile"] as const) {
      const ui = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        const { page } = ui;
        await page.goto("/vendor?tab=bookings");
        await expect(page.getByText("QA synthetic guest").filter({ visible: true }).first()).toBeVisible();
        const opener = page.getByRole("button", { name: /Open booking for QA synthetic guest/ }).filter({ visible: true }).first();
        await expect(opener, `${viewport}: named booking opener`).toBeVisible();
        expect(await opener.evaluate((el) => el.tagName === "BUTTON" && (el as HTMLElement).tabIndex >= 0), `${viewport}: native, tabbable button`).toBe(true);
        await opener.focus();
        expect((await focused(page)).focusVisible, `${viewport}: visible focus`).toBe(true);
        await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog").filter({ hasText: ref })).toBeVisible();
      } finally { await ui.close(); }
    }
    await evidence("hc-qa-066-vendor", { keyboardOpensBooking: true });
  });
});

test("HC-QA-067-VENDOR / HC-QA-068-PROGRAMME: gallery upload is a reachable button; programme forms are labelled", async ({ playwright, browser }) => {
  test.setTimeout(75_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const id = await experienceFor(f, "QA_VENDOR");
    await f.connection.execute("UPDATE experiences SET title = 'QA photo hike', blurb = 'Synthetic', kind = 'adventure', price_cents = 1000, duration_minutes = 60, capacity = 6, area = 'QA', county = 'Dublin' WHERE id = ?", [id]);
    const ui = await businessUiActor(browser, "QA_VENDOR", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/vendor/experiences/${id}`);
      await expect(page.getByRole("button", { name: /Save & continue/ }).last()).toBeVisible();
      for (let i = 0; i < 5 && !(await page.getByText("Add some photos.").isVisible().catch(() => false)); i++) {
        const next = page.getByRole("button", { name: /Save & continue/ }).last();
        await next.focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
      await expect(page.getByText("Add some photos."), "wizard reached the photos step").toBeVisible();
      const addButton = page.getByRole("button", { name: /add photo/i });
      await expect(addButton, "gallery 'Add photo' is a named button").toBeVisible();
      expect(await addButton.evaluate((el) => el.tagName === "BUTTON" && (el as HTMLElement).tabIndex >= 0), "native, tabbable").toBe(true);
      await addButton.focus();
      const chooser = page.waitForEvent("filechooser", { timeout: 3_000 });
      await page.keyboard.press("Enter");
      await chooser;

      await page.goto("/vendor/programs/new");
      await expect(page.getByRole("heading", { name: "New program" })).toBeVisible();
      expect(await unlabeledControls(page), "new programme form").toEqual([]);
      const centre = await centreFor(f, "QA_VENDOR");
      const program = await programFor(f, "QA_VENDOR", centre.id);
      await page.goto(`/vendor/programs/${program}`);
      await page.getByRole("button", { name: "Add session" }).first().click({ timeout: 10_000 });
      expect(await unlabeledControls(page), "programme session form").toEqual([]);
      expect((await focused(page)).tag).toBeTruthy();
    } finally { await ui.close(); }
  });
});
