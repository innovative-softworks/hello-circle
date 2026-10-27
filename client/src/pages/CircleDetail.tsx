import { CategoryBreadcrumb } from "../components/categories/CategoryChips";
import { usePageTitle } from "../pageTitle";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { joinCircleConfirm } from "../confirmCopy";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  fetchCircle,
  fetchCircleMembers,
  fetchCircleMembership,
  fetchCirclePlanIdeas,
  fetchCircleFreeDays,
  fetchCircleVisitor,
  fetchCirclePulse,
  fetchCirclePolls,
  fetchCircleRecentActivity,
  fetchCircleUpcoming,
  fetchCirclesPage,
  fetchGame,
  fetchMyCircles,
  fetchMyReports,
  inviteToCircle,
  isNotFound,
  joinCircle,
  leaveCircle,
  setCircleStatus,
  submitReport,
  fetchChatInbox,
} from "../api";
import { signInHref } from "../authRedirect";
import { CalendarIcon, PlusIcon } from "../components/icons";
import { Check, CalendarDays, ChartColumn, History, Images, Info, Lightbulb, MapPin, MessageSquare, Plus, Settings2, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import {
  CircleActions,
  CircleBanner,
  CircleCommunity,
  CircleDetailsCard,
  CircleGuidelinesCard,
  CircleTabBar,
  CirclePulseRows,
  type CirclePulseRow,
  HomeSection,
  NextUpRow,
  QuickActionsCard,
  RailMembersCard,
  type CircleMember,
  type QuickAction,
} from "../components/circle/CircleHomeParts";
import { ShareButton } from "../components/ShareButton";
import { ActionMenu } from "../components/ActionMenu";
import { Button, ConfirmDialog, EmptyState, inputStyle, PageSpinner, Skeleton, TabPanel } from "../components/ui";
import { ChatModal } from "../components/ChatModal";
import { BackLink } from "../components/BackLink";
import { CircleContextualCta } from "../components/CircleContextualCta";
import { CircleDiscoveryCard } from "../components/CircleDiscoveryCard";
import { CircleJoinCard, type JoinState } from "../components/CircleJoinCard";
import { CircleMoments } from "../components/CircleMoments";
import { CirclePlanCard } from "../components/CirclePlanCard";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { useSavedState } from "../components/SaveButton";
import { CircleConversations, CircleMemberDirectory } from "../components/circle/CircleConversations";
import { CircleWelcomePanel, type CircleTabKey } from "../components/circle/CircleFirstTime";
import { CirclePlanTogether } from "../components/circle/CirclePlanTogether";
import { CircleNextUp } from "../components/circle/CircleNextUp";
import { VisitorAbout, VisitorActivities, VisitorJoinPanel, VisitorOverview, VisitorPeopleCard } from "../components/circle/CircleVisitor";
import { trackEvent } from "../analytics";
import { MostWantedCard, PlanInsightsCard, PlanStatsCard, RailPollCard, WhosFreeCard } from "../components/circle/CirclePlanInsights";
import { CircleMemoriesPanel } from "../components/circle/CircleMemoriesPanel";
import { CirclePollsPanel } from "../components/circle/CirclePollsPanel";
import type { SuggestPlanPrefill } from "../components/circle/CirclePulseSection";
import "../components/circle/circleExperience.css";
import { useCircleFeatures } from "../circleFeatures";
import { useGuest } from "../GuestContext";
import { dateLabel } from "../euro";
import { rehostHref } from "../rehost";
import { getCircleCoverUrl } from "../media";
import { useUrlTab } from "../useUrlTab";
import { CreateOrOrganise } from "../components/circle/CreateOrOrganise";
import { LinkListingDialog } from "../components/circle/LinkListingDialog";
import { CircleLinkedListings } from "../components/circle/CircleLinkedListings";
import { useToast } from "../components/Toast";
import { CirclePlannedTogether } from "../components/circle/CirclePlannedTogether";
import { colors, fonts, maxWidth, radius } from "../theme";
import type { Circle, CircleFreeDay, CirclePulseView, CircleVisitorView, CircleMembership, CirclePlanIdea, CirclePlanPreview, CirclePoll, CircleRecentActivity } from "../types";
import { CtaBand } from "../components/CtaBand";
import { CompactRows } from "../components/CompactRow";

// Circle Home — Circle Experience 2.0 (docs/circle-experience-2-audit.md).
// One page with tabs (?tab=, so links and Back work): Home, Activities,
// Discussions, Polls, Members, Memories. A visitor sees the public pitch
// (identity, what's next, about, members); a member sees a hub that leads
// with real participation — next up, Circle Pulse, Free Time Match, Make it
// happen, conversations, memories. Each new section only appears while its
// circles.* switch is on, and only tabs that do something are shown.
// Everything server-side is unchanged in meaning: membership, visibility
// and the plan → activity path are enforced by the API, not by this page.

const CIRCLE_REPORT_REASONS = ["Spam or fake", "Inappropriate content", "Harassment or abuse", "Other"];
const TAB_KEYS = ["home", "activities", "discussions", "polls", "members", "memories", "about"] as const;
const TAB_LABELS: Record<CircleTabKey, string> = { home: "Home", activities: "Activities", discussions: "Discussions", polls: "Polls", members: "Members", memories: "Memories", about: "About" };
const JOIN_MODE_LABEL: Record<Circle["joinMode"], string> = { open: "Open to join", approval: "Ask to join", invite: "Invite only" };

function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="ce-section-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {action && (
        <button onClick={action.onClick} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", flex: "none", minHeight: 32 }}>
          {action.label} →
        </button>
      )}
    </div>
  );
}

function Section({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <section className="ce-section" id={id} style={{ scrollMarginTop: 90 }}>
      {children}
    </section>
  );
}

const EMPTY_MEMBERSHIP: CircleMembership = { member: false, role: null, requested: false };

