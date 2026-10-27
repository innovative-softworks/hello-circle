import { ListFilterBar, NoMatches, useListFilters } from "../components/workspace/ListFilters";
import { CategoryPicker, TagPicker, type CategoryValue } from "../components/categories/CategoryPicker";
import { ActionMenu } from "../components/ActionMenu";
import { usePageTitle } from "../pageTitle";
import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelGame,
  demoteCircleMember,
  fetchCentres,
  fetchCircle,
  fetchCircleInvitations,
  fetchCircleJoinRequests,
  fetchCircleMembers,
  fetchCircleMembership,
  fetchCirclePlanIdeas,
  fetchCirclePlansForManage,
  fetchGameParticipantsForManage,
  inviteToCircle,
  postGameUpdate,
  promoteCircleMember,
  muteCircleMember,
  unmuteCircleMember,
  refundGameParticipant,
  removeCircleMember,
  removeGameParticipant,
  respondToCircleJoinRequest,
  revokeCircleInvitation,
  setCircleStatus,
  updateCircle,
} from "../api";
import type { CircleInvitationSummary, CircleJoinRequest } from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon, PlusIcon, UsersIcon } from "../components/icons";
import { WorkspaceShell } from "../components/workspace/WorkspaceShell";
import { useUrlTab } from "../useUrlTab";
import { ArrowLeft, CalendarDays, ExternalLink, Lightbulb, Settings, ShieldAlert, UsersRound } from "lucide-react";
import { ManageCirclePlanning, RemovedMembersCard } from "../components/circle/ManageCircleExtras";
import { AdminButton } from "../components/admin/adminUi";
import { ContextActions, ContextSection, CopyValue, DetailFacts, DetailHero, DetailStats } from "../components/workspace/DetailParts";
import { CircleModerationTab } from "../components/CircleModerationTab";
import { ResidentPicker } from "../components/ResidentPicker";
import { SingleImageUpload } from "../components/SingleImageUpload";
import { getCircleCoverUrl, getMediaUrl } from "../media";
import { dateLabel } from "../euro";
import { Avatar, Button, Card, ConfirmDialog, EmptyState, LoadErrorState, Modal, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
import { PersonalAccountGate } from "../components/workspace/PersonalAccountGate";
import { useAuth } from "../AuthContext";
import { colors, fonts, radius } from "../theme";
import type { Centre, Circle, ManageCircleMember, ManageCirclePlan, ManageParticipant } from "../types";

// HelloCircle Manage (Phase 4, Circle Organiser MVP) — a resident-
// authenticated surface on ManageShell, separate from the combined
// /manage dashboard (ManageHome.tsx)'s Overview/Activities/Circles tabs.
// An organiser's real management unit is a single circle's own
// Plans/Members/Settings, not a flat list of circles — the Circles tab on
// /manage (and the Header dropdown's per-circle "Manage {name}" entries)
// both link into this page for one specific circle; this page's own
// ManageShell nav is scoped to tabs within that one circle.

type CircleTab = "plans" | "ideas" | "members" | "moderation" | "settings";
type CircleNavKey = CircleTab | "overview";
const I = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;
const NAV_OPTIONS: { key: CircleNavKey; label: string; icon: JSX.Element; group: string; summary?: string }[] = [
  { key: "plans", label: "Plans", icon: <CalendarDays {...I} />, group: "This Circle", summary: "Official plans for this Circle, and ideas members have suggested." },
  { key: "ideas", label: "Pulse & proposals", icon: <Lightbulb {...I} />, group: "This Circle", summary: "What members want to do, and suggested plans to confirm or turn into activities." },
  { key: "members", label: "Members", icon: <UsersRound {...I} />, group: "This Circle", summary: "Members, join requests, invitations, organiser roles and removed members." },
  { key: "moderation", label: "Moderation", icon: <ShieldAlert {...I} />, group: "This Circle", summary: "Announcements, reported messages, muted members and history." },
  { key: "settings", label: "Settings", icon: <Settings {...I} />, group: "This Circle", summary: "Name, description, cover, how people join, and closing the Circle." },
  { key: "overview", label: "Back to Host workspace", icon: <ArrowLeft {...I} />, group: "Host workspace" },
];
const CIRCLE_TABS: CircleTab[] = ["plans", "ideas", "members", "moderation", "settings"];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    open: { bg: colors.greenBg, fg: colors.greenText, label: "Open" },
    pending_participants: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Pending players" },
    cancelled: { bg: colors.dangerBg, fg: colors.danger, label: "Cancelled" },
  };
  const s = map[status] ?? { bg: colors.panel, fg: colors.muted, label: status };
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, borderRadius: radius.pill, padding: "2px 8px" }}>{s.label}</span>;
}

