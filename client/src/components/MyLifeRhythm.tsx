import { colors, fonts } from "../theme";
import type { ParticipationEntry } from "../types";

const WEEKS_WINDOW = 8;
const WEEK_MS = 7 * 86400000;

// "Your rhythm" (My Life redesign §23/§24) — active weeks, not a daily
// streak. A daily-login-style streak doesn't fit real-world activities most
// people do once or twice a week, per the spec's own explicit caution.
// Computed entirely from the same real participation-entry dates Recent
// Activity already uses — no new data, no fabricated cadence.

export function MyLifeRhythm({ entries }: { entries: ParticipationEntry[] }) {
  const now = Date.now();
  const weekBuckets = new Set<number>();
  for (const e of entries) {
    const t = new Date(`${e.date}T00:00:00`).getTime();
    const weeksAgo = Math.floor((now - t) / WEEK_MS);
    if (weeksAgo >= 0 && weeksAgo < WEEKS_WINDOW) weekBuckets.add(weeksAgo);
  }
  if (weekBuckets.size === 0) return null;

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
      <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, margin: "0 0 4px" }}>Your rhythm</h3>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: colors.mutedLight }}>
        {weekBuckets.size} active week{weekBuckets.size === 1 ? "" : "s"} in the last {WEEKS_WINDOW}
      </p>
      <div style={{ display: "flex", gap: 5 }}>
        {Array.from({ length: WEEKS_WINDOW }, (_, i) => WEEKS_WINDOW - 1 - i).map((weeksAgo) => (
          <span
            key={weeksAgo}
            title={weeksAgo === 0 ? "This week" : `${weeksAgo} week${weeksAgo === 1 ? "" : "s"} ago`}
            style={{
              width: 20, height: 20, borderRadius: "50%", flex: "none",
              background: weekBuckets.has(weeksAgo) ? colors.green : colors.panel,
            }}
          />
        ))}
      </div>
    </div>
  );
}
