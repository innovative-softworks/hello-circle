import { useEffect, useState } from "react";
import { fetchPricingPlans, type PublicPlans } from "../api";
import { colors, fonts, radius } from "../theme";
import { PlanComparisonCalculator, PricingCalculator } from "../components/PricingCalculator";
import { FieldHelp } from "../components/FieldHelp";
import { ManageCard as Card, PageSpinner } from "../components/ui";

// Revenue & Connect Stage 3 — public pricing page for partners (brief §4–§5,
// §19A). Every figure is read from the published plan rules; nothing about
// rates lives in this file.

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
const euro = (minor: number) => `€${(minor / 100).toFixed(2)}`;

function PlanCard({ title, terms, vatBps, highlight }: { title: string; terms: PublicPlans["free"]; vatBps: number; highlight?: boolean }) {
  return (
    <Card style={{ padding: 22, border: highlight ? `2px solid ${colors.green}` : undefined }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0 }}>{title}</h2>
      <div style={{ fontSize: 28, fontWeight: 800, margin: "10px 0 2px" }}>
        {terms.subscriptionMonthlyMinor === 0 ? "€0" : euro(terms.subscriptionMonthlyMinor)}
        <span style={{ fontSize: 14, fontWeight: 500, color: colors.mutedLight }}> / month{terms.subscriptionMonthlyMinor ? " + VAT" : ""}</span>
      </div>
      <ul style={{ paddingLeft: 18, margin: "12px 0 0", fontSize: 14, lineHeight: 1.7 }}>
        <li>
          {pct(terms.successFeeBps)} + VAT per completed paid booking
          <FieldHelp helpKey="platform_fee" />
        </li>
        <li>Minimum {euro(terms.minFeeMinor)} + VAT per paid booking</li>
        <li>No fee on free events</li>
        <li>Free listing; weekly transfers to your Stripe account and standard bank payouts included</li>
        <li style={{ color: colors.mutedLight }}>VAT on HelloCircle fees is charged at {pct(vatBps)}</li>
      </ul>
    </Card>
  );
}

export function Pricing() {
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    document.title = "Pricing for partners | HelloCircle";
    fetchPricingPlans().then(setPlans).catch(() => setError(true));
  }, []);

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "32px 16px 64px" }}>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: colors.orangeDark, letterSpacing: ".04em", textTransform: "uppercase", margin: 0 }}>For venues, clubs and hosts</p>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(28px, 5vw, 42px)", margin: "6px 0 10px", letterSpacing: "-.02em" }}>Simple pricing. No booking fee for your customers.</h1>
      <p style={{ fontSize: 16, color: colors.textSoft, maxWidth: 680, margin: "0 0 26px", lineHeight: 1.55 }}>
        Your customers pay the price you list. HelloCircle takes a success fee only when a paid booking completes, and transfers your earnings to your Stripe account weekly — Stripe then pays them out to your bank.
      </p>
      {error ? (
        <p style={{ color: colors.danger }}>Pricing isn't available right now — please try again shortly.</p>
      ) : !plans ? (
        <PageSpinner />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 12 }}>
            <PlanCard title="Free" terms={plans.free} vatBps={plans.vatBps} />
            <PlanCard title="Pro" terms={plans.pro} vatBps={plans.vatBps} highlight />
          </div>
          {plans.proBreakEvenMonthlyGmvMinor !== null && (
            <p style={{ fontSize: 14, color: colors.textSoft, margin: "0 0 28px", background: colors.panel, padding: "10px 14px", borderRadius: radius.control }}>
              Pro pays for itself once your monthly sales pass {euro(plans.proBreakEvenMonthlyGmvMinor)}
              <FieldHelp helpKey="pro_break_even" />.
            </p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
            <PricingCalculator variant="public" />
            <PlanComparisonCalculator />
          </div>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "26px 0 0", lineHeight: 1.6 }}>
            Card processing and standard bank payouts are included. Instant payouts, currency conversion and cross-border payouts are charged at cost where offered.
            Transfer eligibility begins after the activity is completed and the review period has passed. See the{" "}
            <a href="/policies/payments-fees-payouts" style={{ color: colors.greenText, fontWeight: 600 }}>Payments, Fees and Payout Policy</a> for full terms.
          </p>
        </>
      )}
    </main>
  );
}
