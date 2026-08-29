import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { joinGame, joinGameWaitlist } from "../api";
import { useGuest } from "../GuestContext";
import { ArrowRightIcon, AwardIcon, BallIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, RepeatIcon, UsersIcon } from "./icons";
import { Button } from "./ui";
import { Photo } from "./Photo";
import { SaveButton, useSavedState } from "./SaveButton";
import { cardImageRatio, colors, fonts, placeholderStripes, radius, statTile } from "../theme";
import type { DiscoverItem } from "../types";
import { formatPrice } from "../formatters";

// Photo-driven cards for the homepage "Happening today" / "This weekend"
// feeds (Phase 5) — matches the rest of the app's photography-forward
// style (CentreCard/ClubCard) rather than a plain info box. Games get real
// inline interaction (join, live "going" count); program/club sessions
// don't fabricate data they don't have (see DiscoverItem's comments in
// types.ts) and stay click-through-to-detail only.

const KIND_META: Record<DiscoverItem["kind"], { icon: React.ReactNode; fg: string; ph: string }> = {
  game: { icon: <BallIcon size={22} />, fg: colors.green, ph: placeholderStripes.green },
  program_session: { icon: <AwardIcon size={22} />, fg: statTile.blue.fg, ph: placeholderStripes.blue },
  club_session: { icon: <RepeatIcon size={22} />, fg: colors.orange, ph: placeholderStripes.orange },
};

function dayPillLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" }).toUpperCase();
}

function JoinControl({ item }: { item: DiscoverItem }) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const [spotsLeft, setSpotsLeft] = useState(item.spotsLeft ?? 0);
  const [joined, setJoined] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wraps every branch below — stops a click on the join control from also
  // bubbling up to the card's own onClick (which navigates to item.href).
  // Button's onClick prop takes no event arg, so this has to happen on a
  // wrapping element rather than inside the individual handlers.
  const stopBubble = (e: React.MouseEvent) => e.stopPropagation();

  if (!resident) {
    return (
      <div onClick={stopBubble}>
        <Button variant="ghost" style={{ width: "100%", fontSize: 13 }} onClick={() => navigate(item.href)}>
          Sign in to join
        </Button>
      </div>
    );
  }

  if (joined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0", color: colors.greenText, fontWeight: 700, fontSize: 13 }}>
        <CheckIcon size={14} /> You're in!
      </div>
    );
  }

  if (waitlisted) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0", color: colors.orangeDark, fontWeight: 700, fontSize: 13 }}>
        <CheckIcon size={14} /> On the waitlist
      </div>
    );
  }

  const full = spotsLeft <= 0;

  const handleJoin = async () => {
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
        window.location.href = res.url;
        return;
      }
      setJoined(true);
      setSpotsLeft((s) => Math.max(0, s - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : full ? "Couldn't join the waitlist" : "Couldn't join");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div onClick={stopBubble}>
      {error && <div style={{ fontSize: 11.5, color: colors.danger, marginBottom: 6 }}>{error}</div>}
      <Button style={{ width: "100%", fontSize: 13 }} disabled={joining || full} onClick={handleJoin}>
        {joining ? "Joining…" : full ? "Join waitlist" : "I'm in"}
      </Button>
    </div>
  );
}

