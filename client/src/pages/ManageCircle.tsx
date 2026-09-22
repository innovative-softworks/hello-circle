import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelGame,
  demoteCircleMember,
  fetchCentres,
  fetchCircle,
  fetchCircleJoinRequests,
  fetchCircleMembers,
  fetchCirclePlansForManage,
  fetchGameParticipantsForManage,
  inviteToCircle,
  postGameUpdate,
  promoteCircleMember,
  removeCircleMember,
  removeGameParticipant,
  respondToCircleJoinRequest,
  setCircleStatus,
  updateCircle,
} from "../api";
import type { CircleJoinRequest } from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon, PlusIcon, UsersIcon } from "../components/icons";
import { ManageShell } from "../components/ManageShell";
import { ResidentPicker } from "../components/ResidentPicker";
import { Avatar, Button, Card, ConfirmDialog, Drawer, EmptyState, PageSpinner, inputStyle, labelStyle } from "../components/ui";
import { useGuest } from "../GuestContext";
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

type CircleTab = "plans" | "members" | "settings";
type CircleNavKey = CircleTab | "overview";
const NAV_OPTIONS: { key: CircleNavKey; label: string; icon?: undefined }[] = [
  { key: "overview", label: "Overview" },
  { key: "plans", label: "Plans" },
  { key: "members", label: "Members" },
  { key: "settings", label: "Settings" },
];

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    open: { bg: colors.greenBg, fg: colors.greenText, label: "Open" },
    pending_participants: { bg: "#FCEDE4", fg: colors.orangeDark, label: "Pending players" },
    cancelled: { bg: colors.dangerBg, fg: colors.danger, label: "Cancelled" },
  };
  const s = map[status] ?? { bg: colors.panel, fg: colors.muted, label: status };
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.fg, background: s.bg, borderRadius: radius.pill, padding: "2px 8px" }}>{s.label}</span>;
}

function ParticipantsDrawer({ gameId, onClose }: { gameId: string | null; onClose: () => void }) {
  const [participants, setParticipants] = useState<ManageParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ManageParticipant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setParticipants((prev) => prev.filter((p) => p.residentId !== removeTarget.residentId));
      setRemoveTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this participant");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={!!gameId} onClose={onClose} title="Participants">
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
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
              </div>
              <button onClick={() => setRemoveTarget(p)} style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
                Remove
              </button>
            </div>
          ))}
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
    </Drawer>
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
          <Button variant="ghost" onClick={onManageParticipants}>Participants</Button>
          {isLive && (
            <>
              <Button variant="ghost" onClick={() => navigate(`/games/host/${plan.id}`)}>Edit</Button>
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
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={() => navigate(`/games/host?activity=${encodeURIComponent(circle.activityLabel)}&circleId=${circle.id}`)}>
          <PlusIcon size={14} /> Create a plan
        </Button>
      </div>
      {plans.length === 0 ? (
        <EmptyState icon={<CalendarIcon size={26} />} title="No plans yet" />
      ) : (
        plans.map((p) => <PlanRow key={p.id} plan={p} circleId={circle.id} onChanged={reload} onManageParticipants={() => setManagingGameId(p.id)} />)
      )}
      <ParticipantsDrawer gameId={managingGameId} onClose={() => setManagingGameId(null)} />
    </div>
  );
}

function JoinRequestsCard({ circle }: { circle: Circle }) {
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
    setBusyId(requestId);
    try {
      await respondToCircleJoinRequest(circle.id, requestId, accept);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } finally {
      setBusyId(null);
    }
  };

  // Only relevant for an approval-mode Circle, and only worth a card once
  // there's actually something to decide on — an empty inbox for a Circle
  // that isn't even set to 'approval' would just be dead space.
  if (circle.joinMode !== "approval" || loading || requests.length === 0) return null;

  return (
    <Card>
      <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Join requests</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {requests.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={r.name} size={30} />
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.name}</div>
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

function MembersTab({ circle }: { circle: Circle }) {
  const [members, setMembers] = useState<ManageCircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<ManageCircleMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleActionId, setRoleActionId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const organiserCount = members.filter((m) => m.role === "organiser").length;

  const reload = () => {
    setLoading(true);
    fetchCircleMembers(circle.id, true)
      .then((res) => setMembers(res.members))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [circle.id]);

  const handleRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      await removeCircleMember(circle.id, removeTarget.residentId);
      setMembers((prev) => prev.filter((m) => m.residentId !== removeTarget.residentId));
      setRemoveTarget(null);
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

  if (loading) return <PageSpinner />;

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <JoinRequestsCard circle={circle} />
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Invite someone</h4>
        <ResidentPicker onInvite={async (residentId) => { await inviteToCircle(circle.id, residentId); }} />
      </Card>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Members</h4>
        {roleError && <p style={{ color: colors.danger, fontSize: 12.5, margin: "0 0 10px" }}>{roleError}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((m) => (
            <div key={m.residentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={m.name} size={30} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name}</div>
                  {m.role === "organiser" && <div style={{ fontSize: 11.5, color: colors.mutedLight }}>Organiser</div>}
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
        message={`${removeTarget?.name ?? "This member"} will be notified and lose access to this Circle.`}
        confirmLabel={busy ? "Removing…" : "Remove"}
        busy={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      >
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
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
    imageUrl: circle.imageUrl ?? "",
    whatWeDo: circle.whatWeDo ?? "",
    whoCanJoin: circle.whoCanJoin ?? "",
    values: circle.values ?? "",
  });
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
        imageUrl: form.imageUrl || undefined,
        whatWeDo: form.whatWeDo || undefined,
        whoCanJoin: form.whoCanJoin || undefined,
        values: form.values || undefined,
      });
      onSaved(updated);
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
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Activity</label>
            <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} style={inputStyle} />
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
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 8px" }}>Danger zone</h4>
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

export function ManageCircle() {
  const { resident, loading } = useGuest();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [circleLoading, setCircleLoading] = useState(true);
  const [circleError, setCircleError] = useState<string | null>(null);
  const [tab, setTab] = useState<CircleTab>("plans");

  useEffect(() => {
    if (!resident || !id) return;
    setCircleLoading(true);
    fetchCircle(id)
      .then((c) => {
        if (c.myRole !== "organiser" && c.createdByResidentId !== resident.id) {
          setCircleError("Only the organiser can manage this Circle");
          return;
        }
        setCircle(c);
      })
      .catch((e) => setCircleError(e instanceof Error ? e.message : "Couldn't load this Circle"))
      .finally(() => setCircleLoading(false));
  }, [id, resident?.id]);

  // See VendorDashboard.tsx's identical comment — navigate() belongs in an
  // effect, not called directly during render.
  useEffect(() => {
    if (!loading && !resident) navigate(signInHref());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, resident]);

  if (loading) return <PageSpinner />;
  if (!resident) return null;

  return (
    <ManageShell
      navTitle="HelloCircle Manage"
      navOptions={NAV_OPTIONS}
      activeKey={tab}
      onNavChange={(key) => {
        if (key === "overview") navigate("/manage");
        else setTab(key);
      }}
      pageTitle={circle?.name ?? "Circle"}
    >
      {circleLoading ? (
        <PageSpinner />
      ) : circleError || !circle ? (
        <EmptyState icon={<UsersIcon size={26} />} title={circleError ?? "Circle not found"} />
      ) : tab === "plans" ? (
        <PlansTab circle={circle} />
      ) : tab === "members" ? (
        <MembersTab circle={circle} />
      ) : (
        <SettingsTab circle={circle} onSaved={setCircle} />
      )}
    </ManageShell>
  );
}
