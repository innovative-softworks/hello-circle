import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  closeCirclePoll,
  createCirclePoll,
  fetchCircle,
  fetchCircleActivity,
  fetchCircleMembership,
  fetchCirclePolls,
  fetchCircleUpcoming,
  fetchCircles,
  fetchMyCircles,
  inviteToCircle,
  joinCircle,
  leaveCircle,
  setCircleStatus,
  voteOnCirclePollOption,
} from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon, HeartIcon, PlusIcon, UsersIcon } from "../components/icons";
import { Button, Card, ConfirmDialog, EmptyState, inputStyle, labelStyle, PageSpinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { ChatPanel } from "../components/ChatPanel";
import { CircleAboutCard } from "../components/CircleAboutCard";
import { CircleActivityCard } from "../components/CircleActivityCard";
import { CircleCommunityGrid } from "../components/CircleCommunityGrid";
import { CircleContextualCta } from "../components/CircleContextualCta";
import { CircleDiscoveryCard } from "../components/CircleDiscoveryCard";
import { CircleHero } from "../components/CircleHero";
import { CircleHighlightsCard } from "../components/CircleHighlightsCard";
import { CircleJoinCard, type JoinState } from "../components/CircleJoinCard";
import { CircleMembersCard } from "../components/CircleMembersCard";
import { CircleMoments } from "../components/CircleMoments";
import { CirclePlanCard } from "../components/CirclePlanCard";
import { CircleStatsBar } from "../components/CircleStatsBar";
import { CircleUpcomingSummary } from "../components/CircleUpcomingSummary";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { Circle, CircleActivityStats, CirclePlanPreview, CirclePoll } from "../types";

const hairline = `1px solid ${colors.border}`;

function SectionHeader({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: 0 }}>{title}</h2>
      {action && (
        <button onClick={action.onClick} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", flex: "none" }}>
          {action.label} →
        </button>
      )}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section style={{ borderTop: hairline, padding: "36px 0" }}>{children}</section>;
}

function PollCard({ poll, isOrganiser, onVote, onClose }: { poll: CirclePoll; isOrganiser: boolean; onVote: (optionId: number) => void; onClose: () => void }) {
  const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{poll.question}</div>
        {poll.status === "open" ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Open</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Closed</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {poll.options.map((o) => {
          const isRecommended = poll.status === "closed" && o.voteCount === maxVotes && maxVotes > 0;
          return (
            <button
              key={o.id}
              onClick={() => poll.status === "open" && onVote(o.id)}
              disabled={poll.status !== "open"}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left",
                border: `1px solid ${o.votedByMe ? colors.green : colors.border}`,
                background: o.votedByMe ? colors.greenBg : colors.surface,
                borderRadius: radius.control, padding: "9px 12px", cursor: poll.status === "open" ? "pointer" : "default",
              }}
            >
              <span style={{ fontSize: 13.5 }}>
                {o.date}{o.time ? ` · ${o.time}` : ""} {isRecommended && <strong style={{ color: colors.greenText }}> · Recommended</strong>}
              </span>
              <span style={{ fontSize: 12, color: colors.mutedLight, fontWeight: 700 }}>{o.voteCount} vote{o.voteCount === 1 ? "" : "s"}</span>
            </button>
          );
        })}
      </div>
      {isOrganiser && poll.status === "open" && (
        <div style={{ marginTop: 10 }}>
          <Button variant="ghost" onClick={onClose}>Close poll</Button>
        </div>
      )}
    </Card>
  );
}

