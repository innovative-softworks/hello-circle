import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchMyPlans, type MyPlan, type MyRecentVisit } from "../../api";
import { useGuest } from "../../GuestContext";
import { FollowButton } from "../FollowButton";
import { CompactRow, CompactRows } from "../CompactRow";
import type { CardLabel } from "../CardDate";
import { activityIcon } from "../circle/CircleHomeParts";
import { passDate, passTime, type PassKind, type PassTone } from "../pass/Pass";
import { BoardingPass } from "../pass/BoardingPass";
import { gamePassCode } from "../pass/ScanPassModal";
import { LoadErrorState, Skeleton } from "../ui";
import "../trust/trust.css";

// Trust & Retention — My Life "Your next plan" and "Recent visits"
// (server: myLifePlans.ts, docs/trust-retention/06-*).
//
// Your next plan: the nearest commitment (booked, Circle RSVP, payment not
// finished, waiting for the host). Before the day it leads with preparation;
// on the day with time, place, arrival and the contact route; a waitlist or
// interest is never shown as a place. Recent visits: finished plans from the
// last two weeks with their attendance/review state, the next date of the
// same series or listing (never guessed, never booked automatically) and a
// follow action. All states come from the server; nothing is inferred here.

const SHORT = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
const short = (iso: string) => SHORT.format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const euro = (c: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(c / 100);

const PRIMARY: Record<MyPlan["status"], string> = {
  confirmed: "View booking",
  rsvp: "Open the meetup",
  pending_payment: "See booking",
  pending_approval: "View request",
  waitlist: "View waitlist place",
  interest: "Open the Circle",
  cancelled: "See what happened",
};

function directions(plan: MyPlan) {
  const place = plan.prep.meeting ?? plan.location;
  return place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null;
}

const VISIT: Record<MyRecentVisit["visit"], string> = {
  review_submitted: "Review submitted",
  review_available: "Attendance confirmed · you can review it",
  request_pending: "Waiting for the organiser to confirm you attended",
  declined: "The organiser didn't confirm your attendance",
  missed: "Recorded as missed",
  not_confirmed: "The organiser hasn't confirmed you attended yet",
};

/** The same coloured line above the title that every card uses (CardDate.tsx tones). */
const VISIT_LABEL: Record<MyRecentVisit["visit"], CardLabel> = {
  review_available: { rest: "Attended · review it", tone: "mine" },
  review_submitted: { rest: "Reviewed", tone: "line" },
  request_pending: { rest: "Confirmation asked", tone: "wait" },
  not_confirmed: { rest: "Attendance not confirmed yet", tone: "plain" },
  declined: { rest: "Not confirmed by the organiser", tone: "hot" },
  missed: { rest: "Recorded as missed", tone: "hot" },
};

const RECENT_SHOWN = 3;

/** The same pass looks as the booking pages (owner 2026-10-27): lanyard for
 * Circle meetups, wallet for activities, ticket for experiences, programmes
 * and rooms. A code only while the place is good to use. */
function passKind(p: MyPlan): PassKind {
  if (p.placeKind === "game") return p.circleName ? "circle" : "activity";
  if (p.placeKind === "experience") return p.listingHref?.startsWith("/adventures") ? "adventure" : "experience";
  if (p.placeKind === "program") return "programme";
  return "room";
}
const PASS_TONE: Record<MyPlan["status"], PassTone> = {
  confirmed: "ok",
  rsvp: "ok",
  pending_payment: "wait",
  pending_approval: "wait",
  waitlist: "wait",
  interest: "wait",
  cancelled: "bad",
};
function passStatus(p: MyPlan) {
  const going = p.status === "confirmed" || p.status === "rsvp";
  if (going && p.phase === "today") return p.placeKind === "game" ? "Today · check in when you arrive" : "Today";
  return p.statusLabel;
}

/** A horizontal boarding pass (owner 2026-10-28): the type colour down the
 * left edge, the plan in boarding-pass columns, a perforation and a tear-off
 * stub with the check-in code. Same kind colours and tones as the booking
 * page passes (pass.css); stacks on phones with the stub underneath. */
function NextPass({ plan, residentId, residentName }: { plan: MyPlan; residentId: string | null; residentName: string | null }) {
  const kind = passKind(plan);
  const going = plan.status === "confirmed" || plan.status === "rsvp";
  // Activities carry no booking reference (free joins never do); their code is the check-in code.
  const reference = going && plan.placeKind !== "game" ? plan.ref : null;
  const code = going && plan.placeKind === "game" && residentId ? gamePassCode(plan.ref, residentId) : reference;
  const time = plan.time ? passTime(plan.time, plan.durationKnown ? plan.durationMinutes : null) : null;
  const extra = (
    [
      [plan.placeKind === "game" ? (plan.circleName ? "Organiser" : "Host") : "Organiser", plan.organiser],
      ["Bring", plan.prep.bring],
      ["On arrival", plan.prep.arrival],
      ["Who welcomes newcomers", plan.prep.welcome],
    ] as [string, string | null][]
  ).filter((f): f is [string, string] => !!f[1] && !!f[1].trim());
  const meeting = plan.prep.meeting && plan.prep.meeting !== plan.location ? plan.prep.meeting : null;
  const note =
    plan.status === "pending_payment"
      ? "Your place is held while payment finishes. It isn't booked until it's paid."
      : plan.status === "pending_approval"
        ? "You've asked to join. It isn't a place until the host accepts."
        : meeting
          ? `Meeting point: ${meeting}`
          : null;
  const contact = plan.contact
    ? plan.contact.label.startsWith("Message the host")
      ? "Message the host"
      : plan.contact.label.startsWith("Message the organiser")
        ? "Message the organiser"
        : plan.contact.label
    : null;
  const day = plan.phase === "today" ? "Today" : passDate(plan.date);
  return (
    <BoardingPass
      kind={kind}
      tone={PASS_TONE[plan.status]}
      status={passStatus(plan)}
      title={plan.title}
      titleHref={plan.href}
      titleId="np-next-title"
      topRight={`HelloCircle${plan.circleName ? ` · ${plan.circleName}` : ""}`}
      columns={[
        { label: "Date", value: day, big: true },
        ...(time ? [{ label: "Time", value: time, big: true }] : []),
        ...(plan.location ? [{ label: "Where", value: plan.location }] : []),
        ...(going && residentName ? [{ label: "Admit", value: residentName }] : []),
      ]}
      extra={extra}
      note={note}
      reference={reference}
      code={code}
      codeActive={going}
      stubText={plan.phase === "today" ? "Check yourself in when you arrive" : "Your name is on the list"}
      emptyStub={{ title: "No pass yet", text: "It appears here once you're in" }}
      stubLine={`${day}${plan.time ? ` · ${plan.time}` : ""}`}
    >
      <Link className="mlx-btn np-btn-md" to={plan.href}>
        {PRIMARY[plan.status]}
      </Link>
      {plan.phase === "today" && directions(plan) && (
        <a className="np-text-link" href={directions(plan)!} target="_blank" rel="noreferrer">
          Directions
        </a>
      )}
      {plan.contact && contact && (
        <Link className="np-text-link" to={plan.contact.href}>
          {contact}
        </Link>
      )}
    </BoardingPass>
  );
}

function goAgainLine(v: MyRecentVisit) {
  const g = v.goAgain;
  if (!g) return <span>No next date yet{v.followTarget ? " — follow to hear when there is" : ""}</span>;
  if (g.kind === "venue") {
    return (
      <Link className="np-again-link" to={g.href}>
        Book again
      </Link>
    );
  }
  const bits = [g.priceCents ? euro(g.priceCents) : g.priceCents === 0 ? "Free" : null, g.spotsLeft != null ? `${g.spotsLeft} ${g.spotsLeft === 1 ? "place" : "places"} left` : null].filter(Boolean);
  return (
    <span>
      Go again:{" "}
      <Link className="np-again-link" to={g.href}>
        {g.date ? `${short(g.date)}${g.time ? `, ${g.time}` : ""}` : "next date"}
      </Link>
      {bits.length ? ` · ${bits.join(" · ")}` : ""}
    </span>
  );
}


function reviewHref(v: MyRecentVisit) {
  // Venue pages may not be public yet: the booking page carries the review link either way.
  return v.placeKind === "booking" || !v.listingHref ? v.href : `${v.listingHref}#reviews`;
}

export function NextPlanSection({ onSeeAll }: { onSeeAll?: () => void }) {
  const { resident } = useGuest();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchMyPlans>> | null>(null);
  const [failed, setFailed] = useState(false);
  const [allRecent, setAllRecent] = useState(false);
  const load = () => {
    setFailed(false);
    fetchMyPlans()
      .then(setData)
      .catch(() => setFailed(true));
  };
  useEffect(load, [resident?.id]);

  if (failed) {
    return (
      <section className="mlx-section" aria-labelledby="np-title">
        <h2 className="mlx-label" id="np-title">Your next plan</h2>
        <LoadErrorState title="We couldn't load your plans." detail="Nothing has changed — try again." onRetry={load} />
      </section>
    );
  }
  if (!data) return <Skeleton height={160} />;
  const { next, upcoming, recent } = data;
  const notBooked = upcoming.filter((p) => p.status !== "confirmed" && p.status !== "rsvp");
  if (!next && !upcoming.length && !recent.length) return null; // the page's own empty state covers this
  const recentShown = allRecent ? recent : recent.slice(0, RECENT_SHOWN);

  return (
    <>
      <section className="mlx-section np" aria-labelledby="np-title">
        <div className="np-head">
          <h2 className="mlx-label" id="np-title">Your next plan</h2>
          {onSeeAll && upcoming.length > 0 && (
            <button type="button" className="np-all" onClick={onSeeAll}>
              All plans ({upcoming.length + (next ? 1 : 0)}) <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        {next ? (
          // The pass you show up with, and what comes after it beside it.
          // The horizontal pass takes the column; what comes after it goes underneath.
          <div className="np-passrow is-wide">
            <div className="np-pass">
              <NextPass plan={next} residentId={resident?.id ?? null} residentName={resident?.name ?? null} />
            </div>
            {upcoming.length > 0 && (
              <div className="np-after">
                <h3 className="np-subhead">After that</h3>
                <CompactRows>
                  {upcoming.slice(0, 3).map((p) => (
                    <CompactRow
                      key={p.key}
                      href={p.href}
                      onOpen={() => navigate(p.href)}
                      image={p.imageUrl}
                      fallbackIcon={activityIcon(p.activityLabel, 26)}
                      date={p.date}
                      time={p.time}
                      // Waitlist / interest / pending say so in the label; nothing reads as booked unless it is.
                      label={{ rest: p.statusLabel, tone: p.status === "confirmed" || p.status === "rsvp" ? "mine" : p.status === "cancelled" ? "hot" : "wait" }}
                      title={p.title}
                      meta={[p.circleName, p.location].filter(Boolean).join(" · ") || undefined}
                    />
                  ))}
                </CompactRows>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="tr-note">Nothing booked yet — the plans below aren't places until they're confirmed.</p>
            {notBooked.length > 0 && (
              <div className="np-more">
                <CompactRows>
                  {notBooked.slice(0, 4).map((p) => (
                    <CompactRow
                      key={p.key}
                      href={p.href}
                      onOpen={() => navigate(p.href)}
                      image={p.imageUrl}
                      fallbackIcon={activityIcon(p.activityLabel, 26)}
                      date={p.date}
                      time={p.time}
                      label={{ rest: p.statusLabel, tone: p.status === "cancelled" ? "hot" : "wait" }}
                      title={p.title}
                      meta={[p.circleName, p.location].filter(Boolean).join(" · ") || undefined}
                    />
                  ))}
                </CompactRows>
              </div>
            )}
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section className="mlx-section np" aria-labelledby="np-recent">
          <div className="np-head">
            <h2 className="mlx-label" id="np-recent">Recent visits</h2>
          </div>
          <CompactRows>
            {recentShown.map((v) => (
              <CompactRow
                key={v.key}
                href={v.href}
                onOpen={() => navigate(v.href)}
                image={v.imageUrl}
                fallbackIcon={activityIcon(v.activityLabel, 26)}
                date={v.date}
                time={v.time}
                label={VISIT_LABEL[v.visit]}
                title={<span title={VISIT[v.visit]}>{v.title}</span>}
                meta={<span className="np-row-meta">{goAgainLine(v)}</span>}
                action={
                  <span className="np-row-actions">
                    {v.visit === "review_available" && (
                      <Link className="mlx-btn np-btn-sm" to={reviewHref(v)} aria-label={`Write a review of ${v.title}`}>
                        Write a review
                      </Link>
                    )}
                    {v.visit === "not_confirmed" && (
                      <Link className="mlx-btn mlx-btn--ghost np-btn-sm" to={v.href} aria-label={`Ask the organiser to confirm you attended ${v.title}`}>
                        Ask to confirm
                      </Link>
                    )}
                    {resident && v.followTarget && <FollowButton quiet followedType={v.followTarget.type} followedId={v.followTarget.id} initialFollowing={!!v.following} />}
                  </span>
                }
              />
            ))}
          </CompactRows>
          {recent.length > RECENT_SHOWN && (
            <button type="button" className="np-text-link np-show" aria-expanded={allRecent} onClick={() => setAllRecent((x) => !x)}>
              {allRecent ? "Show fewer" : `Show all ${recent.length} recent visits`}
            </button>
          )}
        </section>
      )}
    </>
  );
}
