import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/core";
import { createCirclePlanIdea, fetchMyCircles, linkListingToCircle } from "../../api";
import { useGuest } from "../../GuestContext";
import type { Circle, CirclePlanListingType } from "../../types";
import { FieldLabel } from "../form";
import { Button, Modal, inputStyle } from "../ui";
import "./circleExperience.css";

// Circles 3.0 — "Plan with my Circle" on a listing page: suggest this
// listing in one of your Circles. A secondary action next to Share and
// Invite; the page's own Book / Join button stays the main one. The plan
// is a suggestion members can say "I'm in" to — it never books anything.

export interface PlanWithCircleListing {
  type: CirclePlanListingType;
  id: string;
  title: string;
  /** Dates to suggest (experience departures, programme sessions). */
  sessions?: { id: string; label: string }[];
}

export function PlanWithCircle({ listing, render }: { listing: PlanWithCircleListing; render: (open: () => void) => ReactNode }) {
  const { resident } = useGuest();
  const [open, setOpen] = useState(false);
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [circleId, setCircleId] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ circle: Circle; planId: string; existed: boolean; kind: "plan" | "linked" | "pending" } | null>(null);
  // Circles 3.1 — two different things: link it to the Circle, or plan to go together.
  const [mode, setMode] = useState<"plan" | "link">("plan");

  useEffect(() => {
    if (!open || !resident) return;
    setCircles(null);
    fetchMyCircles()
      .then((cs) => {
        const active = cs.filter((c) => c.status !== "closed");
        setCircles(active);
        if (active.length === 1) setCircleId(active[0].id);
      })
      .catch(() => setCircles([]));
  }, [open, resident]);

  // Only signed-in residents in a Circle can suggest; others don't see the action.
  if (!resident) return null;

  const close = () => {
    setOpen(false);
    setResult(null);
    setError(null);
    setNote("");
    setSessionId("");
  };

  const submit = async () => {
    const circle = circles?.find((c) => c.id === circleId);
    if (!circle) return setError("Choose a Circle");
    setBusy(true);
    setError(null);
    try {
      if (mode === "link") {
        const r = await linkListingToCircle(circle.id, { type: listing.type, id: listing.id }, note.trim() || undefined);
        setResult({ circle, planId: "", existed: false, kind: r.status === "approved" ? "linked" : "pending" });
      } else {
        const plan = await createCirclePlanIdea(circle.id, { title: listing.title, note: note.trim() || undefined, listing: { type: listing.type, id: listing.id, sessionId: sessionId || null } });
        setResult({ circle, planId: plan.id, existed: false, kind: "plan" });
      }
    } catch (e) {
      const planId = e instanceof ApiError ? ((e.body.planId ?? e.body.linkId) as string | undefined) : undefined;
      if (planId) setResult({ circle, planId: mode === "plan" ? planId : "", existed: true, kind: mode === "plan" ? "plan" : "linked" });
      else setError(e instanceof Error ? e.message : "Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const circleHref = (c: Circle, planId: string) => `/circles/${c.slug ?? c.id}?tab=activities${planId ? `#plan-${planId}` : ""}`;

  return (
    <>
      {render(() => setOpen(true))}
      <Modal
        open={open}
        onClose={close}
        title="Plan with your Circle"
        subtitle={`Suggest ${listing.title} to a Circle you're in. Members can say they're in; everyone books on this page.`}
        footer={
          result ? (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={close}>Done</Button>
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !circleId}>
                {busy ? "Saving…" : mode === "plan" ? "Suggest to Circle" : "Share with Circle"}
              </Button>
            </div>
          )
        }
      >
        {result ? (
          <div role="status" style={{ display: "grid", gap: 8 }}>
            <strong>
              {result.kind === "plan"
                ? result.existed
                  ? `Already suggested in ${result.circle.name}`
                  : `Suggested in ${result.circle.name}`
                : result.existed
                  ? `Already in ${result.circle.name}`
                  : result.kind === "linked"
                    ? `Linked to ${result.circle.name}`
                    : `Sent to ${result.circle.name}'s organisers`}
            </strong>
            <span>
              {result.kind === "plan"
                ? result.existed
                  ? "Someone suggested this already. Say you're in on the plan instead."
                  : "Members will see it in the Circle's plans. Nothing has been booked."
                : result.kind === "pending"
                  ? "It shows in the Circle once an organiser approves it. Nobody is signed up."
                  : "Members can see it in the Circle. Nobody is signed up."}
            </span>
            <Link to={circleHref(result.circle, result.planId)} onClick={close}>
              Open {result.circle.name} →
            </Link>
          </div>
        ) : circles === null ? (
          <p role="status">Loading your Circles…</p>
        ) : circles.length === 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>You're not in a Circle yet. Join one to plan things together.</p>
            <Link to="/circles" onClick={close}>
              Find a Circle →
            </Link>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Which Circle?</legend>
              {circles.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, cursor: "pointer" }}>
                  <input type="radio" name="plan-with-circle" checked={circleId === c.id} onChange={() => setCircleId(c.id)} />
                  <span>{c.name}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="lld-mode">
              <legend>What would you like to do?</legend>
              <label>
                <input type="radio" name="pwc-mode" checked={mode === "plan"} onChange={() => setMode("plan")} />
                <span>
                  <strong>Plan to go together</strong>
                  <span>Members can say they're in. Everyone books here.</span>
                </span>
              </label>
              <label>
                <input type="radio" name="pwc-mode" checked={mode === "link"} onChange={() => setMode("link")} />
                <span>
                  <strong>Share it with the Circle</strong>
                  <span>It shows in the Circle for members to see. Nobody is signed up.</span>
                </span>
              </label>
            </fieldset>
            {mode === "plan" && !!listing.sessions?.length && (
              <div>
                <FieldLabel htmlFor="pwc-session" optional>
                  Which date?
                </FieldLabel>
                <select id="pwc-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={inputStyle}>
                  <option value="">Any date — decide together</option>
                  {listing.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <FieldLabel htmlFor="pwc-note" optional>
                Add a message
              </FieldLabel>
              <input id="pwc-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Anyone up for this next month?" style={inputStyle} />
            </div>
            {error && (
              <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 13.5 }}>
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
