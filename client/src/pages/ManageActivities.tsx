import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelGame, fetchGameParticipantsForManage, fetchMyGames, postGameUpdate, removeGameParticipant } from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon } from "../components/icons";
import { ManageShell } from "../components/ManageShell";
import { Avatar, Button, Card, ConfirmDialog, Drawer, EmptyState, PageSpinner } from "../components/ui";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";
import type { Game, ManageParticipant } from "../types";

// HelloCircle Manage (Phase 3, Host MVP) — the first resident-authenticated
// page to use ManageShell (see its own comment: previously vendor/admin
// only). Replaces the bolted-on Cancel button + "post an update" box on the
// consumer GameDetail.tsx page with a real management surface: a host edits,
// posts updates, cancels, and manages participants entirely from here,
// without needing to visit their own game's public page. GameDetail.tsx's
// existing controls are untouched — still useful when a host is already
// looking at the public page.

type ActivitiesTab = "activities";
const NAV_OPTIONS: { key: ActivitiesTab; label: string; icon?: undefined }[] = [{ key: "activities", label: "Activities" }];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    open: { bg: colors.greenBg, fg: colors.greenText, label: "Open" },
    pending_participants: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Pending players" },
    cancelled: { bg: colors.dangerBg, fg: colors.danger, label: "Cancelled" },
  };
  const s = map[status] ?? { bg: colors.panel, fg: colors.muted, label: status };
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, borderRadius: radius.pill, padding: "2px 8px" }}>{s.label}</span>;
}

function ParticipantsDrawer({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const [participants, setParticipants] = useState<ManageParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManageParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!game) return;
    setLoading(true);
    fetchGameParticipantsForManage(game.id)
      .then(setParticipants)
      .finally(() => setLoading(false));
  }, [game]);

  const handleRemove = async () => {
    if (!game || !removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeGameParticipant(game.id, removeTarget.residentId);
      setParticipants((prev) => prev.filter((p) => p.residentId !== removeTarget.residentId));
      setRemoveTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this participant");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={!!game} onClose={onClose} title="Participants">
      {loading ? (
        <PageSpinner />
      ) : participants.length === 0 ? (
        <EmptyState icon={<CalendarIcon size={26} />} title="No one's joined yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {participants.map((p) => (
            <div key={p.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={p.name} size={30} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: colors.mutedLight }}>
                    {p.status === "pending_payment" ? "Payment pending" : "Joined"}
                    {p.checkedInAt ? " · Checked in" : ""}
                    {game && p.residentId === game.hostResidentId ? " · Host" : ""}
                  </div>
                </div>
              </div>
              {game && p.residentId !== game.hostResidentId && (
                <button
                  onClick={() => setRemoveTarget(p)}
                  style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this participant?"
        message={`${removeTarget?.name ?? "This participant"} will be notified and their spot will open up. This doesn't process a refund.`}
        confirmLabel={busy ? "Removing…" : "Remove"}
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </ConfirmDialog>
    </Drawer>
  );
}

function ActivityRow({ game, onChanged, onManage }: { game: Game; onChanged: () => void; onManage: () => void }) {
  const navigate = useNavigate();
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePostUpdate = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postGameUpdate(game.id, message.trim());
      setMessage("");
      setPosting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post that update");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelGame(game.id);
      setConfirmingCancel(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel this game");
    } finally {
      setBusy(false);
    }
  };

  const isLive = game.status !== "cancelled";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{game.activityLabel}</span>
            {statusBadge(game.status)}
            {game.circleId && (
              <button
                onClick={() => navigate(`/manage/circles/${game.circleSlug ?? game.circleId}`)}
                style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", border: "none", cursor: "pointer" }}
              >
                Part of {game.circleName}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
            {game.date} · {game.time} · {game.centreName ?? game.locationText} · {game.joined}/{game.capacity} joined
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onManage}>Participants</Button>
          {isLive && (
            <>
              <Button variant="ghost" onClick={() => navigate(`/games/host/${game.id}`)}>Edit</Button>
              <Button variant="ghost" onClick={() => setPosting((v) => !v)}>Post update</Button>
              <Button variant="danger" onClick={() => setConfirmingCancel(true)}>Cancel</Button>
            </>
          )}
        </div>
      </div>
      {posting && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's changed, or what should people know?"
            style={{ flex: 1, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}
          />
          <Button onClick={handlePostUpdate} disabled={busy || !message.trim()}>{busy ? "Posting…" : "Post"}</Button>
        </div>
      )}
      {error && <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{error}</p>}
      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this game?"
        message="Everyone who's joined will be notified. This doesn't process a refund for anyone who paid."
        confirmLabel={busy ? "Cancelling…" : "Cancel game"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
      />
    </Card>
  );
}

export function ManageActivities() {
  const { resident, loading } = useGuest();
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [managingGame, setManagingGame] = useState<Game | null>(null);

  const reload = () => {
    setGamesLoading(true);
    fetchMyGames({ hostedOnly: true })
      .then(setGames)
      .finally(() => setGamesLoading(false));
  };

  useEffect(() => {
    if (resident) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident?.id]);

  if (loading) return <PageSpinner />;
  if (!resident) {
    navigate(signInHref());
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = games.filter((g) => g.status !== "cancelled" && g.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = games.filter((g) => g.status === "cancelled" || g.date < today);

  return (
    <ManageShell
      navTitle="HelloCircle Manage"
      navOptions={NAV_OPTIONS}
      activeKey="activities"
      onNavChange={() => {}}
      pageTitle="Activities"
    >
      {gamesLoading ? (
        <PageSpinner />
      ) : games.length === 0 ? (
        <EmptyState icon={<CalendarIcon size={26} />} title="You haven't hosted a game yet" action={<Button onClick={() => navigate("/games/host")}>Host a game</Button>} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 12px" }}>Upcoming</h4>
            {upcoming.length === 0 ? (
              <EmptyState icon={<CalendarIcon size={22} />} title="Nothing upcoming" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {upcoming.map((g) => (
                  <ActivityRow key={g.id} game={g} onChanged={reload} onManage={() => setManagingGame(g)} />
                ))}
              </div>
            )}
          </div>
          {past.length > 0 && (
            <div>
              <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 12px" }}>Past & cancelled</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {past.map((g) => (
                  <ActivityRow key={g.id} game={g} onChanged={reload} onManage={() => setManagingGame(g)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ParticipantsDrawer game={managingGame} onClose={() => setManagingGame(null)} />
    </ManageShell>
  );
}
