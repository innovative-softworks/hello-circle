import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonCheckout, type AbandonState } from "../api";
import { BkButton, BookingSurface, ConfirmationPanel } from "../components/booking";

// Booking UX Phase 3 (UX plan S7). Backing out of the payment page releases
// the guest's 30-minute hold straight away (server: routes/checkoutAbandon.ts,
// which never releases a paid or completing session), so "Try again" goes
// back to the listing's booking form — where the draft is restored — instead
// of browser history (Stripe's abandoned page).

type View = "releasing" | AbandonState | "error";

export function PaymentCancel() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ref = searchParams.get("ref");
  const [view, setView] = useState<View>(ref ? "releasing" : "error");
  const [retryPath, setRetryPath] = useState<string | null>(null);

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    abandonCheckout(ref)
      .then((r) => {
        if (cancelled) return;
        setRetryPath(r.retryPath);
        setView(r.state);
      })
      .catch(() => !cancelled && setView("error"));
    return () => {
      cancelled = true;
    };
  }, [ref]);

  if (view === "paid" || view === "processing") {
    return (
      <BookingSurface page>
        <ConfirmationPanel
          variant="pending"
          title="Your payment went through"
          bookingRef={ref}
          lead="It looks like the payment completed before you left the page, so there's nothing to redo."
          actions={<BkButton variant="dark" onClick={() => navigate(`/payment/success?ref=${encodeURIComponent(ref ?? "")}`)}>See your booking</BkButton>}
        />
      </BookingSurface>
    );
  }

  const lead =
    view === "releasing"
      ? "No charge was made. Releasing your place…"
      : view === "released"
        ? "No charge was made, and your place has been released — you can book it again now."
        : view === "not_pending"
          ? "No charge was made."
          : "No charge was made. If you try again straight away, your place may stay held for up to 30 minutes.";

  return (
    <BookingSurface page>
      <ConfirmationPanel
        variant="cancelled"
        bookingRef={ref}
        lead={<span role="status">{lead}</span>}
        actions={
          <>
            {retryPath && (
              <BkButton variant="dark" onClick={() => navigate(retryPath)}>
                Try again
              </BkButton>
            )}
            <BkButton variant="secondary" onClick={() => navigate("/home")}>
              Back home
            </BkButton>
          </>
        }
      />
    </BookingSurface>
  );
}
