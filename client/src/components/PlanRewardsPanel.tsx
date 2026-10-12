import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchCheckoutStatus, fetchMyPlan, openBillingPortal, redeemRewardPoints, resumeProSubscription, type PartnerPlanOverview, type RewardHistoryEntry } from "../api";
import { AnalyticsEvent, trackTypedEvent } from "../analyticsEvents";
import { colors, fonts } from "../theme";
import { HelpLine, LearnMore } from "./LearnMore";
import { useFieldHelp } from "./FieldHelp";
import { Button } from "./ui";
import { earningsHref } from "./earningsViews";
import { visibleBenefitKeys } from "../partnerPricing";

// Stage 5f — "Plan & rewards": ONE domain component for vendors and hosts
// (scope) on the dashboard (compact) and Earnings (full). The plan state is
// server-derived; prices and tax come from the partner's current rules;
// explanations come from editable help entries. Partner reward points only —
// customer credit is a separate thing and never appears here.

type Scope = "vendor" | "host";
const euro = (minor: number) => `€${(minor / 100).toFixed(2)}`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long", year: "numeric" }) : "");
const num = (n: number) => n.toLocaleString("en-IE");
export const proPath = (scope: Scope) => (scope === "vendor" ? "/vendor/pro" : "/manage/pro");
export const rewardsPath = (scope: Scope) => (scope === "vendor" ? "/vendor/rewards" : "/manage/rewards");

export const HISTORY_LABEL: Record<RewardHistoryEntry["kind"], string> = {
  earned: "Earned at settlement",
  venue_share: "Venue split share",
  host_share: "Host split share",
  refund_reversal: "Refund reversal",
  dispute_reversal: "Dispute reversal",
  debt_repayment: "Debt repayment",
  redemption: "Pro redemption",
  adjustment: "Manual adjustment",
};

const panel = { background: colors.surface, border: `1px solid ${colors.borderStrong}`, borderRadius: 0, padding: 20 } as const;
const eyebrow = { fontSize: 11.5, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase" as const, color: colors.muted, margin: 0 };

export function PriceRows({ price, totalLabel = "Total each month" }: { price: PartnerPlanOverview["price"]; totalLabel?: string }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", margin: "10px 0", fontSize: 14, maxWidth: 360 }} data-testid="pro-price">
      <dt>Pro subscription</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{euro(price.netMinor)}</dd>
      <dt>{price.taxLabel}</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{euro(price.vatMinor)}</dd>
      <dt style={{ fontWeight: 700, borderTop: `1px solid ${colors.border}`, paddingTop: 4 }}>{totalLabel}</dt>
      <dd style={{ margin: 0, textAlign: "right", fontWeight: 700, borderTop: `1px solid ${colors.border}`, paddingTop: 4 }}>{euro(price.grossMinor)}</dd>
    </dl>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: "ok" | "warn" | "info" }) {
  const bg = tone === "ok" ? colors.greenBg : tone === "warn" ? colors.dangerBg : colors.orangeBg;
  const fg = tone === "ok" ? colors.greenText : tone === "warn" ? colors.danger : colors.text;
  return <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 0 }}>{children}</span>;
}

function BenefitList() {
  // R3B F1 — the lower-fee benefits describe the unconfirmed fee model; hooks stay unconditional.
  const all = [useFieldHelp("pro_benefit_1"), useFieldHelp("pro_benefit_2"), useFieldHelp("pro_benefit_3")];
  const shown = visibleBenefitKeys(["pro_benefit_1", "pro_benefit_2", "pro_benefit_3"]);
  const items = all.filter((b) => b && shown.includes(b.helpKey));
  if (!items.length) return null;
  return (
    <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }} data-testid="pro-benefits">
      {items.map((b) => (
        <li key={b!.helpKey}>
          <strong>{b!.name}.</strong> {b!.definition}
        </li>
      ))}
    </ul>
  );
}

export function usePlan(scope: Scope) {
  const [data, setData] = useState<PartnerPlanOverview | null>(null);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const load = useCallback(
    () =>
      fetchMyPlan(scope)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError((e as { status?: number })?.status === 403 ? "forbidden" : "failed")),
    [scope]
  );
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

