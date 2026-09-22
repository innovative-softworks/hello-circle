import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMyCircles, fetchMyGames } from "../api";
import { AwardIcon } from "./icons";
import { EmptyState } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Circle, Game } from "../types";

// Lightweight Host dashboard (IA spec §15) — "My hosted activities", not a
// full workspace: every Game/Circle this resident created, in one place,
// distinct from HostApplicationPanel (which is about the verification
// badge itself). Filters the existing /games/mine and /circles/mine
// responses client-side by hostResidentId/createdByResidentId — no new
// server route, since both already include activities this resident hosts
// (the host is auto-joined as a participant/member on create).

export function HostDashboardPanel({ residentId, manageLinks }: { residentId: string; manageLinks?: boolean }) {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [circles, setCircles] = useState<Circle[] | null>(null);

  useEffect(() => {
    fetchMyGames().then(setGames);
    fetchMyCircles().then(setCircles);
  }, []);

  if (games === null || circles === null) return null;

  const hostedGames = games.filter((g) => g.hostResidentId === residentId && g.status !== "cancelled");
  const hostedCircles = circles.filter((c) => c.createdByResidentId === residentId);

  if (hostedGames.length === 0 && hostedCircles.length === 0) return null;

  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <AwardIcon size={16} style={{ color: colors.greenText }} />
        <span style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: 700 }}>My hosted activities</span>
      </div>
      {hostedGames.length === 0 && hostedCircles.length === 0 ? (
        <EmptyState icon={<AwardIcon size={20} />} title="Nothing hosted yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hostedGames.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(manageLinks ? "/manage?tab=activities" : `/games/${g.id}`)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: colors.bg, border: "none", borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", textAlign: "left" }}
            >
              <span>{g.activityLabel} — {g.date}</span>
              <span style={{ color: colors.mutedLight, fontSize: 12 }}>{g.joined}/{g.capacity} joined</span>
            </button>
          ))}
          {hostedCircles.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate(manageLinks ? `/manage/circles/${c.slug ?? c.id}` : `/circles/${c.slug ?? c.id}`)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: colors.bg, border: "none", borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", textAlign: "left" }}
            >
              <span>{c.name}</span>
              <span style={{ color: colors.mutedLight, fontSize: 12 }}>{c.status === "closed" ? "Closed" : "Circle"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
