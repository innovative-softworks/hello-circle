import { Button } from "../ui";
import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH, FV_MONO } from "./constants";

export function HostFinalCTA({ onPrimaryCta }: { onPrimaryCta: () => void }) {
  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px 56px" }}>
        <div
          className="stack-mobile"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 24, marginBottom: 44 }}
        >
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 10 }}>
              <span aria-hidden="true">/</span> Ready when you are
            </div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 3vw, 32px)", color: "#fff", margin: "0 0 8px", letterSpacing: "-.01em" }}>
              Get your first Game or Circle live.
            </h2>
            <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 15.5, maxWidth: 440, lineHeight: 1.6 }}>
              Free, no venue, live in minutes — sign in and you're ready to go.
            </p>
          </div>
          <div>
            <Button variant="orange" onClick={onPrimaryCta} style={{ padding: "13px 24px", fontSize: 15, background: FV_ACCENT }}>
              Become a Host
            </Button>
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,.15)", paddingTop: 20 }}>
          <div
            className="stack-mobile"
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              fontFamily: FV_MONO,
              fontSize: 11.5,
              letterSpacing: ".04em",
              color: "rgba(255,255,255,.5)",
              marginBottom: 8,
            }}
          >
            <span>HELLOCIRCLE.IE · IRELAND</span>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", fontFamily: FV_MONO, fontSize: 11.5, letterSpacing: ".04em", cursor: "pointer", padding: 0 }}
            >
              BACK TO TOP ↑
            </button>
          </div>
          <h3
            style={{
              fontFamily: fonts.display,
              fontWeight: 800,
              fontSize: "clamp(48px, 10vw, 130px)",
              lineHeight: 0.88,
              letterSpacing: "-.03em",
              color: FV_ACCENT,
              margin: 0,
            }}
          >
            Let&rsquo;s host this.
          </h3>
        </div>
      </div>
    </section>
  );
}