export function DiscoverCard({ item, isToday }: { item: DiscoverItem; isToday: boolean }) {
  const navigate = useNavigate();
  const meta = KIND_META[item.kind];
  const place = item.centreName ?? item.clubName;
  const isJoinableGame = item.kind === "game" && item.spotsLeft !== null;
  const [saved, toggleSaved] = useSavedState(item.kind, item.id);

  return (
    <div
      onClick={() => navigate(item.href)}
      className="card-hover card-surface"
      style={{
        flex: "none",
        width: 260,
        scrollSnapAlign: "start",
        background: "#fff",
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        cursor: "pointer",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Photo
        src={item.imageUrl ?? undefined}
        alt={item.title}
        ph={meta.ph}
        icon={meta.icon}
        iconColor={meta.fg}
        style={{ aspectRatio: cardImageRatio.discovery }}
        contentStyle={{ position: "relative" }}
      >
        <div style={{ position: "absolute", top: 10, left: 10 }}>
          {item.isLive ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: colors.dark,
                color: "#fff",
                borderRadius: radius.pill,
                padding: "4px 9px",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".03em",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulseDot 1.6s ease-in-out infinite" }} />
              LIVE
            </span>
          ) : isToday ? (
            <span
              className="card-photo-badge"
              style={{
                background: "rgba(255,255,255,.94)",
                color: meta.fg,
                borderRadius: radius.pill,
                padding: "4px 9px",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".03em",
                transition: "background-color .2s ease, color .2s ease",
              }}
            >
              TODAY
            </span>
          ) : (
            <span className="card-photo-badge" style={{ background: "rgba(255,255,255,.94)", color: colors.text, borderRadius: radius.pill, padding: "4px 9px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".02em", transition: "background-color .2s ease, color .2s ease" }}>
              {dayPillLabel(item.date)}
            </span>
          )}
        </div>
        <span
          className="card-photo-badge"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 11.5,
            fontWeight: 700,
            color: item.priceCents ? colors.text : colors.greenText,
            background: "rgba(255,255,255,.94)",
            borderRadius: radius.pill,
            padding: "4px 10px",
            transition: "background-color .2s ease, color .2s ease",
          }}
        >
          {formatPrice(item.priceCents)}
        </span>
        <SaveButton saved={saved} onToggle={toggleSaved} position="bottom" />
      </Photo>
      <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted }}>{item.time}</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{item.title}</div>
        {place && (
          <div style={{ fontSize: 12.5, color: colors.mutedLight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {place}
            {item.area ? `, ${item.area}` : ""}
          </div>
        )}
        {item.matchReasons.length > 0 && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 8, padding: "3px 8px", marginTop: 2, display: "inline-block", width: "fit-content" }}>
            {item.matchReasons[0]}
          </div>
        )}
        <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {isJoinableGame ? (
            <>
              {!!item.joined && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: colors.mutedLight }}>
                  <UsersIcon size={13} /> {item.joined} going
                </div>
              )}
              <JoinControl item={item} />
            </>
          ) : (
            // Program/club sessions don't have inline join/capacity data
            // (see DiscoverItem's own comments) — the whole card already
            // navigates to item.href on click, but without a visible
            // button here there was no on-card affordance telling the
            // visitor what happens next (landing/'s ActivityCard always
            // pairs a price with an explicit CTA button, never price-only).
            <div onClick={(e) => e.stopPropagation()}>
              <Button variant="dark" style={{ width: "100%", fontSize: 13 }} onClick={() => navigate(item.href)}>
                {item.kind === "program_session" ? "View session" : "View club"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CARD_STEP = 274; // 260px card + 14px gap — used to convert scrollLeft <-> card index
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
}: {
  title: string;
  items: DiscoverItem[];
  isToday?: boolean;
  limit?: number;
  moreHref?: string;
}) {
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

  useEffect(() => {
    if (paused || userInteracted || visibleItems.length <= 1) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => scrollToIndex(activeIndex + 1), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, paused, userInteracted, visibleItems.length]);

  if (items.length === 0) return null;

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
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 20, margin: 0, letterSpacing: "-.01em" }}>{title}</h2>
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
        onScroll={handleScroll}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        style={{
          display: "flex",
          gap: 14,
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
          <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={isToday} />
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
      {visibleItems.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {visibleItems.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              onClick={() => {
                setUserInteracted(true);
                scrollToIndex(i);
              }}
              aria-label={`Go to ${item.title}`}
              style={{
                width: i === activeIndex ? 18 : 6,
                height: 6,
                borderRadius: radius.pill,
                border: "none",
                padding: 0,
                cursor: "pointer",
                background: i === activeIndex ? colors.green : colors.borderStrong,
                transition: "width 0.2s ease, background-color 0.2s ease",
              }}
            />
          ))}
        </div>
      )}
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