export function PlanRewardsPanel({ scope, variant }: { scope: Scope; variant: "compact" | "full" }) {
  const { data, error, load } = usePlan(scope);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [redeemed, setRedeemed] = useState<{ points: number; from: string; to: string; remaining: number } | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const polling = useRef(false);
  const returned = params.get("pro");

  // Back from Stripe Checkout: confirm by polling (the webhook does the work).
  useEffect(() => {
    if (!returned) return;
    trackTypedEvent(AnalyticsEvent.PlanCheckoutReturned, { scope, outcome: returned === "success" ? "success" : "cancelled" });
    if (returned !== "success" || polling.current) return;
    polling.current = true;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const s = await fetchCheckoutStatus(scope).catch(() => null);
      if (s && s.state !== "processing" && s.state !== "free") {
        polling.current = false;
        await load();
        params.delete("pro");
        setParams(params, { replace: true });
        return;
      }
      if (tries >= 20) {
        polling.current = false;
        setPollTimedOut(true);
        return;
      }
      setTimeout(tick, 3_000);
    };
    tick();
  }, [returned]);

  if (error === "forbidden") return null; // other staff: not their section (server returns 403)
  if (error)
    return (
      <section style={panel} aria-label="Plan & rewards">
        <p role="alert" style={{ margin: 0, fontSize: 14 }}>
          Couldn't load your plan.{" "}
          <button type="button" onClick={load} style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer", fontWeight: 700, padding: 0, fontFamily: "inherit" }}>
            Try again
          </button>
        </p>
      </section>
    );
  if (!data)
    return (
      <section style={{ ...panel, minHeight: 120 }} aria-label="Plan & rewards" aria-busy="true">
        <p style={eyebrow}>Plan & rewards</p>
        <p style={{ color: colors.muted, fontSize: 13 }}>Loading…</p>
      </section>
    );
  if (data.state === "unavailable") return null;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ ok: true, text: done });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work — please try again" });
    } finally {
      setBusy(false);
    }
  };
  const portal = () =>
    act(async () => {
      trackTypedEvent(AnalyticsEvent.PlanBillingPortal, { scope, state: data.state });
      const { url } = await openBillingPortal(scope);
      window.location.assign(url);
    });
  const s = data.state;
  const sub = data.subscription;
  const r = data.rewards;
  const manage = data.canManage;
  const confirming = returned === "success" && (s === "free" || s === "processing");
  const full = variant === "full";

  let headline: string;
  let badge: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  if (confirming || s === "processing") {
    headline = "Confirming your payment";
    body = (
      <div role="status" aria-live="polite" style={{ fontSize: 14 }}>
        <p style={{ margin: "6px 0" }}>Stripe has your payment; we're waiting for its confirmation. This usually takes a few seconds — you can keep using HelloCircle meanwhile.</p>
        {pollTimedOut && <p style={{ margin: "6px 0" }}>This is taking longer than usual.</p>}
      </div>
    );
    actions = pollTimedOut ? (
      <Button
        variant="ghost"
        onClick={async () => {
          setPollTimedOut(false);
          const st = await fetchCheckoutStatus(scope).catch(() => null);
          await load();
          if (st && st.state !== "processing" && st.state !== "free") {
            params.delete("pro");
            setParams(params, { replace: true });
          } else setPollTimedOut(true);
        }}
      >
        Check status
      </Button>
    ) : null;
  } else if (s === "paid_active") {
    headline = "Pro active";
    badge = <Badge tone="ok">Paid subscription</Badge>;
    body = (
      <>
        <p style={{ margin: "6px 0", fontSize: 14 }}>{sub?.billingStartsAt && new Date(sub.billingStartsAt) > new Date() ? `Billing starts on ${day(sub.billingStartsAt)}, after your reward month.` : sub?.currentPeriodEnd ? `Renews on ${day(sub.currentPeriodEnd)}.` : "Renews monthly."}</p>
        {full && <PriceRows price={data.price} />}
      </>
    );
    actions = (
      <>
        <Link to={proPath(scope)} style={linkBtn}>Manage plan</Link>
        {manage && <Button variant="ghost" disabled={busy} onClick={portal}>View billing</Button>}
        <Link to={rewardsPath(scope)} style={linkBtn}>View rewards</Link>
      </>
    );
  } else if (s === "cancelling") {
    // Stripe sends the period end after checkout completes, so it can briefly be unknown.
    const ends = sub?.currentPeriodEnd ? day(sub.currentPeriodEnd) : null;
    headline = ends ? `Pro ends on ${ends}` : "Pro ends at the end of this billing period";
    badge = <Badge tone="info">Cancelling</Badge>;
    body = <p style={{ margin: "6px 0", fontSize: 14 }}>Your Pro benefits continue until {ends ?? "the end of the current billing period"}. After that your plan returns to Free.</p>;
    actions = (
      <>
        {manage && (
          <Button variant="orange" disabled={busy} onClick={() => act(async () => { trackTypedEvent(AnalyticsEvent.PlanKeep, { scope }); await resumeProSubscription(scope); }, "Pro will keep renewing.")}>
            Keep Pro
          </Button>
        )}
        <LearnMore helpKey="pro_cancellation" label="View cancellation details" />
      </>
    );
  } else if (s === "payment_failed") {
    headline = "Payment needs attention";
    badge = <Badge tone="warn">Payment failed</Badge>;
    body = (
      <p style={{ margin: "6px 0", fontSize: 14 }} role="status">
        Your last Pro payment didn't go through. You keep Pro until <strong>{day(sub?.graceUntil)}</strong>
        {sub?.graceDaysRemaining !== null && sub?.graceDaysRemaining !== undefined ? ` (${sub.graceDaysRemaining} day${sub.graceDaysRemaining === 1 ? "" : "s"} left)` : ""}. If it isn't paid by then, your plan returns to Free.
      </p>
    );
    actions = manage ? (
      <Button variant="orange" disabled={busy} onClick={portal}>
        Update payment method
      </Button>
    ) : null;
  } else if (s === "reward_active") {
    headline = "Pro — reward month";
    badge = <Badge tone="ok">Paid with points</Badge>;
    body = <p style={{ margin: "6px 0", fontSize: 14 }}>From {day(data.plan.effectiveFrom)} to {day(data.plan.effectiveTo)}. Nothing renews automatically and no payment is taken.</p>;
    actions = (
      <>
        <Link to={rewardsPath(scope)} style={linkBtn}>View reward history</Link>
        {data.enabled && <Link to={proPath(scope)} style={linkBtn} onClick={() => trackTypedEvent(AnalyticsEvent.PlanExplorePro, { scope, from: full ? "earnings" : "dashboard" })}>Explore paid Pro</Link>}
      </>
    );
  } else if (s === "pro_granted") {
    headline = "Pro — from HelloCircle";
    badge = <Badge tone="ok">Included</Badge>;
    body = <p style={{ margin: "6px 0", fontSize: 14 }}>{data.plan.effectiveTo ? `Included until ${day(data.plan.effectiveTo)}.` : "Included for your account."}</p>;
  } else {
    headline = "Your plan: Free";
    body = data.enabled ? (
      <>
        <p style={{ margin: "6px 0", fontSize: 14 }}>
          Pro is {euro(data.price.netMinor)}/month {data.price.vatMinor > 0 ? `+ ${data.price.taxLabel} ${euro(data.price.vatMinor)} = ${euro(data.price.grossMinor)}` : `(${data.price.taxLabel})`}.
        </p>
        {full && <BenefitList />}
      </>
    ) : (
      <p style={{ margin: "6px 0", fontSize: 14, color: colors.muted }}>Pro isn't available right now.</p>
    );
    actions = (
      <>
        {data.enabled && (
          <Link to={proPath(scope)} style={{ ...linkBtn, ...primaryLink }} onClick={() => trackTypedEvent(AnalyticsEvent.PlanExplorePro, { scope, from: full ? "earnings" : "dashboard" })}>
            Explore Pro
          </Link>
        )}
        {r.enabled && <LearnMore helpKey="points_earning" label="How rewards work" />}
      </>
    );
  }

  return (
    <section style={panel} aria-labelledby={`plan-h-${scope}-${variant}`} data-testid="plan-rewards" data-state={confirming ? "processing" : s}>
      <p style={eyebrow}>Plan & rewards</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        <h2 id={`plan-h-${scope}-${variant}`} style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: full ? 24 : 21, margin: 0, letterSpacing: 0 }}>
          {headline}
        </h2>
        {badge}
      </div>
      {body}
      {!manage && (s === "free" || s === "paid_active" || s === "cancelling" || s === "payment_failed") && (
        <p style={{ fontSize: 12.5, color: colors.muted, margin: "6px 0" }}>Only the organisation owner can change the plan.</p>
      )}
      {actions && <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>{actions}</div>}

      {r.enabled && (
        <div style={{ borderTop: `1px solid ${colors.border}`, marginTop: 16, paddingTop: 14 }} data-testid="rewards-block">
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
            <div>
              <p style={eyebrow}>Reward points</p>
              <p style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 28, margin: "2px 0 0" }} data-testid="points-available">
                {num(r.points)}
              </p>
            </div>
            <Stat label="Pending" value={num(r.pendingPoints)} help="points_pending" />
            {full && <Stat label="Earned this month" value={num(r.earnedThisMonth)} />}
          </div>
          <div style={{ marginTop: 10, maxWidth: 420 }}>
            <div role="progressbar" aria-label="Progress toward a free Pro month" aria-valuemin={0} aria-valuemax={r.redemptionPoints} aria-valuenow={Math.max(0, Math.min(r.points, r.redemptionPoints))} style={{ height: 8, background: colors.border }}>
              <div style={{ width: `${r.progressBps / 100}%`, height: "100%", background: colors.orange }} />
            </div>
            <p style={{ fontSize: 12.5, color: colors.muted, margin: "4px 0 0" }}>
              {num(Math.max(0, r.points))} of {num(r.redemptionPoints)} points for a free Pro month · {r.pointsPerEuro} point per €1 of settled sales
            </p>
          </div>
          {r.debtPoints > 0 && (
            <div role="status" style={{ background: colors.orangeBg, padding: "10px 12px", marginTop: 10, fontSize: 13.5 }} data-testid="points-debt">
              <strong>{num(r.debtPoints)} points are being repaid</strong> from refunded or disputed bookings. New points repay this first, and redeeming is paused until it's cleared. <LearnMore helpKey="points_debt" />
            </div>
          )}
          {full && r.recent.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", fontSize: 13.5 }} aria-label="Recent points activity">
              {r.recent.map((e) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: `1px solid ${colors.border}` }}>
                  <span>{HISTORY_LABEL[e.kind]}{e.sourceRef ? ` · ${e.sourceRef}` : ""}</span>
                  <span style={{ fontWeight: 700 }}>{e.points > 0 ? `+${num(e.points)}` : num(e.points)}</span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <RedeemControl scope={scope} data={data} busy={busy} onRedeem={() =>
              act(async () => {
                const res = await redeemRewardPoints(scope);
                trackTypedEvent(AnalyticsEvent.RewardsRedeemed, { scope });
                setRedeemed({ points: r.redemptionPoints, from: res.proFrom, to: res.proUntil, remaining: r.points - r.redemptionPoints });
              })
            } />
            <Link to={rewardsPath(scope)} style={linkBtn}>View all history</Link>
          </div>
          {redeemed && (
            <div role="status" style={{ background: colors.greenBg, padding: "10px 12px", marginTop: 10, fontSize: 13.5 }} data-testid="redeemed">
              {num(redeemed.points)} points spent · Pro from {day(redeemed.from)} to {day(redeemed.to)} · {num(redeemed.remaining)} points left. No paid subscription was created and nothing renews automatically.
            </div>
          )}
        </div>
      )}
      {!r.enabled && data.enabled && <p style={{ fontSize: 12.5, color: colors.muted, margin: "12px 0 0" }}>Reward points aren't available right now.</p>}
      <HelpLine helpKey={s === "free" ? "pro_price" : s === "payment_failed" ? "pro_failed_payment" : "points_earning"} />
      {variant === "compact" && (
        <Link to={earningsHref(scope, "plan")} style={{ fontSize: 13, color: colors.text, fontWeight: 700 }}>
          Full details in Earnings →
        </Link>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ fontSize: 13, color: msg.ok ? colors.greenText : colors.danger, margin: "10px 0 0" }}>{msg.text}</p>}
    </section>
  );
}

