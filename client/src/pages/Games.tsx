import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, fetchCentres, fetchGames, joinGame, joinGameWaitlist, leaveGame } from "../api";
import { CalendarIcon, ClockIcon, PlusIcon, UsersIcon } from "../components/icons";
import { Button, Card, EmptyState, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import type { Centre, Game } from "../types";

// "Join a Game" (MVP) — the lightweight, participation-first counterpart to
// booking a whole venue: see plan doc "Book vs Join". v1 is deliberately
// simple — no map, no filters beyond county — the point is proving the
// pattern, not building it out fully on day one.

function GameCard({ game, onJoin, onLeave, joining }: { game: Game; onJoin: () => void; onLeave: () => void; joining: boolean }) {
  const { resident } = useGuest();
  const full = game.spotsLeft === 0;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{game.activityLabel}</div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>{game.centreName ?? game.locationText}</div>
        </div>
        {game.priceCents ? (
          <div style={{ fontWeight: 700, color: colors.greenText }}>€{(game.priceCents / 100).toFixed(2)}</div>
        ) : (
          <div style={{ fontWeight: 700, color: colors.greenText, fontSize: 13 }}>Free</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, margin: "12px 0", fontSize: 13.5, color: colors.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CalendarIcon size={14} /> {game.date}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <ClockIcon size={14} /> {game.time}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <UsersIcon size={14} /> {game.joined}/{game.capacity}
        </span>
      </div>
      {full ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.orangeDark }}>Full</span>
          <Button
            variant="ghost"
            onClick={() => joinGameWaitlist(game.id)}
            disabled={!resident}
          >
            Join waitlist
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.greenText }}>{game.spotsLeft} spot{game.spotsLeft === 1 ? "" : "s"} left</span>
          <Button onClick={onJoin} disabled={joining || !resident}>
            {joining ? "Joining…" : "Join game"}
          </Button>
        </div>
      )}
      {!resident && <div style={{ fontSize: 12, color: colors.faint, marginTop: 8 }}>Sign in from My bookings to join a game.</div>}
    </Card>
  );
}

export function Games() {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [centres, setCentres] = useState<Centre[]>([]);
  const [form, setForm] = useState({ activityLabel: "", centreId: "", locationText: "", date: "", time: "", capacity: 4, priceCents: "" });
  const [createError, setCreateError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchGames()
      .then(setGames)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetchCentres().then(setCentres);
  }, []);

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      const res = await joinGame(id);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't join this game");
    } finally {
      setJoiningId(null);
    }
  };

  const handleLeave = async (id: string) => {
    await leaveGame(id);
    load();
  };

  const handleCreate = async () => {
    setCreateError(null);
    if (!form.activityLabel || !form.date || !form.time || (!form.centreId && !form.locationText)) {
      setCreateError("Fill in an activity, date, time and a venue or location");
      return;
    }
    setCreating(true);
    try {
      await createGame({
        activityLabel: form.activityLabel,
        centreId: form.centreId || undefined,
        locationText: form.centreId ? undefined : form.locationText,
        date: form.date,
        time: form.time,
        capacity: form.capacity,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : undefined,
      });
      setForm({ activityLabel: "", centreId: "", locationText: "", date: "", time: "", capacity: 4, priceCents: "" });
      load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create this game");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <PageSpinner />;

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 8px", letterSpacing: "-.02em" }}>
          Join a game
        </h1>
        <p style={{ color: colors.mutedLight, fontSize: 15, margin: "0 0 28px" }}>
          Don't book a whole venue — join people who are already playing.
        </p>

        {resident ? (
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
              <PlusIcon size={16} /> Start a game
            </div>
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Activity</label>
                <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Venue (optional)</label>
                <select value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))} style={inputStyle}>
                  <option value="">— pick a location instead —</option>
                  {centres.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {!form.centreId && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Location</label>
                  <input value={form.locationText} onChange={(e) => setForm((f) => ({ ...f, locationText: e.target.value }))} placeholder="e.g. Phoenix Park, main gate" style={inputStyle} />
                </div>
              )}
              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Time</label>
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Players needed (incl. you)</label>
                <input type="number" min={2} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: parseInt(e.target.value, 10) || 2 }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Price per player (optional)</label>
                <input value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))} placeholder="e.g. 5" style={inputStyle} />
              </div>
            </div>
            {createError && <p style={{ color: "#b00020", fontSize: 13, margin: "12px 0 0" }}>{createError}</p>}
            <div style={{ marginTop: 14 }}>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? "Creating…" : "Create game"}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 16, padding: "16px 20px", marginBottom: 28, fontSize: 14 }}>
            <button onClick={() => navigate("/bookings")} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
              Sign in
            </button>{" "}
            to start or join a game.
          </div>
        )}

        {games.length === 0 ? (
          <EmptyState icon={<UsersIcon size={20} />} title="No open games yet" subtitle="Be the first to start one above." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {games.map((g) => (
              <GameCard key={g.id} game={g} joining={joiningId === g.id} onJoin={() => handleJoin(g.id)} onLeave={() => handleLeave(g.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
