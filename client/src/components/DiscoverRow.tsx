import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addFavourite, fetchFavourites, joinGame, joinGameWaitlist, removeFavourite } from "../api";
import { isFavorite, toggleFavorite } from "../favorites";
import { useGuest } from "../GuestContext";
import { AwardIcon, BallIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, HeartIcon, RepeatIcon, UsersIcon } from "./icons";
import { Button } from "./ui";
import { Photo } from "./Photo";
import { colors, fonts } from "../theme";
import type { DiscoverItem } from "../types";

// Photo-driven cards for the homepage "Happening today" / "This weekend"
// feeds (Phase 5) — matches the rest of the app's photography-forward
// style (CentreCard/ClubCard) rather than a plain info box. Games get real
// inline interaction (join, live "going" count); program/club sessions
// don't fabricate data they don't have (see DiscoverItem's comments in
// types.ts) and stay click-through-to-detail only.

const KIND_META: Record<DiscoverItem["kind"], { icon: React.ReactNode; fg: string; ph: string }> = {
  game: { icon: <BallIcon size={22} />, fg: colors.green, ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)" },
  program_session: { icon: <AwardIcon size={22} />, fg: "#3B5FCC", ph: "repeating-linear-gradient(135deg,#D9E6EC 0 14px,#E4EDF1 14px 28px)" },
  club_session: { icon: <RepeatIcon size={22} />, fg: colors.orange, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)" },
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
      {error && <div style={{ fontSize: 11.5, color: "#b00020", marginBottom: 6 }}>{error}</div>}
      <Button style={{ width: "100%", fontSize: 13 }} disabled={joining || full} onClick={handleJoin}>
        {joining ? "Joining…" : full ? "Join waitlist" : "Join now"}
      </Button>
    </div>
  );
}

export function DiscoverCard({ item, isToday }: { item: DiscoverItem; isToday: boolean }) {
  const navigate = useNavigate();
  const { resident } = useGuest();
  const meta = KIND_META[item.kind];
  const place = item.centreName ?? item.clubName;
  const isJoinableGame = item.kind === "game" && item.spotsLeft !== null;
  const [saved, setSaved] = useState(() => isFavorite(item.kind, item.id));

  // Signed-in residents get a real server-side favourite (Phase 6 — the
  // server only covered centre/club until now, matching what
  // client/src/favorites.ts already stored locally for signed-out
  // visitors). Same "fetch the whole list, check one entry" pattern
  // CentreDetail.tsx/ClubDetail.tsx already use.
  useEffect(() => {
    if (resident) fetchFavourites().then((rows) => setSaved(rows.some((r) => r.listingType === item.kind && r.listingId === item.id)));
    else setSaved(isFavorite(item.kind, item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident, item.kind, item.id]);

  const handleToggleSave = async () => {
    if (resident) {
      const next = !saved;
      setSaved(next);
      if (next) await addFavourite(item.kind, item.id);
      else await removeFavourite(item.kind, item.id);
    } else {
      setSaved(toggleFavorite(item.kind, item.id));
    }
  };

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
        borderRadius: 16,
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
        style={{ height: 130 }}
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
                borderRadius: 999,
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
              style={{
                background: "rgba(255,255,255,.94)",
                color: meta.fg,
                borderRadius: 999,
                padding: "4px 9px",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".03em",
              }}
            >
              TODAY
            </span>
          ) : (
            <span style={{ background: "rgba(255,255,255,.94)", color: colors.text, borderRadius: 999, padding: "4px 9px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".02em" }}>
              {dayPillLabel(item.date)}
            </span>
          )}
        </div>
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 11.5,
            fontWeight: 700,
            color: item.priceCents ? colors.text : colors.greenText,
            background: "rgba(255,255,255,.94)",
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          {item.priceCents ? `€${(item.priceCents / 100).toFixed(2)}` : "Free"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleSave();
          }}
          aria-label={saved ? "Remove from saved" : "Save"}
          className="btn"
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: saved ? colors.orange : "#8A928B",
          }}
        >
          <HeartIcon size={15} filled={saved} />
        </button>
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
        {isJoinableGame && (
          <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {!!item.joined && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: colors.mutedLight }}>
                <UsersIcon size={13} /> {item.joined} going
              </div>
            )}
            <JoinControl item={item} />
          </div>
        )}
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
 * prefers-reduced-motion by never auto-advancing at all in that case. */
export function DiscoverRow({ title, items, isToday = false }: { title: string; items: DiscoverItem[]; isToday?: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);

  const scrollToIndex = (i: number) => {
    const clamped = (i + items.length) % items.length;
    scrollerRef.current?.scrollTo({ left: clamped * CARD_STEP, behavior: "smooth" });
    setActiveIndex(clamped);
  };

  useEffect(() => {
    if (paused || userInteracted || items.length <= 1) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => scrollToIndex(activeIndex + 1), AUTO_ADVANCE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, paused, userInteracted, items.length]);

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
        {items.length > 3 && (
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
        {items.map((item) => (
          <DiscoverCard key={`${item.kind}-${item.id}`} item={item} isToday={isToday} />
        ))}
      </div>
      {items.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {items.map((item, i) => (
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
                borderRadius: 999,
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