const linkBtn = { fontSize: 14, fontWeight: 700, color: colors.text, textDecoration: "underline", padding: "8px 0" } as const;
const primaryLink = { background: colors.orange, color: "#fff", textDecoration: "none", padding: "10px 16px", borderRadius: 0 } as const;

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div>
      <p style={eyebrow}>
        {label} {help && <LearnMore helpKey={help} label="?" />}
      </p>
      <p style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: "2px 0 0" }} data-testid={`stat-${label.toLowerCase().replace(/\W+/g, "-")}`}>{value}</p>
    </div>
  );
}

export function RedeemControl({ scope, data, busy, onRedeem }: { scope: Scope; data: PartnerPlanOverview; busy: boolean; onRedeem: () => void }) {
  const r = data.rewards;
  const reason: Record<string, string> = {
    not_enough: `${(r.redemptionPoints - Math.max(0, r.points)).toLocaleString("en-IE")} more points needed`,
    debt: "Paused while points are being repaid",
    paid_active: "You're on paid Pro already",
    cancelling_active: "Available after your paid Pro ends",
    disabled: "Not available right now",
  };
  if (!data.canManage) return null;
  const available = r.redemption === "available";
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="redeem" data-redemption={r.redemption}>
      <Button variant={available ? "orange" : "ghost"} disabled={busy || !available} onClick={onRedeem} aria-describedby={available ? undefined : `redeem-why-${scope}`}>
        Redeem {r.redemptionPoints.toLocaleString("en-IE")} points for a month of Pro
      </Button>
      {!available && (
        <span id={`redeem-why-${scope}`} style={{ fontSize: 12.5, color: colors.muted }}>
          {reason[r.redemption]}
        </span>
      )}
    </span>
  );
}
