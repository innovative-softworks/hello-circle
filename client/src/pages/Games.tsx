import { Plus as PlusLucide } from "lucide-react";
import { CategoryChips, CategoryEmptyHint, CategoryTypeOptions, hasCategoryTypes, useCategoryFilter } from "../components/categories/CategoryChips";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useToast } from "../components/Toast";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchGamesPage, fetchMyGames, joinGame, joinGameWaitlist, subscribeGameNotifyMe } from "../api";
import { openCheckout } from "../native";
import { signInHref } from "../authRedirect";
import { ArrowRightIcon, AwardIcon, BallIcon, CalendarIcon, ClockIcon, CloseIcon, PinIcon, PlusIcon, SearchIcon, UsersIcon } from "../components/icons";
import { Chip } from "../components/Chip";
import { DropdownCheckbox, DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { Button, CardSkeleton, ConfirmDialog, Drawer, EmptyState, LoadErrorState, LoadMoreControl, inputStyle, useDialogFocus } from "../components/ui";
import type { GameListFilters } from "../api/resident";
import { PageTitle } from "../components/PageTitle";
import { AuthContextCard } from "../components/AuthShell";
import { SignInPanel } from "../components/SignInPanel";
import { SaveButton, useSavedState } from "../components/SaveButton";
import { CardAction, CardArrow, CardAvailability, CardGrid, CardPrice, ListingCard, ListingCardSkeleton } from "../components/ListingCard";
import { CardDate, gameCardLabel } from "../components/CardDate";
import { dateLabel } from "../euro";
import { formatAvailability, formatDateTime, formatPrice, formatTime12h } from "../formatters";
import { gameState, isMinAgeRefusal, primaryCtaLabel } from "../gameCta";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth, placeholderStripes, radius } from "../theme";
import { SKILL_LEVELS } from "../constants";
import type { Game } from "../types";
import { daysBetween, irelandDaysFromToday, irelandToday, weekdayOf } from "../irelandDate";
import { CtaBand } from "../components/CtaBand";
import { FeaturedPicks } from "../components/FeaturedPicks";

// "Join a Game" (MVP) — the lightweight, participation-first counterpart to
// booking a whole venue: see plan doc "Book vs Join". v1 is deliberately
// simple — no map, no filters beyond county — the point is proving the
// pattern, not building it out fully on day one.
//
// UX pass (this file, Games() + everything below it): the primary goal is
// still "I want to find something I can join", but v1's single undifferentiated
// grid made that hard once there were more than a handful of open games — every
// card looked equally important, there was no way to narrow by time/activity/
// skill/price, and "Sign in from My Life to join a game" repeated on every
// single card. What changed: real search/filter/sort (all client-side — the
// full open-games list is small enough that a second endpoint isn't worth
// it), a redesigned results card with a proper needs/available/full state
// model, and a sign-in prompt that only appears once, at the moment someone
// actually tries to join. This page's own results grid uses `JoinGameCard`
// further down; `GameCard`/`needHeadline` immediately below are used by
// Home.tsx's "They just need a few more people" module — brought onto the
// same card shell (bordered surface, photo badge + SaveButton, plain h3
// title) as CentreCard/ClubCard/CircleDiscoveryCard/JoinGameCard instead of
// its own one-off layout (raw `Card`, headline as colored text above the
// title, no save button) that had drifted from every other listing card.

// The single most prominent line on a GameCard — "1 player needed" / "2
// spots left" / "3 more welcome" — per the product's own signature framing
// (see Home.tsx's "They just need a few more people"). A pending-minimum
// game still needs a real headcount to confirm at all, so that takes
// priority over spotsLeft; null once the game is full (handled separately).
function needHeadline(game: Game): string | null {
  if (game.spotsLeft === 0) return null;
  if (game.status === "pending_participants") {
    const needed = Math.max(0, (game.minParticipants ?? 0) - game.joined);
    return needed === 1 ? "1 player needed to confirm" : `${needed} players needed to confirm`;
  }
  if (game.spotsLeft === 1) return "1 player needed";
  if (game.spotsLeft === 2) return "2 spots left";
  return `${game.spotsLeft} more welcome`;
}

/** Same "preserve user intent" context GameJoinCard's own sign-in CTA
 * carries into /signin — a signed-out visitor lands back on the game with
 * this recap shown, rather than a bare login form. */
function gameSignInContext(game: Game) {
  return {
    kind: "game" as const,
    title: game.activityLabel,
    meta: `${game.date} · ${game.time} · ${game.centreName ?? game.locationText}`,
    badge: game.spotsLeft === 0 ? "Full" : game.spotsLeft === 1 ? "1 spot left" : `${game.spotsLeft} spots left`,
  };
}

/** Card photo pill: the activity's real category (subcategory first), else "Activity". */
function cardCategory(game: Game): string {
  return game.taxonomy?.subcategoryName ?? game.taxonomy?.categoryName ?? "Activity";
}

/** A calm status when nothing is urgent — only from real fields: listed in
 * the last 7 days ("New"), or marked solo friendly. */
function quietStatus(game: Game): { label: string; tone: "new" } | null {
  const created = game.createdAt ? Date.parse(game.createdAt) : NaN;
  if (!Number.isNaN(created) && Date.now() - created < 7 * 24 * 3600 * 1000) return { label: "New", tone: "new" };
  if (game.soloFriendly) return { label: "Solo friendly", tone: "new" };
  return null;
}

