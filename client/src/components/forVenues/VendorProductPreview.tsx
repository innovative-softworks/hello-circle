import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

// A full-width typographic statement rather than a boxed dashboard mock —
// the mock UI card (rooms/availability rows) read as a shrunken screenshot
// next to this page's other poster-scale sections, so the message now
// carries entirely through type instead.
export function VendorProductPreview() {
  return (
    <section className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 14 }}>
        <span style={{ color: FV_ACCENT }}>/</span> Made to be simple
      </div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(32px, 5.4vw, 58px)", lineHeight: 1.02, letterSpacing: "-.03em", margin: "0 0 20px" }}>
        Your place, without <span style={{ color: FV_ACCENT }}>the admin headache.</span>
      </h2>
      <p style={{ fontSize: 17, color: colors.textSoft, lineHeight: 1.55, margin: 0, maxWidth: 720 }}>
        One dashboard covers availability, pricing, facilities, bookings and your listing itself — updated any time,
        all in one place.
      </p>
    </section>
  );
}
