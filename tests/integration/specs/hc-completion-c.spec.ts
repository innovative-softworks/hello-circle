import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { connectedPreflight } from "../runtime";

// UI completion (second pass, 2026-10-14) — record pages for claims, host
// applications, place suggestions and finance records, and the customer-facing
// "payment needs a check" state. Real stack and server; the records are
// synthetic rows written directly to the isolated QA database (and removed
// afterwards), because creating them through their real flows needs other
// actors (or Stripe) that aren't what these checks are about.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "completion");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test("COMPLETE-QUEUES: claim, host application and place suggestion open as record pages with return context", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const tag = randomUUID().slice(0, 8);
    // An unowned centre to claim (no rooms needed for the admin view).
    const centreId = randomUUID();
    await f.connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, created_at) VALUES (?, ?, 'QA area', 'Dublin', 0, 0, 0, 0, '', '', '', 'QA claimable', 'approved', NOW())", [centreId, `QA claimable ${tag}`]);
    f.track("centres", "id", centreId);
    f.track("audit_log", "object_id", centreId);
    const [claim] = await f.connection.execute<any>("INSERT INTO listing_claims (listing_type, listing_id, vendor_id, message) VALUES ('centre', ?, ?, 'QA: we run this hall')", [centreId, personas.QA_VENDOR.id]);
    f.track("listing_claims", "listing_id", centreId);
    const residentId = `qa-host-app-${tag}`;
    await f.connection.execute("INSERT INTO residents (id, email, name, host_status, host_bio, host_phone, host_applied_at) VALUES (?, ?, ?, 'pending', 'QA bio', '000', NOW())", [residentId, `${residentId}@example.test`, `QA applicant ${tag}`]);
    f.track("residents", "id", residentId);
    f.track("audit_log", "object_id", residentId);
    f.track("moderation_decisions", "object_id", residentId);
    f.track("notifications", "resident_id", residentId);
    const suggestionId = `qa-sugg-${tag}`;
    await f.connection.execute("INSERT INTO place_suggestions (id, client_id, suggested_name, category, area, county, description, contact_info) VALUES (?, ?, ?, 'centre', 'QA town', 'Cork', 'QA suggested hall', 'qa@example.test')", [suggestionId, `qa-client-${tag}`, `QA suggested ${tag}`]);
    f.track("place_suggestions", "id", suggestionId);
    f.track("audit_log", "object_id", suggestionId);
    f.track("moderation_decisions", "object_id", suggestionId);

    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      const { page } = admin;
      // Claim: filtered list → record → statuses, related records, confirm copy → back with the filter.
      await page.goto(`/admin?tab=claims&q=${tag}`);
      await page.getByRole("button", { name: `Review claim on QA claimable ${tag}` }).click();
      await expect(page).toHaveURL(new RegExp(`record=claim%3A${claim.insertId}|record=claim:${claim.insertId}`));
      await expect(page.getByRole("heading", { level: 1, name: `Claim on QA claimable ${tag}` })).toBeVisible();
      const statuses = page.getByRole("group", { name: "Status" });
      await expect(statuses).toContainText("Claim:");
      await expect(statuses).toContainText("Partner account:");
      await expect(page.getByRole("button", { name: "Open partner account" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open listing" })).toBeVisible();
      await page.getByRole("button", { name: "Approve claim" }).click();
      const approve = page.getByRole("alertdialog", { name: /Approve .* claim on QA claimable/ });
      await expect(approve).toContainText("becomes the owner");
      await shot(page, "admin-claim-record-confirm");
      await approve.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: /Back to claims/ }).click();
      await expect(page.locator("input").and(page.getByLabel("Search claims"))).toHaveValue(tag);
      await expect(page).not.toHaveURL(/record=/);

      // Host application record by URL; decline keeps the page with the decided state.
      await page.goto(`/admin?tab=hostApplications&record=host:${residentId}`);
      await expect(page.getByRole("heading", { level: 1, name: `QA applicant ${tag}` })).toBeVisible();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Waiting for a decision");
      await shot(page, "admin-host-application-record");
      await page.getByRole("button", { name: "Decline" }).click();
      // D-03: a reason category and an explanation for the applicant are required.
      const decline = page.getByRole("alertdialog");
      await expect(decline.getByRole("button", { name: "Decline application" })).toBeDisabled();
      await decline.getByLabel(/Reason category/).selectOption("incomplete");
      await decline.getByLabel(/^Explanation/).fill("Please add a short bio about the sessions you host.");
      await decline.getByRole("button", { name: "Decline application" }).click();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Declined");
      expect((await f.connection.query<any[]>("SELECT host_status FROM residents WHERE id = ?", [residentId]))[0][0].host_status).toBe("rejected");
      // The queue no longer lists it, so its URL now says why it can't be opened.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: /doesn't exist/ })).toBeVisible();
      await expect(page.getByText("Only applications waiting for a decision can be opened here")).toBeVisible();

      // Place suggestion: list view "all" → record → back keeps the view.
      await page.goto(`/admin?tab=placeSuggestions&view=all&q=${tag}`);
      await page.getByRole("button", { name: `Review QA suggested ${tag}` }).click();
      await expect(page.getByRole("heading", { level: 1, name: `QA suggested ${tag}` })).toBeVisible();
      await expect(page.getByText("A listing is created when this is approved.")).toBeVisible();
      await shot(page, "admin-place-suggestion-record");
      await page.getByRole("button", { name: /Back to place suggestions/ }).click();
      await expect(page).toHaveURL(/view=all/);
      await expect(page.locator("input").and(page.getByLabel("Search suggestions"))).toHaveValue(tag);
    } finally {
      await admin.close();
    }
    await evidence("complete-queues", { claimRecord: true, hostRecord: true, suggestionRecord: true, returnContext: true, decidedState: true });
  });
});

