import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, List } from "lucide-react";
import { fetchCirclePlansForManage, fetchMyCircles, fetchMyGames } from "../api";
import { MonthCalendar } from "./MonthCalendar";
import { AdminButton, Box, IconTabs } from "./admin/adminUi";
import { useUrlParam } from "../useUrlTab";
import { dateLabel } from "../euro";
import { irelandDaysFromToday, irelandToday } from "../irelandDate";
import { colors, radius } from "../theme";

// Host Manage spec §12 — everything this resident hosts: their own Games plus
// every plan on a Circle they organise. A List (next 30 days, the partner
// Calendar's row style) and a Month grid; the Activities/Circles tabs hold
// the actions, so "Manage" goes there.

interface HostItem {
  key: string;
  date: string;
  time: string;
  title: string;
  detail: string;
  joined: number;
  capacity: number;
  kind: "game" | "plan";
  manageTo: string;
}

export function HostCalendarTab() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HostItem[] | null>(null);
  const [view, setView] = useUrlParam<"list" | "month">("cview", "list");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const games = await fetchMyGames({ hostedOnly: true }).catch(() => []);
      const gameItems: HostItem[] = games
        .filter((g) => g.status !== "cancelled")
        .map((g) => ({ key: `game-${g.id}`, date: g.date, time: g.time, title: g.activityLabel, detail: "Session you host", joined: g.joined, capacity: g.capacity, kind: "game", manageTo: "/manage?tab=activities" }));

      const circles = await fetchMyCircles().catch(() => []);
      const organising = circles.filter((c) => c.myRole === "organiser");
      const planLists = await Promise.all(organising.map((c) => fetchCirclePlansForManage(c.id).catch(() => [])));
      const planItems: HostItem[] = organising.flatMap((c, i) =>
        planLists[i]
          .filter((p) => p.status !== "cancelled")
          .map((p) => ({ key: `plan-${p.id}`, date: p.date, time: p.time, title: p.activityLabel, detail: `Circle plan · ${c.name}`, joined: p.joined, capacity: p.capacity, kind: "plan" as const, manageTo: `/manage/circles/${c.slug ?? c.id}` }))
      );

      const all = [...gameItems, ...planItems].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      if (!cancelled) setItems(all);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = irelandToday();
  const end = irelandDaysFromToday(30);
  const upcoming = (items ?? []).filter((i) => i.date >= today && i.date <= end);

  const monthItems = (items ?? []).map((i) => ({
    date: i.date,
    el: (
      <div key={i.key} style={{ display: "flex", justifyContent: "space-between", background: i.kind === "game" ? colors.greenBg : colors.panel, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5 }}>
        <span>
          {i.time} · {i.title}
          {i.kind === "plan" ? ` — ${i.detail.replace("Circle plan · ", "")}` : ""}
        </span>
        <span style={{ fontWeight: 700 }}>
          {i.joined}/{i.capacity}
        </span>
      </div>
    ),
  }));

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <IconTabs
        label="Calendar view"
        value={view}
        onChange={setView}
        items={[
          { key: "list", label: "List", icon: List },
          { key: "month", label: "Month", icon: CalendarDays },
        ]}
      />
      {view === "month" ? (
        <Box flush>
          <div style={{ padding: 16 }}>
            <MonthCalendar items={monthItems} />
          </div>
        </Box>
      ) : items === null ? (
        <div className="ws-line">Loading your calendar…</div>
      ) : upcoming.length === 0 ? (
        <div className="ws-line">
          <CalendarDays size={17} strokeWidth={1.9} aria-hidden="true" />
          <span>
            <strong>Next 30 days:</strong> nothing scheduled.
          </span>
          <AdminButton size="sm" className="ws-line-link" onClick={() => navigate("/games/host?from=manage")}>
            Host a session
          </AdminButton>
        </div>
      ) : (
        <Box title={`Next 30 days · ${upcoming.length}`} flush>
          <ul className="adm-ov-list">
            {upcoming.map((i) => (
              <li key={i.key} className="adm-ov-row ws-sched-row">
                <span className="ws-sched-when">
                  {i.date === today ? "Today" : dateLabel(i.date)} · {i.time}
                </span>
                <div className="adm-ov-main">
                  <div className="adm-ov-title">{i.title}</div>
                  <div className="adm-ov-detail">{i.detail}</div>
                </div>
                <span className="ws-sched-count">
                  <span className="adm-chip">
                    {i.joined}/{i.capacity} going
                  </span>
                </span>
                <span className="adm-chip" data-tone={i.kind === "game" ? "good" : undefined}>
                  {i.kind === "game" ? "Session" : "Circle plan"}
                </span>
                <AdminButton size="sm" onClick={() => navigate(i.manageTo)} aria-label={`Manage ${i.title}`}>
                  Manage
                </AdminButton>
              </li>
            ))}
          </ul>
        </Box>
      )}
    </div>
  );
}
