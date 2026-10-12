import { useState, type ReactNode } from "react";
import {
  BkButton,
  CheckoutSummary,
  CouponField,
  CouponRejectedError,
  CreditToggle,
  bk,
  bkFonts,
  checkoutActionLabel,
  type CheckoutQuote,
  type QuoteState,
} from "../components/booking";
import {
  CHECKOUT_FIXTURES,
  EXPIRED_COUPON_NOTICE,
  PAYOUTS_ACTIVE,
  PAYOUTS_EMPTY,
  PAYOUTS_RESTRICTED,
  PREVIEW_COUPON_REASONS,
  Q_EXPERIENCE_COUPON,
  Q_EXPERIENCE_COUPON_CREDIT,
  RECEIPT_FIXTURES,
  REDEMPTIONS,
  REDEMPTIONS_EMPTY,
} from "../components/booking/__fixtures__/commerce";
import type { CouponRedemptionsData, PayoutHistoryData, ReceiptDetail, Remote } from "../components/commerceDisplay";
import { CouponRedemptionsDrawer } from "../components/CouponRedemptionsDrawer";
import { PayoutHistory } from "../components/PayoutHistory";
import { PriceChip } from "../components/PriceChip";
import { ReceiptDrawer } from "../components/ReceiptDrawer";
import { RefundStatus } from "../components/SelfCancelControl";
import { Button, ManageCard as Card, SectionTabs, TabPanel } from "../components/ui";
import { colors, fonts } from "../theme";

// Commercial UX R1/R2 review surface, part of the dev-only /dev/booking-kit
// page. Everything is fixture data (components/booking/__fixtures__) — no API
// is called and nothing is priced here.

const ready = (q: CheckoutQuote): QuoteState<CheckoutQuote> => ({ status: "ready", quote: q, error: null, seq: 1 });
const LOADING: QuoteState<CheckoutQuote> = { status: "loading", quote: null, error: null, seq: 1 };
const ERROR: QuoteState<CheckoutQuote> = { status: "error", quote: null, error: "Check your connection and try again. You haven't been charged.", seq: 1 };

function Sub({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase", color: bk.muted }}>{children}</div>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 28, borderBottom: `1px solid ${bk.line}` }}>
      <h2 style={{ margin: 0, fontFamily: bkFonts.display, fontSize: 22, fontWeight: 700 }}>{title}</h2>
      {children}
    </section>
  );
}

