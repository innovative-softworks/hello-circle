import { useEffect, useRef, useState } from "react";
import { joinGameConfirm, joinWaitlistConfirm } from "../confirmCopy";
import { isMinAgeRefusal } from "../gameCta";
import { useConfirm } from "./ConfirmProvider";
import { useNavigate } from "react-router-dom";
import { joinGame, joinGameWaitlist } from "../api";
import { useGuest } from "../GuestContext";
import { openCheckout } from "../native";
import { ArrowRightIcon, AwardIcon, CalendarIcon, BallIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, PinIcon, RepeatIcon, TreeIconSmall, UsersIcon } from "./icons";
import { Button } from "./ui";
import { WhyRecommended } from "./WhyRecommended";
import { SaveButton, useSavedState } from "./SaveButton";
import { CardAction, CardArrow, CardAvailability, CardPrice, ListingCard, priceUnitFor, type ListingStatusTone } from "./ListingCard";
import { CardDate, discoverCardLabel } from "./CardDate";
import { FeatureCard, featureFits, type FeatureVariant } from "./FeatureCard";
import { colors, fonts, placeholderStripes, radius, statTile } from "../theme";
import type { ActivitySummary } from "../types";
import { formatDateTime, formatPrice } from "../formatters";
import { centsPriceSignal } from "../priceSignal";

// Photo-driven cards for the homepage "Happening today" / "This weekend"
// feeds (Phase 5), extended in Phase 1 "Connect" to also render Experience/
// Adventure sessions (ActivitySummary's 4th kind) — matches the rest of the
// app's photography-forward style (CentreCard/ClubCard) rather than a plain
// info box. Games get real inline interaction (join, live "going" count);
// every other kind doesn't fabricate data it doesn't have (see
// ActivitySummary's own comments in types.ts) and stays click-through-to-
// detail only. This is the app's one shared card across all four
// ActivitySummary kinds — see server/src/activitySummary.ts's file header
// for the full "why one card" rationale.

const KIND_META: Record<ActivitySummary["kind"], { icon: React.ReactNode; fg: string; ph: string }> = {
  game: { icon: <BallIcon size={22} />, fg: colors.green, ph: placeholderStripes.green },
  program_session: { icon: <AwardIcon size={22} />, fg: statTile.blue.fg, ph: placeholderStripes.blue },
  club_session: { icon: <RepeatIcon size={22} />, fg: colors.orange, ph: placeholderStripes.orange },
  experience_session: { icon: <TreeIconSmall size={22} />, fg: colors.greenText, ph: placeholderStripes.green },
};

/** No-photo card category (Batch 2). */
const KIND_LABEL: Record<ActivitySummary["kind"], string> = { game: "Activity", program_session: "Programme", club_session: "Club session", experience_session: "Experience" };

const KIND_CTA_LABEL: Record<Exclude<ActivitySummary["kind"], "game">, string> = {
  program_session: "View session",
  club_session: "View club",
  experience_session: "View experience",
};

/** DiscoverCard is fed by several different call sites (homepage feeds,
 * search results, Explore's category previews) that all promise an
 * ActivitySummary shape but aren't type-enforced end-to-end (search results
 * come back as `any`-ish JSON, a stale async response can in theory land
 * after its request is no longer current). A `kind` outside the known
 * values used to throw here (`meta.ph` on undefined) and take the whole
 * surrounding panel down with it — this falls back to the "game" tile
 * instead and logs what actually came through, so a real data bug surfaces
 * as a console warning instead of a blank screen. */
function kindMeta(kind: ActivitySummary["kind"]): { icon: React.ReactNode; fg: string; ph: string } {
  const meta = KIND_META[kind];
  if (meta) return meta;
  console.warn(`[DiscoverCard] unexpected item.kind: ${JSON.stringify(kind)} — falling back to "game" styling`);
  return KIND_META.game;
}

function dayPillLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).toUpperCase();
}

