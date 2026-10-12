import { Link } from "react-router-dom";
import { colors, fonts, radius } from "../theme";
import { checkoutRows } from "./booking/checkoutLines";
import { formatCents } from "./booking/quoteLines";
import { RECEIPT_KIND_LABELS, RECEIPT_STATUS, receiptTotalLabel, type ReceiptDetail, type Remote, type StatusTone } from "./commerceDisplay";
import { Button, Drawer, RowSkeleton } from "./ui";

// Commercial UX R2/R3A (C7) — a receipt's detail from GET
// /residents/me/receipts/:ref: the price recorded at purchase, and every refund
// (card and credit shown separately). Explicitly not a VAT invoice — that waits
// on the VAT model decision.

const TONE: Record<StatusTone, { color: string; background: string }> = {
  ok: { color: colors.greenText, background: colors.greenBg },
  wait: { color: colors.orangeDark, background: colors.orangeBg },
  stop: { color: colors.danger, background: colors.dangerBg },
  neutral: { color: colors.muted, background: colors.panel },
};

export function ToneChip({ tone, children }: { tone: StatusTone; children: string }) {
  return (
    <span style={{ ...TONE[tone], fontSize: 12, fontWeight: 700, borderRadius: radius.pill, padding: "3px 10px", whiteSpace: "nowrap" }}>{children}</span>
  );
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const sectionTitle = { fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase" as const, color: colors.faint, margin: "0 0 10px" };

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14.5, color: muted ? colors.mutedLight : colors.text, fontWeight: strong ? 700 : 400 }}>
      <dt>{label}</dt>
      <dd style={{ margin: 0, whiteSpace: "nowrap" }}>{value}</dd>
    </div>
  );
}

export function ReceiptBody({ r }: { r: ReceiptDetail }) {
  const status = RECEIPT_STATUS[r.status];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} data-testid="receipt-detail" data-status={r.status}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: 0, lineHeight: 1.2 }}>{r.label}</h3>
          <ToneChip tone={status.tone}>{status.label}</ToneChip>
        </div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight }}>
          {RECEIPT_KIND_LABELS[r.kind]} · {dateTime(r.createdAt)}
        </div>
        <div style={{ fontSize: 13.5, color: colors.mutedLight }}>
          Reference <strong style={{ color: colors.text, fontFamily: "monospace" }}>{r.ref}</strong>
        </div>
      </div>

      <section aria-labelledby={`rc-price-${r.ref}`}>
        <h4 id={`rc-price-${r.ref}`} style={sectionTitle}>What you paid</h4>
        {r.breakdown ? (
          <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {checkoutRows({ ...r.breakdown, payAtVenue: r.status === "pay_at_venue" }, r.subtotalLabel).map((row) => (
              <div key={row.key} style={row.emphasis === "total" ? { borderTop: `1px solid ${colors.border}`, paddingTop: 8 } : undefined}>
                <Line
                  label={row.key === "total" ? receiptTotalLabel(r.status, r.breakdown!.creditCents > 0) : row.label}
                  value={`${row.negative ? "−" : ""}${formatCents(row.cents)}`}
                  strong={row.emphasis === "total"}
                  muted={row.emphasis === "muted"}
                />
              </div>
            ))}
          </dl>
        ) : (
          <>
            <dl style={{ margin: 0 }}>
              <Line label={receiptTotalLabel(r.status, false)} value={formatCents(r.totalCents)} strong />
            </dl>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: colors.mutedLight }}>Only the total was recorded for this purchase, so there's no line-by-line breakdown.</p>
          </>
        )}
        {r.breakdown?.vatIncluded && r.breakdown.vatCents > 0 && (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: colors.mutedLight }}>
            Price includes {r.breakdown.vatLabel} of {formatCents(r.breakdown.vatCents)}.
          </p>
        )}
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: colors.mutedLight }}>This is a payment receipt, not a VAT invoice.</p>
      </section>

      {r.refunds.length > 0 && (
        <section aria-labelledby={`rc-refunds-${r.ref}`}>
          <h4 id={`rc-refunds-${r.ref}`} style={sectionTitle}>Refunds</h4>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {r.refunds.map((f) => (
              <li key={f.id} style={{ background: colors.panel, borderRadius: radius.control, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 4 }}>
                  {dateTime(f.at)}
                  {f.reason ? ` · ${f.reason}` : ""}
                  {f.status === "processing" ? " · processing" : ""}
                </div>
                <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {f.cardCents > 0 && <Line label="Back to your card" value={`−${formatCents(f.cardCents)}`} />}
                  {f.creditCents > 0 && <Line label="Back as HelloCircle credit" value={`−${formatCents(f.creditCents)}`} />}
                </dl>
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: colors.mutedLight, lineHeight: 1.45 }}>Card refunds usually show on your statement within 5–10 working days.</p>
        </section>
      )}

      {typeof r.netPaidCents === "number" && r.refunds.length > 0 && (
        <dl style={{ margin: 0, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
          <Line label="Paid after refunds" value={formatCents(r.netPaidCents)} strong />
        </dl>
      )}

      {r.status === "pending" && (
        <p role="status" style={{ margin: 0, fontSize: 13.5, background: colors.orangeBg, color: colors.orangeDark, padding: "10px 12px", borderRadius: radius.control }}>
          We're still waiting for the payment provider to confirm this payment. Don't pay again.
        </p>
      )}
      {r.status === "failed" && (
        <p style={{ margin: 0, fontSize: 13.5, background: colors.dangerBg, color: colors.danger, padding: "10px 12px", borderRadius: radius.control }}>
          This payment didn't go through, so nothing was charged.
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 14 }}>
        <Link to="/bookings" style={{ fontWeight: 700, color: colors.text }}>
          View in My Life
        </Link>
        <Link to="/complaints" style={{ fontWeight: 700, color: colors.text }}>
          Question about this payment?
        </Link>
      </div>
    </div>
  );
}

export function ReceiptDrawer({ open, onClose, receipt, onRetry }: { open: boolean; onClose: () => void; receipt: Remote<ReceiptDetail>; onRetry?: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Receipt">
      <div aria-live="polite" aria-busy={receipt.status === "loading" || undefined}>
        {receipt.status === "loading" && (
          <div aria-label="Loading receipt">
            <RowSkeleton />
          </div>
        )}
        {receipt.status === "error" && (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <strong>We couldn't load this receipt</strong>
            <span style={{ color: colors.muted, fontSize: 14 }}>{receipt.error}</span>
            {onRetry && (
              <Button variant="ghost" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
                Try again
              </Button>
            )}
          </div>
        )}
        {receipt.status === "ready" && <ReceiptBody r={receipt.data} />}
      </div>
    </Drawer>
  );
}
