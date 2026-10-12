import { useEffect, useRef, useState, type ReactNode } from "react";
import { comparePlans, estimatePrice, type EstimateInput, type PlanComparison, type PriceEstimate } from "../api";
import { colors, fonts, radius } from "../theme";
import { ManageCard as Card, inputStyle, labelStyle } from "./ui";
import { FieldHelp } from "./FieldHelp";

// Revenue & Connect Stage 3 — reactive calculators (brief §19A/B). Every
// number comes from the server's pe-2 engine (POST /api/pricing/estimate and
// /compare) — the client never re-implements a rate. Inputs update the result
// as you type (debounced, no submit button) and results are announced to
// screen readers (aria-live).

const euro = (minor: number) => `€${(minor / 100).toFixed(2)}`;
const toMinor = (text: string) => {
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Row({ label, value, help, strong, muted }: { label: string; value: string; help?: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 13.5, color: muted ? colors.mutedLight : colors.text, flex: 1 }}>
        {label}
        {help && <FieldHelp helpKey={help} label={label} />}
      </div>
      <div style={{ fontSize: 14, fontWeight: strong ? 800 : 600, whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 11.5, color: colors.mutedLight, marginTop: 4 }}>{hint}</span>}
    </label>
  );
}

type SplitMode = "none" | "fixed_venue" | "percentage";
type CouponMode = "none" | "vendor" | "helloCircle";

/** variant "public": anyone (pricing page); "partner": a signed-in partner
 * estimating an order (same numbers, no HelloCircle contribution line). */
