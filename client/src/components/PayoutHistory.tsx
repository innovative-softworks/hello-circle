import { colors, fonts, radius } from "../theme";
import { formatCents } from "./booking/quoteLines";
import { PAYOUT_STATUS, PAYOUT_TYPE_LABELS, payoutsRestricted, type PayoutHistoryData, type Remote } from "./commerceDisplay";
import { ToneChip } from "./ReceiptDrawer";
import { Button, ManageCard as Card, RowSkeleton, tableStyle, tdStyle, thStyle } from "./ui";

// Commercial UX R2 (P2) — one chronological list of money leaving
// HelloCircle for the partner: transfers (HelloCircle → their Stripe account)
// and bank payouts (Stripe → their bank), always labelled as two different
// things. R3A: fed by GET /{vendor|host}/payout-account `history` (the
// existing transfer and bank-payout records) under PayoutAccountCard, which
// keeps the account status and Stripe controls.

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" }) : "Date to follow");

export function PayoutHistory({
  scope,
  history,
  onRetry,
  onOpenStripe,
  embedded = false,
}: {
  scope: "vendor" | "host";
  history: Remote<PayoutHistoryData>;
  onRetry?: () => void;
  onOpenStripe?: () => void;
  /** Under PayoutAccountCard, which already explains the account state and links to Stripe. */
  embedded?: boolean;
}) {
  return (
    <Card style={{ padding: 20 }}>
      <section aria-labelledby={`payout-history-${scope}`} aria-busy={history.status === "loading" || undefined} data-testid="payout-history">
        <h2 id={`payout-history-${scope}`} style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>
          Payout history
        </h2>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 14px", lineHeight: 1.5 }}>
          A transfer moves settled earnings from HelloCircle to your Stripe account. Stripe then makes a bank payout to you.
        </p>

        {history.status === "loading" && (
          <div aria-label="Loading payout history">
            <RowSkeleton />
          </div>
        )}
        {history.status === "error" && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <strong>We couldn't load your payouts</strong>
            <span style={{ color: colors.muted, fontSize: 14 }}>{history.error}</span>
            {onRetry && (
              <Button variant="ghost" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
                Try again
              </Button>
            )}
          </div>
        )}
        {history.status === "ready" && <HistoryBody data={history.data} onOpenStripe={onOpenStripe} showAccountAlert={!embedded} />}
      </section>
    </Card>
  );
}

function HistoryBody({ data, onOpenStripe, showAccountAlert }: { data: PayoutHistoryData; onOpenStripe?: () => void; showAccountAlert: boolean }) {
  const restricted = showAccountAlert && payoutsRestricted(data.accountState);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-account-state={data.accountState}>
      {restricted && (
        <div role="alert" style={{ background: colors.dangerBg, color: colors.danger, padding: "12px 14px", borderRadius: radius.control, fontSize: 13.5, lineHeight: 1.5, display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Payouts are paused</strong>
          <span>Stripe needs more information before money can reach you. Your earnings are kept and paid once Stripe is satisfied.</span>
          {onOpenStripe && (
            <Button variant="dark" onClick={onOpenStripe} style={{ alignSelf: "flex-start" }}>
              Update details with Stripe
            </Button>
          )}
        </div>
      )}

      {data.items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "14px 16px", lineHeight: 1.5 }} data-testid="payout-history-empty">
          No payouts yet.{" "}
          {data.minimumPayoutCents !== null
            ? `Settled earnings are transferred weekly once they reach ${formatCents(data.minimumPayoutCents)}.`
            : "Settled earnings are transferred weekly once they reach the minimum payout."}
        </p>
      ) : (
        <>
          <div className="hide-mobile" style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{day(i.date)}</td>
                    <td style={tdStyle}>
                      {PAYOUT_TYPE_LABELS[i.type]}
                      {(i.settlementRef || i.bookings) && (
                        <div style={{ fontSize: 12, color: colors.mutedLight }}>
                          {[i.settlementRef && `Settlement ${i.settlementRef}`, i.bookings && `${i.bookings} booking${i.bookings === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {formatCents(i.amountCents)}
                      {i.recoveredCents ? <div style={{ fontSize: 12, fontWeight: 400, color: colors.danger }}>−{formatCents(i.recoveredCents)} recovered</div> : null}
                    </td>
                    <td style={tdStyle}>
                      <ToneChip tone={PAYOUT_STATUS[i.status].tone}>{PAYOUT_STATUS[i.status].label}</ToneChip>
                      {i.failureMessage && <div style={{ fontSize: 12, color: colors.danger, marginTop: 4 }}>{i.failureMessage}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mobile-cards" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.items.map((i) => (
              <li key={i.id} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <strong style={{ fontSize: 16 }}>{formatCents(i.amountCents)}</strong>
                  <ToneChip tone={PAYOUT_STATUS[i.status].tone}>{PAYOUT_STATUS[i.status].label}</ToneChip>
                </div>
                <div style={{ fontSize: 13.5 }}>{PAYOUT_TYPE_LABELS[i.type]}</div>
                <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
                  {[day(i.date), i.settlementRef && `Settlement ${i.settlementRef}`, i.bookings && `${i.bookings} booking${i.bookings === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                </div>
                {i.recoveredCents ? <div style={{ fontSize: 12.5, color: colors.danger }}>−{formatCents(i.recoveredCents)} recovered</div> : null}
                {i.failureMessage && <div style={{ fontSize: 12.5, color: colors.danger }}>{i.failureMessage}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
