import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelGame, fetchGameParticipantsForManage, fetchGameWaitlist, fetchMyGames, offerGameWaitlistEntry, postGameUpdate, refundGameParticipant, removeGameParticipant } from "../api";
import { deriveActivityStatus } from "../activityStatus";
import { rehostHref } from "../rehost";
import { CalendarIcon, SearchIcon } from "./icons";
import { HostCheckInScreen } from "./HostCheckInScreen";
import { ShareButton } from "./ShareButton";
import { Avatar, Button, Card, ConfirmDialog, Drawer, EmptyState, PageSpinner, ProgressBar } from "./ui";
import { colors, fonts, radius } from "../theme";
import type { Game, ManageParticipant, WaitlistEntry } from "../types";

// HelloCircle Manage — Activities tab body, extracted from the standalone
// /manage/activities page (Phase 3, Host MVP) so it can render as one tab of
// the combined ManageHome dashboard (see ManageHome.tsx), the same way
// Vendor's ListingsTab/BookingsTab/etc. are separate components rendered
// inside VendorDashboard.tsx's own tab switch rather than their own routes.
// Only the ManageShell wrapper and the resident/sign-in guard moved to
// ManageHome — this component assumes it's mounted with a resident session
// already present, same assumption every other Vendor*Tab component makes.

// Message templates (Vendor-parity pass) — same preset pattern as
// VendorMessages.tsx's MESSAGE_TEMPLATES, applied to a host's "post an
// update" composer instead of a vendor broadcast. Client-side only.
const UPDATE_TEMPLATES: { key: string; label: string; text: (activityLabel: string) => string }[] = [
  { key: "reminder", label: "Reminder", text: (a) => `Reminder: ${a} is coming up soon — see you there!` },
  { key: "location", label: "Location info", text: (a) => `Here's how to find us for ${a}: [add directions, parking, entrance details].` },
  { key: "weather", label: "Weather update", text: () => `Quick weather update: [still on / moved indoors / rescheduled].` },
  { key: "cancellation", label: "Cancellation", text: (a) => `Unfortunately ${a} needs to be cancelled. [add reason and next steps].` },
];

// Vendor-parity pass, Phase 27 — same filter-bar pattern as
// VendorBookings.tsx's BookingsFilterBar, client-side only (no server
// change, `fetchMyGames({ hostedOnly: true })` already returns everything).
type ActivityStatusFilter = "all" | "open" | "pending_participants" | "cancelled";
type ActivityWhenFilter = "upcoming" | "past" | "all";

function activityFilterPillStyle(active: boolean) {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: 100,
    border: "none",
    cursor: "pointer",
    background: active ? colors.dark : colors.panel,
    color: active ? "#fff" : colors.muted,
  } as const;
}

