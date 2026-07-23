import { useNavigate, useSearchParams } from "react-router-dom";
import { CloseIcon } from "../components/icons";
import { colors, fonts } from "../theme";

export function PaymentCancel() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ref = searchParams.get("ref");

  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "64px 24px 90px", textAlign: "center" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: colors.orangeBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px", color: colors.orangeDark }}>
          <CloseIcon size={30} />
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 28, margin: "0 0 8px", letterSpacing: "-.02em" }}>Payment cancelled</h1>
        <p style={{ color: colors.muted, fontSize: 16, lineHeight: 1.5, marginBottom: 28 }}>
          No charge was made{ref ? <> — reference <b style={{ color: colors.text }}>{ref}</b></> : null}. You can pick up where you left off whenever you're ready.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => navigate(-1)} style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
          <button onClick={() => navigate("/")} style={{ background: "#fff", color: colors.text, border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: "13px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
            Back home
          </button>
        </div>
      </section>
    </div>
  );
}
