import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchCirclePlanIdeas, fetchCirclesPage, fetchCollaborations, proposeCollaboration, respondToCollaboration, withdrawCollaboration, type CircleCollaboration } from "../../api";
import { dateLabel } from "../../euro";
import { irelandToday } from "../../irelandDate";
import type { Circle, CirclePlanIdea } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { FieldError, FieldLabel } from "../form";
import { Button, ConfirmDialog, LoadErrorState, Modal, Skeleton, inputStyle, labelStyle } from "../ui";
import "./circleExperience.css";

// Experience 3.0 — Circle-to-Circle activities (circles.collaboration,
// owner decision D2), in the organiser workspace. Propose a shared activity
// to another Circle; its organisers accept or decline; then create the
// activity through the normal form. It belongs to your Circle and is shown to
// both Circles' members. No members, chats or private content are shared.

const STATUS: Record<CircleCollaboration["status"], { label: string; tone: string }> = {
  proposed: { label: "Waiting for an answer", tone: "" },
  accepted: { label: "Agreed", tone: "ce-pill--green" },
  declined: { label: "Declined", tone: "ce-pill--muted" },
  withdrawn: { label: "Withdrawn", tone: "ce-pill--muted" },
  activity_created: { label: "Activity created", tone: "ce-pill--green" },
};

export function CircleCollaborations({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [rows, setRows] = useState<CircleCollaboration[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [declining, setDeclining] = useState<CircleCollaboration | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setFailed(false);
    fetchCollaborations(circle.id)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [circle.id]);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    }
  };
  const createActivity = (c: CircleCollaboration) =>
    navigate(
      `/games/host?activity=${encodeURIComponent(c.title)}&circleId=${circle.id}&collaborationId=${c.id}` +
        (c.proposedDate ? `&date=${c.proposedDate}` : "") +
        (c.proposedTime ? `&time=${c.proposedTime}` : "") +
        (c.locationText ? `&locationText=${encodeURIComponent(c.locationText)}` : "")
    );
  const closed = circle.status === "closed";
  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>With other Circles</h2>
          <p>Plan something together with another Circle. Both sides' organisers have to agree. The activity is your Circle's, shown to both Circles' members; nothing else is shared.</p>
        </div>
        {!closed && <Button onClick={() => setProposing(true)}>Invite another Circle</Button>}
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 10px" }}>
          {error}
        </p>
      )}
      {failed ? (
        <LoadErrorState title="We couldn't load shared activities." onRetry={load} />
      ) : !rows ? (
        <Skeleton height={100} />
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--color-muted-light)", margin: 0 }}>No shared activities yet.</p>
      ) : (
        <ul className="ce-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((c) => {
            const other = c.direction === "sent" ? c.partner : c.proposer;
            return (
              <li key={c.id} className="ce-row">
                <div className="ce-row-main">
                  <p className="ce-row-title">{c.title}</p>
                  <div className="ce-row-meta">
                    <span>{c.direction === "sent" ? `You invited ${other?.name ?? "a Circle"}` : `${other?.name ?? "A Circle"} invited you`}</span>
                    {c.proposedDate && <span>{dateLabel(c.proposedDate)}{c.proposedTime ? ` · ${c.proposedTime}` : ""}</span>}
                    {c.locationText && <span>{c.locationText}</span>}
                    <span className={`ce-pill ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span>
                    {c.planId && <span>Shared plan</span>}
                  </div>
                  {c.note && <p style={{ margin: "6px 0 0", fontSize: 13 }}>{c.note}</p>}
                  {c.status === "declined" && c.declineReason && <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-muted)" }}>Reason: {c.declineReason}</p>}
                </div>
                <div className="ce-row-actions">
                  {c.direction === "received" && c.status === "proposed" && !closed && (
                    <>
                      <Button onClick={() => act(() => respondToCollaboration(circle.id, c.id, true))}>Agree</Button>
                      <Button variant="ghost" onClick={() => (setReason(""), setDeclining(c))}>
                        Decline
                      </Button>
                    </>
                  )}
                  {c.direction === "sent" && c.status === "accepted" && !closed && <Button onClick={() => createActivity(c)}>Create the activity</Button>}
                  {c.direction === "sent" && (c.status === "proposed" || c.status === "accepted") && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        if (await confirm({ title: "Withdraw this invitation?", message: `${other?.name ?? "The other Circle"} won't be able to agree to it any more.`, confirmLabel: "Withdraw" })) await act(() => withdrawCollaboration(circle.id, c.id));
                      }}
                    >
                      Withdraw
                    </Button>
                  )}
                  {c.gameId && (
                    <Button variant="ghost" onClick={() => navigate(`/games/${c.gameId}`)}>
                      View activity
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {proposing && <ProposeDialog circle={circle} onClose={() => setProposing(false)} onSent={() => (setProposing(false), load())} />}
      <ConfirmDialog
        open={!!declining}
        title="Decline this shared activity?"
        message={`${declining?.proposer?.name ?? "The other Circle"}'s organisers are told, with your reason if you give one.`}
        confirmLabel="Decline"
        tone="danger"
        onConfirm={async () => {
          if (declining) await act(() => respondToCollaboration(circle.id, declining.id, false, reason.trim() || undefined));
          setDeclining(null);
        }}
        onCancel={() => setDeclining(null)}
      >
        <label htmlFor="collab-decline-reason" style={labelStyle}>
          Reason (optional)
        </label>
        <textarea id="collab-decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </ConfirmDialog>
    </div>
  );
}

