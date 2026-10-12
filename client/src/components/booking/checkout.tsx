import { useId, useState, type ReactNode } from "react";
import { BkButton } from "./BookingShell";
import { bk, bkFonts, bkRadius } from "./bookingTheme";
import { checkoutRows, collapsedTotal, creditControlState, type CheckoutQuote } from "./checkoutLines";
import { formatCents } from "./quoteLines";
import type { QuoteState } from "./useQuote";

// Commercial UX R2 (C2) — one checkout summary for paid flows, and the
// customer-credit opt-in. R3A wires it where a server quote carries every
// figure it shows (experiences, programmes); every number is a server field.

function Rows({ quote, subtotalLabel, dimmed }: { quote: CheckoutQuote; subtotalLabel: string; dimmed?: boolean }) {
  return (
    <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 10, opacity: dimmed ? 0.55 : 1 }} data-testid="checkout-summary">
      {checkoutRows(quote, subtotalLabel).map((r) => {
        const total = r.emphasis === "total";
        return (
          <div
            key={r.key}
            data-row={r.key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              fontSize: 15,
              color: r.emphasis === "muted" ? bk.muted : bk.ink,
              ...(total ? { paddingTop: 10, borderTop: `1px solid ${bk.ink}` } : null),
            }}
          >
            <dt style={{ fontWeight: total ? 700 : 400 }}>{r.label}</dt>
            <dd style={{ margin: 0, whiteSpace: "nowrap", ...(total ? { fontFamily: bkFonts.display, fontSize: 26, fontWeight: 700 } : null) }}>
              {r.negative ? "−" : ""}
              {formatCents(r.cents)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The unified price summary. `collapsible` is the phone variant: a total bar
 * that expands to the full breakdown (plan C2). `notice` carries a server
 * re-price explanation (a 409 at checkout: "your total is now …"), shown
 * above the rows and announced.
 */
export function CheckoutSummary({
  state,
  subtotalLabel,
  onRetry,
  collapsible = false,
  notice,
  footnote,
  emptyHint = "Choose your options to see the price.",
}: {
  state: QuoteState<CheckoutQuote>;
  subtotalLabel: string;
  onRetry?: () => void;
  collapsible?: boolean;
  notice?: ReactNode;
  footnote?: ReactNode;
  emptyHint?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const quote = state.quote;
  const creditLeft = quote && typeof quote.creditBalanceAfterCents === "number" && (quote.creditCents ?? 0) > 0 ? quote.creditBalanceAfterCents : null;

  const body = (
    <>
      {notice && (
        <div role="alert" style={{ fontSize: 14, lineHeight: 1.45, fontWeight: 600, background: bk.dangerBg, color: bk.danger, padding: "10px 12px", borderRadius: bkRadius.control, marginBottom: 12 }}>
          {notice}
        </div>
      )}
      {state.status === "idle" && <p style={{ margin: 0, fontSize: 15, color: bk.muted }}>{emptyHint}</p>}
      {state.status === "loading" && !quote && (
        <div aria-label="Updating price" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[80, 60, 70].map((w) => (
            <div key={w} className="bk-skeleton" style={{ height: 12, width: `${w}%`, background: bk.skeleton }} />
          ))}
          <div className="bk-skeleton" style={{ height: 22, width: "50%", background: bk.skeleton, marginTop: 6 }} />
        </div>
      )}
      {(state.status === "ready" || (state.status === "loading" && quote)) && quote && <Rows quote={quote} subtotalLabel={subtotalLabel} dimmed={state.status === "loading"} />}
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
      {creditLeft !== null && state.status === "ready" && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: bk.muted, lineHeight: 1.45 }} data-testid="credit-remaining">
          Credit left after this booking: {formatCents(creditLeft)}. If you cancel or get a refund, the credit part comes back as credit and the card part goes back to your card.
        </p>
      )}
      {footnote}
    </>
  );

  if (!collapsible) {
    return (
      <div aria-live="polite" aria-busy={state.status === "loading" || undefined}>
        {body}
      </div>
    );
  }
  return (
    <div aria-live="polite" aria-busy={state.status === "loading" || undefined} style={{ border: `1px solid ${bk.line}`, background: bk.surface, borderRadius: bkRadius.card }}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((e) => !e)}
        style={{ width: "100%", minHeight: 48, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 14px", background: "transparent", border: "none", color: bk.ink, cursor: "pointer", fontSize: 15, textAlign: "left" }}
      >
        <span style={{ fontWeight: 700 }}>{state.status === "error" ? "Price unavailable" : quote ? collapsedTotal(quote) : state.status === "idle" ? "Price" : "Working out the price…"}</span>
        <span style={{ fontSize: 14, color: bk.muted, whiteSpace: "nowrap" }}>
          {expanded ? "Hide details" : "Show details"} <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </span>
      </button>
      <div id={panelId} hidden={!expanded} style={{ padding: "4px 14px 14px" }}>
        {body}
      </div>
    </div>
  );
}

/**
 * "Use my HelloCircle credit" — opt-in (plan decision U3), never applied
 * silently. Toggling asks the caller to re-quote; the control only explains
 * what the server decided. Never says "points" (that's a partner concept).
 */
export function CreditToggle({
  availableCents,
  expiresAt,
  eligible = true,
  requested,
  appliedCents,
  previouslyAppliedCents,
  onChange,
  busy,
  walletHref = "/profile?section=credit",
}: {
  availableCents: number;
  /** Earliest expiry among the resident's credit lots (server), if any. */
  expiresAt?: string | null;
  eligible?: boolean;
  requested: boolean;
  /** From the current quote: what the server applied (null while unknown). */
  appliedCents: number | null;
  previouslyAppliedCents?: number | null;
  onChange: (requested: boolean) => void;
  busy?: boolean;
  walletHref?: string;
}) {
  const id = useId();
  const state = creditControlState({ availableCents, eligible, requested, appliedCents, previouslyAppliedCents });
  if (state === "unavailable") return null;
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" }) : null;

  if (state === "ineligible") {
    return (
      <div style={{ fontSize: 14, color: bk.muted, lineHeight: 1.45 }} data-credit-state={state}>
        You have {formatCents(availableCents)} HelloCircle credit, but it can't be used for this booking. <a href={walletHref}>About your credit</a>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-credit-state={state}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <input
          id={id}
          type="checkbox"
          checked={requested}
          disabled={busy}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={`${id}-hint`}
          style={{ width: 22, height: 22, margin: "1px 0 0", accentColor: "var(--bk-ink)", flex: "none" }}
        />
        <label htmlFor={id} style={{ fontSize: 15, lineHeight: 1.4, cursor: busy ? "default" : "pointer" }}>
          Use my HelloCircle credit <span style={{ color: bk.muted }}>({formatCents(availableCents)} available)</span>
        </label>
      </div>
      <div id={`${id}-hint`} style={{ paddingLeft: 34, fontSize: 13.5, lineHeight: 1.45, color: bk.muted }} aria-live="polite">
        {state === "applied" && appliedCents !== null && `${formatCents(appliedCents)} of your credit applies to this booking.`}
        {state === "applied" && appliedCents === null && "Updating your total…"}
        {state === "off" && (expiry ? `Earliest credit expires ${expiry}.` : "Credit has no cash value and can't be withdrawn.")}
        {state === "balance_changed" && (
          <span role="alert" style={{ color: bk.danger, fontWeight: 600 }}>
            Your credit balance changed since you started, so less credit applies. Your total has been updated.
          </span>
        )}{" "}
        <a href={walletHref}>View credit</a>
      </div>
    </div>
  );
}
