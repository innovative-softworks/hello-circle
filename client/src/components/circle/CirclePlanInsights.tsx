import { useState } from "react";
import { BarChart3, CalendarDays, ChartColumn } from "lucide-react";
import { voteOnCirclePollOption } from "../../api";
import { dateLabel } from "../../euro";
import type { CircleFreeDay, CirclePlanIdea, CirclePlanPreview, CirclePoll, CirclePulseView } from "../../types";

// Right-hand panel cards for the Circle Home planner (owner, 2026-10-24,
// design option B): the Circle's planning at a glance, who's free over the
// next two weeks, the most wanted ideas and the open poll. Same card look
// as the panel's other cards (.ch-card). Totals only, never names: a day
// shows its number from three people up (server: freeDays()), a wish from two.

const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", timeZone: "Europe/Dublin" });
const dayNum = (iso: string) => String(Number(iso.slice(8, 10)));

function liveIdeas(plans: CirclePlanIdea[]) {
  return plans.filter((p) => (p.status === "idea" || p.status === "confirmed") && p.stage !== "expired");
}

export function PlanStatsCard({ pulse, plans, activities, days }: { pulse: CirclePulseView | null; plans: CirclePlanIdea[]; activities: CirclePlanPreview[]; days: CircleFreeDay[] | null }) {
  const ideas = liveIdeas(plans).length + (pulse?.groups ?? []).filter((g) => !g.planId).length;
  const best = days?.find((d) => d.best);
  return (
    <div className="cpi-stats">
      <h3 id="cpi-stats-title">This Circle right now</h3>
      <dl>
        <div>
          <dd>{ideas}</dd>
          <dt>{ideas === 1 ? "idea open" : "ideas open"}</dt>
        </div>
        <div>
          <dd>{activities.length}</dd>
          <dt>happening</dt>
        </div>
        <div>
          <dd>{best ? `${shortDay(best.date)} ${dayNum(best.date)}` : "—"}</dd>
          <dt>best day</dt>
        </div>
      </dl>
    </div>
  );
}

export function WhosFreeCard({ days, activities, plans }: { days: CircleFreeDay[] | null; activities: CirclePlanPreview[]; plans: CirclePlanIdea[] }) {
  if (!days) return null;
  const top = Math.max(1, ...days.map((d) => d.free ?? 0));
  const best = days.find((d) => d.best);
  const bests = days.filter((d) => d.best).slice(0, 2);
  const bestText = bests.map((d) => dateLabel(d.date)).join(" and ");
  const happening = new Set(activities.map((a) => a.date));
  const proposed = new Set(liveIdeas(plans).map((p) => p.proposedDate).filter(Boolean) as string[]);
  const summary = best ? `${bestText} ${bests.length > 1 ? "suit" : "suits"} the most people: ${best.free} free.` : "Not enough people have shared when they're free yet.";
  return (
    <section className="cpi-sec" aria-labelledby="cpi-free-title">
      <div className="cpi-head">
        <h3 id="cpi-free-title">
          <CalendarDays size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Who's free
        </h3>
        <span>till end of next week</span>
      </div>
      <p className="cpi-lead">{best ? <><strong>{bestText}</strong> {bests.length > 1 ? "suit" : "suits"} the most people</> : "Days fill in once 3 people are free"}</p>
      <figure className="cpi-chart" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} role="img" aria-label={`Members free each day for the next two weeks. ${summary}`}>
        {days.map((d) => {
          const tone = d.free === null ? "quiet" : d.best ? "best" : d.free / top >= 0.6 ? "high" : "mid";
          const h = d.free === null ? 12 : 20 + Math.round((d.free / top) * 70);
          return (
            <div key={d.date} className="cpi-col" title={d.free === null ? `${dateLabel(d.date)}: fewer than 3 free` : `${dateLabel(d.date)}: ${d.free} free`}>
              <span className="cpi-n">{d.free ?? ""}</span>
              <span className={`cpi-bar cpi-bar--${tone}`} style={{ height: h }} />
              <span className={`cpi-mark${happening.has(d.date) ? " cpi-mark--happening" : proposed.has(d.date) ? " cpi-mark--proposed" : ""}`} />
              <span className={`cpi-day${d.best ? " cpi-day--best" : ""}`}>{shortDay(d.date).slice(0, 1)}</span>
              <span className={`cpi-day${d.best ? " cpi-day--best" : ""}`}>{dayNum(d.date)}</span>
            </div>
          );
        })}
      </figure>
      <ul className="cpi-key">
        <li>
          <span className="cpi-sw cpi-sw--free" /> Members free
        </li>
        <li>
          <span className="cpi-sw cpi-sw--happening" /> Happening
        </li>
        <li>
          <span className="cpi-sw cpi-sw--proposed" /> Proposed
        </li>
      </ul>
      <p className="cpi-fine">Days with fewer than 3 people free stay quiet, so nobody can be picked out.</p>
    </section>
  );
}

