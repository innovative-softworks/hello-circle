import { useNavigate } from "react-router-dom";
import { Button } from "./ui";
import { colors, fonts } from "../theme";

// "What do you want to do next?" (My Life redesign v2 §54) — ties the hub back
// to HelloCircle's demand engine. Not IntentCaptureForm here: that
// component is built around one specific activityLabel (its copy literally
// reads "I'm interested in {activity}"), which doesn't fit a page-level,
// not-activity-specific prompt — so this links to Search (the existing
// natural-language "what do you feel like doing" entry point) instead of
// fabricating a generic intent-submission form. Search itself is now
// Explore's Results Mode (Search.tsx was merged into Explore.tsx).

export function MyLifeDiscoveryCTA() {
  const navigate = useNavigate();
  return (
    <div style={{ background: colors.greenBg, borderRadius: 16, padding: "clamp(32px,4vw,52px)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 28 }}>
      <div style={{ maxWidth: 480 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.greenText, letterSpacing: ".08em", marginBottom: 12 }}>/ WHAT NEXT?</div>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px,3.4vw,38px)", letterSpacing: "-.02em", lineHeight: 1.08, margin: "0 0 10px", color: colors.greenText }}>
          What do you want to do next?
        </h2>
        <p style={{ margin: 0, color: colors.muted, fontSize: 14.5, lineHeight: 1.4 }}>Tell HelloCircle what you're up for. We'll let you know when something nearby matches.</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={() => navigate("/explore")}>Add my interest</Button>
        <Button onClick={() => navigate("/games")}>Find plans</Button>
      </div>
    </div>
  );
}