export function CircleDetail() {
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [circle, setCircle] = useState<Circle | null>(null);
  const [upcoming, setUpcoming] = useState<CirclePlanPreview[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [polls, setPolls] = useState<CirclePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollDates, setPollDates] = useState(["", "", ""]);
  const planningRef = useRef<HTMLDivElement>(null);

  const [joinBusy, setJoinBusy] = useState(false);
  const [activityPeriod, setActivityPeriod] = useState<"week" | "month">("week");
  const [activityStats, setActivityStats] = useState<CircleActivityStats | null>(null);
  const [otherCircles, setOtherCircles] = useState<Circle[]>([]);
  const [otherJoinedIds, setOtherJoinedIds] = useState<Set<string>>(new Set());
  const [otherBusyId, setOtherBusyId] = useState<string | null>(null);

  const isOrganiser = role === "organiser";

  const load = () => {
    if (!idOrSlug) return;
    setLoadError(false);
    fetchCircle(idOrSlug)
      .then(async (c) => {
        setCircle(c);
        const [up, membership, p] = await Promise.all([
          fetchCircleUpcoming(c.id),
          resident ? fetchCircleMembership(c.id) : Promise.resolve({ member: false, role: null }),
          fetchCirclePolls(c.id).catch(() => []),
        ]);
        setUpcoming(up);
        setIsMember(membership.member);
        setRole(membership.role);
        setPolls(p);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug, resident]);
  useEffect(() => {
    if (circle) setSaved(isFavorite("circle", circle.id));
  }, [circle?.id]);
  useEffect(() => {
    if (!circle) return;
    fetchCircleActivity(circle.id, activityPeriod).then(setActivityStats).catch(() => setActivityStats(null));
  }, [circle?.id, activityPeriod]);
  useEffect(() => {
    if (!circle) return;
    fetchCircles(circle.county ?? undefined)
      .then(async (rows) => {
        let others = rows.filter((c) => c.id !== circle.id);
        if (others.length < 3) {
          const all = await fetchCircles().catch(() => []);
          const seen = new Set(others.map((c) => c.id));
          for (const c of all) {
            if (c.id === circle.id || seen.has(c.id)) continue;
            others.push(c);
            seen.add(c.id);
            if (others.length >= 3) break;
          }
        }
        setOtherCircles(others.slice(0, 3));
      })
      .catch(() => setOtherCircles([]));
  }, [circle?.id, circle?.county]);
  useEffect(() => {
    if (resident) fetchMyCircles().then((rows) => setOtherJoinedIds(new Set(rows.map((c) => c.id)))).catch(() => {});
  }, [resident]);

  const handleCloseCircle = async () => {
    if (!circle) return;
    await setCircleStatus(circle.id, "closed");
    setConfirmingClose(false);
    load();
  };
  const handleInvite = async (residentId: string) => {
    if (!circle) return;
    setInviteError(null);
    try {
      await inviteToCircle(circle.id, residentId);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't send that invite");
    }
  };
  const handleCreatePoll = async () => {
    if (!circle || !pollQuestion.trim()) return;
    const options = pollDates.filter(Boolean).map((date) => ({ date }));
    if (options.length === 0) return;
    await createCirclePoll(circle.id, { question: pollQuestion.trim(), options });
    setPollQuestion("");
    setPollDates(["", "", ""]);
    setPollOpen(false);
    load();
  };
  const handleShare = async () => {
    if (!circle) return;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: circle.name, url });
        return;
      } catch {
        // cancelled — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    alert("Link copied to clipboard");
  };
  const handleJoinCircle = async () => {
    if (!circle) return;
    if (!resident) {
      return navigate(
        signInHref({ kind: "circle", title: circle.name, meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}` })
      );
    }
    setJoinBusy(true);
    try {
      await joinCircle(circle.id);
      load();
    } finally {
      setJoinBusy(false);
    }
  };
  const handleLeaveCircle = async () => {
    if (!circle) return;
    setJoinBusy(true);
    try {
      await leaveCircle(circle.id);
      load();
    } finally {
      setJoinBusy(false);
    }
  };
  const handleOtherJoin = async (other: Circle) => {
    if (!resident) {
      return navigate(
        signInHref({ kind: "circle", title: other.name, meta: `${other.members.toLocaleString()} member${other.members === 1 ? "" : "s"} · ${other.area}, ${other.county}` })
      );
    }
    setOtherBusyId(other.id);
    try {
      await joinCircle(other.id);
      setOtherJoinedIds((s) => new Set(s).add(other.id));
    } finally {
      setOtherBusyId(null);
    }
  };
  const handleOtherLeave = async (id: string) => {
    setOtherBusyId(id);
    try {
      await leaveCircle(id);
      setOtherJoinedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } finally {
      setOtherBusyId(null);
    }
  };

  if (loading) return <PageSpinner />;

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>We couldn't load this Circle.</h1>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate("/circles")}>Browse Circles</Button>
        </div>
      </section>
    );
  }

  if (!circle) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: "0 0 10px" }}>This Circle doesn't exist.</h1>
        <Button onClick={() => navigate("/circles")}>Find something similar</Button>
      </section>
    );
  }

  const closed = circle.status === "closed";
  const joinState: JoinState = closed ? "closed" : isOrganiser ? "organiser" : !resident ? "signed-out" : isMember ? "member" : "available";
  const activeThisWeek = !!circle.nextPlan && (() => {
    const days = (new Date(`${circle.nextPlan!.date}T00:00:00`).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 7;
  })();

  const featuredPlans = upcoming.slice(0, 4);
  const highlightPlans = upcoming.length > 4 ? upcoming.slice(4) : upcoming;
  const scrollToPlanning = () => planningRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    // Fragment, not one wrapping div: a fill-mode "both" animation on an
    // ancestor keeps establishing a CSS containing block for `transform`
    // even once finished, which would silently break the `position: fixed`
    // mobile join bar below (it'd anchor to this div's own box instead of
    // the viewport). Keeping the fade-in animation scoped to the animated
    // content only, as a sibling of the fixed bar, avoids that.
    <>
      <div style={{ animation: "fadeUp .3s ease both" }}>
      <div className="section-pad circle-detail-mobile-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "0 24px" }}>
        {/* Utility bar — back link + save/share, kept compact and non-primary per spec. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 0 20px", flexWrap: "wrap", gap: 12 }}>
          <BackLink onClick={() => navigate("/circles")} marginBottom={0}>Back to Circles</BackLink>
          <div style={{ display: "flex", gap: 18 }}>
            <button onClick={handleShare} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}>Share</button>
            <button onClick={() => setSaved(toggleFavorite("circle", circle.id))} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: saved ? colors.orange : colors.text, cursor: "pointer" }}>
              <HeartIcon size={14} filled={saved} /> {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* Main grid — content (~72%) + right rail (~28%), per the reference layout. */}
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "minmax(0,2.6fr) minmax(0,1fr)", gap: 32, alignItems: "start" }}>
          {/* MAIN COLUMN */}
          <div>
            <CircleHero circle={circle} activeThisWeek={activeThisWeek} />

            <div style={{ marginTop: 24 }}>
              <CircleStatsBar circle={circle} upcoming={upcoming} />
            </div>

            <Section>
              <SectionHeader title="Upcoming plans" action={{ label: "See all", onClick: () => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`) }} />
              {featuredPlans.length > 0 ? (
                <div
                  className="grid-responsive-3"
                  style={{
                    display: "grid",
                    gridTemplateColumns: featuredPlans.length < 4
                      ? `repeat(${featuredPlans.length},minmax(0,1fr)) minmax(200px,${4 - featuredPlans.length}fr)`
                      : "repeat(4,1fr)",
                    gap: 16,
                  }}
                >
                  {featuredPlans.map((plan) => (
                    <CirclePlanCard key={plan.id} plan={plan} />
                  ))}
                  {featuredPlans.length < 4 && <CircleUpcomingSummary circle={circle} plans={upcoming} />}
                </div>
              ) : (
                <EmptyState
                  icon={<CalendarIcon size={20} />}
                  title={isOrganiser ? "Your Circle is ready." : "Nothing planned yet."}
                  subtitle={isOrganiser ? "Create the first plan and give people something to join." : "Join the Circle and we'll let you know when the next activity is announced."}
                  action={isOrganiser ? <Button onClick={() => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`)}><PlusIcon size={14} /> Create first plan</Button> : joinState === "available" ? <Button onClick={handleJoinCircle} disabled={joinBusy}>{joinBusy ? "…" : "Join Circle"}</Button> : undefined}
                />
              )}
            </Section>

            <Section>
              <SectionHeader title="About our community" />
              <CircleCommunityGrid circle={circle} />
            </Section>

            {(joinState === "available" || joinState === "signed-out") && (
              <CircleContextualCta circle={circle} signedOut={joinState === "signed-out"} busy={joinBusy} onJoin={handleJoinCircle} />
            )}

            <Section>
              <SectionHeader title="Moments from this Circle" />
              <CircleMoments circle={circle} />
            </Section>

            {resident && isMember && (
              <Section>
                <div ref={planningRef}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: 0, letterSpacing: "-.01em" }}>Planning</h2>
                    {!pollOpen && (
                      <Button variant="ghost" onClick={() => setPollOpen(true)}>
                        <PlusIcon size={14} /> Propose a time
                      </Button>
                    )}
                  </div>
                  {pollOpen && (
                    <Card style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>What are you planning?</label>
                      <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="e.g. Next badminton session" style={{ ...inputStyle, marginBottom: 10 }} />
                      <label style={labelStyle}>Date options</label>
                      {pollDates.map((d, i) => (
                        <input
                          key={i}
                          type="date"
                          value={d}
                          onChange={(e) => setPollDates((ds) => ds.map((x, idx) => (idx === i ? e.target.value : x)))}
                          style={{ ...inputStyle, marginBottom: 6, maxWidth: 200 }}
                        />
                      ))}
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <Button onClick={handleCreatePoll} disabled={!pollQuestion.trim()}>Create poll</Button>
                        <Button variant="ghost" onClick={() => setPollOpen(false)}>Cancel</Button>
                      </div>
                    </Card>
                  )}
                  {polls.length === 0 && !pollOpen ? (
                    <EmptyState icon={<CalendarIcon size={18} />} title="Nothing being planned yet" subtitle="Propose a few dates and let the circle vote on what works." />
                  ) : (
                    polls.map((p) => (
                      <PollCard
                        key={p.id}
                        poll={p}
                        isOrganiser={isOrganiser}
                        onVote={(optionId) => voteOnCirclePollOption(circle.id, p.id, optionId).then(load)}
                        onClose={() => closeCirclePoll(circle.id, p.id).then(load)}
                      />
                    ))
                  )}

                  <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 19, margin: "24px 0 12px", letterSpacing: "-.01em" }}>Chat</h2>
                  <ChatPanel scopeType="circle" scopeId={circle.id} residentId={resident.id} />
                </div>
              </Section>
            )}
          </div>

          {/* RIGHT RAIL — sticky as a whole, so Join/About/Members/Highlights/Activity all track the viewport together while the main column scrolls. Bottom padding matches Section's own 36px rhythm so the rail doesn't end flush against the hairline below once it detaches from sticky. */}
          <div className="sticky-aside" style={{ position: "sticky", top: 90, display: "flex", flexDirection: "column", gap: 18, paddingBottom: 36 }}>
            <CircleJoinCard
              circle={circle}
              state={joinState}
              busy={joinBusy}
              onJoin={handleJoinCircle}
              onLeave={handleLeaveCircle}
              onMessage={scrollToPlanning}
              onCreatePlan={() => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`)}
              onInvite={handleInvite}
              inviteError={inviteError}
              onRequestClose={() => setConfirmingClose(true)}
            />
            <CircleAboutCard circle={circle} />
            <CircleMembersCard circle={circle} />
            <CircleHighlightsCard circle={circle} plans={highlightPlans} />
            <CircleActivityCard stats={activityStats} period={activityPeriod} onPeriodChange={setActivityPeriod} />
          </div>
        </div>

        <ConfirmDialog
          open={confirmingClose}
          title="Close this circle?"
          message="It drops off public browse but stays visible to members — this can't be undone from here."
          confirmLabel="Close circle"
          onConfirm={handleCloseCircle}
          onCancel={() => setConfirmingClose(false)}
        />

        {/* Discover more — reuses the same CircleDiscoveryCard as the Circles list page, real other Circles only. */}
        {otherCircles.length > 0 && (
          <Section>
            <SectionHeader title="More happening near you" />
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
              {otherCircles.map((c) => (
                <CircleDiscoveryCard
                  key={c.id}
                  circle={c}
                  joined={otherJoinedIds.has(c.id)}
                  busy={otherBusyId === c.id}
                  onJoin={() => handleOtherJoin(c)}
                  onLeave={() => handleOtherLeave(c.id)}
                />
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Full-width discovery CTA (reference §30) */}
      {!closed && (
        <section style={{ background: colors.greenBg, marginTop: otherCircles.length > 0 ? 0 : 40 }}>
          <div className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "40px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, maxWidth: 460 }}>
              <div style={{ flex: "none", width: 48, height: 48, borderRadius: "50%", background: colors.surface, display: "flex", alignItems: "center", justifyContent: "center", color: colors.greenText }}>
                <UsersIcon size={20} />
              </div>
              <div>
                <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px, 2.4vw, 24px)", margin: "0 0 6px", letterSpacing: "-.01em", color: colors.greenText }}>
                  Can't find what you're looking for?
                </h2>
                <p style={{ margin: 0, color: colors.muted, fontSize: 14 }}>Tell HelloCircle what kind of Circle you want to join and we'll help you find the right people.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Button variant="ghost" onClick={() => navigate("/circles")}>Explore Circles</Button>
              <IntentCaptureForm activityLabel={circle.activityLabel || "this"} county={circle.county} startHref="/circles#start-circle" startLabel="Start a Circle →" />
            </div>
          </div>
        </section>
      )}
      </div>

      {/* Mobile sticky join bar — deliberately a sibling of the animated
          wrapper above, not a descendant — see the comment at the top of
          this return. Mirrors the rail Join card's state machine so the two
          never disagree. Hidden for closed/organiser (the rail card already
          covers those, and "manage" doesn't fit a one-line bar). */}
      {(joinState === "available" || joinState === "signed-out" || joinState === "member") && (
        <div className="mobile-join-bar">
          {joinState === "member" ? (
            <>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, fontFamily: fonts.display }}>{circle.nextPlan ? `Next: ${circle.activityLabel}` : circle.name}</div>
                {circle.nextPlan && (
                  <div style={{ fontSize: 12, color: colors.mutedLight, display: "flex", alignItems: "center", gap: 4 }}>
                    <CalendarIcon size={11} /> {dateLabel(circle.nextPlan.date)} · {circle.nextPlan.time}
                  </div>
                )}
              </div>
              {circle.nextPlan && <Button style={{ flex: "none" }} onClick={() => navigate(`/games/${circle.nextPlan!.id}`)}>View plan</Button>}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{circle.name}</div>
              <Button
                style={{ flex: "none" }}
                onClick={
                  joinState === "signed-out"
                    ? () =>
                        navigate(
                          signInHref({ kind: "circle", title: circle.name, meta: `${circle.members.toLocaleString()} member${circle.members === 1 ? "" : "s"} · ${circle.area}, ${circle.county}` })
                        )
                    : handleJoinCircle
                }
                disabled={joinBusy}
              >
                {joinBusy ? "…" : joinState === "signed-out" ? "Sign in to join" : "Join Circle"}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}
