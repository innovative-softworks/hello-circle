import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCircleJoinRequests, fetchMyCircles, fetchMyGames } from "../api";
import { AlertTriangle, CalendarClock, UserRoundPlus, Users } from "lucide-react";
import { AttentionQueue, type AttentionItem } from "./workspace/AttentionQueue";
import { dateLabel } from "../euro";
import type { Game } from "../types";
import { irelandDaysFromToday, irelandToday } from "../irelandDate";

// "Needs your attention" (Host Manage spec §4), the resident-Host
// counterpart to VendorAttention.tsx — same "lead straight into the
// resolution, not a generic notification" idea, sourced from data
// ActivitiesTab/CirclesTab already fetch (fetchMyGames/fetchMyCircles),
// plus one existing per-circle endpoint (fetchCircleJoinRequests).

const NEARLY_FULL_WINDOW_DAYS = 7;
const NEARLY_FULL_SPOTS_LEFT = 2;

export function HostAttentionPanel({ residentId, onGoToActivities }: { residentId: string; onGoToActivities: () => void }) {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pendingJoinRequests, setPendingJoinRequests] = useState<{ id: string; slug: string | null; name: string; count: number }[]>([]);
  // A failed join-request check is shown as its own item, never as "nobody waiting".
  const [joinCheckFailed, setJoinCheckFailed] = useState(false);
  const [joinCheckRun, setJoinCheckRun] = useState(0);

  useEffect(() => {
    setFailed(false);
    fetchMyGames({ hostedOnly: true })
      .then(setGames)
      .catch(() => setFailed(true));
  }, [residentId]);

  useEffect(() => {
    setJoinCheckFailed(false);
    fetchMyCircles()
      .then(async (circles) => {
        const organising = circles.filter((c) => c.myRole === "organiser");
        const results = await Promise.all(
          organising.map(async (c) => {
            const requests = await fetchCircleJoinRequests(c.id);
            return { id: c.id, slug: c.slug, name: c.name, count: requests.length };
          })
        );
        setPendingJoinRequests(results.filter((r) => r.count > 0));
      })
      .catch(() => {
        setPendingJoinRequests([]);
        setJoinCheckFailed(true);
      });
  }, [residentId, joinCheckRun]);

  if (failed)
    return (
      <p role="alert" style={{ fontSize: 13.5, margin: 0 }}>
        Couldn't check which activities need you. Refresh the page to try again.
      </p>
    );
  if (games === null) return null;

  const todayIso = irelandToday();
  const windowEndIso = irelandDaysFromToday(NEARLY_FULL_WINDOW_DAYS);

  const nearlyFull = games.filter(
    (g) => g.status === "open" && g.date >= todayIso && g.date <= windowEndIso && g.spotsLeft > 0 && g.spotsLeft <= NEARLY_FULL_SPOTS_LEFT
  );
  const needsPlayers = games.filter((g) => g.status === "pending_participants" && g.date >= todayIso);

  const items: AttentionItem[] = [
    ...nearlyFull.map((g) => ({
      key: `full-${g.id}`,
      icon: CalendarClock,
      title: `${g.activityLabel}: ${g.spotsLeft} spot${g.spotsLeft === 1 ? "" : "s"} left`,
      detail: `${dateLabel(g.date)} · ${g.time} · nearly full`,
      action: { label: "Manage", onClick: onGoToActivities },
    })),
    ...needsPlayers.map((g) => ({
      key: `pending-${g.id}`,
      icon: UserRoundPlus,
      urgent: true,
      title: `${g.activityLabel} still needs players`,
      detail: `${dateLabel(g.date)} · ${g.time} · it only goes ahead with enough people`,
      action: { label: "Manage", onClick: onGoToActivities },
    })),
    ...pendingJoinRequests.map((r) => ({
      key: `join-${r.id}`,
      icon: Users,
      urgent: true,
      title: `${r.count} ${r.count === 1 ? "person" : "people"} waiting to join ${r.name}`,
      detail: "Circle join requests",
      action: { label: "Review", onClick: () => navigate(`/manage/circles/${r.slug ?? r.id}`) },
    })),
    ...(joinCheckFailed
      ? [
          {
            key: "join-check-failed",
            icon: AlertTriangle,
            urgent: true,
            title: "Couldn't check your Circles for join requests",
            detail: "Someone may be waiting to join. Try again, or open each Circle.",
            action: { label: "Try again", onClick: () => setJoinCheckRun((n) => n + 1) },
          },
        ]
      : []),
  ];

  return <AttentionQueue items={items} />;
}