test("COMPLETE-FINANCE: a parked payment event and its order are record pages with an investigation path; Back keeps the filter", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, [], async (f) => {
    const tag = randomUUID().slice(0, 8);
    const ref = `HB-QA${tag.toUpperCase()}`;
    const sid = `cs_test_qa_${tag}`;
    const eventId = `evt_qa_${tag}`;
    const summary = { object: "checkout.session", id: sid, amount: 4000, currency: "eur", payment_status: "paid", metadata: { type: "booking", ref } };
    const [ev] = await f.connection.execute<any>(
      "INSERT INTO webhook_events (provider, event_id, event_type, livemode, object_id, summary, payload_sha256, status, attempts, last_error) VALUES ('stripe', ?, 'checkout.session.completed', 0, ?, ?, ?, 'manual_review', 1, ?)",
      [eventId, sid, JSON.stringify(summary), "0".repeat(64), "Checkout reconciliation failed — not marked paid: amount 4000 ≠ agreed 5000 (EUR)"]
    );
    f.track("webhook_events", "event_id", eventId);
    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      const { page } = admin;
      await page.goto("/admin?tab=finance&section=events");
      await expect(page.getByRole("heading", { name: "Payment events" })).toBeVisible();
      await page.getByRole("button", { name: `Open event ${ev.insertId}` }).click();
      await expect(page.getByRole("heading", { level: 1, name: "checkout.session.completed" })).toBeVisible();
      await expect(page.getByRole("group", { name: "Status" })).toContainText("Needs review");
      await expect(page.getByRole("heading", { name: /how to investigate/ })).toBeVisible();
      await expect(page.getByText("there is deliberately no override")).toBeVisible();
      await expect(page.getByRole("button", { name: "Replay event…" })).toBeVisible();
      await shot(page, "admin-payment-event-review");
      // Related order: still unpaid, payment/refund/release shown separately.
      await page.getByRole("button", { name: `Open order booking ${ref}` }).click();
      await expect(page.getByRole("heading", { level: 1, name: `Booking ${ref}` })).toBeVisible();
      const statuses = page.getByRole("group", { name: "Status" });
      for (const label of ["Payment:", "Refunded:", "Disputes:", "Release to partner:"]) await expect(statuses).toContainText(label);
      await expect(statuses).toContainText("No payment recorded");
      await shot(page, "admin-order-record-unpaid");
      // Back twice → the events list, still filtered to "Needs review".
      await page.goBack();
      await page.getByRole("button", { name: /Back to payment events/ }).click();
      await expect(page).toHaveURL(/section=events/);
      await expect(page).not.toHaveURL(/record=/);
      await expect(page.getByLabel("Show")).toHaveValue("manual_review");
      // An unknown finance record is a "missing" state, not a crash.
      await page.goto("/admin?tab=finance&section=refunds&record=refund:999999999");
      await expect(page.getByRole("heading", { level: 1, name: /doesn't exist/ })).toBeVisible();
    } finally {
      await admin.close();
    }
    await evidence("complete-finance", { eventRecord: true, investigationPath: true, orderRecord: true, returnContext: true, missingState: true });
  });
});

