import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchGamesPage } from "../api";
import { BallIcon, PinIcon } from "./icons";
import { Button } from "./ui";
import { CardArrow, ListingCard } from "./ListingCard";
import { CardDate, gameCardLabel } from "./CardDate";
import { dateLabel } from "../euro";
import { formatParticipantCount } from "../formatters";
import { colors, fonts, placeholderStripes } from "../theme";
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
  const href = `/games/${game.id}`;
  // Design-system consistency pass: the shared ListingCard shape.
  return (
    <div style={{ flex: "none", width: 260, display: "flex" }}>
      <ListingCard
        href={href}
        title={game.activityLabel}
        image={game.imageUrl}
        ph={placeholderStripes.green}
        icon={<BallIcon size={20} />}
        iconColor={colors.orange}
        tag={dateLabel(game.date)}
        kicker={game.taxonomy?.subcategoryName ?? game.taxonomy?.categoryName ?? false}
        dateOn={<CardDate date={game.date} time={game.time} label={gameCardLabel(game)} href={href} onGo={navigate} />}
        status={full ? { label: "Full", tone: "calm" } : null}
        details={[{ icon: <PinIcon size={13} />, text: game.centreName ?? game.locationText }]}
        facts={<span>{full ? "Full" : formatParticipantCount(game.joined, game.capacity, "joined")}</span>}
        action={
          <CardArrow label={`View activity: ${game.activityLabel}`} onClick={() => navigate(href)} />
        }
      />
    </div>
  );
}

export function GameRelated({ game }: { game: Game }) {
  const [related, setRelated] = useState<Game[]>([]);

  useEffect(() => {
    // HC-QA-074/101 — two small server-filtered candidate sets (same
    // activity, then same county) instead of the whole public list.
    let live = true;
    (async () => {
      const exact = await fetchGamesPage({ category: game.activityLabel, limit: 12 }).then((p) => p.items).catch(() => [] as Game[]);
      // Category system — same subcategory (e.g. any badminton, whatever the title says).
      const sub = game.taxonomy?.subcategorySlug;
      const sameKind = sub ? await fetchGamesPage({ subcategorySlug: sub, limit: 12 }).then((p) => p.items).catch(() => [] as Game[]) : [];
      const same = [...new Map([...exact, ...sameKind].map((g) => [g.id, g])).values()];
      const others = same.filter((g) => g.id !== game.id);
      const nearby = others.length >= 4 || !game.county ? [] : await fetchGamesPage({ county: game.county, limit: 12 }).then((p) => p.items).catch(() => [] as Game[]);
      const merged = [...new Map([...same, ...nearby].map((g) => [g.id, g])).values()];
      if (live) setRelated(rankRelated(merged, game).slice(0, 4));
    })();
    return () => { live = false; };
  }, [game.id, game.activityLabel, game.county, game.taxonomy?.subcategorySlug]);

  if (related.length === 0) return null;

  return (
    <div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>More like this</h2>
      <div className="lc-grid--b" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 6 }}>
        {related.map((g) => (
          <RelatedCard key={g.id} game={g} />
        ))}
      </div>
    </div>
  );
}
