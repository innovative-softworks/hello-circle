import { useEffect, useState } from "react";
import { fetchCirclePlansForManage, fetchMyCircles, fetchMyGames } from "../api";
import { ManageCard as Card } from "./ui";
import { MonthCalendar } from "./MonthCalendar";
import { colors, radius } from "../theme";

// Host Manage spec §12 — a month calendar of everything this resident hosts:
// their own Games plus every plan on a Circle they organise. Month-grid
// only (see plan doc's own trim note — MonthCalendar has no week/agenda
// view and building new grid-rendering code isn't worth it here); the
// Activities/Circles tabs already cover list-style detail and actions.
export function HostCalendarTab() {
  const [items, setItems] = useState<{ date: string; el: React.ReactNode }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const games = await fetchMyGames({ hostedOnly: true }).catch(() => []);
      const gameItems = games
        .filter((g) => g.status !== "cancelled")
        .map((g) => ({
          date: g.date,
          el: (
            <div key={`game-${g.id}`} style={{ display: "flex", justifyContent: "space-between", background: colors.greenBg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
              <span>{g.time} · {g.activityLabel}</span>
              <span style={{ color: colors.greenText, fontWeight: 700 }}>{g.joined}/{g.capacity}</span>
            </div>
          ),
        }));

      const circles = await fetchMyCircles().catch(() => []);
      const organising = circles.filter((c) => c.myRole === "organiser");
      const planLists = await Promise.all(organising.map((c) => fetchCirclePlansForManage(c.id).catch(() => [])));
      const planItems = organising.flatMap((c, i) =>
        planLists[i]
          .filter((p) => p.status !== "cancelled")
          .map((p) => ({
            date: p.date,
            el: (
              <div key={`plan-${p.id}`} style={{ display: "flex", justifyContent: "space-between", background: colors.panel, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
                <span>{p.time} · {p.activityLabel} — {c.name}</span>
                <span style={{ color: colors.muted, fontWeight: 700 }}>{p.joined}/{p.capacity}</span>
              </div>
            ),
          }))
      );

      if (!cancelled) setItems([...gameItems, ...planItems]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <MonthCalendar items={items} />
    </Card>
  );
}
