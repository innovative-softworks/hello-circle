import { useState } from "react";
import { ChevronRightIcon } from "../icons";
import { colors, fonts, radius } from "../../theme";
import { FV_ACCENT, FV_MAX_WIDTH } from "./constants";

const TYPES: { title: string; blurb: string; examples?: string; photo: string; alt: string }[] = [
  {
    title: "Sports & activity venues",
    blurb: "Courts, pitches, halls and facilities.",
    examples: "Badminton · Football · Tennis",
    photo: "https://images.unsplash.com/photo-1571019613914-85f342c6a11e?w=1000&q=75&auto=format&fit=crop",
    alt: "Weight training at the gym",
  },
  {
    title: "Community centres",
    blurb: "Spaces for local groups, classes and activities.",
    photo: "https://images.unsplash.com/photo-1600965962102-9d260a71890d?w=1000&q=75&auto=format&fit=crop",
    alt: "Swimming laps at a community pool",
  },
  {
    title: "Outdoor & adventure providers",
    blurb: "Guides, instructors and activity providers.",
    photo: "https://images.unsplash.com/photo-1551632811-561732d1e306?w=1000&q=75&auto=format&fit=crop",
    alt: "A group hiking a mountain trail",
  },
  {
    title: "Studios & class hosts",
    blurb: "Yoga, dance, fitness and workshops.",
    photo: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1000&q=75&auto=format&fit=crop",
    alt: "Evening yoga by the sea",
  },
  {
    title: "Cafés & social spaces",
    blurb: "Places suitable for meetups and local gatherings.",
    photo: "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=1000&q=75&auto=format&fit=crop",
    alt: "Friends meeting up over coffee",
  },
];

export function ProviderTypeGrid({ onLearnMore }: { onLearnMore: () => void }) {
  const [active, setActive] = useState(0);
  const current = TYPES[active];

  return (
    <section className="section-pad" style={{ maxWidth: FV_MAX_WIDTH, margin: "0 auto", padding: "64px 24px" }}>
      <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 40, alignItems: "start" }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 8 }}>
            <span style={{ color: FV_ACCENT }}>/</span> Who it's for
          </div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.2vw, 38px)", letterSpacing: "-.02em", margin: "0 0 32px" }}>
            Places and people that make things happen.
          </h2>
          <div style={{ borderTop: `1px solid ${colors.border}` }}>
          {TYPES.map((t, i) => {
            const isActive = i === active;
            return (
              <button
                key={t.title}
                onClick={onLearnMore}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                className="link-accent"
                style={{
                  display: "block",
                  width: "100%",
                  background: "none",
                  border: "none",
                  borderBottom: `1px solid ${colors.border}`,
                  padding: "20px 0",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
                  <span
                    style={{
                      fontFamily: fonts.display,
                      fontWeight: 800,
                      fontSize: 19,
                      color: isActive ? FV_ACCENT : colors.text,
                      textDecoration: isActive ? "underline" : "none",
                      textDecorationThickness: 2,
                      textUnderlineOffset: 5,
                    }}
                  >
                    {t.title}
                  </span>
                  <span style={{ color: isActive ? FV_ACCENT : colors.faint, display: "flex", justifySelf: "end", flex: "none" }}>
                    <ChevronRightIcon size={16} />
                  </span>
                </span>
                <span
                  className="for-venues-type-row-detail"
                  style={{ display: isActive ? "block" : "none", fontSize: 14, color: colors.textSoft, lineHeight: 1.5, marginTop: 8, maxWidth: 460 }}
                >
                  {t.blurb}
                  {t.examples && <span style={{ color: colors.faint }}> — {t.examples}</span>}
                </span>
              </button>
            );
          })}
          </div>
        </div>

        <div className="for-venues-type-photo-col" style={{ position: "relative" }}>
          <img
            key={current.photo}
            src={current.photo}
            alt={current.alt}
            style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: radius.card, display: "block" }}
          />
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              right: 16,
              background: "rgba(20,22,20,.55)",
              backdropFilter: "blur(6px)",
              borderRadius: radius.control,
              padding: "10px 14px",
              color: "#fff",
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: 14.5,
            }}
          >
            {current.title}
          </div>
        </div>
      </div>
    </section>
  );
}
