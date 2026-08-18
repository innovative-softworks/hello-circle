import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  addFavourite,
  addHouseholdMember,
  cancelBooking,
  cancelRegistration,
  deleteHouseholdMember,
  fetchFavourites,
  fetchFeedbackStatus,
  fetchHousehold,
  fetchMyBookings,
  fetchMyPasses,
  fetchMyRegistrations,
  fetchReceipts,
  fetchResidentFull,
  fetchResidentNotifications,
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
  submitFeedback,
  updateResidentMe,
  verifyGuestLink,
} from "../api";
import { ChevronRightIcon } from "../components/icons";
import { Photo } from "../components/Photo";
import { Button, EmptyState, RowSkeleton, Tabs, inputStyle, labelStyle } from "../components/ui";
import { dateLabel, euro } from "../euro";
import { useGuest } from "../GuestContext";
import { colors, fonts } from "../theme";
import { ACCESSIBILITY_OPTIONS } from "../types";
import type { Favourite, HouseholdMember, MyBooking, MyRegistration, NotificationPrefs, Pass, Receipt, ResidentNotification, WaitlistOfferStatus } from "../types";

const cancelledBadgeStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#b00020", background: "#F6E3E3", borderRadius: 999, padding: "2px 8px" };
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
      {error && <span style={{ color: "#b00020", fontSize: 12.5 }}>{error}</span>}
    </div>
  );
}

