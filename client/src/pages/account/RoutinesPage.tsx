import { useEffect, useId, useState } from "react";
import { CalendarClock, Plus, Repeat } from "lucide-react";
import { createRoutine, fetchMyRoutines, fetchRoutineSuggestions, updateRoutine } from "../../api";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/Toast";
import { Button, LoadErrorState, RowSkeleton, inputStyle } from "../../components/ui";
import { irelandToday, weekdayOf } from "../../irelandDate";
import type { Routine, RoutineSuggestion } from "../../types";
import { AccountEmpty, AccountPage, AccountSection, FormModal, Note, StatusTag, TextButton } from "./accountUi";

// Routines (IA spec §9). `dayOfWeek` is MySQL DAYOFWEEK(): 1 = Sunday … 7 =
// Saturday. Routines are a picture of someone's regular week: Explore ranks
// matching sessions higher for active ones (routes/discover.ts). They never
// book anything and nothing sends routine reminders today — the page says so.

const DAY_NAME = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [2, 3, 4, 5, 6, 7, 1];

function todayDow(): number {
  return weekdayOf(irelandToday()) + 1;
}

export function AddRoutineModal({ open, onAdded, onClose }: { open: boolean; onAdded: () => void; onClose: () => void }) {
  const id = useId();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [day, setDay] = useState(String(todayDow()));
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setDay(String(todayDow()));
    setTime("");
    setError(null);
  }, [open]);

  return (
    <FormModal
      open={open}
      title="Add a routine"
      subtitle="Something you do most weeks."
      submitLabel="Add routine"
      dirty={label.trim() !== "" || time !== ""}
      onClose={onClose}
      onSubmit={async () => {
        if (!label.trim()) {
          setError("Say what you do, for example “Parkrun” or “Yoga at the community centre”.");
          return false;
        }
        await createRoutine({ activityLabel: label.trim(), dayOfWeek: Number(day), time: time || undefined });
        toast.success("Routine added");
        onAdded();
      }}
    >
      <div>
        <label htmlFor={`${id}-label`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>What do you do?</label>
        <input id={`${id}-label`} value={label} onChange={(e) => { setLabel(e.target.value); setError(null); }} maxLength={120} autoFocus aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} style={inputStyle} />
        {error && <p id={`${id}-err`} className="acct-field-error">{error}</p>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 160px" }}>
          <label htmlFor={`${id}-day`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>Day</label>
          <select id={`${id}-day`} value={day} onChange={(e) => setDay(e.target.value)} style={inputStyle}>
            {WEEK_ORDER.map((d) => <option key={d} value={d}>{DAY_NAME[d]}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-time`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>Time (optional)</label>
          <input id={`${id}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
        </div>
      </div>
    </FormModal>
  );
}

function RoutineRow({ r, onChanged, onRemoved }: { r: Routine; onChanged: (p: Partial<Routine>) => void; onRemoved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(r.time);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast.error(fail);
    } finally {
      setBusy(false);
    }
  };
  const paused = r.status === "paused";

  return (
    <li className="acct-item" data-muted={paused ? "true" : undefined}>
      <span className="acct-thumb" aria-hidden="true"><Repeat size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="acct-item-title">{r.activityLabel}</div>
        <div className="acct-item-meta">
          Every {DAY_NAME[r.dayOfWeek]}
          {r.time ? ` at ${r.time}` : ""}
          {r.centreName ? ` · ${r.centreName}` : ""}
        </div>
        <FormModal
          open={editing}
          title={`Change the time for “${r.activityLabel}”`}
          dirty={time !== r.time}
          onClose={() => {
            setTime(r.time);
            setEditing(false);
          }}
          onSubmit={async () => {
            await updateRoutine(r.id, { time });
            onChanged({ time });
            toast.success("Time updated");
          }}
        >
          <div>
            <label htmlFor={`${id}-t`} className="acct-row-label" style={{ display: "block", marginBottom: 6 }}>Time</label>
            <input id={`${id}-t`} type="time" value={time} onChange={(e) => setTime(e.target.value)} autoFocus style={{ ...inputStyle, maxWidth: 200 }} />
          </div>
        </FormModal>
      </div>
      <div className="acct-item-side">
        <StatusTag tone={paused ? "muted" : "ok"}>{paused ? "Paused" : "Active"}</StatusTag>
        <TextButton onClick={() => setEditing(true)} aria-label={`Change time for ${r.activityLabel}`}>{r.time ? "Change time" : "Add time"}</TextButton>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = paused ? "active" : "paused";
              await updateRoutine(r.id, { status: next });
              onChanged({ status: next });
              toast.success(next === "paused" ? "Routine paused" : "Routine resumed");
            }, "That didn't save. Try again.")
          }
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <TextButton
          danger
          disabled={busy}
          aria-label={`Remove ${r.activityLabel}`}
          onClick={async () => {
            const ok = await confirm({ title: `Remove “${r.activityLabel}”?`, message: "It comes off your week. Pause it instead if you're only taking a break.", confirmLabel: "Remove routine", tone: "danger" });
            if (!ok) return;
            await run(async () => {
              await updateRoutine(r.id, { status: "cancelled" });
              onRemoved();
              toast.success("Routine removed");
            }, "That routine wasn't removed. Try again.");
          }}
        >
          Remove
        </TextButton>
      </div>
    </li>
  );
}