function JoinControl({ item }: { item: ActivitySummary }) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [spotsLeft, setSpotsLeft] = useState(item.spotsLeft ?? 0);
  const [joined, setJoined] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  // Reference button strategy: filled for paid, outline for free.
  const paid = !!item.priceCents && item.priceCents > 0;

  if (!resident) {
    return (
      <CardAction look={paid ? "filled" : "outline"} arrow onClick={() => navigate(item.href)} ariaLabel={`Join ${item.title}`}>
        Join
      </CardAction>
    );
  }

  if (joined) {
    return (
      <span className="lc-note" data-tone="good" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <CheckIcon size={14} /> You're in!
      </span>
    );
  }

  if (waitlisted) {
    return (
      <span className="lc-note" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.orangeDark }}>
        <CheckIcon size={14} /> On the waitlist
      </span>
    );
  }

  const full = spotsLeft <= 0;

  const handleJoin = async () => {
    const when = formatDateTime(item.date, item.time);
    if (!(await confirm(full ? joinWaitlistConfirm(item.title) : joinGameConfirm({ title: item.title, when, priceCents: item.priceCents })))) return;
    setJoining(true);
    setError(null);
    try {
      if (full) {
        await joinGameWaitlist(item.id);
        setWaitlisted(true);
        return;
      }
      const res = await joinGame(item.id);
      if (res.url) {
        openCheckout(res.url);
        return;
      }
      setJoined(true);
      setSpotsLeft((s) => Math.max(0, s - 1));
    } catch (e) {
      if (isMinAgeRefusal(e)) return void navigate(`/games/${item.id}`);
      setError(e instanceof Error ? e.message : full ? "Couldn't join the waitlist" : "Couldn't join");
    } finally {
      setJoining(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      {error && <span className="lc-note" data-tone="error" role="alert">{error}</span>}
      <CardAction look={full ? "outline" : paid ? "filled" : "outline"} arrow={!full} busy={joining} busyLabel="Joining…" onClick={handleJoin} ariaLabel={full ? `Join the waitlist for ${item.title}` : `Join ${item.title}`}>
        {full ? "Join waitlist" : "Join"}
      </CardAction>
    </span>
  );
}

export function DiscoverCard({
  item,
  isToday,
  fill = false,
  look,
  category,
}: {
  item: ActivitySummary;
  isToday: boolean;
  /** Fill a results-grid cell instead of the rail's fixed 260px width. */
  fill?: boolean;
  /** A premium style for this section (owner plan, 2026-10-23); falls back
   * to the compact card when the item lacks what the style needs. */
  look?: FeatureVariant;
  /** Real category name (Bold style). */
  category?: string | null;
}) {
  const navigate = useNavigate();
  const meta = kindMeta(item.kind);
  const place = item.centreName ?? item.clubName;
  const isJoinableGame = item.kind === "game" && item.spotsLeft !== null;
  // "Full" only where a real spotsLeft figure exists (today: games only).
  const isFull = item.spotsLeft !== null && item.spotsLeft !== undefined && item.spotsLeft <= 0;
  const matchReasons = item.matchReasons ?? [];
  // Favourite/save is keyed by listing; an experience_session has no
  // correct (kind, id) pair here, so its save button stays hidden. The hook
  // is still called unconditionally (hooks can't be conditional).
  const canSave = item.kind !== "experience_session";
  const [saved, toggleSaved] = useSavedState(item.kind === "experience_session" ? "experience" : item.kind, item.id);

  const href = item.canonicalUrl ?? item.href;
  const open = () => navigate(href);

  const status: { label: string; tone: ListingStatusTone } | null = isFull
    ? { label: "Fully booked", tone: "calm" }
    : item.spotsLeft !== null && item.spotsLeft !== undefined && item.spotsLeft <= 3
      ? { label: "Almost full", tone: "hot" }
      : item.isLive
        ? { label: "Live now", tone: "popular" }
        : isToday
          ? { label: "Today", tone: "new" }
          : null;
  const action = isJoinableGame ? (
    <JoinControl item={item} />
  ) : (
    <CardArrow label={`${item.kind === "game" ? "View" : KIND_CTA_LABEL[item.kind]}: ${item.title}`} onClick={open} />
  );
  const saveButton = canSave ? <SaveButton saved={saved} onToggle={toggleSaved} /> : null;
  const useFeature = !!look && featureFits(look, { image: item.imageUrl, date: item.date, category });
  const wrap = fill ? { display: "grid", minWidth: 0 } : { flex: "none", width: look ? FEATURE_CARD_W : 280, scrollSnapAlign: "start", display: "flex" };

  if (useFeature && look) {
    return (
      <div style={wrap}>
        <FeatureCard
          variant={look}
          data={{
            href,
            title: item.title,
            image: item.imageUrl,
            ph: meta.ph,
            category: look === "bold" ? category : (KIND_LABEL[item.kind] ?? "Activity"),
            status,
            place: place ? `${place}${item.area ? `, ${item.area}` : ""}` : null,
            date: item.date,
            time: item.time,
            durationMinutes: null,
            going: isJoinableGame ? item.joined : null,
            price: centsPriceSignal(item.priceCents) ? "Free" : formatPrice(item.priceCents),
            spotsLeft: isJoinableGame ? item.spotsLeft : null,
          }}
          save={saveButton}
          onOpen={open}
          action={action}
        >
          <WhyRecommended reasons={matchReasons} label={item.fitLabel} />
        </FeatureCard>
      </div>
    );
  }

  // Design-system consistency pass: the shared ListingCard shape — at the
  // row's fixed card width in a rail, or the cell's width in a results grid.
  return (
    <div style={wrap}>
      <ListingCard
        href={href}
        title={item.title}
        image={item.imageUrl}
        ph={meta.ph}
        icon={meta.icon}
        iconColor={meta.fg}
        tag={KIND_LABEL[item.kind] ?? "Activity"}
        fallbackKind={KIND_LABEL[item.kind] ?? null}
        fallbackLine={formatDateTime(item.date, item.time)}
        rowOnPhone={fill}
        status={status}
        dateOn={<CardDate date={item.date} time={item.time} label={discoverCardLabel(item)} href={href} onGo={navigate} />}
        save={saveButton}
        details={[
          { icon: <CalendarIcon size={13} />, text: formatDateTime(item.date, item.time), kind: "date" },
          // One muted line: the place and how many are going (Explore cleanup,
          // owner 2026-10-27), same as the Activities cards.
          place || (isJoinableGame && item.joined)
            ? { icon: <PinIcon size={13} />, text: [place ? `${place}${item.area ? `, ${item.area}` : ""}` : null, isJoinableGame && item.joined ? `${item.joined} going` : null].filter(Boolean).join(" · ") }
            : null,
          item.hostVerified ? { icon: <AwardIcon size={13} />, text: "Verified host" } : null,
        ]}
        going={null}
        facts={
          <>
            <CardPrice cents={item.priceCents} unit={priceUnitFor(item.kind)} />
            {isJoinableGame && <CardAvailability spotsLeft={item.spotsLeft} />}
            {/* "Good fit · Why?" sits on the price row, not a line of its own. */}
            <span className="lc-why">
              <WhyRecommended reasons={matchReasons} label={item.fitLabel} />
            </span>
          </>
        }
        action={action}
      />
    </div>
  );
}

const FEATURE_CARD_W = 320;
const AUTO_ADVANCE_MS = 4500;

/** Renders nothing when `items` is empty — the caller's wrapping <section>
 * still needs to be conditional too if it shouldn't leave a gap. Auto-
 * advances one card at a time, pauses on hover/touch and permanently once
 * the visitor scrolls it manually (an auto-advancing row that fights a
 * mid-drag user is worse than no auto-advance at all), and respects
 * prefers-reduced-motion by never auto-advancing at all in that case.
 *
 * `limit`+`moreHref` (Home.tsx usage) cap the row to a fixed count and
 * append a "View more" card at the end that navigates to the full listing
 * page — without them (Explore.tsx's usage, which IS that full listing
 * page) every item renders and there's nothing to click through to. */
export function DiscoverRow({
  title,
  items,
  isToday = false,
  limit,
  moreHref,
  look,
  layout = "rail",
  subtitle,
}: {
  title: string;
  /** One short line under the title. */
  subtitle?: string;
  items: ActivitySummary[];
  isToday?: boolean;
  limit?: number;
  moreHref?: string;
  /** Premium card style for this row (owner plan, 2026-10-23). */
  look?: FeatureVariant;
  /** "grid" lays the cards out in the results grid instead of a scrolling
   * carousel (owner, 2026-10-23: Explore's "This weekend"). */
  layout?: "rail" | "grid";
}) {
  // Card width + 14px gap — converts scrollLeft <-> card index.
  const CARD_STEP = (look ? FEATURE_CARD_W : 280) + 16;
  const navigate = useNavigate();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const visibleItems = limit && limit > 0 ? items.slice(0, limit) : items;
  const hasMore = !!moreHref && items.length > visibleItems.length;

  const scrollToIndex = (i: number) => {
    const clamped = (i + visibleItems.length) % visibleItems.length;
    scrollerRef.current?.scrollTo({ left: clamped * CARD_STEP, behavior: "smooth" });
    setActiveIndex(clamped);
  };

  // No auto-advance: rows only move when the visitor moves them (Explore
  // cleanup, owner 2026-10-27). `paused`/`userInteracted` stay for the
  // scroll handlers below.
  void paused;
  void userInteracted;

  if (items.length === 0) return null;

  if (layout === "grid") {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: 0, letterSpacing: 0 }}>{title}</h2>
            {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>{subtitle}</p>}
          </div>
          {hasMore && (
            <button type="button" onClick={() => navigate(moreHref!)} className="link-button" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, color: colors.text }}>
              View all ({items.length}) <ArrowRightIcon size={15} />
            </button>
          )}
        </div>
        <div className="listing-grid lc-grid--b">
          {visibleItems.map((item) => (
            <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={isToday} look={look} fill />
          ))}
        </div>
      </>
    );
  }

  // Keeps the dot indicator in sync when the visitor scrolls/drags by hand
  // rather than using the arrows/dots — also what flags "don't auto-advance
  // over a manual scroll in progress."
  const handleScroll = () => {
    if (!scrollerRef.current) return;
    setUserInteracted(true);
    setActiveIndex(Math.round(scrollerRef.current.scrollLeft / CARD_STEP));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: 0, letterSpacing: 0 }}>{title}</h2>
          {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight }}>{subtitle}</p>}
        </div>
        {visibleItems.length > 3 && (
          <div className="hide-mobile" style={{ display: "flex", gap: 8 }}>
            <button onClick={() => scrollToIndex(activeIndex - 1)} aria-label="Previous" className="btn btn-ghost" style={arrowBtnStyle}>
              <ChevronLeftIcon size={16} />
            </button>
            <button onClick={() => scrollToIndex(activeIndex + 1)} aria-label="Next" className="btn btn-ghost" style={arrowBtnStyle}>
              <ChevronRightIcon size={16} />
            </button>
          </div>
        )}
      </div>
      <div
        ref={scrollerRef}
        className="lc-grid--b"
        onScroll={handleScroll}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          scrollSnapType: "x proximity",
          paddingBottom: 4,
          // A soft fade at the right edge hints there's more to scroll,
          // beyond the explicit arrow buttons/dots.
          maskImage: "linear-gradient(to right, black calc(100% - 24px), transparent)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 24px), transparent)",
        }}
      >
        {visibleItems.map((item) => (
          <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={isToday} look={look} />
        ))}
        {hasMore && (
          <button
            onClick={() => navigate(moreHref!)}
            style={{
              flex: "none",
              width: 180,
              scrollSnapAlign: "start",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: colors.surface,
              border: `1px dashed ${colors.borderStrong}`,
              borderRadius: radius.card,
              cursor: "pointer",
              color: colors.text,
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            View more <ArrowRightIcon size={15} />
          </button>
        )}
      </div>
    </>
  );
}

const arrowBtnStyle = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  background: "#fff",
  border: `1px solid ${colors.borderStrong}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: colors.text,
};
