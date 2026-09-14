import { Button } from "../ui";
import { CheckIcon } from "../icons";
import { cardImageRatio, colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const REASSURANCE = ["Completely free", "No venue or business needed", "Live in minutes"];

// User-supplied photo, uploaded directly to server/uploads (served statically
// at /uploads/* — see server/src/index.ts) rather than an external stock URL.
const HERO_IMAGE = {
  src: "/uploads/2147807229.avif",
  alt: "A group of volunteers gathered together outdoors",
};

export function HostHero({ onCta }: { onCta: () => void }) {
  return (
    <div>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "28px 24px 40px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "7fr 3fr", gap: 48, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 14 }}>
              <span aria-hidden="true">/</span> For hosts
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
              Host something.
              <br />
              <span style={{ color: FV_ACCENT }}>No venue needed.</span>
            </h1>
            <p style={{ fontSize: 16.5, color: colors.textSoft, lineHeight: 1.6, margin: 0, maxWidth: 560 }}>
              A one-off Game or a standing Circle — a kickabout, a class, a standing group. Pick a time and a
              spot, and it&rsquo;s live. No listing, no business, no approval to start.
            </p>
          </div>

          <div>
            <div style={{ marginBottom: 22 }}>
              <Button variant="orange" onClick={onCta} style={{ padding: "13px 22px", fontSize: 15, background: FV_ACCENT }}>
                Become a Host
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