// Post-activity feedback (Phase A) — a light "would you do this again",
// only offered once the booking's date has passed.
function FeedbackPrompt({ kind, reference }: { kind: "booking" | "registration"; reference: string }) {
  const [response, setResponse] = useState<string | null | "loading">("loading");
  useEffect(() => {
    fetchFeedbackStatus(kind, reference).then((r) => setResponse(r.response));
  }, [kind, reference]);

  if (response === "loading") return null;
  if (response) return <span style={{ fontSize: 12, color: colors.greenText, fontWeight: 700 }}>Thanks for the feedback!</span>;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: colors.muted }}>
      Would you do this again?
      {(["yes", "maybe", "no"] as const).map((r) => (
        <button
          key={r}
          onClick={() => submitFeedback(kind, reference, r).then(() => setResponse(r))}
          style={{ background: colors.panel, border: "none", borderRadius: 999, padding: "3px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

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
          {error && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{error}</div>}
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
            <div style={{ fontSize: 12, fontWeight: 700, color: colors.muted, marginBottom: 8 }}>RESCHEDULE</div>
            <RescheduleForm booking={booking} onDone={() => window.location.reload()} />
            {isPast && (
              <div style={{ marginTop: 16 }}>
                <FeedbackPrompt kind="booking" reference={booking.ref} />
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
          {error && <div style={{ color: "#b00020", fontSize: 12, marginTop: 4 }}>{error}</div>}
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
      await addHouseholdMember({ firstName: firstName.trim(), lastName: lastName.trim(), dob: dob || undefined });
      setFirstName("");
      setLastName("");
      setDob("");
      load();
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: number) => {
    await deleteHouseholdMember(id);
    setMembers((rows) => rows.filter((m) => m.id !== id));
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

function FavouritesPanel() {
  const navigate = useNavigate();
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFavourites()
      .then(setFavourites)
      .finally(() => setLoading(false));
  }, []);

  const handleRemove = async (f: Favourite) => {
    await removeFavourite(f.listingType, f.listingId);
    setFavourites((rows) => rows.filter((r) => !(r.listingType === f.listingType && r.listingId === f.listingId)));
  };

  if (loading) return <RowSkeleton />;
  if (favourites.length === 0) {
    return <EmptyState icon={<ChevronRightIcon size={20} />} title="No favourites yet" subtitle="Tap the heart on a centre or club to save it here." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {favourites.map((f) => (
        <div key={`${f.listingType}:${f.listingId}`} style={{ background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={() => navigate(f.listingType === "centre" ? `/centres/${f.listingId}` : `/clubs/${f.listingId}`)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: colors.text, textAlign: "left" }}
          >
            {f.listingType === "centre" ? "Community centre" : "Sports club"} — view listing
          </button>
          <Button variant="danger" onClick={() => handleRemove(f)}>Remove</Button>
        </div>
      ))}
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
  { key: "bookingReminders", label: "Reminders" },
  { key: "waitlistOffers", label: "Waitlist offers" },
  { key: "recommendations", label: "Recommendations" },
  { key: "circleAnnouncements", label: "Circle announcements" },
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
    waitlistOffers: true,
    recommendations: true,
    circleAnnouncements: true,
  });
  const [accessibility, setAccessibility] = useState<string[]>([]);

  useEffect(() => {
    fetchResidentFull().then(({ resident: r }) => {
      if (!r) return;
      setName(r.name);
      setHomeCounty(r.homeCounty);
      setAccessibility(r.accessibilityPrefs);
      setNotifPrefs(
        r.notificationPrefs ?? {
          bookingConfirmations: true,
          bookingReminders: true,
          waitlistOffers: true,
          recommendations: true,
          circleAnnouncements: true,
        }
      );
    });
  }, []);

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
    </div>
  );
}

type MyStuffTab = "bookings" | "household" | "favourites" | "notifications" | "passes" | "receipts" | "profile";

export function MyBookings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { email: guestEmail, refresh: refreshGuest } = useGuest();
  const [tab, setTab] = useState<MyStuffTab>("bookings");
  const [bookings, setBookings] = useState<MyBooking[]>([]);
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [loading, setLoading] = useState(true);
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
    return Promise.all([fetchMyBookings().then(setBookings), fetchMyRegistrations().then(setRegs)]).then(() => setLoading(false));
  };

  useEffect(() => {
    loadMyStuff();
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

  const hasNone = !loading && bookings.length === 0 && regs.length === 0;

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
        <h1 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34, margin: "0 0 20px", letterSpacing: "-.02em" }}>
          My bookings
        </h1>

        {guestEmail && (
          <div style={{ marginBottom: 24 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { key: "bookings", label: "Bookings" },
                { key: "household", label: "Household" },
                { key: "favourites", label: "Favourites" },
                { key: "notifications", label: "Notifications" },
                { key: "passes", label: "Passes" },
                { key: "receipts", label: "Receipts" },
                { key: "profile", label: "Profile" },
              ]}
            />
          </div>
        )}

        {tab === "household" && <HouseholdPanel />}
        {tab === "favourites" && <FavouritesPanel />}
        {tab === "notifications" && <NotificationsPanel />}
        {tab === "passes" && <PassesPanel />}
        {tab === "receipts" && <ReceiptsPanel />}
        {tab === "profile" && <ProfilePanel />}

        {tab === "bookings" && (
        <>
        {verifying && (
          <div style={{ background: colors.greenBg, color: colors.greenText, borderRadius: 16, padding: "14px 20px", marginBottom: 20, fontSize: 14, fontWeight: 600 }}>
            Signing you in…
          </div>
        )}
        {verifyError && (
          <div style={{ background: "#F6E3E3", color: "#b00020", borderRadius: 16, padding: "14px 20px", marginBottom: 20, fontSize: 14 }}>
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
              {signInError && <div style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>{signInError}</div>}
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
          {lookupError && <div style={{ color: "#b00020", fontSize: 13, marginTop: 10 }}>{lookupError}</div>}
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
        {bookings.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              HALL BOOKINGS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {bookings.map((b) => (
                <BookingRow
                  key={b.ref}
                  booking={b}
                  onCancel={() => handleCancelBooking(b.ref, guestEmail ?? undefined)}
                  cancelling={cancellingRef === b.ref}
                  error={cancelErrors[b.ref]}
                />
              ))}
            </div>
          </>
        )}
        {regs.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: colors.muted, margin: "0 0 12px", letterSpacing: ".02em" }}>
              CLUB REGISTRATIONS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {regs.map((r) => (
                <RegistrationRow
                  key={r.ref}
                  registration={r}
                  onCancel={() => handleCancelRegistration(r.ref, guestEmail ?? undefined)}
                  cancelling={cancellingRef === r.ref}
                  error={cancelErrors[r.ref]}
                />
              ))}
            </div>
          </>
        )}
        </>
        )}
      </section>
    </div>
  );
}
