import { useEffect, useRef, useState, type ReactNode } from "react";
import { NextPlanSection } from "../components/mylife/NextPlan";
import { MyLifePassport, MyLifePlans } from "../components/experience/MyLifeExperience";
import { RefundStatus, SelfCancelControl } from "../components/SelfCancelControl";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { safeReturnTo } from "../authRedirect";
import { useConfirm } from "../components/ConfirmProvider";
import { leaveWaitlistConfirm } from "../confirmCopy";
import {
  cancelBooking,
  cancelExperienceBooking,
  cancelProgramEnrollment,
  cancelRegistration,
  downloadBookingIcs,
  fetchFavourites,
  fetchMyFollows,
  fetchMyBookings,
  fetchMyCircles,
  fetchMyExperienceBookings,
  fetchMyGames,
  fetchMyParticipation,
  fetchMyIntents,
  fetchMyProgramEnrollments,
  fetchMyRegistrations,
  fetchNeedsAttention,
  fetchMyLifeSignals,
  fetchMyLifeDismissals,
  dismissMyLifeItem,
  fetchFollowFeed,
  fetchChatInbox,
  fetchForYou,
  fetchNewHere,
  fetchResidentFull,
  fetchRoutineSuggestions,
  fetchWaitlistOfferStatus,
  leaveClubWaitlist,
  guestLogout,
  lookupBooking,
  lookupRegistration,
  rescheduleBooking,
  verifyGuestLink,
} from "../api";
import type { FollowedEntity, FollowFeedItem, MyLifeRoutineMatch, MyLifeSavedSignal } from "../api";
import { ChevronRightIcon } from "../components/icons";
import { MonthCalendar } from "../components/MonthCalendar";
import { MyLifeCircles } from "../components/MyLifeCircles";
import { MyCirclePlans } from "../components/circle/MyCirclePlans";
import { MyLifeRecentActivity } from "../components/MyLifeRecentActivity";
import { MyLifeSaved } from "../components/MyLifeSaved";
import { MyLifeFollowing } from "../components/MyLifeFollowing";
import { describeAvailability } from "../participationVocab";
import { MyLifeEmptyState } from "../components/MyLifeEmptyState";
import { ActivitySummary, ClosingPrompt, IdeaTiles, MoreLinks, MyLifeTitle, NeedsList, NothingBooked, shortDay, RecentByDay, UpcomingByMonth, UpcomingCards, CircleCards, type CircleCard, type IdeaTile, type RecentItem, type UpcomingCard } from "../components/MyLifeOverview";
import { ActionMenu } from "../components/ActionMenu";
import { favouriteDetailHref } from "../favouriteLink";
import { useExperienceFeatures } from "../circleFeatures";
import { MyInvitationsPanel } from "../components/MyInvitationsPanel";
import { MagicLinkCompleteAccount } from "../components/MagicLinkCompleteAccount";
import { openOnboarding } from "../components/AccountSetupGate";
import { AccountTab, FormModal, SegmentedTabs } from "./account/accountUi";
import "./myLife.css";
import { SavedPage } from "./account/SavedPage";
import { FollowingPage } from "./account/FollowingPage";
import { AddRoutineModal, RoutinesPage } from "./account/RoutinesPage";
import { useUrlParam, useUrlTab } from "../useUrlTab";
import { trackEvent } from "../analytics";
import { useMediaQuery } from "./account/useMediaQuery";
import { AddInterestModal, FreeTimePrompt, MadeForWeek, MiniCalendar, PassportTab, PreferencesModal, PulseList, type PulseItem, type Suggestion } from "../components/MyLifeEngage";
import { useToast } from "../components/Toast";
import { MyLifeWaitingFor } from "../components/MyLifeWaitingFor";
import { Photo } from "../components/Photo";
import { PollVoteModal, pollTargetOf } from "../components/PollVoteModal";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { Button, ConfirmDialog, EmptyState, onActivateProps, RowSkeleton, inputStyle, labelStyle, LoadErrorState } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { formatIrishDateTime } from "../components/booking/policy";
import { TIME_SLOTS } from "../constants";
import { useGuest } from "../GuestContext";
import { attendanceStateOf, isUpcomingProgramEnrollment, shouldPromptFeedback, shouldPromptProgramFeedback } from "../participation";
import { getCircleCoverUrl, getMediaUrl } from "../media";
import { colors, maxWidth, radius } from "../theme";
import type { ChatInboxItem, ForYouSection, NewHereCircle, Circle, Favourite, Game, MyBooking, MyExperienceBooking, MyIntent, MyProgramEnrollment, MyRegistration, NeedsAttentionItem, ParticipationEntry, ResidentFull, RoutineSuggestion, WaitlistOfferStatus } from "../types";
import { irelandDaysFromToday, irelandMonthStart, irelandToday } from "../irelandDate";

// My Life — participation-first home (IA redesign). One purpose: "what am
// I doing next, what else is coming, what's worth doing again, who/what am
// I part of". Reused/kept unchanged from the previous "My Bookings" page:
// the guest magic-link sign-in flow, the find-by-reference recovery flow
// (both real, load-bearing — confirmation emails link back to this exact
// route with ?ref=/?token=), and every booking/registration mutation
// (cancel/reschedule/QR check-in/attendance confirmation/reviews) — all
// still reachable via "View full activity" below the redesigned hub.
// Account settings (Household, Notifications, Payments, Passes, Receipts,
// Safety, Help) live in Profile.tsx, reached via "Edit profile".
//
// Explicitly NOT built here: a "people you keep showing up with" module.
// The app only tracks familiarity as a *count* scoped to one game/Circle
// (countFamiliarCoParticipants / familiarMembersFor) — there's no endpoint
// that names a resident's most-frequent co-participants across their whole
// history. Per the redesign brief's own instruction, an unsupported section
// is omitted rather than faked.

const INTERESTS_NUDGE_DISMISSED_KEY = "hc_interests_nudge_dismissed";

// Front-door check-in (attendance table) — shown only when the vendor
// actually checked this booking/registration in; no badge means unknown.
const checkedInBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" };
const cancelledBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" };
const recoveredBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" };

function BookingQr({ reference }: { reference: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    import("qrcode").then((QRCode) => QRCode.toDataURL(reference, { width: 160, margin: 1 }).then(setDataUrl));
  }, [reference]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt={`QR code for ${reference}`} style={{ width: 120, height: 120, borderRadius: radius.control, border: `1px solid ${colors.border}` }} />;
}

// Owner 2026-10-24: forms open in a centred popup, never inline.
function RescheduleModal({ booking, open, onClose, onDone }: { booking: MyBooking; open: boolean; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  useEffect(() => {
    if (open) {
      setDate(booking.date);
      setTime(booking.time);
    }
  }, [open, booking.date, booking.time]);
  return (
    <FormModal
      open={open}
      title="Change date or time"
      subtitle={`${booking.centreName}${booking.roomName ? ` — ${booking.roomName}` : ""}, now ${dateLabel(booking.date)} at ${booking.time}`}
      submitLabel="Confirm new time"
      dirty={date !== booking.date || time !== booking.time}
      onClose={onClose}
      onSubmit={async () => {
        if (date === booking.date && time === booking.time) return false;
        await rescheduleBooking(booking.ref, date, time);
        onDone();
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <div>
          <label htmlFor={`rs-date-${booking.ref}`} style={labelStyle}>New date</label>
          <input id={`rs-date-${booking.ref}`} type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label htmlFor={`rs-time-${booking.ref}`} style={labelStyle}>New start time</label>
          <select id={`rs-time-${booking.ref}`} value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle}>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: colors.mutedLight }}>The venue's availability is checked when you confirm.</p>
    </FormModal>
  );
}

