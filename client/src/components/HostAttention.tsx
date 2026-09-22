import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCircleJoinRequests, fetchMyCircles, fetchMyGames } from "../api";
import { BellIcon, CalendarIcon, UsersIcon } from "./icons";
import { Button, ManageCard as Card } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game } from "../types";

// "Needs your attention" (Host Manage spec §4), the resident-Host
// counterpart to VendorAttention.tsx — same "lead straight into the
// resolution, not a generic notification" idea, sourced from data
// ActivitiesTab/CirclesTab already fetch (fetchMyGames/fetchMyCircles),
// plus one existing per-circle endpoint (fetchCircleJoinRequests).

const NEARLY_FULL_WINDOW_DAYS = 7;
const NEARLY_FULL_SPOTS_LEFT = 2;

interface AttentionItem {
  key: string;
  icon: React.ReactNode;
  text: string;
  cta: string;
  onClick: () => void;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
        <span style={{ color: colors.orangeDark, flex: "none", display: "flex" }}>{item.icon}</span>
        {item.text}
      </span>
      <Button variant="ghost" style={{ padding: "6px 12px", fontSize: 12, flex: "none" }} onClick={item.onClick}>
        {item.cta}
      </Button>
    </div>
  );
}

export function HostAttentionPanel({ residentId, onGoToActivities }: { residentId: string; onGoToActivities: () => void }) {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<{ id: string; slug: string | null; name: string; count: number }[]>([]);

  useEffect(() => {
    fetchMyGames({ hostedOnly: true }).then(setGames).catch(() => setGames([]));
    fetchMyCircles()
      .then(async (circles) => {
        const organising = circles.filter((c) => c.myRole === "organiser");
        const results = await Promise.all(
          organising.map(async (c) => {
            const requests = await fetchCircleJoinRequests(c.id).catch(() => []);
            return { id: c.id, slug: c.slug, name: c.name, count: requests.length };
          })
        );
        setPendingJoinRequests(results.filter((r) => r.count > 0));
      })
      .catch(() => setPendingJoinRequests([]));
  }, [residentId]);

  if (games === null) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const windowEndIso = new Date(Date.now() + NEARLY_FULL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const nearlyFull = games.filter(
    (g) => g.status === "open" && g.date >= todayIso && g.date <= windowEndIso && g.spotsLeft > 0 && g.spotsLeft <= NEARLY_FULL_SPOTS_LEFT
  );
  const needsPlayers = games.filter((g) => g.status === "pending_participants" && g.date >= todayIso);

  const items: AttentionItem[] = [
    ...nearlyFull.map((g) => ({
      key: `full-${g.id}`,
      icon: <CalendarIcon size={15} />,
      text: `${g.activityLabel} has ${g.spotsLeft} spot${g.spotsLeft === 1 ? "" : "s"} left — ${g.date}`,
      cta: "Manage",
      onClick: onGoToActivities,
    })),
    ...needsPlayers.map((g) => ({
      key: `pending-${g.id}`,
      icon: <CalendarIcon size={15} />,
      text: `${g.activityLabel} still needs players — ${g.date}`,
      cta: "Manage",
      onClick: onGoToActivities,
    })),
    ...pendingJoinRequests.map((r) => ({
      key: `join-${r.id}`,
      icon: <UsersIcon size={15} />,
      text: `${r.count} ${r.count === 1 ? "person" : "people"} waiting to join ${r.name}`,
      cta: "Review",
      onClick: () => navigate(`/manage/circles/${r.slug ?? r.id}`),
    })),
  ];

  if (items.length === 0) return null;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <BellIcon size={16} style={{ color: colors.orangeDark }} />
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Needs your attention</h4>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <AttentionRow key={item.key} item={item} />
        ))}
      </div>
    </Card>
  );
}
