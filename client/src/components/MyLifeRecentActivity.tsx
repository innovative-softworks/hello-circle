import { useNavigate } from "react-router-dom";
import { BallIcon, CalendarIcon, CheckCircleIcon, RepeatIcon, TagIcon } from "./icons";
import { colors, fonts } from "../theme";
import type { ParticipationEntry } from "../types";

// "Recent activity" (My Life redesign §15) — a chronological ledger, not a
// social feed. Built entirely from the existing fetchMyParticipation()
// endpoint (already unifies bookings/registrations/program enrollments/
// games/circles with a real date, sorted desc) — no new backend needed.
// Phrasing stays honest about what's actually known: games/bookings don't
// track confirmed attendance in this feed, so a past-dated join reads as
// "You joined X", not a fabricated "You attended X".

const KIND_ICON: Record<ParticipationEntry["kind"], React.ReactNode> = {
  booking: <CalendarIcon size={14} />,
  registration: <TagIcon size={14} />,
  program_enrollment: <TagIcon size={14} />,
  game: <BallIcon size={14} />,
  circle: <RepeatIcon size={14} />,
};

const KIND_VERB: Record<ParticipationEntry["kind"], string> = {
  booking: "Booked",
  registration: "Registered for",
  program_enrollment: "Enrolled in",
  game: "Joined",
  circle: "Joined the circle",
};

// `date` is the event's own date for games (per fetchMyParticipation's own
// doc comment) — often in the future for an upcoming joined game, not a
// join-action timestamp. A negative day-diff is a real, common case here,
// not an edge case — claiming "X days ago" for a future date would be
// fabricating a timestamp that isn't known, so it gets its own honest label.
function relativeTime(dateIso: string): string {
  const days = Math.round((Date.now() - new Date(`${dateIso}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return "Upcoming";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

const DAY_MS = 86400000;

/** TODAY / THIS WEEK / EARLIER (My Life redesign v2 §27-28) — a plain day-
 * offset grouping (not a new status taxonomy — the underlying entries don't
 * reliably carry hosted/waitlisted state, so this only groups by date,
 * which every entry already has). */
function groupKey(dateIso: string, today: string): "TODAY" | "THIS WEEK" | "EARLIER" {
  const days = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${dateIso}T00:00:00`).getTime()) / DAY_MS);
  if (days === 0) return "TODAY";
  if (days > -7 && days < 7) return "THIS WEEK";
  return "EARLIER";
}

const GROUP_ORDER = ["TODAY", "THIS WEEK", "EARLIER"] as const;
const VISIBLE_LIMIT = 5;

export function MyLifeRecentActivity({ entries, onViewFull }: { entries: ParticipationEntry[]; onViewFull?: () => void }) {
  const navigate = useNavigate();
  if (entries.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const visible = entries.slice(0, VISIBLE_LIMIT);
  const groups = GROUP_ORDER.map((g) => ({ g, rows: visible.filter((e) => groupKey(e.date, today) === g) })).filter((s) => s.rows.length > 0);

  return (
    <div>
      {groups.map(({ g, rows }, gi) => (
        <div key={g} style={{ marginTop: gi === 0 ? 0 : 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: colors.faint, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>{g}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((e, i) => {
              const cancelled = e.status === "cancelled";
              return (
                <button
                  key={`${e.kind}-${e.ref}`}
                  onClick={() => navigate(e.href)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "none", border: "none",
                    borderTop: i === 0 ? "none" : `1px solid ${colors.border}`, padding: "12px 0", cursor: "pointer", opacity: cancelled ? 0.6 : 1,
                  }}
                >
                  <div style={{ flex: "none", width: 30, height: 30, borderRadius: "50%", background: colors.panel, color: colors.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {cancelled ? <CheckCircleIcon size={13} /> : KIND_ICON[e.kind]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {cancelled ? "Cancelled — " : `${KIND_VERB[e.kind]} `}{e.title}
                    </div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{e.subtitle}</div>
                  </div>
                  <div style={{ flex: "none", fontSize: 12.5, color: colors.faint }}>{relativeTime(e.date)}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {entries.length > VISIBLE_LIMIT && onViewFull && (
        <button
          onClick={onViewFull}
          style={{ marginTop: 16, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}
        >
          View full activity →
        </button>
      )}
    </div>
  );
}
