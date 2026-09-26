import { useState } from "react";
import { postGameUpdate } from "../api";
import { ICEBREAKERS, initialIcebreakerIndex, nextIcebreakerIndex } from "../icebreakers";
import { colors, fonts } from "../theme";
import type { Game } from "../types";
import { Button, Card, inputStyle } from "./ui";

// "Break the ice" (community participation upgrade, Release 1) — host-only,
// from 24 hours before the start until it's over: one prompt from a static
// curated list (icebreakers.ts), with "another one" and "write your own".
// Nothing is sent unless the host taps Share — that posts it as a normal
// game update, which notifies everyone who's joined, and the button says so.

const SHOW_FROM_MS = 24 * 60 * 60 * 1000;

export function IcebreakerCard({ game, onShared }: { game: Game; onShared?: () => void }) {
  const [index, setIndex] = useState(() => initialIcebreakerIndex(game.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same local-time reading of date+time GameDetail's own isPast uses.
  const startsAt = new Date(`${game.date}T${game.time}:00`).getTime();
  if (Number.isNaN(startsAt) || startsAt - Date.now() > SHOW_FROM_MS) return null;

  const prompt = editing ? draft : ICEBREAKERS[index];

  const share = async () => {
    if (!prompt.trim()) return;
    setSharing(true);
    setError(null);
    try {
      await postGameUpdate(game.id, `Icebreaker for today: ${prompt.trim()}`);
      setShared(true);
      onShared?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share that");
    } finally {
      setSharing(false);
    }
  };

  const linkStyle = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, color: colors.text, textDecoration: "underline" } as const;

  return (
    <Card style={{ marginBottom: 28, background: colors.panel, border: "none" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".09em", color: colors.muted, marginBottom: 6 }}>Break the ice</div>
      {shared ? (
        <p style={{ margin: 0, fontSize: 14, color: colors.muted }}>Shared with the group. Try opening with it when everyone arrives.</p>
      ) : (
        <>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your own conversation starter"
              rows={2}
              maxLength={280}
              style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
            />
          ) : (
            <p style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, lineHeight: 1.35, margin: "0 0 12px" }}>“{prompt}”</p>
          )}
          {error && <div style={{ fontSize: 12.5, color: colors.danger, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Button onClick={share} disabled={sharing || !prompt.trim()}>{sharing ? "Sharing…" : "Share with the group"}</Button>
            {editing ? (
              <button onClick={() => setEditing(false)} style={linkStyle}>Use a suggestion</button>
            ) : (
              <>
                <button onClick={() => setIndex((i) => nextIcebreakerIndex(i))} style={linkStyle}>Another one</button>
                <button onClick={() => { setDraft(""); setEditing(true); }} style={linkStyle}>Write your own</button>
              </>
            )}
          </div>
          <div style={{ fontSize: 12, color: colors.faint, marginTop: 10 }}>Sharing posts it as an update, so everyone who's joined gets notified.</div>
        </>
      )}
    </Card>
  );
}
