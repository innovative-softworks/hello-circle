import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import {
  cancelCirclePlanIdea,
  confirmCirclePlanIdea,
  createCirclePlanIdea,
  joinCirclePlanInterest,
  leaveCirclePlanInterest,
  removeCircleWish,
  saveCirclePulse,
  withdrawCirclePulse,
} from "../../api";
import { dateLabel } from "../../euro";
import { SLOTS, type Day } from "../../participationVocab";
import type { CirclePlanIdea, CirclePlanPreview, CirclePulseGroup, CirclePulseView } from "../../types";
import { useConfirm } from "../ConfirmProvider";
import { FieldLabel } from "../form";
import { Button, ConfirmDialog, EmptyState, Modal, inputStyle, labelStyle } from "../ui";
import { LightbulbIcon } from "../icons";
import { SlotRow, type SuggestPlanPrefill } from "./CirclePulseSection";
import { CirclePlanListingBlock, LISTING_KIND_LABEL } from "./CirclePlanListing";
import { ReportContentButton } from "../ReportContentButton";
import { dateInWeek, irelandToday, orderSlots, people, remainingDays, slotLabel, weekName, weekRange } from "./circleTime";

// "What should we do next?" — the Circle Home planner (owner, 2026-10-24,
// design option B). Main column: say what you fancy and when you're free
// (saved as a Pulse wish, ticked days as its times), then "Coming up", one
// dated timeline of what's happening, what members wish for (totals only,
// never names) and the plans being gathered ("I'm in", progress, organiser
// confirm / decline / create activity). The charts and the poll sit in the
// right-hand panel (CirclePlanInsights.tsx). Wishes need circles.pulse;
// "I'm in" needs circles.make_it_happen; plans and activities show either way.

const DAY_SHORT: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

type Filter = "all" | "happening" | "ideas";
type Row =
  | { kind: "activity"; key: string; sort: string; activity: CirclePlanPreview }
  | { kind: "wish"; key: string; sort: string; group: CirclePulseGroup }
  | { kind: "plan"; key: string; sort: string; plan: CirclePlanIdea };

/** Days for the row's date column: "Thu 29 Oct" → { top, sub }. */
function dateBits(iso: string) {
  return dateLabel(iso);
}

