import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Validation 2026-10-14 — one payment the provider can't find must not abort
// the whole fee reconciliation (it used to throw and return a 500 for the
// entire run). The provider is mocked at the module boundary; the database is
// the real isolated test MySQL.
const fee = vi.fn(async (pi: string): Promise<null> => {
  if (pi.startsWith("pi_missing_")) throw new Error("No such payment_intent");
  return null;
});
vi.mock("../payments/provider.js", async (orig) => ({
  ...(await orig<typeof import("../payments/provider.js")>()),
  paymentProvider: () => ({ paymentFee: fee }),
}));

const { db, getSetting, setSetting } = await import("../db/index.js");
const { reconcilePaymentFees } = await import("./settlement.js");

const run = crypto.randomUUID().slice(0, 8);
const refs = [`FR-${run}-a`, `FR-${run}-b`];
let previous = "false";

beforeAll(async () => {
  previous = await getSetting("commerce.settlement_ledger", "false");
  await setSetting("commerce.settlement_ledger", "true");
  await db
    .prepare(`INSERT INTO payment_records (source_type, source_ref, provider, payment_intent_id, amount_minor, currency, status) VALUES ('booking', ?, 'stripe', ?, 1000, 'EUR', 'succeeded'), ('booking', ?, 'stripe', ?, 1000, 'EUR', 'succeeded')`)
    .run(refs[0], `pi_missing_${run}`, refs[1], `pi_known_${run}`);
});

afterAll(async () => {
  await db.prepare(`DELETE FROM payment_records WHERE source_ref IN (?, ?)`).run(refs[0], refs[1]);
  await setSetting("commerce.settlement_ledger", previous);
});

describe("reconcilePaymentFees", () => {
  it("skips a payment the provider can't read and still processes the others", async () => {
    const result = await reconcilePaymentFees();
    expect(fee).toHaveBeenCalledWith(`pi_missing_${run}`);
    expect(fee).toHaveBeenCalledWith(`pi_known_${run}`);
    expect(result.skipped).toBeGreaterThanOrEqual(2);
    expect(result.reconciled).toBe(0);
  });
});
