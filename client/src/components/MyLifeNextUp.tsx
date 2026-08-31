import { colors, fonts, radius } from "../theme";

// "Next Up" — the page's primary hero (My Life IA redesign §3). One
// dominant item, not a card grid: whichever of the resident's games/
// bookings/Adventure bookings is soonest. The page normalizes whichever
// entity that turns out to be into this shape (see MyBookings.tsx) so this
// component stays dumb about which underlying table it came from — exactly
// the "entity type is metadata, not a different visual system" rule the
// brief applies to Coming Up too.

export interface NextUpData {
  eyebrow: string;
  title: string;
  subtitle: string;
  going: { joined: number; capacity: number } | null;
  priceLabel: string | null;
  ctaLabel: string;
  onCta: () => void;
}

// A literal one-dot-per-seat row stops being a quick signal and starts being
// noise once capacity gets into double digits (a 12-a-side game shouldn't
// render 12 tiny dots) — cap the row and, above the cap, represent the same
// joined/capacity ratio proportionally instead of literally.
const MAX_DOTS = 8;

export function MyLifeNextUp({ data }: { data: NextUpData }) {
  const dots = data.going
    ? (() => {
        const { joined, capacity } = data.going!;
        const total = Math.max(capacity, joined);
        if (total <= MAX_DOTS) return Array.from({ length: total }, (_, i) => i < joined);
        const filled = capacity > 0 ? Math.round((joined / capacity) * MAX_DOTS) : 0;
        return Array.from({ length: MAX_DOTS }, (_, i) => i < filled);
      })()
    : null;

  return (
    <div style={{ background: colors.dark, borderRadius: radius.card, padding: "clamp(24px,3vw,40px)", color: "#fff", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: "rgba(255,255,255,.6)" }}>/ NEXT UP</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", color: "rgba(255,255,255,.85)" }}>{data.eyebrow}</span>
      </div>

      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.05, fontSize: "clamp(28px,4vw,42px)", margin: "0 0 8px" }}>
        {data.title}
      </h2>
      <div style={{ fontSize: 15, color: "rgba(255,255,255,.72)", marginBottom: 28 }}>{data.subtitle}</div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          {dots && (
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              {dots.map((filled, i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: filled ? "#fff" : "rgba(255,255,255,.28)" }} />
              ))}
            </div>
          )}
          {data.going && (
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,.72)" }}>
              {data.going.joined} of {data.going.capacity} going
            </div>
          )}
          {data.priceLabel && <div style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(255,255,255,.72)" }}>{data.priceLabel}</div>}
        </div>
        <button
          onClick={data.onCta}
          style={{ background: "#fff", color: colors.dark, border: "none", borderRadius: radius.pill, padding: "11px 22px", fontSize: 13, fontWeight: 800, letterSpacing: ".03em", textTransform: "uppercase", cursor: "pointer" }}
        >
          {data.ctaLabel} →
        </button>
      </div>
    </div>
  );
}
