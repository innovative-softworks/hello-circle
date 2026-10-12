import { colors, radius } from "../theme";
import { formatCents } from "./booking/quoteLines";
import { REDEMPTION_STATE, type CouponRedemptionsData, type Remote } from "./commerceDisplay";
import { ToneChip } from "./ReceiptDrawer";
import { Button, Drawer, RowSkeleton } from "./ui";

// Commercial UX R2 (P3) — who used one of a partner's codes, from the
// redemption ledger: held (checkout open), used, or returned (unpaid checkout
// or refund). Fixture-only until R3 adds GET /vendor/coupons/:id/redemptions
// (and the host equivalent), scoped to the partner's own codes.

const dateTime = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CouponRedemptionsDrawer({ open, onClose, code, redemptions, onRetry }: { open: boolean; onClose: () => void; code: string; redemptions: Remote<CouponRedemptionsData>; onRetry?: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title={`Code ${code} · uses`}>
      <div aria-live="polite" aria-busy={redemptions.status === "loading" || undefined} data-testid="coupon-redemptions">
        {redemptions.status === "loading" && (
          <div aria-label="Loading uses">
            <RowSkeleton />
          </div>
        )}
        {redemptions.status === "error" && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <strong>We couldn't load the uses of this code</strong>
            <span style={{ color: colors.muted, fontSize: 14 }}>{redemptions.error}</span>
            {onRetry && (
              <Button variant="ghost" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
                Try again
              </Button>
            )}
          </div>
        )}
        {redemptions.status === "ready" && redemptions.data.rows.length === 0 && (
          <p style={{ margin: 0, fontSize: 14, color: colors.muted, background: colors.panel, borderRadius: radius.control, padding: "14px 16px", lineHeight: 1.5 }}>
            Nobody has used this code yet. Share it with your customers — it applies when they enter it at checkout.
          </p>
        )}
        {redemptions.status === "ready" && redemptions.data.rows.length > 0 && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.mutedLight, lineHeight: 1.5 }}>
              "Held" means a checkout is open with this code. A use is returned if that checkout isn't paid or the booking is refunded.
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {redemptions.data.rows.map((r) => {
                const st = REDEMPTION_STATE[r.state];
                return (
                  <li key={r.id} data-state={r.state} style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <strong style={{ fontSize: 15 }}>−{formatCents(r.discountCents)}</strong>
                      <ToneChip tone={st.tone}>{st.label}</ToneChip>
                    </div>
                    <div style={{ fontSize: 13.5 }}>{r.listingName}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
                      {dateTime(r.at)} · <span style={{ fontFamily: "monospace" }}>{r.bookingRef}</span> · {st.help}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
