import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

// Dark full-bleed band, same treatment ChooseYourPathSection uses — giant
// numerals, one accent color, huge type, no icon circles/cards. The two
// real things a resident can host (see server's five participant-tracking
// tables) — not an invented third category.
const TYPES: { n: string; title: string; detail: string }[] = [
  { n: "01", title: "A Game", detail: "A one-off — a kickabout, a class, a pickup match. Pick a time and a headcount, live immediately." },
  { n: "02", title: "A Circle", detail: "A standing group that meets on its own schedule — open, approval, or invite-only, your call." },
];

export function HostWhatSection() {
  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 12 }}>
            <span style={{ color: FV_ACCENT }}>/</span> What you can host
          </div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(36px, 5.4vw, 64px)", lineHeight: 0.98, letterSpacing: "-.03em", color: "#fff", margin: 0 }}>
            Two shapes.
            <br />
            Same starting point.
          </h2>
        </div>

        <div className="stack-mobile" style={{ display: "flex", gap: 0 }}>
          {TYPES.map((t, i) => (
            <div
              key={t.n}
              style={{
                flex: 1,
                padding: i === 0 ? "0 48px 0 0" : "0 0 0 48px",
                borderLeft: i === 1 ? "1px solid rgba(255,255,255,.15)" : "none",
              }}
            >
              <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 80, letterSpacing: "-.02em", color: "rgba(255,255,255,.18)", lineHeight: 1, marginBottom: 20 }}>
                {t.n}
              </div>
              <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3vw, 34px)", letterSpacing: "-.01em", color: "#fff", margin: "0 0 16px" }}>
                {t.title}
              </h3>
              <p style={{ fontSize: 16, color: "rgba(255,255,255,.72)", lineHeight: 1.6, margin: 0, maxWidth: 400 }}>{t.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
