import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  addFavourite,
  addHouseholdMember,
  blockResident,
  cancelBooking,
  cancelRegistration,
  createRoutine,
  deleteHouseholdMember,
  downloadBookingIcs,
  fetchBlockedResidents,
  fetchFavourites,
  fetchHousehold,
  fetchMyBookings,
  fetchMyCircles,
  fetchMyGames,
  fetchMyPasses,
  fetchMyProgramEnrollments,
  fetchMyRegistrations,
  fetchMyReports,
  fetchMyRoutines,
  fetchReceipts,
  fetchResidentFull,
  fetchResidentNotifications,
  fetchRoutineSuggestions,
  fetchWaitlistOfferStatus,
  guestLogout,
  lookupBooking,
  lookupRegistration,
  markResidentNotificationRead,
  removeFavourite,
  requestGuestLink,
  rescheduleBooking,
  saveAccessibilityPrefs,
  saveNotificationPrefs,
  saveOnboarding,
  submitReport,
  unblockResident,
  updateFavouriteStatus,
  updateHouseholdMember,
  updatePrivacyPrefs,
  updateResidentMe,
  updateRoutine,
  verifyGuestLink,
} from "../api";
import { ChevronRightIcon } from "../components/icons";
import { HostApplicationPanel } from "../components/HostApplicationPanel";
import { HostDashboardPanel } from "../components/HostDashboardPanel";
import { PaymentMethodsPanel } from "../components/PaymentMethodsPanel";
import { MonthCalendar } from "../components/MonthCalendar";
import { Photo } from "../components/Photo";
import { PostActivityFeedback } from "../components/PostActivityFeedback";
import { SearchAlertsPanel } from "../components/SearchAlertsPanel";
import { Button, EmptyState, RowSkeleton, Tabs, inputStyle, labelStyle } from "../components/ui";
import { PageTitle } from "../components/PageTitle";
import { dateLabel, euro } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { ACCESSIBILITY_OPTIONS, BUDGET_OPTIONS, GOAL_OPTIONS, GROUP_SIZE_OPTIONS } from "../types";
import type { BlockedResident, Circle, Favourite, Game, HostStatus, HouseholdMember, MyBooking, MyProgramEnrollment, MyRegistration, NotificationPrefs, Pass, Receipt, ReportRecord, ResidentNotification, Routine, RoutineSuggestion, WaitlistOfferStatus } from "../types";

const cancelledBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: 999, padding: "2px 8px" };
const recoveredBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: 999, padding: "2px 8px" };

// QR display (Phase A) — generated client-side, no network call, just a
// scannable encoding of the booking reference for a vendor's manual
// check-in (see VendorDashboard.tsx's CheckInButton).
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

// Fuller post-activity feedback (IA spec §11) — see PostActivityFeedback.tsx.

function BookingRow({
  booking,
  onCancel,
  cancelling,
  error,
  recovered,
}: {
  booking: MyBooking;
  onCancel: () => void;
  cancelling: boolean;
  error?: string;
  recovered?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cancelled = booking.status === "cancelled";
  const isPast = new Date(`${booking.date}T00:00:00`) < new Date(new Date().toDateString());
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Photo src={booking.image} alt={booking.centreName} ph={booking.ph} style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpanded((e) => !e)}>
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

// Waitlist-offer countdown (Phase A) — polls the same endpoint the "join
// waitlist" flow used to check position, which now also surfaces an
// active offer + its expiry once a spot opens up (see clubs.ts).
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
  registration,
  onCancel,
  cancelling,
  error,
  recovered,
}: {
  registration: MyRegistration;
  onCancel: () => void;
  cancelling: boolean;
  error?: string;
  recovered?: boolean;
}) {
  const cancelled = registration.status === "cancelled";
  // Registrations are ongoing membership, not a single dated event like a
  // booking — there's no "the event has passed" moment to gate on, so
  // approximate it: enough time since sign-up that they've likely attended
  // at least one session.
  const enoughTimeSinceSignup = Date.now() - new Date(registration.createdAt).getTime() > 14 * 24 * 60 * 60 * 1000;
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1 }}>
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

