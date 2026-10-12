import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECKOUT_FIXTURES, Q_CREDIT_COVERS_ALL, Q_EXPERIENCE, Q_EXPERIENCE_COUPON_CREDIT, Q_PAY_AT_VENUE, Q_VENUE, Q_VENUE_COUPON } from "./__fixtures__/commerce";
import { CouponRejectedError, chargeCents, checkoutActionLabel, checkoutRows, collapsedTotal, couponErrorCopy, couponReasonFromCode, creditControlState, hasCredit, type CheckoutQuote } from "./checkoutLines";

const keys = (q: CheckoutQuote) => checkoutRows(q, "Price").map((r) => r.key);

describe("checkoutRows — the server's calculation order (R3A)", () => {
  it("price → coupon → VAT/fee/deposit → total (legacy pricing)", () => {
    expect(keys(Q_VENUE)).toEqual(["subtotal", "vat", "fee", "deposit", "total"]);
    expect(keys(Q_VENUE_COUPON)).toEqual(["subtotal", "coupon", "vat", "fee", "deposit", "total"]);
  });

  it("engine: coupon then credit, both before tax; the total is the card amount", () => {
    expect(keys(Q_EXPERIENCE_COUPON_CREDIT)).toEqual(["subtotal", "coupon", "credit", "total"]);
    const rows = checkoutRows(Q_EXPERIENCE_COUPON_CREDIT, "Price");
    expect(rows.find((r) => r.key === "coupon")).toMatchObject({ label: "Code WELCOME10", cents: 900, negative: true });
    expect(rows.find((r) => r.key === "credit")).toMatchObject({ label: "HelloCircle credit", cents: 2500, negative: true });
    expect(rows.at(-1)).toMatchObject({ key: "total", label: "Card payment due", cents: 5600, emphasis: "total" });
    expect(chargeCents(Q_EXPERIENCE_COUPON_CREDIT)).toBe(5600);
  });

  it("never splits a discount the server didn't split", () => {
    const q: CheckoutQuote = { ...Q_EXPERIENCE_COUPON_CREDIT, couponDiscountCents: undefined };
    expect(keys(q)).toEqual(["subtotal", "discount", "total"]);
    expect(checkoutRows(q, "x")[1]).toMatchObject({ cents: 3400, label: "Code WELCOME10 and HelloCircle credit" });
  });

  it("hides VAT when it's included in the price, and uses a given VAT label", () => {
    expect(keys(Q_EXPERIENCE)).toEqual(["subtotal", "total"]);
    expect(checkoutRows({ ...Q_VENUE, vatLabel: "VAT" }, "x").find((r) => r.key === "vat")?.label).toBe("VAT");
  });

  it("shows only figures the server sent (no arithmetic)", () => {
    for (const f of CHECKOUT_FIXTURES) {
      const sent = new Set(Object.values(f.quote).filter((v): v is number => typeof v === "number"));
      for (const r of checkoutRows(f.quote, f.subtotalLabel)) expect(sent.has(r.cents), `${f.label} · ${r.key}`).toBe(true);
    }
  });

  it("labels the zero and pay-at-venue totals", () => {
    expect(checkoutRows(Q_CREDIT_COVERS_ALL, "x").at(-1)?.label).toBe("Card payment · nothing to pay");
    expect(checkoutRows(Q_PAY_AT_VENUE, "x").at(-1)?.label).toBe("Pay at the venue");
    expect(hasCredit(Q_VENUE)).toBe(false);
  });
});

describe("action label and collapsed total", () => {
  it("charges the server total", () => {
    expect(checkoutActionLabel(Q_EXPERIENCE_COUPON_CREDIT)).toBe("Pay €56.00");
    expect(checkoutActionLabel(Q_VENUE)).toBe("Pay €202.40");
  });
  it("confirms without a card when nothing is due or it's paid at the venue", () => {
    expect(checkoutActionLabel(Q_CREDIT_COVERS_ALL, "Confirm")).toBe("Confirm");
    expect(checkoutActionLabel(Q_PAY_AT_VENUE, "Confirm")).toBe("Confirm");
  });
  it("summarises for the phone bar", () => {
    expect(collapsedTotal(Q_EXPERIENCE_COUPON_CREDIT)).toBe("Card payment €56.00");
    expect(collapsedTotal(Q_VENUE)).toBe("Total €202.40");
    expect(collapsedTotal(Q_CREDIT_COVERS_ALL)).toBe("Nothing to pay");
    expect(collapsedTotal(Q_PAY_AT_VENUE)).toBe("Pay at the venue €76.80");
  });
});

describe("coupon copy", () => {
  it("maps every server rejection reason", () => {
    expect(couponErrorCopy("expired")).toBe("That code has expired.");
    expect(couponErrorCopy("not_yet_active")).toBe("That code isn't active yet.");
    expect(couponErrorCopy("limit")).toBe("That code has already been fully used.");
    expect(couponErrorCopy("min_spend", 15000)).toBe("That code needs a minimum spend of €150.00.");
    expect(couponErrorCopy("min_spend")).toBe("Your booking is below that code's minimum spend.");
    expect(couponErrorCopy("not_applicable")).toBe("That code can't be used for this booking.");
  });
  it("falls back to one generic line without a reason (no code-existence oracle)", () => {
    expect(couponErrorCopy(null)).toBe("That code isn't valid.");
    expect(couponErrorCopy("invalid")).toBe("That code isn't valid.");
  });
  it("reads the server's error code", () => {
    expect(couponReasonFromCode("coupon_expired")).toBe("expired");
    expect(couponReasonFromCode("coupon_something_new")).toBe("invalid");
    expect(couponReasonFromCode(undefined)).toBeNull();
    expect(couponReasonFromCode("not_a_coupon_error")).toBeNull();
  });
  it("carries the copy as the error message so CouponField shows it", () => {
    const e = new CouponRejectedError("expired");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("That code has expired.");
  });
});

describe("credit control state", () => {
  const base = { availableCents: 2500, eligible: true, requested: true, appliedCents: 2500 };
  it("renders nothing without credit", () => expect(creditControlState({ ...base, availableCents: 0 })).toBe("unavailable"));
  it("explains ineligible bookings", () => expect(creditControlState({ ...base, eligible: false })).toBe("ineligible"));
  it("is opt-in", () => expect(creditControlState({ ...base, requested: false })).toBe("off"));
  it("reports what the server applied", () => expect(creditControlState(base)).toBe("applied"));
  it("flags a shrunken balance", () => expect(creditControlState({ ...base, appliedCents: 1000, previouslyAppliedCents: 2500 })).toBe("balance_changed"));
});

describe("no client pricing constants in the commercial components", () => {
  it("imports no VAT or fee rate", () => {
    for (const f of ["checkoutLines.ts", "checkout.tsx", "../ReceiptDrawer.tsx", "../PayoutHistory.tsx", "../CouponRedemptionsDrawer.tsx", "../PriceChip.tsx", "../EarningsSummary.tsx", "../../pages/ClubDetail.tsx", "../../pages/ProgramDetail.tsx"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/VAT_RATE|PLATFORM_FEE_RATE|computePricing|\* ?0\.23|\* ?1\.23/);
    }
  });
});
