import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, CalendarDays, Heart, MapPin, MessagesSquare, Users } from "lucide-react";
import { trackEvent } from "../../analytics";
import { dateLabel, euro } from "../../euro";
import type { Circle, CircleVisitorView } from "../../types";
import { ShareButton } from "../ShareButton";
import { Avatar } from "../ui";
import { activityIcon, circlePlanLabel, FeaturedPhoto } from "./CircleHomeParts";
import { CompactRow, CompactRows } from "../CompactRow";

// Circle Experience 4.0 (owner, 2026-10-24, docs/circle-visitor-experience-v4/):
// the Circle page for someone who isn't a member: discover, trust,
// explore, join. Built only from what a visitor may see (GET /:id/visitor):
// never member names, chat, memories, wishes or availability. Joining itself
// stays in CircleJoinCard (passed in as `joinPanel`), so every join rule,
// question and state is the existing one.

const JOIN_MODE: Record<Circle["joinMode"], string> = { open: "Open to everyone", approval: "Ask to join, an organiser approves", invite: "Invite only" };

function minutes(m: number) {
  return m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`;
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="cv-head">
      <h2>{title}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}

function dayBits(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });
  return { wd: f({ weekday: "short" }).toUpperCase(), dd: f({ day: "numeric" }), mon: f({ month: "short" }).toUpperCase() };
}

function placesLeft(n: number) {
  return n <= 0 ? "Full" : `${n} ${n === 1 ? "place" : "places"} left`;
}

/**
 * Visitor Overview (redesign, owner 2026-10-24): three sections in the
 * joined page's own style — what's coming up (the members' "Next up" card),
 * what the Circle is like, and the closing "Ready to join" band — then more
 * nearby. The organiser, who can join and joining itself live in the rail.
 */
export function VisitorOverview({
  circle,
  view,
  cover,
  isNew,
  onJoin,
  joinLabel,
  canJoin,
  more,
}: {
  circle: Circle;
  view: CircleVisitorView;
  cover: string | null;
  isNew: boolean;
  onJoin: () => void;
  joinLabel: string;
  canJoin: boolean;
  more: ReactNode;
}) {
  const navigate = useNavigate();
  const highlightsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = highlightsRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        trackEvent("circle_highlights_viewed", { circleId: circle.id });
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [circle.id]);

  const openActivity = (id: string) => {
    trackEvent("circle_activity_preview_opened", { circleId: circle.id, activityId: id });
    navigate(`/games/${id}`);
  };

  // Photos: only public pictures — the Circle's own past and upcoming
  // activity photos, the open cover, the venue's photos. Never memories.
  // Each tile says what it is on the photo (C · Title on the photo, owner
  // 2026-10-27): the activity, and when, where there is one.
  const tiles: { src: string; caption: string; line?: string }[] = [];
  const seen = new Set<string>();
  const push = (src: string | null | undefined, caption: string, line?: string) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    tiles.push({ src, caption, line });
  };
  for (const p of view.past) push(p.imageUrl, p.activityLabel, `${dateLabel(p.date)} · ${p.attended} went`);
  push(cover, circle.name);
  view.venuePhotos.forEach((v, i) => push(v, i === 0 ? "Where the Circle meets" : "At the venue"));
  for (const u of view.upcoming) push(u.imageUrl, u.activityLabel, `Coming up · ${dateLabel(u.date)}`);
  const photos = tiles.slice(0, 3);

  const durations = view.upcoming.map((u) => u.durationMinutes).filter((m): m is number => !!m);
  const prices = view.upcoming.map((u) => u.priceCents ?? 0);
  const chips = [
    view.pattern ? `Usually ${view.pattern.weekday} ${view.pattern.partOfDay}s` : null,
    durations.length ? `About ${minutes(durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)])}` : null,
    prices.length ? (prices.every((p) => !p) ? "Activities are free" : `From ${euro(Math.min(...prices.filter((p) => p > 0)) / 100)} per activity`) : null,
    view.activitiesTogether > 0 ? `${view.activitiesTogether} ${view.activitiesTogether === 1 ? "activity" : "activities"} together recently` : null,
    view.community?.livePlans ? `Members are planning ${view.community.livePlans} ${view.community.livePlans === 1 ? "thing" : "things"}` : null,
    view.community?.openPolls ? `${view.community.openPolls} ${view.community.openPolls === 1 ? "poll" : "polls"} open` : null,
  ].filter((c): c is string => !!c);

  const [first, ...rest] = view.upcoming;
  const prose = view.about.whatWeDo || `${circle.activityLabel} in ${circle.area || circle.county || "your area"}.`;

  return (
    <div className="cv-body">
      <section className="cv-section" aria-labelledby="cv-come">
        <div className="cv-head">
          <h2 id="cv-come">Come along to something</h2>
          <p>Each activity is joined on its own page. Joining the Circle doesn't book you a place.</p>
        </div>
        {!first ? (
          <p className="cv-empty cv-empty--card">Nothing is scheduled right now. Members hear first when the next activity is announced.</p>
        ) : (
          <article className="nu-card">
            <div className="nu-featured">
              <FeaturedPhoto
                image={first.imageUrl || cover}
                activityLabel={first.activityLabel}
                kicker="Next up"
                title={first.activityLabel}
                line={[dateLabel(first.date), first.time, first.durationMinutes ? `about ${minutes(first.durationMinutes)}` : null].filter(Boolean).join(" · ")}
                chips={
                  first.soloFriendly || first.experienceRequired ? (
                    <>
                      {first.soloFriendly && <span className="ce-pill ce-pill--green">Come on your own</span>}
                      {first.experienceRequired && <span className="ce-pill">{first.experienceRequired}</span>}
                    </>
                  ) : null
                }
              />
              <div className="nu-info">
                <p className="nu-meta">{[first.place, first.priceCents ? euro(first.priceCents / 100) : "Free"].filter(Boolean).join(" · ")}</p>
                <p className="nu-meta nu-meta--strong">
                  <strong>{first.joined} going</strong> · {placesLeft(first.spotsLeft)}
                </p>
              </div>
              <div className="nu-actions">
                <button type="button" className="cv-btn cv-btn--outline" onClick={() => openActivity(first.id)}>
                  See activity
                </button>
              </div>
            </div>
            {rest.length > 0 && (
              <div className="nu-more">
                <p className="nu-more-title">Also coming up</p>
                <CompactRows>
                  {rest.slice(0, 3).map((u) => (
                    <CompactRow
                      key={u.id}
                      href={`/games/${u.id}`}
                      onOpen={() => openActivity(u.id)}
                      image={u.imageUrl || cover}
                      fallbackIcon={activityIcon(u.activityLabel, 26)}
                      date={u.date}
                      time={u.time}
                      label={circlePlanLabel(u)}
                      title={u.activityLabel}
                      meta={[u.place, u.priceCents ? euro(u.priceCents / 100) : "Free", placesLeft(u.spotsLeft)].filter(Boolean).join(" · ")}
                      action={
                        <button type="button" className="cp-link cp-link--strong" onClick={() => openActivity(u.id)}>
                          See activity
                        </button>
                      }
                    />
                  ))}
                </CompactRows>
              </div>
            )}
          </article>
        )}
      </section>

      <section className="cv-section" ref={highlightsRef} aria-labelledby="cv-like">
        <div className="cv-head">
          <h2 id="cv-like">{isNew ? "A new Circle is taking shape" : "What it's like"}</h2>
          {isNew && <p>It's just getting started, so there's no history to show yet.</p>}
        </div>
        <p className="cv-prose">{prose}</p>
        {chips.length > 0 && (
          <ul className="cv-chips">
            {chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        {photos.length > 0 && (
          <div className={`cv-photos cv-photos--${photos.length}`}>
            {photos.map((t) => (
              <figure key={t.src}>
                <img src={t.src} alt="" loading="lazy" />
                <figcaption>
                  <strong>{t.caption}</strong>
                  {t.line && <span>{t.line}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {canJoin && (
        <section className="cv-section cv-closing" aria-labelledby="cv-closing">
          <h2 id="cv-closing">Ready to join {circle.name}?</h2>
          <p>{circle.joinMode === "approval" ? "Send a request and an organiser will get back to you." : "Join free, then pick an activity when it suits you."}</p>
          <button type="button" className="cv-btn" onClick={onJoin}>
            {joinLabel}
          </button>
        </section>
      )}

      {more}
    </div>
  );
}

/**
 * The rail's join panel: a green header with the Circle's facts, the next
 * activity, then the existing join card (bare) so every join rule and state
 * stays the one in CircleJoinCard, and what joining gets you.
 */
export function VisitorJoinPanel({
  circle,
  view,
  faces,
  canJoin,
  children,
}: {
  circle: Circle;
  view: CircleVisitorView | null;
  faces: string[];
  canJoin: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const next = view?.upcoming[0];
  const mode = circle.joinMode === "open" ? "Open to everyone" : circle.joinMode === "approval" ? "Ask to join" : "Invite only";
  const stats = [`${circle.members.toLocaleString()} ${circle.members === 1 ? "member" : "members"}`, view && view.activitiesTogether > 0 ? `${view.activitiesTogether} ${view.activitiesTogether === 1 ? "activity" : "activities"} recently` : null].filter(Boolean).join(" · ");
  return (
    <section className="cv-join" aria-labelledby="cv-join-title">
      <div className="cv-join-head">
        <p className="cv-join-eyebrow">{mode} · Free to join</p>
        <h2 id="cv-join-title">{canJoin ? `Join ${circle.name}` : circle.name}</h2>
        <div className="cv-join-stats">
          {faces.length > 0 && (
            <span className="cv-join-faces" aria-hidden="true">
              {faces.slice(0, 3).map((n) => (
                <Avatar key={n} name={n} size={30} />
              ))}
            </span>
          )}
          <span>{stats}</span>
        </div>
      </div>
      <div className="cv-join-body">
        {next && (
          <button type="button" className="cv-join-next" onClick={() => navigate(`/games/${next.id}`)}>
            <span className="nu-date" aria-hidden="true">
              <span className="nu-date-wd">{dayBits(next.date).wd}</span>
              <span className="nu-date-dd">{dayBits(next.date).dd}</span>
            </span>
            <span className="cv-join-next-text">
              <span className="cv-join-next-label">Next activity</span>
              <strong>{next.activityLabel}</strong>
              <span>
                {dateLabel(next.date)}, {next.time} · {placesLeft(next.spotsLeft)}
              </span>
            </span>
          </button>
        )}
        {children}
        {canJoin && <p className="cv-join-note">{circle.joinMode === "approval" ? "Free. An organiser approves new members." : "Free, and you can leave any time."}</p>}
        {canJoin && (
          <ul className="cv-join-gets">
            <li>
              <BellRing size={17} aria-hidden="true" /> Hear about every activity first
            </li>
            <li>
              <MessagesSquare size={17} aria-hidden="true" /> Chat and plan with members
            </li>
            <li>
              <CalendarDays size={17} aria-hidden="true" /> Join each activity on its own page
            </li>
          </ul>
        )}
        <div className="cv-join-share">
          <ShareButton entityType="circle" entityId={circle.id} />
        </div>
      </div>
    </section>
  );
}

/** "Who you'll meet" in the rail: the organiser, who can join, coming alone. */
export function VisitorPeopleCard({ view }: { view: CircleVisitorView }) {
  const navigate = useNavigate();
  const { organiser } = view;
  if (!organiser && !view.about.whoCanJoin && !view.about.values && !view.soloWelcome) return null;
  return (
    <section className="ch-card cv-people" aria-labelledby="cv-people">
      <h3 id="cv-people">
        <Users size={17} aria-hidden="true" style={{ color: "var(--color-cta)" }} /> Who you'll meet
      </h3>
      {organiser && (
        <div className="cv-organiser">
          <Avatar name={organiser.name} size={46} />
          <div>
            <p className="cv-organiser-name">{organiser.name}</p>
            <p className="cv-muted">
              Organiser{organiser.verified ? " · Verified host" : ""}
            </p>
          </div>
        </div>
      )}
      {view.about.values && <p className="cv-people-quote">{view.about.values}</p>}
      {view.about.whoCanJoin && (
        <p className="cv-people-line">
          <strong>Who can join:</strong> {view.about.whoCanJoin}
        </p>
      )}
      {view.soloWelcome && (
        <p className="cv-people-solo">
          <Heart size={16} aria-hidden="true" />
          <span>
            <strong>Coming on your own?</strong> You won't be the only one. People often come on their own here.
          </span>
        </p>
      )}
      {organiser?.verified && organiser.residentId && (
        <button type="button" className="cp-link cp-link--strong" onClick={() => navigate(`/host/${organiser.residentId}`)}>
          View organiser profile
        </button>
      )}
    </section>
  );
}

/** Visitor "Activities" tab: every upcoming activity a visitor may see. */
export function VisitorActivities({ view, circleId }: { view: CircleVisitorView; circleId: string }) {
  const navigate = useNavigate();
  return (
    <section className="cv-section">
      <SectionHead title="Upcoming activities" sub="Each activity is joined on its own page. Joining the Circle doesn't book you a place." />
      {view.upcoming.length === 0 ? (
        <p className="cv-empty">Nothing is scheduled right now.</p>
      ) : (
        <ul className="cv-acts">
          {view.upcoming.map((u) => (
            <li key={u.id}>
              <div className="cv-act-img">{u.imageUrl ? <img src={u.imageUrl} alt="" loading="lazy" /> : <span>{activityIcon(u.activityLabel, 28)}</span>}</div>
              <div className="cv-act-main">
                <p className="cv-act-date">
                  {dateLabel(u.date)} · {u.time}
                </p>
                <p className="cv-act-title">{u.activityLabel}</p>
                <p className="cv-act-meta">{[u.place, u.priceCents ? euro(u.priceCents / 100) : "Free", u.spotsLeft <= 0 ? "Full" : `${u.spotsLeft} places left`].filter(Boolean).join(" · ")}</p>
              </div>
              <button
                type="button"
                className="cv-btn cv-btn--outline"
                onClick={() => {
                  trackEvent("circle_activity_preview_opened", { circleId, activityId: u.id });
                  navigate(`/games/${u.id}`);
                }}
              >
                See activity
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Visitor "About" tab: the organiser's own words and how joining works. */
export function VisitorAbout({ circle, view }: { circle: Circle; view: CircleVisitorView }) {
  const rows = [
    ["About", view.about.about],
    ["What we do", view.about.whatWeDo],
    ["Who can join", view.about.whoCanJoin],
    ["What we value", view.about.values],
  ].filter((r): r is [string, string] => !!r[1]);
  return (
    <section className="cv-section">
      <SectionHead title={`About ${circle.name}`} />
      <dl className="cv-about">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div>
          <dt>Membership</dt>
          <dd>{JOIN_MODE[circle.joinMode]}</dd>
        </div>
        {circle.joinMode === "approval" && (circle.joinQuestions?.length ?? 0) > 0 && (
          <div>
            <dt>The organiser asks</dt>
            <dd>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {circle.joinQuestions!.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