function ParticipantsModal({ gameId, onClose }: { gameId: string | null; onClose: () => void }) {
  const [participants, setParticipants] = useState<ManageParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManageParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Platform Pre-Launch Polish — Changeset 4D. This popup only gets a
  // gameId, not the full Game (unlike HostActivitiesTab.tsx's own copy of
  // this component), so the confirm dialog can't quote a specific amount —
  // the server still refunds the real, exact amount regardless.
  const [refundTarget, setRefundTarget] = useState<ManageParticipant | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    fetchGameParticipantsForManage(gameId)
      .then(setParticipants)
      .finally(() => setLoading(false));
  }, [gameId]);

  const handleRemove = async () => {
    if (!gameId || !removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeGameParticipant(gameId, removeTarget.residentId);
      setParticipants((prev) => prev.map((p) => (p.residentId === removeTarget.residentId ? { ...p, status: "cancelled" } : p)));
      setRemoveTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this participant");
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async () => {
    if (!gameId || !refundTarget) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      await refundGameParticipant(gameId, refundTarget.residentId);
      setParticipants((prev) => prev.map((p) => (p.residentId === refundTarget.residentId ? { ...p, paymentStatus: "refunded" } : p)));
      setRefundTarget(null);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Couldn't issue this refund");
    } finally {
      setRefundBusy(false);
    }
  };

  return (
    <Modal
      open={!!gameId}
      onClose={onClose}
      title="Participants"
      subtitle={loading ? undefined : `${participants.filter((p) => p.status !== "cancelled").length} joined`}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      {loading ? (
        <PageSpinner />
      ) : participants.length === 0 ? (
        <EmptyState icon={<CalendarIcon size={26} />} title="No one's joined yet" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {participants.map((p) => {
            const canRefund = p.paymentStatus === "paid";
            const statusLabel = p.status === "cancelled" ? "Cancelled" : p.status === "pending_payment" ? "Payment pending" : "Joined";
            return (
              <div key={p.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={p.name} size={30} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: colors.mutedLight }}>
                      {statusLabel}{p.paymentStatus === "refunded" ? " · Refunded" : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  {canRefund && (
                    <button onClick={() => setRefundTarget(p)} style={{ background: "none", border: "none", color: colors.text, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Refund
                    </button>
                  )}
                  {p.status !== "cancelled" && (
                    <button onClick={() => setRemoveTarget(p)} style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this participant?"
        message={`${removeTarget?.name ?? "This participant"} will be notified and their spot will open up.`}
        confirmLabel={busy ? "Removing…" : "Remove"}
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!refundTarget}
        title={`Refund ${refundTarget?.name ?? "this participant"}?`}
        message="This will return their full payment. Cancellation and refund are tracked separately."
        confirmLabel={refundBusy ? "Refunding…" : "Refund"}
        tone="neutral"
        busy={refundBusy}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
      >
        {refundError && <p style={{ color: colors.danger, fontSize: 13 }}>{refundError}</p>}
      </ConfirmDialog>
    </Modal>
  );
}

function PlanRow({ plan, circleId, onChanged, onManageParticipants }: { plan: ManageCirclePlan; circleId: string; onChanged: () => void; onManageParticipants: () => void }) {
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
      await postGameUpdate(plan.id, message.trim());
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
      await cancelGame(plan.id);
      setConfirmingCancel(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel this plan");
    } finally {
      setBusy(false);
    }
  };

  const isLive = plan.status !== "cancelled";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>{plan.activityLabel}</span>
            {statusBadge(plan.status)}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>
            {plan.date} · {plan.time} · {plan.centreName ?? "—"} · {plan.joined}/{plan.capacity} joined
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onManageParticipants} aria-label={`Participants of ${plan.activityLabel}`}>Participants</Button>
          {isLive && (
            <ActionMenu
              label={`More actions for ${plan.activityLabel}`}
              items={[
                { label: "Edit plan", onSelect: () => navigate(`/games/host/${plan.id}`) },
                { label: posting ? "Hide update form" : "Post an update", onSelect: () => setPosting((v) => !v) },
                { label: "Cancel plan…", onSelect: () => setConfirmingCancel(true), danger: true },
              ]}
            />
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
        title="Cancel this plan?"
        message="Everyone who's joined will be notified. This doesn't process a refund for anyone who paid."
        confirmLabel={busy ? "Cancelling…" : "Cancel plan"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirmingCancel(false)}
      />
    </Card>
  );
}

function PlansTab({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<ManageCirclePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [managingGameId, setManagingGameId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetchCirclePlansForManage(circle.id)
      .then(setPlans)
      .finally(() => setLoading(false));
  };

  useEffect(reload, [circle.id]);

  if (loading) return <PageSpinner />;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {plans.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={26} />}
          title="Nothing planned yet."
          subtitle="Start with an idea for something your Circle could do together."
          action={<Button onClick={() => navigate(`/games/host?activity=${encodeURIComponent(circle.activityLabel)}&circleId=${circle.id}`)}><PlusIcon size={14} /> Create a plan</Button>}
        />
      ) : (
        plans.map((p) => <PlanRow key={p.id} plan={p} circleId={circle.id} onChanged={reload} onManageParticipants={() => setManagingGameId(p.id)} />)
      )}
      <ParticipantsModal gameId={managingGameId} onClose={() => setManagingGameId(null)} />
    </div>
  );
}

function JoinRequestsCard({ circle }: { circle: Circle }) {
  const confirm = useConfirm();
  const [requests, setRequests] = useState<CircleJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetchCircleJoinRequests(circle.id)
      .then(setRequests)
      .finally(() => setLoading(false));
  };

  useEffect(reload, [circle.id]);

  const respond = async (requestId: string, accept: boolean) => {
    if (!accept) {
      const name = requests.find((r) => r.id === requestId)?.name ?? "this person";
      const ok = await confirm({
        title: `Decline ${name}'s request?`,
        message: "They won't be added to the Circle. They can ask again later.",
        confirmLabel: "Decline",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusyId(requestId);
    try {
      await respondToCircleJoinRequest(circle.id, requestId, accept);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setBusyId(null);
    }
  };

  // Only relevant for an approval-mode Circle — a non-approval Circle has
  // no join-request concept at all, so this stays dead space for that case.
  // An approval Circle with an empty inbox DOES get a card now (Circle
  // Experience Polish — Changeset 5) — it used to vanish entirely, which
  // read as broken rather than "nothing pending right now".
  if (circle.joinMode !== "approval" || loading) return null;

  return (
    <Card>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Join requests</h2>
      {requests.length === 0 && (
        <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight }}>You're all caught up. New join requests will appear here.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {requests.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minWidth: 0, flex: "1 1 220px" }}>
              <Avatar name={r.name} size={30} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
                {/* Booking UX Phase 5 — what they wrote, and their answers. */}
                {r.note && <div style={{ fontSize: 13, color: colors.textSoft, marginTop: 4, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>"{r.note}"</div>}
                {(r.answers ?? []).map((a) => (
                  <div key={a.question} style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 4, overflowWrap: "anywhere" }}>
                    <span style={{ fontWeight: 600, color: colors.muted }}>{a.question}</span> {a.answer}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => respond(r.id, false)} disabled={busyId === r.id} style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                Decline
              </button>
              <button onClick={() => respond(r.id, true)} disabled={busyId === r.id} style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                {busyId === r.id ? "…" : "Approve"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Phase 11B — organiser view of pending organiser-sent invitations, with
// "Revoke invitation". Revoking withdraws the invite only; existing members
// are never affected (they're managed in the Members list below).
function PendingInvitationsCard({ circle, refreshKey }: { circle: Circle; refreshKey: number }) {
  const confirm = useConfirm();
  const [invites, setInvites] = useState<CircleInvitationSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const reload = () => {
    setLoadError(null);
    fetchCircleInvitations(circle.id)
      .then(setInvites)
      .catch(() => setLoadError("Couldn't load pending invitations."));
  };
  useEffect(reload, [circle.id, refreshKey]);

  const revoke = async (inv: CircleInvitationSummary) => {
    if (busyId) return;
    const ok = await confirm({
      title: `Revoke ${inv.residentName}'s invitation?`,
      message: "They won't be able to accept it or use it to join. You can invite them again later.",
      confirmLabel: "Revoke invitation",
      cancelLabel: "Keep invitation",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(inv.id);
    setMessage(null);
    try {
      const result = await revokeCircleInvitation(circle.id, inv.id);
      setMessage({ tone: "ok", text: result.alreadyRevoked ? `${inv.residentName}'s invitation was already revoked.` : `Invitation to ${inv.residentName} revoked.` });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error && e.message ? e.message : "Couldn't revoke this invitation — please try again." });
    } finally {
      setBusyId(null);
      reload();
    }
  };

  if (invites.length === 0 && !loadError && !message) return null;

  return (
    <Card>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Pending invitations</h2>
      <div aria-live="polite" role={message?.tone === "error" || loadError ? "alert" : "status"} style={{ fontSize: 13, fontWeight: 600, marginBottom: message || loadError ? 10 : 0, color: message?.tone === "error" || loadError ? colors.danger : colors.greenText }}>
        {loadError ?? message?.text}
      </div>
      <ul aria-label="Pending invitations" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {invites.map((inv) => (
          <li key={inv.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={inv.residentName} size={30} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{inv.residentName}</div>
                <div style={{ fontSize: 11.5, color: colors.mutedLight }}>Invited by {inv.invitedByName}</div>
              </div>
            </div>
            <button
              type="button"
              className="btn-reset"
              onClick={() => revoke(inv)}
              disabled={busyId !== null}
              aria-label={`Revoke invitation to ${inv.residentName}`}
              style={{ color: colors.danger, fontWeight: 700, fontSize: 12.5, padding: "4px 2px", cursor: busyId ? "default" : "pointer" }}
            >
              {busyId === inv.id ? "Revoking…" : "Revoke invitation"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MembersTab({ circle }: { circle: Circle }) {
  const [inviteRefresh, setInviteRefresh] = useState(0);
  const confirm = useConfirm();
  const [members, setMembers] = useState<ManageCircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<ManageCircleMember | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removedRefresh, setRemovedRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleActionId, setRoleActionId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const organiserCount = members.filter((m) => m.role === "organiser").length;

  const [loadFailed, setLoadFailed] = useState(false);
  const [muteTarget, setMuteTarget] = useState<ManageCircleMember | null>(null);
  const [muteHours, setMuteHours] = useState(24);
  const [muteReason, setMuteReason] = useState("");
  const reload = () => {
    setLoading(true);
    setLoadFailed(false);
    fetchCircleMembers(circle.id, true)
      .then((res) => setMembers(res.members))
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  };
  const mute = async () => {
    if (!muteTarget) return;
    await muteCircleMember(circle.id, muteTarget.residentId, muteHours, muteReason.trim() || undefined);
    setMuteTarget(null);
    setMuteReason("");
    reload();
  };
  const unmute = async (m: ManageCircleMember) => {
    setRoleActionId(m.residentId);
    setRoleError(null);
    try {
      await unmuteCircleMember(circle.id, m.residentId);
      setMembers((prev) => prev.map((x) => (x.residentId === m.residentId ? { ...x, mutedUntil: null } : x)));
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : "Couldn't unmute this member");
    } finally {
      setRoleActionId(null);
    }
  };

  useEffect(reload, [circle.id]);

  const handleRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeCircleMember(circle.id, removeTarget.residentId, removeReason.trim() || undefined);
      setMembers((prev) => prev.filter((m) => m.residentId !== removeTarget.residentId));
      setRemoveTarget(null);
      setRemoveReason("");
      setRemovedRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this member");
    } finally {
      setBusy(false);
    }
  };

  // Vendor-parity pass, Phase 26 — co-organisers. Direct actions (no confirm
  // dialog, mirroring the low-stakes waitlist "Invite" button pattern),
  // since either direction is reversible, unlike Remove.
  const promote = async (m: ManageCircleMember) => {
    const ok = await confirm({
      title: `Make ${m.name} an organiser?`,
      message: "Organisers can edit the Circle, approve join requests, create plans and remove members.",
      confirmLabel: "Make organiser",
    });
    if (!ok) return;
    setRoleActionId(m.residentId);
    setRoleError(null);
    try {
      await promoteCircleMember(circle.id, m.residentId);
      setMembers((prev) => prev.map((x) => (x.residentId === m.residentId ? { ...x, role: "organiser" } : x)));
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : "Couldn't make this member an organiser");
    } finally {
      setRoleActionId(null);
    }
  };

  const demote = async (m: ManageCircleMember) => {
    const ok = await confirm({
      title: `Remove ${m.name} as an organiser?`,
      message: "They'll stay a member but won't be able to manage the Circle any more.",
      confirmLabel: "Remove organiser",
      tone: "danger",
    });
    if (!ok) return;
    setRoleActionId(m.residentId);
    setRoleError(null);
    try {
      await demoteCircleMember(circle.id, m.residentId);
      setMembers((prev) => prev.map((x) => (x.residentId === m.residentId ? { ...x, role: "member" } : x)));
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : "Couldn't remove this organiser");
    } finally {
      setRoleActionId(null);
    }
  };

  const memberFilters = useListFilters<(typeof members)[number]>({
    param: "mq",
    search: (m) => [m.name],
    selects: [{ param: "mrole", label: "Role", options: [{ value: "organiser", label: "Organisers" }, { value: "member", label: "Members" }], get: (m) => (m.role === "organiser" ? "organiser" : "member") }],
  });
  const shownMembers = memberFilters.apply(members);
  if (loading) return <PageSpinner />;
  if (loadFailed) return <LoadErrorState title="Couldn't load the members" onRetry={reload} />;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <JoinRequestsCard circle={circle} />
      <Card>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Invite someone</h2>
        <ResidentPicker onInvite={async (residentId) => { await inviteToCircle(circle.id, residentId); setInviteRefresh((n) => n + 1); }} />
      </Card>
      <PendingInvitationsCard circle={circle} refreshKey={inviteRefresh} />
      <RemovedMembersCard circleId={circle.id} refreshKey={removedRefresh} />
      <Card>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Members</h2>
        {roleError && <p style={{ color: colors.danger, fontSize: 12.5, margin: "0 0 10px" }}>{roleError}</p>}
        {/* Circle Experience Polish — Changeset 5. `members` always
            includes the organiser themselves, so the real "empty" case is
            <= 1, not 0. */}
        {members.length <= 1 && (
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: colors.mutedLight }}>It's just you for now. Invite a few people to get the Circle moving.</p>
        )}
        {members.length > 8 && <ListFilterBar state={memberFilters} searchLabel="Search members" placeholder="Name" />}
        {shownMembers.length === 0 && <NoMatches onClear={memberFilters.clear} noun="members" />}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shownMembers.map((m) => (
            <div key={m.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={m.name} size={30} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name}</div>
                  {m.role === "organiser" && <div style={{ fontSize: 11.5, color: colors.mutedLight }}>Organiser</div>}
                  {m.mutedUntil && <div style={{ fontSize: 11.5, color: colors.orangeDark }}>Messages paused until {new Date(m.mutedUntil).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</div>}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {m.role === "organiser" ? (
                  organiserCount > 1 && (
                    <button onClick={() => demote(m)} disabled={roleActionId === m.residentId} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      {roleActionId === m.residentId ? "Removing…" : "Remove as organiser"}
                    </button>
                  )
                ) : (
                  <button onClick={() => promote(m)} disabled={roleActionId === m.residentId} style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                    {roleActionId === m.residentId ? "Making organiser…" : "Make organiser"}
                  </button>
                )}
                {m.role !== "organiser" &&
                  (m.mutedUntil ? (
                    <button onClick={() => unmute(m)} disabled={roleActionId === m.residentId} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Unmute
                    </button>
                  ) : (
                    <button onClick={() => setMuteTarget(m)} style={{ background: "none", border: "none", color: colors.muted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                      Mute
                    </button>
                  ))}
                {m.role !== "organiser" && (
                  <button onClick={() => setRemoveTarget(m)} style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this member?"
        message={`${removeTarget?.name ?? "This member"} will be notified and lose access to this Circle. They can't rejoin or ask to join again until an organiser lifts it under Removed members.`}
        confirmLabel={busy ? "Removing…" : "Remove"}
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        <label htmlFor="circle-remove-reason" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Reason (optional, kept with the record — not shown to them)
        </label>
        <input id="circle-remove-reason" value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} maxLength={500} style={inputStyle} />
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!muteTarget}
        title={`Pause ${muteTarget?.name ?? "this member"}'s messages?`}
        message="They can still read the chat and join plans, but can't post until the time is up. They're told their messages are paused."
        confirmLabel="Mute"
        tone="neutral"
        onConfirm={mute}
        onCancel={() => setMuteTarget(null)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="circle-mute-hours" style={{ fontSize: 13, fontWeight: 600 }}>For how long</label>
          <select id="circle-mute-hours" value={muteHours} onChange={(e) => setMuteHours(Number(e.target.value))} style={inputStyle}>
            <option value={1}>1 hour</option>
            <option value={24}>1 day</option>
            <option value={168}>7 days</option>
          </select>
          <label htmlFor="circle-mute-reason" style={{ fontSize: 13, fontWeight: 600 }}>Reason (optional, kept with the record)</label>
          <input id="circle-mute-reason" value={muteReason} onChange={(e) => setMuteReason(e.target.value)} style={inputStyle} />
        </div>
      </ConfirmDialog>
    </div>
  );
}

function SettingsTab({ circle, onSaved }: { circle: Circle; onSaved: (c: Circle) => void }) {
  const navigate = useNavigate();
  const [centres, setCentres] = useState<Centre[]>([]);
  const [form, setForm] = useState({
    name: circle.name,
    activityLabel: circle.activityLabel,
    area: circle.area,
    county: circle.county,
    about: circle.about,
    centreId: circle.centreId ?? "",
    joinMode: circle.joinMode,
    whatWeDo: circle.whatWeDo ?? "",
    whoCanJoin: circle.whoCanJoin ?? "",
    values: circle.values ?? "",
    soloWelcome: circle.soloWelcome === true ? "yes" : circle.soloWelcome === false ? "no" : "",
    // Booking UX Phase 5 — up to three questions for an approval Circle.
    joinQuestions: [...(circle.joinQuestions ?? []), "", "", ""].slice(0, 3),
    category: (circle.taxonomy ? { categoryId: circle.taxonomy.categoryId, subcategoryId: circle.taxonomy.subcategoryId } : null) as CategoryValue | null,
    tags: circle.tags ?? [],
  });
  // The cover photo is tracked separately from the rest of the form. For a
  // restricted Circle, `circle.imageUrl` is deliberately always null
  // (Media plan Task 2 — the raw permanent URL never leaves the server for
  // a non-open Circle), so there's no current value to seed a form field
  // with; the organiser's own preview instead goes through the protected
  // endpoint (getCircleCoverUrl()). `photoChange` stays undefined until
  // they actually upload/remove a cover in this session — only then is
  // `imageUrl` included in the save payload at all (an explicit "" clears
  // it, a real URL replaces it); leaving it undefined relies on the
  // server's COALESCE to leave whatever's already stored untouched, so an
  // unrelated edit (e.g. just "About") can never silently wipe the cover.
  const [photoChange, setPhotoChange] = useState<string | null | undefined>(undefined);
  const photoPreview = photoChange !== undefined ? photoChange : getCircleCoverUrl(circle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    fetchCentres().then(setCentres);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCircle(circle.id, {
        name: form.name,
        activityLabel: form.activityLabel || undefined,
        area: form.area || undefined,
        county: form.county || undefined,
        about: form.about || undefined,
        centreId: form.centreId || undefined,
        joinMode: form.joinMode,
        imageUrl: photoChange !== undefined ? photoChange ?? "" : undefined,
        whatWeDo: form.whatWeDo || undefined,
        whoCanJoin: form.whoCanJoin || undefined,
        values: form.values || undefined,
        soloWelcome: form.soloWelcome === "yes" ? true : form.soloWelcome === "no" ? false : null,
        // Only an approval Circle edits its questions; otherwise they're left as they are.
        joinQuestions: form.joinMode === "approval" ? form.joinQuestions.map((q) => q.trim()).filter(Boolean) : undefined,
        // Sent only when the detail response carried them, so an older
        // response shape can never clear a saved category.
        ...(circle.taxonomy !== undefined ? { categoryId: form.category?.categoryId ?? "", subcategoryId: form.category?.subcategoryId ?? null } : {}),
        ...(circle.tags !== undefined ? { tags: form.tags } : {}),
      });
      onSaved(updated);
      setPhotoChange(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save these changes");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    setClosing(true);
    try {
      await setCircleStatus(circle.id, "closed");
      onSaved({ ...circle, status: "closed" });
      setConfirmingClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close this Circle");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <SingleImageUpload
            value={photoPreview}
            onChange={setPhotoChange}
            mediaEntityType="circle-cover"
            mediaEntityId={circle.id}
          />
        </div>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Activity</label>
            <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <CategoryPicker family="circle" label="What's your Circle about?" value={form.category} current={circle.taxonomy ?? null} onChange={(next) => setForm((f) => ({ ...f, category: next }))} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <TagPicker value={form.tags} onChange={(next) => setForm((f) => ({ ...f, tags: next }))} />
          </div>
          <div>
            <label style={labelStyle}>Area</label>
            <input value={form.area} onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>County</label>
            <input value={form.county} onChange={(e) => setForm((f) => ({ ...f, county: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Venue (optional)</label>
            <select value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))} style={inputStyle}>
              <option value="">No linked venue</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Who can join</label>
            <select value={form.joinMode} onChange={(e) => setForm((f) => ({ ...f, joinMode: e.target.value as Circle["joinMode"] }))} style={inputStyle}>
              <option value="open">Open — anyone can join instantly</option>
              <option value="approval">Approval — you approve each request</option>
              <option value="invite">Invite only — you add members yourself</option>
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>About</label>
            <textarea value={form.about} onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>What we do (optional)</label>
            <textarea value={form.whatWeDo} onChange={(e) => setForm((f) => ({ ...f, whatWeDo: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Who can join (optional)</label>
            <textarea value={form.whoCanJoin} onChange={(e) => setForm((f) => ({ ...f, whoCanJoin: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="mc-solo" style={labelStyle}>
              Do people often come on their own? (optional)
            </label>
            <select id="mc-solo" value={form.soloWelcome} onChange={(e) => setForm((f) => ({ ...f, soloWelcome: e.target.value }))} style={inputStyle}>
              <option value="">Don't say</option>
              <option value="yes">Yes — people often come on their own</option>
              <option value="no">No — most come with someone</option>
            </select>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-muted-light)" }}>Shown to people thinking of joining, only if you choose Yes.</p>
          </div>
          {form.joinMode === "approval" && (
            <fieldset style={{ gridColumn: "1 / -1", border: "none", margin: 0, padding: 0 }}>
              <legend style={{ ...labelStyle, padding: 0 }}>Questions for people asking to join (optional, up to three)</legend>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {form.joinQuestions.map((q, i) => (
                  <input
                    key={i}
                    aria-label={`Question ${i + 1}`}
                    value={q}
                    maxLength={200}
                    placeholder={i === 0 ? "e.g. How often can you make it?" : ""}
                    onChange={(e) => setForm((f) => ({ ...f, joinQuestions: Object.assign([...f.joinQuestions], { [i]: e.target.value }) }))}
                    style={inputStyle}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Our values (optional)</label>
            <textarea value={form.values} onChange={(e) => setForm((f) => ({ ...f, values: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
        {error && <p style={{ color: colors.danger, fontSize: 13, marginTop: 12 }}>{error}</p>}
        <div style={{ marginTop: 16 }}>
          <Button onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </Card>
      {circle.status === "active" && (
        <Card>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 8px" }}>Danger zone</h2>
          <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 12px" }}>Closing this Circle removes it from public browse and notifies every member.</p>
          <Button variant="danger" onClick={() => setConfirmingClose(true)}>Close this Circle</Button>
        </Card>
      )}
      <ConfirmDialog
        open={confirmingClose}
        title="Close this Circle?"
        message="Every member will be notified. This can't be easily undone from here."
        confirmLabel={closing ? "Closing…" : "Close Circle"}
        busy={closing}
        onConfirm={handleClose}
        onCancel={() => setConfirmingClose(false)}
      />
    </div>
  );
}

const JOIN_MODE_LABEL: Record<Circle["joinMode"], string> = { open: "Anyone can join", approval: "You approve each request", invite: "Invite only" };

/** The Circle page's context panel (detail template, 2026-10-20). */
function CircleContext({ circle, onSettings }: { circle: Circle; onSettings?: () => void }) {
  const cover = getCircleCoverUrl(circle);
  return (
    <>
      <div className="wd-ctx">
        <DetailHero images={cover ? [cover.startsWith("/api/") ? cover : getMediaUrl(cover, "card")] : []} name={circle.name} emptyLabel="No cover photo" variant="panel" />
      </div>
      <ContextSection title="Circle">
        <DetailFacts
          columns={1}
          rows={[
            ["Activity", circle.activityLabel || null],
            ["Area", [circle.area, circle.county].filter(Boolean).join(", ") || null],
          ]}
        />
      </ContextSection>
      <ContextSection title="Organiser">
        <div className="wd-ctx-name">{circle.hostName}</div>
        {circle.hostVerified && <div className="wd-ctx-sub">Verified Host</div>}
      </ContextSection>
      <ContextSection title="Details">
        <DetailFacts
          columns={1}
          rows={[
            ["Circle ID", <CopyValue value={circle.id} label="Circle ID" />],
            ["Created", new Date(circle.createdAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })],
          ]}
        />
      </ContextSection>
      {onSettings && (
        <ContextSection title="Manage">
          <ContextActions actions={[{ label: "Edit details", icon: Settings, onSelect: onSettings }]} />
        </ContextSection>
      )}
    </>
  );
}

export function ManageCircle() {
  const { resident, loading: guestLoading } = useGuest();
  const { user, loading: authLoading } = useAuth();
  const loading = guestLoading || authLoading;
  // OG-01 — a linked business-only session is offered the switch, not a sign-in.
  const linkedBusiness = !resident && user?.role === "vendor" && !!user.residentId;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [circle, setCircle] = useState<Circle | null>(null);
  usePageTitle(circle ? `Manage ${circle.name}` : null);
  const [circleLoading, setCircleLoading] = useState(true);
  const [circleError, setCircleError] = useState<string | null>(null);
  // Circle Experience Polish — Changeset 3A. Lets the post-creation success
  // screen (StartCirclePage.tsx) and any other future deep link land an
  // organiser directly on a specific tab, e.g. ?tab=members.
  // URL-synced (?tab=), so Back/Forward, refresh and shared links keep it.
  const [tab, setTab] = useUrlTab<CircleTab>(CIRCLE_TABS, "plans");
  const [restricted, setRestricted] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  const [activeIdeas, setActiveIdeas] = useState<number | null>(null);

  const loadCircle = () => {
    if (!resident || !id) return;
    setCircleLoading(true);
    setCircleError(null);
    setRestricted(false);
    fetchCircle(id)
      .then(async (c) => {
        // Circle Experience 2.0 — GET /circles/:id never carries myRole, so a
        // co-organiser who didn't create the Circle used to be locked out
        // here. Ask the membership endpoint (the server re-checks every action).
        const role = c.createdByResidentId === resident.id ? "organiser" : (await fetchCircleMembership(c.id).catch(() => null))?.role;
        if (role !== "organiser") {
          setRestricted(true);
          return;
        }
        setCircle(c);
        fetchCircleJoinRequests(c.id).then((r) => setPendingRequests(r.length)).catch(() => setPendingRequests(null));
        fetchCirclePlanIdeas(c.id).then((p) => setActiveIdeas(p.filter((x) => x.status === "idea" || x.status === "confirmed").length)).catch(() => setActiveIdeas(null));
      })
      .catch((e) => {
        const status = (e as { status?: number })?.status;
        if (status === 403 || status === 404) setRestricted(true);
        else setCircleError(e instanceof Error ? e.message : "Couldn't load this Circle");
      })
      .finally(() => setCircleLoading(false));
  };
  useEffect(loadCircle, [id, resident?.id]);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!loading && !resident && !linkedBusiness) navigate(signInHref());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resident, linkedBusiness]);

  if (loading) return <PageSpinner />;
  if (!resident && linkedBusiness && user) return <PersonalAccountGate user={user} what="Managing a Circle" />;
  if (!resident) return null;

  return (
    <WorkspaceShell
      workspaceLabel="Host workspace"
      account={`Circle organiser · ${resident.name} · ${resident.email}`}
      externalLink={circle ? { label: "View Circle page", to: `/circles/${circle.slug ?? circle.id}` } : undefined}
      navItems={NAV_OPTIONS}
      active={tab}
      onNavigate={(key) => {
        if (key === "overview") navigate("/manage?tab=circles");
        else setTab(key);
      }}
      title={circle?.name ?? "Circle"}
      subtitle={NAV_OPTIONS.find((o) => o.key === tab)?.summary}
      crumbs={[{ label: "Host workspace", onClick: () => navigate("/manage") }, { label: "Circles", onClick: () => navigate("/manage?tab=circles") }, { label: circle?.name ?? "Circle" }]}
      actions={
        circle && !restricted ? (
          <>
            <a className="adm-btn" href={`/circles/${circle.slug ?? circle.id}`} target="_blank" rel="noreferrer">
              <ExternalLink size={15} strokeWidth={2} aria-hidden="true" /> View public page
            </a>
            {circle.status === "active" && (
              <AdminButton variant="primary" onClick={() => navigate(`/games/host?activity=${encodeURIComponent(circle.activityLabel)}&circleId=${circle.id}`)}>
                <PlusIcon size={14} /> Create a plan
              </AdminButton>
            )}
          </>
        ) : undefined
      }
    >
      {circleLoading ? (
        <PageSpinner />
      ) : restricted ? (
        <EmptyState icon={<UsersIcon size={26} />} title="Only this Circle's organisers can manage it" subtitle="You can still see it on its public page if it's open to you." />
      ) : circleError || !circle ? (
        <LoadErrorState title="Couldn't load this Circle" detail={circleError ?? undefined} onRetry={loadCircle} />
      ) : (
        <>
        <DetailStats
          items={[
            { label: "Members", value: String(circle.members), sub: JOIN_MODE_LABEL[circle.joinMode] },
            {
              label: "Next plan",
              value: circle.nextPlan && circle.nextPlan.source === "circle" ? dateLabel(circle.nextPlan.date) : "—",
              sub: circle.nextPlan && circle.nextPlan.source === "circle" ? `${circle.nextPlan.time} · ${circle.nextPlan.joined} going` : "Nothing scheduled",
            },
            {
              label: "Pending requests",
              value: pendingRequests === null ? "—" : String(pendingRequests),
              sub: circle.joinMode === "approval" ? (pendingRequests ? "Waiting for you in Members" : "Nothing waiting") : "Only for approval Circles",
            },
            { label: "Active proposals", value: activeIdeas === null ? "—" : String(activeIdeas), sub: activeIdeas ? "In Pulse & proposals" : "No suggestions open" },
            { label: "Status", value: circle.status === "active" ? "Active" : "Closed", sub: circle.status === "active" ? "Listed publicly" : "Hidden from browse" },
          ]}
        />
        <div className="wd-layout">
          <div className="wd-main wd-body">
            {tab === "plans" ? (
              <PlansTab circle={circle} />
            ) : tab === "ideas" ? (
              <ManageCirclePlanning circle={circle} residentId={resident.id} />
            ) : tab === "members" ? (
              <MembersTab circle={circle} />
            ) : tab === "moderation" ? (
              <CircleModerationTab circleId={circle.id} />
            ) : (
              <SettingsTab circle={circle} onSaved={setCircle} />
            )}
          </div>
          <aside className="wd-aside" aria-label="Circle details">
            <div className="wd-aside-inner">
              <CircleContext circle={circle} onSettings={tab === "settings" ? undefined : () => setTab("settings")} />
            </div>
          </aside>
        </div>
        </>
      )}
    </WorkspaceShell>
  );
}
