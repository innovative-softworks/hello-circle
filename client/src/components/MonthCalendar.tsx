import { useState, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { colors, fonts } from "../theme";

// My Life calendar grid view (IA spec §9) — a real month grid over whatever
// dated rows the caller already has (bookings/games today; nothing new is
// fetched here). Support external calendar sync (Google/Apple/Outlook) is a
// separate, still-absent gap — this is just an in-app view, not an export.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthCalendar({ items }: { items: { date: string; el: ReactNode }[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const base = new Date();
  const viewMonth = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const firstDow = viewMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const monthKey = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = new Date().toISOString().slice(0, 10);

  const byDate = new Map<string, number>();
  for (const item of items) byDate.set(item.date, (byDate.get(item.date) ?? 0) + 1);

  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const dayItems = selectedDate ? items.filter((i) => i.date === selectedDate) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => setMonthOffset((m) => m - 1)} aria-label="Previous month" style={{ background: colors.panel, border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronLeftIcon size={14} />
        </button>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}</span>
        <button onClick={() => setMonthOffset((m) => m + 1)} aria-label="Next month" style={{ background: colors.panel, border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronRightIcon size={14} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {DOW_LABELS.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: colors.faint, padding: "4px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const dateStr = `${monthKey}-${String(day).padStart(2, "0")}`;
          const count = byDate.get(dateStr) ?? 0;
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(count > 0 ? (isSelected ? null : dateStr) : null)}
              style={{
                aspectRatio: "1",
                border: isToday ? `1.5px solid ${colors.green}` : "1px solid transparent",
                borderRadius: 10,
                background: isSelected ? colors.green : count > 0 ? colors.greenBg : "transparent",
                color: isSelected ? "#fff" : colors.text,
                cursor: count > 0 ? "pointer" : "default",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12.5,
                fontWeight: count > 0 ? 700 : 500,
                padding: 0,
              }}
            >
              {day}
              {count > 0 && <span style={{ fontSize: 9, marginTop: 1 }}>{"•".repeat(Math.min(count, 3))}</span>}
            </button>
          );
        })}
      </div>
      {selectedDate && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {dayItems.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.faint }}>Nothing on this day.</p>
          ) : (
            dayItems.map((i, idx) => <div key={idx}>{i.el}</div>)
          )}
        </div>
      )}
    </div>
  );
}
