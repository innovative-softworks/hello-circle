import { ArrowRightIcon, AwardIcon, BuildingIcon } from "../icons";
import { Button } from "../ui";
import { colors, fonts } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

// Swiss/editorial fork, matching this page's own dominant visual language
// (giant numerals + thin rule dividers, same as VendorHowItWorks) rather
// than a boxed SaaS-comparison-card treatment — flat, one accent color,
// huge type doing the work instead of icons/shadows/colored fills. Sits in
// the page's one full-bleed dark band (replacing VendorDifference's "Be
// where local plans start" pitch entirely, not just visually — the fork
// itself is the stronger, more concrete argument for why the page needs
// two CTAs in the first place).
const PATHS = [
  {
    n: "01",
    icon: BuildingIcon,
    eyebrow: "Have a venue?",
    title: "List it as a business.",
    detail: "A community centre or sports club — get discovered, manage availability and take real bookings.",
    cta: "List your venue",
    variant: "orange" as const,
  },
  {
    n: "02",
    icon: AwardIcon,
    eyebrow: "Just hosting?",
    title: "Start something yourself.",
    detail: "A one-off Game or a standing Circle — free, live in minutes, no venue or business required.",
    cta: "Become a Host",
    variant: "ghost" as const,
  },
];

export function ChooseYourPathSection({ onListVenueCta, onBecomeHostCta }: { onListVenueCta: () => void; onBecomeHostCta: () => void }) {
  const handlers = [onListVenueCta, onBecomeHostCta];

  return (
    <section style={{ background: colors.dark }}>
      <div className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "80px 24px" }}>
        <div style={{ marginBottom: 56 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 12 }}>
            <span style={{ color: FV_ACCENT }}>/</span> Choose your path
          </div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(36px, 5.4vw, 64px)", lineHeight: 0.98, letterSpacing: "-.03em", color: "#fff", margin: 0 }}>
            Neither path
            <br />
            needs the other.
          </h2>
        </div>

        <div className="stack-mobile" style={{ display: "flex", gap: 0 }}>
          {PATHS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  padding: i === 0 ? "0 48px 0 0" : "0 0 0 48px",
                  borderLeft: i === 1 ? "1px solid rgba(255,255,255,.15)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
                  <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 64, letterSpacing: "-.02em", color: "rgba(255,255,255,.18)", lineHeight: 1 }}>
                    {p.n}
                  </span>
                  <span style={{ color: FV_ACCENT, display: "flex" }}>
                    <Icon size={28} />
                  </span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: FV_ACCENT, marginBottom: 12 }}>
                  {p.eyebrow}
                </div>
                <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3vw, 34px)", letterSpacing: "-.01em", color: "#fff", margin: "0 0 16px" }}>
                  {p.title}
                </h3>
                <p style={{ fontSize: 16, color: "rgba(255,255,255,.72)", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 420 }}>{p.detail}</p>
                <div style={{ marginTop: "auto" }}>
                  {p.variant === "orange" ? (
                    <Button variant="orange" onClick={handlers[i]} style={{ padding: "14px 24px", fontSize: 15.5, background: FV_ACCENT, display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {p.cta}
                      <ArrowRightIcon size={15} />
                    </Button>
                  ) : (
                    <button
                      onClick={handlers[i]}
                      style={{
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 15.5,
                        padding: "14px 24px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        background: "transparent",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,.4)",
                        cursor: "pointer",
                      }}
                    >
                      {p.cta}
                      <ArrowRightIcon size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
