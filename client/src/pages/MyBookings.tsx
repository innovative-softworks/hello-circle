import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  cancelBooking,
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
  fetchResidentFull,
  fetchRoutineSuggestions,
  fetchWaitlistOfferStatus,
  guestLogout,
  lookupBooking,
  lookupRegistration,
  rescheduleBooking,
  verifyGuestLink,
} from "../api";
import type { FollowedEntity } from "../api";
import { ChevronRightIcon, CloseIcon, LightbulbIcon } from "../components/icons";
import { MonthCalendar } from "../components/MonthCalendar";
import { MyLifeCircles } from "../components/MyLifeCircles";
import { MyLifeDiscoveryCTA } from "../components/MyLifeDiscoveryCTA";
import { MyLifeEmptyState } from "../components/MyLifeEmptyState";
import { MyLifeHeader } from "../components/MyLifeHeader";
import { MyLifeInterests } from "../components/MyLifeInterests";
import { MyLifeNextUp, type NextUpData } from "../components/MyLifeNextUp";
import { MyLifeRecentActivity } from "../components/MyLifeRecentActivity";
import { MyLifeRepeatOpportunities } from "../components/MyLifeRepeatOpportunities";
import { MyLifeRhythm } from "../components/MyLifeRhythm";
import { MyLifeFollowing } from "../components/MyLifeFollowing";
import { MyLifeSaved } from "../components/MyLifeSaved";
import { MyLifeThisMonth } from "../components/MyLifeThisMonth";
import { MyLifeWaitingFor } from "../components/MyLifeWaitingFor";
import { ParticipationTimeline, type TimelineRow } from "../components/ParticipationTimeline";
import { Photo } from "../components/Photo";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { Button, EmptyState, onActivateProps, RowSkeleton, inputStyle, labelStyle } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { formatDatePill } from "../formatters";
import { useGuest } from "../GuestContext";
import { colors, fonts, radius } from "../theme";
import { AVAILABILITY_OPTIONS } from "../types";
import type { Circle, Favourite, Game, MyBooking, MyExperienceBooking, MyIntent, MyProgramEnrollment, MyRegistration, ParticipationEntry, ResidentFull, RoutineSuggestion, WaitlistOfferStatus } from "../types";

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

function RescheduleForm({ booking, onDone }: { booking: MyBooking; onDone: () => void }) {
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rescheduleBooking(booking.ref, date, time);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reschedule");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 150 }} />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inputStyle, width: 110 }} />
      <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Confirm new time"}</Button>
      {error && <span style={{ color: colors.danger, fontSize: 12.5 }}>{error}</span>}
    </div>
  );
}

