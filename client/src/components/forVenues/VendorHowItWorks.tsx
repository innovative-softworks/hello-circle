import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const STEPS: { n: string; title: string; detail: string }[] = [
  { n: "01", title: "Create your listing", detail: "Add your place, facilities, photos and useful details." },
  { n: "02", title: "Set availability", detail: "Choose when your spaces or activities are available." },
  { n: "03", title: "Get discovered", detail: "People nearby find you while searching for things to do." },
  { n: "04", title: "Receive interest", detail: "Manage enquiries, participation or bookings from one place." },
];

// The one section on this page where Swiss numbering earns its keep — it's
// a real 4-step ordered process, not decoration, unlike the boxed-card
// treatment the rest of the page moved away from.
export function VendorHowItWorks({ id }: { id?: string }) {
  return (
    <section id={id} className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px", borderTop: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 8 }}>
        <span style={{ color: FV_ACCENT }}>/</span> How it works
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.2vw, 38px)", letterSpacing: "-.02em", margin: "0 0 40px" }}>
        Get set up in minutes.
      </h2>
      <div className="stack-mobile" style={{ display: "flex", gap: 0 }}>
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            style={{
              flex: 1,
              padding: i === 0 ? "0 28px 0 0" : "0 28px",
              borderLeft: i === 0 ? "none" : `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 56, letterSpacing: "-.02em", color: colors.borderStrong, lineHeight: 1, marginBottom: 20 }}>
              {s.n}
            </div>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, marginBottom: 7 }}>{s.title}</div>
            <p style={{ fontSize: 13.5, color: colors.muted, lineHeight: 1.5, margin: 0 }}>{s.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