function ActivitiesFilterBar({
  status,
  onStatus,
  when,
  onWhen,
  search,
  onSearch,
}: {
  status: ActivityStatusFilter;
  onStatus: (v: ActivityStatusFilter) => void;
  when: ActivityWhenFilter;
  onWhen: (v: ActivityWhenFilter) => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <Card style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      {/* Host Experience Polish — "when" leads (Upcoming/Past/Cancelled is
          the primary distinction the brief's tab language wants); "status"
          stays a secondary refinement rather than merging both into one
          flat tab set, which would lose the ability to combine them (e.g.
          "past AND cancelled"). */}
      <div style={{ display: "flex", gap: 4 }}>
        {(["upcoming", "past", "all"] as const).map((w) => (
          <button key={w} onClick={() => onWhen(w)} style={activityFilterPillStyle(when === w)}>
            {w === "all" ? "All dates" : w === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {(["all", "open", "pending_participants", "cancelled"] as const).map((s) => (
          <button key={s} onClick={() => onStatus(s)} style={activityFilterPillStyle(status === s)}>
            {s === "all" ? "All" : s === "open" ? "Open" : s === "pending_participants" ? "Needs players" : "Cancelled"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 200px", minWidth: 160 }}>
        <SearchIcon size={13} style={{ color: colors.faint, flex: "none" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search activity or venue"
          style={{ flex: 1, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "6px 10px", fontSize: 12.5 }}
        />
      </div>
    </Card>
  );
}

// Host Experience Polish — now sourced from the shared deriveActivityStatus()
// (activityStatus.ts) instead of a locally-duplicated status→label map, so
// this badge is date/capacity-aware (Completed, Almost full) the same way
// the new Overview "Next Up" hero and upcoming cards are — one status
// language across every Host surface, not a bespoke one per component.
function statusBadge(game: Pick<Game, "status" | "date" | "spotsLeft" | "capacity" | "effectiveLifecycle">) {
  const s = deriveActivityStatus(game);
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, borderRadius: radius.pill, padding: "2px 8px" }}>{s.label}</span>;
}

function ParticipantsDrawer({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const [participants, setParticipants] = useState<ManageParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManageParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Platform Pre-Launch Polish — Changeset 4D.
  const [refundTarget, setRefundTarget] = useState<ManageParticipant | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  // Host-visible waitlist + targeted invite (Vendor-parity pass) — mirrors
  // ClubWaitlistPanel; only relevant once the game is actually full, but
  // cheap to fetch alongside participants either way.
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [invitingId, setInvitingId] = useState<number | null>(null);

  useEffect(() => {
    if (!game) return;
    setLoading(true);
    fetchGameParticipantsForManage(game.id)
      .then(setParticipants)
      .finally(() => setLoading(false));
    fetchGameWaitlist(game.id).then(setWaitlist).catch(() => setWaitlist([]));
  }, [game]);

  const invite = async (entryId: number) => {
    if (!game) return;
    setInvitingId(entryId);
    try {
      await offerGameWaitlistEntry(game.id, entryId);
      fetchGameWaitlist(game.id).then(setWaitlist).catch(() => {});
    } finally {
      setInvitingId(null);
    }
  };

  const handleRemove = async () => {
    if (!game || !removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeGameParticipant(game.id, removeTarget.residentId);
      setParticipants((prev) => prev.map((p) => (p.residentId === removeTarget.residentId ? { ...p, status: "cancelled" } : p)));
      setRemoveTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this participant");
    } finally {
      setBusy(false);
    }
  };

  // Platform Pre-Launch Polish — Changeset 4C/4D.
  const handleRefund = async () => {
    if (!game || !refundTarget) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      await refundGameParticipant(game.id, refundTarget.residentId);
      setParticipants((prev) => prev.map((p) => (p.residentId === refundTarget.residentId ? { ...p, paymentStatus: "refunded" } : p)));
      setRefundTarget(null);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Couldn't issue this refund");
    } finally {
      setRefundBusy(false);
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
          {participants.map((p) => {
            // Platform Pre-Launch Polish — Changeset 4D/4E. Cancelled/removed
            // participants now stay in this list (soft-cancel, not a hard
            // delete) instead of just vanishing — their real status/payment
            // state is shown honestly rather than implying an active,
            // unpaid-for spot.
            const canRefund = p.paymentStatus === "paid";
            const statusLabel =
              p.status === "cancelled"
                ? "Cancelled"
                : p.status === "pending_payment"
                ? "Payment pending"
                : "Joined";
            return (
              <div key={p.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={p.name} size={30} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: colors.mutedLight }}>
                      {statusLabel}
                      {p.paymentStatus === "refunded" ? " · Refunded" : ""}
                      {p.checkedInAt ? " · Checked in" : ""}
                      {game && p.residentId === game.hostResidentId ? " · Host" : ""}
                    </div>
                  </div>
                </div>
                {game && p.residentId !== game.hostResidentId && (
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    {canRefund && (
                      <button
                        onClick={() => setRefundTarget(p)}
                        style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                      >
                        Refund
                      </button>
                    )}
                    {p.status !== "cancelled" && (
                      <button
                        onClick={() => setRemoveTarget(p)}
                        style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {waitlist.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px" }}>WAITLIST</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {waitlist.map((w) => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
                <span>{w.name || w.email || "Anonymous"}</span>
                {w.status === "offered" ? (
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: radius.pill, padding: "3px 10px", background: colors.orangeBg, color: colors.orangeDark, flex: "none" }}>
                    Offered a spot
                  </span>
                ) : (
                  <button
                    onClick={() => invite(w.id)}
                    disabled={invitingId === w.id}
                    style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "4px 10px", cursor: "pointer", flex: "none" }}
                  >
                    {invitingId === w.id ? "…" : "Invite"}
                  </button>
                )}
              </div>
            ))}
          </div>
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
      {/* Platform Pre-Launch Polish — Changeset 4D. Full refund only, no
          partial amounts this phase — a Game's price is the same for every
          participant, so game.priceCents is the whole, correct figure. */}
      <ConfirmDialog
        open={!!refundTarget}
        title={`Refund €${((game?.priceCents ?? 0) / 100).toFixed(2)}?`}
        message="This will return the full payment to the participant."
        confirmLabel={refundBusy ? "Refunding…" : "Refund"}
        tone="neutral"
        busy={refundBusy}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
      >
        {refundError && <p style={{ color: colors.danger, fontSize: 13 }}>{refundError}</p>}
      </ConfirmDialog>
    </Drawer>
  );
}

function ActivityRow({ game, onChanged, onManage, onCheckIn }: { game: Game; onChanged: () => void; onManage: () => void; onCheckIn: () => void }) {
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
      setError(e instanceof Error ? e.message : "Couldn't cancel this session");
    } finally {
      setBusy(false);
    }
  };

  const isLive = game.status !== "cancelled";
  const isPast = game.date < new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{game.activityLabel}</span>
            {statusBadge(game)}
            {game.circleId && (
              <button
                onClick={() => navigate(`/manage/circles/${game.circleSlug ?? game.circleId}`)}
                style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", border: "none", cursor: "pointer" }}
              >
                Part of {game.circleName}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight, marginBottom: 8 }}>
            {game.date} · {game.time} · {game.centreName ?? game.locationText}
          </div>
          {/* Host Experience Polish — capacity as a visual fill, not just
              raw "N/M joined" text (no such component existed before this). */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 220 }}>
            <ProgressBar occupied={game.joined} capacity={game.capacity} style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: colors.mutedLight, flex: "none" }}>{game.joined}/{game.capacity}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onManage}>Participants</Button>
          <ShareButton entityType="game" entityId={game.id} variant="ghost" />
          {/* Duplicate (Host Experience Polish) — any status, reuses the
              same param-carrying logic as GameDetail.tsx's "Do it again"
              via the shared rehost.ts helper. "Host again" below is the
              same action, just labeled for a past activity's context. */}
          <Button variant="ghost" onClick={() => navigate(rehostHref(game))}>{isPast ? "Host again" : "Duplicate"}</Button>
          {isLive && !isPast && (
            <>
              <Button variant="ghost" onClick={onCheckIn}>Check-in</Button>
              <Button variant="ghost" onClick={() => navigate(`/games/host/${game.id}`)}>Edit</Button>
              <Button variant="ghost" onClick={() => setPosting((v) => !v)}>Post update</Button>
              <Button variant="danger" onClick={() => setConfirmingCancel(true)}>Cancel</Button>
            </>
          )}
        </div>
      </div>
      {posting && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {UPDATE_TEMPLATES.map((t) => (
              <button
                key={t.key}
                onClick={() => setMessage(t.text(game.activityLabel))}
                style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "4px 10px", cursor: "pointer" }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's changed, or what should people know?"
              style={{ flex: 1, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}
            />
            <Button onClick={handlePostUpdate} disabled={busy || !message.trim()}>{busy ? "Posting…" : "Post"}</Button>
          </div>
        </div>
      )}
      {error && <p style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{error}</p>}
      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this session?"
        message="Everyone who's joined will be notified. This doesn't process a refund for anyone who paid."
        confirmLabel={busy ? "Cancelling…" : "Cancel session"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
      />
    </Card>
  );
}

export function ActivitiesTab() {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [managingGame, setManagingGame] = useState<Game | null>(null);
  const [checkingInGame, setCheckingInGame] = useState<Game | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>("all");
  const [whenFilter, setWhenFilter] = useState<ActivityWhenFilter>("upcoming");
  const [search, setSearch] = useState("");

  const reload = () => {
    setGamesLoading(true);
    fetchMyGames({ hostedOnly: true })
      .then(setGames)
      .finally(() => setGamesLoading(false));
  };

  useEffect(reload, []);

  const today = new Date().toISOString().slice(0, 10);
  const q = search.trim().toLowerCase();
  const filtered = games.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    const isUpcoming = g.status !== "cancelled" && g.date >= today;
    if (whenFilter === "upcoming" && !isUpcoming) return false;
    if (whenFilter === "past" && isUpcoming) return false;
    if (q && !g.activityLabel.toLowerCase().includes(q) && !(g.centreName ?? g.locationText).toLowerCase().includes(q)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => (whenFilter === "past" ? (b.date + b.time).localeCompare(a.date + a.time) : (a.date + a.time).localeCompare(b.date + b.time)));

  if (gamesLoading) return <PageSpinner />;

  return (
    <>
      {games.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={26} />}
          title="Host something people will remember."
          subtitle="Create a session, invite people, and start building your community."
          action={<Button onClick={() => navigate("/games/host")}>Create your first activity</Button>}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ActivitiesFilterBar status={statusFilter} onStatus={setStatusFilter} when={whenFilter} onWhen={setWhenFilter} search={search} onSearch={setSearch} />
          {sorted.length === 0 ? (
            <EmptyState icon={<CalendarIcon size={22} />} title="Nothing matches these filters" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sorted.map((g) => (
                <ActivityRow key={g.id} game={g} onChanged={reload} onManage={() => setManagingGame(g)} onCheckIn={() => setCheckingInGame(g)} />
              ))}
            </div>
          )}
        </div>
      )}
      <ParticipantsDrawer game={managingGame} onClose={() => setManagingGame(null)} />
      <HostCheckInScreen game={checkingInGame} onClose={() => setCheckingInGame(null)} />
    </>
  );
}