export function MostWantedCard({ pulse, plans }: { pulse: CirclePulseView | null; plans: CirclePlanIdea[] }) {
  const items = [
    ...(pulse?.groups ?? []).filter((g) => g.count !== null && !g.planId).map((g) => ({ key: `w-${g.key}`, label: g.interest.charAt(0).toUpperCase() + g.interest.slice(1), n: g.count as number, plan: false })),
    ...liveIdeas(plans)
      .filter((p) => (p.interestCount ?? 0) > 0)
      .map((p) => ({ key: `p-${p.id}`, label: p.title, n: p.interestCount as number, plan: true })),
  ]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  if (items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <section className="cpi-sec" aria-labelledby="cpi-wanted-title">
      <h3 id="cpi-wanted-title">
        <BarChart3 size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Most wanted
      </h3>
      <ul className="cpi-wanted">
        {items.map((i) => (
          <li key={i.key}>
            <span className="cpi-wanted-row">
              <span>{i.label}</span>
              <strong>
                {i.n}
                <span className="visually-hidden"> {i.n === 1 ? "person" : "people"} keen</span>
              </strong>
            </span>
            <span className="cpi-track" aria-hidden="true">
              <span className={i.plan ? "cpi-fill cpi-fill--plan" : "cpi-fill"} style={{ width: `${Math.max(6, Math.round((i.n / max) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <ul className="cpi-key">
        <li>
          <span className="cpi-sw cpi-sw--free" /> Wish
        </li>
        <li>
          <span className="cpi-sw cpi-sw--happening" /> Plan
        </li>
      </ul>
    </section>
  );
}

export function RailPollCard({ circleId, polls, closed, onChanged, onSeeAll, onPropose }: { circleId: string; polls: CirclePoll[]; closed: boolean; onChanged: () => void; onSeeAll: () => void; onPropose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const poll = polls.find((p) => p.status === "open");
  const total = poll ? poll.options.reduce((n, o) => n + o.voteCount, 0) : 0;
  return (
    <section className="cpi-sec" aria-labelledby="cpi-poll-title">
      <div className="cpi-head">
        <h3 id="cpi-poll-title">
          <ChartColumn size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Poll
        </h3>
        {polls.length > 0 && (
          <button type="button" className="ch-see-all" onClick={onSeeAll}>
            All polls →
          </button>
        )}
      </div>
      {poll ? (
        <>
          <p className="cpi-question">{poll.question}</p>
          <div className="cpi-options">
            {poll.options.map((o) => {
              const pct = total ? Math.round((o.voteCount / total) * 100) : 0;
              return (
                <button
                  key={o.id}
                  type="button"
                  className="cpi-option"
                  aria-pressed={o.votedByMe}
                  disabled={closed}
                  style={{ background: `linear-gradient(90deg, ${o.votedByMe ? "#d5e9dc" : "var(--color-panel)"} ${pct}%, var(--color-surface) ${pct}%)` }}
                  onClick={() =>
                    voteOnCirclePollOption(circleId, poll.id, o.id)
                      .then(onChanged)
                      .catch((e) => setError(e instanceof Error ? e.message : "Your vote didn't save. Try again."))
                  }
                >
                  <span>
                    {o.votedByMe ? "✓ " : ""}
                    {dateLabel(o.date)}
                    {o.time ? ` · ${o.time}` : ""}
                  </span>
                  <span className="cpi-option-n">{pct}%</span>
                </button>
              );
            })}
          </div>
          <p className="cpi-fine">
            {total} vote{total === 1 ? "" : "s"} so far · vote for every day you could make
          </p>
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className="cpi-fine" style={{ marginTop: 0 }}>
          No poll open. Propose a few dates and let the Circle vote.
        </p>
      )}
      {!closed && (
        <button type="button" className="ch-see-all" style={{ marginTop: 6 }} onClick={onPropose}>
          + Propose a time
        </button>
      )}
    </section>
  );
}


/** The four planning insights as one card (owner, 2026-10-24): the totals as
 * a green header, then who's free, most wanted and the poll as sections. */
export function PlanInsightsCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="ch-card cpi-merged" aria-labelledby="cpi-stats-title">
      {children}
    </section>
  );
}
