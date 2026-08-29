import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGames } from "../api";
import { BallIcon } from "./icons";
import { Photo } from "./Photo";
import { dateLabel } from "../euro";
import { formatParticipantCount } from "../formatters";
import { cardImageRatio, colors, fonts, placeholderStripes } from "../theme";
import type { Game } from "../types";

// "More like this" (Game Detail redesign §27/§28) — ranked, not random:
// same activity first, then same county (the closest proxy this app has to
// real distance — games don't carry their own lat/lng), then soonest date/
// time, with a game that still has open spots ranked above a full one.
// Circle-relationship/user-interest ranking from the spec's own list isn't
// implemented — neither is wired to a resident's circles/interests from
// this page today, and fabricating a "compatibility score" isn't worth it
// for a few extra sort keys.
function rankRelated(games: Game[], current: Game): Game[] {
  return [...games]
    .filter((g) => g.id !== current.id)
    .sort((a, b) => {
      const aSame = a.activityLabel === current.activityLabel ? 0 : 1;
      const bSame = b.activityLabel === current.activityLabel ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
      const aCounty = a.county === current.county ? 0 : 1;
      const bCounty = b.county === current.county ? 0 : 1;
      if (aCounty !== bCounty) return aCounty - bCounty;
      const aFull = a.spotsLeft === 0 ? 1 : 0;
      const bFull = b.spotsLeft === 0 ? 1 : 0;
      if (aFull !== bFull) return aFull - bFull;
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    });
}

function RelatedCard({ game }: { game: Game }) {
  const navigate = useNavigate();
  const full = game.spotsLeft === 0;
  return (
    <button onClick={() => navigate(`/games/${game.id}`)} style={{ flex: "none", width: 220, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
      <Photo
        src={game.imageUrl ?? undefined}
        alt={game.activityLabel}
        ph={placeholderStripes.green}
        icon={<BallIcon size={20} />}
        iconColor={colors.green}
        style={{ aspectRatio: cardImageRatio.discovery, borderRadius: 14, marginBottom: 10 }}
      />
      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>{game.activityLabel}</div>
      <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 4 }}>{game.centreName ?? game.locationText}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: full ? colors.muted : colors.greenText }}>
        {dateLabel(game.date)} · {full ? "Full" : formatParticipantCount(game.joined, game.capacity, "joined")}
      </div>
    </button>
  );
}

export function GameRelated({ game }: { game: Game }) {
  const [related, setRelated] = useState<Game[]>([]);

  useEffect(() => {
    fetchGames()
      .then((rows) => setRelated(rankRelated(rows, game).slice(0, 4)))
      .catch(() => setRelated([]));
  }, [game.id, game.activityLabel, game.county]);

  if (related.length === 0) return null;

  return (
    <div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>More like this</h2>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 6 }}>
        {related.map((g) => (
          <RelatedCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}
