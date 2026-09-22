import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyCircles } from "../api";
import { UsersIcon } from "./icons";
import { Button, Card, EmptyState, PageSpinner } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Circle } from "../types";

// HelloCircle Manage — Circles tab body (companion to HostActivitiesTab.tsx),
// rendered as a tab of the combined ManageHome dashboard. Mirrors Vendor's
// own Listings tab → per-listing editor relationship: this tab is a flat
// list of every Circle you organise, and "Manage" on a row still drills
// into that one circle's own Plans/Members/Settings at the existing
// /manage/circles/:id route (ManageCircle.tsx) — unchanged, since a
// specific circle's management is inherently per-entity, not something a
// shared tab can represent (same reason Vendor's centre/club editors are
// their own route, not a Listings sub-tab).

function statusBadge(status: Circle["status"]) {
  return status === "closed" ? (
    <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Closed</span>
  ) : (
    <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>Active</span>
  );
}

export function CirclesTab() {
  const navigate = useNavigate();
  const [circles, setCircles] = useState<Circle[] | null>(null);

  useEffect(() => {
    fetchMyCircles().then(setCircles);
  }, []);

  if (circles === null) return <PageSpinner />;

  const organising = circles.filter((c) => c.myRole === "organiser");

  if (organising.length === 0) {
    return <EmptyState icon={<UsersIcon size={26} />} title="You aren't organising a Circle yet" action={<Button onClick={() => navigate("/circles/start")}>Start a Circle</Button>} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {organising.map((c) => (
        <Card key={c.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                {statusBadge(c.status)}
              </div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
                {c.activityLabel} · {c.members} member{c.members === 1 ? "" : "s"} · {c.plansThisMonth} plan{c.plansThisMonth === 1 ? "" : "s"} this month
              </div>
            </div>
            <Button variant="ghost" onClick={() => navigate(`/manage/circles/${c.slug ?? c.id}`)}>Manage</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
