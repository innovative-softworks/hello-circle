import { useEffect, useRef, useState } from "react";
import { closeCirclePoll, confirmCirclePlanIdea, createCirclePlanIdea, createCirclePoll, deleteCirclePoll, voteOnCirclePollOption } from "../../api";
import { dateLabel } from "../../euro";
import { colors, radius } from "../../theme";
import type { CirclePlanIdea, CirclePoll } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { CalendarIcon, PlusIcon } from "../icons";
import { Button, Card, EmptyState, inputStyle, labelStyle } from "../ui";

// Date polls — moved here from CircleDetail.tsx for the tabbed Circle Home,
// behaviour unchanged: members propose options, everyone votes for every
// option that works (multi-select), the organiser closes it, and a closed
// poll with a clear winner can become an activity through the plan-idea →
// activity path (never published automatically). New: an optional time per
// option (the API always accepted one). Labels kept for browser tests.

function PollCard({ poll, isOrganiser, onVote, onClose, onDelete, onCreateActivity }: { poll: CirclePoll; isOrganiser: boolean; onVote: (optionId: number) => void; onClose: () => void; onDelete: () => void; onCreateActivity?: () => void }) {
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
  const totalVotes = poll.options.reduce((n, o) => n + o.voteCount, 0);
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{poll.question}</div>
        <span className={`ce-pill ${poll.status === "open" ? "ce-pill--green" : "ce-pill--muted"}`}>{poll.status === "open" ? "Open" : "Closed"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {poll.options.map((o) => {
          const isRecommended = poll.status === "closed" && o.voteCount === maxVotes && maxVotes > 0;
          // Vote bar (2026-10-24): each option's share of all votes cast.
          const pct = totalVotes ? Math.round((o.voteCount / totalVotes) * 100) : 0;
          const fill = o.votedByMe ? "rgba(46, 125, 80, 0.22)" : "rgba(46, 125, 80, 0.12)";
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => poll.status === "open" && onVote(o.id)}
              disabled={poll.status !== "open"}
              aria-pressed={o.votedByMe}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                textAlign: "left",
                border: `1px solid ${o.votedByMe ? colors.green : colors.border}`,
                background: `linear-gradient(90deg, ${fill} ${pct}%, ${colors.surface} ${pct}%)`,
                borderRadius: radius.control,
                padding: "9px 12px",
                minHeight: 44,
                cursor: poll.status === "open" ? "pointer" : "default",
                color: colors.text,
              }}
            >
              <span style={{ fontSize: 13.5 }}>
                {dateLabel(o.date)}
                {o.time ? ` · ${o.time}` : ""} {isRecommended && <strong style={{ color: colors.greenText }}> · Recommended</strong>}
              </span>
              <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700, whiteSpace: "nowrap" }}>
                {o.votedByMe && "✓ "}
                {o.voteCount} vote{o.voteCount === 1 ? "" : "s"}
                {totalVotes > 0 && ` · ${pct}%`}
              </span>
            </button>
          );
        })}
      </div>
      {isOrganiser && (
        <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {poll.status === "open" && (
            <Button variant="ghost" onClick={onClose}>
              Close poll
            </Button>
          )}
          <button type="button" className="ce-link" style={{ color: colors.danger }} onClick={onDelete}>
            Delete poll
          </button>
        </div>
      )}
      {onCreateActivity && (
        <div style={{ marginTop: 10 }}>
          <Button onClick={onCreateActivity}>Create activity from this</Button>
        </div>
      )}
    </Card>
  );
}

