import { CommunityIllustration, SportsIllustration } from "./illustrations";

/** A lightweight decorative banner used on the Browse page (and Home's
 * category cards) — soft blob backdrop behind a hand-built SVG illustration. */
export function BrowseIllustration({ accent }: { accent: "green" | "orange" }) {
  const isGreen = accent === "green";
  const blob = isGreen ? "rgba(30,122,76,.12)" : "rgba(232,98,42,.12)";

  return (
    <div
      className="hide-mobile"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 520,
        aspectRatio: "2.4 / 1",
        borderRadius: 22,
        overflow: "hidden",
        flex: "none",
      }}
    >
      <div style={{ position: "absolute", top: -30, right: -24, width: 120, height: 120, borderRadius: "50%", background: blob }} />
      <div style={{ position: "absolute", bottom: -34, left: -20, width: 105, height: 105, borderRadius: "50%", background: blob }} />
      {/* soft clouds, matching the reference hero backdrop */}
      <div style={{ position: "absolute", top: 16, left: 28, width: 46, height: 22, borderRadius: 20, background: "#fff", opacity: 0.55 }} />
      <div style={{ position: "absolute", top: 24, left: 60, width: 30, height: 16, borderRadius: 16, background: "#fff", opacity: 0.5 }} />
      <div style={{ position: "absolute", top: 12, right: 40, width: 40, height: 20, borderRadius: 18, background: "#fff", opacity: 0.55 }} />
      <div style={{ position: "absolute", top: 22, right: 20, width: 26, height: 14, borderRadius: 14, background: "#fff", opacity: 0.5 }} />
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {isGreen ? <CommunityIllustration /> : <SportsIllustration />}
      </div>
    </div>
  );
}