export function CircleDetail() {
  const { id: idOrSlug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resident } = useGuest();
  const features = useCircleFeatures();
  const confirm = useConfirm();
  const [circle, setCircle] = useState<Circle | null>(null);
  usePageTitle(circle?.name);
  const [upcoming, setUpcoming] = useState<CirclePlanPreview[]>([]);
  const [membership, setMembership] = useState<CircleMembership>(EMPTY_MEMBERSHIP);
  const [polls, setPolls] = useState<CirclePoll[]>([]);
  const [planIdeas, setPlanIdeas] = useState<CirclePlanIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Circle is part of the unified save system (Resident Experience Polish 4).
  const [saved, toggleSaved] = useSavedState("circle", circle?.id ?? "");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [joinBusy, setJoinBusy] = useState(false);
  const [memberList, setMemberList] = useState<CircleMember[]>([]);
  const [memberTotal, setMemberTotal] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<CircleRecentActivity[]>([]);
  const [rehostBusyId, setRehostBusyId] = useState<string | null>(null);
  const [otherCircles, setOtherCircles] = useState<Circle[]>([]);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(CIRCLE_REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [otherJoinedIds, setOtherJoinedIds] = useState<Set<string>>(new Set());
  const [otherBusyId, setOtherBusyId] = useState<string | null>(null);
  const [planPrefill, setPlanPrefill] = useState<SuggestPlanPrefill | null>(null);
  const [pulseView, setPulseView] = useState<CirclePulseView | null>(null);
  // Circle pulse (owner 2026-10-26): unread messages in this Circle's chat.
  const [chatUnread, setChatUnread] = useState(0);
  const [freeDays, setFreeDays] = useState<CircleFreeDay[] | null>(null);
  const [planningKey, setPlanningKey] = useState(0);
  const [pollFormOpen, setPollFormOpen] = useState(false);
  // Circles 3.1 — Create or organise, Link existing, and a refresh signal for the linked list.
  const [cooOpen, setCooOpen] = useState(false);
  const [linkKind, setLinkKind] = useState<"all" | "place" | null>(null);
  const [linksKey, setLinksKey] = useState(0);
  const linkToast = useToast();
  // Circle Experience 4.0 — the visitor page (circles.visitor_experience).
  const [visitorView, setVisitorView] = useState<CircleVisitorView | null>(null);
  const [visitorFailed, setVisitorFailed] = useState(false);
  const [joinSignal, setJoinSignal] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const autoJoin = searchParams.get("join") === "1";
  const clearAutoJoin = useCallback(() => {
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("join");
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);
  // Sticky right-hand panel (owner, 2026-10-24). Taller than the window, so it
  // scrolls with the page until its last card is in view, then stays put.
  const railRef = useRef<HTMLElement | null>(null);
  const [railTop, setRailTop] = useState(90);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const fit = () => setRailTop(Math.min(90, window.innerHeight - el.offsetHeight - 24));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  });
  const [welcomeHidden, setWelcomeHidden] = useState(false);
  const [tab, setTab] = useUrlTab<CircleTabKey>(TAB_KEYS, "home");

  const isOrganiser = membership.role === "organiser";
  const isMember = membership.member;

  const load = useCallback(() => {
    if (!idOrSlug) return;
    setLoadError(false);
    fetchCircle(idOrSlug)
      .then(async (c) => {
        setCircle(c);
        // A restricted response (non-member of an approval/invite Circle)
        // already carries requested/hasPendingInvite, and the server 403s
        // every member-only sub-resource for this viewer.
        if (c.restricted) {
          setUpcoming([]);
          setPolls([]);
          setPlanIdeas([]);
          setMembership(resident ? await fetchCircleMembership(c.id).catch(() => ({ ...EMPTY_MEMBERSHIP, requested: !!c.requested })) : { ...EMPTY_MEMBERSHIP, requested: !!c.requested });
          return;
        }
        const [up, m, p, pi] = await Promise.all([
          fetchCircleUpcoming(c.id),
          resident ? fetchCircleMembership(c.id) : Promise.resolve(EMPTY_MEMBERSHIP),
          fetchCirclePolls(c.id).catch(() => []),
          fetchCirclePlanIdeas(c.id).catch(() => []),
        ]);
        setUpcoming(up);
        setMembership(m);
        setPolls(p);
        setPlanIdeas(pi);
      })
      // PUB-14: a missing Circle shows the not-found state, not a retry.
      .catch((e) => (isNotFound(e) ? setCircle(null) : setLoadError(true)))
      .finally(() => setLoading(false));
  }, [idOrSlug, resident]);

  useEffect(load, [load]);
  // Planner data (2026-10-24): Circle Pulse and "who's free", shared by the
  // main-column planner and the right-panel charts. Members only.
  const planningMember = !!resident && membership.member && !!circle && !circle.restricted;
  useEffect(() => {
    if (!planningMember || !circle) return;
    if (features["circles.pulse"]) fetchCirclePulse(circle.id).then(setPulseView).catch(() => setPulseView(null));
    else setPulseView(null);
    if (features["circles.pulse"] || features["circles.free_time_match"]) fetchCircleFreeDays(circle.id).then((v) => setFreeDays(v.days)).catch(() => setFreeDays(null));
    else setFreeDays(null);
  }, [planningMember, circle?.id, features["circles.pulse"], features["circles.free_time_match"], planningKey, planIdeas.length]);
  const visitorWanted = features["circles.visitor_experience"] && !!circle && !(resident && membership.member);
  useEffect(() => {
    if (!visitorWanted || !circle) return setVisitorView(null);
    setVisitorFailed(false);
    fetchCircleVisitor(circle.id)
      .then(setVisitorView)
      .catch(() => setVisitorFailed(true));
  }, [visitorWanted, circle?.id, membership.requested]);
  const planningChanged = () => {
    setPlanningKey((n) => n + 1);
    load();
  };
  useEffect(() => {
    if (!circle || circle.restricted) return;
    fetchCircleMembers(circle.id)
      .then((r) => {
        setMemberList(r.members);
        setMemberTotal(r.total);
      })
      .catch(() => setMemberTotal(null));
  }, [circle?.id, circle?.restricted, circle?.members]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
    fetchCircleRecentActivity(circle.id).then(setRecentActivity).catch(() => setRecentActivity([]));
  }, [circle?.id, circle?.restricted]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
    // HC-QA-074 — four are shown (a full row, 2026-10-24), so ask for a handful, not the whole list.
    fetchCirclesPage({ county: circle.county ?? undefined, limit: 5 })
      .then(async ({ items: rows }) => {
        const others = rows.filter((c) => c.id !== circle.id);
        if (others.length < 4) {
          const all = await fetchCirclesPage({ limit: 8 }).then((p) => p.items).catch(() => []);
          const seen = new Set(others.map((c) => c.id));
          for (const c of all) {
            if (c.id === circle.id || seen.has(c.id)) continue;
            others.push(c);
            seen.add(c.id);
            if (others.length >= 4) break;
          }
        }
        setOtherCircles(others.slice(0, 4));
      })
      .catch(() => setOtherCircles([]));
  }, [circle?.id, circle?.county]);
  useEffect(() => {
    if (resident) fetchMyCircles().then((rows) => setOtherJoinedIds(new Set(rows.map((c) => c.id)))).catch(() => {});
  }, [resident]);
  useEffect(() => {
    if (!circle || circle.restricted) return;
    fetchMyReports()
      .then((rows) => setAlreadyReported(rows.some((r) => r.targetType === "circle" && r.targetId === circle.id)))
      .catch(() => {});
  }, [circle?.id, circle?.restricted]);

  const signInToJoin = (c: Circle) =>
    navigate(signInHref({ kind: "circle", title: c.name, meta: `${c.members.toLocaleString()} member${c.members === 1 ? "" : "s"} · ${c.area}, ${c.county}` }));

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
      // Best-effort — the dialog stays open so the resident can retry.
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
  const handleJoinCircle = async (joinRequest?: { note?: string; answers?: string[] }) => {
    if (!circle) return;
    if (!resident) return signInToJoin(circle);
    setJoinBusy(true);
    setJoinError(null);
    try {
      const result = await joinCircle(circle.id, joinRequest);
      trackEvent(result.requested ? "circle_join_request_submitted" : "circle_join_completed", { circleId: circle.id });
      setWelcomeHidden(false);
      load();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setJoinBusy(false);
    }
  };
  const handleLeaveCircle = async () => {
    if (!circle) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      await leaveCircle(circle.id);
      setTab("home");
      load();
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setJoinBusy(false);
    }
  };
  // Entry points that don't go through CircleJoinCard (which confirms itself).
  const confirmThenJoin = async () => {
    if (!circle) return;
    if (resident && !(await confirm(joinCircleConfirm(circle)))) return;
    await handleJoinCircle();
  };
  const confirmThenWithdraw = async () => {
    if (!circle) return;
    const ok = await confirm({ title: "Withdraw your request?", message: `Your request to join ${circle.name} will be cancelled. You can ask again later.`, confirmLabel: "Withdraw request", tone: "danger" });
    if (ok) await handleLeaveCircle();
  };
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
  const handleOtherJoin = async (other: Circle) => {
    if (!resident) return signInToJoin(other);
    setOtherBusyId(other.id);
    try {
      // A pending request isn't membership yet — the preview row stays "not joined".
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
  // "Suggest a plan" from Pulse, Free Time Match or Memories → the Make it
  // happen form on Home, prefilled. Never creates anything by itself.
  const suggestPlan = useCallback(
    (prefill: SuggestPlanPrefill) => {
      setTab("home");
      setPlanPrefill(prefill);
    },
    [setTab]
  );
  const clearPrefill = useCallback(() => setPlanPrefill(null), []);


  // Circle pulse (owner 2026-10-26): unread messages in this Circle's chat,
  // from the same /chat/mine the Messages inbox uses. Members only.
  useEffect(() => {
    if (!circle?.id || !resident) return;
    let live = true;
    fetchChatInbox()
      .then((r) => live && setChatUnread(r.items.find((i) => i.scopeType === "circle" && i.scopeId === circle.id)?.unread ?? 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [circle?.id, resident, chatRefresh]);

  if (loading) return <PageSpinner />;

  if (loadError) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>We couldn't load this Circle.</h1>
        <p style={{ color: colors.mutedLight, fontSize: 14 }}>Check your connection and try again.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16 }}>
          <Button onClick={load}>Try again</Button>
          <Button variant="ghost" onClick={() => navigate("/circles")}>
            Browse Circles
          </Button>
        </div>
      </section>
    );
  }

  if (!circle) {
    return (
      <section className="section-pad" style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 10px" }}>This Circle doesn't exist.</h1>
        <p style={{ color: colors.mutedLight, fontSize: 14 }}>It may have been removed, or the link is wrong.</p>
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
          : membership.restricted
            ? "restricted"
            : circle.hasPendingInvite
              ? "invited"
              : membership.requested || circle.requested
                ? "requested"
                : circle.joinMode === "invite"
                  ? "invite-only"
                  : "available";
  // Circle Experience 4.0 — everyone who isn't a member (or organiser) gets
  // the visitor page while circles.visitor_experience is on.
  const visitorMode = features["circles.visitor_experience"] && joinState !== "member" && joinState !== "organiser";
  const renderJoinCard = (bare: boolean) => (
    <div id="circle-join-card" style={{ scrollMarginTop: 100 }}>
      <CircleJoinCard
        bare={bare}
        circle={circle}
        state={joinState}
        busy={joinBusy}
        onJoin={handleJoinCircle}
        onLeave={handleLeaveCircle}
        onMessage={() => setChatOpen(true)}
        onCreatePlan={() => {
          setTab("home");
          setPlanPrefill({ title: "" });
        }}
        onInvite={handleInvite}
        inviteError={inviteError}
        onRequestClose={() => setConfirmingClose(true)}
        autoJoin={autoJoin}
        onAutoJoinHandled={clearAutoJoin}
        joinSignal={joinSignal}
        signedOutLabel={visitorMode ? "Join this Circle" : undefined}
      />
      {joinError && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "8px 0 0" }}>
          {joinError}
        </p>
      )}
    </div>
  );
  const joinCard = renderJoinCard(false);


  // Non-member view of an approval/invite Circle — a minimal, separate
  // layout: the server returns only an allow-listed teaser here. With the
  // visitor page switched on, that page replaces it (Circle Experience 4.0).
  if (circle.restricted && !visitorMode) {
    return (
      <section className="section-pad" style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px 60px" }}>
        <div style={{ padding: "22px 0 20px" }}>
          <BackLink onClick={() => navigate("/circles")} marginBottom={0}>
            Back to Circles
          </BackLink>
        </div>
        {circle.hasImage && (
          <div style={{ borderRadius: radius.card, overflow: "hidden", marginBottom: 20, aspectRatio: "16/7", background: colors.panel }}>
            <img src={getCircleCoverUrl(circle) ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <CategoryBreadcrumb taxonomy={circle.taxonomy} tags={circle.tags} basePath="/circles" typeLabel="Circles" />
        </div>
        <h1 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(24px, 2.4vw, 30px)", margin: "0 0 6px", letterSpacing: 0 }}>{circle.name}</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: colors.mutedLight }}>
          {circle.activityLabel}
          {circle.area ? ` · ${circle.area}` : ""}
          {circle.joinMode === "approval" && circle.county ? `, ${circle.county}` : ""} · {JOIN_MODE_LABEL[circle.joinMode]}
        </p>
        {circle.about && <p style={{ fontSize: 15, lineHeight: 1.6, color: colors.textSoft, marginBottom: 20 }}>{circle.about}</p>}
        <p style={{ fontSize: 13, color: colors.mutedLight, margin: "0 0 20px" }}>Plans, members and conversations are visible to members only.</p>
        <div style={{ maxWidth: 380 }}>{joinCard}</div>
        <ChatModal open={chatOpen} onClose={() => setChatOpen(false)} scopeType="circle" scopeId={circle.id} title={circle.name} />
      </section>
    );
  }

  const realPlans = upcoming.filter((p) => p.source === "circle");
  const nearbyPlans = upcoming.filter((p) => p.source === "nearby");
  const activeThisWeek =
    circle.nextPlan?.source === "circle" &&
    (() => {
      const days = (new Date(`${circle.nextPlan!.date}T00:00:00`).getTime() - Date.now()) / 86400000;
      return days >= 0 && days <= 7;
    })();
  const memberView = !!resident && isMember;

  // My Life style (owner 2026-10-26): Circle pulse rows from data already on
  // this page — open polls you haven't voted in, unread chat, wishes (totals).
  const openPolls = polls.filter((p) => p.status === "open" && !p.options.some((o) => o.votedByMe));
  const wishGroups = (pulseView?.groups ?? []).filter((g) => g.status === "active" && (g.count ?? 0) > 0);
  const circlePulse: CirclePulseRow[] = !memberView
    ? []
    : [
        ...openPolls.slice(0, 2).map((p): CirclePulseRow => ({
          key: `poll-${p.id}`, source: "Poll", hot: true, title: p.question,
          sub: p.options.length === 0 ? "Open poll" : `${p.options.length} ${p.options.length === 1 ? "option" : "options"} · ${p.options.reduce((n, o) => n + o.voteCount, 0)} ${p.options.reduce((n, o) => n + o.voteCount, 0) === 1 ? "vote" : "votes"} so far`,
          action: <button type="button" className="ch-see-all" onClick={() => goTab("polls")}>Vote</button>,
        })),
        ...(chatUnread > 0
          ? [{ key: "chat", source: "Discussion", title: `${chatUnread} new ${chatUnread === 1 ? "message" : "messages"}`, sub: "In the Circle chat", action: <button type="button" className="ch-see-all" onClick={() => setChatOpen(true)}>Open chat</button> }]
          : []),
        ...(wishGroups.length > 0
          ? [{
              key: "wishes", source: "Wishes",
              title: `${wishGroups.length} ${wishGroups.length === 1 ? "thing people would like" : "things people would like"} to do`,
              sub: "Totals only, never names",
              action: <button type="button" className="ch-see-all" onClick={() => document.getElementById("circle-plans")?.scrollIntoView({ block: "start" })}>Add yours</button>,
            }]
          : []),
      ];
  const nextMeetup = realPlans[0];
  const nextLine = nextMeetup ? (
    <>
      Next meetup: <button type="button" className="ch-ed-link" onClick={() => navigate(`/games/${nextMeetup.id}`)}>{dateLabel(nextMeetup.date)} at {nextMeetup.time}</button>. {nextMeetup.joined} of {nextMeetup.capacity} going.
    </>
  ) : null;
  const tabs: CircleTabKey[] = memberView
    ? (["home", "activities", "discussions", "polls", "members", ...(features["circles.memories"] ? (["memories"] as const) : []), "about"] as CircleTabKey[])
    : visitorMode
      ? ["home", "activities", "about"]
      : ["home", "activities", "members", "about"];
  const activeTab: CircleTabKey = tabs.includes(tab) ? tab : "home";
  const showWelcome = memberView && features["circles.first_time_friendly"] && membership.welcomed === false && !welcomeHidden;
  const createFirstActivity = () => navigate(`/games/host?activity=${encodeURIComponent(circle.activityLabel)}&circleId=${circle.id}`);
  const hasGuidelines = !!(circle.values || circle.whoCanJoin || circle.whatWeDo);
  const coverUrl = getCircleCoverUrl(circle);
  const goTab = (t: CircleTabKey) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const proposeTime = () => {
    setPollFormOpen(true);
    goTab("polls");
  };

  const nextUpEmpty = (
    <EmptyState
      icon={<CalendarIcon size={20} />}
      title={isOrganiser ? "Your Circle is ready." : "Nothing planned yet."}
      subtitle={
        isOrganiser
          ? "Create the first activity and give people something to join."
          : memberView
            ? "Say what you'd like to do below — when enough of you are keen, an organiser can make it happen."
            : "Join the Circle and we'll let you know when the next activity is announced."
      }
      action={
        isOrganiser && !closed ? (
          <Button onClick={createFirstActivity}>
            <PlusIcon size={14} /> Create first activity
          </Button>
        ) : joinState === "available" ? (
          <Button onClick={confirmThenJoin} disabled={joinBusy}>
            {joinBusy ? "…" : circle.joinMode === "approval" ? "Request to join" : "Join Circle"}
          </Button>
        ) : undefined
      }
    />
  );

  const nextUp = (
    <HomeSection
      id="circle-next-up"
      icon={<CalendarDays size={22} />}
      title="Next up"
      sub={realPlans.length ? "Upcoming activities organised by this Circle." : undefined}
      action={realPlans.length > 1 ? { label: `All ${realPlans.length} activities`, onClick: () => goTab("activities") } : null}
    >
      <CircleNextUp
        plans={realPlans}
        circleId={circle.id}
        circleImage={coverUrl}
        guideOn={memberView && features["circles.first_time_friendly"]}
        firstCircleActivity={membership.firstCircleActivity ?? null}
        emptyState={nextUpEmpty}
      />
      {memberView && <CirclePlannedTogether plans={planIdeas} circleSlugOrId={circle.slug ?? circle.id} />}
    </HomeSection>
  );

  const recentlyTogether = recentActivity.length > 0 && (
    <HomeSection icon={<History size={22} />} title="Recently together">
      <div className="ch-card" style={{ padding: "4px 14px" }}>
        <ul className="ch-list">
          {recentActivity.map((r) => (
            <li key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "12px 4px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.activityLabel}</div>
                <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                  {r.attended} attended · Completed {dateLabel(r.date)}
                  {r.source === "nearby" ? " · not organised through this Circle" : ""}
                </div>
              </div>
              {isOrganiser && !closed ? (
                <button onClick={() => handleDoItAgain(r.id)} disabled={rehostBusyId === r.id} className="ce-link">
                  {rehostBusyId === r.id ? "…" : "Do it again →"}
                </button>
              ) : (
                memberView &&
                !closed && (
                  <button onClick={() => suggestPlan({ title: r.activityLabel })} className="ce-link">
                    Plan the next one →
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  );

  const moreNearby = (nearbyPlans.length > 0 || otherCircles.length > 0) && (
    <HomeSection
      icon={<MapPin size={22} />}
      title="More happening near you"
      sub="Other activities and Circles you might like — not organised through this Circle."
      action={{ label: "See more", onClick: () => navigate(nearbyPlans.length ? `/games?activity=${encodeURIComponent(circle.activityLabel)}` : "/circles") }}
    >
      <div className="ch-grid-4 lc-grid--b">
        {nearbyPlans.slice(0, 2).map((plan) => (
          <CirclePlanCard key={plan.id} plan={plan} />
        ))}
        {otherCircles.slice(0, 3 - Math.min(2, nearbyPlans.length)).map((c) => (
          <CircleDiscoveryCard key={c.id} circle={c} joined={otherJoinedIds.has(c.id)} busy={otherBusyId === c.id} onJoin={() => handleOtherJoin(c)} onLeave={() => handleOtherLeave(c.id)} />
        ))}
      </div>
    </HomeSection>
  );

  const community = hasGuidelines || circle.about ? (
    <HomeSection id={showWelcome ? undefined : "circle-community"} icon={<Users size={22} />} title="About our community">
      <CircleCommunity circle={circle} />
    </HomeSection>
  ) : null;

  const quickActions: QuickAction[] =
    memberView && !closed
      ? [
          // Circles 3.1 — one entry for creating, linking and organising.
          { icon: <Plus size={17} />, label: "Create or organise", onClick: () => setCooOpen(true) },
          ...(isOrganiser ? [] : [{ icon: <MessageSquare size={17} />, label: "Message Circle", onClick: () => setChatOpen(true) }]),
          {
            icon: <UserPlus size={17} />,
            label: "Invite someone to join",
            render: (content) => <ShareButton entityType="circle" entityId={circle.id} render={(onClick) => <button type="button" onClick={onClick}>{content}</button>} />,
          },
          { icon: <Lightbulb size={17} />, label: "Suggest an activity", onClick: () => suggestPlan({ title: "" }) },
          { icon: <ChartColumn size={17} />, label: isOrganiser ? "Create a poll" : "See the polls", onClick: () => goTab("polls") },
          ...(isOrganiser ? [{ icon: <Settings2 size={17} />, label: "Manage Circle", onClick: () => navigate(`/manage/circles/${circle.slug ?? circle.id}`) }] : []),
          { icon: <SlidersHorizontal size={17} />, label: "Edit your preferences", onClick: () => navigate("/profile?tab=preferences") },
        ]
      : [];

  // Membership as a slim line on the Quick actions card, not a card of its
  // own (owner, 2026-10-24). Leaving stays one menu away.
  const memberStatus = (
    <>
      <span className="ch-status-text">
        <span className="ch-status-check" aria-hidden="true">
          <Check size={13} />
        </span>
        <span>
          <strong>You're a member</strong>
          {!!circle.familiarMembers && (
            <span className="ch-status-sub">
              {circle.familiarMembers} {circle.familiarMembers === 1 ? "person" : "people"} you've played with {circle.familiarMembers === 1 ? "is" : "are"} here
            </span>
          )}
        </span>
      </span>
      <ActionMenu
        label={`Membership options for ${circle.name}`}
        appearance="icon"
        items={[
          {
            label: "Leave Circle",
            danger: true,
            disabled: joinBusy,
            onSelect: async () => {
              if (await confirm({ title: `Leave ${circle.name}?`, message: "You'll stop seeing this Circle's plans and lose your spot in any you've joined.", confirmLabel: "Leave Circle", cancelLabel: "Stay in", tone: "danger" })) await handleLeaveCircle();
            },
          },
        ]}
      />
    </>
  );

  const rail = (
    <aside className="ch-rail" aria-label="About this Circle" ref={railRef} style={{ top: railTop }}>
      {joinState !== "member" && joinCard}
      {memberView && activeTab === "home" && (
        <PlanInsightsCard>
          <PlanStatsCard pulse={pulseView} plans={planIdeas} activities={realPlans} days={freeDays} />
          <WhosFreeCard days={freeDays} activities={realPlans} plans={planIdeas} />
          <MostWantedCard pulse={pulseView} plans={planIdeas} />
          <RailPollCard circleId={circle.id} polls={polls} closed={closed} onChanged={load} onSeeAll={() => goTab("polls")} onPropose={proposeTime} />
        </PlanInsightsCard>
      )}
      <QuickActionsCard actions={quickActions} status={joinState === "member" ? memberStatus : undefined} />
      <RailMembersCard members={memberList} total={memberTotal ?? circle.members} onSeeAll={() => goTab("members")} showTip={memberView} />
      <CircleDetailsCard circle={circle} />
      <CircleGuidelinesCard circle={circle} />
    </aside>
  );

  const homeTop = memberView ? (
    <div>
      {showWelcome && (
        <div style={{ marginBottom: 28 }}>
          <CircleWelcomePanel
            circle={circle}
            hasGuidelines={hasGuidelines}
            onDismissed={() => setWelcomeHidden(true)}
            onGo={(t) => {
              setTab(t);
              if (t === "home") requestAnimationFrame(() => document.getElementById("circle-guidelines")?.scrollIntoView({ block: "start" }));
            }}
          />
        </div>
      )}
      {isOrganiser && !closed && (realPlans.length === 0 || !circle.hasImage || !circle.about) && (
        <section className="ch-card cv-setup" aria-labelledby="cv-setup-title">
          <h2 id="cv-setup-title">Get your Circle ready for visitors</h2>
          <p>People who aren't members see a welcome page built from what you add here.</p>
          <ul>
            {[
              { done: !!circle.hasImage, label: "Add a cover photo", go: () => navigate(`/manage/circles/${circle.slug ?? circle.id}`) },
              { done: !!circle.about, label: "Write a short introduction", go: () => navigate(`/manage/circles/${circle.slug ?? circle.id}`) },
              { done: realPlans.length > 0, label: "Organise the first activity", go: createFirstActivity },
            ].map((t) => (
              <li key={t.label} className={t.done ? "cv-setup-done" : undefined}>
                <span aria-hidden="true">{t.done ? "✓" : "○"}</span>
                {t.done ? (
                  <span>{t.label}</span>
                ) : (
                  <button type="button" className="cp-link" onClick={t.go}>
                    {t.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <CirclePulseRows rows={circlePulse} />
      {nextUp}
      <section className="ch-section" id="circle-plans">
        <CirclePlanTogether
          circleId={circle.id}
          plans={planIdeas}
          activities={realPlans}
          pulse={pulseView}
          isOrganiser={isOrganiser}
          residentId={resident!.id}
          closed={closed}
          pulseOn={features["circles.pulse"]}
          interestOn={features["circles.make_it_happen"]}
          prefill={planPrefill}
          onPrefillUsed={clearPrefill}
          onChanged={planningChanged}
          onProposeTime={proposeTime}
          limit={6}
          onSeeAll={() => goTab("activities")}
        />
      </section>
    </div>
  ) : (
    <div>
      {nextUp}
      {recentlyTogether}
      {(joinState === "available" || joinState === "signed-out") && (
        <div className="ch-section">
          <CircleContextualCta circle={circle} signedOut={joinState === "signed-out"} busy={joinBusy} onJoin={confirmThenJoin} />
        </div>
      )}
    </div>
  );

  const homeBottom = memberView ? (
    <div>
      <HomeSection icon={<MessageSquare size={22} />} title="Recent discussions" action={{ label: "All discussions", onClick: () => goTab("discussions") }}>
        <CircleConversations circleId={circle.id} limit={3} onOpenChat={() => setChatOpen(true)} refreshKey={chatRefresh} layout="rows" />
      </HomeSection>
      {features["circles.memories"] ? (
        <section className="ch-section">
          <CircleMemoriesPanel circleId={circle.id} closed={closed} onSuggestPlan={suggestPlan} onSeeAll={() => goTab("memories")} layout="strip" />
        </section>
      ) : (
        recentlyTogether
      )}
      {community}
      {moreNearby}
    </div>
  ) : (
    <div>
      {community}
      {/* Moments are the linked venue's own photos (GET /:id/moments) — no venue, nothing to show. */}
      {circle.centreId && (
        <HomeSection icon={<Images size={22} />} title="Moments from this Circle">
          <CircleMoments circle={circle} />
        </HomeSection>
      )}
      {moreNearby}
    </div>
  );

  // Visitor page helpers. A non-open Circle's cover stays members-only.
  const visitorCover = visitorView?.coverUrl ?? (circle.joinMode === "open" ? coverUrl : null);
  const visitorJoin = () => {
    setJoinSignal((n) => n + 1);
    document.getElementById("circle-join-card")?.scrollIntoView({ block: "center" });
  };
  const visitorCanJoin = joinState === "available" || joinState === "signed-out" || joinState === "invited";
  // Same right-hand panel as the joined page: the join panel on top (the
  // existing join card inside it), who you'll meet, then the Circle's details.
  const visitorRail = (
    <aside className="ch-rail" aria-label="About this Circle" ref={railRef} style={{ top: railTop }}>
      <VisitorJoinPanel circle={circle} view={visitorView} faces={memberList.map((m) => m.name)} canJoin={visitorCanJoin}>
        {renderJoinCard(true)}
      </VisitorJoinPanel>
      {visitorView && <VisitorPeopleCard view={visitorView} />}
      <CircleDetailsCard circle={circle} />
    </aside>
  );
  const visitorJoinLabel = joinState === "signed-out" ? "Join this Circle" : joinState === "invited" ? "Accept invite" : circle.joinMode === "approval" ? "Request to join" : "Join Circle";

  return (
    // Fragment, not one wrapping div — see the mobile join bar below.
    <>
      <div style={{ background: colors.bg }}>
        <div className="ch-wrap">
          {visitorMode ? (
            // Same look as the member page (owner 2026-10-26): .ch-mlstyle and the editorial header.
            <div className="ch-body ch-body--top ch-body--visitor ch-mlstyle">
              <div className="ch-visitor-main" style={{ minWidth: 0 }}>
                <div className="ch-visitor-banner">
                  <CircleBanner circle={circle} activeThisWeek={!!activeThisWeek} cover={visitorCover} variant="editorial" />
                </div>
                <div className="ch-visitor-tabs">
                  <CircleTabBar
                    tabs={tabs}
                    labels={{ ...TAB_LABELS, home: "Overview" }}
                    value={activeTab}
                    onChange={setTab}
                    actions={<CircleActions circle={circle} saved={saved} onToggleSave={toggleSaved} alreadyReported={alreadyReported} onReport={() => setReportOpen(true)} />}
                  />
                </div>
                <div className="ch-visitor-panel">
                <TabPanel idBase="circle" tab={activeTab}>
                  <div className="ch-main">
                    {visitorFailed ? (
                      <p className="cv-empty">
                        We couldn't load this Circle's details.{" "}
                        <button type="button" className="cp-link" onClick={() => circle && fetchCircleVisitor(circle.id).then(setVisitorView).catch(() => setVisitorFailed(true))}>
                          Try again
                        </button>
                      </p>
                    ) : !visitorView ? (
                      <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <Skeleton width={260} height={28} />
                        <Skeleton height={160} radius={16} />
                        <Skeleton width={200} height={28} style={{ marginTop: 20 }} />
                        <Skeleton height={80} />
                      </div>
                    ) : activeTab === "activities" ? (
                      <VisitorActivities view={visitorView} circleId={circle.id} />
                    ) : activeTab === "about" ? (
                      <VisitorAbout circle={circle} view={visitorView} />
                    ) : (
                      <VisitorOverview
                        circle={circle}
                        view={visitorView}
                        cover={visitorCover}
                        isNew={visitorView.upcoming.length === 0 && visitorView.past.length === 0 && visitorView.venuePhotos.length === 0}
                        onJoin={visitorJoin}
                        joinLabel={visitorJoinLabel}
                        canJoin={visitorCanJoin}
                        more={moreNearby}
                      />
                    )}
                  </div>
                </TabPanel>
                </div>
              </div>
              {visitorRail}
            </div>
          ) : (
          <div className="ch-body ch-body--top ch-mlstyle">
            <div style={{ minWidth: 0 }}>
<CircleBanner circle={circle} activeThisWeek={!!activeThisWeek} variant="editorial" nextLine={nextLine} />
<CircleTabBar
  tabs={tabs}
  labels={TAB_LABELS}
  counts={{ activities: realPlans.length, polls: polls.filter((p) => p.status === "open").length, members: memberTotal ?? circle.members }}
  value={activeTab}
  onChange={setTab}
  actions={
    <CircleActions
      circle={circle}
      saved={saved}
      onToggleSave={toggleSaved}
      alreadyReported={alreadyReported}
      onReport={() => setReportOpen(true)}
      onOpenChat={memberView ? () => setChatOpen(true) : undefined}
    />
  }
/>
              <TabPanel idBase="circle" tab={activeTab}>
                <div className="ch-main">
                  {activeTab === "home" && (
                    <>
                      {homeTop}
                      {homeBottom}
                    </>
                  )}
                  {activeTab === "activities" && (
                    <>
                      <HomeSection icon={<CalendarDays size={22} />} title="Upcoming" sub="Organised through this Circle. Join through the activity page — that's where places and any payment are handled.">
                        {realPlans.length ? (
                          <CompactRows>
                            {realPlans.map((plan) => (
                              <NextUpRow key={plan.id} plan={plan} circleImage={coverUrl} />
                            ))}
                          </CompactRows>
                        ) : (
                          <EmptyState
                            icon={<CalendarIcon size={20} />}
                            title="Nothing planned yet"
                            action={
                              isOrganiser && !closed ? (
                                <Button onClick={createFirstActivity}>
                                  <PlusIcon size={14} /> Create an activity
                                </Button>
                              ) : undefined
                            }
                          />
                        )}
                      </HomeSection>
                      {memberView && (
                        <section className="ch-section" id="circle-all-plans">
                        <CirclePlanTogether
                          circleId={circle.id}
                          plans={planIdeas}
                          isOrganiser={isOrganiser}
                          residentId={resident!.id}
                          closed={closed}
                          pulseOn={features["circles.pulse"]}
                          interestOn={features["circles.make_it_happen"]}
                          pulse={pulseView}
                          prefill={null}
                          onPrefillUsed={clearPrefill}
                          onChanged={planningChanged}
                          onProposeTime={proposeTime}
                          showEarlier
                        />
                      </section>
                      )}
                      {/* Circles 3.1 — listings linked to this Circle (not plans). */}
                      <CircleLinkedListings
                        circleId={circle.id}
                        member={memberView}
                        closed={closed}
                        refreshKey={linksKey}
                        onLinkExisting={() => setLinkKind("all")}
                        onSuggest={() => suggestPlan({ title: "" })}
                      />
                      {recentlyTogether}
                      {moreNearby}
                    </>
                  )}
                  {activeTab === "discussions" && memberView && (
                    <HomeSection icon={<MessageSquare size={22} />} title="Discussions" sub="The Circle chat. Organisers' announcements are marked. Report anything that isn't right from the chat.">
                      <CircleConversations circleId={circle.id} limit={20} onOpenChat={() => setChatOpen(true)} refreshKey={chatRefresh} />
                    </HomeSection>
                  )}
                  {activeTab === "polls" && memberView && (
                    <section className="ch-section">
                      <CirclePollsPanel circleId={circle.id} polls={polls} planIdeas={planIdeas} isOrganiser={isOrganiser} closed={closed} onChanged={load} onNavigate={navigate} startOpen={pollFormOpen} onStarted={() => setPollFormOpen(false)} />
                    </section>
                  )}
                  {activeTab === "members" && (
                    <section className="ch-section">
                      <CircleMemberDirectory circleId={circle.id} isOrganiser={isOrganiser} onManage={() => navigate(`/manage/circles/${circle.slug ?? circle.id}?tab=members`)} />
                    </section>
                  )}
                  {activeTab === "memories" && memberView && features["circles.memories"] && (
                    <section className="ch-section">
                      <CircleMemoriesPanel circleId={circle.id} closed={closed} onSuggestPlan={suggestPlan} />
                    </section>
                  )}
                  {activeTab === "about" && (
                    <>
                      <HomeSection icon={<Info size={22} />} title={`About ${circle.name}`}>
                        {circle.about ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: colors.textSoft, whiteSpace: "pre-wrap", maxWidth: 760 }}>{circle.about}</p> : <p style={{ margin: 0, color: colors.mutedLight }}>The organiser hasn't written about this Circle yet.</p>}
                      </HomeSection>
                      {(circle.whatWeDo || circle.whoCanJoin || circle.values) && (
                        <HomeSection icon={<Users size={22} />} title="About our community">
                          <CircleCommunity circle={circle} />
                        </HomeSection>
                      )}
                      {circle.centreId && (
                        <HomeSection icon={<Images size={22} />} title="Moments from this Circle">
                          <CircleMoments circle={circle} />
                        </HomeSection>
                      )}
                    </>
                  )}
                </div>
              </TabPanel>
            </div>
            {rail}
          </div>
          )}

          <ConfirmDialog
            open={confirmingClose}
            title="Close this circle?"
            message="It drops off public browse but stays visible to members — this can't be undone from here."
            confirmLabel="Close circle"
            onConfirm={handleCloseCircle}
            onCancel={() => setConfirmingClose(false)}
          />

          {memberView && !closed && (
            <CreateOrOrganise
              open={cooOpen}
              onClose={() => setCooOpen(false)}
              circle={{ id: circle.id, slug: circle.slug, name: circle.name, activityLabel: circle.activityLabel }}
              isOrganiser={isOrganiser}
              onSuggestPlan={() => suggestPlan({ title: "" })}
              onPoll={proposeTime}
              onLink={(k) => setLinkKind(k)}
              inviteRender={(content) => <ShareButton entityType="circle" entityId={circle.id} render={(onClick) => <button type="button" className="coo-item" onClick={() => (setCooOpen(false), onClick())}>{content}</button>} />}
            />
          )}
          {linkKind && (
            <LinkListingDialog
              circleId={circle.id}
              circleName={circle.name}
              isOrganiser={isOrganiser}
              startKind={linkKind === "place" ? "place" : "all"}
              onClose={() => setLinkKind(null)}
              onDone={(what, targetId) => {
                setLinkKind(null);
                setLinksKey((k) => k + 1);
                if (what === "planned") {
                  planningChanged();
                  navigate(`?tab=activities#plan-${targetId}`);
                } else {
                  linkToast.success(what === "linked" ? "Linked to the Circle." : "Sent to the organisers. It shows here once one of them approves it.");
                  goTab("activities");
                }
              }}
            />
          )}

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
            <div role="group" aria-label="Reason" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {CIRCLE_REPORT_REASONS.map((reason) => (
                <button key={reason} type="button" className="ce-chip" aria-pressed={reason === reportReason} onClick={() => setReportReason(reason)}>
                  {reason}
                </button>
              ))}
            </div>
            <textarea
              aria-label="Anything else the moderator should know? (optional)"
              placeholder="Anything else the moderator should know? (optional)"
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </ConfirmDialog>
        </div>

        {!closed && (
          <CtaBand
            id="circle-cta-title"
            label="Find your people."
            lines={["Can't find", "what you're", "after?"]}
            text="Tell HelloCircle what kind of Circle you want to join and we'll help you find the right people."
            action={{ label: "Explore Circles", to: "/circles" }}
            secondary={{ label: "Start a Circle", to: "/circles/start" }}
            panel={{ title: "Looking for something else?", text: "Tell us when suits you. We'll let you know when a similar Circle forms near you." }}
          >
            {circle.activityLabel ? <IntentCaptureForm variant="panel" activityLabel={circle.activityLabel} county={circle.county} /> : null}
          </CtaBand>
        )}
      </div>

      {/* Mobile sticky join bar — a sibling of the animated wrapper (see above).
          Mirrors the rail card's state machine so the two never disagree. */}
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
              {circle.nextPlan && (
                <Button style={{ flex: "none" }} onClick={() => navigate(`/games/${circle.nextPlan!.id}`)}>
                  View plan
                </Button>
              )}
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>{circle.name}</div>
              <Button
                style={{ flex: "none" }}
                onClick={visitorMode && (joinState === "signed-out" || joinState === "available") ? visitorJoin : joinState === "signed-out" ? () => signInToJoin(circle) : joinState === "requested" ? confirmThenWithdraw : confirmThenJoin}
                disabled={joinBusy || joinState === "invite-only"}
              >
                {joinBusy
                  ? "…"
                  : joinState === "signed-out"
                    ? visitorMode
                      ? "Join this Circle"
                      : "Sign in to join"
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
      <ChatModal
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setChatRefresh((n) => n + 1);
        }}
        scopeType="circle"
        scopeId={circle.id}
        title={circle.name}
      />
    </>
  );
}
