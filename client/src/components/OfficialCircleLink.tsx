import { useNavigate } from "react-router-dom";
import { colors, radius } from "../theme";
import { UsersIcon } from "./icons";

// "Hosted with {Circle}" (Release 3) — the Activity → Circle link, same pill
// GameDetail already shows for a Circle's own game, for programs,
// experiences and clubs that set an official Circle. Renders nothing when
// there isn't one.
export function OfficialCircleLink({ circleId, circleName, circleSlug }: { circleId?: string | null; circleName?: string | null; circleSlug?: string | null }) {
  const navigate = useNavigate();
  if (!circleId) return null;
  return (
    <button
      onClick={() => navigate(`/circles/${circleSlug ?? circleId}`)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, background: colors.panel, border: "none",
        borderRadius: radius.pill, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer",
      }}
    >
      <UsersIcon size={13} /> Hosted with {circleName || "a Circle"} →
    </button>
  );
}
