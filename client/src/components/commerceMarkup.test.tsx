import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CheckoutSummary, CouponField, CreditToggle, type CheckoutQuote, type QuoteState } from "./booking";
import { PAYOUTS_ACTIVE, PAYOUTS_EMPTY, PAYOUTS_RESTRICTED, Q_EXPERIENCE_COUPON_CREDIT, Q_VENUE, RECEIPT_PART_REFUNDED, RECEIPT_PAY_AT_VENUE, RECEIPT_PENDING, RECEIPT_REFUNDED } from "./booking/__fixtures__/commerce";
import { CheckoutBreakdown } from "./CheckoutBreakdown";
import { PayoutHistory } from "./PayoutHistory";
import { PriceChip } from "./PriceChip";
import { ReceiptBody } from "./ReceiptDrawer";
import { RefundStatus } from "./SelfCancelControl";
import { SectionTabs, TabPanel } from "./ui";

// Commercial UX R1/R2 — accessibility and content contract, checked on
// server-rendered markup (no browser needed).

const noop = () => {};
const html = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const ready = (q: CheckoutQuote): QuoteState<CheckoutQuote> => ({ status: "ready", quote: q, error: null, seq: 1 });

describe("R1 chips", () => {
  it("PriceChip says it in words", () => {
    expect(html(<PriceChip signal="free" />)).toContain(">Free<");
    expect(html(<PriceChip signal="free_trial" />)).toContain(">Free trial<");
  });
  it("RefundStatus: one label per server state, nothing for none", () => {
    expect(html(<RefundStatus refundState="pending" />)).toContain("Refund processing");
    expect(html(<RefundStatus refundState="refunded" />)).toContain("Refunded");
    expect(html(<RefundStatus refundState="none" />)).toBe("");
    expect(html(<RefundStatus refundState={undefined} />)).toBe("");
  });
});

describe("SectionTabs (Earnings sections)", () => {
  const m = html(
    <>
      <SectionTabs idBase="e" label="Earnings sections" value="payouts" onChange={noop} options={[{ key: "balance", label: "Balance" }, { key: "payouts", label: "Payouts" }, { key: "plan", label: "Plan & billing" }]} />
      <TabPanel idBase="e" tab="payouts">x</TabPanel>
    </>,
  );
  it("is a labelled tablist with one selected, roving tab stop", () => {
    expect(m).toContain('role="tablist" aria-label="Earnings sections"');
    expect(m.match(/role="tab"/g)).toHaveLength(3);
    expect(m.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(m.match(/tabindex="0"/gi)).toHaveLength(1);
    expect(m).toMatch(/id="e-tab-payouts"[^>]*aria-selected="true"/);
  });
  it("ties the panel to its tab", () => {
    expect(m).toContain('role="tabpanel" id="e-panel-payouts" aria-labelledby="e-tab-payouts"');
    expect(m).toMatch(/aria-controls="e-panel-payouts"/);
  });
  it("drops tabpanel semantics when bare", () => {
    expect(html(<TabPanel idBase="e" tab="balance" bare>x</TabPanel>)).toBe("<div>x</div>");
  });
});

describe("CheckoutSummary", () => {
  it("announces price changes and follows the server order: coupon, credit, card amount", () => {
    const m = html(<CheckoutSummary state={ready(Q_EXPERIENCE_COUPON_CREDIT)} subtotalLabel="2 × €45.00" />);
    expect(m).toContain('aria-live="polite"');
    const order = ["Code WELCOME10", "HelloCircle credit", "Card payment due"].map((t) => m.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(m).toContain("−€25.00");
    expect(m).toContain("€56.00");
    expect(m).toContain("Credit left after this booking: €0.00");
  });
  it("shows a re-price notice as an alert", () => {
    const m = html(<CheckoutSummary state={ready(Q_VENUE)} subtotalLabel="Hire" notice="Your total changed to €202.40 because code SPRING10 expired." />);
    expect(m).toMatch(/role="alert"[^>]*>Your total changed/);
  });
  it("phone variant: a disclosure button controlling the breakdown", () => {
    const m = html(<CheckoutSummary state={ready(Q_EXPERIENCE_COUPON_CREDIT)} subtotalLabel="x" collapsible />);
    expect(m).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="([^"]+)"/);
    const id = m.match(/aria-controls="([^"]+)"/)![1];
    expect(m).toMatch(new RegExp(`id="${id}" hidden`));
    expect(m).toContain("Card payment €56.00");
  });
  it("error state has no price and offers a retry", () => {
    const m = html(<CheckoutSummary state={{ status: "error", quote: null, error: "Offline", seq: 1 }} subtotalLabel="x" onRetry={noop} />);
    expect(m).toContain("We couldn&#x27;t price this");
    expect(m).not.toContain("€");
    expect(m).toContain("Try again");
  });
});

