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

// Booking rows (and their cancel controls, like the existing hall-booking
// Cancel) live under "View full activity" — wait for it to load, then open it.
async function openMyLife(page: Page) {
  await page.goto("/my-life");
  const toggle = page.getByRole("button", { name: /(View|Hide) full activity/ });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
const rowFor = (page: Page, title: string) => page.locator("div").filter({ has: page.getByText(title, { exact: true }) }).filter({ has: page.getByRole("button", { name: `Cancel booking for ${title}` }).or(page.getByRole("button", { name: `Cancel enrolment for ${title}` })) }).last();

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
      await openMyLife(page);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: `Cancel booking for ${title}`, exact: true }), "cancel control rendered with a contextual accessible name").toHaveCount(1);
      await page.locator("body").focus();
      const trigger = await tabTo(page, (x) => x.tag === "BUTTON" && x.name === `Cancel booking for ${title}` && !x.inDialog, { max: 200 });
      expect(trigger, "Cancel booking reachable by keyboard").not.toBeNull();
      expect(trigger!.focusVisible).toBe(true);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this booking?" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(title);
      await expect.poll(async () => (await focused(page)).inDialog, { message: "focus moves into the dialog" }).toBe(true);
      const confirmBtn = await tabTo(page, (x) => x.inDialog && x.name === "Cancel booking", { max: 6 });
      expect(confirmBtn, "confirm reachable inside the dialog").not.toBeNull();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: /^Cancellation confirmed$/ })).toBeVisible();
      await expect(page.getByText("Refund processing")).toHaveCount(0);
      const [row] = await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]);
      expect(row.status).toBe("cancelled");
      const [{ n }] = await rows(f, "SELECT COUNT(*) AS n FROM experience_bookings WHERE session_id = ? AND status != 'cancelled'", [exp.session]);
      expect(Number(n), "capacity released").toBe(0);
      await expect(rowFor(page, title)).toHaveCount(0);
      await evidence("hc-gap-ui-exp", { keyboard: true, dialogFocus: true, outcome: "Cancellation confirmed" });
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
      await openMyLife(page);
      let fail = true;
      await page.route((u) => u.pathname === `/api/experiences/bookings/${ref}/cancel`, (route) => (fail ? route.abort("failed") : route.continue()));
      await page.getByRole("button", { name: `Cancel booking for ${title}`, exact: true }).click();
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this booking?" });
      await expect(dialog).toContainText("Your refund is issued by the host through HelloCircle");
      await dialog.getByRole("button", { name: "Cancel booking" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /check your connection/i })).toBeVisible();
      const retry = page.getByRole("button", { name: `Cancel booking for ${title}`, exact: true });
      await expect(retry, "button usable again, no indefinite spinner").toBeEnabled();
      expect((await rows(f, "SELECT status FROM experience_bookings WHERE ref = ?", [ref]))[0].status).toBe("confirmed");
      fail = false;
      await retry.click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel booking" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Cancellation confirmed — refund processing" })).toBeVisible();
      await expect(page.getByText("Refunded", { exact: true }), "never claims 'Refunded' early").toHaveCount(0);
      await page.reload();
      await openMyLife(page);
      await expect(page.getByText("Refund processing").first(), "server state after refresh").toBeVisible();
      await page.goto(`/experiences/${exp.id}`);
      await page.goBack();
      await openMyLife(page);
      await expect(page.getByText("Refund processing").first(), "after browser Back").toBeVisible();
      await expect(rowFor(page, title)).toHaveCount(0);
      await evidence("hc-gap-ui-exp-paid", { networkErrorRecovered: true, outcome: "Cancellation confirmed — refund processing", refresh: true, back: true });
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
      await openMyLife(page);
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
