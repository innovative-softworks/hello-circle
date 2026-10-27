import { useEffect, useState } from "react";
import { fetchCircleFreeTime, saveCircleFreeTime, withdrawCircleFreeTime } from "../../api";
import { SLOTS, type Day } from "../../participationVocab";
import type { CircleFreeTimeView } from "../../types";
import { ClockIcon } from "../icons";
import { Button, EmptyState, LoadErrorState, Skeleton } from "../ui";
import { SlotRow, type SuggestPlanPrefill } from "./CirclePulseSection";
import { dateInWeek, irelandToday, orderSlots, people, remainingDays, slotLabel, weekName, weekRange } from "./circleTime";

// Circle Experience 2.0 — Free Time Match (circles.free_time_match). Opt-in:
// a member shares when they're free this week or next, for this Circle
// only. Saving is the consent; "Stop sharing" deletes it. Results are
// totals from three people up ("4 members are free Sunday afternoon"), and
// never a calendar, a name or anyone's exact schedule.

const DAY_SHORT: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function CircleFreeTimeSection({ circleId, closed, onSuggestPlan }: { circleId: string; closed: boolean; onSuggestPlan: (prefill: SuggestPlanPrefill) => void }) {
  const [view, setView] = useState<CircleFreeTimeView | null>(null);
  const [failed, setFailed] = useState(false);
  const [week, setWeek] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = () => {
    setFailed(false);
    fetchCircleFreeTime(circleId)
      .then((v) => {
        setView(v);
        setWeek((w) => {
          // Open on a week you've already shared, if any.
          const next = w ?? v.weeks.find((x) => v.mine[x]) ?? v.weeks[0];
          setSlots(v.mine[next] ?? []);
          return next;
        });
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, [circleId]);

  if (failed) return <LoadErrorState title="We couldn't load Free Time Match." onRetry={load} />;
  if (!view || !week) return <Skeleton height={120} />;

  const saved = view.mine[week];
  const days = remainingDays(week, irelandToday());
  const changed = (saved ?? []).join() !== slots.join();
  const toggle = (t: string) => setSlots((s) => (s.includes(t) ? s.filter((x) => x !== t) : orderSlots([...s, t])));
  const switchWeek = (w: string) => {
    setWeek(w);
    setSlots(view.mine[w] ?? []);
    setStatus(null);
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await saveCircleFreeTime(circleId, week, slots);
      setStatus({ kind: "ok", text: slots.length ? "Shared with this Circle." : "Removed." });
      load();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "That didn't save. Try again." });
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await withdrawCircleFreeTime(circleId, week);
      setSlots([]);
      setStatus({ kind: "ok", text: "You've stopped sharing this week." });
      load();
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof Error ? e.message : "That didn't go through. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const matches = view.matches;
  const suggestFrom = (m: (typeof matches)[number]) =>
    onSuggestPlan({
      title: m.interest ?? "",
      sourcePulseKey: m.interestKey ? `${m.weekStart}|${m.interestKey}` : undefined,
      proposedDate: dateInWeek(m.weekStart, m.slot.split(":")[0] as Day),
    });

  return (
    <div>
      <div className="ce-section-head">
        <div>
          <h2>Free Time Match</h2>
          <p>Share when you're free and see when enough of you line up. Only for this Circle, only totals, and it ends with the week.</p>
        </div>
      </div>

      {matches.length === 0 ? (
        <EmptyState
          icon={<ClockIcon size={20} />}
          title="No match yet"
          subtitle={`We show a time once at least ${view.minGroup} members are free together.`}
        />
      ) : (
        <ul className="ce-rows" style={{ listStyle: "none", margin: "0 0 20px", padding: 0 }}>
          {matches.map((m) => {
            const when = slotLabel(m.slot);
            const title = m.interest ? `${people(m.count)} want to do ${m.interest} on ${when}` : `${people(m.count)} are free on ${when}`;
            return (
              <li key={`${m.weekStart}|${m.slot}|${m.interestKey ?? ""}`} className="ce-row">
                <div className="ce-row-main">
                  <p className="ce-row-title">{title}</p>
                  <div className="ce-row-meta">
                    <span>{weekName(m.weekStart, view.weeks)} · {weekRange(m.weekStart)}</span>
                    {m.includesMe && <span className="ce-pill ce-pill--green">Includes you</span>}
                  </div>
                </div>
                {!closed && (
                  <div className="ce-row-actions">
                    <Button variant="ghost" onClick={() => suggestFrom(m)}>
                      Suggest a plan
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!closed && (
        <div className="ce-guide" style={{ marginTop: matches.length ? 0 : 16 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800 }}>When are you free?</h3>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-muted-light)" }}>
            {saved ? "You're sharing this week with the Circle." : "Not shared. Nothing is visible until you save."}
            {view.sharedCount[week] !== null && ` ${people(view.sharedCount[week]!)} have shared so far.`}
          </p>
          <div className="ce-week-switch" role="group" aria-label="Week">
            {view.weeks.map((w) => (
              <button key={w} type="button" className="ce-chip" aria-pressed={week === w} onClick={() => switchWeek(w)}>
                {weekName(w, view.weeks)} · {weekRange(w)}
              </button>
            ))}
          </div>
          {days.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-muted-light)" }}>This week is over — choose next week.</p>
          ) : (
            <div className="ce-slot-grid" role="group" aria-label={`Free times, ${weekName(week, view.weeks).toLowerCase()}`}>
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
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
            <Button onClick={save} disabled={busy || !changed || (slots.length === 0 && !saved)}>
              {busy ? "Saving…" : saved ? "Update" : "Share with this Circle"}
            </Button>
            {saved && (
              <Button variant="ghost" onClick={stop} disabled={busy}>
                Stop sharing
              </Button>
            )}
            {status && (
              <span role={status.kind === "error" ? "alert" : "status"} style={{ fontSize: 13, color: status.kind === "error" ? "var(--color-danger)" : "var(--color-green-text)" }}>
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
