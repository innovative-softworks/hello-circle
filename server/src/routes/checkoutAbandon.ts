import { Router } from "express";
import { logEvent } from "../analytics.js";
import { db } from "../db/index.js";
import { paymentProvider } from "../payments/provider.js";
import { lookupLimiter } from "../rateLimit.js";
import { processProviderOutcome } from "./stripeWebhook.js";

// UX plan S7 (booking UX Phase 3) — "I cancelled at the payment page".
//
// A pending checkout holds its place for 30 minutes (bookingIntegrity.ts), so
// someone who backs out of Stripe and tries again straight away used to find
// their OWN hold blocking the slot. This releases it — but only through the
// same path a provider "expired" event takes (processProviderOutcome), after
// expiring the session at the provider so it can no longer be paid:
//   - never for a row that isn't pending (paid, failed, cancelled: untouched);
//   - never when the provider says the session completed (the payment is
//     real and its webhook is on the way);
//   - never when the provider can't be asked (the hold then simply expires
//     on schedule, exactly as before).
// Ownership is the same as each model's status/cancel routes: the device's
// X-Client-Id, or the signed-in resident.

type Kind = { type: "booking" | "registration" | "program" | "experience" | "game" | "pass"; table: string; owner: "client_or_resident" | "resident"; retry: (row: Record<string, string>) => string; listingCol: string };

const BY_PREFIX: Record<string, Kind> = {
  "HB-": { type: "booking", table: "bookings", owner: "client_or_resident", listingCol: "centre_id", retry: (r) => `/book/${r.listing}` },
  "CR-": { type: "registration", table: "registrations", owner: "client_or_resident", listingCol: "club_id", retry: (r) => `/register/${r.listing}` },
  "PR-": { type: "program", table: "program_enrollments", owner: "client_or_resident", listingCol: "program_id", retry: (r) => `/programs/${r.listing}` },
  "EX-": { type: "experience", table: "experience_bookings", owner: "client_or_resident", listingCol: "experience_id", retry: (r) => `/experiences/${r.listing}` },
  "GJ-": { type: "game", table: "game_participants", owner: "resident", listingCol: "game_id", retry: (r) => `/games/${r.listing}` },
  "PS-": { type: "pass", table: "passes", owner: "resident", listingCol: "listing_id", retry: (r) => `/clubs/${r.listing}` },
};

export function kindForRef(ref: string): Kind | null {
  const prefix = Object.keys(BY_PREFIX).find((p) => ref.startsWith(p));
  return prefix ? BY_PREFIX[prefix] : null;
}

export type AbandonState = "released" | "paid" | "processing" | "not_pending" | "unknown";

export const checkoutAbandonRouter = Router();

checkoutAbandonRouter.post("/:ref/abandon", lookupLimiter, async (req, res) => {
  const ref = req.params.ref;
  const kind = kindForRef(ref);
  if (!kind) return res.status(404).json({ error: "Booking not found" });
  const clientId = req.header("X-Client-Id") ?? "";
  const residentId = req.resident?.id ?? "";
  if (kind.owner === "resident" && !residentId) return res.status(404).json({ error: "Booking not found" });

  const ownerSql = kind.owner === "resident" ? `resident_id = ?` : `(client_id = ? OR (resident_id IS NOT NULL AND resident_id = ?))`;
  const ownerParams = kind.owner === "resident" ? [residentId] : [clientId || "\u0000", residentId || "\u0000"];
  const row = (await db
    .prepare(`SELECT payment_status as paymentStatus, stripe_session_id as sessionId, ${kind.listingCol} as listing FROM ${kind.table} WHERE ref = ? AND ${ownerSql}`)
    .get(ref, ...ownerParams)) as { paymentStatus: string; sessionId: string | null; listing: string } | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });

  const retryPath = kind.retry({ listing: row.listing });
  const reply = (state: AbandonState) => res.json({ state, retryPath });
  if (row.paymentStatus !== "pending") return reply(row.paymentStatus === "paid" ? "paid" : "not_pending");

  const provider = paymentProvider();
  if (provider && row.sessionId) {
    try {
      if ((await provider.checkoutSessionStatus(row.sessionId)) === "complete") return reply("processing");
      await provider.expireCheckoutSession(row.sessionId);
      // A payment that completed in the instant before the expiry wins.
      if ((await provider.checkoutSessionStatus(row.sessionId)) === "complete") return reply("processing");
    } catch {
      return reply("unknown");
    }
  } else if (provider) {
    // A pending row with no session yet is mid-creation — leave it alone.
    return reply("unknown");
  }

  await processProviderOutcome(kind.type, ref, "expired");
  void logEvent("checkout_abandoned", { residentId: residentId || null, clientId: clientId || null, metadata: { type: kind.type, ref } });
  return reply("released");
});
