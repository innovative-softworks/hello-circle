import { type ReactNode } from "react";
import { BkButton } from "./BookingShell";
import { bk, bkFonts, bkRadius } from "./bookingTheme";
import { cancellationCopy } from "./policy";
import { formatCents, quoteRows, type KitQuote } from "./quoteLines";
import type { QuoteState } from "./useQuote";

// Booking kit — what's being booked, what it costs (server quote only), and
// the cancellation terms. The same blocks appear in the desktop rail, on the
// review step and on the confirmation page.

export function ListingSummary({ title, when, details, imageUrl }: { title: string; when?: string | null; details?: string | null; imageUrl?: string | null }) {
  return (
    <div style={{ background: bk.surface, border: `1px solid ${bk.line}`, borderRadius: bkRadius.card, padding: 16, display: "flex", gap: 14 }}>
      {imageUrl && <img src={imageUrl} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: bkRadius.card, flex: "none" }} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div style={{ fontFamily: bkFonts.display, fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        {when && <div style={{ fontSize: 15 }}>{when}</div>}
        {details && <div style={{ fontSize: 15, color: bk.muted }}>{details}</div>}
      </div>
    </div>
  );
}

function Rows({ quote, subtotalLabel, dimmed }: { quote: KitQuote; subtotalLabel: string; dimmed?: boolean }) {
  const rows = quoteRows(quote, subtotalLabel);
  return (
    <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 10, opacity: dimmed ? 0.55 : 1 }} data-testid="quote-summary">
      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            fontSize: 15,
            color: r.emphasis === "muted" ? bk.muted : bk.ink,
            ...(r.emphasis === "total" ? { paddingTop: 10, borderTop: `1px solid ${bk.ink}` } : null),
          }}
        >
          <dt style={{ fontWeight: r.emphasis === "total" ? 700 : 400 }}>{r.label}</dt>
          <dd style={{ margin: 0, ...(r.emphasis === "total" ? { fontFamily: bkFonts.display, fontSize: 26, fontWeight: 700 } : null) }}>
            {r.negative ? "−" : ""}
            {formatCents(r.cents)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The price, exactly as the server quoted it. While a new quote loads the
 * previous one stays visible but dimmed; on failure there's no price at all
 * (and the submit button should be disabled by the caller). */
export function QuoteSummary<Q extends KitQuote>({ state, subtotalLabel, onRetry, emptyHint = "Choose your options to see the price." }: { state: QuoteState<Q>; subtotalLabel: string; onRetry?: () => void; emptyHint?: string }) {
  return (
    <div aria-live="polite" aria-busy={state.status === "loading" || undefined}>
      {state.status === "idle" && <p style={{ margin: 0, fontSize: 15, color: bk.muted }}>{emptyHint}</p>}
      {state.status === "loading" && !state.quote && (
        <div aria-label="Updating price" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[80, 60, 70].map((w) => (
            <div key={w} className="bk-skeleton" style={{ height: 12, width: `${w}%`, background: bk.skeleton }} />
          ))}
          <div className="bk-skeleton" style={{ height: 22, width: "50%", background: bk.skeleton, marginTop: 6 }} />
        </div>
      )}
      {state.status === "loading" && state.quote && <Rows quote={state.quote} subtotalLabel={subtotalLabel} dimmed />}
      {state.status === "ready" && <Rows quote={state.quote} subtotalLabel={subtotalLabel} />}
      {state.status === "error" && (
        <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 15 }}>
          <div style={{ fontWeight: 700 }}>We couldn't price this</div>
          <div style={{ color: bk.soft }}>{state.error}</div>
          {onRetry && (
            <BkButton variant="secondary" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
              Try again
            </BkButton>
          )}
        </div>
      )}
    </div>
  );
}

export function PolicySummary({ cancelDeadline, depositCents, contact, extra }: { cancelDeadline?: string | null; depositCents?: number; contact?: "venue" | "host" | "organiser" | "club"; extra?: ReactNode }) {
  const copy = cancellationCopy({ cancelDeadline, depositCents, contact });
  return (
    <div style={{ background: bk.panel, borderRadius: bkRadius.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700 }}>{copy.headline}</div>
      {copy.detail && <div style={{ color: bk.soft }}>{copy.detail}</div>}
      {extra}
    </div>
  );
}

export type ConfirmationVariant = "success" | "pending" | "cancelled" | "failed";

const CONFIRMATION_TITLES: Record<ConfirmationVariant, string> = {
  success: "You're booked",
  pending: "Finishing your payment…",
  cancelled: "Payment cancelled",
  failed: "Payment didn't go through",
};

/** The end of every booking flow. Never says "booked" before the server
 * does: `pending` is the state while the payment is still being confirmed. */
export function ConfirmationPanel({
  variant,
  bookingRef,
  title,
  lead,
  summary,
  children,
  actions,
}: {
  variant: ConfirmationVariant;
  bookingRef?: string | null;
  title?: string;
  lead?: ReactNode;
  summary?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby="bk-confirmation-title" style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 64px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div aria-hidden="true" style={{ width: 44, height: 4, background: variant === "success" ? bk.accent : variant === "pending" ? bk.lineStrong : bk.ink }} />
        <h1 id="bk-confirmation-title" style={{ margin: 0, fontFamily: bkFonts.display, fontSize: "clamp(32px, 3.8vw, 52px)", lineHeight: 1.02, fontWeight: 700, letterSpacing: 0 }}>
          {title ?? CONFIRMATION_TITLES[variant]}
        </h1>
        {lead && <p style={{ margin: 0, fontSize: 17, color: bk.soft, lineHeight: 1.45 }} role={variant === "pending" ? "status" : undefined}>{lead}</p>}
        {bookingRef && (
          <div style={{ fontSize: 14, color: bk.muted }}>
            Reference <strong style={{ color: bk.ink, letterSpacing: 0 }}>{bookingRef}</strong>
          </div>
        )}
      </div>
      {summary}
      {children}
      {actions && <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{actions}</div>}
    </section>
  );
}
