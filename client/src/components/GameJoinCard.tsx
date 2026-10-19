import { useEffect, useState } from "react";
import { PAID_CLOSED_MESSAGE, usePaidCheckoutOpen } from "../paidCheckout";
import { leaveWaitlistConfirm } from "../confirmCopy";
import { useConfirm } from "./ConfirmProvider";
import { useNavigate } from "react-router-dom";
import { cancelGame, withdrawGameJoinRequest, downloadGameIcs, fetchGameNotifyMe, fetchGameParticipants, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist, quoteGame, subscribeGameNotifyMe, unsubscribeGameNotifyMe, validateCoupon, type PriceQuote } from "../api";
import { signInHref } from "../authRedirect";
import { openCheckout } from "../native";
import { CalendarIcon, CheckIcon, PinIcon, UsersIcon } from "./icons";
import { InviteSheetButton } from "./InviteSheetButton";
import { ShareButton } from "./ShareButton";
import { TextInput } from "./form";
import { Avatar, Button, Card, ConfirmDialog, inputStyle, labelStyle } from "./ui";
import { dateLabel } from "../euro";
import { primaryCtaLabel as gamePrimaryCtaLabel } from "../gameCta";
import { colors, fonts, radius } from "../theme";
import type { Game, Resident } from "../types";
import { formatPrice } from "../formatters";

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
type JoinState = "cancelled" | "host" | "coming-soon" | "signed-out" | "joined" | "requested" | "declined" | "closed" | "waitlisted" | "full" | "available";

function computeState(game: Game, resident: Resident | null, isHost: boolean): JoinState {
  if (game.status === "cancelled") return "cancelled";
  if (isHost) return "host";
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

function ctaLabel(game: Game, state: JoinState): string {
  if (state === "available") return game.joinMode === "approval" && !game.priceCents ? "Ask to join" : gamePrimaryCtaLabel(game);
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
  if (state === "joined") {
    return (
      <h2 className="pop-in" style={{ ...h2Style, color: colors.greenText, display: "flex", alignItems: "center", gap: 6 }}>
        You're going <CheckIcon size={16} />
      </h2>
    );
  }
  if (state === "waitlisted") {
    return <h2 style={h2Style}>On the waitlist</h2>;
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
    return <h2 style={{ ...h2Style, fontSize: 20 }}>{game.activityLabel}</h2>;
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
        <h2 style={{ ...h2Style, color: colors.muted }}>Full</h2>
        <p style={subStyle}>Join the waitlist to be notified if a spot opens.</p>
      </>
    );
  }
  if (game.status === "pending_participants") {
    return (
      <>
        <h2 style={{ ...h2Style, color: colors.orangeDark }}>Needs players</h2>
        <p style={subStyle}>Still filling up — you can join while it does.</p>
      </>
    );
  }
  const urgent = game.spotsLeft <= 3;
  const label = game.spotsLeft === 1 ? "1 spot left" : urgent ? `${game.spotsLeft} spots left` : `${game.spotsLeft} spots available`;
  return (
    <>
      <h2 style={{ ...h2Style, color: urgent ? colors.orangeDark : colors.text }}>{label}</h2>
      {urgent && <p style={{ ...subStyle, fontWeight: 700, color: colors.orangeDark }}>Don't miss out!</p>}
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
  }, [game.id]);

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

  if (justJoined) {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, marginBottom: 6, color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            You're in <CheckIcon size={17} />
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 13.5, color: colors.mutedLight }}>{game.activityLabel} · {dateLabel(game.date)}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Button variant="ghost" onClick={() => downloadGameIcs(game.id)}>Add to calendar</Button>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <ShareButton entityType="game" entityId={game.id} />
              <InviteSheetButton entityType="game" entityId={game.id} title={game.activityLabel} />
            </div>
            <Button variant="ghost" onClick={() => setJustJoined(false)}>View plan</Button>
          </div>
        </div>
      </Card>
    );
  }

  // Overflow is relative to the 4-avatar cap below, not the full fetched
  // list — GameParticipants.tsx shows everyone with no cap, but this card
  // only ever shows up to 4 (a real bug caught here: comparing against the
  // full list length instead of the shown-count undercounted the "+N").
  const shownCount = Math.min(participants.length, 4);
  const overflow = Math.max(0, game.joined - shownCount);

  return (
    <>
      <Card>
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
            <span style={{ fontSize: 12.5, color: colors.mutedLight }}>{game.joined} of {game.capacity} people joined</span>
          </div>
        )}

        <div style={{ height: 1, background: colors.border, margin: "0 0 16px" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: colors.muted, marginBottom: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarIcon size={14} /> {dateLabel(game.date)} · {game.time}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><PinIcon size={14} /> {game.centreName ?? game.locationText}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><UsersIcon size={14} /> {game.joined}/{game.capacity} joined</span>
          <span style={{ fontWeight: 700, color: game.priceCents ? colors.text : colors.greenText }}>{formatPrice(game.priceCents)}</span>
        </div>

        {error && <p style={{ color: colors.danger, fontSize: 13.5, margin: "0 0 12px" }}>{error}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state === "cancelled" && (
            <div style={{ fontWeight: 700, fontSize: 14, color: colors.danger, background: colors.dangerBg, borderRadius: radius.control, padding: "10px 14px", textAlign: "center" }}>
              This plan is no longer happening.
            </div>
          )}
          {state === "host" && !isPast && (
            // Phase 11B — hosts invite and manage (revoke) invitations here.
            <InviteSheetButton entityType="game" entityId={game.id} title={game.activityLabel} />
          )}
          {state === "host" && (
            <Button variant="danger" onClick={() => setCancelConfirmOpen(true)} disabled={busy}>
              Cancel this session
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
          {state === "joined" && (
            <Button variant="ghost" full onClick={() => setLeaveConfirmOpen(true)} disabled={busy}>Leave session</Button>
          )}
          {state === "waitlisted" && (
            <Button
              variant="ghost"
              full
              onClick={async () => {
                if (await confirm(leaveWaitlistConfirm(game.activityLabel))) run(() => leaveGameWaitlist(game.id));
              }}
              disabled={busy}
            >
              Leave waitlist
            </Button>
          )}
          {state === "full" && (
            <Button variant="orange" full onClick={() => run(() => joinGameWaitlist(game.id))} disabled={busy}>Join waitlist</Button>
          )}
          {state === "requested" && (
            <Button variant="ghost" full onClick={() => run(() => withdrawGameJoinRequest(game.id))} disabled={busy}>
              Withdraw request
            </Button>
          )}
          {state === "available" && (
            <Button full onClick={() => setConfirmOpen(true)} disabled={busy}>{ctaLabel(game, state)}</Button>
          )}
          {(state === "available" || state === "signed-out") && !game.priceCents && (
            <div style={{ textAlign: "center", fontSize: 12, color: colors.faint }}>No payment required</div>
          )}
          {(state === "joined" || state === "available" || state === "full") && !isPast && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <ShareButton entityType="game" entityId={game.id} />
              <InviteSheetButton entityType="game" entityId={game.id} title={game.activityLabel} />
              <Button variant="ghost" onClick={() => downloadGameIcs(game.id)}>Add to calendar</Button>
            </div>
          )}
        </div>
      </Card>

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
    setConfirmOpen(true);
  };

  return (
    <>
      <div className="mobile-join-bar">
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: fonts.display }}>
            {game.status === "pending_participants" ? "Needs players" : game.spotsLeft === 0 ? "Full" : `${game.spotsLeft} spot${game.spotsLeft === 1 ? "" : "s"} left`}
          </div>
          <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{formatPrice(game.priceCents)}</div>
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
