import { useNavigate } from "react-router-dom";
import { UsersIcon } from "./icons";
import { Button } from "./ui";
import { colors, fonts } from "../theme";

// "What do you want to do next?" (My Life redesign v2 §54) — ties the hub back
// to HelloCircle's demand engine. Not IntentCaptureForm here: that
// component is built around one specific activityLabel (its copy literally
// reads "I'm interested in {activity}"), which doesn't fit a page-level,
// not-activity-specific prompt — so this links to Search (the existing
// natural-language "what do you feel like doing" entry point) instead of
// fabricating a generic intent-submission form.

export function MyLifeDiscoveryCTA() {
  const navigate = useNavigate();
  return (
    <div style={{ background: colors.greenBg, borderRadius: 12, padding: "28px 32px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, maxWidth: 440 }}>
        <div style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: colors.surface, display: "flex", alignItems: "center", justifyContent: "center", color: colors.greenText }}>
          <UsersIcon size={18} />
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: colors.greenText, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>What next?</div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(18px,2.2vw,22px)", margin: "0 0 4px", color: colors.greenText }}>
            What do you want to do next?
          </h2>
          <p style={{ margin: 0, color: colors.muted, fontSize: 13.5 }}>Tell HelloCircle what you're up for. We'll let you know when something nearby matches.</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <Button variant="ghost" onClick={() => navigate("/search")}>Add my interest</Button>
        <Button onClick={() => navigate("/games")}>Find plans</Button>
      </div>
    </div>
  );
}
