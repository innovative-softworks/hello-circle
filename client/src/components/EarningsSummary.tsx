import { useEffect, useState } from "react";
import type { PartnerEarnings } from "../api";
import { colors, fonts, radius } from "../theme";
import { FieldHelp } from "./FieldHelp";
import { PayoutAccountCard } from "./PayoutAccountCard";
import { VenueSplitsCard } from "./VenueSplitsCard";
import { PlanRewardsPanel } from "./PlanRewardsPanel";
import { PricingCalculator } from "./PricingCalculator";
import { ManageCard as Card, tableStyle, tdStyle, thStyle } from "./ui";

// Revenue & Connect Stage 3 — a partner's money as the ledger sees it
// (brief §26 partner reports): pending (activity not finished), available
// (completed + review period passed), settled and due, recent settlements.
// Shared by the vendor Earnings tab and the host Earnings tab.

const euro = (minor: number) => `${minor < 0 ? "−" : ""}€${(Math.abs(minor) / 100).toFixed(2)}`;

function Tile({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div style={{ background: colors.panel, borderRadius: radius.control, padding: "12px 14px", flex: "1 1 160px" }}>
      <div style={{ fontSize: 12, color: colors.mutedLight }}>
        {label}
        <FieldHelp helpKey={help} label={label} />
      </div>
      <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, marginTop: 4, color: value < 0 ? colors.danger : colors.text }}>{euro(value)}</div>
    </div>
  );
}

export function EarningsSummary({ load, scope }: { load: () => Promise<PartnerEarnings>; scope: "vendor" | "host" }) {
  const [data, setData] = useState<PartnerEarnings | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    load().then(setData).catch(() => setError(true));
  }, [load]);
  if (error) return null; // the transaction list below still shows; balances need finance access
  if (!data) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
      <PayoutAccountCard scope={scope} />
      <VenueSplitsCard scope={scope} />
      <PlanRewardsPanel scope={scope} variant="full" />
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Your balance</h3>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px" }}>
          Transfer eligibility begins after the activity is completed and the review period has passed. Settled earnings are transferred weekly to your Stripe account; Stripe then pays out to your bank.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Tile label="Pending" value={data.pendingMinor} help="pending_balance" />
          <Tile label="Available" value={data.availableMinor} help="available_balance" />
          <Tile label="Settled — transfer due" value={data.transferDueMinor} help="settled_due" />
          <Tile label="Transferred to your Stripe account" value={data.transferredMinor} help="settled_due" />
        </div>
        {data.settlements.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Settlement</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.settlements.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{s.runKey}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{euro(Number(s.netMinor))}</td>
                    <td style={tdStyle}>{s.status === "due" ? "Transfer due" : s.status === "transferred" ? "Transferred" : s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <PricingCalculator variant="partner" />
    </div>
  );
}
