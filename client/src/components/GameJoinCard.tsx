import { Euro } from "lucide-react";
import { BookingActions, BookingFacts, BookingGlance, BookingPrice, directionsHref, IconAction, NextSteps, QuietAction, startsIn, type GlanceItem } from "./BookingFacts";
import { ListingChatButton } from "./ListingChats";
import { Pass, passDate, passTime, type PassTone } from "./pass/Pass";
import { gamePassCode } from "./pass/ScanPassModal";
import { PlanWithCircle } from "./circle/PlanWithCircle";
import { UsersRound } from "lucide-react";
import { irelandToday } from "../irelandDate";
import { liveUntil } from "./CardDate";
import { useToast } from "./Toast";
import { useEffect, useState } from "react";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { leaveWaitlistConfirm } from "../confirmCopy";
import { useConfirm } from "./ConfirmProvider";
import { Link, useNavigate } from "react-router-dom";
import { cancelGame, withdrawGameJoinRequest, downloadGameIcs, fetchGameNotifyMe, fetchGameParticipants, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist, quoteGame, subscribeGameNotifyMe, unsubscribeGameNotifyMe, validateCoupon, type PriceQuote } from "../api";
import { signInHref } from "../authRedirect";
import { openCheckout } from "../native";
import { AwardIcon, CalendarIcon, ChatIcon, CheckIcon, ClockIcon, PinIcon, ShareIcon, ShieldIcon, UsersIcon } from "./icons";
import { InviteSheetButton } from "./InviteSheetButton";
import { ShareButton } from "./ShareButton";
import { TextInput } from "./form";
import { Avatar, Button, Card, ConfirmDialog, inputStyle, labelStyle } from "./ui";
import { dateLabel } from "../euro";
import { colors, fonts, radius } from "../theme";
import type { Game, Resident } from "../types";
import { formatDuration, formatPrice } from "../formatters";
import { PAID_PRICE_NOTE } from "./detail/KeyFacts";

// The join CTA state machine (Game Detail redesign §19/§20) — one function
// so the desktop sticky card and the mobile bottom bar can never disagree
// about what state a game/resident pair is in.
//
// Universal Publishing, Lifecycle & Availability System, §7/§35/§36 —
// "coming-soon" added: a non-host viewer of a Coming Soon activity gets
// "Notify me" instead of any of the normal join/waitlist CTAs, regardless
// of signed-in state (the Notify Me button itself routes a signed-out
// click through signInHref, same pattern "available"/"full" already use
// for join/waitlist). Checked *after* isHost so a host previewing/managing
// their own Coming Soon activity still gets the normal "host" controls
// (e.g. Cancel) here — the host's own publishing controls (open now/pause/
// edit schedule) live in Manage, not this public-facing card.
type JoinState = "cancelled" | "ended" | "host" | "coming-soon" | "signed-out" | "joined" | "requested" | "declined" | "closed" | "waitlisted" | "full" | "available";

function computeState(game: Game, resident: Resident | null, isHost: boolean): JoinState {
  if (game.status === "cancelled") return "cancelled";
  if (isHost) return "host";
  // DP-01 (detail-page audit) — a past activity is not joinable (the server
  // refuses it as "completed"), so it must not show spots or a join button.
  if (game.effectiveLifecycle === "completed" && !game.joinedByMe) return "ended";
  if (game.effectiveLifecycle === "coming_soon") return "coming-soon";
  if (!resident) return "signed-out";
  if (game.joinedByMe) return "joined";
  // OG-27 — approval activities: a sent request, or one the host declined.
  if (game.joinRequestByMe === "requested") return "requested";
  if (game.joinRequestByMe === "declined" && game.joinMode === "approval") return "declined";
  // OG-27 — the host closed bookings (or a booking cut-off passed).
  if (game.effectiveLifecycle === "paused") return "closed";
  if (game.spotsLeft === 0) return game.waitlistedByMe ? "waitlisted" : "full";
  return "available";
}

// Detail-page redesign — the label names the action ("Join activity",
// "Request to join"); the list cards keep their short "Join" / "I'm in".
function ctaLabel(game: Game, state: JoinState): string {
  if (state === "available") return game.joinMode === "approval" && !game.priceCents ? "Request to join" : "Join activity";
  if (state === "full") return "Join waitlist";
  return "";
}

function gameSignInContext(game: Game) {
  return {
    kind: "game" as const,
    title: game.activityLabel,
    meta: `${dateLabel(game.date)} · ${game.time} · ${game.centreName ?? game.locationText}`,
    badge: game.spotsLeft === 0 ? "Full" : game.spotsLeft === 1 ? "1 spot left" : `${game.spotsLeft} spots left`,
  };
}

/** "Notify me" on a Coming Soon activity — shared by the card and the mobile
 * bar. Loads the real subscription for a signed-in resident (sitemap audit
 * P2-09: it used to live only in page state, so after a reload there was no
 * sign you'd subscribed and no way to stop), and can unsubscribe. */
