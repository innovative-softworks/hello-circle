import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarIcon, HeartIcon } from "./icons";
import { Photo } from "./Photo";
import { isFavorite, toggleFavorite } from "../favorites";
import { colors, fonts } from "../theme";
import type { CirclePlanPreview } from "../types";

// Upcoming plan card (reference §11-13) — date/time badge over a photo,
// title, location, participation, availability, price. Plans don't carry
// their own gallery image in this app's data model (see CircleMoments'
// comment on why per-game photos all repeat the venue's own image), so the
// card uses the same tinted placeholder + icon convention as everywhere
// else a Game/Circle photo is optional. The heart re-uses the existing
// generic "game" favourite kind — a Circle plan's `id` is a real game id
// (see CircleDetail.tsx's handleJoinPlan), so this isn't new data, just an
// existing mechanism applied to a card that didn't expose it before.

function dayMonthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()];
  return `${dow} ${d.getDate()} ${mon}`;
}

function spotsCopy(spotsLeft: number): { text: string; color: string } {
  if (spotsLeft === 0) return { text: "Full", color: colors.muted };
  if (spotsLeft === 1) return { text: "1 spot left", color: colors.orangeDark };
  if (spotsLeft <= 3) return { text: `${spotsLeft} spots left`, color: colors.orangeDark };
  return { text: `${spotsLeft} more welcome`, color: colors.greenText };
}

export function CirclePlanCard({ plan }: { plan: CirclePlanPreview }) {
  const navigate = useNavigate();
  const [saved, setSaved] = useState(() => isFavorite("game", plan.id));
  const spots = spotsCopy(plan.spotsLeft);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/games/${plan.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/games/${plan.id}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}
    >
      <Photo
        src={undefined}
        alt={plan.activityLabel}
        ph="repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)"
        icon={<CalendarIcon size={22} />}
        iconColor={colors.green}
        style={{ height: 150 }}
        contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <span style={{ background: "rgba(255,255,255,.92)", color: colors.text, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800, letterSpacing: ".02em" }}>
          {dayMonthLabel(plan.date)} · {plan.time}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSaved(toggleFavorite("game", plan.id));
          }}
          aria-label={saved ? "Remove from saved" : "Save"}
          style={{ background: "rgba(255,255,255,.92)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: saved ? colors.orange : colors.text }}
        >
          <HeartIcon size={14} filled={saved} />
        </button>
      </Photo>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, letterSpacing: "-.005em" }}>{plan.activityLabel}</div>
        <div style={{ fontSize: 13, color: colors.mutedLight }}>{plan.centreName ?? (plan.locationText || "Location TBC")}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: spots.color, marginTop: 2 }}>
          {plan.joined} going · {spots.text}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: plan.priceCents ? colors.text : colors.greenText, marginTop: 4 }}>
          {plan.priceCents ? `€${(plan.priceCents / 100).toFixed(2)}` : "Free"}
        </div>
      </div>
    </div>
  );
}
