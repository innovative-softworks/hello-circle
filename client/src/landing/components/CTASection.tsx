import { useNavigate } from "react-router-dom";
import { NETWORK_LABELS } from "../data";
import { lc, lcFonts, lcMaxWidth } from "../theme";

export function CTASection() {
  const navigate = useNavigate();
  return (
    <section style={{ background: lc.ink, padding: "90px 24px", position: "relative", overflow: "hidden" }}>
      <div style={{ maxWidth: lcMaxWidth, margin: "0 auto", position: "relative", zIndex: 1, textAlign: "center" }}>
        <h2 style={{ fontFamily: lcFonts.display, fontSize: "clamp(30px, 4.5vw, 50px)", color: lc.paper, lineHeight: 1.15 }}>
          Your next plan might be closer than you think.
        </h2>
        <p style={{ fontSize: 17, color: "rgba(250,248,242,0.72)", marginTop: 16 }}>See what's happening around you today.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32, flexWrap: "wrap" }}>
          <button className="lc-btn" style={{ background: lc.forest, color: lc.white, padding: "15px 30px", fontSize: 15.5 }} onClick={() => navigate("/explore")}>
            Explore near you
          </button>
          <button
            className="lc-btn"
            style={{ background: "transparent", color: lc.paper, border: `1.5px solid rgba(250,248,242,0.3)`, padding: "15px 30px", fontSize: 15.5 }}
            onClick={() => navigate("/games")}
          >
            Start a plan
          </button>
        </div>
      </div>

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.16,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", gap: 40, flexWrap: "wrap", maxWidth: 900, justifyContent: "center" }}>
          {NETWORK_LABELS.map((label) => (
            <span key={label} className="lc-network-pin" style={{ fontFamily: lcFonts.display, fontSize: 13, fontWeight: 700, color: lc.paper, border: "1px solid rgba(250,248,242,0.3)", borderRadius: 999, padding: "8px 16px" }}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