function useGameNotifyMe(gameId: string, resident: Resident | null, active: boolean) {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!resident || !active) return;
    let live = true;
    fetchGameNotifyMe(gameId)
      .then((r) => live && setSubscribed(r.subscribed))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameId, resident, active]);
  const run = async (fn: () => Promise<unknown>, next: boolean, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setSubscribed(next);
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return {
    subscribed,
    busy,
    error,
    subscribe: () => run(() => subscribeGameNotifyMe(gameId), true, "Couldn't set up the notification — try again."),
    unsubscribe: () => run(() => unsubscribeGameNotifyMe(gameId), false, "Couldn't turn the notification off — try again."),
  };
}

interface JoinCardProps {
  game: Game;
  resident: Resident | null;
  isHost: boolean;
  onRefresh: () => void;
}

// Compact recap line shared by the confirm modal and the (rare) inline
// error state — date/time, venue, headcount, price, in that order, matching
// the spec's own §21 confirmation-sheet layout.
/** Booking UX Phase 4 (B9) — an activity with a minimum age needs the
 * joiner's confirmation; the server refuses the join without it. */
function MinAgeConfirm({ minAge, checked, onChange }: { minAge: number; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45, minHeight: 44, marginTop: 12, cursor: "pointer", textAlign: "left" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, margin: "1px 0 0", flex: "none" }} />
      <span>I'm at least {minAge}</span>
    </label>
  );
}

function PlanRecap({ game, couponCode }: { game: Game; couponCode?: string | null }) {
  // HC-QA-047 — a paid join's confirmation shows the server's own total
  // (VAT + platform fee), not just the per-player listing price.
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  useEffect(() => {
    if (!game.priceCents) return;
    let live = true;
    quoteGame(game.id, couponCode).then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [game.id, game.priceCents, couponCode]);
  return (
    <div>
      <div style={{ fontWeight: 700, color: colors.text, marginBottom: 4 }}>{game.activityLabel}</div>
      <div>{dateLabel(game.date)} · {game.time}</div>
      <div style={{ margin: "4px 0" }}>{game.centreName ?? game.locationText}</div>
      <div>{game.joined}/{game.capacity} joined</div>
      <div style={{ fontWeight: 700, color: game.priceCents ? colors.text : colors.greenText }}>
        {formatPrice(game.priceCents, { each: true })}
      </div>
      {!!game.priceCents && (
        <div data-qa="game-quote-total" style={{ fontWeight: 800, marginTop: 4 }}>
          {quote ? `Total today €${(quote.totalCents / 100).toFixed(2)} (incl. VAT €${(quote.vatCents / 100).toFixed(2)} + fee €${(quote.platformFeeCents / 100).toFixed(2)})` : "Calculating total…"}
        </div>
      )}
    </div>
  );
}

// Vendor-parity pass, Phase 25 — a host can scope a coupon to one priced
// session (games.ts's POST /coupons). The preview passes this game as listing
// context so a code for another session is rejected here too; the join call
// below still re-validates (never-trust-the-preview, same as BookingFlow.tsx).
function GameCouponField({ gameId, subtotalCents, onApplied }: { gameId: string; subtotalCents: number; onApplied: (code: string | null) => void }) {
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; discountCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const apply = async () => {
    if (!input.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const res = await validateCoupon(input.trim(), subtotalCents, { listingType: "game", listingId: gameId });
      setApplied({ code: res.code, discountCents: res.discountCents });
      onApplied(res.code);
    } catch (e) {
      setApplied(null);
      onApplied(null);
      setError(e instanceof Error ? e.message : "Couldn't apply that code");
    } finally {
      setChecking(false);
    }
  };

  const remove = () => {
    setApplied(null);
    setInput("");
    setError(null);
    onApplied(null);
  };

  return (
    <div style={{ marginTop: 12, textAlign: "left" }}>
      <label style={labelStyle}>Coupon code (optional)</label>
      {applied ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, color: colors.greenText }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <CheckIcon size={13} /> {applied.code} applied — €{(applied.discountCents / 100).toFixed(2)} off
          </span>
          <button onClick={remove} aria-label="Remove code" style={{ background: "none", border: "none", cursor: "pointer", color: colors.greenText, fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="e.g. SUMMER10" style={{ ...inputStyle, flex: 1 }} />
          <Button variant="ghost" onClick={apply} disabled={checking || !input.trim()} style={{ flex: "none" }}>{checking ? "Checking…" : "Apply"}</Button>
        </div>
      )}
      {error && <p style={{ color: colors.danger, fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}

// Urgency-first headline (§19) — the strongest thing in the card is
// availability, not the plan name (the title's already right above the
// hero). "pending_participants" gets its own copy ("Needs players") rather
// than a spot count, matching the same distinction MobileJoinBar already
// draws. Orange is reserved for genuinely low availability (<=3 spots) —
// per §7's "use orange for genuine urgency", a game with 6 spots open
// doesn't get the same alarm treatment as one with 1.
function JoinHeadline({ game, state }: { game: Game; state: JoinState }) {
  const h2Style: React.CSSProperties = { fontFamily: fonts.display, fontWeight: 800, fontSize: 22, margin: 0 };
  const subStyle: React.CSSProperties = { margin: "4px 0 0", fontSize: 13.5, color: colors.mutedLight };

  if (state === "cancelled") {
    return <h2 style={{ ...h2Style, color: colors.danger }}>Cancelled</h2>;
  }
  if (state === "ended") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.muted }}>This has ended</h2>
        <p style={subStyle}>It took place on {dateLabel(game.date)} at {game.time}.</p>
      </>
    );
  }
  const countdown = startsIn(game.date, game.time);
  if (state === "joined") {
    return (
      <>
        <h2 className="pop-in" style={{ ...h2Style, color: colors.greenText, display: "flex", alignItems: "center", gap: 6 }}>
          You're going <CheckIcon size={16} />
        </h2>
        {countdown && <p style={subStyle}>{countdown}</p>}
      </>
    );
  }
  if (state === "waitlisted") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.muted }}>On the waitlist</h2>
        <p style={subStyle}>We'll let you know if a place opens.</p>
      </>
    );
  }
  if (state === "requested") {
    return (
      <>
        <h2 style={h2Style}>Request sent</h2>
        <p style={subStyle}>The host approves each person for this activity. We'll let you know when they reply.</p>
      </>
    );
  }
  if (state === "declined") {
    return (
      <>
        <h2 style={h2Style}>Not this time</h2>
        <p style={subStyle}>The host couldn't take you for this activity.</p>
      </>
    );
  }
  if (state === "closed") {
    return (
      <>
        <h2 style={h2Style}>Bookings closed</h2>
        <p style={subStyle}>The host isn't taking new people for this one.</p>
      </>
    );
  }
  if (state === "host") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.greenText }}>You're hosting</h2>
        <p style={subStyle}>{[countdown, game.spotsLeft > 0 ? `${game.spotsLeft} left` : "Full"].filter(Boolean).join(" · ")}</p>
      </>
    );
  }
  if (state === "coming-soon") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.orangeDark }}>Coming soon</h2>
        <p style={subStyle}>Bookings aren't open yet — we'll let you know the moment they are.</p>
      </>
    );
  }
  if (state === "full") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.muted }}>Fully booked</h2>
        <p style={subStyle}>{countdown ? `${countdown} · ` : ""}join the waitlist and we'll tell you if a place opens.</p>
      </>
    );
  }
  if (game.status === "pending_participants") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.orangeDark }}>Needs players</h2>
        <p style={subStyle}>{countdown ? `${countdown} · ` : ""}still filling up, you can join while it does.</p>
      </>
    );
  }
  const urgent = game.spotsLeft <= 3;
  const label = game.spotsLeft === 1 ? "1 spot left" : urgent ? `${game.spotsLeft} spots left` : `${game.spotsLeft} spots available`;
  return (
    <>
      <h2 style={{ ...h2Style, color: urgent ? colors.orangeDark : colors.text }}>{label}</h2>
      {countdown && <p style={{ ...subStyle, fontWeight: urgent ? 700 : 400, color: urgent ? colors.orangeDark : subStyle.color }}>{countdown}</p>}
    </>
  );
}