test("COMPLETE-REVIEW-STATE: a parked paid checkout shows the customer 'needs a check', never 'booked'", async ({ playwright, browser }) => {
  test.setTimeout(90_000);
  await withActors(playwright, [], async (f) => {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const ref = `PS-QA${tag}`;
    const sid = `cs_test_qa_${tag}`;
    const eventId = `evt_qa_ps_${tag}`;
    await f.connection.execute("INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, purchased_cents, payment_status, stripe_session_id) VALUES (?, ?, 'club', 'qa-no-club', 5, 5000, 'pending', ?)", [ref, personas.QA_USER.id, sid]);
    f.track("passes", "ref", ref);
    await f.connection.execute("INSERT INTO checkout_agreements (session_id, source_type, source_ref, amount_minor, currency) VALUES (?, 'pass', ?, 5000, 'EUR')", [sid, ref]);
    f.track("checkout_agreements", "session_id", sid);
    await f.connection.execute(
      "INSERT INTO webhook_events (provider, event_id, event_type, livemode, object_id, summary, payload_sha256, status, attempts, last_error) VALUES ('stripe', ?, 'checkout.session.completed', 0, ?, ?, ?, 'manual_review', 1, 'Checkout reconciliation failed — not marked paid: amount 4000 ≠ agreed 5000 (EUR)')",
      [eventId, sid, JSON.stringify({ object: "checkout.session", id: sid, amount: 4000, currency: "eur", payment_status: "paid", metadata: { type: "pass", ref } }), "0".repeat(64)]
    );
    f.track("webhook_events", "event_id", eventId);
    const user = await uiActor(browser, "QA_USER", "mobile");
    try {
      const { page } = user;
      await page.goto(`/payment/success?ref=${ref}`);
      await expect(page.getByRole("heading", { name: "Your payment needs a quick check" })).toBeVisible();
      await expect(page.getByText("Please don't pay again")).toBeVisible();
      await expect(page.getByText("You're all set!")).toHaveCount(0);
      await shot(page, "customer-payment-review");
      // A failed status check is "couldn't check", not "not found" (UI interception: one request).
      let armed = true;
      await page.route((u) => armed && u.pathname === `/api/passes/status/${ref}`, (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Server error"}' }));
      await page.reload();
      await expect(page.getByRole("heading", { name: "We couldn't check your payment just now" })).toBeVisible();
      armed = false;
      await page.getByRole("button", { name: "Check again" }).click();
      await expect(page.getByRole("heading", { name: "Your payment needs a quick check" })).toBeVisible();
    } finally {
      await user.close();
    }
    expect((await f.connection.query<any[]>("SELECT payment_status FROM passes WHERE ref = ?", [ref]))[0][0].payment_status).toBe("pending");
    await evidence("complete-review-state", { reviewShown: true, neverBooked: true, statusErrorDistinct: true, stillPending: true });
  });
});
