import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookingBody, guest, irelandDate } from "../booking-fixture";
import { businessUiActor, mailTo } from "../product-fixture";
import { loginAs, seedCentre, syntheticOrg } from "../org-fixture";
import { connectedPreflight } from "../runtime";
import type { Scope } from "../stage-b-fixture";

// D-10 / D-11 (approved for local implementation 2026-10-15) — paid orders
// under review, end to end on the real server and isolated database, with the
// QA payment-provider stub (batch "revenue-…"; no network, no Stripe). Paid
// Checkout events go through the real webhook pipeline via /api/__qa/payment.
// Checks the customer's confirmation page and Finance's review pages in the
// browser (desktop and phone), and the centred Recheck confirmation.
// Logins (real limiter of 10 per IP): QA_ADMIN API, QA_ADMIN desktop and
// phone browsers, one support admin = 4.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** A guest's browser: same device id as their API context (so "my booking" is theirs). */
async function guestBrowser(browser: Browser, clientId: string, mobile = false) {
  const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile && browser.browserType().name() !== "firefox", hasTouch: mobile, serviceWorkers: "block" });
  await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
  await context.addInitScript((id) => {
    try {
      localStorage.setItem("hello_circle_cookie_consent", "rejected");
      localStorage.setItem("hello_circle_client_id", id);
    } catch { /* storage unavailable */ }
  }, clientId);
  return { context, page: await context.newPage() };
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const qaPay = (actor: APIRequestContext, data: Record<string, unknown>) => actor.post("/api/__qa/payment", { data });

