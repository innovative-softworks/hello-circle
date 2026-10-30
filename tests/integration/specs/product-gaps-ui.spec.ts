import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { tabTo, focused } from "../product-fixture";
import { bookableExperience, bookableProgram, experienceBody } from "../booking-fixture";

// Phase 11B — resident self-cancel in My Life (experience bookings and
// programme enrolments). Fail-before: My Life had no cancel control for either.

// My Life 3.0 (owner 2026-10-25/26): upcoming experience bookings are photo cards in
// My Life → My Plans; each opens its booking page, where "Cancel booking" lives.
// Programme enrolments stay rows on My Plans with their own cancel control.
async function openMyPlans(page: Page) {
  await page.goto("/my-life?tab=plans");
  await expect(page.getByRole("heading", { level: 2, name: "Coming up" })).toBeVisible({ timeout: 20_000 });
}
const upcomingCard = (page: Page, title: string) => page.locator("#mlx-plans-upcoming").getByRole("link").filter({ hasText: title });

async function bookExperience(f: any, price: number) {
  const exp = await bookableExperience(f, { price, capacity: 4, payment: "cash" });
  // Booked as the signed-in resident (resident_id set → shows in their My Life); these routes also require a client id.
  const res = await f.actors.QA_USER.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { headers: { "X-Client-Id": randomUUID() }, data: experienceBody(`qa_user_${randomUUID().slice(0, 6)}@example.test`) });
  expect(res.status()).toBe(201);
  const ref = (await res.json()).ref as string;
  f.track("audit_log", "object_id", ref);
  const [{ title }] = await rows(f, "SELECT title FROM experiences WHERE id = ?", [exp.id]);
  return { exp, ref, title: title as string };
}