export function GameCard({ game, onJoin, onLeave, joining }: { game: Game; onJoin: () => void; onLeave: () => void; joining: boolean }) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [saved, toggleSaved] = useSavedState("game", game.id);
  const [notifySubscribed, setNotifySubscribed] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const full = game.spotsLeft === 0;
  const comingSoon = game.effectiveLifecycle === "coming_soon";
  const headline = needHeadline(game);
  const href = `/games/${game.id}`;
  const handleNotifyMe = async () => {
    if (!resident) return navigate(signInHref(gameSignInContext(game)));
    setNotifyBusy(true);
    try {
      await subscribeGameNotifyMe(game.id);
      setNotifySubscribed(true);
    } finally {
      setNotifyBusy(false);
    }
  };
  // Design-system consistency pass: the shared ListingCard shape.
  return (
    <ListingCard
      href={href}
      title={game.activityLabel}
      headingLevel={2}
      image={game.imageUrl}
      ph={placeholderStripes.green}
      fallbackKind="Activity"
      fallbackLine={formatDateTime(game.date, game.time)}
      rowOnPhone
      icon={<BallIcon size={22} />}
      iconColor={colors.orange}
      tag={cardCategory(game)}
      status={comingSoon ? { label: "Coming soon", tone: "calm" } : full ? { label: "Fully booked", tone: "calm" } : headline ? { label: headline, tone: "hot" } : quietStatus(game)}
      save={<SaveButton saved={saved} onToggle={toggleSaved} />}
      details={[
        { icon: <CalendarIcon size={13} />, text: gameWhen12h(game) },
        { icon: <PinIcon size={13} />, text: game.centreName ?? game.locationText },
        game.hostVerified ? { icon: <AwardIcon size={13} />, text: "Verified host" } : null,
      ]}
      going={game.joined}
      facts={
        <>
          <CardPrice cents={game.priceCents} unit="per person" />
          {!comingSoon && <CardAvailability spotsLeft={game.spotsLeft} />}
        </>
      }
      action={
        comingSoon ? (
          <CardAction look="outline" onClick={handleNotifyMe} disabled={notifySubscribed} busy={notifyBusy} busyLabel="Setting up…">
            {notifySubscribed ? "We'll let you know" : "Notify me"}
          </CardAction>
        ) : full ? (
          <CardAction look="outline" onClick={() => (resident ? joinGameWaitlist(game.id) : navigate(signInHref(gameSignInContext(game))))} ariaLabel={`Join the waitlist for ${game.activityLabel}`}>
            Join waitlist
          </CardAction>
        ) : (
          <CardAction look={(game.priceCents ?? 0) > 0 ? "filled" : "outline"} arrow busy={joining} busyLabel="Joining…" onClick={resident ? onJoin : () => navigate(signInHref(gameSignInContext(game)))} ariaLabel={`Join ${game.activityLabel}`}>
            Join
          </CardAction>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Join a Game — results page (redesigned). Everything below is new; nothing
// above this line changed.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 12;
const CATEGORY_CHIP_LIMIT = 6;
const PENDING_ACTION_KEY = "hc_pending_game_action";

type AvailabilityFilter = "needs" | "available" | "full";
type WhenFilter = "any" | "today" | "tonight" | "tomorrow" | "weekend" | "next7" | "date";
type PriceTier = "any" | "free" | "under10" | "10to20" | "over20";
type SortKey = "recommended" | "soonest" | "needs" | "price";

const WHEN_LABELS: Record<WhenFilter, string> = {
  any: "Any time",
  today: "Today",
  tonight: "Tonight",
  tomorrow: "Tomorrow",
  weekend: "This weekend",
  next7: "Next 7 days",
  date: "Pick a date",
};
const PRICE_LABELS: Record<PriceTier, string> = {
  any: "Any price",
  free: "Free",
  under10: "Under €10",
  "10to20": "€10-€20",
  over20: "€20+",
};
const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  needs: "Needs people",
  available: "Spaces available",
  full: "Full",
};
const SORT_LABELS: Record<SortKey, string> = {
  recommended: "Recommended",
  soonest: "Soonest",
  needs: "Needs people",
  price: "Price: Low to High",
};

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

/** The plain-language "X going · Y spots left" line under a card's title -
 * urgency is carried by wording/color here rather than a bold image badge.
 * Delegates to the shared formatAvailability so the wording matches every
 * other AvailabilityBadge-driven surface in the app. */
function spotsLabel(game: Game): string {
  const needed = game.status === "pending_participants" ? Math.max(0, (game.minParticipants ?? 0) - game.joined) : undefined;
  return formatAvailability(game.spotsLeft, needed);
}

/** 12-hour clock, to match the "Today · 7:30 PM" pill badge convention -
 * only used there; everywhere else (confirm sheet, GameCard) keeps the
 * plain 24-hour time already stored/displayed. */
function gameWhen(game: Game): string {
  return formatDateTime(game.date, game.time);
}

function gameWhen12h(game: Game): string {
  return formatDateTime(game.date, game.time, true);
}

/** Each price tier as the server's priceMin/priceMax (cents). */
const PRICE_RANGES: Record<Exclude<PriceTier, "any">, { min?: number; max?: number }> = {
  free: { max: 0 },
  under10: { min: 1, max: 999 },
  "10to20": { min: 1000, max: 2000 },
  over20: { min: 2001 },
};

function mergeById(lists: Game[][]): Game[] {
  const seen = new Set<string>();
  return lists.flat().filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

function priceMatches(game: Game, tier: PriceTier): boolean {
  const cents = game.priceCents ?? 0;
  if (tier === "free") return cents === 0;
  if (tier === "under10") return cents > 0 && cents < 1000;
  if (tier === "10to20") return cents >= 1000 && cents <= 2000;
  if (tier === "over20") return cents > 2000;
  return true;
}

function dateWhenMatches(game: Game, when: WhenFilter, whenDate: string): boolean {
  if (when === "any") return true;
  const diffDays = daysBetween(irelandToday(), game.date);
  if (when === "today") return diffDays === 0;
  if (when === "tonight") return diffDays === 0 && game.time >= "17:00";
  if (when === "tomorrow") return diffDays === 1;
  if (when === "weekend") {
    const day = weekdayOf(game.date);
    return diffDays >= 0 && diffDays <= 7 && (day === 0 || day === 6);
  }
  if (when === "next7") return diffDays >= 0 && diffDays <= 7;
  if (when === "date") return !whenDate || game.date === whenDate;
  return true;
}

/** Lightweight natural-language support ("Badminton tonight") — recognizes a
 * trailing/leading time keyword, strips it for the plain text match, and
 * feeds it back as the effective When filter unless one's already picked
 * from the dropdown. Not real NLP, just the handful of phrases the search
 * placeholder itself invites. */
function parseQuery(raw: string): { text: string; when: WhenFilter | null } {
  const lower = raw.trim().toLowerCase();
  const keywords: [string, WhenFilter][] = [
    ["this weekend", "weekend"],
    ["tonight", "tonight"],
    ["tomorrow", "tomorrow"],
    ["today", "today"],
  ];
  for (const [kw, val] of keywords) {
    if (lower.includes(kw)) return { text: lower.replace(kw, "").replace(/\s+/g, " ").trim(), when: val };
  }
  return { text: lower, when: null };
}

function matchesText(game: Game, q: string): boolean {
  if (!q) return true;
  const hay = `${game.activityLabel} ${game.centreName ?? ""} ${game.locationText} ${game.area ?? ""}`.toLowerCase();
  return hay.includes(q);
}

function compareGames(a: Game, b: Game, sort: SortKey): number {
  const aFull = a.spotsLeft === 0;
  const bFull = b.spotsLeft === 0;
  if (aFull !== bFull) return aFull ? 1 : -1; // full always sinks, regardless of sort
  if (sort === "price") return (a.priceCents ?? 0) - (b.priceCents ?? 0);
  if (sort === "soonest") return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
  const need = (g: Game) => (g.status === "pending_participants" ? -1 : g.spotsLeft);
  if (sort === "needs") {
    const diff = need(a) - need(b);
    return diff !== 0 ? diff : `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
  }
  // recommended: a coarse two-tier bucket (truly urgent - pending or 1 spot
  // left - vs. everything else non-full), sorted by date within each tier.
  // A strict ascending sort on spotsLeft looked "prioritized" on paper but in
  // practice let the games-that-need-1/2-people bucket alone fill an entire
  // first page (there are simply more of them than 12), so every visible
  // card carried the same orange "I'm in" - no variety, no green "Join"
  // cards until several "Show more" clicks in. The explicit "Needs people"
  // sort option above still does the fine-grained version on purpose.
  const tier = (g: Game) => (g.status === "pending_participants" || g.spotsLeft === 1 ? 0 : 1);
  const tierDiff = tier(a) - tier(b);
  if (tierDiff !== 0) return tierDiff;
  const dateDiff = `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
  if (dateDiff !== 0) return dateDiff;
  // Tiebreak by id rather than joined-count: with only a handful of distinct
  // dates in the seed data, many games tie on (tier, date), and sorting the
  // remainder by "busiest first" just re-clustered same-pattern games back
  // together (the original bug this tiering was meant to fix). id order
  // reflects creation order, which cycles through activity/pattern
  // combinations, so it interleaves instead.
  return a.id.localeCompare(b.id);
}

// --- Join Game card (this page's grid only — see the file-top note) -------

function JoinGameCard({
  game,
  joinedByMe,
  busy,
  onPrimaryAction,
  onFindSimilar,
}: {
  game: Game;
  joinedByMe: boolean;
  busy: boolean;
  onPrimaryAction: () => void;
  onFindSimilar: () => void;
}) {
  const navigate = useNavigate();
  const [saved, toggleSaved] = useSavedState("game", game.id);
  const [notifySubscribed, setNotifySubscribed] = useState(false);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const state = gameState(game);
  const full = state === "full";
  const comingSoon = game.effectiveLifecycle === "coming_soon";
  const href = `/games/${game.id}`;
  const handleNotifyMe = () => {
    setNotifyBusy(true);
    subscribeGameNotifyMe(game.id)
      .then(() => setNotifySubscribed(true))
      .catch(() => navigate(signInHref(gameSignInContext(game))))
      .finally(() => setNotifyBusy(false));
  };

  // Design-system consistency pass: the shared ListingCard shape with one
  // full-width action — "I'm in"/"Join" (brand), "Join waitlist"/"View
  // plan" (secondary). Urgency shows as the photo status badge.
  const isJoinable = !joinedByMe && !full;
  const ctaLabel = joinedByMe ? "View plan" : full ? "Join waitlist" : primaryCtaLabel(game);
  // The price is already in the card footer, so the compact button keeps just the verb.
  const shortCta = ctaLabel.split(" · ")[0];
  const ctaVariant = isJoinable ? "primary" : "ghost";

  // My Life card style (option B, owner 2026-10-27): the status and the big
  // date on the photo, the category as a kicker, one muted line.
  const label = gameCardLabel(game, joinedByMe);
  const place = game.centreName ?? game.locationText;
  return (
    <ListingCard
      href={href}
      title={game.activityLabel}
      headingLevel={2}
      image={game.imageUrl}
      ph={placeholderStripes.green}
      fallbackKind="Activity"
      fallbackLine={formatDateTime(game.date, game.time)}
      rowOnPhone
      icon={<BallIcon size={24} />}
      iconColor={colors.orange}
      // Only a real category: a generic "Activity" on every card says nothing.
      kicker={game.taxonomy?.subcategoryName ?? game.taxonomy?.categoryName ?? null}
      dateOn={<CardDate date={game.date} time={game.time} label={label} href={href} onGo={navigate} />}
      save={<SaveButton saved={saved} onToggle={toggleSaved} />}
      details={[{ text: [place, game.joined > 0 ? `${game.joined} going` : null].filter(Boolean).join(" · ") }]}
      facts={
        <>
          <CardPrice cents={game.priceCents} unit="per person" />
          {!comingSoon && <CardAvailability spotsLeft={game.spotsLeft} />}
        </>
      }
      action={
        comingSoon ? (
          <CardAction look="outline" disabled={notifySubscribed} busy={notifyBusy} busyLabel="Setting up…" onClick={handleNotifyMe}>
            {notifySubscribed ? "We'll let you know" : "Notify me"}
          </CardAction>
        ) : joinedByMe || game.joinedByMe || game.waitlistedByMe ? (
          <CardArrow label={game.waitlistedByMe ? `View ${game.activityLabel}: you're on the waitlist` : `View your plan: ${game.activityLabel}`} onClick={() => navigate(href)} />
        ) : game.joinRequestByMe === "requested" ? (
          <CardAction look="booked" ariaLabel={`Request sent to join ${game.activityLabel}`}>
            Sent
          </CardAction>
        ) : (
          <CardAction
            look={full ? "outline" : ctaVariant === "primary" && (game.priceCents ?? 0) > 0 ? "filled" : "outline"}
            arrow={!full}
            busy={busy}
            busyLabel="Joining…"
            onClick={onPrimaryAction}
            ariaLabel={full ? `Join the waitlist for ${game.activityLabel}` : `${ctaLabel}: ${game.activityLabel}`}
          >
            {shortCta}
          </CardAction>
        )
      }
    >
      {full && !joinedByMe && (
        <button type="button" className="stretched-link-above" onClick={onFindSimilar} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: "4px 0", minHeight: 32, cursor: "pointer", fontSize: 13, fontWeight: 700, color: colors.orange, position: "relative" }}>
          Find similar →
        </button>
      )}
    </ListingCard>
  );
}

// --- Sign-in prompt (fires only when a signed-out guest tries to join) ----
// Embeds the same SignInPanel every other sign-in surface uses (link/login/
// signup/forgot), instead of hand-rolling a second, magic-link-only auth
// form here — a real "don't duplicate authentication logic between modal
// and page" violation caught while auditing the login flow (this file's
// own version had no password login/signup at all, just email links). A
// password login/signup completes instantly, in place — refreshGuest()
// updates `resident`, which the existing pending-action effect above
// already watches to resume the join, no extra plumbing needed. The
// magic-link tab still needs the old "check your email, come back" round
// trip, which that same pending-action mechanism also already covers.

function JoinAuthModal({ open, game, onClose, onSignedIn }: { open: boolean; game: Game | null; onClose: () => void; onSignedIn: () => void | Promise<void> }) {
  // HC-QA-069 adjacent — same modal keyboard contract as ConfirmDialog.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(20,22,20,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={game ? `Sign in to join ${game.activityLabel}` : "Sign in to join this session"}
        tabIndex={-1}
        className="modal-in"
        style={{ background: colors.surface, borderRadius: radius.card, padding: 24, maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(20,22,20,.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {game ? (
          <AuthContextCard
            context={{
              kind: "game",
              title: game.activityLabel,
              meta: `${dateLabel(game.date)} · ${game.time} · ${game.centreName ?? game.locationText}`,
              badge: game.spotsLeft === 0 ? "Full" : game.spotsLeft === 1 ? "1 spot left" : `${game.spotsLeft} spots left`,
            }}
          />
        ) : (
          <>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Join this session</h3>
            <p style={{ fontSize: 13.5, color: colors.muted, lineHeight: 1.5, margin: "0 0 16px" }}>
              Sign in or create an account to confirm your place.
            </p>
          </>
        )}
        <SignInPanel
          onSuccess={async () => {
            await onSignedIn();
            onClose();
          }}
        />
      </div>
    </div>,
    document.body
  );
}

export function Games() {
  const navigate = useNavigate();
  const toast = useToast();
  const { resident, refresh: refreshGuest } = useGuest();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [myGameIds, setMyGameIds] = useState<Set<string>>(new Set());
  const [quickJoinGame, setQuickJoinGame] = useState<Game | null>(null);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [authPromptGame, setAuthPromptGame] = useState<Game | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialActivity = searchParams.get("activity") ?? "";
  const [query, setQuery] = useState(initialActivity);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const county = searchParams.get("county") || "All";
  // Owner, 2026-10-23: Refine takes several choices per group (?when=today,weekend).
  const listParam = (key: string) => (searchParams.get(key) || "").split(",").filter((v) => v && v !== "any");
  const whens = useMemo(() => listParam("when") as WhenFilter[], [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const whenDate = searchParams.get("whenDate") || "";
  // Category system: ?category=<slug>&sub=<slug>. A pre-taxonomy
  // ?category=<activity label> link still filters by that label.
  const taxonomy = useCategoryFilter("activity");
  const category = taxonomy.legacyLabel ?? "All";
  const skills = useMemo(() => listParam("skill"), [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const prices = useMemo(() => listParam("price") as PriceTier[], [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const availability = useMemo(
    () => (searchParams.get("availability") || "").split(",").filter(Boolean) as AvailabilityFilter[],
    [searchParams]
  );

  const resultsRef = useRef<HTMLDivElement>(null);

  // HC-QA-063 — a failed load is an error state, never "0 games".
  const [loadFailed, setLoadFailed] = useState(false);
  // HC-QA-073 — server-paginated (cursor) list; filters that map to SQL are
  // sent to the server so a page never hides matches. See loadFirstPage below.
  // One cursor per server query (several ticked types = one query each).
  const [cursors, setCursors] = useState<(string | null)[]>([]);
  const nextCursor = cursors.some(Boolean);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [seenGames, setSeenGames] = useState<Map<string, Game>>(new Map());
  const requestSeq = useRef(0);

  const loadMyGames = () => {
    if (!resident) {
      setMyGameIds(new Set());
      return;
    }
    fetchMyGames()
      .then((rows) => setMyGameIds(new Set(rows.map((r) => r.id))))
      .catch(() => {});
  };
  useEffect(loadMyGames, [resident]);

  // Resumes whatever a signed-out guest was trying to do once they come back
  // signed in (see JoinAuthModal / openAuthPrompt) — the magic-link email
  // itself always lands on /bookings (that flow lives in MyBookings.tsx and
  // isn't touched here), so this only fires once the resident manually
  // returns to this page, picking the intended game back out of the list
  // that's already loaded rather than silently re-joining in the background.
  useEffect(() => {
    if (!resident || games.length === 0) return;
    const raw = localStorage.getItem(PENDING_ACTION_KEY);
    if (!raw) return;
    localStorage.removeItem(PENDING_ACTION_KEY);
    try {
      const pending = JSON.parse(raw) as { gameId: string; action: "join" | "waitlist" };
      const game = games.find((g) => g.id === pending.gameId);
      if (!game) return;
      if (pending.action === "waitlist") handleWaitlist(game.id);
      else setQuickJoinGame(game);
    } catch {
      // malformed/stale value — ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident, games]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, county, whens.join(","), whenDate, category, skills.join(","), prices.join(","), availability.join(","), sort]);

  const setParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };
  const setCounty = (v: string) => setParam("county", v, "All");
  const setCategory = (v: string) => setParam("category", v, "All");
  const toggleParam = (key: string, v: string) => {
    const cur = listParam(key);
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    setParam(key, next.join(","), "");
  };
  const clearWhen = () => setParam("when", "", "");
  const setWhenDate = (v: string) => setParam("whenDate", v, "");

  const toggleAvailability = (a: AvailabilityFilter) => {
    const next = availability.includes(a) ? availability.filter((x) => x !== a) : [...availability, a];
    const nextParams = new URLSearchParams(searchParams);
    if (next.length) nextParams.set("availability", next.join(","));
    else nextParams.delete("availability");
    setSearchParams(nextParams);
  };
  const clearAllFilters = () => {
    setSearchParams(new URLSearchParams());
    setQuery("");
  };

  const optionGames = useMemo(() => Array.from(seenGames.values()), [seenGames]);
  const countyOptions = useMemo(() => uniqueSorted(optionGames.map((g) => g.county)), [optionGames]);
  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    optionGames.forEach((g) => counts.set(g.activityLabel, (counts.get(g.activityLabel) ?? 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
  }, [optionGames]);
  const chipCategories = useMemo(() => {
    const base = category !== "All" && !topCategories.slice(0, CATEGORY_CHIP_LIMIT).includes(category)
      ? [category, ...topCategories]
      : topCategories;
    return base.slice(0, CATEGORY_CHIP_LIMIT);
  }, [topCategories, category]);
  const overflowCategories = useMemo(
    () => topCategories.filter((c) => !chipCategories.includes(c)),
    [topCategories, chipCategories]
  );

  const parsedQuery = useMemo(() => parseQuery(query), [query]);
  const effectiveWhens: WhenFilter[] = whens.length ? whens : parsedQuery.when && parsedQuery.when !== "any" ? [parsedQuery.when] : [];

  // HC-QA-073 — the same filters, expressed for the server query.
  const [debouncedText, setDebouncedText] = useState(parsedQuery.text);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedText(parsedQuery.text), 250);
    return () => clearTimeout(t);
  }, [parsedQuery.text]);
  const serverFilters = useMemo<GameListFilters>(() => {
    const f: GameListFilters = { q: debouncedText || undefined, county: county !== "All" ? county : undefined, category: category !== "All" ? category : undefined, skill: skills.length === 1 ? skills[0] : undefined, ...taxonomy.serverParams };
    // Several ticked: the server gets the span that covers them all and the
    // list below keeps only exact matches.
    const day = irelandDaysFromToday;
    const spans = effectiveWhens.map((w) => {
      if (w === "today") return { from: day(0), to: day(0) };
      if (w === "tonight") return { from: day(0), to: day(0), timeFrom: "17:00" };
      if (w === "tomorrow") return { from: day(1), to: day(1) };
      if (w === "weekend") return { from: day(0), to: day(7), weekend: true };
      if (w === "next7") return { from: day(0), to: day(7) };
      if (w === "date" && whenDate) return { from: whenDate, to: whenDate };
      return null;
    });
    if (spans.length && spans.every(Boolean)) {
      const ok = spans as { from: string; to: string; timeFrom?: string; weekend?: boolean }[];
      f.dateFrom = ok.map((x) => x.from).sort()[0];
      f.dateTo = ok.map((x) => x.to).sort().reverse()[0];
      if (ok.every((x) => x.timeFrom)) f.timeFrom = "17:00";
      if (ok.every((x) => x.weekend)) f.weekend = true;
    }
    const ranges = prices.filter((p): p is Exclude<PriceTier, "any"> => p !== "any").map((p) => PRICE_RANGES[p]);
    if (ranges.length) {
      const mins = ranges.map((r) => r.min ?? 0);
      const maxs = ranges.map((r) => r.max);
      if (Math.min(...mins) > 0) f.priceMin = Math.min(...mins);
      if (maxs.every((m) => m !== undefined)) f.priceMax = Math.max(...(maxs as number[]));
    }
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText, county, category, skills.join(","), effectiveWhens.join(","), whenDate, prices.join(","), JSON.stringify(taxonomy.serverParams)]);
  // Several ticked types: the list endpoint takes one type, so one query each.
  const serverQueries = useMemo<GameListFilters[]>(
    () => (taxonomy.subSlugs.length > 1 ? taxonomy.subSlugs.map((sub) => ({ ...serverFilters, subcategorySlug: sub })) : [serverFilters]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverFilters, taxonomy.subSlugs.join(",")]
  );
  const filterKey = JSON.stringify(serverQueries);

  const remember = (rows: Game[]) => setSeenGames((m) => { const n = new Map(m); rows.forEach((g) => n.set(g.id, g)); return n; });
  const load = () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadFailed(false);
    setLoadMoreFailed(false);
    Promise.all(serverQueries.map((q) => fetchGamesPage(q)))
      .then((pages) => {
        if (seq !== requestSeq.current) return;
        const items = mergeById(pages.map((p) => p.items));
        setGames(items);
        setCursors(pages.map((p) => p.nextCursor));
        remember(items);
      })
      .catch(() => { if (seq === requestSeq.current) setLoadFailed(true); })
      .finally(() => { if (seq === requestSeq.current) setLoading(false); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [filterKey]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    Promise.all(serverQueries.map((q, i) => (cursors[i] ? fetchGamesPage(q, cursors[i]) : Promise.resolve({ items: [] as Game[], nextCursor: null }))))
      .then((pages) => {
        if (seq !== requestSeq.current) return;
        const fresh = mergeById(pages.map((p) => p.items));
        // Keyset pages can't overlap, but de-duplicate defensively by id.
        setGames((prev) => { const ids = new Set(prev.map((g) => g.id)); return [...prev, ...fresh.filter((g) => !ids.has(g.id))]; });
        setCursors(pages.map((p) => p.nextCursor));
        remember(fresh);
        setVisibleCount((v) => v + PAGE_SIZE);
      })
      // Page 1 (and every loaded page) stays visible; only "load more" shows an error.
      .catch(() => { if (seq === requestSeq.current) setLoadMoreFailed(true); })
      .finally(() => setLoadingMore(false));
  };

  // One predicate, also used to count what dropping a filter would add.
  type Relax = { text?: boolean; county?: boolean; category?: boolean; when?: boolean; price?: boolean };
  const matchGame = (g: Game, r: Relax = {}) => {
    if (!r.text && !matchesText(g, parsedQuery.text)) return false;
    if (!r.county && county !== "All" && g.county !== county) return false;
    if (!r.category && category !== "All" && g.activityLabel !== category) return false;
    if (!r.when && effectiveWhens.length && !effectiveWhens.some((w) => dateWhenMatches(g, w, whenDate))) return false;
    if (skills.length && g.skillLevel && g.skillLevel !== "All levels" && !skills.some((sk) => g.skillLevel.toLowerCase() === sk.toLowerCase())) return false;
    if (!r.price && prices.length && !prices.some((p) => priceMatches(g, p))) return false;
    if (availability.length && !availability.includes(gameState(g))) return false;
    return true;
  };
  const filtered = useMemo(() => games.filter((g) => matchGame(g)), [games, parsedQuery, county, category, effectiveWhens, whenDate, skills, prices, availability]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareGames(a, b, sort)), [filtered, sort]);
  const visibleGames = sorted.slice(0, visibleCount);

  const activeCount =
    [county !== "All", category !== "All" || !!taxonomy.selected].filter(Boolean).length + whens.length + skills.length + prices.length + availability.length;

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (county !== "All") chips.push({ key: "county", label: county, onRemove: () => setCounty("All") });
    whens.forEach((w) => chips.push({ key: `when-${w}`, label: w === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[w], onRemove: () => toggleParam("when", w) }));
    if (category !== "All") chips.push({ key: "category", label: category, onRemove: () => setCategory("All") });
    if (taxonomy.label) chips.push({ key: "taxonomy", label: taxonomy.label, onRemove: () => taxonomy.setCategory(null) });
    availability.forEach((a) => chips.push({ key: `avail-${a}`, label: AVAILABILITY_LABELS[a], onRemove: () => toggleAvailability(a) }));
    skills.forEach((sk) => chips.push({ key: `skill-${sk}`, label: sk, onRemove: () => toggleParam("skill", sk) }));
    prices.forEach((p) => chips.push({ key: `price-${p}`, label: PRICE_LABELS[p], onRemove: () => toggleParam("price", p) }));
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, whens, whenDate, category, availability, skills, prices, taxonomy.label]);

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      const res = await joinGame(id);
      setQuickJoinGame(null);
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setMyGameIds((prev) => new Set(prev).add(id));
      load();
    } catch (e) {
      if (isMinAgeRefusal(e)) return void navigate(`/games/${id}`);
      toast.error(e instanceof Error ? e.message : "Couldn't join this session");
    } finally {
      setJoiningId(null);
    }
  };

  const handleWaitlist = async (id: string) => {
    try {
      await joinGameWaitlist(id);
      toast.success("You're on the waitlist — we'll email you if a spot opens up.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't join the waitlist");
    }
  };

  const openAuthPrompt = (game: Game, action: "join" | "waitlist") => {
    localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({ gameId: game.id, action }));
    setAuthPromptGame(game);
    setAuthPromptOpen(true);
  };

  const handlePrimaryAction = (game: Game) => {
    if (myGameIds.has(game.id)) {
      navigate(`/games/${game.id}`);
      return;
    }
    const state = gameState(game);
    if (state === "full") {
      if (!resident) {
        openAuthPrompt(game, "waitlist");
        return;
      }
      handleWaitlist(game.id);
      return;
    }
    if (!resident) {
      openAuthPrompt(game, "join");
      return;
    }
    setQuickJoinGame(game);
  };

  const openCreateForm = () => navigate(`/games/host${window.location.search}`);

  // Closing CTA band's "alive" stat — count of open games in the next 7
  // days, off the unfiltered fetch (not `sorted`/`filtered`), so it reads
  // as "what's out there" regardless of whatever filters are currently applied.
  const upcomingWeekCount = useMemo(
    () => games.filter((g) => g.status !== "cancelled" && dateWhenMatches(g, "next7", "")).length,
    [games]
  );

  const whenSummaryLabel = whens.length === 0 ? WHEN_LABELS.any : whens.map((w) => (w === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[w])).join(", ");
  const intentActivityLabel = category !== "All" ? category : taxonomy.selectedSub?.name ?? taxonomy.selected?.name ?? (parsedQuery.text || "this");

  const filterGroupStyle: CSSProperties = { padding: "16px 0", borderTop: `1px solid ${colors.border}` };
  const filterLabelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: 0, marginBottom: 8 };

  const filterPanel = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16 }}>
        <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 15 }}>Refine</span>
        {activeCount > 0 && (
          <button onClick={clearAllFilters} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: colors.muted }}>
            Clear all
          </button>
        )}
      </div>

      {/* Owner, 2026-10-23: the category's types live here, not as a second chip row. */}
      {hasCategoryTypes(taxonomy) && (
        <div style={{ ...filterGroupStyle, paddingTop: 0, borderTop: "none" }}>
          <div style={filterLabelStyle}>Type</div>
          <CategoryTypeOptions state={taxonomy} />
        </div>
      )}

      <div style={{ ...filterGroupStyle, ...(hasCategoryTypes(taxonomy) ? {} : { paddingTop: 0 }) }}>
        <div style={filterLabelStyle}>When</div>
        {(["today", "tonight", "tomorrow", "weekend", "next7"] as WhenFilter[]).map((w) => (
          <DropdownCheckbox key={w} label={WHEN_LABELS[w]} checked={whens.includes(w)} onChange={() => toggleParam("when", w)} />
        ))}
        <DropdownCheckbox label="Pick a date" checked={whens.includes("date")} onChange={() => toggleParam("when", "date")} />
        {whens.includes("date") && (
          <input aria-label="Pick a date" type="date" value={whenDate} onChange={(e) => setWhenDate(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontSize: 13, padding: "7px 9px" }} />
        )}
      </div>

      <div style={filterGroupStyle}>
        <div style={filterLabelStyle}>Availability</div>
        {(["needs", "available", "full"] as AvailabilityFilter[]).map((a) => (
          <DropdownCheckbox key={a} label={AVAILABILITY_LABELS[a]} checked={availability.includes(a)} onChange={() => toggleAvailability(a)} />
        ))}
      </div>

      <div style={filterGroupStyle}>
        <div style={filterLabelStyle}>Skill</div>
        {SKILL_LEVELS.filter((s) => s !== "All levels").map((s) => (
          <DropdownCheckbox key={s} label={s} checked={skills.some((x) => x.toLowerCase() === s.toLowerCase())} onChange={() => toggleParam("skill", s)} />
        ))}
      </div>

      <div style={{ ...filterGroupStyle, paddingBottom: 0 }}>
        <div style={filterLabelStyle}>Price</div>
        {(["free", "under10", "10to20", "over20"] as PriceTier[]).map((p) => (
          <DropdownCheckbox key={p} label={PRICE_LABELS[p]} checked={prices.includes(p)} onChange={() => toggleParam("price", p)} />
        ))}
      </div>
    </>
  );

  return (
    <div className="fade-panel">
      <ConfirmDialog
        open={!!quickJoinGame}
        title="Confirm your spot"
        message={
          quickJoinGame && (
            <div>
              <div style={{ fontWeight: 700, color: colors.text, marginBottom: 4 }}>{quickJoinGame.activityLabel}</div>
              <div>{quickJoinGame.centreName ?? quickJoinGame.locationText}</div>
              <div style={{ margin: "4px 0" }}>{gameWhen(quickJoinGame)}</div>
              <div>{quickJoinGame.joined}/{quickJoinGame.capacity} joined</div>
              <div style={{ fontWeight: 700, color: quickJoinGame.priceCents ? colors.text : colors.greenText }}>
                {formatPrice(quickJoinGame.priceCents, { each: true })}
              </div>
            </div>
          )
        }
        confirmLabel={quickJoinGame?.priceCents ? "Continue to payment" : "Confirm I'm in"}
        cancelLabel="Not now"
        tone="neutral"
        busy={joiningId === quickJoinGame?.id}
        onConfirm={() => quickJoinGame && handleJoin(quickJoinGame.id)}
        onCancel={() => setQuickJoinGame(null)}
      />
      <JoinAuthModal
        open={authPromptOpen}
        game={authPromptGame}
        onClose={() => {
          setAuthPromptOpen(false);
          setAuthPromptGame(null);
        }}
        onSignedIn={refreshGuest}
      />

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <PageTitle>Activities</PageTitle>
            <p style={{ color: colors.mutedLight, fontSize: 15, margin: 0 }}>Find something nearby and jump in.</p>
          </div>
          {resident && (
            <button onClick={openCreateForm} style={{ background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: colors.muted }}>
              Host an activity instead →
            </button>
          )}
        </div>

        {/* Search card (Batch 2, same pattern as Explore and BrowseLayout): the
            field and the area/when pickers in one row that wraps on phones.
            Results filter as you type, so there's no separate Search button. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, border: `1px solid ${colors.border}`, borderRadius: radius.card, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 8, marginTop: 20, marginBottom: 14 }}>
          <div style={{ position: "relative", flex: "1 1 260px", minWidth: 0 }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input aria-label="Search activities"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you feel like doing? e.g. Badminton tonight"
              style={{ width: "100%", padding: "11px 8px 11px 36px", border: "none", background: "transparent", fontSize: 16, color: colors.text, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <select aria-label="Area"
            value={county}
            onChange={(e) => setCounty(e.target.value)}
            style={{ padding: "9px 12px", border: "none", borderRadius: radius.pill, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
          >
            <option value="All">Near: anywhere</option>
            {countyOptions.map((c) => (
              <option key={c} value={c}>Near: {c}</option>
            ))}
          </select>
        </div>

        {/* Category chips (category system); the label chips below remain
            only as the fallback when no category has live activities. */}
        <CategoryChips state={taxonomy} subChips={false} />
        {taxonomy.loaded && taxonomy.categories.length === 0 && (
        <div className="chips-scroll-mobile" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <Chip label="All" active={category === "All"} onClick={() => setCategory("All")} />
          {chipCategories.map((c) => (
            <Chip key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? "All" : c)} />
          ))}
          {overflowCategories.length > 0 && (
            <span className="show-mobile-contents">
              {overflowCategories.map((c) => (
                <Chip key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? "All" : c)} />
              ))}
            </span>
          )}
          {overflowCategories.length > 0 && (
            <span className="hide-mobile">
              <FilterDropdown label={overflowCategories.includes(category) ? category : "More"} active={overflowCategories.includes(category)}>
                {overflowCategories.map((c) => (
                  <DropdownOption key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? "All" : c)} />
                ))}
              </FilterDropdown>
            </span>
          )}
        </div>
        )}
      </section>

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px 32px" }}>
        <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 28, alignItems: "start" }}>
          <aside className="games-sidebar sticky-aside" style={{ position: "sticky", top: 90, maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>
            {filterPanel}
          </aside>

          <div>
            <div ref={resultsRef} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                {loading ? (
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Loading…</div>
                ) : loadFailed ? null : (
                  <>
                    {(sorted.length > visibleCount || !!nextCursor) && (
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: 2 }}>
                        Showing 1-{Math.min(visibleCount, sorted.length)} of {sorted.length}{nextCursor ? "+" : ""}
                      </div>
                    )}
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: 0 }}>
                      {sorted.length}{nextCursor ? "+" : ""}{" "}
                      <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 15, color: colors.mutedLight }}>
                        game{sorted.length === 1 ? "" : "s"} & sessions nearby
                      </span>
                    </div>
                  </>
                )}
                {(county !== "All" || whens.length > 0 || !!parsedQuery.text) && (
                  <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>
                    {county === "All" ? "Anywhere" : county} · {whenSummaryLabel}
                    {parsedQuery.text && ` for "${parsedQuery.text}"`}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="games-filter-trigger"
                  onClick={() => setFiltersOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1.5px solid ${colors.borderStrong}`, background: colors.surface, color: colors.textSoft, borderRadius: radius.card, padding: "8px 14px", fontSize: 14, fontWeight: 600 }}
                >
                  Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                </button>
                <select aria-label="Sort results"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={{ padding: "9px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: radius.control, fontSize: 14, background: colors.bg, color: colors.text, outline: "none", fontWeight: 600 }}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            </div>


            {activeChips.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={c.onRemove}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.greenBg, color: colors.greenText, border: "none", borderRadius: radius.card, padding: "5px 10px 5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    {c.label} <CloseIcon size={12} />
                  </button>
                ))}
                <button onClick={clearAllFilters} style={{ background: "none", border: "none", padding: "5px 4px", cursor: "pointer", fontSize: 13, fontWeight: 700, color: colors.muted }}>
                  Clear all
                </button>
              </div>
            )}
            {loading ? (
              <div className="listing-grid">
                {Array.from({ length: PAGE_SIZE }, (_, i) => <ListingCardSkeleton key={i} />)}
              </div>
            ) : loadFailed ? (
              <LoadErrorState title="We couldn't load activities right now." onRetry={load} />
            ) : sorted.length === 0 && nextCursor ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "28px 0" }}>
                <p style={{ margin: 0, color: colors.mutedLight, fontSize: 14 }}>No matches in the sessions loaded so far — there are more to check.</p>
                <LoadMoreControl loadingMore={loadingMore} failed={loadMoreFailed} onLoadMore={loadMore} />
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<UsersIcon size={22} />}
                title={games.length === 0 && !taxonomy.selected ? "No open activities yet" : "Nothing matching that yet."}
                subtitle={
                  games.length === 0 && !taxonomy.selected
                    ? "Be the first to start one."
                    : "There may still be people nearby who want to do the same thing."
                }
                action={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <IntentCaptureForm activityLabel={intentActivityLabel} county={county === "All" ? "" : county} />
                    <CategoryEmptyHint state={taxonomy} basePath="/games" />
                    {games.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                        {county !== "All" && <Chip label="Expand to anywhere" active={false} onClick={() => setCounty("All")} />}
                        {whens.length > 0 && <Chip label="Any time" active={false} onClick={clearWhen} />}
                        {activeCount > 0 && <Chip label="Clear filters" active={false} onClick={clearAllFilters} />}
                      </div>
                    )}
                  </div>
                }
              />
            ) : (
              <>

                <CardGrid>
                  {visibleGames.map((g) => (
                    <JoinGameCard
                      key={g.id}
                      game={g}
                      joinedByMe={myGameIds.has(g.id)}
                      busy={joiningId === g.id}
                      onPrimaryAction={() => handlePrimaryAction(g)}
                      onFindSimilar={() => {
                        setQuery(g.activityLabel);
                        setCategory("All");
                        taxonomy.setCategory(null);
                        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  ))}
                </CardGrid>
                {visibleCount < sorted.length ? (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
                    <Button variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      Show more ({sorted.length - visibleCount} more)
                    </Button>
                  </div>
                ) : nextCursor ? (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
                    <LoadMoreControl loadingMore={loadingMore} failed={loadMoreFailed} onLoadMore={loadMore} />
                  </div>
                ) : (
                  sorted.length > PAGE_SIZE && <p role="status" style={{ textAlign: "center", color: colors.faint, fontSize: 13, marginTop: 24 }}>You've reached the end of the list.</p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* A featured section of another type (owner 2026-10-27). */}
      <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "0 24px" }}>
        <FeaturedPicks kind="circles" />
      </div>

      {/* Closing CTA band — the shared CtaBand (same as Home's closing band). */}
      <CtaBand
        id="games-cta-title"
        panel={{ title: "Host your own", text: "Pick a time and place — people nearby can join in.", icon: <PlusLucide size={20} strokeWidth={2} /> }}
        label="Join or host."
        lines={["Can't find", "the right", "game?"]}
        text={
          <>
            Start one yourself — invite friends or open it up to anyone nearby.
            {upcomingWeekCount > 0 && (
              <>
                {" "}
                <strong>{upcomingWeekCount}</strong> game{upcomingWeekCount === 1 ? "" : "s"} happening in the next 7 days.
              </>
            )}
          </>
        }
        action={{ label: "Start a game", to: "/games/host", onClick: resident ? openCreateForm : () => setAuthPromptOpen(true) }}
        secondary={{ label: "Explore Circles instead", to: "/circles" }}
      />

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        {filterPanel}
        <div style={{ marginTop: 20 }}>
          <Button full onClick={() => setFiltersOpen(false)}>Show {sorted.length} result{sorted.length === 1 ? "" : "s"}</Button>
        </div>
      </Drawer>
    </div>
  );
}
