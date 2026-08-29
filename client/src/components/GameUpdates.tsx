import { useEffect, useState } from "react";
import { fetchGameUpdates, postGameUpdate } from "../api";
import { Button, inputStyle } from "./ui";
import { colors, fonts } from "../theme";
import type { Game, GameUpdate } from "../types";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// "Latest update" (Game Detail redesign §25) — host-posted announcements.
// Only ever renders when at least one update exists, per the spec's own
// "do not leave empty sections" instruction; a host-only composer sits
// beneath the list so a host can post one without leaving the page.

export function GameUpdates({ game, isHost }: { game: Game; isHost: boolean }) {
  const [updates, setUpdates] = useState<GameUpdate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState("");
  const [posting, setPosting] = useState(false);

  const load = () => {
    fetchGameUpdates(game.id)
      .then(setUpdates)
      .catch(() => {})
      .finally(() => setLoaded(true));
  };

  useEffect(load, [game.id]);

  const handlePost = async () => {
    if (!message.trim()) return;
    setPosting(true);
    try {
      await postGameUpdate(game.id, message.trim());
      setMessage("");
      setComposing(false);
      load();
    } catch {
      // best-effort — the host can just retry
    } finally {
      setPosting(false);
    }
  };

  if (!loaded || (updates.length === 0 && !isHost)) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 12px" }}>Latest update</h2>
      {updates.length === 0 ? (
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: colors.faint }}>No updates posted yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: isHost ? 12 : 0 }}>
          {updates.map((u) => (
            <div key={u.id} style={{ background: colors.orangeBg, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, marginBottom: 4 }}>{relativeTime(u.createdAt)}</div>
              <div style={{ fontSize: 14, color: "#3B423C", lineHeight: 1.5 }}>{u.message}</div>
            </div>
          ))}
        </div>
      )}
      {isHost && (
        composing ? (
          <div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Meeting point changed — we'll meet by the north gate instead."
              rows={2}
              style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={handlePost} disabled={posting || !message.trim()}>{posting ? "Posting…" : "Post update"}</Button>
              <Button variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button onClick={() => setComposing(true)} style={{ background: "none", border: "none", padding: 0, color: colors.text, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
            + Post an update
          </button>
        )
      )}
    </div>
  );
}
