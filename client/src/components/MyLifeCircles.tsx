import { useNavigate } from "react-router-dom";
import { Avatar } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// My Life IA redesign §8 — editorial rows, not a card grid: each Circle
// answers "what's happening next?" first, membership count demoted to
// small metadata. Capped at 3 (the brief's own "2-3 rows"); no "view all"
// link since there's no dedicated "my Circles only" listing page to send
// it to — real functionality (full membership management) stays reachable
// via each row's own Circle detail page.

export function MyLifeCircles({ circles }: { circles: Circle[] }) {
  const navigate = useNavigate();
  if (circles.length === 0) return null;

  return (
    <div>
      {circles.slice(0, 3).map((c, i) => (
        <button
          key={c.id}
          onClick={() => navigate(`/circles/${c.slug ?? c.id}`)}
          style={{
            display: "flex", alignItems: "center", gap: 16, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
            padding: "18px 0", borderTop: i === 0 ? "none" : `1px solid ${colors.border}`,
          }}
        >
          <Avatar name={c.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {c.name}
            </div>
            <div style={{ fontSize: 12.5, color: colors.faint, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{c.myRole === "organiser" ? "Organiser" : "Member"} · {c.members} member{c.members === 1 ? "" : "s"}</span>
              {/* Manage Circle (Follow/Notify/Stats gap audit) — previously
                  only reachable via the account-menu workspace switcher,
                  easy to miss entirely. An organiser already sees their role
                  right here, so the direct link belongs next to it. */}
              {c.myRole === "organiser" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/manage/circles/${c.slug ?? c.id}`);
                  }}
                  style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}
                >
                  Manage
                </button>
              )}
            </div>
          </div>
          <div style={{ flex: "none", textAlign: "right", maxWidth: 140 }}>
            {c.activePlan ? (
              // Phase 2 "Circles V2" — an explicit plan-idea (real
              // circle_id relationship) takes priority over the fuzzy
              // nextPlan match below when both exist.
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: colors.mutedLight, marginBottom: 2 }}>PLANNING</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.activePlan.title}</div>
              </>
            ) : c.nextPlan ? (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color: colors.mutedLight, marginBottom: 2 }}>NEXT</div>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{dateLabel(c.nextPlan.date)} · {c.nextPlan.time}</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: colors.faint }}>Nothing planned yet</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
