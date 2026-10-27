import { useEffect, useRef, useState } from "react";
import { fetchCirclePulse, saveCirclePulse, withdrawCirclePulse } from "../../api";
import { SLOTS, type Day } from "../../participationVocab";
import type { CirclePulseGroup, CirclePulseView } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { FieldError, FieldLabel } from "../form";
import { Button, EmptyState, LoadErrorState, Modal, Skeleton, inputStyle } from "../ui";
import { TrendUpIcon } from "../icons";
import { irelandToday, people, remainingDays, slotLabel, weekName, weekRange } from "./circleTime";

// Circle Experience 2.0 — Circle Pulse (circles.pulse). "I'd like to go
// hiking this weekend" without having to plan anything. Others only ever see
// totals ("6 members are interested in hiking next week"), from two people
// up; nobody's name, note or time preferences are shown to anyone else.
// Organisers additionally see notes left for them, without names.

export interface SuggestPlanPrefill {
  title: string;
  sourcePulseKey?: string;
  proposedDate?: string;
}

const DAY_SHORT: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function CirclePulseSection({
  circleId,
  closed,
  isOrganiser,
  refreshKey,
  onSuggestPlan,
  onViewPlan,
}: {
  circleId: string;
  closed: boolean;
  isOrganiser: boolean;
  refreshKey?: unknown;
  onSuggestPlan: (prefill: SuggestPlanPrefill) => void;
  onViewPlan: (planId: string) => void;
}) {
  const confirm = useConfirm();
  const [view, setView] = useState<CirclePulseView | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; interest: string; weekStart: string; slots: string[]; note: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    fetchCirclePulse(circleId)
      .then(setView)
      .catch(() => setFailed(true));
  };
  useEffect(load, [circleId, refreshKey]);

  if (failed) return <LoadErrorState title="We couldn't load Circle Pulse." onRetry={load} />;
  if (!view) return <Skeleton height={120} />;

  const mineFor = (g: CirclePulseGroup) => view.mine.find((m) => m.weekStart === g.weekStart && m.interest.trim().toLowerCase().replace(/\s+/g, " ") === g.interestKey);

  const joinGroup = async (g: CirclePulseGroup) => {
    setBusyKey(g.key);
    setActionError(null);
    try {
      await saveCirclePulse(circleId, { interest: g.interest, weekStart: g.weekStart, slots: g.topSlot ? [g.topSlot] : [] });
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusyKey(null);
    }
  };
  const withdraw = async (pulseId: string, label: string) => {
    if (!(await confirm({ title: "Withdraw your interest?", message: `You'll no longer count towards ${label}. You can add it again any time.`, confirmLabel: "Withdraw" }))) return;
    setBusyKey(pulseId);
    setActionError(null);
    try {
      await withdrawCirclePulse(circleId, pulseId);
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const atLimit = view.mine.length >= view.limits.maxActive;
  const dialog = editing && (
    <PulseDialog
      circleId={circleId}
      view={view}
      initial={editing}
      onClose={() => setEditing(null)}
      onSaved={() => {
        setEditing(null);
        load();
      }}
    />
  );
  const startNew = () => setEditing({ interest: "", weekStart: view.weeks[0], slots: [], note: "" });

  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>Circle Pulse</h2>
          <p>What members would like to do this week or next. You only ever see totals — never who.</p>
        </div>
        {!closed && (
          <Button onClick={startNew} disabled={atLimit}>
            I'd like to do something
          </Button>
        )}
      </div>
      {actionError && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 10px" }}>
          {actionError}
        </p>
      )}
      {view.groups.length === 0 ? (
        <EmptyState icon={<TrendUpIcon size={20} />} title="Nobody's said what they'd like to do yet" subtitle="Say what you fancy — when one more person wants the same, everyone sees the total." />
      ) : (
        <ul className="ce-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {view.groups.map((g) => {
            const mine = mineFor(g);
            const when = weekName(g.weekStart, view.weeks).toLowerCase();
            return (
              <li key={g.key} className="ce-row">
                <div className="ce-row-main">
                  <p className="ce-row-title">
                    {g.count === null ? `Only you so far: ${g.interest} ${when}` : `${people(g.count)} ${g.count === 1 ? "is" : "are"} interested in ${g.interest} ${when}`}
                  </p>
                  <div className="ce-row-meta">
                    <span>{weekRange(g.weekStart)}</span>
                    {g.topSlot && g.topSlotCount !== null && <span>Most popular: {slotLabel(g.topSlot)} ({g.topSlotCount})</span>}
                    {g.count === null && <span>Others see it once one more person wants the same.</span>}
                    {g.status === "matched" && <span className="ce-pill ce-pill--green">Enough to plan</span>}
                    {g.status === "proposed" && <span className="ce-pill">Plan suggested</span>}
                    {g.status === "converted" && <span className="ce-pill ce-pill--green">It's happening</span>}
                  </div>
                  {isOrganiser && g.organiserNotes && g.organiserNotes.length > 0 && (
                    <details style={{ marginTop: 8, fontSize: 13 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Notes for organisers ({g.organiserNotes.length})</summary>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--color-muted)" }}>
                        {g.organiserNotes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="ce-row-actions">
                  {g.planId ? (
                    <Button variant="ghost" onClick={() => onViewPlan(g.planId!)}>
                      View suggested plan
                    </Button>
                  ) : (
                    g.status === "matched" &&
                    !closed && (
                      <Button variant="ghost" onClick={() => onSuggestPlan({ title: g.interest, sourcePulseKey: g.key })}>
                        Suggest a plan
                      </Button>
                    )
                  )}
                  {!closed &&
                    (mine ? (
                      <>
                        <Button variant="ghost" onClick={() => setEditing({ id: mine.id, interest: mine.interest, weekStart: mine.weekStart, slots: mine.slots, note: mine.note ?? "" })}>
                          Update my interest
                        </Button>
                        <Button variant="ghost" onClick={() => withdraw(mine.id, g.interest)} disabled={busyKey === mine.id}>
                          Withdraw
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => joinGroup(g)} disabled={busyKey === g.key || atLimit}>
                        {busyKey === g.key ? "Adding…" : "I'm interested"}
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </div>
  );
}

function PulseDialog({
  circleId,
  view,
  initial,
  onClose,
  onSaved,
}: {
  circleId: string;
  view: CirclePulseView;
  initial: { id?: string; interest: string; weekStart: string; slots: string[]; note: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [interest, setInterest] = useState(initial.interest);
  const [weekStart, setWeekStart] = useState(initial.weekStart);
  const [slots, setSlots] = useState<string[]>(initial.slots);
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const today = irelandToday();
  const days = remainingDays(weekStart, today);
  const dirty = interest !== initial.interest || slots.join() !== initial.slots.join() || note !== initial.note || weekStart !== initial.weekStart;
  const toggle = (t: string) => setSlots((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));

  const save = async () => {
    if (inFlight.current) return;
    if (interest.trim().length < 2) {
      setError({ field: "interest", message: "Say what you'd like to do" });
      document.getElementById("ce-pulse-interest")?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Changing the activity or week of an existing interest replaces it.
      const renamed = initial.id && (interest.trim().toLowerCase() !== initial.interest.trim().toLowerCase() || weekStart !== initial.weekStart);
      await saveCirclePulse(circleId, { interest: interest.trim(), weekStart, slots: slots.filter((t) => days.includes(t.split(":")[0] as Day)), note: note.trim() || undefined });
      if (renamed) await withdrawCirclePulse(circleId, initial.id!).catch(() => undefined);
      onSaved();
    } catch (e) {
      const body = (e as { body?: { field?: string } }).body;
      setError({ field: body?.field, message: e instanceof Error ? e.message : "That didn't save. Try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? "Update your interest" : "What would you like to do?"}
      subtitle="Other members see the total, never your name or your note."
      confirmClose={dirty ? { title: "Discard this?", message: "What you've entered here won't be saved." } : undefined}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : initial.id ? "Save changes" : "Add to Circle Pulse"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {error && !error.field && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
            {error.message}
          </p>
        )}
        <div>
          <FieldLabel htmlFor="ce-pulse-interest" required>
            Activity
          </FieldLabel>
          {view.suggestions.length > 0 && (
            <div className="ce-chips" style={{ marginBottom: 8 }} role="group" aria-label="Suggestions">
              {view.suggestions.map((s) => (
                <button key={s} type="button" className="ce-chip" aria-pressed={interest.trim().toLowerCase() === s.toLowerCase()} onClick={() => setInterest(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <input
            id="ce-pulse-interest"
            value={interest}
            onChange={(e) => (setInterest(e.target.value), setError(null))}
            maxLength={60}
            placeholder="e.g. Hiking, coffee, badminton"
            aria-invalid={error?.field === "interest" || undefined}
            aria-describedby={error?.field === "interest" ? "ce-pulse-interest-error" : undefined}
            style={inputStyle}
          />
          <FieldError fieldId="ce-pulse-interest" message={error?.field === "interest" ? error.message : undefined} />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--color-muted)", marginBottom: 6, padding: 0 }}>When</legend>
          <div className="ce-week-switch">
            {view.weeks.map((w) => (
              <button key={w} type="button" className="ce-chip" aria-pressed={weekStart === w} onClick={() => setWeekStart(w)}>
                {weekName(w, view.weeks)} · {weekRange(w)}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-muted-light)", margin: "0 0 10px" }}>Pick the times that suit you (optional). Leave them all off for "any time".</p>
          <div className="ce-slot-grid" role="group" aria-label="Preferred times">
            <span />
            {SLOTS.map((s) => (
              <span key={s} className="ce-slot-head">
                {s}
              </span>
            ))}
            {days.map((d) => (
              <SlotRow key={d} day={d} label={DAY_SHORT[d]} selected={slots} onToggle={toggle} />
            ))}
          </div>
          {days.length === 0 && <p style={{ fontSize: 13, color: "var(--color-muted-light)" }}>This week is over — choose next week.</p>}
        </fieldset>

        <div>
          <FieldLabel htmlFor="ce-pulse-note" optional>
            Note for the organisers
          </FieldLabel>
          <textarea
            id="ce-pulse-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={view.limits.noteMaxLength}
            rows={2}
            placeholder="e.g. Somewhere flat, please"
            aria-invalid={error?.field === "note" || undefined}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <p style={{ fontSize: 12, color: "var(--color-muted-light)", margin: "6px 0 0" }}>Organisers see it without your name. Other members don't see it.</p>
          <FieldError fieldId="ce-pulse-note" message={error?.field === "note" ? error.message : undefined} />
        </div>
      </div>
    </Modal>
  );
}

export function SlotRow({ day, label, selected, onToggle }: { day: Day; label: string; selected: string[]; onToggle: (token: string) => void }) {
  return (
    <>
      <span className="ce-slot-day">{label}</span>
      {SLOTS.map((s) => {
        const t = `${day}:${s}`;
        return (
          <button key={t} type="button" className="ce-chip" aria-pressed={selected.includes(t)} aria-label={slotLabel(t)} onClick={() => onToggle(t)}>
            {selected.includes(t) ? "✓" : "—"}
          </button>
        );
      })}
    </>
  );
}