/** Booking-surface parts (rendered inside each light/dark KitColumn). */
export function CommerceKitSections() {
  const [code, setCode] = useState<string | null>(null);
  const [expiredCode, setExpiredCode] = useState<string | null>(EXPIRED_COUPON_NOTICE.code);
  const [useCredit, setUseCredit] = useState(true);
  const interactive = useCredit ? Q_EXPERIENCE_COUPON_CREDIT : Q_EXPERIENCE_COUPON;
  return (
    <>
      <Block title="Checkout summary (R2)">
        {CHECKOUT_FIXTURES.map((f) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Sub>{f.label}</Sub>
            <CheckoutSummary state={ready(f.quote)} subtotalLabel={f.subtotalLabel} />
            <div>
              <BkButton full>{checkoutActionLabel(f.quote)}</BkButton>
            </div>
          </div>
        ))}
        <Sub>Loading</Sub>
        <CheckoutSummary state={LOADING} subtotalLabel="Hall hire · 2 hours" />
        <Sub>Error</Sub>
        <CheckoutSummary state={ERROR} subtotalLabel="Hall hire · 2 hours" onRetry={() => {}} />
        <Sub>Expired code (re-priced at checkout)</Sub>
        <CheckoutSummary state={ready(EXPIRED_COUPON_NOTICE.quote)} subtotalLabel="Hall hire · 2 hours" notice={EXPIRED_COUPON_NOTICE.notice} />
        <Sub>Phone total bar (tap to expand)</Sub>
        <CheckoutSummary state={ready(Q_EXPERIENCE_COUPON_CREDIT)} subtotalLabel="2 × €45.00" collapsible />
      </Block>

      <Block title="Coupon field (R2)">
        <Sub>Try SPRING10, OLDCODE, SOON, USEDUP, BIGSPEND, OTHERVENUE or anything else</Sub>
        <CouponField
          applied={code}
          onApply={async (c) => {
            await new Promise((r) => setTimeout(r, 400));
            if (c === "SPRING10") return setCode(c);
            const reason = PREVIEW_COUPON_REASONS[c] ?? null;
            throw new CouponRejectedError(reason, reason === "min_spend" ? 15000 : null);
          }}
          onRemove={() => setCode(null)}
        />
        <Sub>Applied code that expired before payment</Sub>
        <CouponField applied={expiredCode} appliedProblem={expiredCode ? EXPIRED_COUPON_NOTICE.problem : null} onApply={async (c) => setExpiredCode(c)} onRemove={() => setExpiredCode(null)} />
      </Block>

      <Block title="HelloCircle credit (R2)">
        <Sub>Interactive: toggling swaps between two fixture quotes</Sub>
        <CreditToggle availableCents={2500} expiresAt="2027-03-31T23:59:00.000Z" requested={useCredit} appliedCents={useCredit ? 2500 : null} onChange={setUseCredit} />
        <CheckoutSummary state={ready(interactive)} subtotalLabel="2 × €45.00" />
        <Sub>Off</Sub>
        <CreditToggle availableCents={4000} expiresAt="2027-03-31T23:59:00.000Z" requested={false} appliedCents={null} onChange={() => {}} />
        <Sub>Part of the balance applies</Sub>
        <CreditToggle availableCents={4000} requested appliedCents={3000} onChange={() => {}} />
        <Sub>Insufficient credit — balance changed since review</Sub>
        <CreditToggle availableCents={1000} requested appliedCents={1000} previouslyAppliedCents={2500} onChange={() => {}} />
        <Sub>Not usable for this booking</Sub>
        <CreditToggle availableCents={2500} eligible={false} requested={false} appliedCents={null} onChange={() => {}} />
        <Sub>No credit (renders nothing)</Sub>
        <CreditToggle availableCents={0} requested={false} appliedCents={null} onChange={() => {}} />
      </Block>
    </>
  );
}

type FixtureOption<T> = { key: string; label: string; value: Remote<T> };

function useFixturePicker<T>(options: FixtureOption<T>[]) {
  const [key, setKey] = useState(options[0].key);
  return { key, setKey, value: options.find((o) => o.key === key)!.value };
}

const RECEIPT_OPTIONS: FixtureOption<ReceiptDetail>[] = [
  ...RECEIPT_FIXTURES.map((f) => ({ key: f.receipt.status, label: f.label, value: { status: "ready" as const, data: f.receipt } })),
  { key: "loading", label: "Loading", value: { status: "loading" } },
  { key: "error", label: "Error", value: { status: "error", error: "Check your connection and try again." } },
];

const PAYOUT_OPTIONS: FixtureOption<PayoutHistoryData>[] = [
  { key: "active", label: "Success", value: { status: "ready", data: PAYOUTS_ACTIVE } },
  { key: "empty", label: "Empty", value: { status: "ready", data: PAYOUTS_EMPTY } },
  { key: "restricted", label: "Restricted", value: { status: "ready", data: PAYOUTS_RESTRICTED } },
  { key: "loading", label: "Loading", value: { status: "loading" } },
  { key: "error", label: "Error", value: { status: "error", error: "Check your connection and try again." } },
];