export function RoutinesPage() {
  const toast = useToast();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [suggestions, setSuggestions] = useState<RoutineSuggestion[]>([]);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const load = () => {
    setFailed(false);
    Promise.all([fetchMyRoutines(), fetchRoutineSuggestions().catch(() => [] as RoutineSuggestion[])])
      .then(([r, s]) => {
        setRoutines(r.filter((x) => x.status !== "cancelled"));
        setSuggestions(s);
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const accept = async (s: RoutineSuggestion) => {
    const k = `${s.activityLabel}::${s.dayOfWeek}`;
    setAccepting(k);
    try {
      await createRoutine({ activityLabel: s.activityLabel, centreId: s.centreId, dayOfWeek: s.dayOfWeek, time: s.time });
      toast.success("Added to your week");
      load();
    } catch {
      toast.error("That wasn't added. Try again.");
    } finally {
      setAccepting(null);
    }
  };

  const list = routines ?? [];
  const sorted = [...list].sort((a, b) => WEEK_ORDER.indexOf(a.dayOfWeek) - WEEK_ORDER.indexOf(b.dayOfWeek) || a.time.localeCompare(b.time));
  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(`${s.activityLabel}::${s.dayOfWeek}`));
  const today = todayDow();

  return (
    <AccountPage
      eyebrow="My Life"
      title="Routines"
      lede="The things you do most weeks. Explore uses your active routines to suggest sessions that fit."
      actions={routines ? <Button variant="ghost" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add a routine</Button> : undefined}
    >
      {failed ? (
        <LoadErrorState title="We couldn't load your routines." onRetry={load} />
      ) : routines === null ? (
        <div style={{ marginTop: 24 }}><RowSkeleton /></div>
      ) : (
        <>
          <AddRoutineModal
            open={adding}
            onAdded={() => {
              setAdding(false);
              load();
            }}
            onClose={() => setAdding(false)}
          />

          {list.length > 0 && (
            <AccountSection title="Your week">
              <div className="acct-weekstrip" role="list" aria-label="Your week">
                {WEEK_ORDER.map((d) => {
                  const items = sorted.filter((r) => r.dayOfWeek === d);
                  return (
                    <div key={d} className="acct-weekstrip-day" data-today={d === today ? "true" : undefined} role="listitem" aria-label={`${DAY_NAME[d]}${d === today ? ", today" : ""}: ${items.length ? items.map((i) => i.activityLabel).join(", ") : "nothing"}`}>
                      <div className="acct-weekstrip-name" aria-hidden="true">{DAY_SHORT[d]}</div>
                      <div className="acct-weekstrip-items" aria-hidden="true">
                        {items.map((r) => (
                          <span key={r.id} className="acct-weekstrip-item" data-paused={r.status === "paused" ? "true" : undefined}>
                            <strong>{r.activityLabel}</strong>
                            {r.time || (r.status === "paused" ? "Paused" : "")}
                          </span>
                        ))}
                        {items.length === 0 && <span className="acct-weekstrip-empty">Free</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccountSection>
          )}

          {visibleSuggestions.length > 0 && (
            <AccountSection title="Suggested" description="Based on what you've been going to recently.">
              <ul className="acct-list">
                {visibleSuggestions.map((s) => {
                  const k = `${s.activityLabel}::${s.dayOfWeek}`;
                  return (
                    <li key={k} className="acct-item">
                      <span className="acct-thumb" aria-hidden="true"><CalendarClock size={18} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="acct-item-title">{s.activityLabel}</div>
                        <div className="acct-item-meta">You've gone most {DAY_NAME[s.dayOfWeek]}s ({s.sessionCount} times recently)</div>
                      </div>
                      <div className="acct-item-side">
                        <Button onClick={() => accept(s)} disabled={accepting === k} aria-busy={accepting === k}>Add to my week</Button>
                        <TextButton onClick={() => setDismissed((d) => new Set(d).add(k))}>Not now</TextButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </AccountSection>
          )}

          {list.length === 0 ? (
            <AccountEmpty icon={<Repeat size={20} aria-hidden="true" />} title="No routines yet" action={<Button onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add a routine</Button>}>
              Add something you do most weeks, or keep going to the same activity and we'll suggest it here.
            </AccountEmpty>
          ) : list.length > 0 ? (
            <AccountSection title="All routines">
              <ul className="acct-list">
                {sorted.map((r) => (
                  <RoutineRow
                    key={r.id}
                    r={r}
                    onChanged={(p) => setRoutines((rows) => rows && rows.map((x) => (x.id === r.id ? { ...x, ...p } : x)))}
                    onRemoved={() => setRoutines((rows) => rows && rows.filter((x) => x.id !== r.id))}
                  />
                ))}
              </ul>
            </AccountSection>
          ) : null}

          <AccountSection>
            <Note>A routine doesn't book anything and doesn't send reminders. Book each session as usual.</Note>
          </AccountSection>
        </>
      )}
    </AccountPage>
  );
}
