import { useEffect, useState } from "react";
import { dateLabel } from "../euro";
import { useNavigate } from "react-router-dom";
import { cancelGame, fetchGameParticipantsForManage, fetchGameWaitlist, fetchMyGames, offerGameWaitlistEntry, postGameUpdate, refundGameParticipant, removeGameParticipant } from "../api";
import { deriveActivityStatus } from "../activityStatus";
import { rehostHref } from "../rehost";
import { CalendarIcon, SearchIcon } from "./icons";
import { HostCheckInScreen } from "./HostCheckInScreen";
import { ShareButton } from "./ShareButton";
import { Avatar, Button, Card, ConfirmDialog, EmptyState, LoadErrorState, PageSpinner, ProgressBar } from "./ui";
import { RecordState, RecordView } from "./workspace/RecordView";
import { ActionMenu } from "./ActionMenu";
import { Facts, SectionLabel } from "./admin/adminUi";
import { useRecordParam, useUrlParam } from "../useUrlTab";
import { euro } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { Game, ManageParticipant, WaitlistEntry } from "../types";
import { irelandToday } from "../irelandDate";

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

function activityFilterPillStyle(active: boolean) {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: radius.pill,
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
        {(["all", "draft", "coming_soon", "open", "pending_participants", "cancelled"] as const).map((s) => (
          <button key={s} onClick={() => onStatus(s)} style={activityFilterPillStyle(status === s)} aria-pressed={status === s}>
            {STATUS_FILTER_LABELS[s]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 200px", minWidth: 160 }}>
        <SearchIcon size={13} style={{ color: colors.faint, flex: "none" }} />
        <input aria-label="Search activities"
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
function ActivityRecord({ game, onBack, onCheckIn }: { game: Game; onBack: () => void; onCheckIn: () => void }) {
  const navigate = useNavigate();
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
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{paid ? euro(game.priceCents ?? 0) : "Free"}</span>
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate(`/games/${game.id}`)}>View public page</Button>
          {s.label !== "Cancelled" && game.status !== "cancelled" && (
            <>
              <Button variant="ghost" onClick={onCheckIn}>Check-in</Button>
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
              ["Price", paid ? `${euro(game.priceCents ?? 0)} per place` : "Free"],
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
        title={`Refund ${euro(game.priceCents ?? 0)} to ${refundTarget?.name ?? "this participant"}?`}
        message="Returns their full payment through Stripe. It can't be undone and doesn't remove them from the activity."
        confirmLabel="Issue refund"
        tone="neutral"
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
      />
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
          <Button variant="ghost" onClick={onManage} aria-label={`Manage ${game.activityLabel}`}>Manage activity</Button>
          {/* HC-QA-053 — drafts are private (the share API 404s them by
              design), same rule as HostGamePage's create confirmation. */}
          {game.effectiveLifecycle !== "draft" && <ShareButton entityType="game" entityId={game.id} variant="ghost" />}
          {/* Duplicate (Host Experience Polish) — any status, reuses the
              same param-carrying logic as GameDetail.tsx's "Do it again"
              via the shared rehost.ts helper. "Host again" below is the
              same action, just labeled for a past activity's context. */}
          {/* UI completion — secondary actions in one anchored menu. */}
          <ActionMenu
            label={`More actions for ${game.activityLabel}`}
            items={[
              ...(isLive && !isPast
                ? [
                    { label: "Check-in", onSelect: onCheckIn },
                    { label: "Edit activity", onSelect: () => navigate(`/games/host/${game.id}`) },
                    { label: posting ? "Hide update form" : "Post an update", onSelect: () => setPosting((v) => !v) },
                  ]
                : []),
              { label: isPast ? "Host again" : "Duplicate", onSelect: () => navigate(rehostHref(game)) },
              ...(isLive && !isPast ? [{ label: "Cancel activity…", onSelect: () => setConfirmingCancel(true), danger: true }] : []),
            ]}
          />
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
            <input aria-label="Update message"
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
        <ActivityRecord game={managed} onBack={closeRecord} onCheckIn={() => setCheckingInGame(managed)} />
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
                <ActivityRow key={g.id} game={g} onChanged={reload} onManage={() => openRecord(`activity:${g.id}`)} onCheckIn={() => setCheckingInGame(g)} />
              ))}
            </div>
          )}
        </div>
      )}
      <HostCheckInScreen game={checkingInGame} onClose={() => setCheckingInGame(null)} />
    </>
  );
}
