import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPayouts, payoutDashboardLink, refreshPayoutAccount, startPayoutOnboarding, type PayoutsOverview } from "../api";
import { colors, fonts, radius } from "../theme";
import { Button, ManageCard as Card, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 5a — the partner's payout account (Stripe Express,
// Stripe-hosted onboarding). Shows what still blocks payouts, transfers
// received, and payouts to the bank. Hidden entirely until finance switches
// Connect on. Copy rule: never "escrow" / "held safely".

const euro = (minor: number) => `€${(Number(minor) / 100).toFixed(2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short" }) : "—");

export function PayoutAccountCard({ scope }: { scope: "vendor" | "host" }) {
  const [data, setData] = useState<PayoutsOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const returning = params.get("payouts");

  useEffect(() => {
    // Coming back from Stripe: re-read the account status straight away.
    const load = returning && returning !== "refresh" ? refreshPayoutAccount(scope).catch(() => fetchPayouts(scope)) : fetchPayouts(scope);
    load.then(setData).catch(() => setData(null));
  }, [scope, returning]);

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

  return (
    <Card style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0 }}>Payout account</h3>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: ready ? colors.greenText : colors.orangeDark }}>{ready ? "Ready for payouts" : "Action needed"}</span>
      </div>
      <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "6px 0 12px", lineHeight: 1.5 }}>
        Payouts are made through Stripe. Transfer eligibility begins after the activity is completed and the review period has passed; settled amounts are transferred weekly and Stripe pays them to your bank.
      </p>
      {!ready && (
        <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
          {data.readiness.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(!data.account || !data.account.detailsSubmitted || data.account.requirementsDue.length > 0) && (
          <Button disabled={busy} onClick={() => go(() => startPayoutOnboarding(scope))}>
            {data.account ? "Continue setup with Stripe" : "Set up payouts with Stripe"}
          </Button>
        )}
        {data.account?.detailsSubmitted && (
          <Button variant="ghost" disabled={busy} onClick={() => go(() => payoutDashboardLink(scope))}>
            Bank details and payouts (Stripe)
          </Button>
        )}
      </div>
      {error && <p role="alert" style={{ color: colors.danger, background: colors.dangerBg, padding: "8px 12px", borderRadius: radius.control, fontSize: 13, marginTop: 10 }}>{error}</p>}
      {(data.transfers.length > 0 || data.payouts.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>TRANSFERS TO YOUR STRIPE ACCOUNT</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Date</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th></tr></thead>
              <tbody>
                {data.transfers.map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{day(t.createdAt)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(t.amountMinor)}{Number(t.reversedMinor) > 0 ? ` (−${euro(t.reversedMinor)} recovered)` : ""}</td>
                    <td style={tdStyle}>{t.status === "created" ? "Sent" : t.status === "reversed" ? "Recovered" : "Partly recovered"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 6 }}>PAYOUTS TO YOUR BANK</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>Arrives</th><th style={thStyle}>Amount</th><th style={thStyle}>Status</th></tr></thead>
              <tbody>
                {data.payouts.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{day(p.arrivalDate)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{euro(p.amountMinor)}</td>
                    <td style={tdStyle}>{p.status}{p.failureMessage ? ` — ${p.failureMessage}` : ""}</td>
                  </tr>
                ))}
                {data.payouts.length === 0 && <tr><td style={tdStyle} colSpan={3}>None yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