// Read-only rows for games/circles/program enrollments — Phase 0 is about
// making these visible at all (they were previously invisible in a
// resident's own history), not about inline management. Leave/cancel
// already exists on each item's own detail page.
function GameRow({ game }: { game: Game }) {
  const navigate = useNavigate();
  const cancelled = game.status === "cancelled";
  return (
    <div
      onClick={() => navigate(`/games/${game.id}`)}
      style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
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

function CircleRow({ circle }: { circle: Circle }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/circles/${circle.slug ?? circle.id}`)}
      style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", cursor: "pointer" }}
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
      style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", opacity: cancelled ? 0.6 : 1, cursor: "pointer" }}
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

// My Life (Phase 5) — Participation Passport + My Places. Both pure
// aggregation over data the page already loads (bookings/regs/games/
// programEnrollments/circles), no new schema and no new API calls.
// Deliberately excludes "hours participating" and "routines/new things
// tried" from the doc's own passport example — those need duration math
// or Phase 8's repetition-detection, neither of which exists yet; showing
// three honest, real numbers beats a plausible-looking fake one.
function PassportSummary({
  bookings, regs, games, programEnrollments, circles,
}: {
  bookings: MyBooking[]; regs: MyRegistration[]; games: Game[]; programEnrollments: MyProgramEnrollment[]; circles: Circle[];
}) {
  const totalActivities = bookings.length + regs.length + games.length + programEnrollments.length;
  const places = new Set<string>();
  bookings.forEach((b) => places.add(b.centreName));
  regs.forEach((r) => places.add(r.clubName));
  if (totalActivities === 0 && circles.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
      {[
        { label: "Activities", value: totalActivities },
        { label: "Places", value: places.size },
        { label: "Circles", value: circles.length },
      ].map((stat) => (
        <div key={stat.label} style={{ flex: "1 1 100px", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 22, color: colors.greenText }}>{stat.value}</div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.muted, textTransform: "uppercase", letterSpacing: ".03em" }}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

function MyPlaces({ bookings, regs }: { bookings: MyBooking[]; regs: MyRegistration[] }) {
  const counts = new Map<string, number>();
  bookings.forEach((b) => counts.set(b.centreName, (counts.get(b.centreName) ?? 0) + 1));
  regs.forEach((r) => counts.set(r.clubName, (counts.get(r.clubName) ?? 0) + 1));
  const top = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>PLACES BECOMING PART OF YOUR LIFE</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {top.map(([name, count]) => (
          <div key={name} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, padding: "10px 16px" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
            <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{count} visits</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Collapsible wrapper (UI/UX plan phase 5) — Passport + My Places used to
// always render at full height above the timeline, meaning a resident hit
// two stat-card rows before seeing any of their actual bookings. Collapsed
// by default now, showing just a one-line summary; the underlying
// PassportSummary/MyPlaces components and their own real-data logic are
// unchanged, only where they render.
function MyLifeSummary(props: { bookings: MyBooking[]; regs: MyRegistration[]; games: Game[]; programEnrollments: MyProgramEnrollment[]; circles: Circle[] }) {
  const { bookings, regs, games, programEnrollments, circles } = props;
  const [expanded, setExpanded] = useState(false);
  const totalActivities = bookings.length + regs.length + games.length + programEnrollments.length;
  const places = new Set<string>();
  bookings.forEach((b) => places.add(b.centreName));
  regs.forEach((r) => places.add(r.clubName));
  if (totalActivities === 0 && circles.length === 0) return null;

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "none", border: "none", padding: "14px 16px", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
          {totalActivities} activit{totalActivities === 1 ? "y" : "ies"} · {places.size} place{places.size === 1 ? "" : "s"} · {circles.length} circle{circles.length === 1 ? "" : "s"}
        </span>
        <ChevronRightIcon size={16} style={{ color: colors.muted, flex: "none", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          <PassportSummary bookings={bookings} regs={regs} games={games} programEnrollments={programEnrollments} circles={circles} />
          <MyPlaces bookings={bookings} regs={regs} />
        </div>
      )}
    </div>
  );
}

type LookupResult = { kind: "booking"; data: MyBooking } | { kind: "registration"; data: MyRegistration };

// --- Household (MVP) -------------------------------------------------------

function HouseholdPanel() {
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    fetchHousehold()
      .then(setMembers)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setAdding(true);
    try {
      await addHouseholdMember({ firstName: firstName.trim(), lastName: lastName.trim(), dob: dob || undefined, guardianConsentGiven: consent });
      setFirstName("");
      setLastName("");
      setDob("");
      setConsent(false);
      load();
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    await deleteHouseholdMember(id);
    setMembers((rows) => rows.filter((m) => m.id !== id));
  };

  const toggleConsent = async (m: HouseholdMember) => {
    await updateHouseholdMember(m.id, { guardianConsentGiven: !m.guardianConsentGiven });
    setMembers((rows) => rows.map((r) => (r.id === m.id ? { ...r, guardianConsentGiven: !r.guardianConsentGiven } : r)));
  };

  return (
    <div>
      <p style={{ color: colors.mutedLight, fontSize: 14, margin: "0 0 20px" }}>
        Add kids or dependants once — pick them straight from here next time you register for a club instead of retyping their details.
      </p>
      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Add a household member</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <label style={labelStyle}>Date of birth</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={inputStyle} />
          </div>
          <Button onClick={handleAdd} disabled={adding || !firstName.trim() || !lastName.trim()}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: colors.mutedLight, marginTop: 12 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ accentColor: colors.green }} />
          I am this person's parent or guardian and consent to registering activities on their behalf
        </label>
      </div>

      {loading ? (
        <RowSkeleton />
      ) : members.length === 0 ? (
        <EmptyState icon={<ChevronRightIcon size={20} />} title="No household members yet" subtitle="Add one above to speed up club registrations." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {members.map((m) => (
            <div key={m.id} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{m.firstName} {m.lastName}</div>
                {m.dob && <div style={{ fontSize: 13, color: colors.mutedLight }}>Born {m.dob}</div>}
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.mutedLight, marginTop: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={m.guardianConsentGiven} onChange={() => toggleConsent(m)} style={{ accentColor: colors.green }} />
                  Guardian consent on file
                </label>
              </div>
              <Button variant="danger" onClick={() => handleRemove(m.id)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Favourites (MVP) -------------------------------------------------------

const FAVOURITE_LISTING_LABEL: Record<Favourite["listingType"], string> = {
  centre: "Community centre",
  club: "Sports club",
  game: "Game",
  program_session: "Program session",
  club_session: "Club session",
};

// Interest → Participation states (Phase 6). 'joined' is normally set
// automatically by a real booking/registration/game-join — cycling forward
// here is a resident manually signalling stronger intent before that
// happens; you can't cycle backwards out of 'joined' since "I did this"
// shouldn't quietly revert.
const STATUS_LABEL: Record<Favourite["status"], string> = { interested: "Interested", planning: "Planning", joined: "Joined" };
const NEXT_STATUS: Record<Favourite["status"], Favourite["status"] | null> = { interested: "planning", planning: "joined", joined: null };
const STATUS_COLOR: Record<Favourite["status"], { fg: string; bg: string }> = {
  interested: { fg: colors.muted, bg: colors.panel },
  planning: { fg: colors.orangeDark, bg: "#FFF3D6" },
  joined: { fg: colors.greenText, bg: colors.greenBg },
};

// My Life's "Interested" section (IA spec §9) — rather than a fully
// separate tab duplicating this same fetch, Favourites already models
// interested/planning/joined (Phase 6); this filter surfaces "Interested"
// as its own visible view within the one panel that already owns the data.
const STATUS_FILTERS: { key: Favourite["status"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "interested", label: "Interested" },
  { key: "planning", label: "Planning" },
  { key: "joined", label: "Joined" },
];

function FavouritesPanel() {
  const navigate = useNavigate();
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Favourite["status"] | "all">("all");

  useEffect(() => {
    fetchFavourites()
      .then(setFavourites)
      .finally(() => setLoading(false));
  }, []);

  const handleRemove = async (f: Favourite) => {
    await removeFavourite(f.listingType, f.listingId);
    setFavourites((rows) => rows.filter((r) => !(r.listingType === f.listingType && r.listingId === f.listingId)));
  };

  const handleAdvanceStatus = async (f: Favourite) => {
    const next = NEXT_STATUS[f.status];
    if (!next) return;
    await updateFavouriteStatus(f.listingType, f.listingId, next);
    setFavourites((rows) => rows.map((r) => (r.listingType === f.listingType && r.listingId === f.listingId ? { ...r, status: next } : r)));
  };

  if (loading) return <RowSkeleton />;
  if (favourites.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No favourites yet" subtitle="Tap the heart on a centre or club to save it here." />;
  }

  const filtered = statusFilter === "all" ? favourites : favourites.filter((f) => f.status === statusFilter);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            style={{
              border: "none", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: statusFilter === s.key ? colors.dark : colors.panel, color: statusFilter === s.key ? "#fff" : colors.muted,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing here" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((f) => {
        const next = NEXT_STATUS[f.status];
        const detailHref = f.listingType === "centre" ? `/centres/${f.listingId}` : f.listingType === "club" ? `/clubs/${f.listingId}` : f.listingType === "game" ? `/games/${f.listingId}` : null;
        return (
          <div key={`${f.listingType}:${f.listingId}`} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={() => detailHref && navigate(detailHref)}
              disabled={!detailHref}
              style={{ background: "none", border: "none", padding: 0, cursor: detailHref ? "pointer" : "default", fontWeight: 700, color: colors.text, textAlign: "left" }}
            >
              {FAVOURITE_LISTING_LABEL[f.listingType]} — view listing
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => handleAdvanceStatus(f)}
                disabled={!next}
                title={next ? `Mark as ${STATUS_LABEL[next]}` : "Already joined"}
                style={{
                  fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 12px", border: "none",
                  color: STATUS_COLOR[f.status].fg, background: STATUS_COLOR[f.status].bg,
                  cursor: next ? "pointer" : "default",
                }}
              >
                {STATUS_LABEL[f.status]}
              </button>
              <Button variant="danger" onClick={() => handleRemove(f)}>Remove</Button>
            </div>
          </div>
        );
          })}
        </div>
      )}
    </div>
  );
}

// --- Resident notifications (MVP) -------------------------------------------

function NotificationsPanel() {
  const [notifications, setNotifications] = useState<ResidentNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchResidentNotifications()
      .then(setNotifications)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRead = async (id: number) => {
    await markResidentNotificationRead(id);
    setNotifications((rows) => rows.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
  };

  if (loading) return <RowSkeleton />;
  if (notifications.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="Nothing yet" subtitle="Waitlist offers and game updates will show up here." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          onClick={() => !n.read && handleRead(n.id)}
          style={{
            background: n.read ? "#fff" : colors.greenBg,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            padding: "14px 18px",
            cursor: n.read ? "default" : "pointer",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{n.title}</div>
          <div style={{ fontSize: 13.5, color: colors.mutedLight, marginTop: 2 }}>{n.body}</div>
        </div>
      ))}
    </div>
  );
}

// --- Passes (NEXT) -----------------------------------------------------

// --- Routines-as-an-object (IA spec §9) -------------------------------------
// The single most-named gap across every audit this project has run.
// Circles-from-repetition detects shared-participation patterns but never
// materialized a routine object a resident can see/pause/edit — this is
// that object. A routine is a personal planning aid, never an automatic
// booking (matches the spec's own explicit instruction for this screen).

const ROUTINE_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function RoutinesPanel() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [suggestions, setSuggestions] = useState<RoutineSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchMyRoutines(), fetchRoutineSuggestions()])
      .then(([r, s]) => {
        setRoutines(r);
        setSuggestions(s);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const acceptSuggestion = async (s: RoutineSuggestion) => {
    const key = `${s.activityLabel}::${s.dayOfWeek}`;
    setBusyKey(key);
    try {
      await createRoutine({ activityLabel: s.activityLabel, centreId: s.centreId, dayOfWeek: s.dayOfWeek, time: s.time });
      load();
    } finally {
      setBusyKey(null);
    }
  };

  const toggleStatus = async (r: Routine) => {
    setBusyKey(r.id);
    try {
      await updateRoutine(r.id, { status: r.status === "active" ? "paused" : "active" });
      load();
    } finally {
      setBusyKey(null);
    }
  };

  const cancelRoutine = async (r: Routine) => {
    setBusyKey(r.id);
    try {
      await updateRoutine(r.id, { status: "cancelled" });
      setRoutines((rows) => rows.filter((row) => row.id !== r.id));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <RowSkeleton />;

  const visibleSuggestions = suggestions.filter((s) => !dismissed.has(`${s.activityLabel}::${s.dayOfWeek}`));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {visibleSuggestions.length > 0 && (
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px", letterSpacing: ".02em" }}>SUGGESTED</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleSuggestions.map((s) => {
              const key = `${s.activityLabel}::${s.dayOfWeek}`;
              return (
                <div key={key} style={{ background: colors.greenBg, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.activityLabel}</div>
                    <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                      You've been going most {ROUTINE_DAY_NAMES[s.dayOfWeek - 1]}s ({s.sessionCount} times recently)
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button onClick={() => acceptSuggestion(s)} disabled={busyKey === key}>Make it a routine</Button>
                    <Button variant="ghost" onClick={() => setDismissed((d) => new Set(d).add(key))}>Not now</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: colors.muted, margin: "0 0 10px", letterSpacing: ".02em" }}>YOUR ROUTINES</h4>
        {routines.length === 0 ? (
          <EmptyState icon={<ChevronRightIcon size={20} />} title="No routines yet" subtitle="Keep showing up to the same activity and we'll suggest making it a routine." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {routines.map((r) => (
              <div key={r.id} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{r.activityLabel}</div>
                  <div style={{ fontSize: 12.5, color: colors.mutedLight, marginTop: 2 }}>
                    Every {ROUTINE_DAY_NAMES[r.dayOfWeek - 1]}{r.time ? ` · ${r.time}` : ""}{r.centreName ? ` · ${r.centreName}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: r.status === "active" ? colors.greenBg : colors.panel, color: r.status === "active" ? colors.greenText : colors.muted }}>
                    {r.status === "active" ? "Active" : "Paused"}
                  </span>
                  <Button variant="ghost" onClick={() => toggleStatus(r)} disabled={busyKey === r.id}>
                    {r.status === "active" ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="danger" onClick={() => cancelRoutine(r)} disabled={busyKey === r.id}>Cancel</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PassesPanel() {
  const [passes, setPasses] = useState<Pass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyPasses()
      .then(setPasses)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <RowSkeleton />;
  if (passes.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No passes yet" subtitle="A club offering a credit pack will show it on their page." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {passes.map((p) => (
        <div key={p.id} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{p.listingName}</div>
            <div style={{ fontSize: 13, color: colors.mutedLight }}>{p.creditsTotal - p.creditsUsed} of {p.creditsTotal} credits left</div>
          </div>
          <div style={{ fontWeight: 700 }}>{euro(p.purchasedCents / 100)}</div>
        </div>
      ))}
    </div>
  );
}

