import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cancelProSubscription, fetchMyPlan, redeemRewardPoints, resumeProSubscription, startProCheckout, type PartnerPlanOverview } from "../api";
import { colors, fonts, radius } from "../theme";
import { FieldHelp } from "./FieldHelp";
import { Button, ManageCard as Card } from "./ui";

// Revenue & Connect Stage 5b — the partner's plan: Pro on Stripe Billing
// (subscribe / cancel at period end / undo) and reward points. Prices come
// from the published plan rule plus VAT; nothing is hard-coded here.

const euro = (minor: number) => `€${(minor / 100).toFixed(2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "long" }) : "");

export function PlanCard({ scope }: { scope: "vendor" | "host" }) {
  const [data, setData] = useState<PartnerPlanOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [params] = useSearchParams();
  const load = () => fetchMyPlan(scope).then(setData).catch(() => setData(null));
  useEffect(() => {
    load();
  }, [scope]);

  if (!data || (!data.enabled && !data.rewards.enabled)) return null;
  const sub = data.subscription;
  const isPro = data.plan.planKey === "pro";
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ ok: true, text: done });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work" });
    } finally {
      setBusy(false);
    }
  };
  const returned = params.get("pro");

  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0 }}>Your plan: {isPro ? "Pro" : "Free"}</h3>
        <Link to="/pricing" style={{ fontSize: 13, color: colors.greenText, fontWeight: 600 }}>Compare plans</Link>
      </div>
      {returned === "success" && !isPro && <p role="status" style={{ fontSize: 13, color: colors.mutedLight }}>Payment received — Pro starts as soon as Stripe confirms it (usually within a minute).</p>}
      {sub?.status === "past_due" && (
        <p role="alert" style={{ background: colors.dangerBg, color: colors.danger, padding: "8px 12px", borderRadius: radius.control, fontSize: 13 }}>
          Your last Pro payment failed. Update your card with Stripe before {day(sub.graceUntil)} to keep Pro.
        </p>
      )}
      {data.enabled && (
        <div style={{ marginTop: 10, fontSize: 14 }}>
          {sub ? (
            <>
              <p style={{ margin: "0 0 10px" }}>
                Pro subscription, {euro(data.price.netMinor)}/month + {data.price.vatMinor > 0 ? `VAT ${euro(data.price.vatMinor)}` : `no VAT (${data.price.vatMode.replace("_", " ")})`}.{" "}
                {sub.cancelAtPeriodEnd ? `Ends on ${day(sub.currentPeriodEnd)} — you'll move to Free then.` : sub.currentPeriodEnd ? `Renews on ${day(sub.currentPeriodEnd)}.` : ""}
              </p>
              {sub.cancelAtPeriodEnd ? (
                <Button variant="ghost" disabled={busy} onClick={() => act(() => resumeProSubscription(scope), "Pro will keep renewing.")}>Keep Pro</Button>
              ) : (
                <Button variant="ghost" disabled={busy} onClick={() => act(() => cancelProSubscription(scope), "Pro won't renew. You keep it until the end of this month.")}>Cancel Pro</Button>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", color: colors.textSoft }}>
                Pro is {euro(data.price.netMinor)}/month excluding VAT
                {data.price.vatMinor > 0 ? ` (+ VAT ${euro(data.price.vatMinor)} for you)` : ` (no VAT charged to you: ${data.price.vatMode.replace("_", " ")})`} for a lower success fee.
                <FieldHelp helpKey="pro_break_even" />
              </p>
              {!isPro && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await startProCheckout(scope);
                      if (r.url) window.location.assign(r.url);
                    })
                  }
                >
                  Upgrade to Pro
                </Button>
              )}
              {isPro && data.plan.effectiveTo && <p style={{ fontSize: 13, color: colors.mutedLight }}>Pro (promotion) until {day(data.plan.effectiveTo)}.</p>}
            </>
          )}
        </div>
      )}
      {data.rewards.enabled && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}`, fontSize: 14 }}>
          <strong>{data.rewards.points.toLocaleString("en-IE")} reward points</strong>
          <span style={{ color: colors.mutedLight }}> · {data.rewards.pointsPerEuro} point per €1 of settled sales{data.rewards.nextExpiry ? ` · some expire on ${day(data.rewards.nextExpiry)}` : ""}</span>
          {data.rewards.debtPoints > 0 && (
            <p style={{ fontSize: 13, color: colors.danger, margin: "6px 0 0" }}>
              {data.rewards.debtPoints.toLocaleString("en-IE")} points are owed from refunded or disputed bookings; they're repaid from your next points before you can redeem.
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            <Button
              variant="ghost"
              disabled={busy || data.rewards.debtPoints > 0 || data.rewards.points < data.rewards.redemptionPoints || !!sub}
              onClick={() => act(() => redeemRewardPoints(scope), "Redeemed — enjoy a month of Pro.")}
            >
              Redeem {data.rewards.redemptionPoints.toLocaleString("en-IE")} points for a month of Pro
            </Button>
          </div>
        </div>
      )}
      {msg && <p role="status" style={{ fontSize: 13, color: msg.ok ? colors.greenText : colors.danger, margin: "10px 0 0" }}>{msg.text}</p>}
    </Card>
  );
}
