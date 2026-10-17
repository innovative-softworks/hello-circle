import { useEffect, useState } from "react";
import { dateLabel } from "../euro";
import { useNavigate } from "react-router-dom";
import { answerGameJoinRequest, cancelGame, cancelRemainingGameSeries, fetchGameSeries, fetchActivityMoney, fetchGameJoinRequests, updateGameBookingSettings, moveGameWithVenue, fetchGameParticipantsForManage, fetchGameWaitlist, fetchMyGames, offerGameWaitlistEntry, postGameUpdate, refundGameParticipant, removeGameParticipant } from "../api";
import { deriveActivityStatus } from "../activityStatus";
import { rehostHref } from "../rehost";
import { CalendarIcon, SearchIcon } from "./icons";
import { HostCheckInScreen } from "./HostCheckInScreen";
import { ShareButton } from "./ShareButton";
import { Avatar, Button, Card, ConfirmDialog, EmptyState, LoadErrorState, PageSpinner, ProgressBar } from "./ui";
import { RecordState, RecordView } from "./workspace/RecordView";
import { ActionMenu } from "./ActionMenu";
import { useToast } from "./Toast";
import { Facts, SectionLabel } from "./admin/adminUi";
import { useRecordParam, useUrlParam } from "../useUrlTab";
import { euro } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { Game, ManageParticipant, WaitlistEntry } from "../types";
import { irelandToday, irelandWallTimeToUtc } from "../irelandDate";
import { X } from "lucide-react";
import { AdminButton, AdminModal, Box, FormField, Loaded, SearchField, SelectField, Toolbar, useAdminData } from "./admin/adminUi";

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
// "draft" / "coming_soon" filter on the publishing lifecycle (sitemap audit
// P2-16: drafts used to be mixed in with open activities); "open" and "Needs
// players" then mean live activities only.
type ActivityStatusFilter = "all" | "draft" | "coming_soon" | "open" | "pending_participants" | "cancelled";
type ActivityWhenFilter = "upcoming" | "past" | "all";

const STATUS_FILTER_LABELS: Record<ActivityStatusFilter, string> = {
  all: "All",
  draft: "Drafts",
  coming_soon: "Coming soon",
  open: "Open",
  pending_participants: "Needs players",
  cancelled: "Cancelled",
};

function matchesStatusFilter(g: Game, filter: ActivityStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "draft" || filter === "coming_soon") return g.status !== "cancelled" && g.effectiveLifecycle === filter;
  if (filter === "cancelled") return g.status === "cancelled";
  const live = g.effectiveLifecycle !== "draft" && g.effectiveLifecycle !== "coming_soon";
  return live && g.status === filter;
}

const WHEN_LABELS: Record<ActivityWhenFilter, string> = { upcoming: "Upcoming", past: "Past", all: "All dates" };

