import { useEffect, useState } from "react";
import { fetchGameParticipants } from "../api";
import { Avatar } from "./ui";
import { colors, fonts } from "../theme";
import type { Game } from "../types";

// "Who's going" (Game Detail redesign §13) — a HelloCircle-specific section:
// this is what makes a plan feel like real people, not a database record.
// Own fetch (GET /:id/participants) rather than piggybacking on the game
// response, since the participant list is a distinct, name-only, privacy-
// reviewed endpoint (see that route's own comment in routes/games.ts) —
// never email/phone/exact address.

export function GameParticipants({ game }: { game: Game }) {
  const [names, setNames] = useState<{ residentId: string; name: string }[]>([]);
  const [total, setTotal] = useState(game.joined);

  useEffect(() => {
    fetchGameParticipants(game.id)
      .then((r) => {
        setNames(r.participants);
        setTotal(r.total);
      })
      .catch(() => {});
  }, [game.id]);

  if (total === 0) return null;

  const overflow = Math.max(0, total - names.length);
  const needed = game.status === "pending_participants" ? Math.max(0, (game.minParticipants ?? 0) - game.joined) : 0;

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: 0 }}>Who's going</h2>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: colors.muted }}>{game.joined} / {game.capacity} joined</span>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {names.map((p, i) => (
          <div key={p.residentId} style={{ marginLeft: i === 0 ? 0 : -10, border: `2px solid ${colors.surface}`, borderRadius: "50%" }}>
            <Avatar name={p.name} size={36} />
          </div>
        ))}
        {overflow > 0 && (
          <div
            style={{
              marginLeft: -10, width: 36, height: 36, borderRadius: "50%", border: `2px solid ${colors.surface}`, background: colors.panel,
              color: colors.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flex: "none",
            }}
          >
            +{overflow}
          </div>
        )}
      </div>
      {needed > 0 && (
        <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: colors.orangeDark }}>
          {needed === 1 ? "Only 1 more person needed!" : `Only ${needed} more people needed!`}
        </div>
      )}
    </div>
  );
}