describe("CouponField applied problem", () => {
  it("explains an expired applied code in an alert and keeps Remove", () => {
    const m = html(<CouponField applied="SPRING10" appliedProblem="SPRING10 expired before you paid." onApply={async () => {}} onRemove={noop} />);
    expect(m).toContain("no longer applies");
    expect(m).toMatch(/role="alert"[^>]*>SPRING10 expired/);
    expect(m).toContain('aria-label="Remove code SPRING10"');
  });
  it("is unchanged for live callers without the new prop", () => {
    const m = html(<CouponField applied="SPRING10" onApply={async () => {}} onRemove={noop} />);
    expect(m).toContain("applied");
    expect(m).not.toContain('role="alert"');
  });
});

describe("CreditToggle", () => {
  it("labels the checkbox and describes it", () => {
    const m = html(<CreditToggle availableCents={2500} requested={false} appliedCents={null} onChange={noop} />);
    const id = m.match(/<input[^>]*id="([^"]+)"/)![1];
    expect(m).toContain(`for="${id}"`);
    expect(m).toContain(`aria-describedby="${id}-hint"`);
    expect(m).toContain("Use my HelloCircle credit");
    expect(m).not.toMatch(/points/i);
  });
  it("renders nothing without credit and an alert when the balance shrank", () => {
    expect(html(<CreditToggle availableCents={0} requested={false} appliedCents={null} onChange={noop} />)).toBe("");
    expect(html(<CreditToggle availableCents={1000} requested appliedCents={1000} previouslyAppliedCents={2500} onChange={noop} />)).toMatch(/role="alert"[^>]*>Your credit balance changed/);
  });
});

