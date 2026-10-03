import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableExperience, bookingBody, expectedTotal } from "../booking-fixture";

// Phase 8 — real-browser booking journeys (desktop + mobile with the consent
// banner present). Book an adventure through the UI; view and cancel a hall
// booking in My Life (centre booking pages are behind the venue launch gate,
// and experience/programme bookings have no UI cancel — see QA_PRODUCT_GAPS).

const reachable = (page: Page, locator: ReturnType<Page["getByRole"]>) =>
  locator.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)); });

for (const viewport of ["desktop", "mobile"] as const) {
  test(`BK-UI-${viewport.toUpperCase()}: book an adventure, see it in My Life, view and cancel a hall booking`, async ({ playwright, browser }) => {
    test.setTimeout(150_000);
    await withActors(playwright, ["QA_VENDOR"], async f => {
      const exp = await bookableExperience(f, { price: 1000, capacity: 6, payment: "cash" });
      const centre = await bookableCentre(f, { rate: 20 });
      const user = await uiActor(browser, null, viewport, { consent: viewport === "desktop" });
      try {
        const { page } = user;
        await page.goto(`/experiences/${exp.id}`);
        await expect(page.getByRole("heading", { name: exp.title }).first()).toBeVisible();
        await page.waitForTimeout(600);
        // Mobile books from the fixed join bar (the in-page card CTA is below the fold).
        const cta = viewport === "mobile"
          ? page.locator(".mobile-join-bar").getByRole("button", { name: "Book this adventure" })
          : page.getByRole("button", { name: "Book this adventure" }).filter({ visible: true }).first();
        if (viewport === "mobile") {
          // HC-QA-001 coexistence: banner, booking CTA (join bar) and tab bar all usable.
          await expect(page.getByRole("button", { name: "Necessary only", exact: true })).toBeVisible();
          expect(await reachable(page, cta), "booking CTA reachable with the consent banner shown").toBe(true);
          expect(await reachable(page, page.getByRole("button", { name: "Necessary only", exact: true }))).toBe(true);
        }
        await cta.click();
        const dialog = page.getByRole("dialog");
        await page.waitForTimeout(500);
        const sessionButton = dialog.getByRole("button", { name: /left$/ });
        if (await sessionButton.count()) await sessionButton.first().click(); // a single session is pre-selected
        await dialog.locator('input[autocomplete="name"]').fill("QA UI booker");
        await dialog.locator('input[type="email"]').fill(`qa_ui_${viewport}@example.test`);
        await dialog.getByRole("button", { name: "Increase", exact: true }).click(); // party of 2
        const shownTotal = (await dialog.locator("text=/^€\\d/").first().textContent())?.trim();
        const submit = dialog.getByRole("button", { name: /^(Book|Continue to pay)$/ });
        expect(await reachable(page, submit), "dialog submit not obscured").toBe(true);
        await submit.click();
        await expect(page.getByRole("heading", { name: "You're booked." })).toBeVisible();
        const clientId = await page.evaluate(() => localStorage.getItem("hello_circle_client_id"));
        const [booked] = await rows(f, "SELECT ref, party_size, total_cents, payment_status, status FROM experience_bookings WHERE session_id = ? AND client_id = ?", [exp.session, clientId]);
        expect(booked).toMatchObject({ payment_status: "paid", status: "confirmed" });
        expect(booked.total_cents).toBe(expectedTotal(1000 * booked.party_size));
        // A hall booking owned by this same browser (created via the API with its client id).
        const create = await page.request.post("/api/bookings/checkout", { headers: { "X-Client-Id": clientId! }, data: bookingBody(centre, `qa_ui_${viewport}@example.test`) });
        expect(create.status()).toBe(201);
        const hallRef = (await create.json()).ref;
        await page.goto("/bookings");
        await expect(page.getByText(exp.title).first()).toBeVisible();
        await expect(page.getByText(hallRef).first()).toBeVisible();
        await page.getByRole("button", { name: /View full activity/ }).click(); // bookings, references and history
        const row = page.locator("div").filter({ hasText: hallRef }).filter({ has: page.getByRole("button", { name: "Cancel", exact: true }) }).last();
        const cancel = row.getByRole("button", { name: "Cancel", exact: true });
        await cancel.evaluate((el) => el.scrollIntoView({ block: "center" })); // a user scrolls the row into view
        expect(await reachable(page, cancel), "cancel control not obscured").toBe(true);
        await cancel.click();
        // Confirm inside the confirmation dialog (My Life now also offers
        // "Cancel booking for <adventure>" on the experience row — Phase 11B).
        await page.getByRole("alertdialog").getByRole("button", { name: "Cancel booking" }).click();
        await expect.poll(async () => (await rows(f, "SELECT status FROM bookings WHERE ref = ?", [hallRef]))[0].status).toBe("cancelled");
        await page.reload();
        await page.getByRole("button", { name: /View full activity/ }).click();
        await expect(page.getByText(hallRef).first()).toBeVisible(); // stays in history, marked cancelled
        expect(user.consoleErrors).toEqual([]);
        await evidence(`bk-ui-${viewport}`, { adventureBooked: true, partySize: booked.party_size, storedTotalCents: booked.total_cents, shownTotal: shownTotal ?? "n/a", hallViewedAndCancelled: true });
      } finally { await user.close(); }
    });
  });
}
