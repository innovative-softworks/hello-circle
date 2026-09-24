import { CalendarIcon, PinIcon, RepeatIcon } from "./icons";
import { Photo } from "./Photo";
import { Avatar } from "./ui";
import { getCircleCoverUrl } from "../media";
import { cardImageRatio, colors, fonts, placeholderStripes } from "../theme";
import type { Circle } from "../types";

// Circle Detail redesign — landscape hero (~16:6.5) with identity overlaid
// top-left. No logo asset exists in this app's data model (residents/
// circles have no photo field beyond the venue-sourced cover image), so the
// "circle logo" slot uses the same Avatar-initials fallback already
// established for organiser portraits (see CircleOrganiserCard) rather than
// inventing one.
//
// Swiss treatment, not soft-UI: the text block's own background, not a
// gradient overlay across the whole photo — a fixed-percentage gradient stop
// is decoupled from actual content height, so a longer tagline/2-line title
// can spill above the "dark" zone into a lighter one (a real contrast bug
// caught here). The block fades in from transparent over a short, fixed
// pixel distance at its own top edge — so it blends into the photo rather
// than cutting a hard seam — then stays solid for the rest of its height,
// which is sized to its own content rather than a guessed percentage. A
// flat rectangular tag instead of a translucent pill+shadow, no drop
// shadows anywhere, near-zero corner radius, and "/"-separated uppercase
// meta — same typographic-label convention as the app's own SectionLabel/
// eyebrow text elsewhere, not a one-off.
//
// Only the avatar sits top-left, alongside the "Active this week" tag
// top-right — both normal flex children, not one absolutely positioned over
// the other, so they can never collide. Name + tagline + meta all live
// together in their own block anchored to the bottom of the photo.

function foundedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
}

export function CircleHero({ circle, activeThisWeek }: { circle: Circle; activeThisWeek: boolean }) {
  const closed = circle.status === "closed";
  const coverSrc = getCircleCoverUrl(circle);

  return (
    <Photo
      src={coverSrc ?? undefined}
      alt={circle.name}
      ph={placeholderStripes.green}
      icon={!coverSrc ? <RepeatIcon size={32} /> : undefined}
      iconColor={colors.green}
      variant="hero"
      eager
      style={{ aspectRatio: cardImageRatio.hero, borderRadius: 2, overflow: "hidden" }}
      contentStyle={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {/* Top row — avatar left, status tag right. No backing block needed:
          the avatar has its own white border and the tag its own solid fill,
          so both already read clearly against the photo. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, padding: "24px 28px 0" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", border: "2px solid #fff", overflow: "hidden", flex: "none" }}>
          <Avatar name={circle.name} size={48} />
        </div>

        {activeThisWeek && (
          <span style={{ display: "inline-block", background: colors.green, borderRadius: 2, padding: "6px 12px", flex: "none" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: ".05em" }}>Active this week</span>
          </span>
        )}
      </div>

      {/* Bottom block — fades in from transparent over a fixed 64px at its
          own top edge (no hard seam against the photo), then solid for the
          rest — sized to its own content, not a guessed percentage, so
          contrast never depends on how many lines the tagline wraps to. */}
      <div
        style={{
          background: "linear-gradient(180deg, rgba(6,8,6,0) 0px, rgba(6,8,6,.86) 56px, rgba(6,8,6,.86) 100%)",
          padding: "62px 32px 28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <h1
            style={{
              fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(30px,4.2vw,44px)", lineHeight: 1.03,
              letterSpacing: "-.02em", color: "#fff", margin: 0,
            }}
          >
            {circle.name}
          </h1>
          {circle.hostVerified && (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: colors.green, color: "#fff", fontSize: 12, fontWeight: 800, flex: "none" }} title="Verified organiser">
              ✓
            </span>
          )}
        </div>
        {circle.about && (
          <p style={{ margin: "0 0 14px", fontSize: 15.5, color: "rgba(255,255,255,.88)", lineHeight: 1.45, maxWidth: 520 }}>
            {circle.about.split(/\n|\. /)[0].replace(/\.+$/, "")}.
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,.8)", textTransform: "uppercase", letterSpacing: ".04em" }}>
          <span>{closed ? "Closed circle" : "Public circle"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ opacity: 0.55 }}>/</span>
            <PinIcon size={12} /> {[circle.area, circle.county].filter(Boolean).join(", ") || "Ireland"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ opacity: 0.55 }}>/</span>
            <CalendarIcon size={12} /> Founded {foundedLabel(circle.createdAt)}
          </span>
        </div>
      </div>
    </Photo>
  );
}