/** Ireland wall-clock date and an HH:MM time `minutes` from now. */
function irelandAt(minutes: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(Date.now() + minutes * 60_000)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

async function supportAdmin(playwright: Parameters<typeof loginAs>[0], f: Scope, opened: APIRequestContext[]) {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_d10_support_${id.slice(0, 8)}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', 'QA D-10 support', 'support')", [id, email, bcrypt.hashSync(password, 10)]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id); f.track("notifications", "recipient_id", id);
  return loginAs(playwright, email, password, opened);
}

/** Checkout through the real route; tracks everything the review flow writes for the order. */
async function checkout(f: Scope, g: Awaited<ReturnType<typeof guest>>, centre: { id: string; room: string }, date: string, time: string) {
  const res = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { date, time, duration: 1 }) });
  expect(res.status(), "checkout").toBe(201);
  const ref = (await res.json()).ref as string;
  for (const [t, c] of [["bookings", "ref"], ["payment_reviews", "source_ref"], ["refunds", "source_ref"], ["payment_records", "source_ref"], ["checkout_agreements", "source_ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(t, c, ref);
  const sid = (await rows(f, "SELECT stripe_session_id AS sid FROM bookings WHERE ref = ?", [ref]))[0].sid as string;
  f.track("webhook_events", "object_id", sid);
  const total = Number((await rows(f, "SELECT total_cents AS t FROM bookings WHERE ref = ?", [ref]))[0].t);
  return { ref, sid, total };
}
async function trackReview(f: Scope, ref: string) {
  const [r] = await rows(f, "SELECT id FROM payment_reviews WHERE source_ref = ?", [ref]);
  for (const [t, c] of [["payment_review_alerts", "review_id"], ["notifications", "listing_id"]]) f.track(t, c, String(r.id));
  f.track("audit_log", "object_id", `review-${r.id}`);
  return Number(r.id);
}

test("D10-REVIEW: held payment → place kept, customer and Finance see accurate states; deadline releases it with no refund; Recheck closes after a provider refund; case 4 refunds automatically once", async ({ playwright, browser }) => {
  test.setTimeout(300_000);
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const admin = f.actors.QA_ADMIN;
      const org = await syntheticOrg(playwright, f, opened, [], []);
      const centre = await seedCentre(f, org.owner.id, { payment: "online", rate: 20 });
      const support = await supportAdmin(playwright, f, opened);
      const date = irelandDate(16);

      // --- case 1: Stripe reports a different amount ---------------------------------
      const a = await guest(playwright, opened);
      const A = await checkout(f, a, centre, date, "12:00");
      expect((await (await qaPay(a.ctx, { action: "paid", type: "booking", ref: A.ref, amountMinor: A.total + 100 })).json()).result).toBe("parked");
      const reviewA = await trackReview(f, A.ref);
      let status = await (await a.ctx.get(`/api/bookings/status/${A.ref}`)).json();
      expect(status).toMatchObject({ paymentStatus: "pending", paymentReview: true, paymentCase: { state: "review", reason: "amount_mismatch", receivedMinor: A.total + 100 } });
      // Its own 30-minute hold has lapsed; the review still keeps the place.
      await f.connection.execute("UPDATE bookings SET created_at = NOW() - INTERVAL 40 MINUTE WHERE ref = ?", [A.ref]);
      const b = await guest(playwright, opened);
      const blocked = await b.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, b.email, { date, time: "12:00", duration: 1 }) });
      expect(blocked.status(), "the held place can't be sold").toBe(409);
      const list = (await (await admin.get("/api/admin/finance/payment-reviews")).json()) as { id: number; holdStatus: string; receivedMinor: number }[];
      expect(list.find((r) => r.id === reviewA)).toMatchObject({ holdStatus: "held", receivedMinor: A.total + 100 });

      // Customer page (desktop + phone).
      for (const mobile of [false, true]) {
        const c = await guestBrowser(browser, a.clientId, mobile);
        try {
          await c.page.goto(`/payment/success?ref=${A.ref}`);
          await expect(c.page.getByText("Your payment needs a quick check")).toBeVisible();
          await expect(c.page.getByText(/We've received your payment of €/)).toBeVisible();
          await expect(c.page.getByText(/couldn't find that booking/i)).toHaveCount(0);
          expect(await noSideScroll(c.page)).toBe(true);
          await shot(c.page, `d10-customer-review${mobile ? "-mobile" : ""}`);
        } finally {
          await c.context.close();
        }
      }

      // Finance: list and record page (desktop + phone).
      for (const viewport of ["desktop", "mobile"] as const) {
        const ui = await businessUiActor(browser, "QA_ADMIN", viewport);
        try {
          await ui.page.goto("/admin?tab=finance&section=reviews");
          await expect(ui.page.getByRole("heading", { name: "Payment reviews" })).toBeVisible();
          await ui.page.getByRole("button", { name: `Open payment review ${reviewA}` }).click();
          await expect(ui.page.getByRole("heading", { level: 1, name: `Payment review #${reviewA}` })).toBeVisible();
          await expect(ui.page.getByText("Place held").first()).toBeVisible();
          await expect(ui.page.getByText("Amount differs from the agreed amount")).toBeVisible();
          await expect(ui.page.getByText("None (not applied to the order)")).toBeVisible();
          expect(await noSideScroll(ui.page)).toBe(true);
          await shot(ui.page, `d10-finance-review-held${viewport === "mobile" ? "-mobile" : ""}`);
        } finally {
          await ui.close();
        }
      }

      // --- the deadline passes (controlled clock): place released, no refund ---------
      await f.connection.execute("UPDATE payment_reviews SET review_hold_until = NOW() - INTERVAL 1 SECOND WHERE id = ?", [reviewA]);
      await f.connection.execute("UPDATE bookings SET review_hold_until = NOW() - INTERVAL 1 SECOND WHERE ref = ?", [A.ref]);
      expect((await (await qaPay(admin, { action: "sweep" })).json()).expired).toBeGreaterThanOrEqual(1);
      expect((await qaPay(admin, { action: "sweep" })).status()).toBe(200); // a second sweep repeats nothing
      expect((await rows(f, "SELECT kind FROM payment_review_alerts WHERE review_id = ? ORDER BY id", [reviewA])).map((r) => r.kind)).toEqual(["parked", "expired"]);
      expect(await rows(f, "SELECT id FROM refunds WHERE source_ref = ?", [A.ref]), "expiry never refunds").toEqual([]);
      status = await (await a.ctx.get(`/api/bookings/status/${A.ref}`)).json();
      expect(status.paymentCase.state).toBe("review_expired");
      const B = await checkout(f, b, centre, date, "12:00"); // now the place can be sold
      expect(B.ref).toBeTruthy();

      // --- D-11: refund in the provider's dashboard, then Recheck with Stripe -----------
      await qaPay(admin, { action: "dashboard_refund", type: "booking", ref: A.ref, amountMinor: A.total + 100 });
      const denied = await support.post(`/api/admin/finance/payment-reviews/${reviewA}/recheck`, { data: { reason: "Support tries to recheck" } });
      expect(denied.status(), "support can't recheck").toBe(403);
      const ui = await businessUiActor(browser, "QA_ADMIN", "desktop");
      try {
        await ui.page.goto(`/admin?tab=finance&section=reviews&record=review:${reviewA}`);
        await ui.page.getByRole("button", { name: "Recheck with Stripe…" }).click();
        const dialog = ui.page.getByRole("alertdialog", { name: "Recheck this payment with Stripe?" });
        await expect(dialog).toContainText("never issues a refund");
        const confirm = dialog.getByRole("button", { name: "Recheck with Stripe" });
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel(/^Reason/).fill("Customer refunded in the Stripe Dashboard");
        await shot(ui.page, "d10-finance-recheck-confirm");
        await confirm.click();
        await expect(dialog).toBeHidden();
        await expect(ui.page.getByText(/Closed — refunded/).first()).toBeVisible();
        await expect(ui.page.getByText("Hold expired — place released").or(ui.page.getByText("Place released")).first()).toBeVisible();
        await shot(ui.page, "d10-finance-review-closed");
      } finally {
        await ui.close();
      }
      status = await (await a.ctx.get(`/api/bookings/status/${A.ref}`)).json();
      expect(status).toMatchObject({ paymentStatus: "refunded", paymentCase: { state: "refunded", refundedMinor: A.total + 100 } });
      expect((await rows(f, "SELECT status FROM bookings WHERE ref = ?", [A.ref]))[0].status).toBe("cancelled");
      const again = await (await admin.post(`/api/admin/finance/payment-reviews/${reviewA}/recheck`, { data: { reason: "Second recheck, nothing new" } })).json();
      expect(again).toMatchObject({ outcome: "closed", recordedRefunds: 0, updatedRefunds: 0 });
      expect(await rows(f, "SELECT id FROM refunds WHERE source_ref = ?", [A.ref])).toHaveLength(1);
      const refundMails = (await mailTo(admin, a.email)).filter((m) => /refunded/.test(m.subject));
      expect(refundMails, "one refund email to the customer (QA sink), not one per recheck").toHaveLength(1);
      const c = await guestBrowser(browser, a.clientId, true);
      try {
        await c.page.goto(`/payment/success?ref=${A.ref}`);
        await expect(c.page.getByText("Your booking wasn't confirmed — your payment was refunded")).toBeVisible();
        await shot(c.page, "d10-customer-refunded-mobile");
      } finally {
        await c.context.close();
      }

      // --- case 4: the place was sold while the payment was delayed → automatic refund ---
      const g1 = await guest(playwright, opened);
      const C = await checkout(f, g1, centre, date, "15:00");
      await f.connection.execute("UPDATE bookings SET created_at = NOW() - INTERVAL 40 MINUTE WHERE ref = ?", [C.ref]);
      const g2 = await guest(playwright, opened);
      const D = await checkout(f, g2, centre, date, "15:00");
      expect((await (await qaPay(g2.ctx, { action: "paid", type: "booking", ref: D.ref })).json()).result).toBe("processed");
      expect((await (await qaPay(g1.ctx, { action: "paid", type: "booking", ref: C.ref })).json()).result).toBe("processed");
      await trackReview(f, C.ref);
      expect((await rows(f, "SELECT status, payment_status AS ps FROM bookings WHERE ref = ?", [C.ref]))[0]).toEqual({ status: "cancelled", ps: "refunded" });
      expect((await rows(f, "SELECT payment_status AS ps FROM bookings WHERE ref = ?", [D.ref]))[0].ps, "the other customer keeps the place").toBe("paid");
      expect(await rows(f, "SELECT origin, status FROM refunds WHERE source_ref = ?", [C.ref])).toEqual([{ origin: "auto", status: "succeeded" }]);
      expect((await qaPay(g1.ctx, { action: "paid", type: "booking", ref: C.ref })).status()).toBe(200); // replay
      expect(await rows(f, "SELECT id FROM refunds WHERE source_ref = ?", [C.ref]), "no second refund").toHaveLength(1);
      expect((await (await g1.ctx.get(`/api/bookings/status/${C.ref}`)).json()).paymentCase).toMatchObject({ state: "refunded", reason: "capacity_unavailable" });

      // --- case 1 starting within two hours: no hold, urgent ------------------------------
      const g3 = await guest(playwright, opened);
      const E = await checkout(f, g3, centre, irelandDate(18), "10:00");
      const soon = irelandAt(90);
      await f.connection.execute("UPDATE bookings SET date = ?, time = ? WHERE ref = ?", [soon.date, soon.time, E.ref]);
      expect((await (await qaPay(g3.ctx, { action: "paid", type: "booking", ref: E.ref, amountMinor: E.total - 1 })).json()).result).toBe("parked");
      const reviewE = await trackReview(f, E.ref);
      expect((await rows(f, "SELECT hold_status AS h, urgency AS u FROM payment_reviews WHERE id = ?", [reviewE]))[0]).toEqual({ h: "none", u: "within_lead" });
      expect((await rows(f, "SELECT kind FROM payment_review_alerts WHERE review_id = ?", [reviewE])).map((r) => r.kind)).toEqual(["urgent"]);
      const u = await guestBrowser(browser, g3.clientId, false);
      try {
        await u.page.goto(`/payment/success?ref=${E.ref}`);
        await expect(u.page.getByText("We couldn't confirm your payment in time")).toBeVisible();
        await shot(u.page, "d10-customer-urgent");
      } finally {
        await u.context.close();
      }

      await evidence("d10-review", { caseOneHeld: true, competingCheckout: 409, expiry: "released, no refund", recheck: "closed", supportRecheck: 403, caseFourAutoRefund: 1, urgent: "no hold" });
    });
  } finally {
    for (const x of opened) await x.dispose();
  }
});
