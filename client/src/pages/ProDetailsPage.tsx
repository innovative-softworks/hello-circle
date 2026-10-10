import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cancelProSubscription, fetchPricingPlans, startProCheckout, type PublicPlans } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { colors, fonts } from "../theme";
import { useFieldHelp } from "../components/FieldHelp";
import { HelpLine, LearnMore } from "../components/LearnMore";
import { PriceRows, PlanRewardsPanel, usePlan } from "../components/PlanRewardsPanel";
import { Button, ConfirmDialog } from "../components/ui";

// Stage 5f — one Pro details experience for vendors (/vendor/pro) and hosts
// (/manage/pro). Free → Explore Pro → review exact price → Continue to Stripe
// → Stripe Checkout → back to the dashboard's "Confirming" state. Prices and
// tax come from the partner's current rules; explanations and FAQs from
// editable help entries; the test-card hint only in test mode.

type Scope = "vendor" | "host";
const euro = (m: number) => `€${(m / 100).toFixed(2)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long", year: "numeric" }) : "");

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section style={{ borderTop: `1px solid ${colors.borderStrong}`, padding: "18px 0" }} aria-labelledby={`pro-s${n}`}>
      <h2 id={`pro-s${n}`} style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 19, margin: "0 0 6px" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Faq({ k }: { k: string }) {
  const e = useFieldHelp(k);
  if (!e) return null;
  return (
    <details style={{ borderBottom: `1px solid ${colors.border}`, padding: "8px 0" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 14.5 }}>{e.name}</summary>
      <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6 }}>{e.definition}</p>
    </details>
  );
}

export function ProDetailsPage({ scope }: { scope: Scope }) {
  const { data, error, load } = usePlan(scope);
  const [plans, setPlans] = useState<PublicPlans | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    fetchPricingPlans().then(setPlans).catch(() => setPlans(null));
  }, []);
  const back = scope === "vendor" ? "/vendor" : "/manage";

  if (error === "forbidden") return <Shell back={back}><p role="alert">You don't have access to this organisation's plan.</p></Shell>;
  if (error) return <Shell back={back}><p role="alert">Couldn't load the plan. <button type="button" onClick={load}>Try again</button></p></Shell>;
  if (!data) return <Shell back={back}><p aria-busy="true">Loading…</p></Shell>;
  if (!data.enabled) return <Shell back={back}><p>Pro isn't available right now.</p></Shell>;

  const subscribed = data.state === "paid_active" || data.state === "cancelling" || data.state === "payment_failed";
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await startProCheckout(scope, accepted);
      trackTypedEvent(AnalyticsEvent.PlanCheckoutStarted, { scope, reused: r.reused });
      if (!r.url) throw new Error("Stripe didn't return a checkout page — please try again");
      window.location.assign(r.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open Stripe");
      setBusy(false);
    }
  };

  return (
    <Shell back={back}>
      <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 34, margin: "4px 0 6px", letterSpacing: "-0.02em" }}>HelloCircle Pro</h1>
      <HelpLine helpKey="pro_price" />
      {subscribed && (
        <div style={{ margin: "12px 0" }}>
          <PlanRewardsPanel scope={scope} variant="full" />
        </div>
      )}

      <Section n={1} title="Your plan today">
        <p style={{ margin: 0, fontSize: 14.5 }}>
          {data.state === "reward_active"
            ? `Pro from your reward points until ${day(data.plan.effectiveTo)}.`
            : data.state === "pro_granted"
              ? "Pro, included by HelloCircle."
              : subscribed
                ? "Pro (paid subscription)."
                : "Free."}
        </p>
      </Section>

      <Section n={2} title="Free and Pro">
        {plans ? (
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)", gap: "6px 12px", fontSize: 14, margin: 0 }} data-testid="plan-compare">
            <dt />
            <dd style={{ margin: 0, fontWeight: 700 }}>Free</dd>
            <dd style={{ margin: 0, fontWeight: 700 }}>Pro</dd>
            <dt>Success fee on paid bookings</dt>
            <dd style={{ margin: 0 }}>{pct(plans.free.successFeeBps)}</dd>
            <dd style={{ margin: 0 }}>{pct(plans.pro.successFeeBps)}</dd>
            <dt>Minimum fee per paid booking</dt>
            <dd style={{ margin: 0 }}>{euro(plans.free.minFeeMinor)}</dd>
            <dd style={{ margin: 0 }}>{euro(plans.pro.minFeeMinor)}</dd>
            <dt>Monthly price (before tax)</dt>
            <dd style={{ margin: 0 }}>{euro(plans.free.subscriptionMonthlyMinor)}</dd>
            <dd style={{ margin: 0 }}>{euro(data.price.netMinor)}</dd>
          </dl>
        ) : (
          <p style={{ fontSize: 13, color: colors.muted }}>Comparison unavailable right now.</p>
        )}
        {plans?.proBreakEvenMonthlyGmvMinor ? <p style={{ fontSize: 13, color: colors.muted }}>Pro costs less once your paid sales reach about {euro(plans.proBreakEvenMonthlyGmvMinor)} a month.</p> : null}
      </Section>

      <Section n={3} title="Price and tax for you">
        <PriceRows price={data.price} totalLabel={data.state === "reward_active" ? "Total each month after your reward month" : "Total due today"} />
        <HelpLine helpKey={data.price.vatMode === "reverse_charge" ? "pro_reverse_charge" : "pro_vat"} />
      </Section>

      <Section n={4} title="A free month with reward points">
        <HelpLine helpKey="points_redeem" />
        <p style={{ fontSize: 14, margin: 0 }}>You have {data.rewards.points.toLocaleString("en-IE")} of {data.rewards.redemptionPoints.toLocaleString("en-IE")} points.</p>
      </Section>

      <Section n={5} title="Billing">
        <p style={{ fontSize: 14, margin: 0 }}>
          Monthly, from the day you subscribe{data.state === "reward_active" ? ` — or from ${day(data.plan.effectiveTo)} if you subscribe during your reward month` : ""}. Stripe handles the card and sends the receipts.
        </p>
      </Section>

      <Section n={6} title="Cancelling">
        <HelpLine helpKey="pro_cancellation" />
      </Section>

      <Section n={7} title="If a payment fails">
        <HelpLine helpKey="pro_failed_payment" />
        <p style={{ fontSize: 14, margin: 0 }}>Grace period: {data.graceDaysPolicy} days.</p>
      </Section>

      <Section n={8} title="Refunds, disputes and points">
        <HelpLine helpKey="pro_faq_refund_points" />
        <LearnMore helpKey="points_debt" label="About points debt" />
      </Section>

      <Section n={9} title="What Pro includes">
        <Benefits />
      </Section>

      <Section n={10} title="Questions">
        <Faq k="pro_faq_cancel" />
        <Faq k="pro_faq_refund_points" />
        <Faq k="pro_faq_reward_month" />
      </Section>

      {!subscribed && data.state !== "processing" && (
        <Section n={11} title="Subscribe">
          {data.canManage ? (
            <>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, margin: "4px 0 12px" }}>
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>
                  I agree to the HelloCircle Pro terms, including the monthly price shown above, renewal until cancelled and the {data.graceDaysPolicy}-day grace period.{" "}
                  <a href="/policies/payments-fees-payouts" style={{ color: colors.text, fontWeight: 700 }}>Read the terms</a>
                </span>
              </label>
              <Button variant="orange" disabled={!accepted || busy} onClick={go}>
                {busy ? "Opening Stripe…" : "Continue to Stripe"}
              </Button>
              {data.testMode && (
                <p style={{ fontSize: 12.5, color: colors.muted, margin: "8px 0 0" }} data-testid="test-card-hint">
                  Test mode: use card 4242 4242 4242 4242, any future date and any CVC.
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 14 }}>Only the organisation owner can subscribe.</p>
          )}
          {err && <p role="alert" style={{ color: colors.danger, fontSize: 13.5 }}>{err}</p>}
        </Section>
      )}

      {data.state === "paid_active" && data.canManage && (
        <Section n={12} title="Cancel Pro">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel Pro</Button>
          <ConfirmDialog
            open={confirmCancel}
            title="Cancel Pro?"
            message={`Pro won't renew. You keep it until ${day(data.subscription?.currentPeriodEnd)}, then your plan returns to Free. You can choose "Keep Pro" before then.`}
            confirmLabel="Cancel Pro"
            cancelLabel="Keep Pro"
            onCancel={() => setConfirmCancel(false)}
            onConfirm={async () => {
              setConfirmCancel(false);
              setBusy(true);
              try {
                await cancelProSubscription(scope);
                trackTypedEvent(AnalyticsEvent.PlanCancel, { scope });
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Couldn't cancel");
              } finally {
                setBusy(false);
              }
            }}
          />
        </Section>
      )}
    </Shell>
  );
}

function Benefits() {
  const items = [useFieldHelp("pro_benefit_1"), useFieldHelp("pro_benefit_2"), useFieldHelp("pro_benefit_3")].filter(Boolean);
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
      {items.map((b) => (
        <li key={b!.helpKey}>
          <strong>{b!.name}.</strong> {b!.definition}
        </li>
      ))}
    </ul>
  );
}

function Shell({ back, children }: { back: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 64px", background: colors.bg, color: colors.text }}>
      <Link to={back} style={{ fontSize: 13.5, color: colors.text, fontWeight: 700 }}>← Back to your dashboard</Link>
      {children}
    </main>
  );
}

export function VendorProPage() {
  return <ProDetailsPage scope="vendor" />;
}
export function HostProPage() {
  return <ProDetailsPage scope="host" />;
}
