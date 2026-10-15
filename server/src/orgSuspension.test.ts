import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { listCentres, listClubs, getApprovedClub } from "./db/queries.js";
import { NeedsReviewError } from "./commerce/payments.js";
import { processStripeEvent } from "./routes/stripeWebhook.js";
import { paymentUnderReview, recordCheckoutAgreement } from "./payments/checkoutAgreement.js";
import { beginEvent, failEvent, finishEvent } from "./payments/webhookEvents.js";
import { assertSellable, offeringSellable, unavailableListing } from "./orgStatus.js";
import { orgObligations, setOrgStatus } from "./orgSuspension.js";
import { latestPublicDecision } from "./moderationDecisions.js";
import type { AuthedUser } from "./auth.js";

// D-01 — organisation suspension against the real (isolated) database.

const run = crypto.randomUUID().slice(0, 8);
const orgA = `test-org-a-${run}`;
const orgB = `test-org-b-${run}`;
const ownerA = `test-owner-a-${run}`;
const staffA = `test-staff-a-${run}`;
const ownerB = `test-owner-b-${run}`;
const adminId = `test-admin-${run}`;
const admin = { id: adminId, role: "admin", status: "approved", adminRole: "super" } as unknown as AuthedUser;
const ids = {
  ownerCentre: `test-centre-owner-${run}`,
  staffCentre: `test-centre-staff-${run}`,
  staffClub: `test-club-staff-${run}`,
  draftClub: `test-club-draft-${run}`,
  rejectedClub: `test-club-rejected-${run}`,
  pausedCentre: `test-centre-paused-${run}`,
  otherOrgCentre: `test-centre-b-${run}`,
};
const resident = `test-res-org-${run}`;
const refs: string[] = [];

const centre = (id: string, vendor: string, status: string) =>
  db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, vendor_id, status) VALUES (?, ?, 'Area', 'Dublin', 0, 0, 10, 1000, '', '', 'blurb', ?, ?)`)
    .run(id, `Org test ${id}`, vendor, status);
const club = (id: string, vendor: string, status: string) =>
  db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status) VALUES (?, ?, 'Testball', 'Area', 'Dublin', '5-12', 10, 'session', 0, '', 'blurb', ?, ?)`)
    .run(id, `Org test ${id}`, vendor, status);
const statusOf = async (table: string, id: string) => ((await db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id)) as { status: string }).status;

beforeAll(async () => {
  for (const [id, name] of [[orgA, "Org A"], [orgB, "Org B"]]) await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(id, name);
  for (const [id, org, staff] of [[ownerA, orgA, 0], [staffA, orgA, 1], [ownerB, orgB, 0]] as const) {
    await db
      .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', ?, ?, ?, ?)`)
      .run(id, `${id}@example.test`, id, org, staff, staff ? "centre_manager" : null);
  }
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'Org test admin', 'super')`).run(adminId, `${adminId}@example.test`);
  await centre(ids.ownerCentre, ownerA, "approved");
  await centre(ids.staffCentre, staffA, "approved");
  await club(ids.staffClub, staffA, "approved");
  await club(ids.draftClub, ownerA, "draft");
  await club(ids.rejectedClub, ownerA, "rejected");
  await centre(ids.pausedCentre, ownerA, "paused");
  await centre(ids.otherOrgCentre, ownerB, "approved");
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Org Test')`).run(resident, `${resident}@example.test`);
});

afterAll(async () => {
  for (const ref of refs) {
    await db.prepare(`DELETE FROM payment_records WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM webhook_events WHERE JSON_UNQUOTE(JSON_EXTRACT(summary, '$.metadata.ref')) = ?`).run(ref);
    await db.prepare(`DELETE FROM checkout_agreements WHERE source_ref = ?`).run(ref);
    await db.prepare(`DELETE FROM passes WHERE ref = ?`).run(ref);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(ref);
  }
  for (const id of Object.values(ids)) {
    await db.prepare(`DELETE FROM centres WHERE id = ?`).run(id);
    await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(id);
  }
  for (const id of [orgA, orgB]) {
    await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(id);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(id);
    await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(id);
  }
  for (const id of [ownerA, staffA, ownerB, adminId]) {
    await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(id);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  }
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
});

const suspension = { category: "safety", explanation: "Serious safety concerns reported at several venues.", internalNote: "INTERNAL-ORG-NOTE" };
const suspension_reason = suspension;

