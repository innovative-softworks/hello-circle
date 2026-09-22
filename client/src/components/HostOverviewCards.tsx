import { useNavigate } from "react-router-dom";
import { deriveActivityStatus } from "../activityStatus";
import { CalendarIcon, PinIcon } from "./icons";
import { Photo } from "./Photo";
import { Button, Card, ProgressBar } from "./ui";
import { colors, fonts, placeholderStripes } from "../theme";
import type { Game } from "../types";

// Host Experience Polish — "Next Up" hero + "Upcoming activities" cards for
// ManageHome.tsx's Overview tab, replacing the flat text-row list
// HostDashboardPanel.tsx used to render there (that component stays in the
// codebase, just unused now — same "don't delete, it might be useful
// again" convention this project already follows for the fuzzy Circle-
// upcoming logic). Both components are pure presentation over the same
// `Game[]` ManageHome.tsx already needs to fetch for the greeting summary —
// no new endpoint.

function StatusBadge({ game }: { game: Game }) {
  const s = deriveActivityStatus(game);
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, borderRadius: 999, padding: "2px 8px", flex: "none" }}>{s.label}</span>;
}

export function HostNextUpHero({ game, onManage }: { game: Game; onManage: () => void }) {
  const navigate = useNavigate();
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <Photo src={game.imageUrl ?? undefined} alt={game.activityLabel} ph={placeholderStripes.green} style={{ width: 220, minHeight: 170, flex: "none" }} />
        <div style={{ flex: "1 1 260px", minWidth: 240, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight }}>NEXT UP</span>
            <StatusBadge game={game} />
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{game.activityLabel}</div>
          <div style={{ fontSize: 13, color: colors.muted, marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <CalendarIcon size={13} /> {game.date} · {game.time}
            </span>
            {(game.centreName || game.locationText) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <PinIcon size={13} /> {game.centreName ?? game.locationText}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 240, marginBottom: 16 }}>
            <ProgressBar occupied={game.joined} capacity={game.capacity} style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: colors.mutedLight, flex: "none" }}>{game.joined}/{game.capacity} going</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={onManage}>Manage activity</Button>
            <Button variant="ghost" onClick={() => navigate(`/games/${game.id}`)}>View →</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function HostUpcomingList({ games, onManage }: { games: Game[]; onManage: () => void }) {
  const navigate = useNavigate();
  if (games.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {games.map((g) => (
        <Card key={g.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }} onClick={() => navigate(`/games/${g.id}`)}>
          <div style={{ minWidth: 180 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14 }}>{g.activityLabel}</span>
              <StatusBadge game={g} />
            </div>
            <div style={{ fontSize: 12, color: colors.mutedLight }}>
              {g.date} · {g.time} · {g.centreName ?? (g.locationText || "No venue set")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
            <ProgressBar occupied={g.joined} capacity={g.capacity} style={{ width: 90 }} />
            <span style={{ fontSize: 12, color: colors.mutedLight }}>{g.joined}/{g.capacity}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={onManage}>
                Manage
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
