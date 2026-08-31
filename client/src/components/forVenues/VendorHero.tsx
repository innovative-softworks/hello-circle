import { Button } from "../ui";
import { CheckIcon } from "../icons";
import { cardImageRatio, colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH, FV_MONO } from "./constants";

const REASSURANCE = ["Simple to get started", "Manage your availability", "Reach local people"];

// Reuses the same Unsplash photo already vetted (crop-checked at a wide
// aspect ratio) for Home.tsx's own hero strip — a real five-a-side pitch,
// not a stock "empty building" shot, matching the brief's "show real
// activity" instruction without guessing at an unverified new photo URL.
const HERO_IMAGE = {
  src: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?w=1920&q=75&auto=format&fit=crop",
  alt: "A local five-a-side football match in progress on an outdoor pitch",
};

export function VendorHero({ onPrimaryCta, onSecondaryCta }: { onPrimaryCta: () => void; onSecondaryCta: () => void }) {
  const today = new Date().toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div>
      {/* Utility strip — a small "technical label" beat borrowed from the
          brief's reference (a poster-style top bar), before the page settles
          into its normal editorial rhythm. */}
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "20px 24px 16px" }}>
        <div
          className="stack-mobile"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: FV_MONO,
            fontSize: 11.5,
            letterSpacing: ".04em",
            color: colors.mutedLight,
            borderBottom: `1px solid ${colors.border}`,
            paddingBottom: 16,
          }}
        >
          <span>{today.toUpperCase()} · LISTING PARTNERS</span>
          <a href="mailto:partners@hellocircle.ie" style={{ color: colors.text, fontWeight: 700, textDecoration: "none" }}>
            CONTACT US ↗
          </a>
        </div>
      </div>

      {/* Eyebrow/headline/CTA now leads (moved above the photo per request)
          — the full-bleed image below is the visual payoff after the pitch,
          rather than a banner the copy has to compete with for attention. */}
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "8px 24px 40px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr", gap: 48, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 14 }}>
              <span aria-hidden="true">/</span> For venues & hosts
            </div>
            <h1
              style={{
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: "clamp(38px, 5.6vw, 64px)",
                lineHeight: 0.98,
                letterSpacing: "-.03em",
                margin: "0 0 20px",
              }}
            >
              Get discovered.
              <br />
              Get booked.
              <br />
              <span style={{ color: FV_ACCENT }}>Grow your community.</span>
            </h1>
            <p style={{ fontSize: 16.5, color: colors.textSoft, lineHeight: 1.6, margin: 0, maxWidth: 440 }}>
              Join HelloCircle to showcase your space, fill more available slots and connect with local people
              looking for things to do.
            </p>
          </div>

          <div>
            <div className="stack-mobile" style={{ display: "flex", gap: 12, marginBottom: 22 }}>
              <Button variant="orange" onClick={onPrimaryCta} style={{ padding: "13px 22px", fontSize: 15, background: FV_ACCENT }}>
                List your venue
              </Button>
              <Button variant="ghost" onClick={onSecondaryCta} style={{ padding: "13px 22px", fontSize: 15 }}>
                See how it works
              </Button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {REASSURANCE.map((r) => (
                <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: colors.muted, fontWeight: 600 }}>
                  <span style={{ color: FV_ACCENT, display: "flex", flex: "none" }}>
                    <CheckIcon size={15} />
                  </span>
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full-bleed hero photo — deliberately breaks out of the page's
          FV_MAX_WIDTH container (this <div> sits at <main>'s own full
          width, same as VendorDifference's dark band below) to match the
          brief's reference: an edge-to-edge banner photo, not a boxed
          image beside the headline. `cardImageRatio.hero` (16/6) is the
          app's own existing "wide banner" ratio token. */}
      <div style={{ position: "relative" }}>
        <img
          src={HERO_IMAGE.src}
          alt={HERO_IMAGE.alt}
          style={{ width: "100%", aspectRatio: cardImageRatio.hero, objectFit: "cover", display: "block" }}
        />
        <span className="for-venues-vertical-tag">/ HelloCircle</span>
      </div>
    </div>
  );
}
