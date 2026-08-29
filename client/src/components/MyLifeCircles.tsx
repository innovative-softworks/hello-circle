import { useNavigate } from "react-router-dom";
import { CalendarIcon, RepeatIcon } from "./icons";
import { Avatar } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// My Life redesign §13 — each card answers "what's happening next?", not
// just membership count. myRole comes from GET /circles/mine specifically
// (see circles.ts's own comment — role is relative to the viewer, so no
// other Circle fetch carries it).

export function MyLifeCircles({ circles }: { circles: Circle[] }) {
  const navigate = useNavigate();
  if (circles.length === 0) return null;

  return (
    <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      {circles.slice(0, 6).map((c) => (
        <button
          key={c.id}
          onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
          style={{ textAlign: "left", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", flex: "none" }}>
              <Avatar name={c.name} size={38} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.myRole === "organiser" ? colors.orangeDark : colors.mutedLight, textTransform: "uppercase", letterSpacing: ".03em" }}>
                  {c.myRole === "organiser" ? "Organiser" : "Member"}
                </span>
                <span style={{ fontSize: 11, color: colors.faint }}>· {c.members} member{c.members === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
          {c.nextPlan ? (
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10, fontSize: 12.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, color: colors.mutedLight, fontWeight: 700, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 3 }}>
                <CalendarIcon size={11} /> Next
              </div>
              <div style={{ fontWeight: 700 }}>{dateLabel(c.nextPlan.date)} · {c.nextPlan.time}</div>
              <div style={{ color: colors.mutedLight, marginTop: 1 }}>{c.nextPlan.joined} going</div>
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10, fontSize: 12.5, color: colors.faint, display: "flex", alignItems: "center", gap: 5 }}>
              <RepeatIcon size={12} /> Nothing planned yet
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