// --- receipts / payment history (Phase A) -----------------------------

const RECEIPT_LABELS: Record<Receipt["kind"], string> = { booking: "Hall booking", registration: "Club registration", game: "Game", pass: "Pass" };

function ReceiptsPanel() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReceipts()
      .then(setReceipts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <RowSkeleton />;
  if (receipts.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No payments yet" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {receipts.map((r) => (
        <div key={r.ref} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700 }}>{r.label}</div>
            <div style={{ fontSize: 13, color: colors.mutedLight }}>{RECEIPT_LABELS[r.kind]} · {r.ref} · {dateLabel(r.createdAt.slice(0, 10))}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>{euro(r.totalCents / 100)}</div>
            <div style={{ fontSize: 11, color: r.paymentStatus === "paid" ? colors.greenText : colors.faint }}>{r.paymentStatus}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- profile (name / home county) -------------------------------------------

const NOTIFICATION_CATEGORIES: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "bookingConfirmations", label: "Booking confirmations" },
  { key: "bookingReminders", label: "Booking reminders" },
  { key: "activityReminders", label: "Activity reminders" },
  { key: "waitlistOffers", label: "Waitlist offers" },
  { key: "openSpots", label: "Open spots nearby" },
  { key: "recommendations", label: "Recommendations" },
  { key: "circleAnnouncements", label: "Circle announcements" },
  { key: "routineReminders", label: "Routine reminders" },
  { key: "marketing", label: "News and offers" },
];

