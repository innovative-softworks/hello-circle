import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  cancelBooking,
  cancelRegistration,
  downloadBookingIcs,
  fetchFavourites,
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
import { ChevronRightIcon, CloseIcon, LightbulbIcon } from "../components/icons";
import { MonthCalendar } from "../components/MonthCalendar";
import { MyLifeAchievements } from "../components/MyLifeAchievements";
import { MyLifeCircles } from "../components/MyLifeCircles";
import { MyLifeDiscoveryCTA } from "../components/MyLifeDiscoveryCTA";
import { MyLifeEmptyState } from "../components/MyLifeEmptyState";
import { MyLifeHero } from "../components/MyLifeHero";
import { MyLifeInterests } from "../components/MyLifeInterests";
import { MyLifeRecentActivity } from "../components/MyLifeRecentActivity";
import { MyLifeRepeatOpportunities } from "../components/MyLifeRepeatOpportunities";
import { MyLifeRhythm } from "../components/MyLifeRhythm";
import { MyLifeSaved } from "../components/MyLifeSaved";
import { MyLifeSummary } from "../components/MyLifeSummary";
import { MyLifeThisMonth } from "../components/MyLifeThisMonth";
import { MyLifeWaitingFor } from "../components/MyLifeWaitingFor";
import { Photo } from "../components/Photo";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { Button, EmptyState, onActivateProps, RowSkeleton, inputStyle, labelStyle } from "../components/ui";
import { UpcomingPlanCard } from "../components/UpcomingPlanCard";
import { dateLabel, euro } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { AVAILABILITY_OPTIONS } from "../types";
import type { Circle, Favourite, Game, MyBooking, MyExperienceBooking, MyIntent, MyProgramEnrollment, MyRegistration, ParticipationEntry, ResidentFull, RoutineSuggestion, WaitlistOfferStatus } from "../types";

// My Life (redesign) — participation-first hub. Reused/kept unchanged from
// the previous "My Bookings" page: the guest magic-link sign-in flow, the
// find-by-reference recovery flow (both real, load-bearing — confirmation
// emails link back to this exact route with ?ref=/?token=), and every
// booking/registration mutation (cancel/reschedule/QR check-in/attendance
// confirmation/reviews). Account settings (Household, Notifications,
// Payments, Passes, Receipts, Safety, Help) moved to Profile.tsx — reached
// via "Edit profile" — rather than sharing equal top billing with
// participation, per the brief's own explicit instruction.

// Progressive profile completion — a resident who skipped onboarding
// (interests never set) gets one gentle, dismissible nudge back to it,
// rather than being asked for everything up front. Dismissal is
// per-browser and permanent, not "ask again next visit" nagging.
const INTERESTS_NUDGE_DISMISSED_KEY = "hc_interests_nudge_dismissed";

const cancelledBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: 999, padding: "2px 8px" };
const recoveredBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" };

