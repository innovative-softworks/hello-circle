import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelCirclePlanIdea,
  closeCirclePoll,
  confirmCirclePlanIdea,
  createCirclePlanIdea,
  createCirclePoll,
  fetchCircle,
  fetchCircleActivity,
  fetchCircleMembership,
  fetchCirclePlanIdeas,
  fetchCirclePolls,
  fetchCircleRecentActivity,
  fetchCircleUpcoming,
  fetchCircles,
  fetchGame,
  fetchMyCircles,
  fetchMyReports,
  inviteToCircle,
  joinCircle,
  leaveCircle,
  setCircleStatus,
  submitReport,
  voteOnCirclePollOption,
} from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon, HeartIcon, PlusIcon, UsersIcon } from "../components/icons";
import { ShareButton } from "../components/ShareButton";
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
import { CirclePlanIdeaCard } from "../components/CirclePlanIdeaCard";
import { CircleStatsBar } from "../components/CircleStatsBar";
import { CircleUpcomingSummary } from "../components/CircleUpcomingSummary";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { useSavedState } from "../components/SaveButton";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { rehostHref } from "../rehost";
import { getCircleCoverUrl } from "../media";
import { colors, fonts, radius } from "../theme";
import type { Circle, CircleActivityStats, CirclePlanIdea, CirclePlanPreview, CirclePoll, CircleRecentActivity } from "../types";

const hairline = `1px solid ${colors.border}`;

// Circle Experience Polish — Changeset 4. Same reason set / dialog pattern
// as the review-reporting flow (Resident Experience Polish, Changeset 7) —
// reusing the existing generic reports backend, not a new one.
const CIRCLE_REPORT_REASONS = ["Spam or fake", "Inappropriate content", "Harassment or abuse", "Other"];

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