function ProfilePanel() {
  const navigate = useNavigate();
  const { resident, refresh } = useGuest();
  const [name, setName] = useState(resident?.name ?? "");
  const [homeCounty, setHomeCounty] = useState(resident?.homeCounty ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    bookingConfirmations: true,
    bookingReminders: true,
    activityReminders: true,
    waitlistOffers: true,
    openSpots: true,
    recommendations: true,
    circleAnnouncements: true,
    routineReminders: true,
    marketing: false,
  });
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [hostStatus, setHostStatus] = useState<HostStatus>("none");
  const [hostBio, setHostBio] = useState("");
  const [hostPhone, setHostPhone] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [prefGroupSize, setPrefGroupSize] = useState("");
  const [prefBeginnerFriendly, setPrefBeginnerFriendly] = useState(false);
  const [prefSoloFriendly, setPrefSoloFriendly] = useState(false);
  const [prefBudget, setPrefBudget] = useState("");
  const [comfortSaving, setComfortSaving] = useState(false);
  const [hideFromFamiliarCount, setHideFromFamiliarCount] = useState(false);
  const [discoverableByName, setDiscoverableByName] = useState(false);

  const loadProfile = () => {
    fetchResidentFull().then(({ resident: r }) => {
      if (!r) return;
      setName(r.name);
      setHomeCounty(r.homeCounty);
      setAccessibility(r.accessibilityPrefs);
      setHostStatus(r.hostStatus);
      setHostBio(r.hostBio);
      setHostPhone(r.hostPhone);
      setGoals(r.goals);
      setPrefGroupSize(r.prefGroupSize);
      setPrefBeginnerFriendly(r.prefBeginnerFriendly);
      setPrefSoloFriendly(r.prefSoloFriendly);
      setPrefBudget(r.prefBudget);
      setHideFromFamiliarCount(r.hideFromFamiliarCount);
      setDiscoverableByName(r.discoverableByName);
      setNotifPrefs(
        r.notificationPrefs ?? {
          bookingConfirmations: true,
          bookingReminders: true,
          activityReminders: true,
          waitlistOffers: true,
          openSpots: true,
          recommendations: true,
          circleAnnouncements: true,
          routineReminders: true,
          marketing: false,
        }
      );
    });
  };

  useEffect(loadProfile, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateResidentMe({ name, homeCounty });
      await refresh();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifPref = async (key: keyof NotificationPrefs) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    await saveNotificationPrefs(next);
  };

  const toggleAccessibility = async (opt: string) => {
    const next = accessibility.includes(opt) ? accessibility.filter((a) => a !== opt) : [...accessibility, opt];
    setAccessibility(next);
    await saveAccessibilityPrefs(next);
  };

  const toggleGoal = (opt: string) => {
    setGoals((gs) => (gs.includes(opt) ? gs.filter((g) => g !== opt) : [...gs, opt]));
  };

  const handleSaveComfort = async () => {
    setComfortSaving(true);
    try {
      await saveOnboarding({ goals, prefGroupSize, prefBeginnerFriendly, prefSoloFriendly, prefBudget });
    } finally {
      setComfortSaving(false);
    }
  };

  const toggleHideFromFamiliarCount = async () => {
    const next = !hideFromFamiliarCount;
    setHideFromFamiliarCount(next);
    await updatePrivacyPrefs({ hideFromFamiliarCount: next });
  };

  const toggleDiscoverableByName = async () => {
    const next = !discoverableByName;
    setDiscoverableByName(next);
    await updatePrivacyPrefs({ discoverableByName: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Home county</label>
            <input value={homeCounty} onChange={(e) => setHomeCounty(e.target.value)} style={inputStyle} />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
          <button onClick={() => navigate("/onboarding")} style={{ background: "none", border: "none", padding: 0, color: colors.greenText, fontWeight: 700, fontSize: 13, cursor: "pointer", textAlign: "left" }}>
            Revisit interests & availability
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Notifications</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NOTIFICATION_CATEGORIES.map((c) => (
            <label key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
              {c.label}
              <input type="checkbox" checked={notifPrefs[c.key] !== false} onChange={() => toggleNotifPref(c.key)} style={{ accentColor: colors.green }} />
            </label>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Accessibility</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Used to improve filtering — never shown to other participants.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ACCESSIBILITY_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => toggleAccessibility(opt)}
              style={{
                border: `1px solid ${accessibility.includes(opt) ? colors.green : colors.border}`,
                background: accessibility.includes(opt) ? colors.greenBg : "#fff",
                color: accessibility.includes(opt) ? colors.greenText : colors.text,
                borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Participation comfort</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Set once during onboarding — edit any time here.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {GOAL_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => toggleGoal(opt)}
              style={{
                border: `1px solid ${goals.includes(opt) ? colors.green : colors.border}`,
                background: goals.includes(opt) ? colors.greenBg : "#fff",
                color: goals.includes(opt) ? colors.greenText : colors.text,
                borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Preferred group size</label>
            <select value={prefGroupSize} onChange={(e) => setPrefGroupSize(e.target.value)} style={inputStyle}>
              <option value="">No preference</option>
              {GROUP_SIZE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Budget</label>
            <select value={prefBudget} onChange={(e) => setPrefBudget(e.target.value)} style={inputStyle}>
              <option value="">No preference</option>
              {BUDGET_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
            Prefer beginner-friendly activities
            <input type="checkbox" checked={prefBeginnerFriendly} onChange={(e) => setPrefBeginnerFriendly(e.target.checked)} style={{ accentColor: colors.green }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
            Prefer solo-friendly activities
            <input type="checkbox" checked={prefSoloFriendly} onChange={(e) => setPrefSoloFriendly(e.target.checked)} style={{ accentColor: colors.green }} />
          </label>
        </div>
        <Button onClick={handleSaveComfort} disabled={comfortSaving}>{comfortSaving ? "Saving…" : "Save"}</Button>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Privacy</div>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 10 }}>
          <span>Hide me from other people's "familiar faces" counts</span>
          <input type="checkbox" checked={hideFromFamiliarCount} onChange={toggleHideFromFamiliarCount} style={{ accentColor: colors.green }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 12 }}>
          <span>Let other residents find me by name when inviting to a Circle</span>
          <input type="checkbox" checked={discoverableByName} onChange={toggleDiscoverableByName} style={{ accentColor: colors.green }} />
        </label>
        <p style={{ fontSize: 12, color: colors.faint, margin: "8px 0 0" }}>Off by default. Only your name is ever shown — never your email or phone.</p>
      </div>

      <PaymentMethodsPanel />
      {resident && <HostDashboardPanel residentId={resident.id} />}
      <HostApplicationPanel hostStatus={hostStatus} hostBio={hostBio} hostPhone={hostPhone} onApplied={loadProfile} />
      <SearchAlertsPanel />
    </div>
  );
}

// --- Safety Centre (IA spec §13) ---------------------------------------
// Storage + visibility only — see blocked_residents' own comment in
// db/index.ts. Report history reads the same reports table Circle/review
// reporting already writes to (routes/reports.ts).

function SafetyCentrePanel() {
  const [blocked, setBlocked] = useState<BlockedResident[]>([]);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([fetchBlockedResidents(), fetchMyReports()])
      .then(([b, r]) => {
        setBlocked(b);
        setReports(r);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleUnblock = async (id: string) => {
    await unblockResident(id);
    setBlocked((rows) => rows.filter((b) => b.id !== id));
  };

  if (loading) return <RowSkeleton />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 520 }}>
      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Blocked people</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>
          People you've blocked won't be suggested as familiar faces. Block someone from a Circle or Game's chat.
        </p>
        {blocked.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>You haven't blocked anyone.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blocked.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14 }}>
                <span>{b.name}</span>
                <Button variant="ghost" onClick={() => handleUnblock(b.id)}>Unblock</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Your reports</div>
        <p style={{ fontSize: 12.5, color: colors.mutedLight, margin: "0 0 12px" }}>Content or people you've reported, and their review status.</p>
        {reports.length === 0 ? (
          <p style={{ fontSize: 13.5, color: colors.mutedLight, margin: 0 }}>You haven't reported anything.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reports.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13.5 }}>
                <span>{r.targetType} · {r.reason}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.status === "pending" ? colors.orangeDark : colors.greenText }}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Help & Support (IA spec §13) ---------------------------------------
// Static content — no ticketing system exists in this app; this is a
// self-serve FAQ + a mailto fallback, not a support-ticket integration.

const HELP_FAQS: { q: string; a: string }[] = [
  { q: "How do I cancel a booking?", a: "Open Bookings in My Life, expand the booking, and use Cancel. Refund policy depends on the venue's own terms, shown at checkout." },
  { q: "How do I get my money back?", a: "Refunds are processed by the venue or club, not automatically. Contact them via the booking confirmation email, or reach out to us if you don't hear back." },
  { q: "What's a Circle?", a: "A Circle is an ongoing group around a shared activity — think a standing weekly game or class, organised by one of its own members, not a vendor." },
  { q: "How does Verified Host work?", a: "Any resident can host a Game or Circle. Applying for Verified Host — under Profile — gets your application reviewed by our team; approved hosts get a badge next to their name." },
  { q: "How do I report a problem?", a: "Use the report option wherever you see it — on a Circle, a review, or a chat. You can track the outcome in Safety Centre → Your reports." },
];

function HelpSupportPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      {HELP_FAQS.map((f) => (
        <div key={f.q} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 6 }}>{f.q}</div>
          <div style={{ fontSize: 13.5, color: colors.mutedLight, lineHeight: 1.5 }}>{f.a}</div>
        </div>
      ))}
      <div style={{ background: colors.panel, borderRadius: 14, padding: "16px 18px", fontSize: 13.5, color: colors.muted }}>
        Still stuck? Email us at{" "}
        <a href="mailto:support@hellocircle.ie" style={{ color: colors.greenText, fontWeight: 700 }}>support@hellocircle.ie</a>.
      </div>
    </div>
  );
}

type MyStuffTab = "bookings" | "household" | "favourites" | "notifications" | "passes" | "receipts" | "profile" | "routines" | "safety" | "help";

// Two-tier tabs (UI/UX plan phase 5) — the flat 7-tab bar put every panel at
// equal visual weight regardless of how often a resident actually reaches
// for it. Primary tier stays a single click away; the rest sit behind one
// "More" toggle, matching this app's existing dropdown-with-outside-click
// convention (see Header.tsx).
const PRIMARY_TABS: { key: MyStuffTab; label: string }[] = [
  { key: "bookings", label: "Bookings" },
  { key: "household", label: "Household" },
  { key: "profile", label: "Profile" },
];
const MORE_TABS: { key: MyStuffTab; label: string }[] = [
  { key: "favourites", label: "Favourites" },
  { key: "routines", label: "Routines" },
  { key: "notifications", label: "Notifications" },
  { key: "passes", label: "Passes" },
  { key: "receipts", label: "Receipts" },
  { key: "safety", label: "Safety Centre" },
  { key: "help", label: "Help & Support" },
];

export function MyBookings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { email: guestEmail, refresh: refreshGuest } = useGuest();
  const [tab, setTab] = useState<MyStuffTab>("bookings");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [programEnrollments, setProgramEnrollments] = useState<MyProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  // Calendar grid view (IA spec §9) — a real month grid alongside the
  // existing time-bucketed list, not a replacement for it.
  const [bookingsView, setBookingsView] = useState<"list" | "calendar">("list");
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});

  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  const [signInEmail, setSignInEmail] = useState("");
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInSent, setSignInSent] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const loadMyStuff = () => {
    setLoading(true);
    return Promise.all([
      fetchMyBookings().then(setBookings),
      fetchMyRegistrations().then(setRegs),
      fetchMyProgramEnrollments().then(setProgramEnrollments),
      // Games/Circles require a signed-in resident (join/membership always
      // did) — a pure guest gets a 403 here, so fall back to empty rather
      // than let it reject the whole Promise.all.
      fetchMyGames().then(setGames).catch(() => setGames([])),
      fetchMyCircles().then(setCircles).catch(() => setCircles([])),
    ]).then(() => setLoading(false));
  };

  useEffect(() => {
    loadMyStuff();
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // A confirmation email links back to /bookings?ref=... (see server/src/notifications.ts)
  // for exactly this recovery flow — pre-fill and open the form on arrival.
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      setLookupRef(ref);
      setLookupOpen(true);
    }
  }, [searchParams]);

  // A "sign in" email links back to /bookings?token=... (see
  // server/src/routes/guestAuth.ts) — verify it once, then the guest-session
  // cookie is set and a refetch picks up every booking under that email.
  // verifiedTokenRef guards against React StrictMode's dev-only double-invoke
  // of effects — the token is single-use, so a second real call would fail
  // with a spurious "already used" error even though the first one worked.
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
    // Only ever act on the token once, on arrival — not on every searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendSignInLink = async () => {
    const email = signInEmail.trim();
    if (!email) return;
    setSignInLoading(true);
    setSignInError(null);
    try {
      await requestGuestLink(email);
      setSignInSent(true);
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : "Couldn't send a sign-in link");
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSignOut = async () => {
    await guestLogout();
    await refreshGuest();
    await loadMyStuff();
  };

  const hasNone = !loading && bookings.length === 0 && regs.length === 0 && games.length === 0 && circles.length === 0 && programEnrollments.length === 0;

  // Time-grouped view (Phase 5) — bookings/games have a real event date so
  // they sort into UPCOMING/PAST; registrations/programEnrollments/circles
  // are ongoing memberships with no single event date, so they always sit
  // under ONGOING regardless of when they started.
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

  return (
    <div style={{ animation: "fadeUp .35s ease both" }}>
      <section style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 80px" }}>
        <PageTitle style={{ margin: "0 0 20px" }}>My Life</PageTitle>

        {guestEmail && (
          <div style={{ marginBottom: 24, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <Tabs value={tab} onChange={setTab} options={PRIMARY_TABS} />
            <div ref={moreMenuRef} style={{ position: "relative" }}>
              <button
                className={`tab-btn ${MORE_TABS.some((t) => t.key === tab) ? "tab-btn-active" : ""}`}
                onClick={() => setMoreMenuOpen((o) => !o)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 10, fontWeight: 700, fontSize: 14, padding: "9px 16px",
                  background: MORE_TABS.some((t) => t.key === tab) ? colors.dark : colors.surface,
                  color: MORE_TABS.some((t) => t.key === tab) ? "#fff" : colors.text,
                  border: MORE_TABS.some((t) => t.key === tab) ? "none" : `1px solid ${colors.borderStrong}`,
                }}
              >
                More <ChevronRightIcon size={13} style={{ transform: moreMenuOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
              </button>
              {moreMenuOpen && (
                <div
                  className="pop-in"
                  style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, minWidth: 180, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 14, boxShadow: "0 16px 36px rgba(30,40,32,.14)", padding: 8 }}
                >
                  {MORE_TABS.map((t) => (
                    <button
                      key={t.key}
                      className="dropdown-item"
                      onClick={() => {
                        setTab(t.key);
                        setMoreMenuOpen(false);
                      }}
                      style={{
                        display: "block", width: "100%", background: t.key === tab ? colors.panel : "none", border: "none", borderRadius: 10,
                        padding: "10px 12px", fontSize: 14.5, fontWeight: t.key === tab ? 700 : 600, color: colors.text, textAlign: "left", cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "household" && <HouseholdPanel />}
        {tab === "favourites" && <FavouritesPanel />}
        {tab === "routines" && <RoutinesPanel />}
        {tab === "notifications" && <NotificationsPanel />}
        {tab === "passes" && <PassesPanel />}
        {tab === "receipts" && <ReceiptsPanel />}
        {tab === "profile" && <ProfilePanel />}
        {tab === "safety" && <SafetyCentrePanel />}
        {tab === "help" && <HelpSupportPanel />}

        {tab === "bookings" && (
        <>
        {verifying && (
          <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 16, padding: "14px 20px", marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
            Signing you in…
          </div>
        )}
        {verifyError && (
          <div style={{ background: colors.dangerBg, color: colors.danger, borderRadius: 16, padding: "14px 20px", marginBottom: 20, fontSize: 14 }}>
            {verifyError}
          </div>
        )}

        <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
          {guestEmail ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <span style={{ fontSize: 14.5 }}>
                Signed in as <strong>{guestEmail}</strong> — showing every booking under that email.
              </span>
              <button
                onClick={handleSignOut}
                style={{ background: "none", border: "none", color: colors.greenText, fontWeight: 700, fontSize: 14, cursor: "pointer", padding: 0 }}
              >
                Sign out
              </button>
            </div>
          ) : signInSent ? (
            <p style={{ margin: 0, fontSize: 14.5, color: colors.mutedLight }}>
              Check your inbox — we've sent a sign-in link to <strong>{signInEmail.trim()}</strong>.
            </p>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 12 }}>
                Sign in with your email to see everything you've booked
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 240px" }}>
                  <label style={labelStyle}>Email</label>
                  <input value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} placeholder="you@email.ie" style={inputStyle} />
                </div>
                <Button onClick={handleSendSignInLink} disabled={signInLoading || !signInEmail.trim()}>
                  {signInLoading ? "Sending…" : "Send me a link"}
                </Button>
              </div>
              {signInError && <div style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{signInError}</div>}
            </>
          )}
        </div>

        <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 28 }}>
          <button
            onClick={() => setLookupOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 15, fontWeight: 700, color: colors.text }}
          >
            Booked on another device? Find it by reference + email
            <ChevronRightIcon size={16} style={{ transform: lookupOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease", flex: "none" }} />
          </button>
          {lookupOpen && (
            <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
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
          )}
          {lookupError && <div style={{ color: colors.danger, fontSize: 13, marginTop: 10 }}>{lookupError}</div>}
        </div>

        {lookupResult && (
          <div style={{ marginBottom: 32 }}>
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

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 3 }, (_, i) => <RowSkeleton key={i} />)}
          </div>
        )}
        {hasNone && (
          <div style={{ background: "#fff", border: "1px dashed " + colors.borderStrong, borderRadius: 18, padding: 48, textAlign: "center" }}>
            <p style={{ color: colors.mutedLight, fontSize: 16, margin: "0 0 18px" }}>
              Nothing booked yet. Find a hall or a club to get started.
            </p>
            <button
              onClick={() => navigate("/")}
              style={{ background: colors.green, color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
            >
              Explore Hello Circle
            </button>
          </div>
        )}
        {!loading && !hasNone && (
          <MyLifeSummary bookings={bookings} regs={regs} games={games} programEnrollments={programEnrollments} circles={circles} />
        )}
        {!loading && !hasNone && (upcomingRows.length > 0 || pastRows.length > 0) && (
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
        {bookingsView === "calendar" && !loading && !hasNone && (
          <div style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 16, padding: 18, marginBottom: 32, maxWidth: 420 }}>
            <MonthCalendar items={[...upcomingRows, ...pastRows]} />
          </div>
        )}
        {bookingsView === "list" && upcomingRows.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              UPCOMING
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {upcomingRows.map((r) => r.el)}
            </div>
          </>
        )}
        {bookingsView === "list" && (regs.length > 0 || circles.length > 0 || programEnrollments.length > 0) && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              ONGOING
            </h2>
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
              {circles.map((c) => (
                <CircleRow key={c.id} circle={c} />
              ))}
              {programEnrollments.map((e) => (
                <ProgramEnrollmentRow key={e.ref} enrollment={e} />
              ))}
            </div>
          </>
        )}
        {bookingsView === "list" && pastRows.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              PAST
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {pastRows.map((r) => r.el)}
            </div>
          </>
        )}
        </>
        )}
      </section>
    </div>
  );
}