function BookingQr({ reference }: { reference: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    import("qrcode").then((QRCode) => QRCode.toDataURL(reference, { width: 160, margin: 1 }).then(setDataUrl));
  }, [reference]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt={`QR code for ${reference}`} style={{ width: 120, height: 120, borderRadius: 10, border: `1px solid ${colors.border}` }} />;
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
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
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
                style={{ background: "none", border: `1px solid ${colors.border}`, borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, color: colors.text, cursor: "pointer", marginBottom: 12 }}
              >
                Add to calendar
              </button>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>RESCHEDULE</div>
            <RescheduleForm booking={booking} onDone={() => window.location.reload()} />
            {isPast && (
              <div style={{ marginTop: 16 }}>
                <PostActivityFeedback kind="booking" reference={booking.ref} />
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
      <div style={{ marginTop: 10, background: colors.orangeBg, color: colors.orangeDark, borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>
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
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
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
          <PostActivityFeedback kind="registration" reference={registration.ref} />
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
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
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

// Adventures/Experiences in My Life (post-audit hardening pass) — this
// booking type existed server-side (GET /experiences/bookings/mine) and had
// a working fetch function (fetchMyExperienceBookings) but nothing on this
// page ever called it, so a resident with only an Adventure booking saw the
// empty state. Modeled on GameRow — a plain click-through card.
function ExperienceBookingRow({ booking }: { booking: MyExperienceBooking }) {
  const navigate = useNavigate();
  const cancelled = booking.status === "cancelled";
  return (
    <div
      onClick={() => navigate(`/experiences/${booking.experienceId}`)}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
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
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", cursor: "pointer" }}
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
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
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

  // My Life hub data — new fetches, all real, all gated to a signed-in
  // resident where the endpoint requires one (falls back to empty, same
  // pattern already used for games/circles above).
  const [residentFull, setResidentFull] = useState<ResidentFull | null>(null);
  const [interestsNudgeDismissed, setInterestsNudgeDismissed] = useState(() => localStorage.getItem(INTERESTS_NUDGE_DISMISSED_KEY) === "1");
  const [routineSuggestions, setRoutineSuggestions] = useState<RoutineSuggestion[]>([]);
  const [intents, setIntents] = useState<MyIntent[]>([]);
  const [participation, setParticipation] = useState<ParticipationEntry[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);

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

  // --- "Your next up" (§10-12): games + upcoming bookings combined by
  // soonest date/time, the very next one elevated into "Tonight" if it's
  // within 24h. Registrations/program enrollments have no single event
  // date (ongoing membership, not a dated plan) so they're deliberately
  // left out of this — they still show up in Recent Activity and the full
  // activity list below.
  const upcomingGames = games.filter((g) => g.date >= today && g.status !== "cancelled").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const upcomingBookingsList = bookings.filter((b) => b.date >= today && b.status !== "cancelled").sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  const soonestGame = upcomingGames[0];
  const soonestBooking = upcomingBookingsList[0];
  const soonestIsGame = soonestGame && (!soonestBooking || `${soonestGame.date}${soonestGame.time}` <= `${soonestBooking.date}${soonestBooking.time}`);
  const soonest = soonestIsGame ? soonestGame : soonestBooking;
  const soonestMs = soonest ? new Date(`${soonest.date}T${"time" in soonest ? soonest.time : "00:00"}:00`).getTime() - Date.now() : Infinity;
  const tonight = soonest && soonestMs >= 0 && soonestMs <= 24 * 60 * 60 * 1000 ? soonest : null;

  const nextUpGames = (tonight && soonestIsGame ? upcomingGames.slice(1) : upcomingGames).slice(0, 3);
  const nextUpBookings = (tonight && !soonestIsGame ? upcomingBookingsList.slice(1) : upcomingBookingsList).slice(0, Math.max(0, 3 - nextUpGames.length));

  // --- Honest personal insight (§22) — real comparison over real dates,
  // never a competitive ranking. Only shown when both windows have signal.
  const daysAgo = (iso: string) => Math.round((Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000);
  const last30 = participation.filter((e) => { const d = daysAgo(e.date); return d >= 0 && d < 30; }).length;
  const prev30 = participation.filter((e) => { const d = daysAgo(e.date); return d >= 30 && d < 60; }).length;

  const activeRoutinesCount = routineSuggestions.length;
  const plansAttendedCount = participation.filter((e) => e.date <= today && e.status !== "cancelled").length;
  const comingUpCount = upcomingGames.length + upcomingBookingsList.length;

  // Dynamic hero subtitle (My Life redesign v2 §5) — never hardcoded.
  // Prefers "N things this week" (matches the KPI strip's own "Coming up"
  // count); falls back to naming the single next plan further out; falls
  // back again to a plain greeting when nothing's upcoming at all.
  const weekAheadIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingThisWeekCount = [...upcomingGames, ...upcomingBookingsList].filter((x) => x.date <= weekAheadIso).length;
  const heroSubtitle = upcomingThisWeekCount > 0
    ? `You have ${upcomingThisWeekCount} thing${upcomingThisWeekCount === 1 ? "" : "s"} coming up this week.`
    : soonest
    ? `Your next plan is ${dateLabel(soonest.date)} at ${soonest.time}.`
    : "Here's what's happening in your world.";

  if (guestLoading || loading) {
    return (
      <section className="section-pad" style={{ maxWidth: 1240, margin: "0 auto", padding: "36px 24px 80px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Array.from({ length: 4 }, (_, i) => <RowSkeleton key={i} />)}
        </div>
      </section>
    );
  }

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      {resident && (
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "26px 24px 0" }}>
          <div style={{ marginBottom: !hasNone ? 16 : 24 }}><MyLifeHero name={resident.name} subtitle={heroSubtitle} /></div>
          {!hasNone && (
            <div style={{ marginBottom: 24 }}>
              <MyLifeSummary plansAttended={plansAttendedCount} circlesCount={circles.length} activeRoutines={activeRoutinesCount} comingUpCount={comingUpCount} />
            </div>
          )}
        </div>
      )}
      <div className="grid-responsive" style={{ maxWidth: 1240, margin: "0 auto", padding: `${resident ? 0 : 26}px 24px 80px`, display: "grid", gridTemplateColumns: "minmax(0,2.4fr) minmax(0,1fr)", gap: 30, alignItems: "start" }}>
        {/* MAIN COLUMN */}
        <div>
          {/* Only once MyLifeEmptyState (below) has stopped being the more
              complete prompt — that component's own "Choose interests" card
              already covers a fresh, zero-activity account, so showing both
              at once would be a redundant double-ask for the same thing. */}
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
          {/* Always reachable, regardless of hasNone — this is exactly the
              scenario where it matters most: a confirmation email opened on
              a device with no local client-id match and no signed-in
              session. Redesign v2 §9/§35 — demoted from a prominent banner
              between the hero and Your Next Up to a small utility action,
              since participation (not account admin) should lead. */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 18, marginBottom: lookupOpen ? 12 : 20, flexWrap: "wrap" }}>
            <button
              onClick={() => setLookupOpen((o) => !o)}
              style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 600, color: colors.mutedLight, cursor: "pointer" }}
            >
              Find a booking
            </button>
            {guestEmail && (
              <button onClick={handleSignOut} style={{ background: "none", border: "none", color: colors.mutedLight, fontWeight: 600, fontSize: 12.5, cursor: "pointer", padding: 0 }}>
                Sign out
              </button>
            )}
          </div>
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
              {tonight && (
                <div style={{ background: colors.dark, borderRadius: 12, padding: "20px 24px", marginBottom: 24, color: "#fff" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.6)", marginBottom: 6 }}>
                    {soonestMs <= 3 * 60 * 60 * 1000 ? "Starting soon" : "Today"}
                  </div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 20, margin: "0 0 4px" }}>
                    {soonestIsGame ? (soonest as Game).activityLabel : `${(soonest as MyBooking).centreName}${(soonest as MyBooking).roomName ? ` — ${(soonest as MyBooking).roomName}` : ""}`}
                  </h2>
                  <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.75)", marginBottom: 14 }}>
                    {soonest!.time}{soonestIsGame && (soonest as Game).centreName ? ` · ${(soonest as Game).centreName}` : ""}
                  </div>
                  <Button onClick={() => (soonestIsGame ? navigate(`/games/${(soonest as Game).id}`) : setLookupOpen(true))}>
                    {soonestIsGame ? "View details" : "View booking"}
                  </Button>
                </div>
              )}

              {(nextUpGames.length > 0 || nextUpBookings.length > 0) && (
                <section style={{ marginBottom: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Next</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 16px" }}>Your next up</h2>
                  {nextUpGames.length > 0 && (
                    <div className="grid-responsive-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: nextUpBookings.length > 0 ? 12 : 0 }}>
                      {nextUpGames.map((g) => <UpcomingPlanCard key={g.id} game={g} />)}
                    </div>
                  )}
                  {nextUpBookings.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {nextUpBookings.map((b) => (
                        <BookingRow
                          key={b.ref}
                          booking={b}
                          onCancel={() => handleCancelBooking(b.ref, guestEmail ?? undefined)}
                          cancelling={cancellingRef === b.ref}
                          error={cancelErrors[b.ref]}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {routineSuggestions.length > 0 && (
                <section style={{ marginBottom: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Again</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 4px" }}>Worth doing again</h2>
                  <p style={{ margin: "0 0 16px", fontSize: 13.5, color: colors.mutedLight }}>Things you've enjoyed before, happening again.</p>
                  <MyLifeRepeatOpportunities suggestions={routineSuggestions} />
                </section>
              )}

              {circles.length > 0 && (
                <section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 36 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight }}>Circles</div>
                  </div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 16px" }}>My Circles</h2>
                  <MyLifeCircles circles={circles} />
                </section>
              )}

              {intents.some((i) => i.status === "active" || i.status === "matched") && (
                <section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Waiting</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 16px" }}>Things you're waiting for</h2>
                  <MyLifeWaitingFor intents={intents} onChange={loadMyStuff} />
                </section>
              )}

              {participation.length > 0 && (
                <section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Recently</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 4px" }}>Recent activity</h2>
                  {last30 > 0 && prev30 > 0 && (
                    <p style={{ margin: "0 0 16px", fontSize: 13.5, color: colors.mutedLight }}>
                      {last30 > prev30
                        ? `You've been getting out more — ${last30} in the last 30 days, compared with ${prev30} before that.`
                        : last30 < prev30
                        ? `${last30} plans in the last 30 days, compared with ${prev30} before that.`
                        : `${last30} plans in the last 30 days, same as the 30 days before.`}
                    </p>
                  )}
                  <MyLifeRecentActivity entries={participation} onViewFull={() => setShowAllActivity(true)} />
                </section>
              )}

              {residentFull && residentFull.interests.length > 0 && (
                <section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 36 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Interests</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 16px" }}>What you're into</h2>
                  <MyLifeInterests interests={residentFull.interests} />
                </section>
              )}

              {residentFull && residentFull.availability.length > 0 && (
                <section style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 32, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 6 }}>Availability</div>
                  <h2 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: "clamp(20px,2.4vw,24px)", letterSpacing: "-.01em", margin: "0 0 16px" }}>When you're usually free</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    {residentFull.availability.map((a) => (
                      <span key={a} style={{ background: colors.panel, color: colors.text, borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>{a}</span>
                    ))}
                    <button onClick={() => navigate("/onboarding")} style={{ background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 700, color: colors.text, cursor: "pointer", textDecoration: "underline" }}>
                      Update availability
                    </button>
                  </div>
                </section>
              )}
            </>
          )}

          {/* Full history — kept for real functionality (cancel/reschedule/
              QR check-in/attendance confirmation/reviews), collapsed by
              default since the sections above already surface what matters
              most (spec §17's "secondary full activity view"). */}
          {!hasNone && (
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 24, marginTop: 8 }}>
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
                            border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
                            background: bookingsView === v ? colors.dark : colors.panel, color: bookingsView === v ? "#fff" : colors.muted,
                          }}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  {bookingsView === "calendar" && (
                    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 18, marginBottom: 32, maxWidth: 420 }}>
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
          )}
        </div>

        {/* RIGHT RAIL — simplified (My Life redesign v2 §36): This month,
            Your rhythm, Saved, then Milestones last/lowest-priority. Never
            competes visually with the main participation column. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <MyLifeThisMonth entries={participation} />
          <MyLifeRhythm entries={participation} />
          {favourites.length > 0 && (
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: "16px 18px", background: colors.surface }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 15, margin: 0 }}>For later</h3>
                <button onClick={() => navigate("/profile")} style={{ background: "none", border: "none", padding: 0, fontSize: 12, fontWeight: 700, color: colors.text, cursor: "pointer" }}>View all</button>
              </div>
              <MyLifeSaved favourites={favourites} />
            </div>
          )}
          <MyLifeAchievements circles={circles} participation={participation} />
        </div>
      </div>

      {!hasNone && (
        <section style={{ background: colors.bg }}>
          <div className="section-pad" style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px 60px" }}>
            <MyLifeDiscoveryCTA />
          </div>
        </section>
      )}
    </div>
  );
}
