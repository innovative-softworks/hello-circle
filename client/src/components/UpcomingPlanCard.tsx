import { useNavigate } from "react-router-dom";
import { BallIcon, CalendarIcon } from "./icons";
import { Photo } from "./Photo";
import { Button } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game } from "../types";

// My Life redesign §10/§11 — "Your next up" card. Games only: a game
// already carries everything the reference card wants (image, date, joined/
// capacity, a real detail page to land on). Bookings have no equivalent
// detail page or participation headcount, so they render as a plain row
// alongside this grid instead of being forced into the same visual shape
// (see MyBookings.tsx's own comment on this) — "Do not force these into
// identical visual components" per the spec itself.

function spotsCopy(spotsLeft: number, joinedByMe: boolean): { text: string; color: string } {
  if (joinedByMe) return { text: "You're in", color: colors.greenText };
  if (spotsLeft === 0) return { text: "Full", color: colors.muted };
  if (spotsLeft === 1) return { text: "1 spot left", color: colors.orangeDark };
  if (spotsLeft <= 3) return { text: `${spotsLeft} spots left`, color: colors.orangeDark };
  return { text: `${spotsLeft} spots left`, color: colors.mutedLight };
}

function dayMonthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()];
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()];
  return `${dow} ${d.getDate()} ${mon}`;
}

export function UpcomingPlanCard({ game }: { game: Game }) {
  const navigate = useNavigate();
  const spots = spotsCopy(game.spotsLeft, !!game.joinedByMe);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/games/${game.id}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/games/${game.id}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column" }}
    >
      <Photo
        src={game.imageUrl ?? undefined}
        alt={game.activityLabel}
        ph="repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)"
        icon={<BallIcon size={22} />}
        iconColor={colors.green}
        style={{ height: 140 }}
        contentStyle={{ padding: 10, display: "flex", alignItems: "flex-start" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.92)", color: colors.text, borderRadius: radius.pill, padding: "5px 10px", fontSize: 11.5, fontWeight: 800 }}>
          <CalendarIcon size={11} /> {dayMonthLabel(game.date)} · {game.time}
        </span>
      </Photo>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15, letterSpacing: "-.005em" }}>{game.activityLabel}</div>
        <div style={{ fontSize: 13, color: colors.mutedLight }}>{game.centreName ?? (game.locationText || "Location TBC")}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: spots.color, marginTop: 2 }}>
          {game.joined} going · {spots.text}
        </div>
        <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <Button full onClick={() => navigate(`/games/${game.id}`)}>View plan</Button>
        </div>
      </div>
    </div>
  );
}