export function CirclePollsPanel({
  circleId,
  polls,
  planIdeas,
  isOrganiser,
  closed,
  onChanged,
  onNavigate,
  startOpen,
  onStarted,
}: {
  circleId: string;
  polls: CirclePoll[];
  planIdeas: CirclePlanIdea[];
  isOrganiser: boolean;
  closed: boolean;
  onChanged: () => void;
  onNavigate: (href: string) => void;
  /** "+ Propose a time" from Circle Home lands here with the form open. */
  startOpen?: boolean;
  onStarted?: () => void;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(!!startOpen);
  useEffect(() => {
    if (!startOpen) return;
    setOpen(true);
    onStarted?.();
    requestAnimationFrame(() => document.getElementById("ce-poll-question")?.focus());
  }, [startOpen, onStarted]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([{ date: "", time: "" }, { date: "", time: "" }, { date: "", time: "" }]);
  const [planId, setPlanId] = useState("");
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const chosen = options.filter((o) => o.date).map((o) => ({ date: o.date, time: o.time || undefined }));
    if (!question.trim() || chosen.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await createCirclePoll(circleId, { question: question.trim(), options: chosen, planId: planId || undefined });
      setQuestion("");
      setOptions([{ date: "", time: "" }, { date: "", time: "" }, { date: "", time: "" }]);
      setPlanId("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the poll — try again");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // Routes through the plan-idea → activity architecture (Circle Experience
  // Polish 3B): nothing is published here — the organiser reviews and edits
  // on the activity form next.
  const createActivity = async (poll: CirclePoll) => {
    const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
    const winner = poll.options.find((o) => o.voteCount === maxVotes && maxVotes > 0);
    if (!winner) return;
    let id = poll.planId;
    try {
      if (id) {
        const linked = planIdeas.find((p) => p.id === id);
        if (linked?.status === "idea") await confirmCirclePlanIdea(circleId, id);
      } else {
        const created = await createCirclePlanIdea(circleId, { title: poll.question, proposedDate: winner.date, proposedTime: winner.time || undefined });
        await confirmCirclePlanIdea(circleId, created.id);
        id = created.id;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      return;
    }
    onNavigate(`/games/host?activity=${encodeURIComponent(poll.question)}&circleId=${circleId}&planId=${id}${winner.date ? `&date=${winner.date}` : ""}${winner.time ? `&time=${winner.time}` : ""}`);
  };

  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>Polls</h2>
          <p>Find a day that works. Vote for every option you could make.</p>
        </div>
        {!open && !closed && (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            <PlusIcon size={14} /> Propose a time
          </Button>
        )}
      </div>
      {open && (
        <Card style={{ marginBottom: 14 }}>
          <label htmlFor="ce-poll-question" style={labelStyle}>
            What are you planning?
          </label>
          <input id="ce-poll-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Next badminton session" style={{ ...inputStyle, marginBottom: 10 }} />
          {planIdeas.length > 0 && (
            <>
              <label htmlFor="ce-poll-plan" style={labelStyle}>
                Attach to a plan (optional)
              </label>
              <select id="ce-poll-plan" value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
                <option value="">Not attached to a specific plan</option>
                {planIdeas
                  .filter((p) => p.status === "idea" || p.status === "confirmed")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, padding: 0 }}>Date options</legend>
            {options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <input
                  type="date"
                  aria-label={`Option ${i + 1} date`}
                  value={o.date}
                  onChange={(e) => setOptions((list) => list.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))}
                  style={{ ...inputStyle, maxWidth: 200 }}
                />
                <input
                  type="time"
                  aria-label={`Option ${i + 1} time (optional)`}
                  value={o.time}
                  onChange={(e) => setOptions((list) => list.map((x, idx) => (idx === i ? { ...x, time: e.target.value } : x)))}
                  style={{ ...inputStyle, maxWidth: 140 }}
                />
              </div>
            ))}
          </fieldset>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <Button onClick={create} disabled={!question.trim() || busy}>
              {busy ? "Creating…" : "Create poll"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {error && (
        <div role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 10px" }}>
          {error}
        </div>
      )}
      {polls.length === 0 && !open ? (
        <EmptyState icon={<CalendarIcon size={18} />} title="No polls yet" subtitle="Propose a few dates and let the circle vote on what works." />
      ) : (
        polls.map((p) => {
          const maxVotes = Math.max(0, ...p.options.map((o) => o.voteCount));
          const linked = p.planId ? planIdeas.find((pl) => pl.id === p.planId) : undefined;
          const converted = linked?.status === "activity_created" || linked?.status === "cancelled";
          const canCreate = isOrganiser && p.status === "closed" && maxVotes > 0 && !converted && !closed;
          return (
            <PollCard
              key={p.id}
              poll={p}
              isOrganiser={isOrganiser && !closed}
              onVote={(optionId) =>
                voteOnCirclePollOption(circleId, p.id, optionId)
                  .then(onChanged)
                  .catch((e) => setError(e instanceof Error ? e.message : "Your vote didn't save. Try again."))
              }
              onClose={async () => {
                const ok = await confirm({ title: "Close this poll?", message: "Nobody will be able to vote any more, and the current result stands.", confirmLabel: "Close poll" });
                if (ok) closeCirclePoll(circleId, p.id).then(onChanged).catch(() => setError("Couldn't close the poll. Try again."));
              }}
              onDelete={async () => {
                const ok = await confirm({ title: "Delete this poll?", message: `"${p.question}" and its votes are deleted for everyone. This can't be undone and is recorded.`, confirmLabel: "Delete poll", tone: "danger" });
                if (ok) deleteCirclePoll(circleId, p.id).then(onChanged).catch((e) => setError(e instanceof Error ? e.message : "Couldn't delete the poll. Try again."));
              }}
              onCreateActivity={canCreate ? () => createActivity(p) : undefined}
            />
          );
        })
      )}
    </div>
  );
}