export function CirclePlanTogether({
  circleId,
  plans,
  activities,
  pulse,
  isOrganiser,
  residentId,
  closed,
  pulseOn,
  interestOn,
  prefill,
  onPrefillUsed,
  onChanged,
  onProposeTime,
  limit,
  onSeeAll,
  showEarlier,
}: {
  circleId: string;
  plans: CirclePlanIdea[];
  /** This Circle's own upcoming activities (omit on the Activities tab, which lists them above). */
  activities?: CirclePlanPreview[];
  /** Circle Pulse, loaded by the page (shared with the right-hand panel); null while off or loading. */
  pulse: CirclePulseView | null;
  isOrganiser: boolean;
  residentId: string;
  closed: boolean;
  pulseOn: boolean;
  interestOn: boolean;
  prefill: SuggestPlanPrefill | null;
  onPrefillUsed: () => void;
  /** After any change: the page reloads plans and Pulse. */
  onChanged: () => void;
  onProposeTime?: () => void;
  limit?: number;
  onSeeAll?: () => void;
  showEarlier?: boolean;
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [interest, setInterest] = useState("");
  const [week, setWeek] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [pickTimes, setPickTimes] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<SuggestPlanPrefill | null>(null);
  const [declining, setDeclining] = useState<CirclePlanIdea | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // Circles 3.0 — filter by what a plan is about; only kinds that are here.
  const [kindFilter, setKindFilter] = useState<string>("all");

  useEffect(() => {
    if (pulse && !week) setWeek(pulse.weeks[1] ?? pulse.weeks[0]);
  }, [pulse, week]);

  useEffect(() => {
    if (!prefill) return;
    setPlanForm(prefill);
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  const today = irelandToday();
  const days = week ? remainingDays(week, today) : [];
  const dayOn = (d: Day) => slots.some((t) => t.startsWith(`${d}:`));
  const toggleDay = (d: Day) => setSlots((s) => (dayOn(d) ? s.filter((t) => !t.startsWith(`${d}:`)) : orderSlots([...s, ...SLOTS.map((x) => `${d}:${x}`)])));
  const toggleSlot = (t: string) => setSlots((s) => (s.includes(t) ? s.filter((x) => x !== t) : orderSlots([...s, t])));
  const atLimit = !!pulse && pulse.mine.length >= pulse.limits.maxActive;
  const mineFor = (g: CirclePulseGroup) => pulse?.mine.find((m) => m.weekStart === g.weekStart && m.interest.trim().toLowerCase().replace(/\s+/g, " ") === g.interestKey);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!week || adding) return;
    if (interest.trim().length < 2) {
      setAddError("Say what you'd like to do");
      document.getElementById("ce-together-interest")?.focus();
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await saveCirclePulse(circleId, { interest: interest.trim(), weekStart: week, slots: slots.filter((t) => days.includes(t.split(":")[0] as Day)) });
      setInterest("");
      setSlots([]);
      setPickTimes(false);
      onChanged();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const cancelPlan = async (p: CirclePlanIdea) => {
    // An organiser turning down someone else's suggestion can say why.
    if (interestOn && isOrganiser && p.createdByResidentId !== residentId) {
      setDeclineReason("");
      setDeclining(p);
      return;
    }
    if (!(await confirm({ title: "Cancel this plan?", message: "Members who were interested will be told it isn't happening.", confirmLabel: "Cancel plan", cancelLabel: "Keep it", tone: "danger" }))) return;
    await run(p.id, () => cancelCirclePlanIdea(circleId, p.id));
  };

  // One timeline, by date. A wish sorts on its best day, else the end of its week.
  const live = plans.filter((p) => (p.status === "idea" || p.status === "confirmed") && p.stage !== "expired");
  const earlier = plans.filter((p) => !live.includes(p));
  const wishes = (pulse?.groups ?? []).filter((g) => !g.planId);
  const rows: Row[] = [
    ...(activities ?? []).map((a): Row => ({ kind: "activity", key: `a-${a.id}`, sort: `${a.date} ${a.time}`, activity: a })),
    ...wishes.map((g): Row => ({ kind: "wish", key: `w-${g.key}`, sort: g.topSlot ? `${dateInWeek(g.weekStart, g.topSlot.split(":")[0] as Day)} 1` : `${dateInWeek(g.weekStart, "sun")} 9`, group: g })),
    ...live.map((p): Row => ({ kind: "plan", key: `p-${p.id}`, sort: p.proposedDate ? `${p.proposedDate} ${p.proposedTime ?? "2"}` : "9999", plan: p })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));
  const kindsHere = [...new Set(live.map((p) => p.listing?.kind).filter((k): k is string => !!k))];
  const kindOf = (r: Row) => (r.kind === "activity" ? "activity" : r.kind === "plan" ? r.plan.listing?.kind ?? null : null);
  const filtered = rows
    .filter((r) => filter === "all" || (filter === "happening" ? r.kind === "activity" : r.kind !== "activity"))
    .filter((r) => kindFilter === "all" || kindOf(r) === kindFilter);
  const shown = limit ? filtered.slice(0, limit) : filtered;

  const renderActivity = (a: CirclePlanPreview) => {
    const full = a.spotsLeft <= 0;
    return (
      <li key={`a-${a.id}`} className="cp-row cp-row--happening">
        <div className="cp-when">
          <strong>{dateBits(a.date)}</strong>
          <span>{a.time}</span>
        </div>
        <div className="cp-main">
          <p className="cp-title">
            {a.activityLabel}
            <span className="cp-pill cp-pill--happening">Happening</span>
          </p>
          <p className="cp-meta">{[`${a.joined} going`, full ? "Full" : `${a.spotsLeft} ${a.spotsLeft === 1 ? "place" : "places"} left`, a.centreName || a.locationText].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="cp-actions">
          {full ? (
            <button type="button" className="cp-btn cp-btn--outline" onClick={() => navigate(`/games/${a.id}`)}>
              View
            </button>
          ) : (
            <Button onClick={() => navigate(`/games/${a.id}`)}>Join</Button>
          )}
        </div>
      </li>
    );
  };

  const renderWish = (g: CirclePulseGroup) => {
    const mine = mineFor(g);
    const when = pulse ? weekName(g.weekStart, pulse.weeks).toLowerCase() : "";
    const matched = g.status === "matched";
    const day = g.topSlot ? dateInWeek(g.weekStart, g.topSlot.split(":")[0] as Day) : null;
    return (
      <li key={`w-${g.key}`} className={`cp-row ${matched ? "cp-row--hot" : "cp-row--wish"}`}>
        <div className="cp-when">
          <strong>{day ? dateBits(day) : pulse ? weekName(g.weekStart, pulse.weeks) : ""}</strong>
          <span>{g.topSlot ? g.topSlot.split(":")[1] : weekRange(g.weekStart)}</span>
        </div>
        <div className="cp-main">
          <p className="cp-title">
            {g.interest.charAt(0).toUpperCase() + g.interest.slice(1)}
            <span className={`cp-pill ${matched ? "cp-pill--wish" : ""}`}>{matched ? "Enough to plan" : "Wish"}</span>
          </p>
          <p className="cp-meta">
            {g.count === null ? `Only you so far · ${when}` : `${people(g.count)} want this ${when}`}
            {g.topSlot && g.topSlotCount !== null ? ` · ${g.topSlotCount} of them are free ${slotLabel(g.topSlot)}` : ""}
          </p>
        </div>
        {!closed && (
          <div className="cp-actions">
            {mine ? (
              <button
                type="button"
                className="cp-btn cp-btn--keen"
                aria-pressed="true"
                disabled={busy === mine.id}
                onClick={async () => {
                  if (!(await confirm({ title: "Withdraw your interest?", message: `You'll no longer count towards ${g.interest}. You can add it again any time.`, confirmLabel: "Withdraw" }))) return;
                  await run(mine.id, () => withdrawCirclePulse(circleId, mine.id));
                }}
              >
                <Check size={15} aria-hidden="true" /> Keen
              </button>
            ) : (
              <button
                type="button"
                className="cp-btn cp-btn--outline"
                disabled={busy === g.key || atLimit}
                onClick={() => run(g.key, () => saveCirclePulse(circleId, { interest: g.interest, weekStart: g.weekStart, slots: g.topSlot ? [g.topSlot] : [] }))}
              >
                {busy === g.key ? "Adding…" : "I'm keen"}
              </button>
            )}
            {(matched || isOrganiser) && (
              <div className="cp-links">
                {matched && (
                  <button type="button" className="cp-link" onClick={() => setPlanForm({ title: g.interest, sourcePulseKey: g.key, proposedDate: day ?? undefined })}>
                    Make it a plan
                  </button>
                )}
                {isOrganiser && (
                  <button
                    type="button"
                    className="cp-link"
                    disabled={busy === `rm-${g.key}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Remove "${g.interest}"?`,
                        message: "Everyone's wish for this goes, for this week. The people who added it are told it was taken down by an organiser (not who). This is recorded.",
                        confirmLabel: "Remove wish",
                        tone: "danger",
                      });
                      if (ok) await run(`rm-${g.key}`, () => removeCircleWish(circleId, g.weekStart, g.interestKey));
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  const renderPlan = (p: CirclePlanIdea) => {
    // Circles 3.0 — a plan shared from another Circle: members here can say
    // they're in, but only its home Circle's organisers decide.
    const home = p.circleId === circleId;
    const canDecide = isOrganiser && home;
    const confirmed = p.status === "confirmed";
    const ready = p.stage === "ready";
    const target = p.targetSize ?? 3;
    const counting = typeof p.interestCount === "number";
    const gathering = p.stage === "gathering" || ready;
    const isCreator = p.createdByResidentId === residentId;
    const status = confirmed ? "Confirmed" : ready ? "Ready for review" : counting ? `Plan · ${p.interestCount} of ${target} in` : "Plan";
    const createHref =
      `/games/host?activity=${encodeURIComponent(p.title)}&circleId=${p.circleId}&planId=${p.id}` +
      (p.proposedDate ? `&date=${p.proposedDate}` : "") +
      (p.proposedTime ? `&time=${p.proposedTime}` : "") +
      (p.locationText ? `&locationText=${encodeURIComponent(p.locationText)}` : "") +
      (p.interestCount ? `&capacity=${Math.max(p.interestCount, p.targetSize ?? 0)}` : "");
    return (
      <li key={`p-${p.id}`} className={`cp-row ${confirmed ? "cp-row--confirmed" : "cp-row--proposed"}`} id={`plan-${p.id}`}>
        <div className="cp-when">
          <strong>{p.proposedDate ? dateBits(p.proposedDate) : "No date yet"}</strong>
          <span>{[p.proposedTime, confirmed ? "confirmed" : "proposed"].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="cp-main">
          <p className="cp-title">
            {p.title}
            <span className={`cp-pill ${ready ? "cp-pill--ready" : confirmed ? "cp-pill--wish" : "cp-pill--proposed"}`}>{status}</span>
          </p>
          <p className="cp-meta">{[p.locationText, ready ? "waiting for an organiser" : null, home || !p.shared ? `suggested by ${isCreator ? "you" : p.createdByName}` : `suggested in ${p.shared.homeCircle?.name ?? "another Circle"}`].filter(Boolean).join(" · ")}</p>
          {p.shared && (
            <p className="cp-shared">
              {home ? `Shared with ${p.shared.partnerCircle?.name ?? "another Circle"}` : `Shared by ${p.shared.homeCircle?.name ?? "another Circle"}`} · interest counts members of both
            </p>
          )}
          {p.listing && <CirclePlanListingBlock listing={p.listing} interested={!!p.interestedByMe} />}
          {counting && gathering && (
            <span className="cp-progress" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round(((p.interestCount ?? 0) / target) * 100))}%` }} />
            </span>
          )}
        </div>
        <div className="cp-actions">
          {interestOn && gathering && !closed && (
            <button
              type="button"
              className={`cp-btn ${p.interestedByMe ? "cp-btn--keen" : "cp-btn--outline"}`}
              aria-pressed={!!p.interestedByMe}
              disabled={busy === p.id}
              onClick={() => run(p.id, () => (p.interestedByMe ? leaveCirclePlanInterest(circleId, p.id) : joinCirclePlanInterest(circleId, p.id)))}
            >
              {busy === p.id ? (
                "…"
              ) : p.interestedByMe ? (
                <>
                  <Check size={15} aria-hidden="true" /> I'm in · withdraw
                </>
              ) : (
                "I'm in"
              )}
            </button>
          )}
          {/* Circles 3.0 — a plan about an existing listing is booked there;
              only a free-text or venue plan becomes the Circle's own activity. */}
          {confirmed && canDecide && !closed && (!p.listing || p.listing.kind === "venue" || p.listing.kind === "club") && (
            <Button onClick={() => navigate(createHref + (p.listing && p.listing.type === "centre" && !p.locationText ? `&locationText=${encodeURIComponent(p.listing.title)}` : ""))}>Create activity</Button>
          )}
          <div className="cp-links">
            {p.status === "idea" && canDecide && !closed && (
              <button type="button" className="cp-link" disabled={busy === p.id} onClick={() => run(p.id, () => confirmCirclePlanIdea(circleId, p.id))}>
                Confirm plan
              </button>
            )}
            {(p.status === "idea" || confirmed) && (canDecide || (isCreator && p.status === "idea")) && !closed && (
              <button type="button" className="cp-link" disabled={busy === p.id} onClick={() => cancelPlan(p)}>
                {canDecide && !isCreator && interestOn && p.status === "idea" ? "Decline" : "Cancel"}
              </button>
            )}
            {/* Circles 3.0 — any member can report someone else's plan to HelloCircle. */}
            {!isCreator && (
              <ReportContentButton
                targetType="circle_plan"
                targetId={p.id}
                what="this plan"
                render={(onClick, already) =>
                  already ? (
                    <span className="cp-link" style={{ textDecoration: "none", cursor: "default" }}>Reported</span>
                  ) : (
                    <button type="button" className="cp-link" onClick={onClick}>
                      Report
                    </button>
                  )
                }
              />
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="cp" aria-labelledby="cp-title">
      <header className="cp-head">
        <p className="cp-eyebrow">Plan together</p>
        <h2 id="cp-title">What should we do next?</h2>
        <p>{pulseOn ? "Say what you fancy and when you're free. Others only ever see totals." : "Suggest something and see what the Circle thinks. An organiser makes it real."}</p>
      </header>

      {pulseOn && pulse && week && !closed && (
        <div className="cp-add">
          <label htmlFor="ce-together-interest" className="cp-label">
            What would you like to do?
          </label>
          <div className="cp-add-row">
            <input
              id="ce-together-interest"
              value={interest}
              onChange={(e) => (setInterest(e.target.value), setAddError(null))}
              onKeyDown={(e) => e.key === "Enter" && add()}
              maxLength={60}
              placeholder="e.g. Sea swim, a coffee, a longer hike"
              list="ce-together-suggestions"
              aria-invalid={!!addError || undefined}
              aria-describedby={addError ? "ce-together-error" : undefined}
              style={inputStyle}
            />
            <datalist id="ce-together-suggestions">
              {pulse.suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Button onClick={add} disabled={adding || atLimit}>
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
          <div className="cp-add-when">
            <div className="cp-seg" role="group" aria-label="Which week">
              {pulse.weeks.map((w) => (
                <button key={w} type="button" aria-pressed={week === w} onClick={() => (setWeek(w), setSlots([]))}>
                  {weekName(w, pulse.weeks)}
                </button>
              ))}
            </div>
            {days.length > 0 && !pickTimes && (
              <div className="cp-days" role="group" aria-label="Days you're free (optional)">
                {days.map((d) => (
                  <button key={d} type="button" className="cp-day" aria-pressed={dayOn(d)} onClick={() => toggleDay(d)}>
                    {DAY_SHORT[d]}
                  </button>
                ))}
              </div>
            )}
            {days.length > 0 && (
              <button type="button" className="cp-link" onClick={() => setPickTimes((v) => !v)}>
                {pickTimes ? "Just pick days" : "Times"}
              </button>
            )}
          </div>
          {pickTimes && (
            <div className="ce-slot-grid" role="group" aria-label="Times you're free" style={{ maxWidth: 520 }}>
              <span />
              {SLOTS.map((s) => (
                <span key={s} className="ce-slot-head">
                  {s}
                </span>
              ))}
              {days.map((d) => (
                <SlotRow key={d} day={d} label={DAY_SHORT[d]} selected={slots} onToggle={toggleSlot} />
              ))}
            </div>
          )}
          {addError && (
            <p id="ce-together-error" role="alert" className="cp-error">
              {addError}
            </p>
          )}
          {atLimit && <p className="cp-note">You have {pulse.limits.maxActive} wishes open — withdraw one to add another.</p>}
        </div>
      )}

      <div className="cp-list">
        <div className="cp-list-head">
          <h3>Coming up</h3>
          <div className="cp-filters" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["happening", "Happening"],
                ["ideas", "Ideas"],
              ] as const
            )
              .filter(([k]) => k !== "happening" || activities)
              .map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
          </div>
        </div>
        {kindsHere.length > 0 && (
          <div className="cp-filters cp-filters--kinds" role="group" aria-label="What it is">
            {[["all", "Everything"] as const, ...kindsHere.map((k) => [k, LISTING_KIND_LABEL[k] ?? k] as const)].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        {shown.length === 0 ? (
          <EmptyState icon={<LightbulbIcon size={18} />} title="Nothing yet" subtitle={pulseOn ? "Add what you'd like to do above — when one more person wants the same, everyone sees the total." : "Suggest something and see what the Circle thinks."} />
        ) : (
          <ol className="cp-timeline">{shown.map((r) => (r.kind === "activity" ? renderActivity(r.activity) : r.kind === "wish" ? renderWish(r.group) : renderPlan(r.plan)))}</ol>
        )}
        <div className="cp-list-foot">
          {!closed && (
            <button type="button" className="cp-link cp-link--strong" onClick={() => setPlanForm({ title: "" })}>
              + Suggest a plan with a date
            </button>
          )}
          {!closed && onProposeTime && (
            <button type="button" className="cp-link cp-link--strong" onClick={onProposeTime}>
              + Propose a time
            </button>
          )}
          {limit && onSeeAll && filtered.length > limit && (
            <button type="button" className="cp-link cp-link--strong" style={{ marginLeft: "auto" }} onClick={onSeeAll}>
              See all {filtered.length} →
            </button>
          )}
        </div>

        {showEarlier && earlier.length > 0 && (
          <div className="cp-earlier">
            <h3>Earlier plans</h3>
            <ul>
              {earlier.map((p) => (
                <li key={p.id} id={`plan-${p.id}`}>
                  <span>
                    <strong>{p.title}</strong> · {p.stage === "expired" ? "went quiet" : p.status === "cancelled" ? "declined" : p.status === "completed" ? "completed" : "it's happening"}
                    {p.declineReason ? ` · Organiser: ${p.declineReason}` : ""}
                  </span>
                  {p.activity && p.activity.status !== "cancelled" && (
                    <button type="button" className="cp-link" onClick={() => navigate(`/games/${p.activity!.id}`)}>
                      View activity →
                    </button>
                  )}
                  {/* Circles 3.0 — no recurring plans (owner decision 6): suggest it again instead. */}
                  {!closed && p.circleId === circleId && (p.status === "completed" || p.stage === "expired" || (p.listing && p.listing.availability === "past")) && (
                    <button
                      type="button"
                      className="cp-link"
                      disabled={busy === `again-${p.id}`}
                      onClick={() =>
                        run(`again-${p.id}`, () =>
                          createCirclePlanIdea(circleId, {
                            title: p.title,
                            locationText: p.locationText ?? undefined,
                            // A new suggestion for the same listing; members pick the next date.
                            listing: p.listing && p.listing.availability !== "unavailable" && p.listing.availability !== "cancelled" ? { type: p.listing.type, id: p.listing.id } : undefined,
                          })
                        )
                      }
                    >
                      {busy === `again-${p.id}` ? "Suggesting…" : "Suggest again"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="cp-foot">Saying you're keen isn't a booking. Wishes end with their week; plans end on their date, or after three weeks.</p>

      {planForm && (
        <PlanFormDialog
          circleId={circleId}
          initial={planForm}
          withSize={interestOn}
          onClose={() => setPlanForm(null)}
          onSaved={() => {
            setPlanForm(null);
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={!!declining}
        title="Decline this suggestion?"
        message={`${declining?.title ?? "This plan"} won't go ahead. Members are told, with your reason if you give one.`}
        confirmLabel="Decline"
        tone="danger"
        busy={!!declining && busy === declining.id}
        onConfirm={async () => {
          if (!declining) return;
          const p = declining;
          await run(p.id, () => cancelCirclePlanIdea(circleId, p.id, declineReason.trim() || undefined));
          setDeclining(null);
        }}
        onCancel={() => setDeclining(null)}
      >
        <label htmlFor="ce-decline-reason" style={labelStyle}>
          Reason (optional, members see it)
        </label>
        <textarea id="ce-decline-reason" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} maxLength={500} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </ConfirmDialog>
    </section>
  );
}

function PlanFormDialog({ circleId, initial, withSize, onClose, onSaved }: { circleId: string; initial: SuggestPlanPrefill; withSize: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(initial.proposedDate ?? "");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [targetSize, setTargetSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const dirty = title !== initial.title || !!note || !!time || !!location || !!targetSize;

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
        targetSize: withSize && targetSize ? Number(targetSize) : undefined,
        sourcePulseKey: withSize ? initial.sourcePulseKey : undefined,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't share the idea — try again");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Suggest a plan"
      subtitle="Members can say they're in; an organiser confirms it and sets it up."
      confirmClose={dirty ? { title: "Discard this plan?", message: "What you've entered here won't be saved." } : undefined}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!title.trim() || busy}>
            {busy ? "Sharing…" : "Suggest to Circle"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && (
          <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}
        <div>
          <FieldLabel htmlFor="ce-plan-title" required>
            What should we do?
          </FieldLabel>
          <input id="ce-plan-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coastal walk" maxLength={255} style={inputStyle} />
        </div>
        <div>
          <FieldLabel htmlFor="ce-plan-note" optional>
            Tell the circle more
          </FieldLabel>
          <textarea id="ce-plan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="We could meet at the station and walk to the harbour." style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} />
        </div>
        <div className="ce-fields">
          <div>
            <FieldLabel htmlFor="ce-plan-date" optional>
              When?
            </FieldLabel>
            <input id="ce-plan-date" type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor="ce-plan-time" optional>
              Time
            </FieldLabel>
            <input id="ce-plan-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <FieldLabel htmlFor="ce-plan-location" optional>
              Where?
            </FieldLabel>
            <input id="ce-plan-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bray Station" style={inputStyle} />
          </div>
          {withSize && (
            <div>
              <FieldLabel htmlFor="ce-plan-size" optional>
                How many make it worth doing?
              </FieldLabel>
              <input id="ce-plan-size" type="number" inputMode="numeric" min={2} max={100} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} placeholder="3" style={inputStyle} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

