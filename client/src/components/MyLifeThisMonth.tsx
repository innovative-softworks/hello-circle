import { colors, fonts } from "../theme";
import type { ParticipationEntry } from "../types";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "This month" (My Life redesign §36-38) — replaces the previous
// multi-month bar chart with a plainer stat block + one contextual
// sentence, so the right rail reads as a quiet summary rather than
// analytics software. Never a competitive comparison (§68) — only real
// counts and, at most, a month-over-month delta.

function personalInsight(entries: ParticipationEntry[], monthEntries: ParticipationEntry[]): string | null {
  const titleCounts = new Map<string, number>();
  for (const e of monthEntries) titleCounts.set(e.title, (titleCounts.get(e.title) ?? 0) + 1);
  const topRepeat = Array.from(titleCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (topRepeat && topRepeat[1] >= 2) return `${topRepeat[0]} is your most repeated activity this month.`;

  const weekdayCounts = new Array(7).fill(0);
  for (const e of entries) weekdayCounts[new Date(`${e.date}T00:00:00`).getDay()] += 1;
  const topWeekdayIdx = weekdayCounts.reduce((best, c, i) => (c > weekdayCounts[best] ? i : best), 0);
  if (weekdayCounts[topWeekdayIdx] >= 3) return `You've been most active on ${WEEKDAY_NAMES[topWeekdayIdx]}s.`;

  return null;
}

export function MyLifeThisMonth({ entries }: { entries: ParticipationEntry[] }) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const monthEntries = entries.filter((e) => e.date >= monthStart && e.date <= today && e.status !== "cancelled");
  if (monthEntries.length === 0) return null;

  const attended = monthEntries.length;
  const distinctActivities = new Set(monthEntries.map((e) => e.title)).size;
  const insight = personalInsight(entries, monthEntries);

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, margin: "0 0 12px" }}>This month</h3>
      <div style={{ display: "flex", gap: 20, marginBottom: insight ? 12 : 0 }}>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>{attended}</div>
          <div style={{ fontSize: 11.5, color: colors.mutedLight, fontWeight: 600 }}>Plan{attended === 1 ? "" : "s"} attended</div>
        </div>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>{distinctActivities}</div>
          <div style={{ fontSize: 11.5, color: colors.mutedLight, fontWeight: 600 }}>Different activit{distinctActivities === 1 ? "y" : "ies"}</div>
        </div>
      </div>
      {insight && <p style={{ margin: 0, fontSize: 12.5, color: colors.mutedLight, lineHeight: 1.4 }}>{insight}</p>}
    </div>
  );
}