function BookingRow({
  booking, onCancel, cancelling, error, recovered,
}: {
  booking: MyBooking; onCancel: () => void; cancelling: boolean; error?: string; recovered?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cancelled = booking.status === "cancelled";
  const isPast = new Date(`${booking.date}T00:00:00`) < new Date(new Date().toDateString());
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Photo src={booking.image} alt={booking.centreName} ph={booking.ph} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} {...onActivateProps(() => setExpanded((e) => !e))}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{booking.centreName}{booking.roomName ? ` — ${booking.roomName}` : ""}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {dateLabel(booking.date)} · {booking.time}
          </div>
          {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{euro(booking.totalCents / 100)}</div>
          <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{booking.ref}</div>
          {!cancelled && (
            <Button variant="danger" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </div>
      {expanded && !cancelled && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colors.border}`, display: "flex", flexWrap: "wrap", gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>CHECK-IN CODE</div>
            <BookingQr reference={booking.ref} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            {!isPast && (
              <button
                onClick={() => downloadBookingIcs(booking.ref)}
                style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: radius.pill, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, color: colors.text, cursor: "pointer", marginBottom: 12 }}
              >
                Add to calendar
              </button>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>RESCHEDULE</div>
            <RescheduleForm booking={booking} onDone={() => window.location.reload()} />
            {isPast && (
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

function WaitlistOfferBanner({ clubId }: { clubId: string }) {
  const [status, setStatus] = useState<WaitlistOfferStatus | null>(null);
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
    <div style={{ marginTop: 10, color: colors.mutedLight, fontSize: 13 }}>
      On the waitlist{typeof status.position === "number" ? ` · position ${status.position}${status.total ? ` of ${status.total}` : ""}` : ""}
    </div>
  );
}

function RegistrationRow({
  registration, onCancel, cancelling, error, recovered,
}: {
  registration: MyRegistration; onCancel: () => void; cancelling: boolean; error?: string; recovered?: boolean;
}) {
  const cancelled = registration.status === "cancelled";
  const enoughTimeSinceSignup = Date.now() - new Date(registration.createdAt).getTime() > 14 * 24 * 60 * 60 * 1000;
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 12 }}>
          {registration.sport}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{`${registration.childFirst} ${registration.childLast}`.trim()}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
            {recovered && <span style={recoveredBadgeStyle}>Found by reference</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {registration.clubName} · {registration.team}
          </div>
          {error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{registration.trial ? "Free trial" : euro(registration.totalCents / 100)}</div>
          <div style={{ fontSize: 12, color: colors.faint, marginBottom: cancelled ? 0 : 8 }}>{registration.ref}</div>
          {!cancelled && (
            <Button variant="danger" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
        </div>
      </div>
      {!cancelled && <WaitlistOfferBanner clubId={registration.clubId} />}
      {!cancelled && enoughTimeSinceSignup && (
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
    <div
      onClick={() => navigate(`/games/${game.id}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.greenBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.greenText, fontWeight: 700, fontSize: 18 }}>
          {game.activityLabel.charAt(0)}
        </div>
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
    </div>
  );
}

function ExperienceBookingRow({ booking }: { booking: MyExperienceBooking }) {
  const navigate = useNavigate();
  const cancelled = booking.status === "cancelled";
  return (
    <div
      onClick={() => navigate(`/experiences/${booking.experienceId}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {booking.imageUrl ? (
          <img src={booking.imageUrl} alt={booking.title} style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flex: "none" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 18 }}>
            {booking.title.charAt(0)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{booking.title}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
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
      </div>
    </div>
  );
}

function CircleRow({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/circles/${circle.slug ?? circle.id}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.orangeBg, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", color: colors.orangeDark, fontWeight: 700, fontSize: 18 }}>
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
    </div>
  );
}

function ProgramEnrollmentRow({ enrollment }: { enrollment: MyProgramEnrollment }) {
  const navigate = useNavigate();
  const cancelled = enrollment.status === "cancelled";
  return (
    <div
      onClick={() => navigate(`/programs/${enrollment.programId}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: radius.card, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Photo src={enrollment.imageUrl} alt={enrollment.title} ph={colors.panel} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{enrollment.title}</span>
            {cancelled && <span style={cancelledBadgeStyle}>Cancelled</span>}
          </div>
          <div style={{ color: colors.mutedLight, fontSize: 14 }}>
            {enrollment.participantName} · {enrollment.listingName}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ fontWeight: 700 }}>{enrollment.totalCents ? euro(enrollment.totalCents / 100) : "Free"}</div>
          <div style={{ fontSize: 12, color: colors.faint }}>{enrollment.ref}</div>
        </div>
      </div>
    </div>
  );
}

type LookupResult = { kind: "booking"; data: MyBooking } | { kind: "registration"; data: MyRegistration };

/** One section header used throughout the page's lower, full-width sections
 * — small "/ EYEBROW" + a display h2, the same Swiss-editorial convention
 * as the page header and Next Up/Coming Up above it. */
function SectionHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight, marginBottom: 6 }}>/ {eyebrow}</div>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,26px)", letterSpacing: "-.01em", margin: subtitle ? "0 0 4px" : 0 }}>{title}</h2>
      {subtitle && <p style={{ margin: 0, fontSize: 13.5, color: colors.mutedLight }}>{subtitle}</p>}
    </div>
  );
}