function ProposeDialog({ circle, onClose, onSent }: { circle: Circle; onClose: () => void; onSent: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Circle[]>([]);
  const [partner, setPartner] = useState<Circle | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  // Circles 3.0 — share one of this Circle's open plans (e.g. an adventure
  // plan) instead of a new activity: one plan, shown in both Circles.
  const [plans, setPlans] = useState<CirclePlanIdea[]>([]);
  const [planId, setPlanId] = useState("");
  useEffect(() => {
    fetchCirclePlanIdeas(circle.id)
      .then((ps) => setPlans(ps.filter((p) => p.circleId === circle.id && (p.status === "idea" || p.status === "confirmed") && !p.shared)))
      .catch(() => setPlans([]));
  }, [circle.id]);
  const chosen = plans.find((p) => p.id === planId) ?? null;
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    let live = true;
    const t = setTimeout(() => {
      fetchCirclesPage({ q: q.trim(), limit: 8 })
        .then((p) => live && setResults(p.items.filter((c) => c.id !== circle.id && c.status === "active")))
        .catch(() => live && setResults([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, circle.id]);
  const send = async () => {
    if (!partner) return setError({ field: "partner", message: "Choose a Circle to invite" });
    if (!chosen && title.trim().length < 3) return setError({ field: "title", message: "Say what you'd do together" });
    setBusy(true);
    setError(null);
    try {
      await proposeCollaboration(
        circle.id,
        chosen
          ? { partnerCircleId: partner.id, title: chosen.title, note: note.trim() || undefined, planId: chosen.id }
          : { partnerCircleId: partner.id, title: title.trim(), note: note.trim() || undefined, proposedDate: date || undefined, proposedTime: time || undefined, locationText: location.trim() || undefined }
      );
      onSent();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "That didn't send. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite another Circle"
      subtitle={chosen ? "Their organisers decide. If they agree, the plan shows in both Circles and members of both can say they're in. Member lists stay private." : "Their organisers decide. Nothing is created until they agree and you make the activity."}
      size="wide"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {error && !error.field && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
            {error.message}
          </p>
        )}
        <div>
          <FieldLabel htmlFor="collab-search" required>
            Which Circle?
          </FieldLabel>
          {partner ? (
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{partner.name}</strong> · {[partner.area, partner.county].filter(Boolean).join(", ")}{" "}
              <button type="button" className="ce-link" onClick={() => setPartner(null)}>
                Change
              </button>
            </p>
          ) : (
            <>
              <input id="collab-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or activity" style={inputStyle} autoComplete="off" aria-describedby={error?.field === "partner" ? "collab-search-error" : undefined} />
              <FieldError fieldId="collab-search" message={error?.field === "partner" ? error.message : undefined} />
              {results.length > 0 && (
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="ce-chip" style={{ width: "100%", textAlign: "left" }} onClick={() => (setPartner(c), setError(null))}>
                        {c.name} · {c.activityLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        {plans.length > 0 && (
          <div>
            <FieldLabel htmlFor="collab-plan" optional>
              Share one of your plans
            </FieldLabel>
            <select id="collab-plan" value={planId} onChange={(e) => (setPlanId(e.target.value), setError(null))} style={inputStyle}>
              <option value="">No, propose a new shared activity</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.listing ? ` (${p.listing.kind})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {!chosen && (
        <div>
          <FieldLabel htmlFor="collab-title" required>
            What would you do together?
          </FieldLabel>
          <input id="collab-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} placeholder="e.g. Joint coastal walk and swim" style={inputStyle} />
          <FieldError fieldId="collab-title" message={error?.field === "title" ? error.message : undefined} />
        </div>
        )}
        <div className="ce-fields">
          {!chosen && (<>
          <div>
            <FieldLabel htmlFor="collab-date" optional>
              Date
            </FieldLabel>
            <input id="collab-date" type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor="collab-time" optional>
              Time
            </FieldLabel>
            <input id="collab-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
          </div>
          <div className="ce-full">
            <FieldLabel htmlFor="collab-location" optional>
              Where
            </FieldLabel>
            <input id="collab-location" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={255} style={inputStyle} />
          </div>
          </>)}
          <div className="ce-full">
            <FieldLabel htmlFor="collab-note" optional>
              A note for their organisers
            </FieldLabel>
            <textarea id="collab-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
