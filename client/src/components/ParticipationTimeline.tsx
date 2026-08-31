import { colors, fonts } from "../theme";

// "Coming Up" — one chronological timeline mixing plans/bookings/Adventures
// (My Life IA redesign §5/§6), editorial rows rather than a card grid, with
// the date as the strong typographic anchor and the entity type demoted to
// a small metadata label. The user's mental model is "what am I doing?",
// not "which table did this come from?" — so PLAN/BOOKING/ADVENTURE never
// get their own visual system, just a label.

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function splitDate(iso: string): { dow: string; day: number; mon: string } {
  const d = new Date(`${iso}T00:00:00`);
  return { dow: DOW[d.getDay()], day: d.getDate(), mon: MON[d.getMonth()] };
}

export interface TimelineRow {
  key: string;
  date: string;
  kind: "PLAN" | "BOOKING" | "ADVENTURE";
  title: string;
  subtitle: string;
  meta?: string;
  actionLabel: string;
  onAction: () => void;
}

export function ParticipationTimelineRow({ row }: { row: TimelineRow }) {
  const { dow, day, mon } = splitDate(row.date);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "18px 0" }}>
      <div style={{ flex: "none", width: 54, textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: colors.faint }}>{dow}</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 24, letterSpacing: "-.01em", lineHeight: 1.1 }}>{day}</div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: colors.faint }}>{mon}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.title}
        </div>
        <div style={{ fontSize: 13, color: colors.mutedLight, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.subtitle}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
          <span style={{ fontWeight: 700, letterSpacing: ".04em", color: colors.mutedLight }}>{row.kind}</span>
          {row.meta && <span style={{ color: colors.faint }}>· {row.meta}</span>}
        </div>
      </div>
      <button
        onClick={row.onAction}
        style={{ flex: "none", background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}
      >
        {row.actionLabel} →
      </button>
    </div>
  );
}

export function ParticipationTimeline({ rows }: { rows: TimelineRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      {rows.map((row, i) => (
        <div key={row.key} style={{ borderTop: i === 0 ? "none" : `1px solid ${colors.border}` }}>
          <ParticipationTimelineRow row={row} />
        </div>
      ))}
    </div>
  );
}
