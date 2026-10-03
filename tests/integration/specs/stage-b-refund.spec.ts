import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, paidBooking, programFor, staffLogin } from "../stage-b-fixture";

// Refund AUTHORIZATION only. The QA profile has no STRIPE_* configuration, so
// checkoutService.issueStripeRefund() returns "Payments aren't configured on
// this server" (502) without any network call; the backend wrapper also
// blocks every non-QA-MySQL socket. A 502 with that exact message therefore
// marks "authorized request reached the provider boundary". A denial must be
// returned BEFORE that boundary (403/404) with every payment-bearing row and
// the audit log unchanged. Positive refund completion is EXTERNAL PENDING.

const PROVIDER_BOUNDARY = { error: "Payments aren't configured on this server" };

test("STAGE-B-REFUND: enrollment and booking refunds deny foreign actors before the payment provider", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "GUEST"], async (f) => {
      const A = await centreFor(f, "QA_VENDOR"), B = await centreFor(f, "QA_VENDOR_B");
      const pA = await programFor(f, "QA_VENDOR", A.id), pB = await programFor(f, "QA_VENDOR_B", B.id);
      const enrol = async (program: string, paymentStatus: string, stripe: boolean) => {
        const [insert] = await f.connection.execute<any>("INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, stripe_session_id) VALUES (?, ?, ?, 'QA synthetic participant', 'qa_refund@example.test', 1000, ?, ?)",
          [randomUUID(), program, randomUUID(), paymentStatus, stripe ? `cs_test_qa_${randomUUID()}` : null]);
        return Number(insert.insertId);
      };
      const eA = await enrol(pA, "paid", true), eB = await enrol(pB, "paid", true), unpaid = await enrol(pA, "pending", true), cash = await enrol(pA, "paid", false);
      const bookingA = await paidBooking(f, A, { stripe: true });
      const analyst = await staffLogin(playwright, f, "QA_VENDOR", "read_only_analyst", opened);
      const manager = await staffLogin(playwright, f, "QA_VENDOR", "centre_manager", opened);
      const finance = await staffLogin(playwright, f, "QA_VENDOR", "finance", opened);
      const invariants = await Promise.all([
        f.snapshot("SELECT * FROM program_enrollments WHERE program_id IN (?,?) ORDER BY id", [pA, pB]),
        f.snapshot("SELECT * FROM bookings WHERE ref = ?", [bookingA]),
        f.snapshot("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE '%refund%'", []),
        f.snapshot("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'refund' OR title LIKE 'Refund%'", []),
      ]);
      const url = (program: string, enrollment: number | string) => `/api/vendor/programs/${program}/enrollments/${enrollment}/refund`;
      const cases: [APIRequestContext, string, number, string][] = [
        [f.actors.GUEST, url(pA, eA), 401, "guest"],
        [f.actors.QA_VENDOR_B, url(pA, eA), 403, "foreign vendor, foreign parent"],
        [f.actors.QA_VENDOR_B, url(pB, eA), 404, "foreign vendor, own parent + victim enrollment"],
        [f.actors.QA_VENDOR, url(pA, eB), 404, "owner, own parent + foreign enrollment"],
        [f.actors.QA_VENDOR, url(pB, eB), 403, "owner, foreign parent + foreign child"],
        [f.actors.QA_VENDOR, url(randomUUID(), eA), 403, "nonexistent parent"],
        [f.actors.QA_VENDOR, url(pA, 999999999), 404, "nonexistent child"],
        [analyst.context, url(pA, eA), 403, "read-only analyst, same organisation"],
        [manager.context, url(pA, eA), 403, "centre manager lacks finance"],
        [f.actors.QA_VENDOR, url(pA, unpaid), 400, "unpaid synthetic enrollment"],
        [f.actors.QA_VENDOR, url(pA, cash), 400, "cash enrollment never reaches provider"],
        [f.actors.QA_VENDOR_B, `/api/vendor/bookings/${bookingA}/refund`, 404, "foreign booking refund"],
        [f.actors.QA_VENDOR_B, `/api/vendor/bookings/${bookingA}/cancel`, 404, "foreign booking cancel"],
        [analyst.context, `/api/vendor/bookings/${bookingA}/refund`, 403, "analyst booking refund"],
      ];
      const statuses: number[] = [];
      for (const [actor, path, status, label] of cases) {
        const response = await actor.post(path);
        statuses.push(response.status());
        expect(response.status(), label).toBe(status);
        expect(await response.json(), `${label} is denied before the provider boundary`).not.toEqual(PROVIDER_BOUNDARY);
        for (const unchanged of invariants) await unchanged();
      }
      // Authorized actors reach exactly the provider boundary; nothing changes without a provider result.
      const boundary: number[] = [];
      for (const [actor, path] of [[f.actors.QA_VENDOR, url(pA, eA)], [finance.context, url(pA, eA)], [f.actors.QA_VENDOR, `/api/vendor/bookings/${bookingA}/refund`]] as [APIRequestContext, string][]) {
        const response = await actor.post(path);
        boundary.push(response.status());
        expect(response.status()).toBe(502);
        expect(await response.json()).toEqual(PROVIDER_BOUNDARY);
        for (const unchanged of invariants) await unchanged();
      }
      await evidence("stage-b-refund-authorization", { deniedStatuses: statuses, providerBoundaryStatuses: boundary, positiveRefundExecuted: false, stripeConfigured: false });
      expect(personas.QA_VENDOR.id !== personas.QA_VENDOR_B.id).toBe(true);
    });
  } finally { for (const context of opened) await context.dispose(); }
});
