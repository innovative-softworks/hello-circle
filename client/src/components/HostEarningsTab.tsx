import { useEffect, useState } from "react";
import { fetchHostGameEarnings } from "../api";
import type { HostGameEarning } from "../api";
import { CardIcon } from "./icons";
import { ManageCard as Card, EmptyState, PageSpinner, tableStyle, thStyle, tdStyle } from "./ui";
import { colors, fonts } from "../theme";

// Vendor-parity pass, Phase 24 — a Host equivalent of PaymentsPanel
// (VendorOrg.tsx), scoped to paid Games instead of bookings/registrations.
// No payout/Stripe Connect concept exists for either surface — this is a
// read-only transaction list, same as Vendor's.
export function HostEarningsTab() {
  const [rows, setRows] = useState<HostGameEarning[] | null>(null);

  useEffect(() => {
    fetchHostGameEarnings().then(setRows);
  }, []);

  if (rows === null) return <PageSpinner />;

  const totalCents = rows.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

  return (
    <Card>
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 22, marginBottom: 4 }}>€{(totalCents / 100).toFixed(2)}</div>
      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 18 }}>Total received from paid players across your sessions</div>
      {rows.length === 0 ? (
        <EmptyState icon={<CardIcon size={22} />} title="No paid sessions yet" subtitle="Once someone pays to join one of your priced sessions, it'll show up here." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Session</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Player</th>
                <th style={thStyle}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.gameId}-${r.participantName}-${i}`}>
                  <td style={tdStyle}>{r.activityLabel}</td>
                  <td style={{ ...tdStyle, color: colors.mutedLight }}>{r.date}</td>
                  <td style={tdStyle}>{r.participantName}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>€{((r.amountCents ?? 0) / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