/** Desktop sticky rail card — also the mobile in-page card once the layout
 * collapses to one column (MobileJoinBar below covers the "always visible"
 * requirement instead of reordering the page). */
export function GameJoinCard({ game, resident, isHost, onRefresh }: JoinCardProps) {
  const paidOpen = usePaidCheckoutOpen();
  // Commercial release gate — a paid join can't start while paid checkout is closed (the server refuses it too).
  const paidClosed = paidOpen === false && !!game.priceCents;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [justJoined, setJustJoined] = useState(false);
  const [participants, setParticipants] = useState<{ residentId: string; name: string }[]>([]);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [ageOk, setAgeOk] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [undoOpen, setUndoOpen] = useState(false);
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [invited, setInvited] = useState(false);
  const toast = useToast();
  // The "Undo" after a one-tap join stays for 10 seconds.
  useEffect(() => {
    if (!undoOpen) return;
    const t = window.setTimeout(() => setUndoOpen(false), 10_000);
    return () => window.clearTimeout(t);
  }, [undoOpen]);

  const state = computeState(game, resident, isHost);
  const notify = useGameNotifyMe(game.id, resident, state === "coming-soon");
  const handleNotifyMe = () => {
    if (!resident) return navigate(signInHref(gameSignInContext(game)));
    void notify.subscribe();
  };
  const isPast = new Date(`${game.date}T${game.time}:00`).getTime() < Date.now();

  useEffect(() => {
    fetchGameParticipants(game.id)
      .then((r) => setParticipants(r.participants))
      .catch(() => {});
    // Re-read after a join / leave / undo so the faces match the count.
  }, [game.id, game.joined]);

  const run = async (fn: () => Promise<unknown>, onSuccess?: () => void) => {
    setError(null);
    setBusy(true);
    try {
      const res = (await fn()) as { url?: string } | undefined;
      if (res?.url) {
        openCheckout(res.url);
        return;
      }
      onRefresh();
      onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmJoin = () => {
    let requested = false;
    run(
      () =>
        joinGame(game.id, couponCode ?? undefined, game.minAge ? ageOk : undefined, requestNote.trim() || undefined).then((r) => {
          requested = !!r.requested;
          return r;
        }),
      () => {
        setConfirmOpen(false);
        setCouponCode(null);
        setRequestNote("");
        if (!game.priceCents && !requested) setJustJoined(true);
      }
    );
  };

  const handleConfirmCancel = () => {
    run(() => cancelGame(game.id, cancelReason || undefined), () => setCancelConfirmOpen(false));
  };

  // One tap for a free, open activity (owner 2026-10-27): no confirm step,
  // "Undo" for a few seconds instead. Paid, approval and age-checked joins
  // keep the confirm dialog (it shows the total / the note / the age check).
  const oneTap = !game.priceCents && game.joinMode !== "approval" && !game.minAge;
  const startJoin = () => {
    if (!oneTap) return setConfirmOpen(true);
    run(
      () => joinGame(game.id),
      () => {
        setJustJoined(true);
        setUndoOpen(true);
        toast.success(`You're in: ${game.activityLabel}`);
      }
    );
  };
  const undoJoin = () =>
    run(
      () => leaveGame(game.id),
      () => {
        setJustJoined(false);
        setUndoOpen(false);
        setCalendarAdded(false);
        setInvited(false);
      }
    );
  const addToCalendar = () => {
    downloadGameIcs(game.id);
    setCalendarAdded(true);
  };

  // Overflow is relative to the 4-avatar cap below, not the full fetched
  // list — GameParticipants.tsx shows everyone with no cap, but this card
  // only ever shows up to 4 (a real bug caught here: comparing against the
  // full list length instead of the shown-count undercounted the "+N").
  const shownCount = Math.min(participants.length, 4);
  const overflow = Math.max(0, game.joined - shownCount);
  const place = game.centreName ?? game.locationText;
  const going = state === "joined";
  const notOver = state !== "cancelled" && state !== "ended" && !isPast;
  // Who's coming, beyond the count: people you've played with, else first-timers.
  const company = game.familiarCount
    ? `${game.familiarCount} ${game.familiarCount === 1 ? "person" : "people"} you know`
    : game.firstTimerCount
    ? `${game.firstTimerCount} first-timer${game.firstTimerCount === 1 ? "" : "s"}`
    : null;

  // At a glance (owner 2026-10-27) — only lines the host actually filled in,
  // plus cancellation (the separate "Cancellation & updates" card is gone).
  const glance: GlanceItem[] = [];
  if (game.soloFriendly && !going) glance.push({ key: "solo", icon: <UsersIcon size={16} />, value: "Good for coming alone", sub: "people often come on their own" });
  if (game.durationMinutes || game.skillLevel)
    glance.push({
      key: "length",
      icon: game.durationMinutes ? <ClockIcon size={16} /> : <AwardIcon size={16} />,
      value: game.durationMinutes ? formatDuration(game.durationMinutes) : game.skillLevel,
      sub: game.durationMinutes ? game.skillLevel || undefined : undefined,
    });
  if (game.equipmentNeeded) glance.push({ key: "bring", icon: <ShieldIcon size={16} />, value: "Bring", sub: game.equipmentNeeded });
  if (state !== "host" && notOver) glance.push({ key: "cancel", icon: <CalendarIcon size={16} />, value: "Cancellation", sub: game.cancellationPolicy || "plans can change, check here before you go" });

  const shareIcon = <ShareButton key="share" entityType="game" entityId={game.id} render={(open) => <IconAction label="Share" onClick={open}><ShareIcon size={18} /></IconAction>} />;
  const inviteIcon = (
    <InviteSheetButton
      key="invite"
      entityType="game"
      entityId={game.id}
      title={game.activityLabel}
      render={(open) => (
        <IconAction label="Invite someone" short="Invite" onClick={() => { setInvited(true); open(); }}>
          <UsersIcon size={18} />
        </IconAction>
      )}
    />
  );
  const calendarIcon = (
    <IconAction key="cal" label={calendarAdded ? "Added to calendar, download again" : "Add to calendar"} short={calendarAdded ? "Added" : "Calendar"} done={calendarAdded} onClick={addToCalendar}>
      {calendarAdded ? <CheckIcon size={18} /> : <CalendarIcon size={18} />}
    </IconAction>
  );
  const chatIcon = (
    <ListingChatButton
      key="chat"
      scopeType="game"
      listingId={game.id}
      refreshKey={game.joinedByMe}
      render={(open, unread) => (
        <IconAction label={unread ? `Group chat, ${unread} unread` : "Group chat"} short={unread ? `Chat (${unread})` : "Chat"} onClick={open}>
          <ChatIcon size={18} />
        </IconAction>
      )}
    />
  );
  const directionsIcon = (
    <IconAction key="dir" label="Directions" href={directionsHref([place, game.area, game.county].filter(Boolean).join(", "))}>
      <PinIcon size={18} />
    </IconAction>
  );
  // Circles 3.0 — suggest a public activity in a Circle (a Circle's own
  // private activity is already in its Circle).
  const circleIcon = game.visibility === "public" ? (
    <PlanWithCircle
      key="circle"
      listing={{ type: "game", id: game.id, title: game.activityLabel }}
      render={(open) => (
        <IconAction label="Plan with my Circle" short="Circle" onClick={open}>
          <UsersRound size={18} />
        </IconAction>
      )}
    />
  ) : null;
  const icons = !notOver
    ? []
    : state === "host"
    ? [inviteIcon, shareIcon, chatIcon, directionsIcon]
    : going
    ? [calendarIcon, chatIcon, directionsIcon, inviteIcon, shareIcon]
    : state === "waitlisted" || state === "requested"
    ? [shareIcon, calendarIcon]
    : state === "full"
    ? [shareIcon, inviteIcon, circleIcon]
    : [shareIcon, inviteIcon, calendarIcon, circleIcon];

  // The pass (owner 2026-10-27): once you're in — or waiting, or hosting —
  // the box becomes the pass you show up with. Wallet look; a Circle's own
  // meetup uses the lanyard look (your name first, like at the door).
  const today = game.date === irelandToday();
  const onNow = !!liveUntil(game.date, game.time, game.durationMinutes);
  const joinedCancelled = state === "cancelled" && game.joinedByMe;
  const passState = joinedCancelled ? "cancelled" : going || state === "waitlisted" || state === "requested" || state === "host" ? state : null;
  let passView: React.ReactNode = null;
  if (passState) {
    const review = going && !!game.myJoin?.paymentReview;
    const ended = going && isPast && !onNow;
    const tone: PassTone = joinedCancelled
      ? "bad"
      : review
      ? "warn"
      : state === "host"
      ? "host"
      : state === "waitlisted" || state === "requested"
      ? "wait"
      : ended
      ? "ended"
      : onNow || today
      ? "live"
      : "ok";
    const status = joinedCancelled
      ? "Cancelled by the host"
      : review
      ? "Payment being checked"
      : state === "host"
      ? game.circleId ? "You're organising" : "You're hosting"
      : state === "waitlisted"
      ? "On the waitlist"
      : state === "requested"
      ? "Request sent"
      : game.checkedInAt
      ? "Checked in"
      : ended
      ? "Ended"
      : onNow
      ? `Happening now · until ${liveUntil(game.date, game.time, game.durationMinutes)}`
      : today
      ? "Today · check in when you arrive"
      : "You're going";
    const passFields: [string, React.ReactNode][] = [];
    if (state === "host") {
      passFields.push(["Going", `${game.joined} of ${game.capacity}`], ["Spots left", game.spotsLeft > 0 ? String(game.spotsLeft) : "Full"]);
    } else {
      passFields.push([game.circleId ? "Organiser" : "Host", game.hostName], ["Going", `${game.joined} of ${game.capacity}`]);
      if (game.myJoin && !review && game.priceCents) passFields.push(["Paid", formatPrice(game.priceCents)]);
      if (game.equipmentNeeded && !joinedCancelled) passFields.push(["Bring", game.equipmentNeeded]);
    }
    const note = joinedCancelled
      ? game.priceCents ? "This activity isn't happening. If you paid, the host or our team will sort your refund." : "This activity isn't happening. Nothing to pay."
      : review
      ? "We received your payment and are checking it. This isn't booked yet. Please don't pay again."
      : state === "waitlisted"
      ? "We'll tell you as soon as a place opens."
      : state === "requested"
      ? "The host approves each person. We'll tell you when they reply."
      : going && game.meetingInstructions && !ended
      ? <>Meeting point: {game.meetingInstructions}</>
      : null;
    const stamp = game.checkedInAt ? `In · ${new Date(game.checkedInAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" })}` : null;
    passView = (
      <Pass
        look={game.circleId ? "lanyard" : "wallet"}
        kind={game.circleId ? "circle" : "activity"}
        tone={tone}
        status={status}
        title={game.activityLabel}
        whoLabel={state === "host" ? (game.circleId ? "Organiser" : "Host") : "Admit"}
        who={resident?.name || null}
        date={passDate(game.date)}
        time={passTime(game.time, game.durationMinutes)}
        where={place}
        fields={passFields.slice(0, 4)}
        note={note}
        reference={going ? game.myJoin?.ref ?? null : null}
        // Every going pass has a code the host can scan (free joins too).
        code={going && resident && !ended ? gamePassCode(game.id, resident.id) : null}
        codeActive={!review}
        listLine={
          going
            ? { title: "On the list", text: today || onNow ? "Check yourself in when you arrive" : "Your name is on the host's list" }
            : state === "host"
            ? { title: `${game.joined} / ${game.capacity}`, text: "going so far" }
            : { title: "No pass yet", text: "It appears here once you're in" }
        }
        stamp={stamp}
      >
        {going && undoOpen && (
          <div className="booking-undo" role="status">
            <span>You're in</span>
            <button type="button" onClick={undoJoin} disabled={busy}>Undo</button>
          </div>
        )}
        {going && justJoined && (
          <NextSteps
            steps={[
              { key: "booked", label: "Your place is booked", done: true },
              { key: "cal", label: "Add it to your calendar", done: calendarAdded },
              { key: "invite", label: "Bring a friend along", done: invited },
            ]}
          />
        )}
        {error && <p role="alert" style={{ color: colors.danger, fontSize: 13.5, margin: 0 }}>{error}</p>}
        {icons.length > 0 && <BookingActions>{icons}</BookingActions>}
        {going && !isPast && <QuietAction onClick={() => setLeaveConfirmOpen(true)} disabled={busy}>Can't make it? Leave this activity</QuietAction>}
        {state === "waitlisted" && (
          <QuietAction
            onClick={async () => {
              if (await confirm(leaveWaitlistConfirm(game.activityLabel))) run(() => leaveGameWaitlist(game.id));
            }}
            disabled={busy}
          >
            Leave the waitlist
          </QuietAction>
        )}
        {state === "requested" && (
          <QuietAction
            onClick={async () => {
              if (await confirm({ title: "Withdraw your request?", message: "The host won't see it any more. You can ask again later.", confirmLabel: "Withdraw request", cancelLabel: "Keep it" })) run(() => withdrawGameJoinRequest(game.id));
            }}
            disabled={busy}
          >
            Withdraw request
          </QuietAction>
        )}
        {state === "host" && !isPast && <QuietAction onClick={() => setCancelConfirmOpen(true)} disabled={busy}>Cancel this session</QuietAction>}
        {joinedCancelled && (
          <Button full variant="ghost" onClick={() => navigate(`/games?activity=${encodeURIComponent(game.activityLabel)}`)}>Find another time</Button>
        )}
      </Pass>
    );
  }

  return (
    <>
      {passView ?? <Card>
        <div style={{ marginBottom: 16 }}>
          <JoinHeadline game={game} state={state} />
        </div>


        {participants.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {participants.slice(0, 4).map((p, i) => (
                <div key={p.residentId} style={{ marginLeft: i === 0 ? 0 : -8, border: `2px solid ${colors.surface}`, borderRadius: "50%" }}>
                  <Avatar name={p.name} size={30} />
                </div>
              ))}
              {overflow > 0 && (
                <div style={{ marginLeft: -8, width: 30, height: 30, borderRadius: "50%", border: `2px solid ${colors.surface}`, background: colors.panel, color: colors.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flex: "none" }}>
                  +{overflow}
                </div>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: colors.mutedLight }}>
              {game.joined} of {game.capacity} going{company ? <> · <b style={{ color: colors.text }}>{company}</b></> : null}
            </span>
          </div>
        )}

        <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

        <BookingGlance items={glance} />
        <BookingFacts
          // Date and place live under the title (owner 2026-10-27, booking box
          // option 2); the box keeps what helps you act: places, people, price.
          facts={[
            {
              key: "price",
              label: "Price",
              icon: <Euro size={18} strokeWidth={2} />,
              value: <BookingPrice cents={game.priceCents} unit="per person" />,
              sub: game.priceCents ? PAID_PRICE_NOTE : undefined,
              emphasis: game.priceCents ? "price" : "free",
            },
          ]}
          footnote={participants.length === 0 ? <><UsersIcon size={14} style={{ verticalAlign: "-2px" }} /> {game.joined} of {game.capacity} going{game.spotsLeft > 0 ? ` · ${game.spotsLeft} left` : ""}</> : undefined}
        />

        {error && <p role="alert" style={{ color: colors.danger, fontSize: 13.5, margin: "0 0 12px" }}>{error}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state === "cancelled" && (
            <div style={{ fontWeight: 700, fontSize: 14, color: colors.danger, background: colors.dangerBg, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
              This activity is no longer happening.
            </div>
          )}
          {/* DP-34 — a cancelled activity offers the next step in the panel itself. */}
          {state === "cancelled" && (
            <Button full onClick={() => navigate(`/games?activity=${encodeURIComponent(game.activityLabel)}`)}>Find another time</Button>
          )}
          {state === "ended" && (
            <Button full onClick={() => navigate(game.otherDates?.length ? `/games/${game.otherDates[0].id}` : `/games?activity=${encodeURIComponent(game.activityLabel)}`)}>
              {game.otherDates?.length ? "Go to the next date" : "See upcoming dates"}
            </Button>
          )}
          {state === "coming-soon" &&
            (notify.subscribed ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "9px 0", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: colors.greenText, fontWeight: 700, fontSize: 13 }}>
                  <CheckIcon size={14} /> We'll let you know
                </span>
                <button
                  onClick={() => void notify.unsubscribe()}
                  disabled={notify.busy}
                  style={{ background: "none", border: "none", padding: "4px 2px", fontSize: 13, fontWeight: 600, color: colors.muted, textDecoration: "underline", cursor: "pointer" }}
                >
                  {notify.busy ? "Turning off…" : "Stop notifications"}
                </button>
              </div>
            ) : (
              <Button full onClick={handleNotifyMe} disabled={notify.busy}>
                {notify.busy ? "Setting up…" : "Notify me"}
              </Button>
            ))}
          {state === "coming-soon" && notify.error && <p role="alert" style={{ margin: 0, fontSize: 13, color: colors.danger }}>{notify.error}</p>}
          {state === "signed-out" && (
            <Button full onClick={() => navigate(signInHref(gameSignInContext(game)))}>{game.spotsLeft === 0 ? "Sign in to join the waitlist" : "Sign in to join"}</Button>
          )}
          {state === "full" && (
            <Button variant="orange" full onClick={() => run(() => joinGameWaitlist(game.id))} disabled={busy}>Join the waitlist</Button>
          )}
          {state === "available" && (
            <Button full onClick={startJoin} disabled={busy}>{busy ? "Joining…" : ctaLabel(game, state)}</Button>
          )}
          {(state === "available" || state === "signed-out") && !game.priceCents && (
            <div style={{ textAlign: "center", fontSize: 12, color: colors.faint }}>{oneTap && state === "available" ? "Free · one tap, you can undo" : "No payment required"}</div>
          )}
          {icons.length > 0 && <BookingActions>{icons}</BookingActions>}
        </div>


        {/* DP-15 — other dates of the same repeating activity. */}
        {!!game.otherDates?.length && state !== "host" && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
            <h3 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 14, margin: "0 0 8px" }}>Other dates</h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {game.otherDates.slice(0, 4).map((d) => (
                <li key={d.id}>
                  <Link to={`/games/${d.id}`} className="tap-target" style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", fontSize: 13.5, color: colors.text, textDecoration: "none", padding: "6px 0" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarIcon size={14} /> {dateLabel(d.date)} · {d.time}</span>
                    <span style={{ color: d.spotsLeft === 0 ? colors.muted : colors.greenText, fontWeight: 600 }}>
                      {d.spotsLeft === 0 ? "Full" : d.spotsLeft === null ? "Open" : `${d.spotsLeft} left`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>}

      <ConfirmDialog
        open={confirmOpen}
        title={game.joinMode === "approval" && !game.priceCents ? `Ask to join ${game.activityLabel}?` : `Join ${game.activityLabel}?`}
        message={
          <>
            <PlanRecap game={game} couponCode={couponCode} />
            {!!game.priceCents && <GameCouponField gameId={game.id} subtotalCents={game.priceCents} onApplied={setCouponCode} />}
            {!!game.minAge && <MinAgeConfirm minAge={game.minAge} checked={ageOk} onChange={setAgeOk} />}
            {game.joinMode === "approval" && !game.priceCents && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor="join-request-note" style={labelStyle}>
                  Note to the host (optional)
                </label>
                <textarea id="join-request-note" rows={2} maxLength={500} value={requestNote} onChange={(e) => setRequestNote(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: colors.mutedLight }}>The host approves each person. You're not in until they do.</p>
              </div>
            )}
            {paidClosed && <p role="status" style={{ margin: "10px 0 0", fontSize: 13.5, fontWeight: 600, color: colors.orangeDark }}>{PAID_CLOSED_MESSAGE}</p>}
          </>
        }
        confirmLabel={game.priceCents ? "Continue to payment" : game.joinMode === "approval" ? "Send request" : "Confirm I'm in"}
        cancelLabel="Cancel"
        tone="neutral"
        busy={busy}
        confirmDisabled={(!!game.minAge && !ageOk) || paidClosed}
        onConfirm={handleConfirmJoin}
        onCancel={() => {
          setConfirmOpen(false);
          setCouponCode(null);
        }}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title={`Cancel ${game.activityLabel}?`}
        message={game.joined > 0 ? `Everyone who joined (${game.joined}) will be notified — this can't be undone.` : "This can't be undone."}
        confirmLabel="Cancel this session"
        cancelLabel="Keep session"
        busy={busy}
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelConfirmOpen(false)}
      >
        <TextInput label="Reason (optional)" placeholder="e.g. Not enough players, venue fell through" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={leaveConfirmOpen}
        title={`Leave ${game.activityLabel}?`}
        message={game.priceCents ? "You'll lose your spot and this platform doesn't automatically refund it — contact the host if you paid." : "You'll lose your spot — someone else may take it."}
        confirmLabel="Leave session"
        cancelLabel="Stay in"
        busy={busy}
        onConfirm={() => {
          run(() => leaveGame(game.id));
          setLeaveConfirmOpen(false);
        }}
        onCancel={() => setLeaveConfirmOpen(false)}
      />
    </>
  );
}

/** Fixed bottom bar, mobile only (<900px, see index.css's .mobile-join-bar) —
 * sits just above the app's own persistent bottom tab nav (MobileTabBar),
 * matching real mobile listing/event apps that keep a slim primary-nav bar
 * plus a sticky "book now" bar above it, rather than reordering the whole
 * page to pull the desktop card up near the hero. */
export function MobileJoinBar({ game, resident, isHost, onRefresh }: JoinCardProps) {
  const toast = useToast();
  const paidOpen = usePaidCheckoutOpen();
  // Commercial release gate — a paid join can't start while paid checkout is closed (the server refuses it too).
  const paidClosed = paidOpen === false && !!game.priceCents;
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [ageOk, setAgeOk] = useState(false);

  const state = computeState(game, resident, isHost);
  const notify = useGameNotifyMe(game.id, resident, state === "coming-soon");
  if (state === "ended") {
    return (
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: colors.muted }}>Ended</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{dateLabel(game.date)} · {game.time}</div>
        </div>
        <Button onClick={() => navigate(`/games?activity=${encodeURIComponent(game.activityLabel)}`)} style={{ flex: "none" }}>See upcoming dates</Button>
      </div>
    );
  }
  // Going: a slim reminder with the calendar, so it's one tap on a phone too.
  if (state === "joined" && new Date(`${game.date}T${game.time}:00`).getTime() > Date.now()) {
    return (
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: colors.greenText }}>You're going</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{dateLabel(game.date)} · {game.time}</div>
        </div>
        <Button variant="ghost" onClick={() => downloadGameIcs(game.id)} style={{ flex: "none" }}>
          <CalendarIcon size={15} /> Add to calendar
        </Button>
      </div>
    );
  }
  if (state === "cancelled" || state === "host" || state === "joined" || state === "requested" || state === "declined" || state === "closed") return null;

  if (state === "coming-soon") {
    const onNotify = () => {
      if (!resident) return navigate(signInHref(gameSignInContext(game)));
      void (notify.subscribed ? notify.unsubscribe() : notify.subscribe());
    };
    return (
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display, color: colors.orangeDark }}>Coming soon</div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{notify.subscribed ? "We'll let you know when it opens" : "Bookings aren't open yet"}</div>
        </div>
        {/* Subscribed: the button turns notifications off (labelled as such). */}
        <Button variant={notify.subscribed ? "ghost" : "primary"} onClick={onNotify} disabled={notify.busy} style={{ flex: "none" }}>
          {notify.busy ? "Please wait…" : notify.subscribed ? "Stop notifications" : "Notify me"}
        </Button>
      </div>
    );
  }

  const label = state === "signed-out" ? (game.spotsLeft === 0 ? "Sign in to join the waitlist" : "Sign in to join") : ctaLabel(game, state);
  const onClick = () => {
    if (state === "signed-out") return navigate(signInHref(gameSignInContext(game)));
    if (state === "full") {
      setBusy(true);
      joinGameWaitlist(game.id).then(onRefresh).finally(() => setBusy(false));
      return;
    }
    // One tap for a free, open activity, same as the booking box (the box,
    // in the page, then shows "You're in · Undo").
    if (!game.priceCents && game.joinMode !== "approval" && !game.minAge) {
      setBusy(true);
      joinGame(game.id)
        .then(() => {
          toast.success(`You're in: ${game.activityLabel}`);
          onRefresh();
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't join, try again."))
        .finally(() => setBusy(false));
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <>
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>
            {game.status === "pending_participants" ? "Needs players" : game.spotsLeft === 0 ? "Full" : `${game.spotsLeft} spot${game.spotsLeft === 1 ? "" : "s"} left`}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{dateLabel(game.date)} · {game.time} · {formatPrice(game.priceCents)}</div>
        </div>
        <Button onClick={onClick} disabled={busy} style={{ flex: "none" }}>{busy ? "Please wait…" : label}</Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title={game.joinMode === "approval" && !game.priceCents ? `Ask to join ${game.activityLabel}?` : `Join ${game.activityLabel}?`}
        message={
          <>
            <PlanRecap game={game} couponCode={couponCode} />
            {!!game.priceCents && <GameCouponField gameId={game.id} subtotalCents={game.priceCents} onApplied={setCouponCode} />}
            {!!game.minAge && <MinAgeConfirm minAge={game.minAge} checked={ageOk} onChange={setAgeOk} />}
            {paidClosed && <p role="status" style={{ margin: "10px 0 0", fontSize: 13.5, fontWeight: 600, color: colors.orangeDark }}>{PAID_CLOSED_MESSAGE}</p>}
          </>
        }
        confirmLabel={game.priceCents ? "Continue to payment" : game.joinMode === "approval" ? "Send request" : "Confirm I'm in"}
        cancelLabel="Cancel"
        tone="neutral"
        busy={busy}
        confirmDisabled={(!!game.minAge && !ageOk) || paidClosed}
        onConfirm={() => {
          setBusy(true);
          joinGame(game.id, couponCode ?? undefined, game.minAge ? ageOk : undefined)
            .then((res) => {
              if (res.url) {
                openCheckout(res.url);
                return;
              }
              setConfirmOpen(false);
              setCouponCode(null);
              onRefresh();
            })
            .finally(() => setBusy(false));
        }}
        onCancel={() => {
          setConfirmOpen(false);
          setCouponCode(null);
        }}
      />
    </>
  );
}
