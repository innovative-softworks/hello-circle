import { useEffect, useState } from "react";
import { fetchCircleMembers } from "../api";
import { Card, ParticipantStack } from "./ui";
import { colors, fonts } from "../theme";
import type { Circle } from "../types";

// Right-rail "Members" card — relocated from a full-width main-content
// section into the rail (real member names/avatars only, same privacy
// stance as before: never email/phone/hidden fields). "See all" expands the
// same list in place (?full=1), same behaviour as the section it replaces.

export function CircleMembersCard({ circle }: { circle: Circle }) {
  const [names, setNames] = useState<{ residentId: string; name: string; role: string }[]>([]);
  const [total, setTotal] = useState(circle.members);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchCircleMembers(circle.id)
      .then((r) => {
        setNames(r.members);
        setTotal(r.total);
      })
      .catch(() => {});
  }, [circle.id]);

  if (total === 0) return null;

  const overflow = Math.max(0, total - names.length);

  const handleSeeAll = () => {
    setExpanded(true);
    fetchCircleMembers(circle.id, true)
      .then((r) => setNames(r.members))
      .catch(() => {});
  };

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 16, margin: 0, letterSpacing: "-.01em" }}>
          {total.toLocaleString()} member{total === 1 ? "" : "s"}
        </h3>
        {!expanded && overflow > 0 && (
          <button onClick={handleSeeAll} style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}>
            See all
          </button>
        )}
      </div>
      <p style={{ margin: "4px 0 14px", fontSize: 13, color: colors.mutedLight }}>
        {circle.activityLabel ? `From first-timers to regulars of ${circle.activityLabel.toLowerCase()}.` : "A real, active local community."}
      </p>
      <ParticipantStack
        people={names.map((m) => ({ id: m.residentId, name: m.name, title: m.role === "organiser" ? `${m.name} · Organiser` : m.name }))}
        overflow={expanded ? 0 : overflow}
        size={34}
        expanded={expanded}
      />
    </Card>
  );
}
