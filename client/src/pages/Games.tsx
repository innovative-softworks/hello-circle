import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createGame, fetchCentres, fetchGames, fetchMyGames, joinGame, joinGameWaitlist } from "../api";
import { signInHref } from "../authRedirect";
import { ArrowRightIcon, AwardIcon, BallIcon, CalendarIcon, ClockIcon, CloseIcon, HeartIcon, LightbulbIcon, PinIcon, PlusIcon, SearchIcon, UsersIcon } from "../components/icons";
import { Chip } from "../components/Chip";
import { DropdownCheckbox, DropdownOption, FilterDropdown } from "../components/FilterDropdown";
import { IntentCaptureForm } from "../components/IntentCaptureForm";
import { Photo } from "../components/Photo";
import { Button, Card, CardSkeleton, ConfirmDialog, Drawer, EmptyState, inputStyle, labelStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { AuthContextCard } from "../components/AuthShell";
import { SignInPanel } from "../components/SignInPanel";
import { isFavorite, toggleFavorite } from "../favorites";
import { dateLabel } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts, maxWidth } from "../theme";
import { SKILL_LEVELS } from "../constants";
import type { Centre, Game } from "../types";

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
// actually tries to join. `GameCard`/`needHeadline` immediately below are
// UNCHANGED and still used by Home.tsx's "They just need a few more people"
// module — this page's own results grid uses the new `JoinGameCard` further
// down instead, so Home's look is untouched.

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

export function GameCard({ game, onJoin, onLeave, joining }: { game: Game; onJoin: () => void; onLeave: () => void; joining: boolean }) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const full = game.spotsLeft === 0;
  const headline = needHeadline(game);
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <Photo
        src={game.imageUrl ?? undefined}
        alt={game.activityLabel}
        ph="repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)"
        icon={<BallIcon size={22} />}
        iconColor={colors.green}
        style={{ height: 120 }}
      />
      <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          {headline && (
            <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 17, color: colors.orangeDark, marginBottom: 3, letterSpacing: "-.01em" }}>
              {headline}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => navigate(`/games/${game.id}`)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: fonts.display, fontWeight: 700, fontSize: 15.5, color: colors.text }}
            >
              {game.activityLabel}
            </button>
            {game.soloFriendly && (
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" }}>
                Solo friendly
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.mutedLight, fontSize: 14, marginTop: 4, flexWrap: "wrap" }}>
            {game.centreName ?? game.locationText}
            {game.hostVerified && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" }}>
                <AwardIcon size={11} /> Verified Host
              </span>
            )}
          </div>
        </div>
        {game.priceCents ? (
          <div style={{ fontWeight: 700, color: colors.greenText, flex: "none" }}>€{(game.priceCents / 100).toFixed(2)}</div>
        ) : (
          <div style={{ fontWeight: 700, color: colors.greenText, fontSize: 13, flex: "none" }}>Free</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 16, margin: "12px 0", fontSize: 13.5, color: colors.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <CalendarIcon size={14} /> {game.date}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <ClockIcon size={14} /> {game.time}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <UsersIcon size={14} /> {game.joined}/{game.capacity}
        </span>
      </div>
      {full ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.orangeDark }}>Full</span>
          <Button
            variant="ghost"
            onClick={() => joinGameWaitlist(game.id)}
            disabled={!resident}
          >
            Join waitlist
          </Button>
        </div>
      ) : (
        <Button onClick={onJoin} disabled={joining || !resident} full>
          {joining ? "Joining…" : "I'm in"}
        </Button>
      )}
      {!resident && <div style={{ fontSize: 12, color: colors.faint, marginTop: 8 }}>Sign in from My Life to join a game.</div>}
      </div>
    </Card>
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

/** One participation state per game — drives badge, CTA copy/tone, and the
 * Availability filter. Mirrors needHeadline's own thresholds (1-2 spots left
 * or still below its minimum reads as urgent) without touching that function,
 * since GameCard above still depends on its exact original behavior. */