test("HC-GAP-UI-EXP: keyboard-only experience self-cancel — confirmation dialog takes focus, honest outcome, row updates, capacity once", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const { exp, ref, title } = await bookExperience(f, 0);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      await openMyPlans(page);
      await expect(upcomingCard(page, title)).toHaveCount(1);
      // Keyboard only: Tab to the booking's card, open it, Tab to "Cancel booking".
      await page.locator("body").focus();
      const card = await tabTo(page, (x) => x.tag === "A" && x.name.includes(title), { max: 200 });
      expect(card, "the booking card is reachable by keyboard").not.toBeNull();
      expect(card!.focusVisible).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/bookings/experience/${ref}$`));
      await expect(page.getByRole("heading", { level: 1, name: "You're booked" })).toBeVisible();
      const trigger = await tabTo(page, (x) => x.tag === "BUTTON" && x.name === "Cancel booking" && !x.inDialog, { max: 80 });
      expect(trigger, "Cancel booking reachable by keyboard").not.toBeNull();
      expect(trigger!.focusVisible).toBe(true);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this booking?" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(title);
      await expect(dialog).toContainText("Nothing was charged online.");
      await expect.poll(async () => (await focused(page)).inDialog, { message: "focus moves into the dialog" }).toBe(true);
      const confirmBtn = await tabTo(page, (x) => x.inDialog && x.name === "Cancel booking", { max: 6 });
      expect(confirmBtn, "confirm reachable inside the dialog").not.toBeNull();
      await page.keyboard.press("Enter");
      // Honest outcome: the page says cancelled, never mentions a refund for a free booking.
      await expect(page.getByRole("heading", { level: 1, name: "Cancelled" })).toBeVisible();
      await expect(page.getByText("Done. We've updated this booking.")).toBeVisible();
      await expect(page.getByText(/refund/i)).toHaveCount(0);
      const [row] = await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]);
      expect(row.status).toBe("cancelled");
      const [{ n }] = await rows(f, "SELECT COUNT(*) AS n FROM experience_bookings WHERE session_id = ? AND status != 'cancelled'", [exp.session]);
      expect(Number(n), "capacity released").toBe(0);
      // The card leaves "Coming up" in My Life.
      await openMyPlans(page);
      await expect(upcomingCard(page, title)).toHaveCount(0);
      await evidence("hc-gap-ui-exp", { keyboard: true, dialogFocus: true, outcome: "Cancelled" });
    } finally { await ui.close(); }
  });
});

test("HC-GAP-UI-EXP-PAID: mobile — network error recovers (no stuck spinner), paid cancel says 'refund processing', survives refresh and Back", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const { exp, ref, title } = await bookExperience(f, 1500);
    await f.connection.execute("UPDATE experience_bookings SET stripe_session_id = ? WHERE ref = ?", [`cs_test_qa_${randomUUID()}`, ref]);
    const ui = await uiActor(browser, "QA_USER", "mobile");
    try {
      const { page } = ui;
      await openMyPlans(page);
      await upcomingCard(page, title).click();
      await expect(page).toHaveURL(new RegExp(`/bookings/experience/${ref}$`));
      let fail = true;
      await page.route((u) => u.pathname === `/api/experiences/bookings/${ref}/cancel`, (route) => (fail ? route.abort("failed") : route.continue()));
      await page.getByRole("button", { name: "Cancel booking", exact: true }).click();
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this booking?" });
      await expect(dialog).toContainText("Any refund follows the cancellation terms shown on this page.");
      await dialog.getByRole("button", { name: "Cancel booking" }).click();
      // A dropped connection: the dialog stays open, says so plainly, and can be used again.
      await expect(dialog.getByRole("alert")).toHaveText("We couldn't reach HelloCircle — check your connection and try again.");
      await expect(dialog.getByRole("button", { name: "Cancel booking" }), "button usable again, no indefinite spinner").toBeEnabled();
      expect((await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]))[0].status).toBe("confirmed");
      fail = false;
      await dialog.getByRole("button", { name: "Cancel booking" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Cancelled — refund on its way" })).toBeVisible();
      await expect(page.getByText("Cancelled and refunded"), "never claims 'refunded' early").toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Cancelled — refund on its way" }), "server state after refresh").toBeVisible();
      await page.goto(`/experiences/${exp.id}`);
      await page.goBack();
      await expect(page.getByRole("heading", { level: 1, name: "Cancelled — refund on its way" }), "after browser Back").toBeVisible();
      expect((await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]))[0].status).toBe("cancelled");
      await openMyPlans(page);
      await expect(upcomingCard(page, title)).toHaveCount(0);
      await evidence("hc-gap-ui-exp-paid", { networkErrorRecovered: true, outcome: "Cancelled — refund on its way", refresh: true, back: true });
    } finally { await ui.close(); }
  });
});

test("HC-GAP-UI-PROG: programme self-cancel with the mouse — confirm, outcome, row cancelled, already-cancelled handled", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const prog = await bookableProgram(f, { price: 0, capacity: 3 });
    const res = await f.actors.QA_USER.post(`/api/programs/${prog.id}/enroll`, { headers: { "X-Client-Id": randomUUID() }, data: { participantName: "QA Kid", email: `qa_user_${randomUUID().slice(0, 6)}@example.test` } });
    expect(res.status()).toBe(201);
    const ref = (await res.json()).ref as string;
    f.track("audit_log", "object_id", ref);
    const [{ title }] = await rows(f, "SELECT title FROM programs WHERE id = ?", [prog.id]);
    const ui = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = ui;
      await openMyPlans(page);
      await page.getByRole("button", { name: `Cancel enrolment for ${title}`, exact: true }).click();
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this enrolment?" });
      await expect(dialog).toBeVisible();
      // Cancelled elsewhere meanwhile (another tab) → the server's answer is shown, no false success.
      expect((await f.actors.QA_USER.post(`/api/programs/enrollments/${ref}/cancel`, { headers: { "X-Client-Id": randomUUID() }, data: {} })).status()).toBe(200);
      await dialog.getByRole("button", { name: "Cancel enrolment" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /already cancelled/i })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /^Cancellation confirmed/ })).toHaveCount(0);
      expect((await rows(f, "SELECT status FROM program_enrollments WHERE ref = ?", [ref]))[0].status).toBe("cancelled");
      await evidence("hc-gap-ui-prog", { mouse: true, alreadyCancelledHandled: true });
    } finally { await ui.close(); }
  });
});
