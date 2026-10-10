import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchFieldHelp, fetchPayouts, payoutDashboardLink, refreshPayoutAccount, startPayoutOnboarding, type FieldHelpEntry, type PayoutAccountState, type PayoutsOverview } from "../api";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 5a — the partner's payout account (Stripe Express,
// Stripe-hosted onboarding). Shows what still blocks payouts, transfers
// received, and payouts to the bank. Hidden entirely until finance switches
// Connect on. Copy rule: never "escrow" / "held safely".
//
// Stage 5e — one explicit account state (server-derived from Stripe), named
// and explained by editable help entries (connect_state_<state>); a transfer
// (HelloCircle → Stripe balance) and a bank payout (Stripe → bank) are shown
// as two separate things, never as one.

const STATE_TONE: Record<PayoutAccountState, "ok" | "wait" | "act" | "stop"> = {
  not_started: "act",
  onboarding_incomplete: "act",
  under_review: "wait",
  more_information_required: "act",
  transfers_unavailable: "stop",
  payouts_unavailable: "wait",
  enabled: "ok",
};
const STATE_KEYS = (Object.keys(STATE_TONE) as PayoutAccountState[]).map((s) => `connect_state_${s}`);

const euro = (minor: number) => `€${(Number(minor) / 100).toFixed(2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short" }) : "—");

export function PayoutAccountCard({ scope }: { scope: "vendor" | "host" }) {
  const [data, setData] = useState<PayoutsOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<Record<string, FieldHelpEntry>>({});
  const [params] = useSearchParams();
  const returning = params.get("payouts");

  useEffect(() => {
    // Stripe's refresh_url means the onboarding link expired or was reused:
    // mint a fresh link and continue straight back to Stripe (Stage 5d).
    if (returning === "refresh") {
      startPayoutOnboarding(scope)
        .then(({ url }) => window.location.assign(url))
        .catch(() => fetchPayouts(scope).then(setData).catch(() => setData(null)));
      return;
    }
    // Coming back from Stripe (return_url): re-read the account status straight away.
    const load = returning === "return" ? refreshPayoutAccount(scope, "return").catch(() => fetchPayouts(scope)) : fetchPayouts(scope);
    load.then(setData).catch(() => setData(null));
  }, [scope, returning]);

  useEffect(() => {
    fetchFieldHelp([...STATE_KEYS, "connect_transfer_vs_payout"])
      .then((rows) => setHelp(Object.fromEntries(rows.map((r) => [r.helpKey, r]))))
      .catch(() => setHelp({}));
  }, []);

  if (!data || !data.enabled) return null;

  const go = async (fn: () => Promise<{ url: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await fn();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open Stripe");
      setBusy(false);
    }
  };
  const ready = data.readiness.length === 0;
  const state: PayoutAccountState = data.state ?? (data.account ? "onboarding_incomplete" : "not_started");
  const tone = STATE_TONE[state];
  const stateHelp = help[`connect_state_${state}`];
  const stateName = stateHelp?.name.replace(/^Payout account:\s*/i, "") ?? state.replace(/_/g, " ");
  const toneColor = tone === "ok" ? colors.greenText : tone === "stop" ? colors.danger : colors.orangeDark;
  const a = data.account;
  const needsStripe = state === "not_started" || state === "onboarding_incomplete" || state === "more_information_required";
  const onStripeLabel = state === "not_started" ? "Set up payouts with Stripe" : state === "more_information_required" ? "Give Stripe the information it needs" : "Continue setup with Stripe";
  const capability = (c: string | undefined) => (c === "active" ? "Active" : c === "pending" ? "Being checked" : "Not yet");

  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0 }}>Payout account</h3>
        <span data-testid="payout-state" data-state={state} style={{ fontSize: 12.5, fontWeight: 700, color: toneColor }}>{stateName}</span>
      </div>
      {stateHelp && <p style={{ fontSize: 13.5, margin: "8px 0 4px", lineHeight: 1.5 }}>{stateHelp.definition}</p>}
      {a && (
        <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", fontSize: 13, margin: "8px 0" }}>
          <dt style={{ color: colors.muted }}>Transfers from HelloCircle</dt>
          <dd style={{ margin: 0, fontWeight: 600 }} data-testid="transfers-capability">{capability(a.transfersCapability)}</dd>
          <dt style={{ color: colors.muted }}>Bank payouts by Stripe</dt>
          <dd style={{ margin: 0, fontWeight: 600 }} data-testid="payouts-capability">{capability(a.payoutsCapability)}</dd>
          {a.requirementsDue.length + a.requirementsPastDue.length > 0 && (
            <>
              <dt style={{ color: colors.muted }}>Stripe needs</dt>
              <dd style={{ margin: 0 }}>{a.requirementsDue.length + a.requirementsPastDue.length} item{a.requirementsDue.length + a.requirementsPastDue.length === 1 ? "" : "s"}</dd>
            </>
          )}
        </dl>
      )}
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "6px 0 12px", lineHeight: 1.5 }}>
        {help.connect_transfer_vs_payout?.definition ?? "Payouts are made through Stripe. Settled amounts are transferred to your Stripe account weekly, and Stripe pays them to your bank."}
      </p>
      {!ready && (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          {data.readiness.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {needsStripe && (
          <Button disabled={busy} onClick={() => go(() => startPayoutOnboarding(scope))}>
            {onStripeLabel}
          </Button>
        )}
        {a && (a.onboardingCompleted || a.detailsSubmitted) && (
          <Button variant="ghost" disabled={busy} onClick={() => go(() => payoutDashboardLink(scope))}>
            Bank details and payouts (Stripe)
          </Button>
        )}
      </div>
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, marginTop: 10 }}>{error}</p>}
      {data.openDebt && (
        <p role="alert" style={{ background: colors.dangerBg, color: colors.danger, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, marginTop: 10 }}>
          €{(data.openDebt.outstandingMinor / 100).toFixed(2)} is owed back to HelloCircle (a refund or chargeback after a transfer). Your earnings are held until it's recovered from earlier transfers or offset by new earnings.
          See the <a href="/policies/payments-fees-payouts" style={{ color: colors.danger, fontWeight: 700 }}>Payments policy</a>.
        </p>
      )}
      {(data.transfers.length > 0 || data.bankPayouts.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>TRANSFERS — HELLOCIRCLE → YOUR STRIPE ACCOUNT</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Date</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th></tr></thead>
              <tbody>
                {data.transfers.map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{day(t.createdAt)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {euro(t.amountMinor)}
                      {Number(t.reversedMinor) > 0 ? ` (−${euro(t.reversedMinor)} recovered)` : ""}
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: colors.mutedLight }}>{t.bookings} booking{Number(t.bookings) === 1 ? "" : "s"}</div>
                    </td>
                    <td style={tdStyle}>{t.status === "created" ? "Sent" : t.status === "reversed" ? "Recovered" : "Partly recovered"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>BANK PAYOUTS — STRIPE → YOUR BANK</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Arrives</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th></tr></thead>
              <tbody>
                {data.bankPayouts.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{day(p.arrivalDate)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(p.amountMinor)}</td>
                    <td style={tdStyle}>{p.status}{p.failureMessage ? ` — ${p.failureMessage}` : ""}</td>
                  </tr>
                ))}
                {data.bankPayouts.length === 0 && <tr><td style={tdStyle} colSpan={3}>None yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
