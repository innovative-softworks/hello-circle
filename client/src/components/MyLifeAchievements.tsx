import type { ReactNode } from "react";
import { RepeatIcon, StarIcon, UsersIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { Circle, ParticipationEntry } from "../types";

// "Milestones" (My Life redesign v2 §40-41) — de-emphasized vs. the
// previous pass: lives below Saved, capped at 2, never a leaderboard.
// Computed entirely from data the page already has (circles + participation
// history) — nothing fabricated. Only unlocked badges render; if none
// unlock yet, this section simply doesn't appear.

interface Badge {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  fg: string;
  bg: string;
}

export function MyLifeAchievements({ circles, participation }: { circles: Circle[]; participation: ParticipationEntry[] }) {
  const badges: Badge[] = [];

  if (circles.length >= 3) {
    badges.push({ key: "community", icon: <UsersIcon size={16} />, title: "Community spirit", detail: `Active in ${circles.length} Circles`, fg: "#B8548C", bg: "#F7E6EF" });
  }

  const titleCounts = new Map<string, number>();
  for (const e of participation) titleCounts.set(e.title, (titleCounts.get(e.title) ?? 0) + 1);
  const topRepeat = Array.from(titleCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topRepeat && topRepeat[1] >= 3) {
    badges.push({ key: "regular", icon: <RepeatIcon size={16} />, title: "Regular", detail: `Joined ${topRepeat[0]} ${topRepeat[1]} times`, fg: colors.greenText, bg: colors.greenBg });
  }

  const distinctActivities = titleCounts.size;
  if (distinctActivities >= 5) {
    badges.push({ key: "explorer", icon: <StarIcon size={16} />, title: "Explorer", detail: `Tried ${distinctActivities} different activities`, fg: colors.orangeDark, bg: colors.orangeBg });
  }

  const shown = badges.slice(0, 2);
  if (shown.length === 0) return null;

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, margin: "0 0 12px" }}>Milestones</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {shown.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: b.bg, color: b.fg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              {b.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>{b.title}</div>
              <div style={{ fontSize: 11.5, color: colors.mutedLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
