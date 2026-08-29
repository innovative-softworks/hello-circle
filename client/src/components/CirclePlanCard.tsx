import { useNavigate } from "react-router-dom";
import { CalendarIcon } from "./icons";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";
import { colors, fonts, placeholderStripes, radius } from "../theme";
import type { CirclePlanPreview } from "../types";
import { formatCircleAvailability, formatDatePill, formatPrice } from "../formatters";

// Upcoming plan card (reference §11-13) — date/time badge over a photo,
// title, location, participation, availability, price. Plans don't carry
// their own gallery image in this app's data model (see CircleMoments'
// comment on why per-game photos all repeat the venue's own image), so the
// card uses the same tinted placeholder + icon convention as everywhere
// else a Game/Circle photo is optional. The heart re-uses the existing
// generic "game" favourite kind — a Circle plan's `id` is a real game id
// (see CircleDetail.tsx's handleJoinPlan), so this isn't new data, just an
// existing mechanism applied to a card that didn't expose it before.

function spotsCopy(spotsLeft: number): { text: string; color: string } {
  const color = spotsLeft === 0 ? colors.muted : spotsLeft <= 3 ? colors.orangeDark : colors.greenText;
  return { text: formatCircleAvailability(spotsLeft), color };
}

export function CirclePlanCard({ plan }: { plan: CirclePlanPreview }) {
  const navigate = useNavigate();
  const [saved, toggleSaved] = useSavedState("game", plan.id);
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
        ph={placeholderStripes.green}
        icon={<CalendarIcon size={22} />}
        iconColor={colors.green}
        style={{ height: 150 }}
        contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <span style={{ background: "rgba(255,255,255,.92)", color: colors.text, borderRadius: radius.pill, padding: "4px 10px", fontSize: 11, fontWeight: 800, letterSpacing: ".02em" }}>
          {formatDatePill(plan.date)} · {plan.time}
        </span>
        <SaveButton saved={saved} onToggle={toggleSaved} />
      </Photo>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, letterSpacing: "-.005em" }}>{plan.activityLabel}</div>
        <div style={{ fontSize: 13, color: colors.mutedLight }}>{plan.centreName ?? (plan.locationText || "Location TBC")}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: spots.color, marginTop: 2 }}>
          {plan.joined} going · {spots.text}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: plan.priceCents ? colors.text : colors.greenText, marginTop: 4 }}>
          {formatPrice(plan.priceCents)}
        </div>
      </div>
    </div>
  );
}