// "When" leads (Upcoming/Past is the primary distinction); status is a
// second, combinable refinement. Non-default filters show as removable chips.
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
  const chips: { label: string; clear: () => void }[] = [];
  if (when !== "upcoming") chips.push({ label: WHEN_LABELS[when], clear: () => onWhen("upcoming") });
  if (status !== "all") chips.push({ label: STATUS_FILTER_LABELS[status], clear: () => onStatus("all") });
  if (search) chips.push({ label: `"${search}"`, clear: () => onSearch("") });
  return (
    <div>
      <Toolbar label="Filter activities">
        <SearchField label="Search" placeholder="Activity or venue" value={search} onChange={onSearch} />
        <SelectField label="When" value={when} onChange={onWhen} options={(["upcoming", "past", "all"] as const).map((v) => ({ value: v, label: WHEN_LABELS[v] }))} />
        <SelectField
          label="Status"
          value={status}
          onChange={onStatus}
          options={(["all", "draft", "coming_soon", "open", "pending_participants", "cancelled"] as const).map((v) => ({ value: v, label: v === "all" ? "All statuses" : STATUS_FILTER_LABELS[v] }))}
        />
      </Toolbar>
      {chips.length > 0 && (
        <div className="ws-fchips" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.label} type="button" className="adm-chip ws-fchip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
              {c.label} <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
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

function joinLabel(p: ManageParticipant) {
  return p.status === "cancelled" ? "Cancelled" : p.status === "pending_payment" ? "Payment pending" : "Joined";
}
function paymentLabel(p: ManageParticipant, paid: boolean) {
  if (!paid) return "Free";
  return p.paymentStatus === "paid" ? "Paid" : p.paymentStatus === "refunded" ? "Refunded" : p.paymentStatus === "pending" ? "Awaiting payment" : p.paymentStatus;
}

// Activity record page in the Host workspace (was a "Participants" modal).
// Addressed by `?tab=activities&record=activity:<id>`, so it survives refresh
// and Back returns to the filtered list.
function ActivityRecord({ game, onBack, onCheckIn, onChanged }: { game: Game; onBack: () => void; onCheckIn: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState({ date: game.date, time: game.time });
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const doMove = async () => {
    setMoveBusy(true);
    setMoveError(null);
    try {
      await moveGameWithVenue(game.id, moveTo.date, moveTo.time);
      toast.success(`Moved to ${dateLabel(moveTo.date)} at ${moveTo.time}, with the venue booking`);
      setMoving(false);
      onChanged();
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : "Couldn't move it");
    } finally {
      setMoveBusy(false);
    }
  };
  const [participants, setParticipants] = useState<ManageParticipant[] | null>(null);
  const [participantsFailed, setParticipantsFailed] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManageParticipant | null>(null);
  const [refundTarget, setRefundTarget] = useState<ManageParticipant | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[] | null>(null);
  const [waitlistFailed, setWaitlistFailed] = useState(false);
  const [invitingId, setInvitingId] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const paid = (game.priceCents ?? 0) > 0;

  const loadParticipants = () => {
    setParticipantsFailed(false);
    fetchGameParticipantsForManage(game.id)
      .then(setParticipants)
      .catch(() => setParticipantsFailed(true));
  };
  const loadWaitlist = () => {
    setWaitlistFailed(false);
    fetchGameWaitlist(game.id)
      .then(setWaitlist)
      .catch(() => setWaitlistFailed(true));
  };
  useEffect(() => {
    loadParticipants();
    loadWaitlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const invite = async (entryId: number) => {
    setInvitingId(entryId);
    setInviteError(null);
    try {
      await offerGameWaitlistEntry(game.id, entryId);
      loadWaitlist();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't offer that place");
    } finally {
      setInvitingId(null);
    }
  };
  // Throwing keeps the confirmation open with the message (ConfirmDialog).
  const handleRemove = async () => {
    if (!removeTarget) return;
    await removeGameParticipant(game.id, removeTarget.residentId);
    setParticipants((prev) => (prev ?? []).map((p) => (p.residentId === removeTarget.residentId ? { ...p, status: "cancelled" } : p)));
    setRemoveTarget(null);
  };
  const handleRefund = async () => {
    if (!refundTarget) return;
    await refundGameParticipant(game.id, refundTarget.residentId);
    setParticipants((prev) => (prev ?? []).map((p) => (p.residentId === refundTarget.residentId ? { ...p, paymentStatus: "refunded" } : p)));
    setRefundTarget(null);
  };

  const joined = (participants ?? []).filter((p) => p.status !== "cancelled").length;
  const s = deriveActivityStatus(game);
  return (
    <RecordView
      title={game.activityLabel}
      reference={
        <>
          {dateLabel(game.date)} · {game.time} · {game.centreName ?? game.locationText}
        </>
      }
      backLabel="Activities"
      onBack={onBack}
      statuses={
        <>
          <span style={{ fontSize: 12.5, color: colors.mutedLight }}>Activity:</span> {statusBadge(game)}
          <span style={{ fontSize: 12.5, color: colors.mutedLight }}>Places:</span>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{participants ? `${joined} of ${game.capacity} taken` : `${game.capacity} places`}</span>
          <span style={{ fontSize: 12.5, color: colors.mutedLight }}>Price:</span>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{paid ? euro((game.priceCents ?? 0) / 100) : "Free"}</span>
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate(`/games/${game.id}`)}>View public page</Button>
          {s.label !== "Cancelled" && game.status !== "cancelled" && (
            <>
              <Button variant="ghost" onClick={onCheckIn}>Check-in</Button>
              {game.bookingRef && game.date >= irelandToday() && (
                <Button variant="ghost" onClick={() => setMoving(true)}>
                  Move with venue booking
                </Button>
              )}
              <Button onClick={() => navigate(`/games/host/${game.id}`)}>Edit activity</Button>
            </>
          )}
        </>
      }
    >
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Participants</SectionLabel>
          {participantsFailed ? (
            <LoadErrorState title="Couldn't load participants." onRetry={loadParticipants} />
          ) : participants === null ? (
            <p role="status" aria-busy="true" style={{ fontSize: 13.5, color: colors.mutedLight }}>Loading participants…</p>
          ) : participants.length === 0 ? (
            <EmptyState icon={<CalendarIcon size={26} />} title="No one's joined yet" />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {participants.map((p) => {
                const isHost = p.residentId === game.hostResidentId;
                return (
                  <li key={p.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Avatar name={p.name} size={30} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}{isHost ? " (host)" : ""}</div>
                        <div style={{ fontSize: 12, color: colors.mutedLight }}>
                          Place: {joinLabel(p)} · Payment: {paymentLabel(p, paid)} · Check-in: {p.checkedInAt ? "Checked in" : "Not yet"}
                        </div>
                      </div>
                    </div>
                    {!isHost && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {p.paymentStatus === "paid" && paid && (
                          <Button variant="ghost" onClick={() => setRefundTarget(p)} aria-label={`Refund ${p.name}`}>
                            Refund
                          </Button>
                        )}
                        {p.status !== "cancelled" && (
                          <Button variant="ghost" onClick={() => setRemoveTarget(p)} aria-label={`Remove ${p.name}`} style={{ color: colors.danger }}>
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <SectionLabel>Details</SectionLabel>
          <Facts
            rows={[
              ["When", `${dateLabel(game.date)} · ${game.time}`],
              ["Where", game.centreName ?? game.locationText],
              ["Capacity", `${game.capacity} places`],
              ["Price", paid ? `${euro((game.priceCents ?? 0) / 100)} per place` : "Free"],
            ]}
          />
          <SectionLabel>Waitlist</SectionLabel>
          {waitlistFailed ? (
            <LoadErrorState title="Couldn't load the waitlist." onRetry={loadWaitlist} />
          ) : waitlist === null ? (
            <p role="status" aria-busy="true" style={{ fontSize: 13.5, color: colors.mutedLight }}>Loading…</p>
          ) : waitlist.length === 0 ? (
            <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>No one is waiting.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {waitlist.map((w) => (
                <li key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "8px 12px", fontSize: 13.5 }}>
                  <span>{w.name || w.email || "Anonymous"}</span>
                  {w.status === "offered" ? (
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Place offered</span>
                  ) : (
                    <Button variant="ghost" onClick={() => invite(w.id)} disabled={invitingId === w.id} aria-busy={invitingId === w.id || undefined}>
                      {invitingId === w.id ? "Offering…" : "Offer a place"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {inviteError && <p role="alert" style={{ color: colors.danger, fontSize: 13 }}>{inviteError}</p>}
        </div>
      </div>
      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove ${removeTarget?.name ?? "this participant"}?`}
        message={`They're notified and their place opens up. ${paid ? "This doesn't refund them — use Refund separately if you want to." : ""}`}
        confirmLabel="Remove participant"
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
      {/* Full refund only — every participant pays the same price. */}
      <ConfirmDialog
        open={!!refundTarget}
        title={`Refund ${euro((game.priceCents ?? 0) / 100)} to ${refundTarget?.name ?? "this participant"}?`}
        message="Returns their full payment through Stripe. It can't be undone and doesn't remove them from the activity."
        confirmLabel="Issue refund"
        tone="neutral"
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
      />
      {game.seriesId && <ActivitySeriesPanel seriesId={game.seriesId} currentId={game.id} onChanged={onChanged} />}
      {game.status !== "cancelled" && !isPastGame(game) && <ActivityBookingSettings game={game} onChanged={() => { onChanged(); loadParticipants(); }} />}
      {paid || game.bookingRef ? <ActivityMoneyPanel gameId={game.id} /> : null}
      {/* OG-12 — the activity and its venue booking move together, or not at all. */}
      <AdminModal
        open={moving}
        onClose={() => setMoving(false)}
        title="Move to a new time"
        subtitle="The venue booking moves with it (the venue's usual rules apply), participants and the venue are told, and nothing about payments changes. Anyone who can't make it can leave."
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setMoving(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={doMove} disabled={moveBusy || (moveTo.date === game.date && moveTo.time === game.time)}>
              {moveBusy ? "Moving…" : "Move both"}
            </AdminButton>
          </>
        }
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <FormField label="New date" required>
            {(p) => <input {...p} type="date" className="adm-input" value={moveTo.date} onChange={(e) => setMoveTo((m) => ({ ...m, date: e.target.value }))} />}
          </FormField>
          <FormField label="New start time" required error={moveError}>
            {(p) => (
              <select {...p} className="adm-select" value={moveTo.time} onChange={(e) => setMoveTo((m) => ({ ...m, time: e.target.value }))}>
                {["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      </AdminModal>
    </RecordView>
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
  const isPast = game.date < irelandToday();

  return (
    <li className="ws-act-row">
      <div className="ws-act-main">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-reset" onClick={onManage} style={{ fontWeight: 700, fontSize: 15 }}>
            {game.activityLabel}
          </button>
          {statusBadge(game)}
          {game.circleId && (
            <button type="button" className="adm-chip ws-fchip" onClick={() => navigate(`/manage/circles/${game.circleSlug ?? game.circleId}`)}>
              Part of {game.circleName}
            </button>
          )}
        </div>
        <div className="adm-note">
          {dateLabel(game.date)} · {game.time} · {game.centreName ?? game.locationText}
        </div>
        {/* Capacity as a visual fill, not just raw "N/M joined" text. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 240 }}>
          <ProgressBar occupied={game.joined} capacity={game.capacity} style={{ flex: 1 }} />
          <span className="adm-note" style={{ flex: "none" }}>
            {game.joined}/{game.capacity} going
          </span>
        </div>
        {error && (
          <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
      <div className="ws-act-actions">
        <AdminButton size="sm" onClick={onManage} aria-label={`Manage ${game.activityLabel}`}>
          Manage
        </AdminButton>
        {/* HC-QA-053 — drafts are private (the share API 404s them by design). */}
        {game.effectiveLifecycle !== "draft" && <ShareButton entityType="game" entityId={game.id} variant="ghost" />}
        {/* Duplicate reuses GameDetail.tsx's "Do it again" via rehost.ts;
            "Host again" is the same action for a past activity. */}
        <ActionMenu
          label={`More actions for ${game.activityLabel}`}
          buttonText=""
          className="ws-icon-menu"
          items={[
            ...(isLive && !isPast
              ? [
                  { label: "Check-in", onSelect: onCheckIn },
                  { label: "Edit activity", onSelect: () => navigate(`/games/host/${game.id}`) },
                  { label: "Post an update", onSelect: () => setPosting(true) },
                ]
              : []),
            { label: isPast ? "Host again" : "Duplicate", onSelect: () => navigate(rehostHref(game)) },
            ...(isLive && !isPast ? [{ label: "Cancel activity…", onSelect: () => setConfirmingCancel(true), danger: true }] : []),
          ]}
        />
      </div>
      <AdminModal
        open={posting}
        onClose={() => setPosting(false)}
        dirty={message.trim().length > 0}
        title="Post an update"
        subtitle={`Everyone going to ${game.activityLabel} on ${dateLabel(game.date)} sees it.`}
        footer={
          <>
            <AdminButton variant="quiet" onClick={() => setPosting(false)}>
              Cancel
            </AdminButton>
            <AdminButton variant="primary" onClick={handlePostUpdate} disabled={busy || !message.trim()}>
              {busy ? "Posting…" : "Post update"}
            </AdminButton>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="adm-field">
            <span>Start from a template</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {UPDATE_TEMPLATES.map((t) => (
                <button key={t.key} type="button" className="adm-chip ws-fchip" onClick={() => setMessage(t.text(game.activityLabel))}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <FormField label="Update" required error={posting ? error : null}>
            {(p) => <textarea {...p} className="adm-input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What's changed, or what should people know?" style={{ resize: "vertical" }} />}
          </FormField>
        </div>
      </AdminModal>
      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this session?"
        message="Everyone who's joined will be notified. This doesn't process a refund for anyone who paid."
        confirmLabel={busy ? "Cancelling…" : "Cancel session"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
      />
    </li>
  );
}

export function ActivitiesTab() {
  const navigate = useNavigate();
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesFailed, setGamesFailed] = useState(false);
  // The managed activity is a page addressed by the URL (`?record=activity:<id>`).
  const [record, openRecord, closeRecord] = useRecordParam();
  const managingId = record?.startsWith("activity:") ? record.slice(9) : null;
  const [checkingInGame, setCheckingInGame] = useState<Game | null>(null);
  const [statusFilter, setStatusFilter] = useUrlParam<ActivityStatusFilter>("astatus", "all");
  const [whenFilter, setWhenFilter] = useUrlParam<ActivityWhenFilter>("awhen", "upcoming");
  const [search, setSearch] = useUrlParam<string>("aq", "");

  const reload = () => {
    setGamesLoading(true);
    setGamesFailed(false);
    fetchMyGames({ hostedOnly: true })
      .then(setGames)
      .catch(() => setGamesFailed(true))
      .finally(() => setGamesLoading(false));
  };

  useEffect(reload, []);

  const today = irelandToday();
  const q = search.trim().toLowerCase();
  const filtered = games.filter((g) => {
    if (!matchesStatusFilter(g, statusFilter)) return false;
    const isUpcoming = g.status !== "cancelled" && g.date >= today;
    if (whenFilter === "upcoming" && !isUpcoming) return false;
    if (whenFilter === "past" && isUpcoming) return false;
    if (q && !g.activityLabel.toLowerCase().includes(q) && !(g.centreName ?? g.locationText).toLowerCase().includes(q)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => (whenFilter === "past" ? (b.date + b.time).localeCompare(a.date + a.time) : (a.date + a.time).localeCompare(b.date + b.time)));

  if (managingId) {
    const managed = games.find((g) => g.id === managingId);
    if (gamesFailed) return <RecordState state="error" backLabel="Activities" onBack={closeRecord} onRetry={reload} />;
    if (gamesLoading && !managed) return <RecordState state="loading" backLabel="Activities" onBack={closeRecord} />;
    if (!managed) return <RecordState state="missing" backLabel="Activities" onBack={closeRecord} message="Only activities you host can be managed here." />;
    return (
      <>
        <ActivityRecord game={managed} onBack={closeRecord} onCheckIn={() => setCheckingInGame(managed)} onChanged={reload} />
        <HostCheckInScreen game={checkingInGame} onClose={() => setCheckingInGame(null)} />
      </>
    );
  }

  if (gamesLoading) return <PageSpinner />;
  if (gamesFailed) return <LoadErrorState title="Couldn't load your activities." onRetry={reload} />;

  return (
    <>
      {games.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={26} />}
          title="Host something people will remember."
          subtitle="Create a session, invite people, and start building your community."
          action={<Button onClick={() => navigate("/games/host?from=manage")}>Create your first activity</Button>}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ActivitiesFilterBar status={statusFilter} onStatus={setStatusFilter} when={whenFilter} onWhen={setWhenFilter} search={search} onSearch={setSearch} />
          {sorted.length === 0 ? (
            <Box>
              <EmptyState icon={<CalendarIcon size={22} />} title="Nothing matches these filters" />
            </Box>
          ) : (
            <Box title={`${WHEN_LABELS[whenFilter]} · ${sorted.length}`} flush>
              <ul className="adm-ov-list">
                {sorted.map((g) => (
                  <ActivityRow key={g.id} game={g} onChanged={reload} onManage={() => openRecord(`activity:${g.id}`)} onCheckIn={() => setCheckingInGame(g)} />
                ))}
              </ul>
            </Box>
          )}
        </div>
      )}
      <HostCheckInScreen game={checkingInGame} onClose={() => setCheckingInGame(null)} />
    </>
  );
}

/** OG-28 — what's recorded for this activity, side by side. Not netted: a
 * profit figure would need an approved rule for shared costs and timing. */
function ActivityMoneyPanel({ gameId }: { gameId: string }) {
  const state = useAdminData(() => fetchActivityMoney(gameId), [gameId]);
  const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;
  return (
    <div style={{ marginTop: 20 }}>
      <Box title="Money for this activity" subtitle="Amounts as recorded, side by side. Payouts are made per settlement for all your activities together; see Earnings.">
        <Loaded state={state} title="Couldn't load the money for this activity">
          {(m) => (
            <Facts
              rows={[
                ["Participants paid", `${money(m.ticketPayments.minor)} (${m.ticketPayments.count} payment${m.ticketPayments.count === 1 ? "" : "s"})`],
                ["Refunded to participants", money(m.refundedMinor)],
                ["Fees recorded", m.recordedOn ? `${money(m.customerFeesMinor + m.platformFeesMinor)} on ${m.recordedOn} payment${m.recordedOn === 1 ? "" : "s"}` : "Not recorded per payment"],
                ["Your share recorded", m.recordedOn ? money(m.partnerShareMinor) : "Not recorded per payment"],
                [
                  "Venue booking",
                  m.venueBooking
                    ? `${m.venueBooking.centreName} · ${m.venueBooking.totalCents ? money(m.venueBooking.totalCents) : "free"}${m.venueBooking.refundedCents ? ` (${money(m.venueBooking.refundedCents)} refunded)` : ""}${m.venueBooking.status === "cancelled" ? " · cancelled" : ""}`
                    : "None",
                ],
              ]}
            />
          )}
        </Loaded>
      </Box>
    </div>
  );
}

function isPastGame(game: Game) {
  return irelandWallTimeToUtc(game.date, game.time).getTime() <= Date.now();
}

const closeLabel = (iso: string) => new Date(iso).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// OG-27 — who can join and when bookings close, plus the join requests on an
// approval activity. Approval is for free activities only (a paid join goes
// straight to checkout); closing bookings never removes anyone already in.
function ActivityBookingSettings({ game, onChanged }: { game: Game; onChanged: () => void }) {
  const toast = useToast();
  const paid = !!game.priceCents && game.priceCents > 0;
  const approval = game.joinMode === "approval";
  const requests = useAdminData(() => fetchGameJoinRequests(game.id), [game.id, approval]);
  const [busy, setBusy] = useState(false);
  const [closeHours, setCloseHours] = useState("");
  const closed = game.effectiveLifecycle === "paused" && !!game.bookingCloseAt && new Date(game.bookingCloseAt).getTime() <= Date.now();
  const save = async (input: Parameters<typeof updateGameBookingSettings>[1], done: string) => {
    setBusy(true);
    try {
      await updateGameBookingSettings(game.id, input);
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };
  const scheduleClose = () => {
    const h = Number(closeHours);
    if (!Number.isInteger(h) || h < 0 || h > 720) return toast.error("Enter a whole number of hours between 0 and 720");
    const at = new Date(irelandWallTimeToUtc(game.date, game.time).getTime() - h * 3_600_000);
    void save({ bookingCloseAt: at.toISOString() }, h === 0 ? "Bookings close at the start" : `Bookings close ${closeLabel(at.toISOString())}`);
    setCloseHours("");
  };
  const answer = async (residentId: string, decision: "approve" | "decline") => {
    setBusy(true);
    try {
      await answerGameJoinRequest(game.id, residentId, decision);
      toast.success(decision === "approve" ? "Approved — they're in" : "Request declined");
      requests.reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't answer that request");
    } finally {
      setBusy(false);
    }
  };
  const pending = (requests.data ?? []).filter((r) => r.status === "requested");
  return (
    <div style={{ marginTop: 20 }}>
      <Box title="Who can join" subtitle="People already in keep their place whatever you change here.">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <strong>{approval ? "You approve each person" : "Anyone can join straight away"}</strong>
              <div className="adm-note">{paid ? "Join approval is only for free activities." : approval ? "People ask to join; they're in once you approve." : "Turn on approval to choose who joins."}</div>
            </div>
            {!paid && (
              <AdminButton disabled={busy} onClick={() => save({ joinMode: approval ? "open" : "approval" }, approval ? "Anyone can join now" : "You'll approve each person")}>
                {approval ? "Let anyone join" : "Approve each person"}
              </AdminButton>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <strong>{closed ? "Bookings are closed" : game.bookingCloseAt ? `Bookings close ${closeLabel(game.bookingCloseAt)}` : "Bookings stay open until the start"}</strong>
              <div className="adm-note">Closing stops new joins and requests.</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              {closed || game.bookingCloseAt ? (
                <AdminButton disabled={busy} onClick={() => save({ bookingCloseAt: null }, "Bookings are open until the start")}>
                  {closed ? "Reopen bookings" : "Remove closing time"}
                </AdminButton>
              ) : (
                <>
                  <FormField label="Hours before the start">
                    {(p) => <input {...p} type="number" min={0} max={720} className="adm-input" style={{ width: 110 }} value={closeHours} onChange={(e) => setCloseHours(e.target.value)} />}
                  </FormField>
                  <AdminButton disabled={busy || closeHours === ""} onClick={scheduleClose}>
                    Set closing time
                  </AdminButton>
                  <AdminButton disabled={busy} onClick={() => save({ bookingCloseAt: new Date().toISOString() }, "Bookings closed")}>
                    Close now
                  </AdminButton>
                </>
              )}
            </div>
          </div>
        </div>
      </Box>
      {(approval || (requests.data?.length ?? 0) > 0) && (
        <div style={{ marginTop: 20 }}>
          <Box flush title={`Join requests${pending.length ? ` (${pending.length})` : ""}`}>
            <Loaded state={requests} title="Couldn't load join requests">
              {(rows) =>
                rows.length === 0 ? (
                  <p className="adm-note" style={{ padding: "12px 24px", margin: 0 }}>No requests yet.</p>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {rows.map((r) => (
                      <li key={r.residentId} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                        <div>
                          <strong>{r.name}</strong>
                          <div className="adm-note">
                            {r.status === "requested" ? "Waiting for you" : r.status === "approved" ? "Approved" : r.status === "declined" ? "Declined" : "Withdrawn"}
                            {r.message ? ` · "${r.message}"` : ""}
                          </div>
                        </div>
                        {r.status === "requested" && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <AdminButton size="sm" variant="primary" disabled={busy} onClick={() => answer(r.residentId, "approve")} aria-label={`Approve ${r.name}`}>
                              Approve
                            </AdminButton>
                            <AdminButton size="sm" disabled={busy} onClick={() => answer(r.residentId, "decline")} aria-label={`Decline ${r.name}`}>
                              Decline
                            </AdminButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              }
            </Loaded>
          </Box>
        </div>
      )}
    </div>
  );
}

// OG-26 — the weekly series this activity is part of. Each date is still an
// ordinary activity; cancelling the rest cancels each upcoming date exactly as
// a single cancel would (participants are told; the usual refund handling).
function ActivitySeriesPanel({ seriesId, currentId, onChanged }: { seriesId: string; currentId: string; onChanged: () => void }) {
  const toast = useToast();
  const state = useAdminData(() => fetchGameSeries(seriesId), [seriesId]);
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ marginTop: 20 }}>
      <Box flush title="Weekly series" subtitle="Each date has its own places and participants.">
        <Loaded state={state} title="Couldn't load this series">
          {(series) => {
            const upcoming = series.games.filter((g) => g.status !== "cancelled" && !isPastGame(g));
            return (
              <>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {series.games.map((g) => (
                    <li key={g.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 24px", borderTop: "1px solid var(--adm-line)", fontSize: 13.5 }}>
                      <span style={{ fontWeight: g.id === currentId ? 700 : 400 }}>
                        {dateLabel(g.date)} · {g.time}
                        {g.id === currentId ? " (this one)" : ""}
                      </span>
                      <span className="adm-note">{g.status === "cancelled" ? "Cancelled" : isPastGame(g) ? "Done" : `${g.joined}/${g.capacity} joined`}</span>
                    </li>
                  ))}
                </ul>
                {upcoming.length > 0 && (
                  <div style={{ padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                    <AdminButton onClick={() => setConfirming(true)}>Cancel the {upcoming.length} remaining date{upcoming.length === 1 ? "" : "s"}</AdminButton>
                  </div>
                )}
                <ConfirmDialog
                  open={confirming}
                  title={`Cancel ${upcoming.length} remaining date${upcoming.length === 1 ? "" : "s"}?`}
                  message="Everyone who joined those dates is told, and each is handled exactly like cancelling it on its own. Dates that have already happened stay as they are."
                  confirmLabel="Cancel remaining dates"
                  onConfirm={async () => {
                    const r = await cancelRemainingGameSeries(seriesId);
                    toast.success(`${r.cancelled} date${r.cancelled === 1 ? "" : "s"} cancelled`);
                    setConfirming(false);
                    state.reload();
                    onChanged();
                  }}
                  onCancel={() => setConfirming(false)}
                />
              </>
            );
          }}
        </Loaded>
      </Box>
    </div>
  );
}