function PollCard({
  poll,
  isOrganiser,
  onVote,
  onClose,
  onCreateActivity,
}: {
  poll: CirclePoll;
  isOrganiser: boolean;
  onVote: (optionId: number) => void;
  onClose: () => void;
  // Circle Experience Polish — Changeset 3B. Undefined when there's no
  // winning option, the poll isn't closed, or the viewer isn't the
  // organiser — the button only renders when there's something real to do.
  onCreateActivity?: () => void;
}) {
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
      {onCreateActivity && (
        <div style={{ marginTop: 10 }}>
          <Button onClick={onCreateActivity}>Create activity from this</Button>
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
  const [requested, setRequested] = useState(false);
  const [polls, setPolls] = useState<CirclePoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Resident Experience Polish — Changeset 4. Circle was the one entity
  // type left out of the unified save system (SaveButton/useSavedState) —
  // this page previously called the raw localStorage helpers directly, so
  // a signed-in resident's saved Circle never synced to their account or
  // crossed devices. circle?.id can be empty during initial load; the hook
  // re-syncs once it's real, same as any other optional-id effect dependency.
  const [saved, toggleSaved] = useSavedState("circle", circle?.id ?? "");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollDates, setPollDates] = useState(["", "", ""]);
  const [pollPlanId, setPollPlanId] = useState("");
  const planningRef = useRef<HTMLDivElement>(null);

  // Phase 2 "Circles V2" — plan-ideas, the new explicit "what should this
  // Circle do next" object. Kept separate from the polls state above; the
  // two are related (a poll can optionally attach to a plan-idea) but not
  // the same list.
  const [planIdeas, setPlanIdeas] = useState<CirclePlanIdea[]>([]);
  const [planIdeaFormOpen, setPlanIdeaFormOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanNote, setNewPlanNote] = useState("");
  const [newPlanDate, setNewPlanDate] = useState("");
  const [newPlanTime, setNewPlanTime] = useState("");
  const [newPlanLocation, setNewPlanLocation] = useState("");
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);

  const [joinBusy, setJoinBusy] = useState(false);
  const [activityPeriod, setActivityPeriod] = useState<"week" | "month">("week");
  const [activityStats, setActivityStats] = useState<CircleActivityStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<CircleRecentActivity[]>([]);
  const [rehostBusyId, setRehostBusyId] = useState<string | null>(null);
  const [otherCircles, setOtherCircles] = useState<Circle[]>([]);
  // Circle Experience Polish — Changeset 4.
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(CIRCLE_REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [otherJoinedIds, setOtherJoinedIds] = useState<Set<string>>(new Set());
  const [otherBusyId, setOtherBusyId] = useState<string | null>(null);

  const isOrganiser = role === "organiser";

  const load = () => {
    if (!idOrSlug) return;
    setLoadError(false);
    fetchCircle(idOrSlug)
      .then(async (c) => {
        setCircle(c);
        // Circle Experience Polish — Changeset 1B. A restricted (non-member
        // of an approval/invite Circle) response already carries
        // requested/hasPendingInvite itself, and the server now 403s
        // upcoming/polls/plan-ideas for exactly this viewer anyway — so
        // there's nothing correct to fetch beyond the teaser itself.
        if (c.restricted) {
          setUpcoming([]);
          setIsMember(false);
          setRole(null);
          setRequested(!!c.requested);
          setPolls([]);
          setPlanIdeas([]);
          return;
        }
        const [up, membership, p, pi] = await Promise.all([
          fetchCircleUpcoming(c.id),
          resident ? fetchCircleMembership(c.id) : Promise.resolve({ member: false, role: null, requested: false }),
          fetchCirclePolls(c.id).catch(() => []),
          fetchCirclePlanIdeas(c.id).catch(() => []),
        ]);
        setUpcoming(up);
        setIsMember(membership.member);
        setRole(membership.role);
        setRequested(membership.requested);
        setPolls(p);
        setPlanIdeas(pi);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [idOrSlug, resident]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
    fetchCircleActivity(circle.id, activityPeriod).then(setActivityStats).catch(() => setActivityStats(null));
  }, [circle?.id, circle?.restricted, activityPeriod]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
    // Circle Experience Polish — Changeset 2C. Closes the "return to
    // circle" loop the audit flagged — GET /:id/recent-activity existed
    // server-side with zero client callers before this.
    fetchCircleRecentActivity(circle.id).then(setRecentActivity).catch(() => setRecentActivity([]));
  }, [circle?.id, circle?.restricted]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
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
  useEffect(() => {
    if (!circle || circle.restricted) return;
    // Circle Experience Polish — Changeset 4. Real duplicate check against
    // the existing reports backend (not just a session-local flag) — this
    // works for guests too, since reports are keyed by X-Client-Id.
    fetchMyReports()
      .then((rows) => setAlreadyReported(rows.some((r) => r.targetType === "circle" && r.targetId === circle.id)))
      .catch(() => {});
  }, [circle?.id, circle?.restricted]);

  const submitCircleReport = async () => {
    if (!circle) return;
    setReportSubmitting(true);
    try {
      const reason = reportDetail.trim() ? `${reportReason}: ${reportDetail.trim()}` : reportReason;
      await submitReport("circle", circle.id, reason);
      setAlreadyReported(true);
      setReportOpen(false);
      setReportDetail("");
    } catch {
      // Best-effort — leave the dialog open so the resident can retry.
    } finally {
      setReportSubmitting(false);
    }
  };

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
    await createCirclePoll(circle.id, { question: pollQuestion.trim(), options, planId: pollPlanId || undefined });
    setPollQuestion("");
    setPollDates(["", "", ""]);
    setPollPlanId("");
    setPollOpen(false);
    load();
  };
  const handleCreatePlanIdea = async () => {
    if (!circle || !newPlanTitle.trim()) return;
    await createCirclePlanIdea(circle.id, {
      title: newPlanTitle.trim(),
      note: newPlanNote.trim() || undefined,
      proposedDate: newPlanDate || undefined,
      proposedTime: newPlanTime || undefined,
      locationText: newPlanLocation.trim() || undefined,
    });
    setNewPlanTitle("");
    setNewPlanNote("");
    setNewPlanDate("");
    setNewPlanTime("");
    setNewPlanLocation("");
    setPlanIdeaFormOpen(false);
    load();
  };
  const handleConfirmPlanIdea = async (planId: string) => {
    if (!circle) return;
    setPlanBusyId(planId);
    try {
      await confirmCirclePlanIdea(circle.id, planId);
      load();
    } finally {
      setPlanBusyId(null);
    }
  };
  const handleCancelPlanIdea = async (planId: string) => {
    if (!circle) return;
    setPlanBusyId(planId);
    try {
      await cancelCirclePlanIdea(circle.id, planId);
      load();
    } finally {
      setPlanBusyId(null);
    }
  };

  // Circle Experience Polish — Changeset 3B. Routes through the existing
  // Plan Idea → Game conversion architecture rather than a second
  // Circle→Game creation path: a poll already attached to a plan-idea just
  // gets that plan confirmed (if it wasn't already); a standalone poll gets
  // a brand-new plan-idea created from its winning option and immediately
  // confirmed (the organiser closing the poll with a clear winner already
  // is the decision — nothing here auto-publishes an activity, the
  // organiser still reviews/edits on the create-activity screen next).
  const handleCreateActivityFromPoll = async (poll: CirclePoll) => {
    if (!circle) return;
    const maxVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
    const winner = poll.options.find((o) => o.voteCount === maxVotes && maxVotes > 0);
    if (!winner) return;

    let planId = poll.planId;
    if (planId) {
      const linkedPlan = planIdeas.find((p) => p.id === planId);
      if (linkedPlan?.status === "idea") await confirmCirclePlanIdea(circle.id, planId);
    } else {
      const created = await createCirclePlanIdea(circle.id, {
        title: poll.question,
        proposedDate: winner.date,
        proposedTime: winner.time || undefined,
      });
      await confirmCirclePlanIdea(circle.id, created.id);
      planId = created.id;
    }

    navigate(
      `/games/host?activity=${encodeURIComponent(poll.question)}&circleId=${circle.id}&planId=${planId}` +
        (winner.date ? `&date=${winner.date}` : "") +
        (winner.time ? `&time=${winner.time}` : "")
    );
  };

  // Circle Experience Polish — Changeset 3C. Reuses the existing rehost
  // helper (already used by GameDetail's own "Do it again" and
  // HostActivitiesTab's Duplicate/Host again) rather than a new mechanism —
  // the only difference is passing circleId so the new activity stays
  // linked to this Circle. planId is never carried (a fresh activity, not
  // a plan conversion). A CircleRecentActivity row only has id/date/
  // attended, not the full Game shape buildRehostParams needs, hence the
  // fetch before navigating.
  const handleDoItAgain = async (gameId: string) => {
    if (!circle) return;
    setRehostBusyId(gameId);
    try {
      const game = await fetchGame(gameId);
      navigate(rehostHref(game, { circleId: circle.id }));
    } finally {
      setRehostBusyId(null);
    }
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
      // A pending request (approval-mode Circle) isn't membership yet —
      // this preview row only has a binary joined/not-joined toggle, so a
      // request in flight is left showing as "not joined" rather than
      // claiming membership that hasn't been granted.
      const result = await joinCircle(other.id);
      if (!result.requested) setOtherJoinedIds((s) => new Set(s).add(other.id));
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
  const joinState: JoinState = closed
    ? "closed"
    : isOrganiser
    ? "organiser"
    : !resident
    ? "signed-out"
    : isMember
    ? "member"
    : circle.hasPendingInvite
    ? "invited"
    : requested
    ? "requested"
    : circle.joinMode === "invite"
    ? "invite-only"
    : "available";
  // Circle Experience Polish — Changeset 2A. "Active this week" is a claim
  // about this Circle specifically — only a real, circle_id-owned nextPlan
  // earns it; a 'nearby' fuzzy match doesn't, since that's someone else's
  // unrelated activity that merely shares this Circle's activity label.
  const activeThisWeek = circle.nextPlan?.source === "circle" && (() => {
    const days = (new Date(`${circle.nextPlan!.date}T00:00:00`).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 7;
  })();

  // Circle Experience Polish — Changeset 1B. A non-member's view of an
  // 'approval'/'invite' Circle — deliberately a separate, minimal layout
  // rather than feeding a partially-populated circle into the full page's
  // component tree (CircleHero/CircleStatsBar/CircleAboutCard/etc all
  // expect real member-only content like whatWeDo/nextPlan/activePlan,
  // which the server correctly leaves null on a restricted response).
  if (circle.restricted) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ padding: "22px 0 20px" }}>
          <BackLink onClick={() => navigate("/circles")} marginBottom={0}>Back to Circles</BackLink>
        </div>
        {circle.hasImage && (
          <div style={{ borderRadius: radius.card, overflow: "hidden", marginBottom: 20, aspectRatio: "16/7", background: colors.panel }}>
            {/* Non-member view of a restricted Circle — imageUrl is
                deliberately always null here (see toCircleTeaserJson()),
                so this always goes through the protected endpoint rather
                than a permanent public URL. */}
            <img src={getCircleCoverUrl(circle) ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px,3.4vw,32px)", margin: "0 0 6px", letterSpacing: "-.01em" }}>{circle.name}</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: colors.mutedLight }}>
          {circle.activityLabel}
          {circle.area ? ` · ${circle.area}` : ""}
          {circle.joinMode === "approval" && circle.county ? `, ${circle.county}` : ""}
        </p>
        {circle.about && <p style={{ fontSize: 15, lineHeight: 1.6, color: "#3B423C", marginBottom: 28 }}>{circle.about}</p>}
        <div style={{ maxWidth: 380 }}>
          <CircleJoinCard
            circle={circle}
            state={joinState}
            busy={joinBusy}
            onJoin={handleJoinCircle}
            onLeave={handleLeaveCircle}
            onMessage={() => {}}
            onCreatePlan={() => {}}
            onInvite={handleInvite}
            inviteError={inviteError}
            onRequestClose={() => {}}
          />
        </div>
      </section>
    );
  }

  const featuredPlans = upcoming.slice(0, 4);
  const highlightPlans = upcoming.length > 4 ? upcoming.slice(4) : upcoming;
  // Circle Experience Polish — Changeset 2A — see the "From this Circle"/
  // "You might also like" split in the Upcoming plans section below.
  const realPlans = upcoming.filter((p) => p.source === "circle");
  const nearbyPlans = upcoming.filter((p) => p.source === "nearby");
  const featuredRealPlans = realPlans.slice(0, 4);
  const featuredNearbyPlans = nearbyPlans.slice(0, Math.max(0, 4 - featuredRealPlans.length));
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
            <ShareButton entityType="circle" entityId={circle.id} render={(onClick) => <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}>Share</button>} />
            <button onClick={toggleSaved} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: saved ? colors.orange : colors.text, cursor: "pointer" }}>
              <HeartIcon size={14} filled={saved} /> {saved ? "Saved" : "Save"}
            </button>
            {alreadyReported ? (
              <span style={{ fontSize: 13, color: colors.mutedLight }}>Reported</span>
            ) : (
              <button onClick={() => setReportOpen(true)} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.mutedLight, cursor: "pointer" }}>
                Report
              </button>
            )}
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
              {/* Circle Experience Polish — Changeset 2A. Real
                  games.circle_id-owned plans get their own "From this
                  Circle" heading; platform-wide activity-label matches are
                  a visually separate, clearly-labelled "You might also
                  like" — never merged into one undifferentiated list. */}
              {featuredRealPlans.length > 0 ? (
                <>
                  <SectionHeader title="From this Circle" action={{ label: "See all", onClick: () => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`) }} />
                  <div
                    className="grid-responsive-3"
                    style={{
                      display: "grid",
                      gridTemplateColumns: featuredRealPlans.length < 4
                        ? `repeat(${featuredRealPlans.length},minmax(0,1fr)) minmax(200px,${4 - featuredRealPlans.length}fr)`
                        : "repeat(4,1fr)",
                      gap: 16,
                    }}
                  >
                    {featuredRealPlans.map((plan) => (
                      <CirclePlanCard key={plan.id} plan={plan} />
                    ))}
                    {featuredRealPlans.length < 4 && <CircleUpcomingSummary circle={circle} plans={upcoming} />}
                  </div>
                  {featuredNearbyPlans.length > 0 && (
                    <div style={{ marginTop: 28 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: colors.mutedLight, marginBottom: 12 }}>You might also like</div>
                      <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: `repeat(${featuredNearbyPlans.length},minmax(0,1fr))`, gap: 16 }}>
                        {featuredNearbyPlans.map((plan) => (
                          <CirclePlanCard key={plan.id} plan={plan} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : nearbyPlans.length > 0 ? (
                <>
                  <SectionHeader title="You might also like" action={{ label: "See all", onClick: () => navigate(`/games?activity=${encodeURIComponent(circle.activityLabel)}`) }} />
                  <p style={{ margin: "-10px 0 16px", fontSize: 13, color: colors.mutedLight }}>Similar activity happening nearby — not organised through this Circle.</p>
                  <div
                    className="grid-responsive-3"
                    style={{
                      display: "grid",
                      gridTemplateColumns: nearbyPlans.slice(0, 4).length < 4
                        ? `repeat(${nearbyPlans.slice(0, 4).length},minmax(0,1fr)) minmax(200px,${4 - nearbyPlans.slice(0, 4).length}fr)`
                        : "repeat(4,1fr)",
                      gap: 16,
                    }}
                  >
                    {nearbyPlans.slice(0, 4).map((plan) => (
                      <CirclePlanCard key={plan.id} plan={plan} />
                    ))}
                    {nearbyPlans.slice(0, 4).length < 4 && <CircleUpcomingSummary circle={circle} plans={upcoming} />}
                  </div>
                </>
              ) : (
                <>
                  <SectionHeader title="Upcoming plans" />
                  <EmptyState
                    icon={<CalendarIcon size={20} />}
                    title={isOrganiser ? "Your Circle is ready." : "Nothing planned yet."}
                    subtitle={isOrganiser ? "Create the first plan and give people something to join." : "Join the Circle and we'll let you know when the next activity is announced."}
                    action={isOrganiser ? <Button onClick={() => navigate(`/games/host?activity=${encodeURIComponent(circle.activityLabel)}&circleId=${circle.id}`)}><PlusIcon size={14} /> Create first plan</Button> : joinState === "available" ? <Button onClick={handleJoinCircle} disabled={joinBusy}>{joinBusy ? "…" : "Join Circle"}</Button> : undefined}
                  />
                </>
              )}
            </Section>

            {/* Circle Experience Polish — Changeset 2C — "Recently
                together" closes the loop back from a completed activity to
                this Circle; only shown once there's something real (and
                confirmed-attended) to report. */}
            {recentActivity.length > 0 && (
              <Section>
                <SectionHeader title="Recently together" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {recentActivity.map((r) => (
                    <Card key={r.id} style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.activityLabel}</div>
                        <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                          {r.attended} attended · Completed {dateLabel(r.date)}
                        </div>
                      </div>
                      {isOrganiser ? (
                        <button
                          onClick={() => handleDoItAgain(r.id)}
                          disabled={rehostBusyId === r.id}
                          style={{ flex: "none", background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}
                        >
                          {rehostBusyId === r.id ? "…" : "Do it again →"}
                        </button>
                      ) : (
                        resident &&
                        isMember && (
                          <button
                            onClick={() => {
                              scrollToPlanning();
                              setPlanIdeaFormOpen(true);
                            }}
                            style={{ flex: "none", background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer" }}
                          >
                            Plan the next one →
                          </button>
                        )
                      )}
                    </Card>
                  ))}
                </div>
              </Section>
            )}

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
                    {!planIdeaFormOpen && (
                      <Button variant="ghost" onClick={() => setPlanIdeaFormOpen(true)}>
                        <PlusIcon size={14} /> Suggest a plan
                      </Button>
                    )}
                  </div>
                  {planIdeaFormOpen && (
                    <Card style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>What should we do?</label>
                      <input
                        value={newPlanTitle}
                        onChange={(e) => setNewPlanTitle(e.target.value)}
                        placeholder="e.g. Coastal walk"
                        style={{ ...inputStyle, marginBottom: 10 }}
                        autoFocus
                      />
                      <label style={labelStyle}>Tell the circle more (optional)</label>
                      <textarea
                        value={newPlanNote}
                        onChange={(e) => setNewPlanNote(e.target.value)}
                        placeholder="We could meet at the station and walk to the harbour."
                        style={{ ...inputStyle, minHeight: 60, marginBottom: 10, resize: "vertical" }}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={labelStyle}>When? (optional)</label>
                          <input type="date" value={newPlanDate} onChange={(e) => setNewPlanDate(e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>Time (optional)</label>
                          <input type="time" value={newPlanTime} onChange={(e) => setNewPlanTime(e.target.value)} style={inputStyle} />
                        </div>
                      </div>
                      <label style={labelStyle}>Where? (optional)</label>
                      <input
                        value={newPlanLocation}
                        onChange={(e) => setNewPlanLocation(e.target.value)}
                        placeholder="e.g. Bray Station"
                        style={{ ...inputStyle, marginBottom: 10 }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button onClick={handleCreatePlanIdea} disabled={!newPlanTitle.trim()}>Suggest to Circle</Button>
                        <Button variant="ghost" onClick={() => setPlanIdeaFormOpen(false)}>Cancel</Button>
                      </div>
                    </Card>
                  )}
                  {planIdeas.length === 0 && !planIdeaFormOpen ? (
                    <EmptyState icon={<CalendarIcon size={18} />} title="Nothing being planned yet" subtitle="Suggest something and see what the Circle thinks." />
                  ) : (
                    planIdeas.map((p) => (
                      <CirclePlanIdeaCard
                        key={p.id}
                        plan={p}
                        isOrganiser={isOrganiser}
                        isCreator={p.createdByResidentId === resident.id}
                        onConfirm={() => handleConfirmPlanIdea(p.id)}
                        onCancel={() => handleCancelPlanIdea(p.id)}
                        busy={planBusyId === p.id}
                      />
                    ))
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 12px" }}>
                    <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: 0, letterSpacing: "-.01em" }}>Polls</h2>
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
                      {planIdeas.length > 0 && (
                        <>
                          <label style={labelStyle}>Attach to a plan (optional)</label>
                          <select value={pollPlanId} onChange={(e) => setPollPlanId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
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
                    <EmptyState icon={<CalendarIcon size={18} />} title="No polls yet" subtitle="Propose a few dates and let the circle vote on what works." />
                  ) : (
                    polls.map((p) => {
                      const maxVotes = Math.max(0, ...p.options.map((o) => o.voteCount));
                      const hasWinner = p.status === "closed" && maxVotes > 0;
                      const linkedPlan = p.planId ? planIdeas.find((pl) => pl.id === p.planId) : undefined;
                      const alreadyConverted = linkedPlan?.status === "activity_created" || linkedPlan?.status === "cancelled";
                      const canCreateActivity = isOrganiser && hasWinner && !alreadyConverted;
                      return (
                        <PollCard
                          key={p.id}
                          poll={p}
                          isOrganiser={isOrganiser}
                          onVote={(optionId) => voteOnCirclePollOption(circle.id, p.id, optionId).then(load)}
                          onClose={() => closeCirclePoll(circle.id, p.id).then(load)}
                          onCreateActivity={canCreateActivity ? () => handleCreateActivityFromPoll(p) : undefined}
                        />
                      );
                    })
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
              // Phase 2 "Circles V2" — this is now the community-facing
              // "propose a plan" flow (scrolls to Planning and opens the
              // lightweight suggest-a-plan form) rather than jumping
              // straight to full Game creation. ManageCircle.tsx's own
              // "Create a plan" button is intentionally left pointing
              // directly at /games/host — that's the organiser's separate
              // operational tool (brief §56).
              onCreatePlan={() => {
                scrollToPlanning();
                setPlanIdeaFormOpen(true);
              }}
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

        <ConfirmDialog
          open={reportOpen}
          title="Report this Circle"
          message="Let us know what's wrong — a moderator will take a look."
          confirmLabel="Submit report"
          tone="neutral"
          busy={reportSubmitting}
          onConfirm={submitCircleReport}
          onCancel={() => setReportOpen(false)}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {CIRCLE_REPORT_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => setReportReason(reason)}
                style={{
                  border: `1px solid ${reason === reportReason ? colors.text : colors.border}`,
                  background: reason === reportReason ? colors.text : "transparent",
                  color: reason === reportReason ? colors.surface : colors.muted,
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Anything else the moderator should know? (optional)"
            value={reportDetail}
            onChange={(e) => setReportDetail(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </ConfirmDialog>

        {/* Discover more — reuses the same CircleDiscoveryCard as the Circles list page, real other Circles only. */}
        {otherCircles.length > 0 && (
          <Section>
            <SectionHeader title="More happening near you" />
            <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
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
              <IntentCaptureForm activityLabel={circle.activityLabel || "this"} county={circle.county} startHref="/circles/start" startLabel="Start a Circle →" />
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
      {(joinState === "available" || joinState === "signed-out" || joinState === "member" || joinState === "requested" || joinState === "invite-only") && (
        <div className="mobile-join-bar">
          {joinState === "member" ? (
            <>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, fontFamily: fonts.display }}>
                  {circle.nextPlan ? `${circle.nextPlan.source === "circle" ? "Next" : "Similar nearby"}: ${circle.activityLabel}` : circle.name}
                </div>
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
                    : joinState === "requested"
                    ? handleLeaveCircle
                    : handleJoinCircle
                }
                disabled={joinBusy || joinState === "invite-only"}
              >
                {joinBusy
                  ? "…"
                  : joinState === "signed-out"
                  ? "Sign in to join"
                  : joinState === "requested"
                  ? "Withdraw request"
                  : joinState === "invite-only"
                  ? "Invite only"
                  : circle.joinMode === "approval"
                  ? "Request to join"
                  : "Join Circle"}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}