describe("organisation suspension", () => {
  it("hides owner- and staff-created supply, leaves listing statuses alone, and never touches another organisation", async () => {
    const r = await setOrgStatus(orgA, "suspended", suspension, admin);
    expect(r).toMatchObject({ ok: true, changed: true, status: "suspended" });

    // Statuses are unchanged — nothing rewritten to hide them.
    expect(await statusOf("centres", ids.ownerCentre)).toBe("approved");
    expect(await statusOf("centres", ids.staffCentre)).toBe("approved");
    expect(await statusOf("clubs", ids.staffClub)).toBe("approved");

    const centres = (await listCentres()).map((c) => c.id);
    expect(centres).not.toContain(ids.ownerCentre);
    expect(centres).not.toContain(ids.staffCentre); // created by staff, owned by the organisation
    expect(centres).toContain(ids.otherOrgCentre);
    expect((await listClubs()).map((c) => c.id)).not.toContain(ids.staffClub);
    expect(await getApprovedClub(ids.staffClub)).toBeNull();
    expect(await unavailableListing("club", ids.staffClub)).toMatchObject({ id: ids.staffClub, unavailable: true });
    expect(await unavailableListing("centre", ids.otherOrgCentre)).toBeNull();
  });

  it("leaves the suspended organisation's listings out of the sitemap, keeps the other organisation's", async () => {
    const { generateSitemapUrls } = await import("./ogMeta.js");
    // Venue pages are gated in this environment (no centre/club URLs at all),
    // so provider pages are the per-organisation signal here.
    const urls = (await generateSitemapUrls()).join("\n");
    expect(urls).not.toContain(`/provider/${ownerA}`);
    expect(urls).not.toContain(`/provider/${staffA}`);
    expect(urls).toContain(`/provider/${ownerB}`);
    for (const id of [ids.ownerCentre, ids.staffCentre, ids.staffClub]) expect(urls).not.toContain(id);
  });

  it("refuses sales for every member's supply; the other organisation still sells", async () => {
    expect(await offeringSellable(ownerA)).toBe(false);
    expect(await offeringSellable(staffA)).toBe(false);
    expect(await offeringSellable(ownerB)).toBe(true);
    await expect(db.transaction((tx) => assertSellable(tx, staffA))).rejects.toThrow(/isn't taking bookings/);
    await expect(db.transaction((tx) => assertSellable(tx, ownerB))).resolves.toBeUndefined();
  });

  it("is idempotent: suspending again records no second decision", async () => {
    expect(await setOrgStatus(orgA, "suspended", suspension, admin)).toMatchObject({ ok: true, changed: false });
    const n = (await db.prepare(`SELECT COUNT(*) AS n FROM moderation_decisions WHERE object_id = ?`).get(orgA)) as { n: number };
    expect(Number(n.n)).toBe(1);
    const pub = await latestPublicDecision("organisation", orgA, ["org.suspended"]);
    expect(pub?.explanation).toBe(suspension.explanation);
    expect(JSON.stringify(pub)).not.toContain("INTERNAL-ORG-NOTE");
  });

  it("obligations: detail roles see first names and refs, others only the schedule summary", async () => {
    const detail = await orgObligations(orgA, true);
    const summary = await orgObligations(orgA, false);
    expect(summary.items).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/@example\.test/); // never an email
    expect(Array.isArray(summary.summary)).toBe(true);
  });

  it("a payment that completes after the suspension is parked for finance review, not confirmed; replay after reinstatement confirms", async () => {
    // A pending pass bought before the suspension for the staff-created club.
    const ref = `test-pass-org-${crypto.randomUUID()}`;
    refs.push(ref);
    const sid = `cs_test_${crypto.randomUUID()}`;
    await db
      .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status, stripe_session_id) VALUES (?, ?, 'club', ?, 5, 5000, 'pending', ?)`)
      .run(ref, resident, ids.staffClub, sid);
    await recordCheckoutAgreement({ sessionId: sid, type: "pass", ref, amountMinor: 5000, currency: "EUR" });
    const event = {
      id: `evt_test_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      account: null,
      data: { object: { id: sid, object: "checkout.session", payment_status: "paid", amount_total: 5000, currency: "eur", payment_intent: `pi_test_${run}`, metadata: { type: "pass", ref } } },
    };
    const begin = await beginEvent("stripe", event as never, JSON.stringify(event));
    if (begin.action !== "process") throw new Error("setup");
    let error: unknown = null;
    try {
      await processStripeEvent(event as never);
    } catch (e) {
      error = e;
      await failEvent(begin.rowId, e, { needsReview: e instanceof NeedsReviewError });
    }
    expect(error).toBeInstanceOf(NeedsReviewError);
    expect(String((error as Error).message)).toMatch(/Organisation suspended/);
    // Not marked unpaid or cancelled; the event is kept, parked, with the payment details.
    expect(((await db.prepare(`SELECT payment_status AS s FROM passes WHERE ref = ?`).get(ref)) as { s: string }).s).toBe("pending");
    const parked = (await db.prepare(`SELECT status, summary FROM webhook_events WHERE id = ?`).get(begin.rowId)) as { status: string; summary: string };
    expect(parked.status).toBe("manual_review");
    expect(JSON.parse(parked.summary)).toMatchObject({ id: sid, amount: 5000, currency: "eur", payment_intent: `pi_test_${run}`, metadata: { type: "pass", ref } });
    expect(await paymentUnderReview("pass", ref)).toBe(true);
    // The order and the provider payment are recorded separately: order pending, payment verified paid.
    const held = (await db.prepare(`SELECT new_value FROM audit_log WHERE object_id = ? AND action = 'pass.held_org_suspended'`).get(ref)) as { new_value: string };
    expect(JSON.parse(held.new_value)).toMatchObject({ orderPaymentStatus: "pending", providerPayment: "verified_paid", checkoutSessionId: sid, amountMinor: 5000, currency: "EUR" });
    expect(JSON.parse(parked.summary).payment_status).toBe("paid");

    // Reinstate → the same event confirms on replay.
    expect(await setOrgStatus(orgA, "active", null, admin)).toMatchObject({ ok: true, changed: true });
    expect(await processStripeEvent(event as never)).toBe("processed");
    await finishEvent(begin.rowId, "processed");
    expect(((await db.prepare(`SELECT payment_status AS s FROM passes WHERE ref = ?`).get(ref)) as { s: string }).s).toBe("paid");
  });

  it("reinstatement restores exactly what was there: drafts, rejected and paused listings stay as they were", async () => {
    expect(await statusOf("clubs", ids.draftClub)).toBe("draft");
    expect(await statusOf("clubs", ids.rejectedClub)).toBe("rejected");
    expect(await statusOf("centres", ids.pausedCentre)).toBe("paused");
    const centres = (await listCentres()).map((c) => c.id);
    expect(centres).toContain(ids.ownerCentre);
    expect(centres).toContain(ids.staffCentre);
    expect(centres).not.toContain(ids.pausedCentre);
    expect((await listClubs()).map((c) => c.id)).not.toContain(ids.draftClub);
    expect((await listClubs()).map((c) => c.id)).not.toContain(ids.rejectedClub);
  });

  it("a suspension can't commit while a sale that passed the check is still writing (shared lock on the organisation row)", async () => {
    const orgStatus = async () => ((await db.prepare(`SELECT status FROM organisations WHERE id = ?`).get(orgB)) as { status: string }).status;
    let suspensionDone = false;
    let suspension: Promise<unknown> | null = null;
    const observed: string[] = [];
    await db.transaction(async (tx) => {
      await assertSellable(tx, ownerB); // the sale's locked check: organisation active
      suspension = setOrgStatus(orgB, "suspended", suspension_reason, admin).then((r) => {
        suspensionDone = true;
        return r;
      });
      // While this sale is still open, other connections keep seeing "active"
      // and the suspension can't finish. Condition checks (DB round trips), not sleeps.
      for (let i = 0; i < 25; i++) {
        observed.push(await orgStatus());
        expect(suspensionDone, `suspension finished while the sale was open (round trip ${i})`).toBe(false);
      }
    });
    await suspension;
    expect(suspensionDone).toBe(true);
    expect(new Set(observed)).toEqual(new Set(["active"]));
    expect(await orgStatus()).toBe("suspended");
    // And a sale that starts now is refused.
    await expect(db.transaction((tx) => assertSellable(tx, ownerB))).rejects.toThrow(/isn't taking bookings/);
    await setOrgStatus(orgB, "active", null, admin);
  });

  it("reinstatement shows only listings eligible under their CURRENT status (a status changed during the suspension is respected)", async () => {
    expect(await setOrgStatus(orgA, "suspended", suspension, admin)).toMatchObject({ changed: true });
    // While suspended, one live listing is paused and a draft is approved by its own lifecycle.
    await db.prepare(`UPDATE centres SET status = 'paused' WHERE id = ?`).run(ids.ownerCentre);
    await db.prepare(`UPDATE clubs SET status = 'approved' WHERE id = ?`).run(ids.draftClub);
    expect((await listClubs()).map((c) => c.id)).not.toContain(ids.draftClub); // still hidden: organisation suspended
    expect(await setOrgStatus(orgA, "active", null, admin)).toMatchObject({ changed: true });
    const centres = (await listCentres()).map((c) => c.id);
    expect(centres).not.toContain(ids.ownerCentre); // paused now → stays hidden
    expect(centres).toContain(ids.staffCentre);
    expect((await listClubs()).map((c) => c.id)).toContain(ids.draftClub); // approved now → visible
    expect(await statusOf("centres", ids.ownerCentre)).toBe("paused"); // reinstatement wrote no statuses
    await db.prepare(`UPDATE centres SET status = 'approved' WHERE id = ?`).run(ids.ownerCentre);
    await db.prepare(`UPDATE clubs SET status = 'draft' WHERE id = ?`).run(ids.draftClub);
  });

  it("keeps the per-user rule: an individually suspended member's listings aren't sellable while the organisation is active", async () => {
    await db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(staffA);
    expect(await offeringSellable(staffA)).toBe(false);
    expect(await offeringSellable(ownerA)).toBe(true);
    await db.prepare(`UPDATE users SET status = 'approved' WHERE id = ?`).run(staffA);
  });
});