export function MyBookings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { email: guestEmail, resident, loading: guestLoading, refresh: refreshGuest } = useGuest();

  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [programEnrollments, setProgramEnrollments] = useState<MyProgramEnrollment[]>([]);
  const [experienceBookings, setExperienceBookings] = useState<MyExperienceBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const [residentFull, setResidentFull] = useState<ResidentFull | null>(null);
  const [interestsNudgeDismissed, setInterestsNudgeDismissed] = useState(() => localStorage.getItem(INTERESTS_NUDGE_DISMISSED_KEY) === "1");
  const [routineSuggestions, setRoutineSuggestions] = useState<RoutineSuggestion[]>([]);
  const [intents, setIntents] = useState<MyIntent[]>([]);
  const [participation, setParticipation] = useState<ParticipationEntry[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [follows, setFollows] = useState<FollowedEntity[]>([]);

  const [bookingsView, setBookingsView] = useState<"list" | "calendar">("list");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadMyStuff = () => {
    setLoading(true);
    return Promise.all([
      fetchMyBookings().then(setBookings),
      fetchMyRegistrations().then(setRegs),
      fetchMyProgramEnrollments().then(setProgramEnrollments),
      fetchMyGames().then(setGames).catch(() => setGames([])),
      fetchMyCircles().then(setCircles).catch(() => setCircles([])),
      fetchMyExperienceBookings().then(setExperienceBookings).catch(() => setExperienceBookings([])),
      fetchResidentFull().then(({ resident: r }) => setResidentFull(r)).catch(() => setResidentFull(null)),
      fetchRoutineSuggestions().then(setRoutineSuggestions).catch(() => setRoutineSuggestions([])),
      fetchMyIntents().then(setIntents).catch(() => setIntents([])),
      fetchMyParticipation().then(setParticipation).catch(() => setParticipation([])),
      fetchFavourites().then(setFavourites).catch(() => setFavourites([])),
      fetchMyFollows().then(setFollows).catch(() => setFollows([])),
    ]).then(() => setLoading(false));
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

  const verifiedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    const token = searchParams.get("token");
    if (!token || verifiedTokenRef.current === token) return;
    verifiedTokenRef.current = token;
    setVerifying(true);
    let destination = "/bookings";
    verifyGuestLink(token)
      .then(async () => {
        await refreshGuest();
        await loadMyStuff();
        const full = await fetchResidentFull().catch(() => null);
        if (full?.resident && !full.resident.onboardingCompleted) destination = "/onboarding";
      })
      .catch((e) => setVerifyError(e instanceof Error ? e.message : "That sign-in link didn't work"))
      .finally(() => {
        setVerifying(false);
        navigate(destination, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = async () => {
    await guestLogout();
    await refreshGuest();
    await loadMyStuff();
  };

  const hasNone =
    !loading &&
    bookings.length === 0 &&
    regs.length === 0 &&
    games.length === 0 &&
    circles.length === 0 &&
    programEnrollments.length === 0 &&
    experienceBookings.length === 0;

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
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
    ...experienceBookings.map((eb) => ({ date: eb.date, el: <ExperienceBookingRow key={`eb-${eb.ref}`} booking={eb} /> })),
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

  const handleLookup = async () => {
    const ref = lookupRef.trim();
    const email = lookupEmail.trim();
    if (!ref || !email) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      if (ref.toUpperCase().startsWith("CR-")) {
        setLookupResult({ kind: "registration", data: await lookupRegistration(ref, email) });
      } else {
        setLookupResult({ kind: "booking", data: await lookupBooking(ref, email) });
      }
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Couldn't find that booking");
    } finally {
      setLookupLoading(false);
    }
  };

  // --- Next Up / Coming Up: one merged, chronological set of dated plans —
  // games, centre/room bookings and Adventure bookings. Registrations and
  // program enrollments have no single dated "next occurrence" (ongoing
  // membership, not a dated plan), so — same as the previous pass — they're
  // deliberately left out of this and only appear in "View full activity"
  // below. Each entity is normalized into one shape so Next Up/Coming Up
  // don't have to know which table it came from.
  type NextEntity =
    | { date: string; time: string; kind: "game"; game: Game }
    | { date: string; time: string; kind: "booking"; booking: MyBooking }
    | { date: string; time: string; kind: "experience"; booking: MyExperienceBooking };

  const upcomingGames = games.filter((g) => g.date >= today && g.status !== "cancelled");
  const upcomingBookingsList = bookings.filter((b) => b.date >= today && b.status !== "cancelled");
  const upcomingExperienceBookings = experienceBookings.filter((b) => b.date >= today && b.status !== "cancelled");

  const nextEntities: NextEntity[] = [
    ...upcomingGames.map((game): NextEntity => ({ date: game.date, time: game.time, kind: "game", game })),
    ...upcomingBookingsList.map((booking): NextEntity => ({ date: booking.date, time: booking.time, kind: "booking", booking })),
    ...upcomingExperienceBookings.map((booking): NextEntity => ({ date: booking.date, time: booking.time, kind: "experience", booking })),
  ].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  const [nextEntity, ...restEntities] = nextEntities;

  const dayEyebrow = (date: string, time: string): string => {
    const label = date === today ? "TODAY" : date === tomorrow ? "TOMORROW" : formatDatePill(date);
    return `${label} · ${time}`;
  };

  const nextUpData: NextUpData | null = !nextEntity ? null : nextEntity.kind === "game" ? {
    eyebrow: dayEyebrow(nextEntity.date, nextEntity.time),
    title: nextEntity.game.activityLabel,
    subtitle: nextEntity.game.centreName ? `${nextEntity.game.centreName}${nextEntity.game.area ? ` · ${nextEntity.game.area}` : ""}` : (nextEntity.game.locationText || "Location to be confirmed"),
    going: { joined: nextEntity.game.joined, capacity: nextEntity.game.capacity },
    priceLabel: null,
    ctaLabel: "View plan",
    onCta: () => navigate(`/games/${nextEntity.game.id}`),
  } : nextEntity.kind === "booking" ? {
    eyebrow: dayEyebrow(nextEntity.date, nextEntity.time),
    title: `${nextEntity.booking.centreName}${nextEntity.booking.roomName ? ` — ${nextEntity.booking.roomName}` : ""}`,
    subtitle: `Ref ${nextEntity.booking.ref}`,
    going: null,
    priceLabel: euro(nextEntity.booking.totalCents / 100),
    ctaLabel: "Manage booking",
    onCta: () => setShowAllActivity(true),
  } : {
    eyebrow: dayEyebrow(nextEntity.date, nextEntity.time),
    title: nextEntity.booking.title,
    subtitle: `${nextEntity.booking.partySize} ${nextEntity.booking.partySize === 1 ? "person" : "people"}`,
    going: null,
    priceLabel: euro(nextEntity.booking.totalCents / 100),
    ctaLabel: "View booking",
    onCta: () => navigate(`/experiences/${nextEntity.booking.experienceId}`),
  };

  const comingUpRows: TimelineRow[] = restEntities.slice(0, 6).map((entity) => {
    if (entity.kind === "game") {
      const g = entity.game;
      return {
        key: `g-${g.id}`, date: g.date, kind: "PLAN", title: g.activityLabel,
        subtitle: `${g.centreName ?? (g.locationText || "Location TBC")} · ${g.time}`,
        meta: `${g.joined} of ${g.capacity} going`,
        actionLabel: "View", onAction: () => navigate(`/games/${g.id}`),
      };
    }
    if (entity.kind === "booking") {
      const b = entity.booking;
      return {
        key: `b-${b.ref}`, date: b.date, kind: "BOOKING", title: `${b.centreName}${b.roomName ? ` — ${b.roomName}` : ""}`,
        subtitle: `${b.time} · Ref ${b.ref}`,
        meta: euro(b.totalCents / 100),
        actionLabel: "Manage", onAction: () => setShowAllActivity(true),
      };
    }
    const e = entity.booking;
    return {
      key: `eb-${e.ref}`, date: e.date, kind: "ADVENTURE", title: e.title,
      subtitle: `${e.time} · ${e.partySize} ${e.partySize === 1 ? "person" : "people"}`,
      meta: euro(e.totalCents / 100),
      actionLabel: "View", onAction: () => navigate(`/experiences/${e.experienceId}`),
    };
  });

  const comingUpTotal = nextEntities.length;
  const activeIntents = intents.filter((i) => i.status === "active" || i.status === "matched");

  // "Recently" — strictly past-dated participation only (date < today, not
  // <=). fetchMyParticipation() includes future- *and* today-dated games
  // too (its own doc comment); Next Up/Coming Up already own anything
  // dated today-or-later, since a same-day plan is still something to
  // attend, not something that's happened. Using <= today here would put a
  // same-day entry in both sections at once — exactly the duplication the
  // redesign's "one primary place per concept" rule rules out.
  const recentEntries = participation.filter((e) => e.date < today);

  const daysAgo = (iso: string) => Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000);
  const last30 = participation.filter((e) => { const d = daysAgo(e.date); return d >= 0 && d < 30; }).length;
  const prev30 = participation.filter((e) => { const d = daysAgo(e.date); return d >= 30 && d < 60; }).length;

  if (guestLoading || loading) {
    return (
      <section className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "36px 24px 80px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Array.from({ length: 4 }, (_, i) => <RowSkeleton key={i} />)}
        </div>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      {/* Header + account/utility actions share one row so "Edit profile" /
          "Find a booking" / "Sign out" read as one top-right cluster instead
          of two disconnected rows. "Find a booking" (guest reference
          lookup) has to stay reachable even with no resident signed in —
          confirmation emails link straight back here — so this row always
          renders, not just alongside MyLifeHeader. */}
      <div className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "40px 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          {resident ? (
            <MyLifeHeader name={resident.name} comingUpCount={comingUpTotal} circlesActiveCount={circles.length} />
          ) : <div />}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={() => setLookupOpen((o) => !o)}>Find a booking</Button>
            {guestEmail && <Button variant="ghost" onClick={handleSignOut}>Sign out</Button>}
            {resident && <Button variant="ghost" onClick={() => navigate("/profile")}>Edit profile</Button>}
          </div>
        </div>
      </div>

      <div className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "0 24px 0" }}>
        {!hasNone && resident && residentFull && residentFull.interests.length === 0 && !interestsNudgeDismissed && (
          <div
            className="pop-in"
            style={{
              background: colors.greenBg, borderRadius: 12, padding: "14px 18px", marginBottom: 24,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#fff", color: colors.greenText, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <LightbulbIcon size={16} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>Tell us what you're into</div>
                <div style={{ fontSize: 12.5, color: colors.mutedLight }}>Takes under a minute — makes Explore actually useful.</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Button onClick={() => navigate("/onboarding")}>Get started</Button>
              <button
                onClick={() => {
                  localStorage.setItem(INTERESTS_NUDGE_DISMISSED_KEY, "1");
                  setInterestsNudgeDismissed(true);
                }}
                aria-label="Dismiss"
                style={{ background: "none", border: "none", padding: 4, color: colors.mutedLight, cursor: "pointer", display: "flex" }}
              >
                <CloseIcon size={16} />
              </button>
            </div>
          </div>
        )}

        {verifying && (
          <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 12, padding: "14px 20px", marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
            Signing you in…
          </div>
        )}
        {verifyError && (
          <div style={{ background: colors.dangerBg, color: colors.danger, borderRadius: 12, padding: "14px 20px", marginBottom: 20, fontSize: 14 }}>
            {verifyError}
          </div>
        )}

        {!guestEmail && (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Sign in to see your life</div>
              <div style={{ fontSize: 13.5, color: colors.mutedLight }}>Your plans, Circles and history, all in one place.</div>
            </div>
            <Button onClick={() => navigate("/signin")}>Sign in</Button>
          </div>
        )}
        {lookupOpen && (
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 24 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 160px" }}>
                <label style={labelStyle}>Reference</label>
                <input value={lookupRef} onChange={(e) => setLookupRef(e.target.value)} placeholder="HB-123456" style={inputStyle} />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label style={labelStyle}>Email</label>
                <input value={lookupEmail} onChange={(e) => setLookupEmail(e.target.value)} placeholder="you@email.ie" style={inputStyle} />
              </div>
              <Button onClick={handleLookup} disabled={lookupLoading || !lookupRef.trim() || !lookupEmail.trim()}>
                {lookupLoading ? "Searching…" : "Find"}
              </Button>
            </div>
            {lookupError && <div style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{lookupError}</div>}
          </div>
        )}

        {lookupResult && (
          <div style={{ marginBottom: 24 }}>
            {lookupResult.kind === "booking" ? (
              <BookingRow
                booking={lookupResult.data}
                onCancel={() => handleCancelBooking(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
              />
            ) : (
              <RegistrationRow
                registration={lookupResult.data}
                onCancel={() => handleCancelRegistration(lookupResult.data.ref, lookupEmail.trim())}
                cancelling={cancellingRef === lookupResult.data.ref}
                error={cancelErrors[lookupResult.data.ref]}
                recovered
              />
            )}
          </div>
        )}

        {hasNone && resident ? (
          <MyLifeEmptyState />
        ) : hasNone && !resident ? (
          <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing here yet" subtitle="Find a hall, club or plan to get started." action={<Button onClick={() => navigate("/")}>Explore HelloCircle</Button>} />
        ) : (
          <>
            {/* One continuous grid from Next Up through Recently — the right
                rail is a single item spanning every row (gridRow: "1 / -1"),
                so it stays sticky across the whole span instead of just the
                first row. Full-width sections (Do It Again/Interests/
                Availability) span both columns (gridColumn: "1 / -1") so
                they stay full width without breaking the grid into
                separate containers, which would reset the sticky rail. My
                Circles/Recently stay in column 1 only, lining up under Next
                Up/Coming Up. Interests/Availability/the final CTA fall
                outside this grid, unaffected. */}
            <div className="grid-responsive" style={{ display: "grid", gridTemplateColumns: "minmax(0,2.4fr) minmax(0,1fr)", gap: 30, alignItems: "start", marginBottom: 44 }}>
              <div style={{ gridColumn: 1 }}>
                {nextUpData && <div style={{ marginBottom: 36 }}><MyLifeNextUp data={nextUpData} /></div>}
                {comingUpRows.length > 0 && (
                  <section>
                    <SectionHeader eyebrow="COMING UP" title="Coming up" />
                    <ParticipationTimeline rows={comingUpRows} />
                  </section>
                )}
              </div>

              <div className="sticky-aside" style={{ gridColumn: 2, gridRow: "1 / -1", position: "sticky", top: 90, display: "flex", flexDirection: "column", gap: 18 }}>
                <MyLifeThisMonth entries={participation} />
                <MyLifeRhythm entries={participation} />
                {activeIntents.length > 0 && (
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight, marginBottom: 12 }}>WAITING</div>
                    <MyLifeWaitingFor intents={activeIntents.slice(0, 2)} onChange={loadMyStuff} />
                  </div>
                )}
                {favourites.length > 0 && (
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight }}>FOR LATER</div>
                      <button onClick={() => navigate("/profile")} style={{ background: "none", border: "none", padding: 0, fontSize: 12, fontWeight: 700, color: colors.text, cursor: "pointer" }}>View all</button>
                    </div>
                    <MyLifeSaved favourites={favourites} />
                  </div>
                )}
                {follows.length > 0 && (
                  <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: colors.mutedLight }}>FOLLOWING</div>
                      <button onClick={() => navigate("/profile")} style={{ background: "none", border: "none", padding: 0, fontSize: 12, fontWeight: 700, color: colors.text, cursor: "pointer" }}>View all</button>
                    </div>
                    <MyLifeFollowing follows={follows} />
                  </div>
                )}
              </div>

              {routineSuggestions.length > 0 && (
                <section style={{ gridColumn: "1 / -1", borderTop: `1px solid ${colors.border}`, paddingTop: 36 }}>
                  <SectionHeader eyebrow="DO IT AGAIN" title="Worth doing again" subtitle="Things you've enjoyed before, happening again." />
                  <MyLifeRepeatOpportunities suggestions={routineSuggestions} />
                </section>
              )}

              {circles.length > 0 && (
                <section style={{ gridColumn: 1, borderTop: `1px solid ${colors.border}`, paddingTop: 36 }}>
                  <SectionHeader eyebrow="CIRCLES" title="My Circles" />
                  <MyLifeCircles circles={circles} />
                </section>
              )}

              {residentFull && residentFull.interests.length > 0 && (
                <section style={{ gridColumn: "1 / -1", borderTop: `1px solid ${colors.border}`, paddingTop: 36 }}>
                  <SectionHeader eyebrow="INTERESTS" title="What you're into" />
                  <MyLifeInterests interests={residentFull.interests} />
                </section>
              )}

              {residentFull && residentFull.availability.length > 0 && (
                <section style={{ gridColumn: "1 / -1", borderTop: `1px solid ${colors.border}`, paddingTop: 36 }}>
                  <SectionHeader eyebrow="AVAILABILITY" title="When you're usually free" />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {residentFull.availability.map((a) => (
                      <span key={a} style={{ background: colors.panel, color: colors.text, borderRadius: radius.pill, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>{a}</span>
                    ))}
                    <button onClick={() => navigate("/onboarding")} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}>
                      Update availability
                    </button>
                  </div>
                </section>
              )}

              {recentEntries.length > 0 && (
                <section style={{ gridColumn: 1, borderTop: `1px solid ${colors.border}`, paddingTop: 36 }}>
                  <SectionHeader
                    eyebrow="RECENTLY"
                    title="Recently"
                    subtitle={
                      last30 > 0 && prev30 > 0
                        ? (last30 > prev30
                            ? `You've been getting out more — ${last30} in the last 30 days, compared with ${prev30} before that.`
                            : last30 < prev30
                            ? `${last30} plans in the last 30 days, compared with ${prev30} before that.`
                            : `${last30} plans in the last 30 days, same as the 30 days before.`)
                        : undefined
                    }
                  />
                  <MyLifeRecentActivity entries={recentEntries} onViewFull={() => setShowAllActivity(true)} />
                </section>
              )}

              {/* Full history — kept for real functionality (cancel/
                  reschedule/QR check-in/attendance confirmation/reviews),
                  collapsed by default since the sections above already
                  surface what matters most. Left-column width only (same
                  as My Circles/Recently above), still inside the same grid
                  so the sticky rail keeps following while this is open. */}
              <div style={{ gridColumn: 1, borderTop: `1px solid ${colors.border}`, paddingTop: 24 }}>
                <button
                  onClick={() => setShowAllActivity((s) => !s)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, fontSize: 13.5, fontWeight: 700, color: colors.text, cursor: "pointer" }}
                >
                  <ChevronRightIcon size={14} style={{ transform: showAllActivity ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
                  {showAllActivity ? "Hide" : "View"} full activity — bookings, references and history
                </button>
  
                {showAllActivity && (
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
                        <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>UPCOMING</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
                          {upcomingRows.map((r) => r.el)}
                        </div>
                      </>
                    )}
                    {bookingsView === "list" && (regs.length > 0 || circles.length > 0 || programEnrollments.length > 0) && (
                      <>
                        <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>ONGOING</h2>
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
                          {programEnrollments.map((e) => <ProgramEnrollmentRow key={e.ref} enrollment={e} />)}
                        </div>
                      </>
                    )}
                    {bookingsView === "list" && pastRows.length > 0 && (
                      <>
                        <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>PAST</h2>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {pastRows.map((r) => r.el)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!hasNone && (
        <section style={{ background: colors.bg, marginTop: 56 }}>
          <div className="section-pad" style={{ maxWidth: 1440, margin: "0 auto", padding: "0 24px 60px" }}>
            <MyLifeDiscoveryCTA />
          </div>
        </section>
      )}
    </div>
  );
}
