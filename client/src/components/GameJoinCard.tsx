import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cancelGame, downloadGameIcs, fetchGameParticipants, joinGame, joinGameWaitlist, leaveGame, leaveGameWaitlist, validateCoupon } from "../api";
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
type JoinState = "cancelled" | "host" | "signed-out" | "joined" | "waitlisted" | "full" | "available";

function computeState(game: Game, resident: Resident | null, isHost: boolean): JoinState {
  if (game.status === "cancelled") return "cancelled";
  if (isHost) return "host";
  if (!resident) return "signed-out";
  if (game.joinedByMe) return "joined";
  if (game.spotsLeft === 0) return game.waitlistedByMe ? "waitlisted" : "full";
  return "available";
}

function ctaLabel(game: Game, state: JoinState): string {
  if (state === "available") return gamePrimaryCtaLabel(game);
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

interface JoinCardProps {
  game: Game;
  resident: Resident | null;
  isHost: boolean;
  onRefresh: () => void;
}

// Compact recap line shared by the confirm modal and the (rare) inline
// error state — date/time, venue, headcount, price, in that order, matching
// the spec's own §21 confirmation-sheet layout.
function PlanRecap({ game }: { game: Game }) {
  return (
    <div>
      <div style={{ fontWeight: 700, color: colors.text, marginBottom: 4 }}>{game.activityLabel}</div>
      <div>{dateLabel(game.date)} · {game.time}</div>
      <div style={{ margin: "4px 0" }}>{game.centreName ?? game.locationText}</div>
      <div>{game.joined}/{game.capacity} joined</div>
      <div style={{ fontWeight: 700, color: game.priceCents ? colors.text : colors.greenText }}>
        {formatPrice(game.priceCents, { each: true })}
      </div>
    </div>
  );
}

// Vendor-parity pass, Phase 25 — a host can scope a coupon to one priced
// session (games.ts's POST /coupons). This preview uses the generic
// /coupons/validate endpoint, which has no listing context (see pricing.ts's
// own documented limit on that endpoint) — real enforcement/rejection for a
// code that doesn't apply to this specific game happens at the actual join
// call below, same never-trust-the-preview contract BookingFlow.tsx uses.
function GameCouponField({ subtotalCents, onApplied }: { subtotalCents: number; onApplied: (code: string | null) => void }) {
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; discountCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const apply = async () => {
    if (!input.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const res = await validateCoupon(input.trim(), subtotalCents);
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
      <h2 style={{ ...h2Style, color: colors.greenText, display: "flex", alignItems: "center", gap: 6 }}>
        You're going <CheckIcon size={16} />
      </h2>
    );
  }
  if (state === "waitlisted") {
    return <h2 style={h2Style}>On the waitlist</h2>;
  }
  if (state === "host") {
    return <h2 style={{ ...h2Style, fontSize: 20 }}>{game.activityLabel}</h2>;
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
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [justJoined, setJustJoined] = useState(false);
  const [participants, setParticipants] = useState<{ residentId: string; name: string }[]>([]);
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const state = computeState(game, resident, isHost);
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
    run(() => joinGame(game.id, couponCode ?? undefined), () => {
      setConfirmOpen(false);
      setCouponCode(null);
      if (!game.priceCents) setJustJoined(true);
    });
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
          {state === "host" && (
            <Button variant="danger" onClick={() => setCancelConfirmOpen(true)} disabled={busy}>
              Cancel this game
            </Button>
          )}
          {state === "signed-out" && (
            <Button full onClick={() => navigate(signInHref(gameSignInContext(game)))}>{game.spotsLeft === 0 ? "Sign in to join the waitlist" : "Sign in to join"}</Button>
          )}
          {state === "joined" && (
            <Button variant="ghost" full onClick={() => setLeaveConfirmOpen(true)} disabled={busy}>Leave game</Button>
          )}
          {state === "waitlisted" && (
            <Button variant="ghost" full onClick={() => run(() => leaveGameWaitlist(game.id))} disabled={busy}>Leave waitlist</Button>
          )}
          {state === "full" && (
            <Button variant="orange" full onClick={() => run(() => joinGameWaitlist(game.id))} disabled={busy}>Join waitlist</Button>
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
        title={`Join ${game.activityLabel}?`}
        message={
          <>
            <PlanRecap game={game} />
            {!!game.priceCents && <GameCouponField subtotalCents={game.priceCents} onApplied={setCouponCode} />}
          </>
        }
        confirmLabel={game.priceCents ? "Continue to payment" : "Confirm I'm in"}
        cancelLabel="Cancel"
        tone="neutral"
        busy={busy}
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
        confirmLabel="Leave game"
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
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [couponCode, setCouponCode] = useState<string | null>(null);

  const state = computeState(game, resident, isHost);
  if (state === "cancelled" || state === "host" || state === "joined") return null;

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
        title={`Join ${game.activityLabel}?`}
        message={
          <>
            <PlanRecap game={game} />
            {!!game.priceCents && <GameCouponField subtotalCents={game.priceCents} onApplied={setCouponCode} />}
          </>
        }
        confirmLabel={game.priceCents ? "Continue to payment" : "Confirm I'm in"}
        cancelLabel="Cancel"
        tone="neutral"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          joinGame(game.id, couponCode ?? undefined)
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