export function PricingCalculator({ variant = "public", initialPlan = "free" }: { variant?: "public" | "partner"; initialPlan?: "free" | "pro" }) {
  const [plan, setPlan] = useState<"free" | "pro">(initialPlan);
  const [price, setPrice] = useState("100");
  const [qty, setQty] = useState("1");
  const [split, setSplit] = useState<SplitMode>("none");
  const [venueAmount, setVenueAmount] = useState("35");
  const [venuePct, setVenuePct] = useState("40");
  const [coupon, setCoupon] = useState<CouponMode>("none");
  const [couponAmount, setCouponAmount] = useState("10");
  const [result, setResult] = useState<PriceEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const input = useDebounced({ plan, price, qty, split, venueAmount, venuePct, coupon, couponAmount });

  useEffect(() => {
    const priceMinor = toMinor(input.price);
    const quantity = Math.max(1, Math.floor(Number(input.qty) || 1));
    if (priceMinor === null) {
      setError("Enter a price in euro");
      return;
    }
    const body: EstimateInput = { priceMinor, quantity, planKey: input.plan };
    if (input.split === "fixed_venue") {
      const v = toMinor(input.venueAmount);
      if (v === null) return setError("Enter the venue's fixed amount");
      body.split = { mode: "fixed_venue", venueMinor: v };
    } else if (input.split === "percentage") {
      const p = Number(input.venuePct);
      if (!Number.isFinite(p) || p < 0 || p > 100) return setError("Venue share must be 0–100%");
      body.split = { mode: "percentage", venueBps: Math.round(p * 100) };
    }
    if (input.coupon !== "none") {
      const c = toMinor(input.couponAmount);
      if (c === null) return setError("Enter the coupon amount in euro");
      body.discounts = [{ funder: input.coupon, amountMinor: c }];
    }
    setError(null);
    const mine = ++seq.current;
    estimatePrice(body)
      .then((r) => mine === seq.current && setResult(r))
      .catch((e) => mine === seq.current && setError(e instanceof Error ? e.message : "Couldn't calculate"));
  }, [input]);

  return (
    <Card style={{ padding: 22 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 4px" }}>{variant === "partner" ? "Estimate an order" : "What you'd earn on a booking"}</h3>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 16px" }}>Updates as you type. Figures come from HelloCircle's published rates.</p>
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
        <Field label="Plan">
          <select value={plan} onChange={(e) => setPlan(e.target.value as "free" | "pro")} style={inputStyle}>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
          </select>
        </Field>
        <Field label="Price per place (€)">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Places">
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Venue involved?">
          <select value={split} onChange={(e) => setSplit(e.target.value as SplitMode)} style={inputStyle}>
            <option value="none">No — one partner</option>
            <option value="fixed_venue">Yes — venue gets a fixed amount</option>
            <option value="percentage">Yes — venue gets a percentage</option>
          </select>
        </Field>
        {split === "fixed_venue" && (
          <Field label="Venue amount (€)">
            <input inputMode="decimal" value={venueAmount} onChange={(e) => setVenueAmount(e.target.value)} style={inputStyle} />
          </Field>
        )}
        {split === "percentage" && (
          <Field label="Venue share (%)">
            <input inputMode="decimal" value={venuePct} onChange={(e) => setVenuePct(e.target.value)} style={inputStyle} />
          </Field>
        )}
        <Field label="Coupon">
          <select value={coupon} onChange={(e) => setCoupon(e.target.value as CouponMode)} style={inputStyle}>
            <option value="none">None</option>
            <option value="vendor">Funded by you</option>
            <option value="helloCircle">Funded by HelloCircle</option>
          </select>
        </Field>
        {coupon !== "none" && (
          <Field label="Coupon amount (€)">
            <input inputMode="decimal" value={couponAmount} onChange={(e) => setCouponAmount(e.target.value)} style={inputStyle} />
          </Field>
        )}
      </div>
      <div aria-live="polite">
        {error ? (
          <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
        ) : !result ? (
          <p style={{ color: colors.mutedLight, fontSize: 13 }}>Calculating…</p>
        ) : !result.ok ? (
          <p style={{ color: colors.danger, fontSize: 13, background: colors.dangerBg, padding: "9px 12px", borderRadius: radius.control }}>{result.blockedReason}</p>
        ) : (
          <div>
            <Row label="Customer pays" value={euro(result.customerChargeMinor)} help="customer_price" strong />
            {result.helloCircleFundedDiscountMinor > 0 && <Row label="HelloCircle-funded discount" value={`−${euro(result.helloCircleFundedDiscountMinor)}`} help="hellocircle_discount" muted />}
            {result.partnerFundedDiscountMinor > 0 && <Row label="Discount you fund" value={`−${euro(result.partnerFundedDiscountMinor)}`} help="partner_discount" muted />}
            <Row label="Fee base" value={euro(result.feeBaseMinor)} help="fee_base" />
            <Row label={`HelloCircle fee${result.minimumFeeApplied ? " (minimum applies)" : ""}`} value={`−${euro(result.platformFeeNetMinor)}`} help="platform_fee" />
            <Row label="VAT on HelloCircle fee" value={`−${euro(result.platformFeeVatMinor)}`} help="platform_fee_vat" />
            <Row label="Partner earnings" value={euro(result.partnerPoolMinor)} help="partner_payout" strong />
            {result.allocations.length > 1 &&
              result.allocations.map((a) => (
                <Row key={a.recipient} label={a.recipient === "venue" ? "  Venue receives" : "  Host receives"} value={euro(a.amountMinor)} help={a.recipient === "venue" ? "venue_allocation" : "host_allocation"} />
              ))}
            {variant === "public" && <Row label="HelloCircle's estimated contribution" value={euro(result.contributionBeforeReservesMinor)} help="hellocircle_contribution" muted />}
            <p style={{ fontSize: 11.5, color: colors.mutedLight, margin: "10px 0 0" }}>
              Estimates. There's no HelloCircle booking fee for customers. Your own activity's VAT (if you charge it) is included in your price and is yours.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Free vs Pro for a month (brief §5) — neutral: reports the cheaper plan and
 * the break-even point, nothing more. */
export function PlanComparisonCalculator() {
  const [gmv, setGmv] = useState("1500");
  const [orders, setOrders] = useState("40");
  const [result, setResult] = useState<PlanComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useDebounced({ gmv, orders });
  const seq = useRef(0);

  useEffect(() => {
    const g = toMinor(input.gmv);
    const o = Math.floor(Number(input.orders));
    if (g === null || !Number.isFinite(o) || o < 0) return setError("Enter monthly sales (€) and a number of bookings");
    setError(null);
    const mine = ++seq.current;
    comparePlans(g, o)
      .then((r) => mine === seq.current && setResult(r))
      .catch((e) => mine === seq.current && setError(e instanceof Error ? e.message : "Couldn't compare"));
  }, [input]);

  return (
    <Card style={{ padding: 22 }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, margin: "0 0 4px" }}>Free or Pro?</h3>
      <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 16px" }}>Compare a typical month. Fees are shown before VAT.</p>
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginBottom: 18 }}>
        <Field label="Monthly sales (€)">
          <input inputMode="decimal" value={gmv} onChange={(e) => setGmv(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Paid bookings per month">
          <input inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value)} style={inputStyle} />
        </Field>
      </div>
      <div aria-live="polite">
        {error ? (
          <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>
        ) : !result ? (
          <p style={{ color: colors.mutedLight, fontSize: 13 }}>Calculating…</p>
        ) : (
          <>
            <Row label="Free plan — fees" value={euro(result.free.feesMinor)} />
            <Row label={`Pro plan — fees + ${euro(result.pro.subscriptionMinor)} subscription`} value={euro(result.pro.feesMinor + result.pro.subscriptionMinor)} />
            <Row label={result.proMonthlySavingMinor >= 0 ? "Pro would save you" : "Pro would cost you more by"} value={euro(Math.abs(result.proMonthlySavingMinor))} strong />
            {result.proBreakEvenMonthlyGmvMinor !== null && <Row label="Pro pays for itself above" value={`${euro(result.proBreakEvenMonthlyGmvMinor)} / month`} help="pro_break_even" />}
            <p style={{ fontSize: 13, margin: "12px 0 0" }}>
              At these numbers, <strong>{result.cheaperPlan === "pro" ? "Pro" : "Free"}</strong> costs less. You can change plan at any time; existing bookings keep the fees they were made with.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
