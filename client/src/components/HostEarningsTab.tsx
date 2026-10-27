import { fetchHostBalances, fetchHostGameEarnings } from "../api";
import { EarningsSections } from "./EarningsSummary";
import { TraderProfileForm } from "./TraderProfileForm";
import type { HostGameEarning } from "../api";
import { CreditCard } from "lucide-react";
import { EmptyState } from "./ui";
import { Box, Loaded, useAdminData, RowMenu } from "./admin/adminUi";
import { dateLabel } from "../euro";
import { useNavigate } from "react-router-dom";

// Vendor-parity pass, Phase 24 — a Host equivalent of PaymentsPanel
// (VendorOrg.tsx), scoped to paid Games instead of bookings/registrations.
// No payout/Stripe Connect concept exists for either surface — this is a
// read-only transaction list, same as Vendor's.
export function HostEarningsTab() {
  const navigate = useNavigate();
  const state = useAdminData<HostGameEarning[]>(() => fetchHostGameEarnings());
  const totalCents = (state.data ?? []).reduce((sum, r) => sum + (r.amountCents ?? 0), 0);

  return (
    <EarningsSections scope="host" loadBalance={fetchHostBalances} trader={<TraderProfileForm scope="host" defaultEntity="individual" />}>
      <Box
        flush
        icon={CreditCard}
        title={state.data ? `Customer payments · €${(totalCents / 100).toFixed(2)}` : "Customer payments"}
        subtitle="What players paid across your sessions. Your balance above shows what you earn."
      >
        <Loaded state={state} title="Couldn't load your payments">
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState icon={<CreditCard size={20} />} title="No paid sessions yet" subtitle="Once someone pays to join one of your priced sessions, it'll show up here." />
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Customer payments</caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Date</th>
                      <th scope="col">Player</th>
                      <th scope="col" className="adm-num">
                        Amount
                      </th>
                                          <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.gameId}-${r.participantName}-${i}`}>
                        <td data-label="Session">{r.activityLabel}</td>
                        <td data-label="Date">{dateLabel(r.date)}</td>
                        <td data-label="Player">{r.participantName}</td>
                        <td data-label="Amount" className="adm-num" style={{ fontWeight: 700 }}>
                          €{((r.amountCents ?? 0) / 100).toFixed(2)}
                        </td>
                        <td data-label="">
                          <RowMenu name={`${r.participantName}, ${r.activityLabel}`} items={[{ label: "Open activity", onSelect: () => navigate(`/manage?tab=activities&record=activity:${r.gameId}`) }]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Box>
    </EarningsSections>
  );
}
