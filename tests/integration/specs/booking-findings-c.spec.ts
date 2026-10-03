import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, expectedTotal, guest, irelandDate, registrationBody, synthCoupon } from "../booking-fixture";

// Phase 8 booking finding gate HC-QA-034..047. The original failing-before
// regressions are unchanged (red before remediation, green after); HC-QA-047 was
// found and fixed during the remediation cross-model review. Extended scenarios
// live in booking-remediation*.spec.ts and booking-provider.spec.ts.

async function guests(playwright: any, n: number, opened: APIRequestContext[]) { return Promise.all(Array.from({ length: n }, () => guest(playwright, opened))); }

test("HC-QA-045: a past-dated experience session cannot be booked", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const exp = await bookableExperience(f, { price: 0, capacity: 5, date: "2021-05-05" });
      const [g] = await guests(playwright, 1, opened);
      const r = await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email) });
      await evidence("hc-qa-045", { status: r.status() });
      expect(r.status()).toBe(409);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-046: concurrent duplicate cancels change state once and notify once", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async f => {
    const opened: APIRequestContext[] = [];
    try {
      const club = await bookableClub(f, { price: 0, capacity: 3 });
      const [g] = await guests(playwright, 1, opened);
      const ref = (await (await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email) })).json()).ref;
      await new Promise(res => setTimeout(res, 800));
      const before = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length;
      const cancels = await Promise.all([1, 2, 3].map(() => g.ctx.post(`/api/registrations/${ref}/cancel`, { data: {} })));
      await new Promise(res => setTimeout(res, 1200));
      const after = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length;
      const centre = await bookableCentre(f, { rate: 20 });
      const bref = (await (await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email) })).json()).ref;
      await new Promise(res => setTimeout(res, 800));
      const bBefore = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [bref])).length;
      const bCancels = await Promise.all([1, 2, 3].map(() => g.ctx.post(`/api/bookings/${bref}/cancel`, { data: {} })));
      await new Promise(res => setTimeout(res, 1200));
      const bAfter = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [bref])).length;
      const fanOut = 2; // one cancellation fan-out is guest-visible + vendor (as observed for a single cancel)
      await evidence("hc-qa-046", { registrationStatuses: cancels.map(r => r.status()).sort().join(","), registrationNotifications: after - before, bookingStatuses: bCancels.map(r => r.status()).sort().join(","), bookingNotifications: bAfter - bBefore });
      expect(cancels.filter(r => r.status() === 200).length).toBe(1);
      expect(bCancels.filter(r => r.status() === 200).length).toBe(1);
      expect(after - before).toBeLessThanOrEqual(fanOut);
      expect(bAfter - bBefore).toBeLessThanOrEqual(fanOut);
    } finally { for (const c of opened) await c.dispose(); }
  });
});

test("HC-QA-047: programme enrolment and paid activity confirmations show the amount the server will charge", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_HOST"], async f => {
    const program = await bookableProgram(f, { price: 2500, capacity: 5 });
    await f.connection.execute("INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, ?, '18:00', 'scheduled')", [randomUUID(), program.id, irelandDate(10)]); // enrolment needs an upcoming session
    const gameRes = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA paid ${randomUUID().slice(0, 6)}`, date: "2030-07-15", time: "18:30", capacity: 6, locationText: "QA", priceCents: 800 } });
    expect(gameRes.status()).toBe(201);
    const game = await gameRes.json();
    f.track("games", "id", game.id); f.track("game_participants", "game_id", game.id); f.track("listing_attributes", "listing_id", game.id); f.track("notifications", "listing_id", game.id);
    const user = await uiActor(browser, "QA_USER", "desktop");
    try {
      const { page } = user;
      await page.goto(`/programs/${program.id}`);
      await page.getByRole("button", { name: "Enroll", exact: true }).filter({ visible: true }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(`€${(expectedTotal(2500) / 100).toFixed(2)}`, { exact: true })).toBeVisible();
      await page.goto(`/games/${game.id}`);
      await page.getByRole("button", { name: /^Join · €8\.00$/ }).filter({ visible: true }).first().click();
      await expect(page.locator('[data-qa="game-quote-total"]').first()).toContainText(`€${(expectedTotal(800) / 100).toFixed(2)}`);
      await evidence("hc-qa-047", { programShown: `€${(expectedTotal(2500) / 100).toFixed(2)}`, gameShown: `€${(expectedTotal(800) / 100).toFixed(2)}` });
    } finally { await user.close(); }
  });
});