describe("ReceiptBody", () => {
  it("partial refund: frozen breakdown plus card and credit refund lines", () => {
    const m = html(<ReceiptBody r={RECEIPT_PART_REFUNDED} />);
    expect(m).toContain("Part-refunded");
    expect(m).toContain("Back to your card");
    expect(m).toContain("−€28.00");
    expect(m).toContain("Back as HelloCircle credit");
    expect(m).toContain("−€12.50");
    expect(m).toContain("Paid after refunds");
    expect(m).toContain("€40.50");
    // The recorded rate, and never presented as an invoice.
    expect(m).toContain("Price includes VAT (23%) of €10.47.");
    expect(m).toContain("not a VAT invoice");
    expect(m).not.toMatch(/>\s*(Tax )?Invoice\b/i);
    // Credit was taken off before tax, so the last line is the card payment.
    expect(m.indexOf("HelloCircle credit")).toBeLessThan(m.indexOf("Paid by card"));
  });

  it("total only: one line and an honest note, no invented rows", () => {
    const m = html(<ReceiptBody r={RECEIPT_REFUNDED} />);
    expect(m).toContain("Only the total was recorded");
    expect(m).not.toMatch(/<dt>VAT/); // no VAT row invented for a total-only receipt
    expect(m).toContain("−€10.24");
  });

  it("cash: due at the venue, not 'paid'", () => {
    const m = html(<ReceiptBody r={RECEIPT_PAY_AT_VENUE} />);
    expect(m).toContain("Pay at the venue");
    expect(m).toContain("Due at the venue");
    expect(m).not.toContain("Total paid");
  });
  it("pending: says don't pay again, no refund section", () => {
    const m = html(<ReceiptBody r={RECEIPT_PENDING} />);
    expect(m).toMatch(/role="status"[^>]*>We&#x27;re still waiting/);
    expect(m).not.toContain("Refunds");
  });
});

describe("PayoutHistory", () => {
  it("names transfers and bank payouts separately, in table and phone cards", () => {
    const m = html(<PayoutHistory scope="vendor" history={{ status: "ready", data: PAYOUTS_ACTIVE }} />);
    expect(m).toContain("Transfer to your Stripe account");
    expect(m).toContain("Bank payout by Stripe");
    expect(m).toContain('class="hide-mobile"');
    expect(m).toContain('class="mobile-cards"');
    expect(m).toContain("−€12.00 recovered");
  });
  it("empty: uses the rule's minimum, not a hardcoded one", () => {
    expect(html(<PayoutHistory scope="host" history={{ status: "ready", data: PAYOUTS_EMPTY }} />)).toContain("once they reach €25.00");
    expect(html(<PayoutHistory scope="host" history={{ status: "ready", data: { ...PAYOUTS_EMPTY, minimumPayoutCents: null } }} />)).toContain("once they reach the minimum payout");
  });
  it("embedded under the payout account card: no second account alert", () => {
    const m = html(<PayoutHistory scope="vendor" embedded history={{ status: "ready", data: PAYOUTS_RESTRICTED }} onOpenStripe={noop} />);
    expect(m).not.toContain("Payouts are paused");
    expect(m).toContain("Transfer to your Stripe account");
  });

  it("a failed bank payout is called out with Stripe's reason (OG-05)", () => {
    const m = html(<PayoutHistory scope="vendor" history={{ status: "ready", data: PAYOUTS_ACTIVE }} onOpenStripe={noop} />);
    expect(m).toMatch(/role="alert"[^>]*><strong>A bank payout didn&#x27;t go through/);
    expect(m).toContain("the account is closed");
    expect(html(<PayoutHistory scope="vendor" history={{ status: "ready", data: PAYOUTS_EMPTY }} />)).not.toContain("didn&#x27;t go through");
  });

  it("restricted: an alert with the Stripe action", () => {
    const m = html(<PayoutHistory scope="vendor" history={{ status: "ready", data: PAYOUTS_RESTRICTED }} onOpenStripe={noop} />);
    expect(m).toMatch(/role="alert"[^>]*><strong>Payouts are paused/);
    expect(m).toContain("Update details with Stripe");
  });
});

describe("CheckoutBreakdown (experience dialog) on the shared rows", () => {
  const quote = { ...Q_EXPERIENCE_COUPON_CREDIT, partySize: 2, taxableCents: 0, currency: "EUR" as const };
  it("shows the server's coupon and credit parts, keeps the spec test ids", () => {
    const m = html(<CheckoutBreakdown quote={quote} unitPriceCents={4500} />);
    expect(m).toMatch(/data-testid="breakdown-coupon"[\s\S]*?− €9\.00/);
    expect(m).toMatch(/data-testid="breakdown-credit"[\s\S]*?− €25\.00/);
    expect(m).toMatch(/data-testid="breakdown-card"[\s\S]*?€56\.00/);
    expect(m).toContain("Credit left after this booking: €0.00.");
  });
  it("without the server's balance-after it says nothing about the balance (never derived)", () => {
    const m = html(<CheckoutBreakdown quote={{ ...quote, creditBalanceAfterCents: undefined }} unitPriceCents={4500} />);
    expect(m).not.toContain("Credit left");
    expect(m).toContain("the credit part comes back as credit");
  });
});
