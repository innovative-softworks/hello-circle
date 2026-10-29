import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { env, expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor } from "../lifecycle-ui-fixture";
import { bookableExperience, irelandDate } from "../booking-fixture";

// Phase K (docs/participation-expansion/22) end to end: the partner writes to
// the people booked on an event from the Messages screen — template, audience
// preview (counts and first names, never addresses), confirmation, delivery
// status — and the signed-in resident gets it in the app. A guest's real
// address is held back on this test site. Synthetic event of QA_VENDOR.

const SHOTS = `${process.cwd()}/.qa-data/phase2-shots`;
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/config-${name}.png`, fullPage: true });

test("CFG-MESSAGES: a partner sends an event update to the right people; the resident gets it in the app", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["QA_VENDOR", "QA_USER"], async (f) => {
    const exp = await bookableExperience(f, { price: 0, capacity: 20, payment: "cash", date: irelandDate(12) });
    for (const [t, c] of [["audit_log", "object_id"]]) f.track(t, c, exp.id);
    const [me] = await rows(f, "SELECT email FROM residents WHERE id = ?", [personas.QA_USER.id]);
    // QA_USER books (signed in), and a guest with a real-looking address books too.
    const mine = await f.actors.QA_USER.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { headers: { "X-Client-Id": randomUUID() }, data: { participantName: "Aoife QA", email: String(me.email), partySize: 1 } });
    expect(mine.status()).toBe(201);
    const guestCtx = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, extraHTTPHeaders: { "X-Client-Id": randomUUID() } });
    const real = await guestCtx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: { participantName: "Cian Real", email: "cian.real.person@gmail.com", partySize: 1 } });
    expect(real.status()).toBe(201);
    const refs = [(await mine.json()).ref as string, (await real.json()).ref as string];
    await guestCtx.dispose();
    for (const ref of refs) {
      for (const [t, c] of [["experience_booking_participants", "booking_ref"], ["order_acknowledgements", "source_ref"]]) f.track(t, c, ref);
    }
    f.track("notifications", "resident_id", personas.QA_USER.id);

    const vendor = await staffActor(browser, "QA_VENDOR");
    let messageId = 0;
    try {
      const { page } = vendor;
      page.setDefaultTimeout(15_000);
      await page.goto("/vendor?tab=messages");
      await page.getByRole("button", { name: "New message" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Listing").selectOption({ label: `Event or experience: ${exp.title}` });
      const preview = dialog.getByTestId("message-preview");
      await expect(preview).toContainText("Goes to 2 people (1 also in the app)");
      await expect(preview).toContainText("held back");
      await expect(preview).not.toContainText("@");
      await dialog.getByLabel("Template").selectOption({ label: "What to bring" });
      await expect(dialog.getByLabel(/^Subject/)).toHaveValue("What to bring: {listing}");
      // The bracketed placeholder must be replaced before sending.
      await dialog.getByLabel(/^Message/).fill("Hello {name},\n\nFor {listing}, please bring a water bottle and a warm layer.\n\nThanks!");
      await shot(page, "40-partner-message-compose");
      await dialog.getByRole("button", { name: "Review and send" }).click();
      await expect(page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Send to 2 people/ })).first()).toContainText("Send to 2 people?");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText(/Sent: 2 people/)).toBeVisible();
      const [msg] = await rows(f, "SELECT id FROM vendor_messages WHERE listing_id = ? ORDER BY id DESC LIMIT 1", [exp.id]);
      messageId = Number(msg.id);
      f.track("vendor_message_deliveries", "message_id", messageId); f.track("vendor_messages", "id", messageId);
      await page.keyboard.press("Escape");
      await expect(page.getByText(/in the app 1 sent/).first()).toBeVisible();
      await shot(page, "41-partner-message-history");
      expect(vendor.consoleErrors).toEqual([]);
    } finally { await vendor.close(); }
    const deliveries = await rows(f, "SELECT channel, status FROM vendor_message_deliveries WHERE message_id = ? ORDER BY channel, status", [messageId]);
    expect(deliveries.map((d) => `${d.channel}:${d.status}`)).toEqual(expect.arrayContaining(["in_app:sent", "email:held_test_environment"]));

    // The resident sees it in the app; it opens their booking.
    const res = await uiActor(browser, "QA_USER", "mobile");
    try {
      const { page } = res;
      page.setDefaultTimeout(15_000);
      const list = await (await page.request.get("/api/residents/me/notifications")).json();
      const items = (Array.isArray(list) ? list : list.items ?? []) as { kind: string; title: string; body: string; ref: string }[];
      const got = items.find((n) => n.kind === "organiser_message" && n.title === `What to bring: ${exp.title}`);
      expect(got?.body).toContain("Hello Aoife");
      expect(got?.body).toContain("water bottle");
      expect(got?.ref).toMatch(/^experience\//);
      await page.goto(`/bookings/${got!.ref}`);
      await expect(page.getByText(exp.title).first()).toBeVisible();
    } finally { await res.close(); }
  });
});
