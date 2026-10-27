import { useEffect, useRef, useState } from "react";
import { cancelCirclePlanIdea, confirmCirclePlanIdea, createCirclePlanIdea, joinCirclePlanInterest, leaveCirclePlanInterest } from "../../api";
import type { CirclePlanIdea } from "../../types";
import { CirclePlanIdeaCard } from "../CirclePlanIdeaCard";
import { useConfirm } from "../ConfirmProvider";
import { FieldLabel } from "../form";
import { CalendarIcon, LightbulbIcon, PlusIcon } from "../icons";
import { Button, Card, ConfirmDialog, EmptyState, inputStyle, labelStyle } from "../ui";
import type { SuggestPlanPrefill } from "./CirclePulseSection";
import { irelandToday } from "./circleTime";

// Plan ideas on Circle Home. With circles.make_it_happen on this is the
// "Make it happen" section (owner decision D1: the section is named that,
// each item is still a "plan"): members say "I'm in", the card shows
// progress towards a group size, organisers see "Ready for review", confirm
// or decline (with an optional reason), then create the real activity in
// the normal activity form. Off, it's the earlier "Planning" list, unchanged.
// The suggest form keeps its labels ("What should we do?", "Suggest to
// Circle") — browser tests and returning members rely on them.

export function CircleMakeItHappen({
  circleId,
  plans,
  isOrganiser,
  residentId,
  closed,
  makeItHappen,
  prefill,
  onPrefillUsed,
  onChanged,
}: {
  circleId: string;
  plans: CirclePlanIdea[];
  isOrganiser: boolean;
  residentId: string;
  closed: boolean;
  makeItHappen: boolean;
  /** Set by Pulse / Free Time / Memories "Suggest a plan"; opens the form prefilled. */
  prefill: SuggestPlanPrefill | null;
  onPrefillUsed: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [targetSize, setTargetSize] = useState("");
  const [pulseKey, setPulseKey] = useState<string | undefined>();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<CirclePlanIdea | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prefill) return;
    setFormOpen(true);
    setTitle(prefill.title);
    setPulseKey(prefill.sourcePulseKey);
    if (prefill.proposedDate) setDate(prefill.proposedDate);
    onPrefillUsed();
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: "start" });
      document.getElementById("ce-plan-title")?.focus();
    });
  }, [prefill, onPrefillUsed]);

  const reset = () => {
    setTitle("");
    setNote("");
    setDate("");
    setTime("");
    setLocation("");
    setTargetSize("");
    setPulseKey(undefined);
    setFormOpen(false);
    setError(null);
  };

  const submit = async () => {
    if (!title.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await createCirclePlanIdea(circleId, {
        title: title.trim(),
        note: note.trim() || undefined,
        proposedDate: date || undefined,
        proposedTime: time || undefined,
        locationText: location.trim() || undefined,
        targetSize: makeItHappen && targetSize ? Number(targetSize) : undefined,
        sourcePulseKey: makeItHappen ? pulseKey : undefined,
      });
      reset();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share the idea — try again");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const act = async (planId: string, fn: () => Promise<unknown>) => {
    setPlanBusy(planId);
    setPlanError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setPlanBusy(null);
    }
  };

  const onCancel = async (p: CirclePlanIdea) => {
    // An organiser turning down someone else's suggestion can say why.
    if (makeItHappen && isOrganiser && p.createdByResidentId !== residentId) {
      setDeclineReason("");
      setDeclining(p);
      return;
    }
    if (!(await confirm({ title: "Cancel this plan?", message: "Members who were interested will be told it isn't happening.", confirmLabel: "Cancel plan", cancelLabel: "Keep it", tone: "danger" }))) return;
    await act(p.id, () => cancelCirclePlanIdea(circleId, p.id));
  };

  // Live first, then finished/declined underneath.
  const live = plans.filter((p) => p.status === "idea" || p.status === "confirmed");
  const done = plans.filter((p) => !(p.status === "idea" || p.status === "confirmed"));
  const sectionTitle = makeItHappen ? "Make it happen" : "Planning";

  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>{sectionTitle}</h2>
          <p>
            {makeItHappen
              ? "Suggest something, say “I'm in”, and once enough people are keen an organiser turns it into a real activity. Saying you're in isn't a booking."
              : "Suggest something and see what the Circle thinks."}
          </p>
        </div>
        {!formOpen && !closed && (
          <Button variant="ghost" onClick={() => setFormOpen(true)}>
            <PlusIcon size={14} /> Suggest a plan
          </Button>
        )}
      </div>

      {formOpen && (
        <div ref={formRef} style={{ scrollMarginTop: 100 }}>
          <Card style={{ marginBottom: 14 }}>
            <label htmlFor="ce-plan-title" style={labelStyle}>
              What should we do?
            </label>
            <input id="ce-plan-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coastal walk" maxLength={255} style={{ ...inputStyle, marginBottom: 10 }} />
            <label htmlFor="ce-plan-note" style={labelStyle}>
              Tell the circle more (optional)
            </label>
            <textarea id="ce-plan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="We could meet at the station and walk to the harbour." style={{ ...inputStyle, minHeight: 60, marginBottom: 10, resize: "vertical" }} />
            <div className="ce-fields" style={{ marginBottom: 10 }}>
              <div>
                <label htmlFor="ce-plan-date" style={labelStyle}>
                  When? (optional)
                </label>
                <input id="ce-plan-date" type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label htmlFor="ce-plan-time" style={labelStyle}>
                  Time (optional)
                </label>
                <input id="ce-plan-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div className="ce-fields" style={{ marginBottom: 10 }}>
              <div>
                <label htmlFor="ce-plan-location" style={labelStyle}>
                  Where? (optional)
                </label>
                <input id="ce-plan-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bray Station" style={inputStyle} />
              </div>
              {makeItHappen && (
                <div>
                  <FieldLabel htmlFor="ce-plan-size" optional>
                    How many make it worth doing?
                  </FieldLabel>
                  <input id="ce-plan-size" type="number" inputMode="numeric" min={2} max={100} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} placeholder="3" style={inputStyle} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={submit} disabled={!title.trim() || busy}>
                {busy ? "Sharing…" : "Suggest to Circle"}
              </Button>
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
            {error && (
              <div role="alert" style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 8 }}>
                {error}
              </div>
            )}
          </Card>
        </div>
      )}

      {planError && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 10px" }}>
          {planError}
        </p>
      )}

      {plans.length === 0 && !formOpen ? (
        <EmptyState icon={makeItHappen ? <LightbulbIcon size={18} /> : <CalendarIcon size={18} />} title="Nothing being planned yet" subtitle="Suggest something and see what the Circle thinks." />
      ) : (
        [...live, ...done].map((p) => (
          <CirclePlanIdeaCard
            key={p.id}
            plan={p}
            isOrganiser={isOrganiser}
            isCreator={p.createdByResidentId === residentId}
            closed={closed}
            onConfirm={() => act(p.id, () => confirmCirclePlanIdea(circleId, p.id))}
            onCancel={() => onCancel(p)}
            busy={planBusy === p.id}
            interestBusy={planBusy === p.id}
            onToggleInterest={makeItHappen ? () => act(p.id, () => (p.interestedByMe ? leaveCirclePlanInterest(circleId, p.id) : joinCirclePlanInterest(circleId, p.id))) : undefined}
          />
        ))
      )}

      <ConfirmDialog
        open={!!declining}
        title="Decline this suggestion?"
        message={`${declining?.title ?? "This plan"} won't go ahead. Members are told, with your reason if you give one.`}
        confirmLabel="Decline"
        tone="danger"
        busy={!!declining && planBusy === declining.id}
        onConfirm={async () => {
          if (!declining) return;
          const p = declining;
          await act(p.id, () => cancelCirclePlanIdea(circleId, p.id, declineReason.trim() || undefined));
          setDeclining(null);
        }}
        onCancel={() => setDeclining(null)}
      >
        <label htmlFor="ce-decline-reason" style={labelStyle}>
          Reason (optional, members see it)
        </label>
        <textarea id="ce-decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} maxLength={500} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </ConfirmDialog>
    </div>
  );
}