function BookingRow({
  booking, onCancel, cancelling, error, recovered, lookupEmail,
}: {
  booking: MyBooking; onCancel: () => void; cancelling: boolean; error?: string; recovered?: boolean; lookupEmail?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const cancelled = booking.status === "cancelled";
  // Ireland date, not the device's (sitemap audit P2-14) — dates are YYYY-MM-DD, so a string compare is a date compare.
  const isPast = booking.date.slice(0, 10) < irelandToday();
  // Booking UX Phase 3 — what's allowed comes from the server (selfCancel.ts);
  // an older server that doesn't send these keeps the previous behaviour.
  const canCancel = !cancelled && (booking.canCancel ?? true);
  const canReschedule = !cancelled && (booking.canReschedule ?? true);
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Photo src={booking.image} alt={booking.centreName} ph={booking.ph} style={{ width: 52, height: 52, borderRadius: radius.control, overflow: "hidden", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} {...onActivateProps(() => setExpanded((e) => !e))}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{booking.centreName}{booking.roomName ? ` — ${booking.roomName}` : ""}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            {!cancelled && booking.attendance === "present" && <span style={checkedInBadgeStyle}>Checked in</span>}
            <RefundStatus refundState={booking.refundState} />
            {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {dateLabel(booking.date)} · {booking.time}
          </div>
          {!cancelled && !isPast && booking.cancelDeadline && (
            <div style={{ color: colors.mutedLight, fontSize: 13 }}>
              {canCancel ? `Free cancellation until ${formatIrishDateTime(booking.cancelDeadline)}` : "Online changes have closed — contact the venue"}
            </div>
          )}
          {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{euro(booking.totalCents / 100)}</div>
          <div style={{ fontSize: 12, color: colors.faint, marginBottom: canCancel ? 8 : 0 }}>
            {recovered && !lookupEmail ? booking.ref : <Link to={`/bookings/booking/${encodeURIComponent(booking.ref)}`} state={lookupEmail ? { lookupEmail } : undefined} style={{ color: colors.text, fontWeight: 700 }} aria-label={`Booking details ${booking.ref}`}>Details · {booking.ref}</Link>}
          </div>
          {canCancel && (
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this booking?"
        message={`${booking.centreName}${booking.roomName ? ` — ${booking.roomName}` : ""}, ${dateLabel(booking.date)} at ${booking.time}.${
          booking.paidOnline && booking.totalCents > 0 ? " Your refund is issued by the venue through HelloCircle — we'll email you when it's done." : booking.paidOnline === false ? " Nothing was charged online." : ""
        } This can't be undone.`}
        confirmLabel={cancelling ? "Cancelling…" : "Cancel booking"}
        cancelLabel="Keep booking"
        busy={cancelling}
        onConfirm={() => {
          onCancel();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
      {expanded && !cancelled && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}`, display: "flex", flexWrap: "wrap", gap: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.muted, marginBottom: 8 }}>Check-in code</div>
            <BookingQr reference={booking.ref} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            {!isPast && (
              <button
                onClick={() => downloadBookingIcs(booking.ref)}
                className="ml-link"
                style={{ display: "block", marginBottom: 12 }}
              >
                Add to calendar
              </button>
            )}
            {canReschedule && (
              <>
                <Button variant="ghost" onClick={() => setRescheduleOpen(true)}>Change date or time</Button>
                <RescheduleModal booking={booking} open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} onDone={() => window.location.reload()} />
              </>
            )}
            {shouldPromptFeedback(attendanceStateOf({ cancelled, attendance: booking.attendance }), isPast) && (
              <div style={{ marginTop: 16 }}>
                <PostActivityFeedback kind="booking" reference={booking.ref} followTarget={{ type: "vendor", id: booking.vendorId }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WaitlistOfferBanner({ clubId, clubName }: { clubId: string; clubName: string }) {
  const [status, setStatus] = useState<WaitlistOfferStatus | null>(null);
  const confirm = useConfirm();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  // Sitemap audit P2-09 — leaving was only possible through the API.
  const leave = async () => {
    if (!(await confirm(leaveWaitlistConfirm(clubName)))) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await leaveClubWaitlist(clubId);
      setStatus({ onWaitlist: false });
    } catch {
      setLeaveError("Couldn't leave the waitlist — try again.");
    } finally {
      setLeaving(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    fetchWaitlistOfferStatus(clubId).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  if (!status?.onWaitlist) return null;

  if (status.offered) {
    const expires = status.offerExpiresAt ? new Date(status.offerExpiresAt) : null;
    return (
      <div style={{ marginTop: 10, background: colors.orangeBg, color: colors.orangeDark, borderRadius: radius.control, padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
        A spot has opened up! {expires ? `Respond by ${expires.toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} or it passes to the next person.` : "Respond soon or it passes to the next person."}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, color: colors.mutedLight, fontSize: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span>On the waitlist{typeof status.position === "number" ? ` · position ${status.position}${status.total ? ` of ${status.total}` : ""}` : ""}</span>
      <button onClick={() => void leave()} disabled={leaving} style={{ background: "none", border: "none", padding: "4px 2px", fontSize: 13, fontWeight: 600, color: colors.muted, textDecoration: "underline", cursor: "pointer" }}>
        {leaving ? "Leaving…" : "Leave waitlist"}
      </button>
      {leaveError && <span role="alert" style={{ color: colors.danger }}>{leaveError}</span>}
    </div>
  );
}

function RegistrationRow({
  registration, onCancel, cancelling, error, recovered, lookupEmail,
}: {
  registration: MyRegistration; onCancel: () => void; cancelling: boolean; error?: string; recovered?: boolean; lookupEmail?: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelled = registration.status === "cancelled";
  const canCancel = !cancelled && (registration.canCancel ?? true);
  const enoughTimeSinceSignup = Date.now() - new Date(registration.createdAt).getTime() > 14 * 24 * 60 * 60 * 1000;
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 52, height: 52, borderRadius: radius.control, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 12 }}>
          {registration.sport}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{`${registration.childFirst} ${registration.childLast}`.trim()}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            {!cancelled && registration.attendance === "present" && <span style={checkedInBadgeStyle}>Checked in</span>}
            <RefundStatus refundState={registration.refundState} />
            {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {registration.clubName}{registration.team ? ` · ${registration.team}` : ""}
          </div>
          {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{registration.trial ? "Free trial" : euro(registration.totalCents / 100)}</div>
          <div style={{ fontSize: 12, color: colors.faint, marginBottom: canCancel ? 8 : 0 }}>
            {recovered && !lookupEmail ? registration.ref : <Link to={`/bookings/registration/${encodeURIComponent(registration.ref)}`} state={lookupEmail ? { lookupEmail } : undefined} style={{ color: colors.text, fontWeight: 700 }} aria-label={`Registration details ${registration.ref}`}>Details · {registration.ref}</Link>}
          </div>
          {canCancel && (
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this registration?"
        message={`${registration.childFirst} ${registration.childLast} — ${registration.clubName}${registration.team ? `, ${registration.team}` : ""}.${
          registration.paidOnline && registration.totalCents > 0 ? " Your refund is issued by the club through HelloCircle — we'll email you when it's done." : ""
        } This can't be undone.`}
        confirmLabel={cancelling ? "Cancelling…" : "Cancel registration"}
        cancelLabel="Keep registration"
        busy={cancelling}
        onConfirm={() => {
          onCancel();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
      {!cancelled && <WaitlistOfferBanner clubId={registration.clubId} clubName={registration.clubName} />}
      {shouldPromptFeedback(attendanceStateOf({ cancelled, attendance: registration.attendance }), enoughTimeSinceSignup) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
          <PostActivityFeedback kind="registration" reference={registration.ref} followTarget={{ type: "vendor", id: registration.vendorId }} />
        </div>
      )}
    </div>
  );
}

function GameRow({ game }: { game: Game }) {
  const navigate = useNavigate();
  const cancelled = game.status === "cancelled";
  return (
    <Link
      to={`/games/${game.id}`}
      className="row-link"
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {game.imageUrl ? (
          <img src={getMediaUrl(game.imageUrl, "thumbnail")} alt="" style={{ width: 52, height: 52, borderRadius: radius.control, objectFit: "cover", flex: "none" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: radius.control, background: colors.greenBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.greenText, fontWeight: 700, fontSize: 18 }}>
            {game.activityLabel.charAt(0)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{game.activityLabel}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {dateLabel(game.date)} · {game.time}{game.centreName ? ` · ${game.centreName}` : game.locationText ? ` · ${game.locationText}` : ""}
          </div>
        </div>
        <ChevronRightIcon size={16} style={{ flex: "none", color: colors.faint }} />
      </div>
    </Link>
  );
}

function ExperienceBookingRow({ booking, onChanged }: { booking: MyExperienceBooking; onChanged: () => void }) {
  const navigate = useNavigate();
  const cancelled = booking.status === "cancelled";
  // Resident Experience Polish — PostActivityFeedback previously only
  // existed for Centre bookings/Club registrations; an Experience booking
  // has a real single session date, same as a Centre booking, so the same
  // isPast gate applies directly.
  // Ireland date, not the device's (sitemap audit P2-14) — dates are YYYY-MM-DD, so a string compare is a date compare.
  const isPast = booking.date.slice(0, 10) < irelandToday();
  return (
    <div
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}
    >
      {/* Batch 2 — the row opens this booking's own page (which links on to the listing). */}
      <Link to={`/bookings/experience/${encodeURIComponent(booking.ref)}`} className="row-link" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {booking.imageUrl ? (
          <img src={getMediaUrl(booking.imageUrl, "thumbnail")} alt={booking.title} style={{ width: 52, height: 52, borderRadius: radius.control, objectFit: "cover", flex: "none" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: radius.control, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 18 }}>
            {booking.title.charAt(0)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{booking.title}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            <RefundStatus refundState={booking.refundState} />
            {!cancelled && booking.attendance === "present" && <span style={checkedInBadgeStyle}>Attended</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {dateLabel(booking.date)} · {booking.time} · {booking.partySize} {booking.partySize === 1 ? "person" : "people"}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{euro(booking.totalCents / 100)}</div>
          <div style={{ fontSize: 12, color: colors.faint }}>{booking.ref}</div>
        </div>
        <ChevronRightIcon size={16} style={{ flex: "none", color: colors.faint }} />
      </Link>
      {!isPast && (
        <SelfCancelControl
          noun="booking"
          title={booking.title}
          detail={`${dateLabel(booking.date)} at ${booking.time}`}
          canCancel={!!booking.canCancel}
          paidOnline={!!booking.paidOnline && booking.totalCents > 0}
          cancel={() => cancelExperienceBooking(booking.ref)}
          onCancelled={onChanged}
        />
      )}
      {shouldPromptFeedback(attendanceStateOf({ cancelled, attendance: booking.attendance }), isPast) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }} onClick={(e) => e.stopPropagation()}>
          <PostActivityFeedback kind="experience" reference={booking.ref} followTarget={booking.vendorId ? { type: "vendor", id: booking.vendorId } : undefined} />
        </div>
      )}
    </div>
  );
}

function CircleRow({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  return (
    <Link
      to={`/circles/${circle.slug ?? circle.id}`}
      className="row-link"
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 52, height: 52, borderRadius: radius.control, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 18 }}>
          {circle.name.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{circle.name}</div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {circle.members} member{circle.members === 1 ? "" : "s"}{circle.area ? ` · ${circle.area}` : ""}
          </div>
        </div>
        <ChevronRightIcon size={16} style={{ flex: "none", color: colors.faint }} />
      </div>
    </Link>
  );
}

function ProgramEnrollmentRow({ enrollment, onChanged }: { enrollment: MyProgramEnrollment; onChanged: () => void }) {
  const navigate = useNavigate();
  const cancelled = enrollment.status === "cancelled";
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      {/* Batch 2 — the row opens this enrolment's own page (which links on to the programme). */}
      <Link to={`/bookings/program/${encodeURIComponent(enrollment.ref)}`} className="row-link" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Photo src={enrollment.imageUrl} alt={enrollment.title} ph={colors.panel} style={{ width: 52, height: 52, borderRadius: radius.control, overflow: "hidden", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{enrollment.title}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            <RefundStatus refundState={enrollment.refundState} />
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {enrollment.participantName} · {enrollment.listingName}
          </div>
          {/* Resident Experience Polish — honest next-session state: a real
              date when one exists, never a fabricated one otherwise. */}
          {!cancelled && (
            <div style={{ color: colors.mutedLight, fontSize: 12.5, marginTop: 2 }}>
              {enrollment.nextSessionDate ? `Next session: ${enrollment.nextSessionDate}${enrollment.nextSessionTime ? ` · ${enrollment.nextSessionTime}` : ""}` : "No upcoming sessions scheduled"}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{enrollment.totalCents ? euro(enrollment.totalCents / 100) : "Free"}</div>
          <div style={{ fontSize: 12, color: colors.faint }}>{enrollment.ref}</div>
        </div>
      </Link>
      {/* Resident Experience Polish — PostActivityFeedback previously only
          existed for Centre bookings/Club registrations. Gated on
          hasPastSession (a real session has actually happened), not just
          "enrolled a while ago" — a program is ongoing, so isPast doesn't
          apply the way it does to a single-dated booking. */}
      <SelfCancelControl
        noun="enrolment"
        title={enrollment.title}
        detail={enrollment.participantName}
        canCancel={!!enrollment.canCancel}
        paidOnline={!!enrollment.paidOnline && enrollment.totalCents > 0}
        cancel={() => cancelProgramEnrollment(enrollment.ref)}
        onCancelled={onChanged}
      />
      {shouldPromptProgramFeedback(enrollment) && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }} onClick={(e) => e.stopPropagation()}>
          <PostActivityFeedback kind="program" reference={enrollment.ref} followTarget={enrollment.vendorId ? { type: "vendor", id: enrollment.vendorId } : undefined} />
        </div>
      )}
    </div>
  );
}

type LookupResult = { kind: "booking"; data: MyBooking } | { kind: "registration"; data: MyRegistration };

// My Life 3.0 (owner 2026-10-25, decision D2): five tabs. Older keys still
// work: overview → For You, bookings → My Plans, routines → My Plans
// (Routines view), following → Saved (Following view). Passport shows only
// while its switches are on.
const MY_LIFE_TABS = [
  { key: "foryou", label: "For You" },
  { key: "plans", label: "My Plans" },
  { key: "circles", label: "My Circles" },
  { key: "saved", label: "Saved" },
  { key: "passport", label: "Passport" },
] as const;
const OLD_TAB_KEYS: Record<string, Record<string, string>> = {
  overview: {},
  bookings: { tab: "plans" },
  routines: { tab: "plans", view: "routines" },
  following: { tab: "saved", show: "following" },
};
type MyLifeTab = (typeof MY_LIFE_TABS)[number]["key"];

export function MyBookings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // My Life tabs (sidebar merge 2026-10-24): Saved, Following and Routines
  // moved here from the account sidebar; Bookings and Circles replace the old
  // #my-bookings / #my-circles anchors (still honoured: see the hash effect).
  const [myLifeTab, setMyLifeTab] = useUrlTab(MY_LIFE_TABS.map((t) => t.key), "foryou");
  useEffect(() => {
    const old = searchParams.get("tab");
    if (old && OLD_TAB_KEYS[old]) {
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      for (const [k, v] of Object.entries(OLD_TAB_KEYS[old])) next.set(k, v);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const { email: guestEmail, resident, loading: guestLoading, loadError: guestLoadError, refresh: refreshGuest } = useGuest();
  // Called before any early return (rules of hooks): "More for you" links.
  const experience = useExperienceFeatures();
  const toastApi = useToast();
  // Phones: the next action first, so "What are you up for?" moves below Your next moments (DOM order, not CSS).
  const phone = useMediaQuery("(max-width: 760px)");
  // Bookings tab view (Upcoming / Past / Calendar), kept in the URL.
  // My Plans "Show all past", and old ?view= / ?show= links (from the
  // earlier inner tabs) now scroll to their section on the one page.
  const [showAllPast, setShowAllPast] = useState(false);
  // Forms open in a popup on My Life, not a separate page (owner 2026-10-26).
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [interestOpen, setInterestOpen] = useState(false);
  const [routinesKey, setRoutinesKey] = useState(0);
  const [bookingsTabView] = useUrlParam<string>("view", "");
  const [savedShow] = useUrlParam<string>("show", "");

  // My Life 3.0 data, each behind its own switch; all read-only.
  const [signals, setSignals] = useState<{ saved: MyLifeSavedSignal[]; routines: MyLifeRoutineMatch[] }>({ saved: [], routines: [] });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [forYou, setForYou] = useState<ForYouSection[]>([]);
  const [followFeed, setFollowFeed] = useState<FollowFeedItem[]>([]);
  const [chatInbox, setChatInbox] = useState<ChatInboxItem[]>([]);
  const [newHereCircles, setNewHereCircles] = useState<NewHereCircle[]>([]);
  const residentId = resident?.id ?? null;
  useEffect(() => {
    if (!residentId) return;
    let live = true;
    const keep = <T,>(set: (v: T) => void) => (v: T) => live && set(v);
    if (experience["mylife.pulse"]) {
      fetchMyLifeSignals().then(keep(setSignals)).catch(() => {});
      fetchMyLifeDismissals().then((r) => live && setDismissed(new Set(r.keys))).catch(() => {});
      fetchFollowFeed().then(keep(setFollowFeed)).catch(() => {});
    }
    if (experience["mylife.for_you"]) {
      fetchForYou().then((r) => live && setForYou(r.sections)).catch(() => {});
      if (!experience["mylife.pulse"]) fetchMyLifeDismissals().then((r) => live && setDismissed(new Set(r.keys))).catch(() => {});
    }
    fetchChatInbox().then((r) => live && setChatInbox(r.items)).catch(() => {});
    fetchNewHere().then((r) => live && setNewHereCircles(r.circles)).catch(() => {});
    return () => {
      live = false;
    };
  }, [residentId, experience["mylife.pulse"], experience["mylife.for_you"]]);
  const dismiss = (key: string) => {
    setDismissed((d) => new Set([...d, key]));
    trackEvent("mylife_item_dismissed", { key: key.split(":")[0] });
    dismissMyLifeItem(key).catch(() => setDismissed((d) => { const n = new Set(d); n.delete(key); return n; }));
  };

  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [programEnrollments, setProgramEnrollments] = useState<MyProgramEnrollment[]>([]);
  const [experienceBookings, setExperienceBookings] = useState<MyExperienceBooking[]>([]);
  // Phase 11B — refresh from the server after a self-cancel (or a 409 that
  // shows it was already cancelled), so status/refund badges are server truth.
  const reloadExperienceBookings = () => { fetchMyExperienceBookings().then(setExperienceBookings).catch(() => {}); };
  const reloadProgramEnrollments = () => { fetchMyProgramEnrollments().then(setProgramEnrollments).catch(() => {}); };
  const [loading, setLoading] = useState(true);
  // Validation 2026-10-14 — a failed source must never read as an empty My
  // Life (or leave the skeleton up forever): count failures, show an alert
  // with retry, and keep the empty state out of it.
  const [failedSources, setFailedSources] = useState(0);

  const [residentFull, setResidentFull] = useState<ResidentFull | null>(null);
  const [interestsNudgeDismissed, setInterestsNudgeDismissed] = useState(() => localStorage.getItem(INTERESTS_NUDGE_DISMISSED_KEY) === "1");
  const [routineSuggestions, setRoutineSuggestions] = useState<RoutineSuggestion[]>([]);
  const [intents, setIntents] = useState<MyIntent[]>([]);
  const [participation, setParticipation] = useState<ParticipationEntry[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [follows, setFollows] = useState<FollowedEntity[]>([]);
  const [needsAttention, setNeedsAttention] = useState<NeedsAttentionItem[]>([]);
  // "Vote" on an open poll opens a popup here instead of leaving My Life.
  const [votingOn, setVotingOn] = useState<NeedsAttentionItem | null>(null);
  const openInPlace = (n: NeedsAttentionItem) => {
    if (!pollTargetOf(n)) return false;
    setVotingOn(n);
    return true;
  };

  const [bookingsView, setBookingsView] = useState<"list" | "calendar">("list");
  const [showAllActivity, setShowAllActivity] = useState(false);
  // Header account menu deep links (2026-10-12): /bookings#my-bookings opens
  // the full activity list, /bookings#my-circles jumps to My Circles. Runs
  // once the page data has loaded, since both sections render from it.
  const { hash } = useLocation();
  useEffect(() => {
    if (loading || (hash !== "#my-bookings" && hash !== "#my-circles")) return;
    // Signed in: these are tabs now. Guests have no tabs, so keep the old scroll.
    if (resident) {
      setMyLifeTab(hash === "#my-bookings" ? "plans" : "circles");
      return;
    }
    if (hash === "#my-bookings") setShowAllActivity(true);
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, loading]);
  useEffect(() => {
    if (loading) return;
    const target =
      myLifeTab === "plans" && (bookingsTabView === "past" || bookingsTabView === "routines" || bookingsTabView === "week" || bookingsTabView === "calendar")
        ? bookingsTabView === "past" ? "mlx-plans-past" : bookingsTabView === "routines" ? "mlx-plans-routines" : "mlx-plans-week"
        : myLifeTab === "saved" && savedShow === "following" ? "mlx-following" : null;
    if (!target) return;
    if (target === "mlx-plans-past") setShowAllPast(true);
    const t = window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "start" }), 80);
    return () => window.clearTimeout(t);
  }, [loading, myLifeTab, bookingsTabView, savedShow]);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadMyStuff = () => {
    setLoading(true);
    let failures = 0;
    const settle = <T,>(p: Promise<T>, apply: (v: T) => void) =>
      p.then(apply).catch((e: unknown) => {
        // Signed-out guests get 401s from resident-only sources: expected, not a failure.
        const status = (e as { status?: number })?.status;
        if (status !== 401 && status !== 403) failures += 1;
      });
    return Promise.all([
      settle(fetchMyBookings(), setBookings),
      settle(fetchMyRegistrations(), setRegs),
      settle(fetchMyProgramEnrollments(), setProgramEnrollments),
      settle(fetchMyGames(), setGames),
      settle(fetchMyCircles(), setCircles),
      settle(fetchMyExperienceBookings(), setExperienceBookings),
      // Profile (/residents/me) failures already show the account-level error
      // above (HC-QA-064) — not counted again as missing activity.
      fetchResidentFull()
        .then(({ resident: r }) => setResidentFull(r))
        .catch(() => setResidentFull(null)),
      settle(fetchRoutineSuggestions(), setRoutineSuggestions),
      settle(fetchMyIntents(), setIntents),
      settle(fetchMyParticipation(), setParticipation),
      settle(fetchFavourites(), setFavourites),
      settle(fetchMyFollows(), setFollows),
      settle(fetchNeedsAttention(), setNeedsAttention),
    ]).then(() => {
      setFailedSources(failures);
      setLoading(false);
    });
  };

  useEffect(() => {
    loadMyStuff();
  }, []);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      setLookupRef(ref);
      setLookupOpen(true);
    }
  }, [searchParams]);

  // Onboarding audit (consent pass) — a brand-new email now comes back as
  // "needs_completion" instead of an immediate sign-in (see
  // server/src/routes/guestAuth.ts's POST /verify) — this holds that state
  // long enough to show MagicLinkCompleteAccount inline before the normal
  // page renders. destination travels with it so the original `returnTo`
  // survives the extra step exactly as it does for the immediate-sign-in
  // branch.
  const [pendingCompletion, setPendingCompletion] = useState<{ email: string; completionToken: string; destination: string } | null>(null);

  const finishGuestSignIn = async (destination: string) => {
    await refreshGuest();
    await loadMyStuff();
    navigate(destination, { replace: true });
  };

  const verifiedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    const token = searchParams.get("token");
    if (!token || verifiedTokenRef.current === token) return;
    verifiedTokenRef.current = token;
    setVerifying(true);
    // Onboarding audit F-1 — the emailed magic link now carries `returnTo`
    // (see server/src/routes/guestAuth.ts's POST /request-link) so choosing
    // the passwordless option no longer strands someone back on /bookings
    // after they were trying to join a Circle/Game or finish a booking.
    // safeReturnTo() falls back to /bookings for a missing/unsafe value,
    // same guard SignIn.tsx already relies on.
    const destination = safeReturnTo(searchParams.get("returnTo"));
    verifyGuestLink(token)
      .then(async (result) => {
        // Strip the consumed token from the URL immediately, regardless of
        // outcome — it's single-use and already dead server-side the moment
        // this response arrives, and it must not linger visible in the
        // address bar while an account-completion form (or anything else)
        // is on screen (onboarding audit requirement).
        const next = new URLSearchParams(searchParams);
        next.delete("token");
        setSearchParams(next, { replace: true });

        if (result.status === "needs_completion") {
          setPendingCompletion({ email: result.email, completionToken: result.completionToken, destination });
          setVerifying(false);
          return;
        }
        setVerifying(false);
        await finishGuestSignIn(destination);
      })
      .catch((e) => {
        setVerifyError(e instanceof Error ? e.message : "That sign-in link didn't work");
        setVerifying(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await guestLogout();
      await refreshGuest();
      await loadMyStuff();
    } finally {
      setSigningOut(false);
      setConfirmingSignOut(false);
    }
  };

  const hasNone =
    !loading &&
    failedSources === 0 &&
    bookings.length === 0 &&
    regs.length === 0 &&
    games.length === 0 &&
    circles.length === 0 &&
    programEnrollments.length === 0 &&
    experienceBookings.length === 0;

  const today = irelandToday();
  const tomorrow = irelandDaysFromToday(1);
  const timelineRows: { date: string; el: JSX.Element }[] = [
    ...bookings.map((b) => ({
      date: b.date,
      el: (
        <BookingRow
          key={`b-${b.ref}`}
          booking={b}
          onCancel={() => handleCancelBooking(b.ref, guestEmail ?? undefined)}
          cancelling={cancellingRef === b.ref}
          error={cancelErrors[b.ref]}
        />
      ),
    })),
    ...games.map((g) => ({ date: g.date, el: <GameRow key={`g-${g.id}`} game={g} /> })),
    ...experienceBookings.map((eb) => ({ date: eb.date, el: <ExperienceBookingRow key={`eb-${eb.ref}`} booking={eb} onChanged={reloadExperienceBookings} /> })),
  ];
  const upcomingRows = timelineRows.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const pastRows = timelineRows.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));

  const handleCancelBooking = async (ref: string, email?: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelBooking(ref, email);
      setBookings((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
      setLookupResult((res) => (res && res.kind === "booking" && res.data.ref === ref ? { ...res, data: { ...res.data, status: "cancelled" } } : res));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this booking" }));
    } finally {
      setCancellingRef(null);
    }
  };

  const handleCancelRegistration = async (ref: string, email?: string) => {
    setCancellingRef(ref);
    setCancelErrors((e) => ({ ...e, [ref]: "" }));
    try {
      await cancelRegistration(ref, email);
      setRegs((rows) => rows.map((r) => (r.ref === ref ? { ...r, status: "cancelled" } : r)));
      setLookupResult((res) => (res && res.kind === "registration" && res.data.ref === ref ? { ...res, data: { ...res.data, status: "cancelled" } } : res));
    } catch (e) {
      setCancelErrors((errs) => ({ ...errs, [ref]: e instanceof Error ? e.message : "Couldn't cancel this registration" }));
    } finally {
      setCancellingRef(null);
    }
  };

  // Returns whether a booking was found; the popup shows the error otherwise.
  const lookupErrorRef = useRef<string | null>(null);
  const handleLookup = async (): Promise<boolean> => {
    const ref = lookupRef.trim();
    const email = lookupEmail.trim();
    lookupErrorRef.current = null;
    if (!ref || !email) {
      lookupErrorRef.current = "Enter the booking reference and the email you booked with.";
      return false;
    }
    setLookupResult(null);
    try {
      if (ref.toUpperCase().startsWith("CR-")) {
        setLookupResult({ kind: "registration", data: await lookupRegistration(ref, email) });
      } else {
        setLookupResult({ kind: "booking", data: await lookupBooking(ref, email) });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "We couldn't find that booking. Check the reference and email.";
      lookupErrorRef.current = message;
      return false;
    }
    return true;
  };

  // --- Next Up / Coming Up: one merged, chronological set of dated plans —
  // games, centre/room bookings, Adventure bookings, and (Resident
  // Experience Polish) program enrollments with a real future session.
  // Registrations still have no single dated "next occurrence" (ongoing
  // membership, not a dated plan) and stay out, same as before — only
  // program enrollments changed, now that GET /programs/enrollments/mine
  // exposes a real nextSessionDate/nextSessionTime instead of nothing.
  // Each entity is normalized into one shape so Next Up/Coming Up don't
  // have to know which table it came from.
  type NextEntity =
    | { date: string; time: string; kind: "game"; game: Game }
    | { date: string; time: string; kind: "booking"; booking: MyBooking }
    | { date: string; time: string; kind: "experience"; booking: MyExperienceBooking }
    | { date: string; time: string; kind: "program"; enrollment: MyProgramEnrollment };

  const upcomingGames = games.filter((g) => g.date >= today && g.status !== "cancelled");
  const upcomingBookingsList = bookings.filter((b) => b.date >= today && b.status !== "cancelled");
  const upcomingExperienceBookings = experienceBookings.filter((b) => b.date >= today && b.status !== "cancelled");
  const upcomingProgramEnrollments = programEnrollments.filter((e) => isUpcomingProgramEnrollment(e, today));

  const nextEntities: NextEntity[] = [
    ...upcomingGames.map((game): NextEntity => ({ date: game.date, time: game.time, kind: "game", game })),
    ...upcomingBookingsList.map((booking): NextEntity => ({ date: booking.date, time: booking.time, kind: "booking", booking })),
    ...upcomingExperienceBookings.map((booking): NextEntity => ({ date: booking.date, time: booking.time, kind: "experience", booking })),
    ...upcomingProgramEnrollments.map((enrollment): NextEntity => ({ date: enrollment.nextSessionDate!, time: enrollment.nextSessionTime ?? "00:00", kind: "program", enrollment })),
  ].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));


  // Booking changes (cancel, reschedule, QR) live on the full list: the
  // Bookings tab for a resident, the expander for a tab-less guest.
  const openBookings = () => (resident ? setMyLifeTab("plans") : setShowAllActivity(true));

  const comingUpTotal = nextEntities.length;
  const recentEntries = participation.filter((e) => e.date < today);
  const activeIntents = intents.filter((i) => i.status === "active" || i.status === "matched");

  const isHosting = games.some((g) => g.hostResidentId === resident?.id) || circles.some((c) => c.myRole === "organiser");
  const hasActivity = upcomingRows.length > 0 || pastRows.length > 0 || regs.length > 0 || circles.length > 0 || programEnrollments.length > 0;
  const renderTab = () => (
    <div className="mlx-tab">
      {myLifeTab === "plans" && renderBookingsTab()}
      {myLifeTab === "circles" && renderCirclesTab()}
      {myLifeTab === "saved" && (
        // One page (owner 2026-10-26: no tabs inside tabs): what you saved,
        // then the hosts and places you follow.
        <>
          <section className="mlx-section" aria-labelledby="mlx-saved-h">
            <h2 className="mlx-label" id="mlx-saved-h">Saved · {favourites.length}</h2>
            <AccountTab><SavedPage /></AccountTab>
          </section>
          <section className="mlx-section" id="mlx-following" aria-labelledby="mlx-following-h" style={{ scrollMarginTop: 96 }}>
            <h2 className="mlx-label" id="mlx-following-h">Hosts &amp; places you follow · {follows.length}</h2>
            <AccountTab><FollowingPage /></AccountTab>
          </section>
        </>
      )}
      {myLifeTab === "passport" && <PassportTab />}
    </div>
  );

  // Full activity list (bookings, references, history) — the overview's
  // "View full activity" expander and the Bookings tab both render it.
  const activityListFor = () => (
    <div style={{ marginTop: 20 }}>
      {(upcomingRows.length > 0 || pastRows.length > 0) && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setBookingsView(v)}
              style={{
                border: "none", borderRadius: radius.pill, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
                background: bookingsView === v ? colors.dark : colors.panel, color: bookingsView === v ? "#fff" : colors.muted,
              }}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      {bookingsView === "calendar" && (
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: 18, marginBottom: 32, maxWidth: 420 }}>
          <MonthCalendar items={[...upcomingRows, ...pastRows]} />
        </div>
      )}
      {bookingsView === "list" && upcomingRows.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: 0 }}>UPCOMING</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            {upcomingRows.map((r) => r.el)}
          </div>
        </>
      )}
      {bookingsView === "list" && (regs.length > 0 || circles.length > 0 || programEnrollments.length > 0) && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: 0 }}>ONGOING</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            {regs.map((r) => (
              <RegistrationRow
                key={r.ref}
                registration={r}
                onCancel={() => handleCancelRegistration(r.ref, guestEmail ?? undefined)}
                cancelling={cancellingRef === r.ref}
                error={cancelErrors[r.ref]}
              />
            ))}
            {circles.map((c) => <CircleRow key={c.id} circle={c} />)}
            {programEnrollments.map((e) => <ProgramEnrollmentRow key={e.ref} enrollment={e} onChanged={reloadProgramEnrollments} />)}
          </div>
        </>
      )}
      {bookingsView === "list" && pastRows.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: 0 }}>PAST</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pastRows.map((r) => r.el)}
          </div>
        </>
      )}
    </div>
  );

  // Onboarding audit (consent pass) — a brand-new magic-link signup shows
  // this instead of the normal page until Terms are actually accepted; no
  // resident row or session exists yet (see the token-verify effect above).
  if (pendingCompletion) {
    return (
      <MagicLinkCompleteAccount
        email={pendingCompletion.email}
        completionToken={pendingCompletion.completionToken}
        onSuccess={() => finishGuestSignIn(pendingCompletion.destination)}
      />
    );
  }

  if (guestLoading || loading) {
    return (
      <section className="section-pad" style={{ maxWidth, margin: "0 auto", padding: "36px 24px 80px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Array.from({ length: 4 }, (_, i) => <RowSkeleton key={i} />)}
        </div>
      </section>
    );
  }

  // ---- Overview data (minimal photo-and-type design, owner 2026-10-25) ----
  const dayNum = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;
  const myGameIds = new Set(games.map((g) => g.id));
  const circlePlansThisWeek = circles
    .filter((c) => c.nextPlan && c.nextPlan.source === "circle" && !myGameIds.has(c.nextPlan.id))
    .filter((c) => c.nextPlan!.date >= today && c.nextPlan!.date <= irelandDaysFromToday(6));
  const titleOf = (e: (typeof nextEntities)[number]) =>
    e.kind === "game" ? e.game.activityLabel : e.kind === "booking" ? `${e.booking.centreName}${e.booking.roomName ? ` — ${e.booking.roomName}` : ""}` : e.kind === "experience" ? e.booking.title : e.enrollment.title;
  const hrefOf = (e: (typeof nextEntities)[number]) =>
    e.kind === "game" ? `/games/${e.game.id}` : e.kind === "booking" ? `/bookings/booking/${encodeURIComponent(e.booking.ref)}` : e.kind === "experience" ? `/bookings/experience/${encodeURIComponent(e.booking.ref)}` : `/programs/${e.enrollment.programId}`;
  const openEntity = (e: (typeof nextEntities)[number]) =>
    e.kind === "game"
      ? () => navigate(`/games/${e.game.id}`)
      : e.kind === "booking"
      ? () => navigate(`/bookings/booking/${encodeURIComponent(e.booking.ref)}`)
      : e.kind === "experience"
      ? () => navigate(`/bookings/experience/${encodeURIComponent(e.booking.ref)}`)
      : () => navigate(`/programs/${e.enrollment.programId}`);
  const weekEnd = irelandDaysFromToday(6);
  const thisWeekCount = nextEntities.filter((e) => e.date <= weekEnd).length;

  const bigDate = (date: string) => (date === today ? "Today" : date === tomorrow ? "Tomorrow" : shortDay(date));
  const imageOf = (e: (typeof nextEntities)[number]): string | null => {
    const src = e.kind === "game" ? e.game.imageUrl : e.kind === "booking" ? e.booking.image : e.kind === "experience" ? e.booking.imageUrl : e.enrollment.imageUrl;
    return src ? getMediaUrl(src, "hero") : null;
  };

  const metaOf = (e: (typeof nextEntities)[number]): string =>
    e.kind === "game"
      ? [e.game.centreName ? `${e.game.centreName}${e.game.area ? `, ${e.game.area}` : ""}` : e.game.locationText || "Location to be confirmed", `${e.game.joined} of ${e.game.capacity} going`].join(" · ")
      : e.kind === "booking"
      ? `Ref ${e.booking.ref} · ${euro(e.booking.totalCents / 100)}`
      : e.kind === "experience"
      ? `${e.booking.partySize} ${e.booking.partySize === 1 ? "person" : "people"} · ${euro(e.booking.totalCents / 100)}`
      : e.enrollment.listingName;
  const KIND_NAME = { game: "Session", booking: "Booking", experience: "Adventure", program: "Programme" } as const;
  const upcomingCards: UpcomingCard[] = [
    ...nextEntities.slice(0, 12).map((e, i): UpcomingCard => ({
      key: `m-${e.kind}-${i}-${e.date}`, date: e.date, dateLabel: bigDate(e.date), time: e.time,
      title: titleOf(e), meta: metaOf(e), kind: "mine", kindLabel: KIND_NAME[e.kind], image: imageOf(e), href: hrefOf(e),
    })),
    ...circlePlansThisWeek.map((c): UpcomingCard => ({
      key: `c-${c.id}`, date: c.nextPlan!.date, dateLabel: bigDate(c.nextPlan!.date), time: c.nextPlan!.time,
      title: c.name, meta: `${c.nextPlan!.spotsLeft > 0 ? `${c.nextPlan!.spotsLeft} ${c.nextPlan!.spotsLeft === 1 ? "space" : "spaces"} left` : "Full"} · not joined yet`,
      kind: "circle", kindLabel: "Your Circle",
      image: (() => { const u = getCircleCoverUrl(c); return u ? getMediaUrl(u, "card") : null; })(),
      href: `/games/${c.nextPlan!.id}`,
    })),
  ].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  // ---- Bookings tab (owner, 2026-10-25): Upcoming as photo cards by month
  // (each opens its own page, where cancel/reschedule live), memberships and
  // programmes as rows with their actions, Past as rows (review prompts),
  // and the calendar.
  const bookingCards: UpcomingCard[] = nextEntities.map((e, i) => ({
    key: `b-${e.kind}-${i}-${e.date}`, date: e.date, dateLabel: bigDate(e.date), time: e.time,
    title: titleOf(e), meta: metaOf(e), kind: "mine", kindLabel: KIND_NAME[e.kind], image: imageOf(e), href: hrefOf(e),
  }));
  const cancelledUpcoming = [
    ...bookings.filter((b) => b.status === "cancelled" && b.date >= today).map((b) => (
      <BookingRow key={`cb-${b.ref}`} booking={b} onCancel={() => undefined} cancelling={false} error={cancelErrors[b.ref]} />
    )),
    ...games.filter((g) => g.status === "cancelled" && g.date >= today).map((g) => <GameRow key={`cg-${g.id}`} game={g} />),
    ...experienceBookings.filter((b) => b.status === "cancelled" && b.date >= today).map((b) => <ExperienceBookingRow key={`ce-${b.ref}`} booking={b} onChanged={reloadExperienceBookings} />),
  ];
  const memberships = regs.length + programEnrollments.length;
  const pastByMonth: { key: string; label: string; els: JSX.Element[] }[] = [];
  for (const r of pastRows) {
    const key = r.date.slice(0, 7);
    let m = pastByMonth.find((x) => x.key === key);
    if (!m) {
      m = { key, label: new Date(`${r.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" }), els: [] };
      pastByMonth.push(m);
    }
    m.els.push(r.el);
  }

  // Two of your plans starting at the same time on the same day. Only exact
  // start times: durations aren't always known, so no "overlaps" guessing.
  const sameStart = (() => {
    const m = new Map<string, number>();
    for (const e of nextEntities) if (e.time && e.time !== "00:00") m.set(`${e.date} ${e.time}`, (m.get(`${e.date} ${e.time}`) ?? 0) + 1);
    return [...m.entries()].filter(([, n]) => n > 1).map(([k, count]) => ({ date: k.slice(0, 10), time: k.slice(11), count }));
  })();

  // My Plans (owner 2026-10-26: no tabs inside tabs): one page, 70/30.
  // Main: what's coming up by month, memberships, cancelled, past (latest
  // month first, then "Show all past"), your routines. Side: this month,
  // this week and links. Old ?view= links scroll to their section.
  // Default: the 5 most recent past items; "Show all past" for the rest.
  const latestPast = pastByMonth.slice(0, 1).map((m) => ({ ...m, els: m.els.slice(0, 5) }));
  const thisWeekPlans = nextEntities.filter((e) => e.date <= weekEnd);
  const renderBookingsTab = () => (
    <div className="mlx-split">
      <div className="mlx-main">
        {sameStart.length > 0 && (
          <p className="mlx-muted" role="note">
            {sameStart.map((c) => `${c.count} of your plans start at ${c.time} on ${bigDate(c.date)}`).join(". ")}. Check you can make them all.
          </p>
        )}
        <section className="mlx-section" id="mlx-plans-upcoming" aria-labelledby="mlx-plans-up">
          <div className="mlx-section-head">
            <h2 className="mlx-label" id="mlx-plans-up">Coming up</h2>
            <span className="mlx-muted" style={{ fontSize: 14 }}>{nextEntities.length} booked or joined</span>
          </div>
          {bookingCards.length > 0 ? <UpcomingByMonth cards={bookingCards} /> : <NothingBooked hasIdeas={false} onFind={() => navigate("/explore")} />}
        </section>

        {memberships > 0 && (
          <section className="mlx-section" aria-labelledby="mlx-memberships">
            <h2 className="mlx-label" id="mlx-memberships">Club memberships and programmes</h2>
            <div className="mlx-past">
              {regs.map((r) => (
                <RegistrationRow
                  key={r.ref}
                  registration={r}
                  onCancel={() => handleCancelRegistration(r.ref, guestEmail ?? undefined)}
                  cancelling={cancellingRef === r.ref}
                  error={cancelErrors[r.ref]}
                />
              ))}
              {programEnrollments.map((e) => <ProgramEnrollmentRow key={e.ref} enrollment={e} onChanged={reloadProgramEnrollments} />)}
            </div>
          </section>
        )}

        {cancelledUpcoming.length > 0 && (
          <section className="mlx-section" aria-labelledby="mlx-cancelled">
            <h2 className="mlx-label" id="mlx-cancelled">Cancelled</h2>
            <div className="mlx-past">{cancelledUpcoming}</div>
          </section>
        )}

        <section className="mlx-section" id="mlx-plans-past" aria-labelledby="mlx-past-h" style={{ scrollMarginTop: 96 }}>
          <div className="mlx-section-head">
            <h2 className="mlx-label" id="mlx-past-h">Past</h2>
            {pastRows.length > 5 && (
              <button type="button" className="mlx-link" aria-expanded={showAllPast} onClick={() => setShowAllPast((v) => !v)}>
                {showAllPast ? "Show less" : `Show all past (${pastRows.length})`}
              </button>
            )}
          </div>
          {pastByMonth.length === 0 ? (
            <p className="mlx-muted">Things you've booked or joined show here once their date has passed.</p>
          ) : (
            <div className="mlx-months">
              {(showAllPast ? pastByMonth : latestPast).map((m) => (
                <section key={m.key} className="mlx-month" aria-labelledby={`mlx-p-${m.key}`}>
                  <h3 className="mlx-month-title" id={`mlx-p-${m.key}`}>{m.label} <span>{m.els.length}</span></h3>
                  <div className="mlx-past">{m.els}</div>
                </section>
              ))}
            </div>
          )}
        </section>

        <section className="mlx-section" id="mlx-plans-routines" aria-labelledby="mlx-routines-h" style={{ scrollMarginTop: 96 }}>
          <h2 className="mlx-label" id="mlx-routines-h">Your routines</h2>
          {signals.routines.length > 0 && (
            <ul className="mlx-plans">
              {signals.routines.map((r) => (
                <li key={r.routineId}>
                  <strong>{r.matches.length} {r.activityLabel} {r.matches.length === 1 ? "session fits" : "sessions fit"} your {DAY_NAMES[r.dayOfWeek - 1]} routine</strong>
                  <Link className="mlx-link" to={r.matches[0].href}>{bigDate(r.matches[0].date)} · {r.matches[0].time}</Link>
                </li>
              ))}
            </ul>
          )}
          <AccountTab><RoutinesPage key={routinesKey} /></AccountTab>
        </section>
      </div>

      <aside className="mlx-aside" aria-label="Calendar and links">
        <MiniCalendar days={calendarDays} onOpen={() => document.getElementById("mlx-plans-upcoming")?.scrollIntoView({ block: "start" })} />
        <section className="mlx-section" id="mlx-plans-week" aria-labelledby="mlx-plans-thisweek" style={{ scrollMarginTop: 96 }}>
          <h2 className="mlx-label" id="mlx-plans-thisweek">This week</h2>
          {thisWeekPlans.length === 0 ? (
            <p className="mlx-muted" style={{ fontSize: 14 }}>Nothing booked this week yet.</p>
          ) : (
            <ul className="mlx-plans">
              {thisWeekPlans.map((e, i) => (
                <li key={`pw-${i}`}>
                  <button type="button" className="mlx-week-item" onClick={openEntity(e)}>
                    <strong>{titleOf(e)}</strong>
                    <span>{bigDate(e.date)}{e.time && e.time !== "00:00" ? ` · ${e.time}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <MoreLinks
          title="Bookings & payments"
          links={[
            { label: "Find a booking by reference", onClick: () => setLookupOpen(true) },
            { label: "Payments & receipts", onClick: () => navigate("/profile?tab=payment") },
            { label: "Add a routine", onClick: () => setRoutineOpen(true) },
          ]}
        />
      </aside>
    </div>
  );

  // ---- Circles tab: every Circle as a photo card with its next meetup.
  const circleCards: CircleCard[] = circles.map((c) => {
    const plan = c.nextPlan && c.nextPlan.source === "circle" ? c.nextPlan : null;
    const cover = getCircleCoverUrl(c);
    return {
      key: c.id,
      name: c.name,
      meta: [c.activityLabel, c.area || c.county, `${c.members} ${c.members === 1 ? "member" : "members"}`].filter(Boolean).join(" · "),
      image: cover ? getMediaUrl(cover, "card") : null,
      organiser: c.myRole === "organiser",
      next: plan ? `${bigDate(plan.date)} · ${plan.time}` : null,
      planning: c.activePlan ? c.activePlan.title : null,
      href: `/circles/${c.slug ?? c.id}`,
    };
  });
  // ---- Recently (overview): by day, with the Session's or venue's photo.
  const RECENT_KIND: Record<string, string> = { game: "Session", booking: "Booking", registration: "Club", program_enrollment: "Programme", circle: "Joined a Circle" };
  const recentItems: RecentItem[] = recentEntries.map((e) => {
    const src = e.kind === "game" ? games.find((g) => g.id === e.ref)?.imageUrl : e.kind === "booking" ? bookings.find((b) => b.ref === e.ref)?.image : null;
    return {
      key: `${e.kind}-${e.ref}`,
      date: e.date.slice(0, 10),
      title: e.title,
      // The day is shown on the left, so drop a leading "YYYY-MM-DD" here.
      detail: e.subtitle.replace(/^\d{4}-\d{2}-\d{2}[ T·]*/, ""),
      kindLabel: RECENT_KIND[e.kind] ?? "Activity",
      image: src ? getMediaUrl(src, "thumbnail") : null,
      href: e.href,
      cancelled: e.status === "cancelled",
    };
  });

  const circleTodo = needsAttention.filter((n) => n.actionType === "open_poll" || n.actionType === "circle_invitation" || n.actionType === "join_request" || n.actionType === "plan_confirmation" || n.actionType === "plan_activity_creation");
  // A function: it reads values computed further down, at render time.
  const suggestedBlock = () => suggestedCircles.length > 0 && (
    <section className="mlx-section" aria-labelledby="mlx-sugg-circles">
      <div className="mlx-section-head">
        <h2 className="mlx-label" id="mlx-sugg-circles">Circles you might like</h2>
        <Link className="mlx-link" to="/circles">Browse all</Link>
      </div>
      <CircleCards
        row
        onFindMore={() => navigate("/circles")}
        circles={suggestedCircles.map((nc) => ({
          key: `s-${nc.id}`, name: nc.name, meta: `${nc.activityLabel} · ${nc.members} ${nc.members === 1 ? "member" : "members"}`,
          image: nc.imageUrl ? getMediaUrl(nc.imageUrl, "card") : null, organiser: false, next: null, planning: null, href: `/circles/${nc.slug ?? nc.id}`,
        }))}
      />
    </section>
  );
  const renderCirclesTab = () =>
    circles.length > 0 ? (
      <>
        <div className="mlx-tab-head">
          <div>
            <p className="mlx-pulse-line">{circlePulseParts.length > 0 ? circlePulseParts.join(" · ") : "All quiet in your Circles this week."}</p>
            <p className="mlx-muted" style={{ marginTop: 4 }}>{circles.length} {circles.length === 1 ? "Circle" : "Circles"} you're part of{circles.some((c) => c.myRole === "organiser") ? `, ${circles.filter((c) => c.myRole === "organiser").length} you organise` : ""}.</p>
          </div>
          {circles.some((c) => c.myRole === "organiser") && <button type="button" className="mlx-link" onClick={() => navigate("/manage")}>Manage your Circles</button>}
        </div>
        {circleTodo.length > 0 && (
          <section className="mlx-section" aria-labelledby="mlx-circle-todo">
            <h2 className="mlx-label" id="mlx-circle-todo">Waiting for you</h2>
            <ul className="mlx-plans">
              {circleTodo.map((n) => (
                <li key={n.id}>
                  <span>
                    <strong style={{ display: "block" }}>{n.title}</strong>
                    <span>{n.description}</span>
                  </span>
                  <Link className="mlx-link" to={n.actionUrl} onClick={(e) => { if (openInPlace(n)) e.preventDefault(); }}>{n.actionLabel}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <CircleCards circles={circleCards} onFindMore={() => navigate("/circles")} />
        {suggestedBlock()}
      </>
    ) : (
      <>
        <div className="mlx-nothing">
          <h2 className="mlx-nothing-title">Find people who enjoy what you enjoy.</h2>
          <p className="mlx-muted">A Circle is a group that meets around a shared activity. Joining is free.</p>
          <div><button type="button" className="mlx-btn" onClick={() => navigate("/circles")}>Browse Circles</button></div>
        </div>
        {suggestedBlock()}
      </>
    );

  // On the day of a room booking: the check-in code right under the cards.
  const todaysBooking = nextEntities.find((e) => e.kind === "booking" && e.date === today);

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // "Do it again" (real repeat detection on the server): a photo from one of
  // your own Sessions of that activity when there is one.
  const photoFor = (label: string) => {
    const g = games.find((x) => x.activityLabel === label && x.imageUrl);
    return g?.imageUrl ? getMediaUrl(g.imageUrl, "card") : null;
  };
  const ideaTiles: IdeaTile[] = routineSuggestions.slice(0, 3).map((r): IdeaTile => ({
    key: `r-${r.activityLabel}-${r.dayOfWeek}`, kind: "again", title: r.activityLabel,
    meta: `You've been going most ${DAY_NAMES[r.dayOfWeek - 1]}s${r.time ? ` · usually around ${r.time}` : ""} · ${r.sessionCount} times recently`,
    image: photoFor(r.activityLabel),
    href: `/games?activity=${encodeURIComponent(r.activityLabel)}`,
  }));

  // "Your activity": real participation dates only (never a fabricated streak).
  const monthStart = irelandMonthStart();
  const monthEntries = participation.filter((e) => e.date >= monthStart && e.date <= today && e.status !== "cancelled");
  const weeksActive = Array.from({ length: 8 }, (_, i) => {
    const weeksAgo = 7 - i;
    return participation.some((e) => {
      const ago = Math.floor((dayNum(today) - dayNum(e.date)) / 7);
      return e.status !== "cancelled" && ago === weeksAgo && e.date <= today;
    });
  });
  const hasActivityStats = monthEntries.length > 0 || weeksActive.some(Boolean);
  // Life highlights: real counts only.
  const joinedOn = (from: string, to: string) => participation.filter((e) => e.status !== "cancelled" && e.date >= from && e.date <= to).length;
  const prevMonthStart = (() => { const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`; })();
  const prevMonthEnd = irelandDaysFromToday(-(dayNum(today) - dayNum(monthStart)) - 1);
  const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
  const weekBars = Array.from({ length: 8 }, (_, i) => {
    const weeksAgo = 7 - i;
    const end = irelandDaysFromToday(-7 * weeksAgo);
    const start = irelandDaysFromToday(-7 * weeksAgo - 6);
    return { label: weeksAgo === 0 ? "This wk" : shortDate(start), count: joinedOn(start, end), current: weeksAgo === 0 };
  });
  const topThisMonth = (() => {
    const m = new Map<string, number>();
    for (const e of monthEntries) m.set(e.title, (m.get(e.title) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, count]) => ({ title, count }));
  })();
  const monthName = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", timeZone: "Europe/Dublin" });

  // ---- For You (My Life 3.0) ------------------------------------------------
  const NA_SOURCE: Record<NeedsAttentionItem["actionType"], string> = {
    payment_incomplete: "Booking", waitlist_offered: "Waitlist", join_request: "Your Circle", circle_invitation: "Invite",
    plan_activity_creation: "Your Circle", plan_confirmation: "Your Circle", open_poll: "Poll",
  };
  const pulseItems: PulseItem[] = [
    // Things that need an answer: payments and offered places are critical (first, never hidden).
    ...needsAttention.map((n): PulseItem => ({
      key: `pulse:na:${n.id}`, source: NA_SOURCE[n.actionType], title: n.title, context: n.description, when: n.dueAt ?? n.createdAt,
      actionLabel: n.actionLabel, href: n.actionUrl, critical: n.actionType === "payment_incomplete" || n.actionType === "waitlist_offered",
      onAction: pollTargetOf(n) ? () => setVotingOn(n) : undefined,
    })),
    ...chatInbox
      .filter((c) => c.scopeType === "circle" && c.unread > 0)
      .map((c): PulseItem => ({
        key: `pulse:chat:${c.scopeId}:${c.lastMessage?.createdAt ?? ""}`.replace(/[^a-z0-9_:.\-]/gi, ""), source: "Discussion", title: c.title,
        context: c.lastMessage ? `New messages in your Circle chat` : "New messages", when: c.lastMessage?.createdAt ?? null,
        actionLabel: "Join discussion", href: c.href, critical: false, unread: c.unread,
      })),
    ...signals.routines.map((r): PulseItem => ({
      key: `pulse:routine:${r.routineId}:${r.matches[0].id}`, source: "Routine",
      title: `${r.matches.length} ${r.activityLabel} ${r.matches.length === 1 ? "session fits" : "sessions fit"} your ${DAY_NAMES[r.dayOfWeek - 1]} routine`,
      context: `First: ${bigDate(r.matches[0].date)} · ${r.matches[0].time}`, when: null, actionLabel: "View", href: r.matches[0].href, critical: false,
    })),
    ...followFeed.slice(0, 3).map((f): PulseItem => ({
      key: `pulse:follow:${f.kind}:${f.id}`, source: "Following", title: f.title, context: `New session · ${bigDate(f.date)} · ${f.time}`,
      when: null, actionLabel: "View", href: f.href, critical: false,
    })),
    ...signals.saved
      .filter((sv) => !nextEntities.some((e) => e.kind === "game" && e.game.id === sv.next.id))
      .map((sv): PulseItem => ({
        key: `pulse:saved:${sv.listingType}:${sv.listingId}:${sv.next.id}`, source: "Saved", title: sv.next.title,
        context: sv.spotsLeft !== null ? `${sv.spotsLeft} ${sv.spotsLeft === 1 ? "place" : "places"} left · ${bigDate(sv.next.date)}` : `${sv.upcoming} upcoming · next ${bigDate(sv.next.date)} ${sv.next.time}`,
        when: null, actionLabel: "View", href: sv.next.href, critical: false,
      })),
  ]
    .filter((p) => p.critical || !dismissed.has(p.key))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || Number(!!b.unread) - Number(!!a.unread));

  const REASON: Record<string, string> = {
    for_you: "Matches your interests", when_free: "Fits when you're free", this_weekend: "This weekend", from_circles: "From your Circles",
    near_you: "Near you", free_nearby: "Free, nearby", try_new: "Something new", come_alone: "Come-alone friendly", easy: "Easy to join", volunteer: "Give back",
  };
  const ORDER = ["for_you", "when_free", "this_weekend", "from_circles", "near_you", "try_new", "free_nearby", "come_alone", "easy", "volunteer"];
  const suggestions: Suggestion[] = (() => {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const key of ORDER) {
      const sec = forYou.find((f) => f.key === key);
      for (const it of sec?.items ?? []) {
        const id = `${it.kind}:${it.id}`;
        const dk = `sugg:${it.kind}:${it.id}`;
        if (seen.has(id) || dismissed.has(dk) || myGameIds.has(it.id)) continue;
        seen.add(id);
        out.push({
          key: id, dismissKey: dk, date: it.date, dateLabel: bigDate(it.date), time: it.time, title: it.title,
          meta: [it.centreName ?? it.clubName ?? it.area, it.priceCents ? euro(it.priceCents / 100) : "Free"].filter(Boolean).join(" · "),
          kind: "mine", kindLabel: "", reason: it.matchReasons?.[0] ?? REASON[key] ?? sec!.title,
          image: it.imageUrl ? getMediaUrl(it.imageUrl, "card") : null,
          href: it.href,
          onTrack: () => trackEvent("mylife_suggestion_opened", { section: key }),
        });
        if (out.length >= 8) return out;
      }
    }
    return out;
  })();

  const lastActive = participation.filter((e) => e.date <= today && e.status !== "cancelled").map((e) => e.date).sort().pop() ?? null;
  const longAgo = lastActive ? dayNum(today) - dayNum(lastActive) > 21 : false;
  const nextOne = nextEntities[0];
  const heroMessage: ReactNode = !resident ? null : nextOne ? (
    <>You've got something good coming up: <a href="#mlx-upcoming-title" onClick={(e) => { e.preventDefault(); openEntity(nextOne)(); }}>{titleOf(nextOne)}, {bigDate(nextOne.date).toLowerCase() === "today" || bigDate(nextOne.date).toLowerCase() === "tomorrow" ? bigDate(nextOne.date).toLowerCase() : bigDate(nextOne.date)}</a>.</>
  ) : hasNone ? (
    "Your next good day starts here."
  ) : longAgo ? (
    "Something new is happening around you."
  ) : (
    "Nothing booked yet. Here are a few ideas for this week."
  );
  const kicker = resident ? new Date(`${today}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" }) : undefined;

  const circlePolls = needsAttention.filter((n) => n.actionType === "open_poll").length;
  const circleInvites = needsAttention.filter((n) => n.actionType === "circle_invitation").length;
  const circleUnread = chatInbox.filter((c) => c.scopeType === "circle").reduce((n, c) => n + c.unread, 0);
  const circleMeetups = circles.filter((c) => c.nextPlan && c.nextPlan.source === "circle" && c.nextPlan.date <= weekEnd).length;
  const circlePulseParts = [
    circleMeetups ? `${circleMeetups} ${circleMeetups === 1 ? "meetup" : "meetups"} this week` : null,
    circleUnread ? `${circleUnread} unread ${circleUnread === 1 ? "message" : "messages"}` : null,
    circlePolls ? `${circlePolls} ${circlePolls === 1 ? "poll" : "polls"} waiting` : null,
    circleInvites ? `${circleInvites} ${circleInvites === 1 ? "invitation" : "invitations"}` : null,
  ].filter(Boolean) as string[];
  const plansInCircles = circles.filter((c) => c.activePlan);
  const thisWeekEntities = nextEntities.filter((e) => e.date <= weekEnd);
  const calendarDays = new Set([...nextEntities.map((e) => e.date), ...circlePlansThisWeek.map((c) => c.nextPlan!.date)]);
  const suggestedCircles = newHereCircles.filter((nc) => !circles.some((c) => c.id === nc.id)).slice(0, 4);

  const moreLinks = [
    ...(isHosting ? [{ label: "Manage your hosting", onClick: () => navigate("/manage") }] : []),
    ...(experience["experience.plan_my_day"] ? [{ label: "Plan a day", onClick: () => navigate("/plan-my-day") }] : []),
    ...(experience["experience.activity_passport"] ? [{ label: "Your Activity Passport", onClick: () => (experience["mylife.passport_tab"] ? setMyLifeTab("passport") : navigate("/my-life/passport")) }] : []),
    ...(resident ? [
      { label: "Routines", onClick: () => navigate("/bookings?tab=plans&view=routines") },
      ...(experience["mylife.for_you"] ? [{ label: "For Me: more ideas", onClick: () => navigate("/my-life/for-you") }] : []),
      { label: "Free time", onClick: () => navigate("/free-time") },
      { label: "Your preferences", onClick: () => setPrefsOpen(true) },
    ] : []),
  ];

  const summary = resident
    ? [
        thisWeekCount > 0 ? `${thisWeekCount} ${thisWeekCount === 1 ? "thing" : "things"} this week` : "Nothing booked this week",
        circles.length > 0 ? `${circles.length} ${circles.length === 1 ? "Circle" : "Circles"}` : null,
      ].filter(Boolean).join(" · ")
    : null;

  const headActions = (
    <>
      <button type="button" className="mlx-link" onClick={() => setLookupOpen(true)}>Find a booking</button>
      {resident ? (
        <ActionMenu
          label="More for My Life"
          appearance="icon"
          items={[
            { label: "Edit profile", onSelect: () => navigate("/profile") },
            ...(guestEmail ? [{ label: "Sign out", onSelect: () => setConfirmingSignOut(true) }] : []),
          ]}
        />
      ) : guestEmail ? (
        <button type="button" className="mlx-link" onClick={() => setConfirmingSignOut(true)}>Sign out</button>
      ) : null}
    </>
  );

  const passportTabOn = experience["mylife.passport_tab"] && experience["experience.activity_passport"];
  const tabOptions = MY_LIFE_TABS.filter((t) => t.key !== "passport" || passportTabOn).map((t) => ({
    ...t,
    count: t.key === "plans" ? nextEntities.length : t.key === "circles" ? circles.length : t.key === "saved" ? favourites.length + follows.length : undefined,
  }));

  return (
    <div className="mlx">
      <MyLifeTitle name={resident?.name ?? null} summary={summary} actions={headActions} kicker={kicker} message={heroMessage} />
      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out?"
        message="You'll need to sign back in to see your bookings, Circles and saved things."
        confirmLabel={signingOut ? "…" : "Sign out"}
        tone="neutral"
        busy={signingOut}
        onConfirm={handleSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
      {/* Owner 2026-10-24: forms open in a centred popup, never inline. */}
      <FormModal
        open={lookupOpen}
        title="Find a booking"
        subtitle="Use the reference from your confirmation email and the email you booked with."
        submitLabel="Find booking"
        dirty={false}
        onClose={() => setLookupOpen(false)}
        onSubmit={async () => {
          const ok = await handleLookup();
          if (!ok) throw new Error(lookupErrorRef.current ?? "We couldn't find that booking. Check the reference and email.");
        }}
      >
        <div>
          <label htmlFor="lookup-ref" style={labelStyle}>Reference</label>
          <input id="lookup-ref" value={lookupRef} onChange={(e) => setLookupRef(e.target.value)} placeholder="HB-123456" autoComplete="off" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lookup-email" style={labelStyle}>Email</label>
          <input id="lookup-email" type="email" value={lookupEmail} onChange={(e) => setLookupEmail(e.target.value)} placeholder="you@email.ie" autoComplete="email" style={inputStyle} />
        </div>
      </FormModal>

      {resident && (
        <>
          <PollVoteModal
            item={votingOn}
            onClose={(voted) => {
              setVotingOn(null);
              // A vote takes the poll off "Needs you"; refresh just that list.
              if (voted) fetchNeedsAttention().then(setNeedsAttention).catch(() => {});
            }}
          />
          <PreferencesModal
            open={prefsOpen}
            onClose={() => setPrefsOpen(false)}
            interests={residentFull?.interests ?? []}
            availability={residentFull?.availability ?? []}
            onSaved={() => {
              toastApi.success("Saved");
              fetchResidentFull().then(({ resident: r }) => setResidentFull(r)).catch(() => {});
              if (experience["mylife.for_you"]) fetchForYou().then((r) => setForYou(r.sections)).catch(() => {});
            }}
          />
          <AddRoutineModal
            open={routineOpen}
            onClose={() => setRoutineOpen(false)}
            onAdded={() => {
              setRoutineOpen(false);
              setRoutinesKey((k) => k + 1);
              fetchRoutineSuggestions().then(setRoutineSuggestions).catch(() => {});
              if (experience["mylife.pulse"]) fetchMyLifeSignals().then(setSignals).catch(() => {});
            }}
          />
          <AddInterestModal
            open={interestOpen}
            onClose={() => setInterestOpen(false)}
            county={resident.homeCounty || ""}
            onAdded={() => {
              toastApi.success("Added. We'll let you know when something matches.");
              void loadMyStuff();
            }}
          />
        </>
      )}
      {resident && (
        <div className="mlx-tabs">
          <SegmentedTabs<MyLifeTab> label="My Life" value={myLifeTab} onChange={setMyLifeTab} options={tabOptions} />
        </div>
      )}

      {resident && myLifeTab !== "foryou" ? (
        renderTab()
      ) : (
      <>
      <div className="mlx-body">
        {verifying && <div className="mlx-note" role="status"><p><strong>Signing you in…</strong></p></div>}
        {verifyError && <div className="mlx-note" role="alert"><p><strong style={{ color: colors.danger }}>{verifyError}</strong></p></div>}

        {/* HC-QA-064 — a failed session/profile check is an error with a
            retry, never a "Sign in" prompt for someone who is signed in. */}
        {guestLoadError && !resident && (
          <LoadErrorState title="We couldn't load your account right now." detail="You're still signed in — this is usually temporary." onRetry={() => void refreshGuest()} />
        )}
        {/* PUB-33 — one signed-out state: this is the page's heading and
            primary action. */}
        {!guestEmail && !guestLoadError && (
          <div className="mlx-note">
            <p><strong>Sign in to see your life</strong><span>Your plans, Circles and history, all in one place.</span></p>
            <div className="mlx-note-actions">
              <button type="button" className="mlx-btn" onClick={() => navigate("/signin")}>Sign in</button>
              {hasNone && <button type="button" className="mlx-link" onClick={() => navigate("/explore")}>Explore HelloCircle</button>}
            </div>
          </div>
        )}

        {lookupResult && (
          <div>
            {lookupResult.kind === "booking" ? (
              <BookingRow
                booking={lookupResult.data}
                onCancel={() => handleCancelBooking(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
                lookupEmail={lookupEmail.trim()}
              />
            ) : (
              <RegistrationRow
                registration={lookupResult.data}
                onCancel={() => handleCancelRegistration(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
                lookupEmail={lookupEmail.trim()}
              />
            )}
          </div>
        )}

        {failedSources > 0 && !loading && (
          <LoadErrorState
            title="Some of your activity couldn't load."
            detail="What's shown below may be incomplete — nothing has been cancelled or changed."
            onRetry={() => void loadMyStuff()}
          />
        )}
        {resident && <MyInvitationsPanel />}

        {hasNone && resident ? (
          // New user (My Life 3.0): real things to do first, then the steps.
          <>
            <FreeTimePrompt planDay={experience["experience.plan_my_day"]} forMe={experience["mylife.for_you"]} />
            {experience["mylife.for_you"] && <MadeForWeek title="On soon near you" items={suggestions} onDismiss={dismiss} seeAll={<Link className="mlx-link" to="/my-life/for-you">For Me</Link>} />}
            <MyLifeEmptyState />
          </>
        ) : hasNone && !resident ? (
          guestEmail ? (
            <div className="mlx-nothing">
              <h2 className="mlx-nothing-title">Nothing here yet.</h2>
              <p className="mlx-muted">Find a hall, club or plan to get started.</p>
              <div><button type="button" className="mlx-btn" onClick={() => navigate("/explore")}>Explore HelloCircle</button></div>
            </div>
          ) : null
        ) : (
          <div className="mlx-split">
          <div className="mlx-main">
            {/* Trust & Retention — the nearest commitment leads the page, then recent visits (attendance, review, go again). */}
            <NextPlanSection onSeeAll={openBookings} />
            {resident && residentFull && residentFull.interests.length === 0 && !interestsNudgeDismissed && (
              <div className="mlx-note">
                <p><strong>Tell us what you're into</strong><span>It takes under a minute and makes your suggestions fit you.</span></p>
                <div className="mlx-note-actions">
                  <button type="button" className="mlx-btn" onClick={() => openOnboarding()}>Get started</button>
                  <button
                    type="button"
                    className="mlx-link"
                    onClick={() => {
                      try { localStorage.setItem(INTERESTS_NUDGE_DISMISSED_KEY, "1"); } catch { /* private mode: dismiss for this visit only */ }
                      setInterestsNudgeDismissed(true);
                    }}
                  >
                    Not now
                  </button>
                </div>
              </div>
            )}

            {resident && !phone && <FreeTimePrompt planDay={experience["experience.plan_my_day"]} forMe={experience["mylife.for_you"]} />}

            {experience["mylife.pulse"] ? (
              <PulseList items={pulseItems} onDismiss={dismiss} onOpen={(it) => trackEvent("mylife_pulse_opened", { source: it.source })} />
            ) : (
              <NeedsList items={needsAttention} onAction={openInPlace} />
            )}

            {/* Your next moments: a horizontal row of photo cards. */}
            <section className="mlx-upcoming" aria-labelledby="mlx-upcoming-title">
              <div className="mlx-section-head">
                <h2 className="mlx-label" id="mlx-upcoming-title">Your next moments</h2>
                {upcomingRows.length > 0 && <button type="button" className="mlx-link" onClick={openBookings}>My Plans</button>}
              </div>
              {upcomingCards.length > 0 ? (
                <UpcomingCards cards={upcomingCards} />
              ) : (
                <NothingBooked hasIdeas={suggestions.length > 0 || ideaTiles.length > 0} onFind={() => navigate("/explore")} />
              )}
              {todaysBooking && todaysBooking.kind === "booking" && (
                <div className="mlx-checkin">
                  <BookingQr reference={todaysBooking.booking.ref} />
                  <div style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 13, color: colors.mutedLight }}>Today · show this at the door</span>
                    <strong style={{ fontSize: 15 }}>{titleOf(todaysBooking)} · {todaysBooking.booking.ref}</strong>
                    <button type="button" className="mlx-link" style={{ justifySelf: "start" }} onClick={() => downloadBookingIcs(todaysBooking.booking.ref)}>Add to calendar</button>
                  </div>
                </div>
              )}
            </section>

            {/* Circles 3.0 — Circle plans you're in, labelled Booked / booking required / interested. */}
            {resident && <MyCirclePlans />}

            {resident && phone && <FreeTimePrompt planDay={experience["experience.plan_my_day"]} forMe={experience["mylife.for_you"]} />}

            {circles.length > 0 && (
              <section id="my-circles" className="mlx-section" aria-labelledby="mlx-circles" style={{ scrollMarginTop: 96 }}>
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-circles">Your Circles</h2>
                  <button type="button" className="mlx-link" onClick={() => setMyLifeTab("circles")}>My Circles</button>
                </div>
                {circlePulseParts.length > 0 && <p className="mlx-pulse-line">{circlePulseParts.join(" · ")}</p>}
                <CircleCards circles={circleCards} onFindMore={() => navigate("/circles")} row />
              </section>
            )}

            {experience["mylife.for_you"] && (
              <MadeForWeek
                items={suggestions}
                onDismiss={dismiss}
                seeAll={<Link className="mlx-link" to="/my-life/for-you">For Me</Link>}
              />
            )}

            <IdeaTiles tiles={ideaTiles} title="Do it again" />

            {/* Only when a Circle has a plan in progress (owner 2026-10-26: it
                repeated "Plan a day", which the free time panel and Quick
                actions already offer). */}
            {resident && plansInCircles.length > 0 && (
              <section className="mlx-section mlx-boxed" aria-labelledby="mlx-together">
                <h2 className="mlx-label" id="mlx-together">Plans in your Circles</h2>
                <ul className="mlx-plans">
                  {plansInCircles.map((c) => (
                    <li key={c.id}>
                      <span>
                        <strong style={{ display: "block" }}>{c.activePlan!.title}</strong>
                        <span>{c.name} · {c.activePlan!.status === "confirmed" ? "Agreed" : "Idea"}{c.activePlan!.proposedDate ? ` · ${bigDate(c.activePlan!.proposedDate)}` : ""}</span>
                      </span>
                      <Link className="mlx-link" to={`/circles/${c.slug ?? c.id}`}>See the plan</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <MyLifePlans />

            {hasActivityStats && (
              <ActivitySummary
                monthName={monthName}
                month={monthEntries.length}
                lastMonth={joinedOn(prevMonthStart, prevMonthEnd)}
                distinct={new Set(monthEntries.map((e) => e.title)).size}
                weeks={weekBars}
                top={topThisMonth}
                onSeeAll={openBookings}
                extra={passportTabOn ? <button type="button" className="mlx-link" onClick={() => setMyLifeTab("passport")}>Passport</button> : undefined}
              />
            )}

            {recentEntries.length > 0 && (
              <section className="mlx-section" aria-labelledby="mlx-recent">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-recent">Recently</h2>
                  <button type="button" className="mlx-link" onClick={openBookings}>All activity</button>
                </div>
                <RecentByDay items={recentItems} />
              </section>
            )}

            {/* Full history for a visitor without tabs (guest bookings by
                device or email): cancel, reschedule, QR check-in and reviews
                stay reachable. Residents use My Plans. */}
            {!resident && (
              <section id="my-bookings" className="mlx-section" style={{ scrollMarginTop: 96 }}>
                <button
                  type="button"
                  className="mlx-link"
                  aria-expanded={showAllActivity}
                  onClick={() => setShowAllActivity((v) => !v)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start" }}
                >
                  <ChevronRightIcon size={14} style={{ transform: showAllActivity ? "rotate(90deg)" : "none" }} />
                  {showAllActivity ? "Hide" : "Show"} all bookings, references and history
                </button>
                {showAllActivity && activityListFor()}
              </section>
            )}
          </div>

          {/* 70/30: the side column complements the main one (owner 2026-10-25). */}
          <aside className="mlx-aside" aria-label="This week and quick actions">
            {resident && <MiniCalendar days={calendarDays} onOpen={() => navigate("/bookings?tab=plans&view=calendar")} />}
            {resident && (
              <section className="mlx-section" aria-labelledby="mlx-thisweek">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-thisweek">This week</h2>
                  <button type="button" className="mlx-link" onClick={() => navigate("/bookings?tab=plans&view=week")}>Week</button>
                </div>
                {thisWeekEntities.length === 0 ? (
                  <p className="mlx-muted" style={{ fontSize: 14 }}>Nothing booked this week yet.</p>
                ) : (
                  <ul className="mlx-plans">
                    {thisWeekEntities.slice(0, 5).map((e, i) => (
                      <li key={`tw-${i}`}>
                        <span>
                          <strong style={{ display: "block", fontSize: 15 }}>{titleOf(e)}</strong>
                          <span>{bigDate(e.date)}{e.time && e.time !== "00:00" ? ` · ${e.time}` : ""}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <MoreLinks links={moreLinks} title="Quick actions" />
            {activeIntents.length > 0 && (
              <section className="mlx-section" aria-labelledby="mlx-waiting">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-waiting">Waiting for</h2>
                  <button type="button" className="mlx-link" onClick={() => setInterestOpen(true)}>Add another</button>
                </div>
                <MyLifeWaitingFor intents={activeIntents.slice(0, 2)} onChange={loadMyStuff} />
              </section>
            )}
            {favourites.length > 0 && (
              <section className="mlx-section" aria-labelledby="mlx-saved">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-saved">Saved ideas</h2>
                  <button type="button" className="mlx-link" onClick={() => setMyLifeTab("saved")}>View all</button>
                </div>
                <MyLifeSaved favourites={favourites.slice(0, 4)} />
              </section>
            )}
            {follows.length > 0 && (
              <section className="mlx-section" aria-labelledby="mlx-following">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-following">Following</h2>
                  <button type="button" className="mlx-link" onClick={() => navigate("/bookings?tab=saved&show=following")}>View all</button>
                </div>
                <MyLifeFollowing follows={follows} />
              </section>
            )}
            {residentFull && (residentFull.interests.length > 0 || residentFull.availability.length > 0) && (
              <section className="mlx-section" aria-labelledby="mlx-prefs">
                <div className="mlx-section-head">
                  <h2 className="mlx-label" id="mlx-prefs">Your preferences</h2>
                  <button type="button" className="mlx-link" onClick={() => setPrefsOpen(true)}>Edit</button>
                </div>
                {residentFull.interests.length > 0 && (
                  <div className="mlx-pref">
                    <span className="mlx-pref-label">What you're into</span>
                    <div className="mlx-chips">{residentFull.interests.map((i) => <span key={i} className="mlx-chip">{i}</span>)}</div>
                  </div>
                )}
                {residentFull.availability.length > 0 && (
                  <div className="mlx-pref">
                    <span className="mlx-pref-label">When you're usually free</span>
                    <div className="mlx-chips">{describeAvailability(residentFull.availability).map((a) => <span key={a} className="mlx-chip">{a}</span>)}</div>
                  </div>
                )}
              </section>
            )}
          </aside>
          </div>
        )}
      </div>

      {!hasNone && <ClosingPrompt onInterest={() => setInterestOpen(true)} onFind={() => navigate("/games")} />}
      </>
      )}
    </div>
  );
}