const REDEMPTION_OPTIONS: FixtureOption<CouponRedemptionsData>[] = [
  { key: "rows", label: "Success", value: { status: "ready", data: REDEMPTIONS } },
  { key: "empty", label: "Empty", value: { status: "ready", data: REDEMPTIONS_EMPTY } },
  { key: "loading", label: "Loading", value: { status: "loading" } },
  { key: "error", label: "Error", value: { status: "error", error: "Check your connection and try again." } },
];

function DashBlock({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, margin: 0 }}>{title}</h2>
      {note && <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight, maxWidth: 720 }}>{note}</p>}
      {children}
    </section>
  );
}

/** Dashboard-surface parts (app theme, not the booking surface). */
export function DashboardCommercePreview() {
  const receipt = useFixturePicker(RECEIPT_OPTIONS);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const payouts = useFixturePicker(PAYOUT_OPTIONS);
  const redemptions = useFixturePicker(REDEMPTION_OPTIONS);
  const [redemptionsOpen, setRedemptionsOpen] = useState(false);

  return (
    <div style={{ background: colors.bg, color: colors.text, padding: "32px 16px 64px", display: "flex", flexDirection: "column", gap: 36, maxWidth: 1040, margin: "0 auto" }}>
      <DashBlock title="R1 · Listing price chips and refund labels" note="Live on Club, Experience and activity cards and in My Life. Free and Free trial come straight from the listing's price and trial fields.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <PriceChip signal="free" />
          <PriceChip signal="free_trial" />
          <span style={{ background: "#3a4a3e", padding: 10, display: "inline-flex", gap: 8 }}>
            <PriceChip signal="free" onPhoto />
          </span>
          <RefundStatus refundState="pending" />
          <RefundStatus refundState="refunded" />
        </div>
      </DashBlock>

      <DashBlock title="R2 · Receipt drawer" note="Profile → Receipts → a row. Fixture-only until R3 adds the receipt detail endpoint.">
        <SectionTabs idBase="pv-receipt" label="Receipt fixture" value={receipt.key} onChange={receipt.setKey} options={RECEIPT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
        <TabPanel idBase="pv-receipt" tab={receipt.key}>
          <Button variant="dark" onClick={() => setReceiptOpen(true)}>
            Open receipt
          </Button>
        </TabPanel>
        <ReceiptDrawer open={receiptOpen} onClose={() => setReceiptOpen(false)} receipt={receipt.value} onRetry={() => {}} />
      </DashBlock>

      <DashBlock title="R2 · Payout history" note="Earnings → Payouts. One list for transfers (HelloCircle → Stripe) and bank payouts (Stripe → bank). Resize to 320px for the stacked layout.">
        <SectionTabs idBase="pv-payouts" label="Payout fixture" value={payouts.key} onChange={payouts.setKey} options={PAYOUT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
        <TabPanel idBase="pv-payouts" tab={payouts.key}>
          <PayoutHistory scope="vendor" history={payouts.value} onRetry={() => {}} onOpenStripe={() => {}} />
        </TabPanel>
      </DashBlock>

      <DashBlock title="R2 · Coupon uses drawer" note="Offers → a code → Uses. Fixture-only until R3 adds the partner redemptions endpoint.">
        <SectionTabs idBase="pv-redemptions" label="Coupon uses fixture" value={redemptions.key} onChange={redemptions.setKey} options={REDEMPTION_OPTIONS.map((o) => ({ key: o.key, label: o.label }))} />
        <TabPanel idBase="pv-redemptions" tab={redemptions.key}>
          <Card style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>
              <strong style={{ fontFamily: "monospace" }}>AUTUMN15</strong> · 15% off · used 2 of 50
            </span>
            <Button variant="ghost" onClick={() => setRedemptionsOpen(true)}>
              View uses
            </Button>
          </Card>
        </TabPanel>
        <CouponRedemptionsDrawer open={redemptionsOpen} onClose={() => setRedemptionsOpen(false)} code="AUTUMN15" redemptions={redemptions.value} onRetry={() => {}} />
      </DashBlock>
    </div>
  );
}