function gameState(game: Game): AvailabilityFilter {
  if (game.spotsLeft === 0) return "full";
  if (game.status === "pending_participants" || game.spotsLeft <= 2) return "needs";
  return "available";
}

/** The plain-language "X going · Y spots left" line under a card's title -
 * urgency is carried by wording/color here rather than a bold image badge. */
function spotsLabel(game: Game): string {
  if (game.spotsLeft === 0) return "Full";
  if (game.status === "pending_participants") {
    const needed = Math.max(0, (game.minParticipants ?? 0) - game.joined);
    return needed === 1 ? "1 more to confirm" : `${needed} more to confirm`;
  }
  return game.spotsLeft === 1 ? "1 spot left" : `${game.spotsLeft} spots left`;
}

function primaryCtaLabel(game: Game): string {
  const base = gameState(game) === "needs" ? "I'm in" : "Join";
  return game.priceCents ? `${base} · €${(game.priceCents / 100).toFixed(2)}` : base;
}

function relativeWhenLabel(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00`);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays > 1 && diffDays < 7) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return dateLabel(iso);
}

function gameWhen(game: Game): string {
  return `${relativeWhenLabel(game.date)} · ${game.time}`;
}

/** 12-hour clock, to match the "Today · 7:30 PM" pill badge convention -
 * only used there; everywhere else (confirm sheet, GameCard) keeps the
 * plain 24-hour time already stored/displayed. */
function formatTime12h(time: string): string {
  const [hStr, m] = time.split(":");
  const h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function gameWhen12h(game: Game): string {
  return `${relativeWhenLabel(game.date)} · ${formatTime12h(game.time)}`;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${game.date}T00:00:00`);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (when === "today") return diffDays === 0;
  if (when === "tonight") return diffDays === 0 && game.time >= "17:00";
  if (when === "tomorrow") return diffDays === 1;
  if (when === "weekend") {
    const day = d.getDay();
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
  const [saved, setSaved] = useState(() => isFavorite("game", game.id));
  const state = gameState(game);
  const full = state === "full";

  // Every card CTA is a small, compact button (never full-width) - "I'm
  // in"/"Join" (needs/available) dark, "Join waitlist"/"View plan" (full/
  // already-joined) ghost. The urgency signal lives in the "X going · Y
  // spots left" line's wording/color instead of a bold image badge.
  const isJoinable = !joinedByMe && !full;
  const ctaLabel = joinedByMe ? "View plan" : full ? "Join waitlist" : primaryCtaLabel(game);
  const ctaVariant = isJoinable ? "dark" : "ghost";
  const ctaStyle = { padding: "8px 16px", fontSize: 13 };
  const spotsColor = full ? colors.muted : state === "needs" ? colors.orangeDark : colors.mutedLight;

  return (
    <Card hover style={{ padding: 0, overflow: "hidden" }}>
      <Photo
        src={game.imageUrl ?? undefined}
        alt={game.activityLabel}
        ph="repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)"
        icon={<BallIcon size={24} />}
        iconColor={colors.green}
        style={{ height: 150 }}
        contentStyle={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            background: "rgba(255,255,255,.92)",
            color: colors.text,
            borderRadius: 999,
            padding: "5px 11px 5px 9px",
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          <ClockIcon size={12} /> {gameWhen12h(game)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSaved(toggleFavorite("game", game.id));
          }}
          aria-label={saved ? "Remove from saved" : "Save this game"}
          className="btn"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: saved ? colors.orange : "#8A928B",
            flex: "none",
          }}
        >
          <HeartIcon size={14} filled={saved} />
        </button>
      </Photo>
      <div style={{ padding: 16 }}>
        <button
          onClick={() => navigate(`/games/${game.id}`)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
            display: "block",
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 16,
            color: colors.text,
            marginBottom: 3,
          }}
        >
          {game.activityLabel}
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 13.5,
            color: colors.mutedLight,
            marginBottom: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <PinIcon size={12} style={{ flex: "none" }} /> {game.centreName ?? game.locationText}
        </div>
        <div style={{ fontSize: 13, color: colors.muted, marginBottom: 14 }}>
          {game.joined} going{" "}
          <span style={{ color: spotsColor, fontWeight: state === "needs" || full ? 700 : 400 }}>· {spotsLabel(game)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: game.priceCents ? colors.text : colors.greenText }}>
            {game.priceCents ? `€${(game.priceCents / 100).toFixed(2)}` : "Free"}
          </span>
          <Button variant={ctaVariant} disabled={busy} onClick={onPrimaryAction} style={ctaStyle}>
            {busy ? "Joining…" : ctaLabel}
          </Button>
        </div>
        {full && !joinedByMe && (
          <button
            onClick={onFindSimilar}
            style={{ display: "block", width: "100%", textAlign: "right", background: "none", border: "none", padding: "8px 0 0", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: colors.muted }}
          >
            Find similar
          </button>
        )}
      </div>
    </Card>
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
  if (!open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(20,22,20,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        className="pop-in"
        style={{ background: colors.surface, borderRadius: 16, padding: 24, maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(20,22,20,.25)" }}
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
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Join this game</h3>
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
  // "Do it again" (post-audit hardening pass, GameDetail.tsx) carries the
  // just-completed game's venue forward too, so re-hosting the same
  // activity at the same place is one less thing to re-enter — date/time/
  // capacity are deliberately NOT pre-filled here, since those shouldn't be
  // silently guessed for a new plan.
  const initialCentreId = searchParams.get("centreId") ?? "";
  const initialLocationText = searchParams.get("locationText") ?? "";
  const [query, setQuery] = useState(initialActivity);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const county = searchParams.get("county") || "All";
  const when = (searchParams.get("when") as WhenFilter) || "any";
  const whenDate = searchParams.get("whenDate") || "";
  const category = searchParams.get("category") || "All";
  const skill = searchParams.get("skill") || "any";
  const price = (searchParams.get("price") as PriceTier) || "any";
  const availability = useMemo(
    () => (searchParams.get("availability") || "").split(",").filter(Boolean) as AvailabilityFilter[],
    [searchParams]
  );

  const [centres, setCentres] = useState<Centre[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(!!initialActivity);
  const createFormRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    activityLabel: initialActivity,
    centreId: initialCentreId,
    locationText: initialLocationText,
    date: "",
    time: "",
    capacity: 4,
    priceCents: "",
    soloFriendly: false,
    skillLevel: "",
    minParticipants: "",
    confirmationDeadline: "",
    description: "",
    durationMinutes: "",
    equipmentNeeded: "",
    minAge: "",
    surfaceType: "",
    indoorOutdoor: "" as "" | "indoor" | "outdoor" | "mixed",
    meetingInstructions: "",
    cancellationPolicy: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showMoreFields, setShowMoreFields] = useState(false);

  const load = () => {
    setLoading(true);
    fetchGames()
      .then(setGames)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    fetchCentres().then(setCentres);
  }, []);

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
  }, [query, county, when, whenDate, category, skill, price, availability.join(","), sort]);

  const setParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };
  const setCounty = (v: string) => setParam("county", v, "All");
  const setCategory = (v: string) => setParam("category", v, "All");
  const setWhen = (v: WhenFilter) => setParam("when", v, "any");
  const setWhenDate = (v: string) => setParam("whenDate", v, "");
  const setSkill = (v: string) => setParam("skill", v, "any");
  const setPrice = (v: PriceTier) => setParam("price", v, "any");
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

  const countyOptions = useMemo(() => uniqueSorted(games.map((g) => g.county)), [games]);
  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    games.forEach((g) => counts.set(g.activityLabel, (counts.get(g.activityLabel) ?? 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);
  }, [games]);
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
  const effectiveWhen: WhenFilter = when !== "any" ? when : parsedQuery.when ?? "any";

  const filtered = useMemo(() => {
    return games.filter((g) => {
      if (!matchesText(g, parsedQuery.text)) return false;
      if (county !== "All" && g.county !== county) return false;
      if (category !== "All" && g.activityLabel !== category) return false;
      if (!dateWhenMatches(g, effectiveWhen, whenDate)) return false;
      if (skill !== "any" && g.skillLevel && g.skillLevel !== "All levels" && g.skillLevel.toLowerCase() !== skill.toLowerCase()) return false;
      if (price !== "any" && !priceMatches(g, price)) return false;
      if (availability.length && !availability.includes(gameState(g))) return false;
      return true;
    });
  }, [games, parsedQuery, county, category, effectiveWhen, whenDate, skill, price, availability]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => compareGames(a, b, sort)), [filtered, sort]);
  const visibleGames = sorted.slice(0, visibleCount);

  const activeCount =
    [county !== "All", when !== "any", category !== "All", skill !== "any", price !== "any"].filter(Boolean).length + availability.length;

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (county !== "All") chips.push({ key: "county", label: county, onRemove: () => setCounty("All") });
    if (when !== "any") chips.push({ key: "when", label: when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when], onRemove: () => setWhen("any") });
    if (category !== "All") chips.push({ key: "category", label: category, onRemove: () => setCategory("All") });
    availability.forEach((a) => chips.push({ key: `avail-${a}`, label: AVAILABILITY_LABELS[a], onRemove: () => toggleAvailability(a) }));
    if (skill !== "any") chips.push({ key: "skill", label: skill, onRemove: () => setSkill("any") });
    if (price !== "any") chips.push({ key: "price", label: PRICE_LABELS[price], onRemove: () => setPrice("any") });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, when, whenDate, category, availability, skill, price]);

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      const res = await joinGame(id);
      setQuickJoinGame(null);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setMyGameIds((prev) => new Set(prev).add(id));
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't join this game");
    } finally {
      setJoiningId(null);
    }
  };

  const handleWaitlist = async (id: string) => {
    try {
      await joinGameWaitlist(id);
      alert("You're on the waitlist - we'll email you if a spot opens up.");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Couldn't join the waitlist");
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

  const openCreateForm = () => {
    setShowCreateForm(true);
    requestAnimationFrame(() => createFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const handleCreate = async () => {
    setCreateError(null);
    if (!form.activityLabel || !form.date || !form.time || (!form.centreId && !form.locationText)) {
      setCreateError("Fill in an activity, date, time and a venue or location");
      return;
    }
    setCreating(true);
    try {
      await createGame({
        activityLabel: form.activityLabel,
        centreId: form.centreId || undefined,
        locationText: form.centreId ? undefined : form.locationText,
        date: form.date,
        time: form.time,
        capacity: form.capacity,
        priceCents: form.priceCents ? Math.round(parseFloat(form.priceCents) * 100) : undefined,
        soloFriendly: form.soloFriendly,
        skillLevel: form.skillLevel || undefined,
        minParticipants: form.minParticipants ? parseInt(form.minParticipants, 10) : undefined,
        confirmationDeadline: form.minParticipants && form.confirmationDeadline ? new Date(form.confirmationDeadline).toISOString() : undefined,
        description: form.description || undefined,
        durationMinutes: form.durationMinutes ? parseInt(form.durationMinutes, 10) : undefined,
        equipmentNeeded: form.equipmentNeeded || undefined,
        minAge: form.minAge ? parseInt(form.minAge, 10) : undefined,
        surfaceType: form.surfaceType || undefined,
        indoorOutdoor: form.indoorOutdoor || undefined,
        meetingInstructions: form.meetingInstructions || undefined,
        cancellationPolicy: form.cancellationPolicy || undefined,
      });
      setForm({
        activityLabel: "", centreId: "", locationText: "", date: "", time: "", capacity: 4, priceCents: "", soloFriendly: false, skillLevel: "",
        minParticipants: "", confirmationDeadline: "", description: "", durationMinutes: "", equipmentNeeded: "", minAge: "", surfaceType: "",
        indoorOutdoor: "", meetingInstructions: "", cancellationPolicy: "",
      });
      setShowMoreFields(false);
      load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create this game");
    } finally {
      setCreating(false);
    }
  };

  // Closing CTA band's "alive" stat — count of open games in the next 7
  // days, off the unfiltered fetch (not `sorted`/`filtered`), so it reads
  // as "what's out there" regardless of whatever filters are currently applied.
  const upcomingWeekCount = useMemo(
    () => games.filter((g) => g.status !== "cancelled" && dateWhenMatches(g, "next7", "")).length,
    [games]
  );

  const whenSummaryLabel = when === "date" && whenDate ? dateLabel(whenDate) : WHEN_LABELS[when];
  const intentActivityLabel = category !== "All" ? category : parsedQuery.text || "this";

  const filterGroupStyle: CSSProperties = { padding: "16px 0", borderTop: `1px solid ${colors.border}` };
  const filterLabelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: colors.mutedLight, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 };

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

      <div style={{ ...filterGroupStyle, paddingTop: 0 }}>
        <div style={filterLabelStyle}>When</div>
        {(["any", "today", "tonight", "tomorrow", "weekend", "next7"] as WhenFilter[]).map((w) => (
          <DropdownOption key={w} label={WHEN_LABELS[w]} active={when === w} onClick={() => setWhen(w)} />
        ))}
        <DropdownOption label="Pick a date" active={when === "date"} onClick={() => setWhen("date")} />
        {when === "date" && (
          <input type="date" value={whenDate} onChange={(e) => setWhenDate(e.target.value)} style={{ ...inputStyle, marginTop: 4, fontSize: 13, padding: "7px 9px" }} />
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
        <DropdownOption label="Any level" active={skill === "any"} onClick={() => setSkill("any")} />
        {SKILL_LEVELS.filter((s) => s !== "All levels").map((s) => (
          <DropdownOption key={s} label={s} active={skill.toLowerCase() === s.toLowerCase()} onClick={() => setSkill(s)} />
        ))}
      </div>

      <div style={{ ...filterGroupStyle, paddingBottom: 0 }}>
        <div style={filterLabelStyle}>Price</div>
        {(["any", "free", "under10", "10to20", "over20"] as PriceTier[]).map((p) => (
          <DropdownOption key={p} label={PRICE_LABELS[p]} active={price === p} onClick={() => setPrice(p)} />
        ))}
      </div>
    </>
  );

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
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
                {quickJoinGame.priceCents ? `€${(quickJoinGame.priceCents / 100).toFixed(2)} each` : "Free"}
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

      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <PageTitle>Join a game</PageTitle>
            <p style={{ color: colors.mutedLight, fontSize: 15, margin: 0 }}>Find something nearby and jump in.</p>
          </div>
          {resident && (
            <button onClick={openCreateForm} style={{ background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: colors.muted }}>
              Host a game instead →
            </button>
          )}
        </div>

        {/* Search / discovery card — one grouped control (prominent free-text
            field on top, compact location/time refinements below it) rather
            than four equal-weight boxes bolted side by side. */}
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.surface, boxShadow: "0 8px 24px rgba(30,40,32,.05)", padding: 14, marginTop: 24, marginBottom: 16 }}>
          <div style={{ position: "relative" }}>
            <SearchIcon size={17} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: colors.faint }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What do you feel like doing? e.g. Badminton tonight"
              style={{ width: "100%", padding: "8px 8px 8px 36px", border: "none", background: "transparent", fontFamily: fonts.display, fontSize: 16.5, fontWeight: 600, color: colors.text, outline: "none" }}
            />
          </div>
          <div style={{ height: 1, background: colors.border, margin: "10px 0" }} />
          <div className="stack-mobile" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
            >
              <option value="All">Near: anywhere</option>
              {countyOptions.map((c) => (
                <option key={c} value={c}>Near: {c}</option>
              ))}
            </select>
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value as WhenFilter)}
              style={{ padding: "8px 12px", border: "none", borderRadius: 10, fontSize: 13.5, background: colors.panel, color: colors.text, fontWeight: 600 }}
            >
              {(Object.keys(WHEN_LABELS) as WhenFilter[]).map((w) => (
                <option key={w} value={w}>{WHEN_LABELS[w]}</option>
              ))}
            </select>
            <div style={{ marginLeft: "auto" }}>
              <Button onClick={() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Search</Button>
            </div>
          </div>
        </div>

        {/* Quick category chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 20 }}>
          <Chip label="All" active={category === "All"} onClick={() => setCategory("All")} />
          {chipCategories.map((c) => (
            <Chip key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? "All" : c)} />
          ))}
          {overflowCategories.length > 0 && (
            <FilterDropdown label={overflowCategories.includes(category) ? category : "More"} active={overflowCategories.includes(category)}>
              {overflowCategories.map((c) => (
                <DropdownOption key={c} label={c} active={category === c} onClick={() => setCategory(category === c ? "All" : c)} />
              ))}
            </FilterDropdown>
          )}
        </div>
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
                ) : (
                  <>
                    {sorted.length > 0 && (
                      <div style={{ fontSize: 12, color: colors.faint, marginBottom: 2 }}>
                        Showing 1-{Math.min(visibleCount, sorted.length)} of {sorted.length}
                      </div>
                    )}
                    <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, letterSpacing: "-.01em" }}>
                      {sorted.length}{" "}
                      <span style={{ fontFamily: fonts.body, fontWeight: 600, fontSize: 15, color: colors.mutedLight }}>
                        game{sorted.length === 1 ? "" : "s"} & sessions nearby
                      </span>
                    </div>
                  </>
                )}
                <div style={{ fontSize: 13, color: colors.mutedLight, marginTop: 2 }}>
                  {county === "All" ? "Anywhere" : county} · {whenSummaryLabel}
                  {parsedQuery.text && ` for "${parsedQuery.text}"`}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="games-filter-trigger"
                  onClick={() => setFiltersOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1.5px solid ${colors.borderStrong}`, background: "#fff", color: "#3B423C", borderRadius: 20, padding: "8px 14px", fontSize: 14, fontWeight: 600 }}
                >
                  Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                </button>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={{ padding: "9px 12px", border: `1px solid ${colors.inputBorder}`, borderRadius: 10, fontSize: 14, background: colors.bg, color: colors.text, outline: "none", fontWeight: 600 }}
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            </div>

            {!loading && sort === "recommended" && sorted.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(232,163,58,.12)", border: "1px solid rgba(232,163,58,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
                <LightbulbIcon size={16} style={{ color: colors.gold, flex: "none", marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: colors.text }}>Showing the best games you can join right now</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 1 }}>Prioritising games that need more players and starting soon.</div>
                </div>
              </div>
            )}

            {activeChips.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {activeChips.map((c) => (
                  <button
                    key={c.key}
                    onClick={c.onRemove}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: colors.greenBg, color: colors.greenText, border: "none", borderRadius: 20, padding: "5px 10px 5px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
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
              <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
                {Array.from({ length: PAGE_SIZE }, (_, i) => <CardSkeleton key={i} photoHeight={150} />)}
              </div>
            ) : sorted.length === 0 ? (
              <EmptyState
                icon={<UsersIcon size={22} />}
                title={games.length === 0 ? "No open games yet" : "Nothing matching that yet."}
                subtitle={
                  games.length === 0
                    ? "Be the first to start one."
                    : "There may still be people nearby who want to do the same thing."
                }
                action={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <IntentCaptureForm activityLabel={intentActivityLabel} county={county === "All" ? "" : county} />
                    {games.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                        {county !== "All" && <Chip label="Expand to anywhere" active={false} onClick={() => setCounty("All")} />}
                        {when !== "any" && <Chip label="Any time" active={false} onClick={() => setWhen("any")} />}
                        {activeCount > 0 && <Chip label="Clear filters" active={false} onClick={clearAllFilters} />}
                      </div>
                    )}
                  </div>
                }
              />
            ) : (
              <>
                <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
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
                        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  ))}
                </div>
                {visibleCount < sorted.length && (
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
                    <Button variant="ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      Show more ({sorted.length - visibleCount} more)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Closing CTA band — echoes Home.tsx's dark closing band, with the
          Swiss/minimal type treatment from HomeSectionHeader (uppercase,
          letter-spaced eyebrow + tight-tracked display heading) rather than
          the plain <h2>/<p> pair the rest of this page still uses. Sits
          below the results grid so it reads as "still haven't found it?
          here's what else to do" rather than competing with the results. */}
      <section style={{ background: colors.dark }}>
        <div className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "72px 24px 80px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 10 }}>
                Join or host
              </div>
              <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(26px, 3.6vw, 38px)", color: "#fff", margin: "0 0 10px", letterSpacing: "-.02em", lineHeight: 1.1 }}>
                Can't find the right game?
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 16 }}>
                Start one yourself — invite friends or open it up to anyone nearby.
              </p>
              {upcomingWeekCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.15)" }}>
                  <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, color: "#fff", letterSpacing: "-.01em" }}>
                    {upcomingWeekCount}
                  </span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,.55)" }}>
                    game{upcomingWeekCount === 1 ? "" : "s"} happening in the next 7 days
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={resident ? openCreateForm : () => setAuthPromptOpen(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", color: colors.dark, border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                <PlusIcon size={16} /> Start a game
              </button>
              <button
                className="btn"
                onClick={() => navigate("/circles")}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
              >
                Explore Circles instead <ArrowRightIcon size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        {filterPanel}
        <div style={{ marginTop: 20 }}>
          <Button full onClick={() => setFiltersOpen(false)}>Show {sorted.length} result{sorted.length === 1 ? "" : "s"}</Button>
        </div>
      </Drawer>

      <section className="section-pad" ref={createFormRef} style={{ maxWidth: 900, margin: "0 auto", padding: showCreateForm ? "24px 24px 80px" : 0 }}>
        {showCreateForm ? (
          resident ? (
            <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
                <PlusIcon size={16} /> Start a game
              </div>
              <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={labelStyle}>Activity</label>
                  <input value={form.activityLabel} onChange={(e) => setForm((f) => ({ ...f, activityLabel: e.target.value }))} placeholder="e.g. Badminton" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Venue (optional)</label>
                  <select value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))} style={inputStyle}>
                    <option value="">Pick a location instead</option>
                    {centres.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {!form.centreId && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>Location</label>
                    <input value={form.locationText} onChange={(e) => setForm((f) => ({ ...f, locationText: e.target.value }))} placeholder="e.g. Phoenix Park, main gate" style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Time</label>
                  <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Players needed (incl. you)</label>
                  <input type="number" min={2} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: parseInt(e.target.value, 10) || 2 }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Price per player (optional)</label>
                  <input value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: e.target.value }))} placeholder="e.g. 5" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Skill level (optional)</label>
                  <select value={form.skillLevel} onChange={(e) => setForm((f) => ({ ...f, skillLevel: e.target.value }))} style={inputStyle}>
                    <option value="">Any level</option>
                    {SKILL_LEVELS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Minimum to run (optional)</label>
                  <input
                    type="number"
                    min={1}
                    max={form.capacity}
                    value={form.minParticipants}
                    onChange={(e) => setForm((f) => ({ ...f, minParticipants: e.target.value }))}
                    placeholder="e.g. 4"
                    style={inputStyle}
                  />
                </div>
              </div>
              {form.minParticipants && (
                <>
                  <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "8px 0 0" }}>
                    This game stays "pending", but still joinable, until {form.minParticipants} players (including you) have joined.
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <label style={labelStyle}>Confirm by (optional)</label>
                    <input
                      type="datetime-local"
                      value={form.confirmationDeadline}
                      onChange={(e) => setForm((f) => ({ ...f, confirmationDeadline: e.target.value }))}
                      style={{ ...inputStyle, maxWidth: 240 }}
                    />
                    <p style={{ fontSize: 12, color: colors.faint, margin: "4px 0 0" }}>Shown to players as a target - not automatically enforced.</p>
                  </div>
                </>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13.5, color: colors.muted, cursor: "pointer" }}>
                <input type="checkbox" checked={form.soloFriendly} onChange={(e) => setForm((f) => ({ ...f, soloFriendly: e.target.checked }))} />
                Solo friendly - welcome someone who doesn't have a partner or group
              </label>

              {/* Game Detail redesign — everything below feeds the detail
                  page's About/What to bring/Good to know/Location/
                  Cancellation sections. All optional; left blank, those
                  sections simply don't render rather than showing empty
                  placeholders. Collapsed by default so the form doesn't grow
                  from 8 fields to 16 for every host, most of whom just want
                  to post a pickup game quickly. */}
              {!showMoreFields ? (
                <button
                  onClick={() => setShowMoreFields(true)}
                  style={{ background: "none", border: "none", padding: 0, marginTop: 14, color: colors.text, fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                >
                  + Add more detail (optional)
                </button>
              ) : (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>About this plan (optional)</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="What's the pace, format and vibe? e.g. A relaxed, social ride at an easy-to-moderate pace."
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>What to bring (optional)</label>
                    <textarea
                      value={form.equipmentNeeded}
                      onChange={(e) => setForm((f) => ({ ...f, equipmentNeeded: e.target.value }))}
                      placeholder="e.g. Your bike, helmet, water bottle and lights if you have them."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Duration in minutes (optional)</label>
                      <input type="number" min={1} value={form.durationMinutes} onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))} placeholder="e.g. 60" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Minimum age (optional)</label>
                      <input type="number" min={0} value={form.minAge} onChange={(e) => setForm((f) => ({ ...f, minAge: e.target.value }))} placeholder="e.g. 18" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Surface (optional)</label>
                      <input value={form.surfaceType} onChange={(e) => setForm((f) => ({ ...f, surfaceType: e.target.value }))} placeholder="e.g. Road & trail" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Indoor or outdoor (optional)</label>
                      <select value={form.indoorOutdoor} onChange={(e) => setForm((f) => ({ ...f, indoorOutdoor: e.target.value as typeof form.indoorOutdoor }))} style={inputStyle}>
                        <option value="">Not specified</option>
                        <option value="outdoor">Outdoor</option>
                        <option value="indoor">Indoor</option>
                        <option value="mixed">Mixed</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Meeting instructions (optional)</label>
                    <textarea
                      value={form.meetingInstructions}
                      onChange={(e) => setForm((f) => ({ ...f, meetingInstructions: e.target.value }))}
                      placeholder="Exact meeting point — only shown to the host and joined players, e.g. Meet by the north gate, past the car park."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Cancellation policy (optional)</label>
                    <textarea
                      value={form.cancellationPolicy}
                      onChange={(e) => setForm((f) => ({ ...f, cancellationPolicy: e.target.value }))}
                      placeholder="e.g. Free to cancel any time before the day of the plan."
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                  </div>
                </div>
              )}

              {createError && <p style={{ color: colors.danger, fontSize: 13, margin: "12px 0 0" }}>{createError}</p>}
              <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating…" : "Create game"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateForm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 16, padding: "16px 20px", fontSize: 14 }}>
              <button onClick={() => navigate(signInHref())} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, cursor: "pointer" }}>
                Sign in
              </button>{" "}
              to start a game of your own.
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
