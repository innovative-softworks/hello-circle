import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchBookingStatus, fetchRegistrationStatus } from "../api";
import { useMyStuff } from "../MyStuffContext";
import { CheckIcon, ClockIcon } from "../components/icons";
import { colors, fonts } from "../theme";

const POLL_MS = 1500;
const MAX_ATTEMPTS = 12;

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMyStuff();
  const ref = searchParams.get("ref");
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "failed" | "notfound">("checking");
  const attempts = useRef(0);

  useEffect(() => {
    if (!ref) {
      setStatus("notfound");
      return;
    }
    const fetchStatus = ref.startsWith("CR-") ? fetchRegistrationStatus : fetchBookingStatus;
    let cancelled = false;

    const poll = () => {
      fetchStatus(ref)
        .then((r) => {
          if (cancelled) return;
          if (r.paymentStatus === "paid") {
            setStatus("paid");
            refresh();
          } else if (r.paymentStatus === "failed") {
            setStatus("failed");
          } else if (attempts.current < MAX_ATTEMPTS) {
            attempts.current += 1;
            setTimeout(poll, POLL_MS);
          } else {
            setStatus("pending");
          }
        })
        .catch(() => !cancelled && setStatus("notfound"));
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [ref, refresh]);

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
        {status === "checking" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.panel, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.muted }}>
              <ClockIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>Confirming your payment…</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5 }}>This only takes a moment. Reference: <b style={{ color: colors.text }}>{ref}</b></p>
          </>
        )}

        {status === "paid" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.greenBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.green }}>
              <CheckIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 32, margin: "0 0 8px", letterSpacing: "-.02em" }}>You're all set!</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
              Payment confirmed and a receipt is on its way to your email. Reference: <b style={{ color: colors.text }}>{ref}</b>
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => navigate("/bookings")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
                View my bookings
              </button>
              <button onClick={() => navigate("/")} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
                Back home
              </button>
            </div>
          </>
        )}

        {status === "pending" && (
          <>
            <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.panel, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.muted }}>
              <ClockIcon size={32} />
            </div>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>Still confirming</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
              Your payment is taking a little longer to confirm than usual. It'll show up in "My Life" as soon as it's through — reference <b style={{ color: colors.text }}>{ref}</b>.
            </p>
            <button onClick={() => navigate("/bookings")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Check my bookings
            </button>
          </>
        )}

        {(status === "failed" || status === "notfound") && (
          <>
            <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>We couldn't confirm that</h1>
            <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
              {status === "failed" ? "That payment didn't go through — no charge was made." : "We couldn't find that booking reference."}
            </p>
            <button onClick={() => navigate("/")} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
              Back home
            </button>
          </>
        )}
      </section>
    </div>
  );
}
