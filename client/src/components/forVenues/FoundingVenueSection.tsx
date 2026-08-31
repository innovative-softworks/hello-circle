import { Button } from "../ui";
import { colors, fonts, radius } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const HELP_US_UNDERSTAND = [
  "How availability should work",
  "What people need before booking",
  "How local activities use spaces",
  "What venue managers need to manage listings effectively",
];

// Same vetted-crop Unsplash convention as VendorHero.tsx/Home.tsx — a real
// club court, not a placeholder, since this is the live app (not the CSP-
// restricted artifact preview this section's layout was drafted against).
const PHOTO = {
  src: "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=1000&q=75&auto=format&fit=crop",
  alt: "A tennis match in progress on a clay court",
};

export function FoundingVenueSection({ onCta }: { onCta: () => void }) {
  return (
    <section className="section-pad" style={{ borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }}>
      <div className="grid-responsive" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 48, alignItems: "start" }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 10 }}>
            <span aria-hidden="true">/</span> Founding venues
          </div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.2vw, 36px)", lineHeight: 1.05, letterSpacing: "-.02em", margin: "0 0 16px", maxWidth: 420 }}>
            Help shape HelloCircle in your area.
          </h2>
          <p style={{ fontSize: 15, color: colors.textSoft, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 440 }}>
            We're working with local venues and activity providers to make it easier for people to find places
            to do things nearby. Early partners can help us understand:
          </p>
          <div style={{ borderTop: `1px solid ${colors.border}`, marginBottom: 24 }}>
            {HELP_US_UNDERSTAND.map((h, i) => (
              <div key={h} style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: 14, color: colors.text, padding: "12px 0", borderBottom: `1px solid ${colors.border}` }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 12, color: FV_ACCENT, flex: "none" }}>{String(i + 1).padStart(2, "0")}</span>
                {h}
              </div>
            ))}
          </div>
          <Button variant="orange" onClick={onCta} style={{ background: FV_ACCENT }}>
            Become an early venue partner
          </Button>
        </div>
        <div style={{ position: "relative" }}>
          <img src={PHOTO.src} alt={PHOTO.alt} style={{ width: "100%", height: 340, objectFit: "cover", borderRadius: radius.card, display: "block" }} />
          <div style={{ position: "absolute", top: 0, left: 20, right: 20, height: 3, background: FV_ACCENT, borderRadius: "0 0 3px 3px" }} />
        </div>
      </div>
    </section>
  );
}
