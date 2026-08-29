import { useNavigate } from "react-router-dom";
import { colors, radius } from "../theme";

// "Your interests" (My Life redesign §18) — reads real ResidentFull.interests
// (captured at onboarding, editable there) rather than a decorative tag
// list; these already power search/matching/homepage recommendations, so
// this is a read + edit-link surface, not a new preference system.

export function MyLifeInterests({ interests }: { interests: string[] }) {
  const navigate = useNavigate();
  if (interests.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {interests.map((i) => (
        <span key={i} style={{ background: colors.greenBg, color: colors.greenText, borderRadius: radius.pill, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
          {i}
        </span>
      ))}
      <button
        onClick={() => navigate("/onboarding")}
        style={{ background: "none", border: `1px solid ${colors.borderStrong}`, borderRadius: radius.pill, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: colors.text, cursor: "pointer" }}
      >
        + Add interest
      </button>
    </div>
  );
}
