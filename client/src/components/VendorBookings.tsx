import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dateLabel } from "../euro";
import {
  cancelVendorBooking,
  cancelVendorRegistration,
  checkInBooking,
  fetchCheckInStatus,
  fetchVendorBookings,
  fetchVendorDemand,
  fetchVendorRegistrations,
  refundVendorBooking,
  refundVendorRegistration,
  resendBookingConfirmation,
  resendRegistrationConfirmation,
} from "../api";
import { AwardIcon, CalendarIcon, CheckIcon, SearchIcon } from "./icons";
import { Avatar, Button, ConfirmDialog, EmptyState, LoadErrorState, ManageCard as Card, tableStyle, tdStyle, thStyle } from "./ui";
import { RecordState, RecordView } from "./workspace/RecordView";
import { Facts, SectionLabel } from "./admin/adminUi";
import { useRecordParam, useUrlParam } from "../useUrlTab";
import { DemandSignalsView } from "./DemandSignals";
import { VendorActionNeeded } from "./VendorActionNeeded";
import { MonthCalendar } from "./MonthCalendar";
import { colors, fonts, radius } from "../theme";
import type { DemandRow, MyRegistration, VendorBookingRow } from "../types";
import { irelandToday } from "../irelandDate";

// Bookings/registrations visibility (with manual check-in) + demand
// intelligence — split out of the original single VendorDashboard.tsx (see
// CLAUDE.md).

// Manual check-in (Tier 3, FUTURE-scaffolding made usable) — no QR/hardware,
// just a button a vendor taps at the door. State is owned by BookingsTab
// (`checkedInRefs`), not local to this button, so a bulk "Check in
// selected" action and an individual click both land in the same place —
// previously this managed its own local state and never preloaded real
// status, so a bulk check-in wouldn't have been reflected here at all.
// Release 3 — booking no longer implies attendance: once the date has
// arrived a host can also record a no-show (canMarkNoShow), and existing
// attendance is preloaded from the list endpoints instead of starting empty.
function CheckInButton({
  kind,
  reference,
  checkedIn,
  noShow = false,
  canMarkNoShow = false,
  onChecked,
  onNoShow,
}: {
  kind: "booking" | "registration";
  reference: string;
  checkedIn: boolean;
  noShow?: boolean;
  canMarkNoShow?: boolean;
  onChecked: (reference: string) => void;
  onNoShow?: (reference: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mark = async (status: "present" | "no_show") => {
    setBusy(true);
    setError(null);
    try {
      await checkInBooking(kind, reference, status);
      if (status === "present") onChecked(reference);
      else onNoShow?.(reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update attendance");
    } finally {
      setBusy(false);
    }
  };
  const handleClick = () => mark("present");

  if (noShow && !checkedIn) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors.orangeDark, background: colors.orangeBg, borderRadius: radius.pill, padding: "3px 10px" }}>No-show</span>
        <button onClick={handleClick} disabled={busy} style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}>
          {busy ? "…" : "Undo — they came"}
        </button>
      </span>
    );
  }

  if (checkedIn) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 10px", flex: "none" }}>
        <CheckIcon size={11} /> Checked in
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      {error && <span style={{ fontSize: 10.5, color: colors.orangeDark }}>{error}</span>}
      <button
        onClick={handleClick}
        disabled={busy}
        style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "3px 10px", cursor: "pointer", flex: "none" }}
      >
        {busy ? "…" : "Check in"}
      </button>
      {canMarkNoShow && (
        <button
          onClick={() => mark("no_show")}
          disabled={busy}
          style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", flex: "none" }}
        >
          No-show
        </button>
      )}
    </span>
  );
}

// One-off, per-row "Resend confirmation" — small enough not to warrant a
// full detail popup for registrations (which don't have one today).
function ResendConfirmationButton({ onResend }: { onResend: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) return <span style={{ fontSize: 11, color: colors.greenText, fontWeight: 700 }}>Sent</span>;
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onResend();
          setSent(true);
        } finally {
          setBusy(false);
        }
      }}
      style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "3px 10px", cursor: "pointer" }}
    >
      {busy ? "…" : "Resend"}
    </button>
  );
}

type StatusFilter = "all" | "confirmed" | "cancelled";
type WhenFilter = "all" | "upcoming" | "past";

function filterPillStyle(active: boolean) {
  return {
    fontSize: 11.5,
    fontWeight: 700,
    padding: "4px 10px",
    borderRadius: radius.pill,
    border: "none",
    cursor: "pointer",
    background: active ? colors.dark : colors.panel,
    color: active ? "#fff" : colors.muted,
  } as const;
}

// Shared filter bar — applies to both the bookings and registrations
// tables below. "When" only narrows bookings: a registration is a one-time
// sign-up with no scheduled date of its own (same distinction
// vendorOperations.ts's /today endpoint already draws).
function BookingsFilterBar({
  status,
  onStatus,
  when,
  onWhen,
  search,
  onSearch,
}: {
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  when: WhenFilter;
  onWhen: (v: WhenFilter) => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <Card style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {(["all", "confirmed", "cancelled"] as const).map((s) => (
          <button key={s} onClick={() => onStatus(s)} style={filterPillStyle(status === s)}>
            {s === "all" ? "All" : s === "confirmed" ? "Confirmed" : "Cancelled"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {(["upcoming", "past", "all"] as const).map((w) => (
          <button key={w} onClick={() => onWhen(w)} style={filterPillStyle(when === w)}>
            {w === "all" ? "All dates" : w === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 200px", minWidth: 160 }}>
        <SearchIcon size={13} style={{ color: colors.faint, flex: "none" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name or email"
          style={{ flex: 1, border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: "6px 10px", fontSize: 12.5 }}
        />
      </div>
    </Card>
  );
}

function BulkActionBar({ count, onCheckIn, onCancel, busy }: { count: number; onCheckIn?: () => void; onCancel: () => void; busy: boolean }) {
  if (count === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: colors.panel, borderRadius: radius.control, padding: "8px 12px", marginBottom: 12 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.muted }}>{count} selected</span>
      {onCheckIn && (
        <Button variant="ghost" style={{ padding: "5px 12px", fontSize: 12 }} disabled={busy} onClick={onCheckIn}>
          Check in selected
        </Button>
      )}
      <Button variant="ghost" style={{ padding: "5px 12px", fontSize: 12, color: colors.danger }} disabled={busy} onClick={onCancel}>
        Cancel selected
      </Button>
    </div>
  );
}

// Booking-detail timeline (Host Manage spec §10) — only steps this app
// actually has data for: `createdAt` and `attendance.checked_in_at` are
// real timestamps; "Payment received" is a real state with no stored
// moment (bookings/registrations have no confirmed_at/paid_at column), so
// it renders as an achieved/not state, not a fabricated time; "Cancelled"
// sources its timestamp from audit_log (written by the cancel routes),
// the only place that moment is actually recorded. Deliberately no
// "Reminder sent" step — this app doesn't send booking reminders at all.
function TimelineStep({ label, achieved, time }: { label: string; achieved: boolean; time?: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
      <span
        style={{
          width: 18, height: 18, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: achieved ? colors.greenBg : colors.panel, color: achieved ? colors.greenText : colors.faint,
        }}
      >
        {achieved && <CheckIcon size={10} />}
      </span>
      <span style={{ fontSize: 13, fontWeight: achieved ? 700 : 500, color: achieved ? colors.text : colors.faint }}>{label}</span>
      {time && <span style={{ fontSize: 11.5, color: colors.mutedLight, marginLeft: "auto" }}>{new Date(time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>}
    </div>
  );
}

/** Separate, labelled statuses for one hall booking — never one ambiguous badge. */
function bookingStatusLabels(b: VendorBookingRow) {
  const booking = b.status === "cancelled" ? { text: "Cancelled", tone: "danger" } : { text: "Confirmed", tone: "ok" };
  const payment =
    b.paymentStatus === "paid"
      ? { text: b.hasStripePayment ? "Paid online" : "Paid", tone: "ok" }
      : b.paymentStatus === "refunded"
        ? { text: "Refunded", tone: "neutral" }
        : b.paymentStatus === "pending"
          ? { text: b.hasStripePayment ? "Awaiting online payment" : "Pay at venue", tone: "warn" }
          : b.paymentStatus === "failed"
            ? { text: "Payment failed", tone: "danger" }
            : { text: b.paymentStatus, tone: "neutral" };
  // A cancelled booking that was paid online and not refunded is waiting for its refund.
  const refund = b.status === "cancelled" && b.paymentStatus === "paid" && b.hasStripePayment ? { text: "Refund pending", tone: "warn" } : null;
  return { booking, payment, refund };
}

function StatusChip({ label, value }: { label: string; value: { text: string; tone: string } }) {
  const style =
    value.tone === "danger"
      ? { color: colors.danger, background: colors.dangerBg }
      : value.tone === "ok"
        ? { color: colors.greenText, background: colors.greenBg }
        : value.tone === "warn"
          ? { color: colors.orangeDark, background: colors.orangeBg }
          : { color: colors.text, background: colors.panel };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
      <span style={{ color: colors.mutedLight }}>{label}:</span>
      <span style={{ ...style, fontWeight: 700, borderRadius: radius.pill, padding: "2px 8px" }}>{value.text}</span>
    </span>
  );
}

// Booking record page (was a modal). Addressed by `?record=booking:<ref>`, so
// it can be shared and refreshed; "Back" returns to the filtered list.
function BookingRecord({ booking, onBack, onCancelled, onRefunded }: { booking: VendorBookingRow; onBack: () => void; onCancelled: (ref: string) => void; onRefunded: (ref: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [refundConfirming, setRefundConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [checkIn, setCheckIn] = useState<{ checkedIn: boolean; checkedInAt: string | null; cancelledAt: string | null } | null>(null);
  const [checkInFailed, setCheckInFailed] = useState(false);

  const loadCheckIn = () => {
    setCheckInFailed(false);
    fetchCheckInStatus("booking", booking.ref)
      .then(setCheckIn)
      .catch(() => setCheckInFailed(true));
  };
  useEffect(() => {
    setResent(false);
    setCheckIn(null);
    loadCheckIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.ref]);

  // Throwing keeps the confirmation open with the message (ConfirmDialog).
  const handleCancel = async () => {
    const result = await cancelVendorBooking(booking.ref);
    setConfirming(false);
    onCancelled(booking.ref);
    // The cancellation stands either way; a failed refund waits under "Action needed".
    if (result.refund === "failed") setNotice(`Cancelled, but the refund didn't go through (${result.refundError ?? "provider error"}). It's listed under Action needed.`);
    else setNotice(result.refund === "refunded" ? "Booking cancelled and refunded in full." : "Booking cancelled. The guest has been notified.");
  };
  const handleRefund = async () => {
    await refundVendorBooking(booking.ref);
    setRefundConfirming(false);
    onRefunded(booking.ref);
    setNotice("Refund issued.");
  };
  const handleResend = async () => {
    setError(null);
    setResendBusy(true);
    try {
      await resendBookingConfirmation(booking.ref);
      setResent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resend the confirmation");
    } finally {
      setResendBusy(false);
    }
  };

  const st = bookingStatusLabels(booking);
  const canRefund = booking.paymentStatus === "paid" && Boolean(booking.hasStripePayment);
  const total = `€${(booking.totalCents / 100).toFixed(2)}`;

  return (
    <RecordView
      title={booking.name}
      reference={
        <>
          Hall booking · {dateLabel(booking.date)} · {booking.time} · <span className="adm-mono">{booking.ref}</span>
        </>
      }
      backLabel="Bookings"
      onBack={onBack}
      statuses={
        <>
          <StatusChip label="Booking" value={st.booking} />
          <StatusChip label="Payment" value={st.payment} />
          {st.refund && <StatusChip label="Refund" value={st.refund} />}
          <StatusChip label="Check-in" value={checkIn?.checkedIn ? { text: "Checked in", tone: "ok" } : { text: checkInFailed ? "Unknown" : "Not checked in", tone: "neutral" }} />
        </>
      }
      actions={
        <>
          {booking.status !== "cancelled" && (
            <Button variant="ghost" onClick={handleResend} disabled={resent || resendBusy} aria-busy={resendBusy || undefined}>
              {resent ? "Confirmation resent" : resendBusy ? "Sending…" : "Resend confirmation"}
            </Button>
          )}
          {canRefund && (
            <Button variant="ghost" onClick={() => setRefundConfirming(true)}>
              Issue refund
            </Button>
          )}
          {booking.status !== "cancelled" && (
            <Button onClick={() => setConfirming(true)} style={{ background: colors.dangerSolid }}>
              Cancel booking
            </Button>
          )}
        </>
      }
    >
      {notice && (
        <p role="status" style={{ background: colors.panel, padding: "10px 12px", margin: "0 0 16px", fontSize: 13.5 }}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: colors.danger, fontSize: 13.5, margin: "0 0 16px" }}>
          {error}
        </p>
      )}
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Booking</SectionLabel>
          <Facts
            rows={[
              ["Venue", booking.centreName],
              ["Room", booking.roomName ?? "—"],
              ["Date and time", `${dateLabel(booking.date)} · ${booking.time}`],
              ["Duration", `${booking.duration} hour${booking.duration === 1 ? "" : "s"}`],
              ["Event type", booking.eventType || "—"],
              ["Guests", String(booking.guests)],
              ["Notes", booking.notes || "—"],
            ]}
          />
          <SectionLabel>Payment</SectionLabel>
          <Facts
            rows={[
              ["Total", total],
              ["How it was paid", booking.hasStripePayment ? "Online (Stripe)" : "At the venue / free"],
              ["Payment status", st.payment.text],
              ["Refund", booking.paymentStatus === "refunded" ? "Refunded" : st.refund ? "Pending — cancelled after online payment" : "None"],
            ]}
          />
          <p className="adm-note" style={{ marginTop: 6 }}>
            Settlement and payout to your bank are shown under Earnings; they aren't tracked per booking.
          </p>
        </div>
        <div>
          <SectionLabel>Guest</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Avatar name={booking.name} size={36} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5 }}>
              <a href={`mailto:${booking.email}`} style={{ color: colors.text, fontWeight: 600 }}>{booking.email}</a>
              {booking.phone && <a href={`tel:${booking.phone}`} style={{ color: colors.mutedLight }}>{booking.phone}</a>}
            </div>
          </div>
          <SectionLabel>History</SectionLabel>
          <TimelineStep label="Booked" achieved time={booking.createdAt} />
          <TimelineStep label="Payment received" achieved={booking.paymentStatus === "paid" || booking.paymentStatus === "refunded"} />
          <TimelineStep label="Checked in" achieved={!!checkIn?.checkedIn} time={checkIn?.checkedInAt} />
          {booking.status === "cancelled" && <TimelineStep label="Cancelled" achieved time={checkIn?.cancelledAt} />}
          {booking.paymentStatus === "refunded" && <TimelineStep label="Refunded" achieved />}
          {checkInFailed && (
            <p role="alert" style={{ fontSize: 13, color: colors.danger, margin: "8px 0 0" }}>
              Couldn't load check-in history.{" "}
              <button type="button" className="btn-reset" onClick={loadCheckIn} style={{ textDecoration: "underline", fontWeight: 600 }}>
                Try again
              </button>
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Cancel ${booking.name}'s booking?`}
        message={`${dateLabel(booking.date)} · ${booking.time} · ${booking.centreName}. The guest is notified. ${booking.hasStripePayment && booking.paymentStatus === "paid" ? `They paid ${total} online, so they're refunded in full automatically.` : "Nothing was paid online, so there's nothing to refund."}`}
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        onConfirm={handleCancel}
        onCancel={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={refundConfirming}
        title={`Refund ${total} to ${booking.name}?`}
        message="This refunds whatever is still refundable on this booking through Stripe. It can't be undone, and it doesn't cancel the booking."
        confirmLabel="Issue refund"
        onConfirm={handleRefund}
        onCancel={() => setRefundConfirming(false)}
      />
    </RecordView>
  );
}

// `centreId`/`clubId` (Host Manage spec §8) narrow this to one listing's own
// Bookings sub-tab, reusing every bit of dashboard-wide behaviour (filters,
// bulk actions, detail popup, timeline, resend, registration cancel) instead of a
// second copy — a centre has no registrations and a club has no hall
// bookings, so whichever table doesn't apply to the given scope is hidden.
export function BookingsTab({ centreId, clubId }: { centreId?: string; clubId?: string } = {}) {
  const [bookings, setBookings] = useState<VendorBookingRow[]>([]);
  const [registrations, setRegistrations] = useState<(MyRegistration & { email: string; phone: string })[]>([]);
  const [view, setView] = useUrlParam<"list" | "calendar">("bview", "list");
  // The open booking is a page addressed by the URL (`?record=booking:<ref>`).
  const [record, openRecord, closeRecord] = useRecordParam();
  const openRef = record?.startsWith("booking:") ? record.slice(8) : null;
  const setOpenRef = (ref: string | null) => (ref ? openRecord(`booking:${ref}`) : closeRecord());
  const [loaded, setLoaded] = useState({ bookings: false, registrations: false });
  const [loadError, setLoadError] = useState<{ bookings: boolean; registrations: boolean }>({ bookings: false, registrations: false });

  const [statusFilter, setStatusFilter] = useUrlParam<StatusFilter>("bstatus", "all");
  const [whenFilter, setWhenFilter] = useUrlParam<WhenFilter>("bwhen", "upcoming");
  const [search, setSearch] = useUrlParam<string>("bq", "");

  const [checkedInRefs, setCheckedInRefs] = useState<Set<string>>(new Set());
  const [noShowRefs, setNoShowRefs] = useState<Set<string>>(new Set());
  const [selectedBookings, setSelectedBookings] = useState<Set<string>>(new Set());
  const [selectedRegistrations, setSelectedRegistrations] = useState<Set<string>>(new Set());
  const [bulkCancelTarget, setBulkCancelTarget] = useState<{ kind: "booking" | "registration"; refs: string[] } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [refundRegistrationRef, setRefundRegistrationRef] = useState<string | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const showBookings = !clubId;
  const showRegistrations = !centreId;

  // Preload recorded attendance (Release 3) so check-ins and no-shows from
  // an earlier visit or the QR scanner show up, instead of an empty state.
  const preloadAttendance = (kind: "booking" | "registration", rows: { ref: string; attendance?: string | null }[]) => {
    setCheckedInRefs((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => (r.attendance === "present" || r.attendance === "late") && next.add(`${kind}:${r.ref}`));
      return next;
    });
    setNoShowRefs((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => r.attendance === "no_show" && next.add(`${kind}:${r.ref}`));
      return next;
    });
  };

  const loadBookings = () => {
    setLoadError((e) => ({ ...e, bookings: false }));
    fetchVendorBookings(centreId)
      .then((rows) => {
        setBookings(rows);
        preloadAttendance("booking", rows);
        setLoaded((l) => ({ ...l, bookings: true }));
      })
      .catch(() => setLoadError((e) => ({ ...e, bookings: true })));
  };
  const loadRegistrations = () => {
    setLoadError((e) => ({ ...e, registrations: false }));
    fetchVendorRegistrations(clubId)
      .then((rows) => {
        setRegistrations(rows);
        preloadAttendance("registration", rows);
        setLoaded((l) => ({ ...l, registrations: true }));
      })
      .catch(() => setLoadError((e) => ({ ...e, registrations: true })));
  };
  useEffect(() => {
    if (showBookings) loadBookings();
    if (showRegistrations) loadRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId, clubId]);

  const today = irelandToday();

  const filteredBookings = useMemo(
    () =>
      bookings.filter((b) => {
        if (statusFilter !== "all" && b.status !== statusFilter) return false;
        if (whenFilter === "upcoming" && b.date < today) return false;
        if (whenFilter === "past" && b.date >= today) return false;
        if (search && !`${b.name} ${b.email}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [bookings, statusFilter, whenFilter, search, today]
  );

  // Registrations have no `date` of their own (a one-time sign-up, not
  // scheduled — same distinction vendorOperations.ts's /today endpoint
  // already draws), so the When filter only narrows bookings.
  const filteredRegistrations = useMemo(
    () =>
      registrations.filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (search && !`${r.childFirst} ${r.childLast} ${r.email}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [registrations, statusFilter, search]
  );

  const openBooking = bookings.find((b) => b.ref === openRef) ?? null;

  const handleCancelled = (ref: string) => {
    setBookings((prev) => prev.map((b) => (b.ref === ref ? { ...b, status: "cancelled" } : b)));
  };

  const handleRefunded = (ref: string) => {
    setBookings((prev) => prev.map((b) => (b.ref === ref ? { ...b, paymentStatus: "refunded" } : b)));
  };

  const markCheckedIn = (kind: "booking" | "registration", reference: string) => {
    setCheckedInRefs((prev) => new Set(prev).add(`${kind}:${reference}`));
    setNoShowRefs((prev) => {
      const next = new Set(prev);
      next.delete(`${kind}:${reference}`);
      return next;
    });
  };
  const markNoShow = (kind: "booking" | "registration", reference: string) => {
    setNoShowRefs((prev) => new Set(prev).add(`${kind}:${reference}`));
    setCheckedInRefs((prev) => {
      const next = new Set(prev);
      next.delete(`${kind}:${reference}`);
      return next;
    });
  };

  const toggleSelected = (set: React.Dispatch<React.SetStateAction<Set<string>>>, ref: string) => {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const handleBulkCheckIn = async (kind: "booking" | "registration", refs: string[]) => {
    setBulkBusy(true);
    setBulkError(null);
    try {
      await Promise.all(refs.map((ref) => checkInBooking(kind, ref)));
      refs.forEach((ref) => markCheckedIn(kind, ref));
      if (kind === "booking") setSelectedBookings(new Set());
      else setSelectedRegistrations(new Set());
    } catch {
      setBulkError("Some check-ins failed — please check and retry");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleRefundRegistration = async () => {
    if (!refundRegistrationRef) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      await refundVendorRegistration(refundRegistrationRef);
      setRegistrations((prev) => prev.map((r) => (r.ref === refundRegistrationRef ? { ...r, paymentStatus: "refunded" } : r)));
      setRefundRegistrationRef(null);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Couldn't issue this refund");
    } finally {
      setRefundBusy(false);
    }
  };

  const handleBulkCancel = async () => {
    if (!bulkCancelTarget) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const cancelFn = bulkCancelTarget.kind === "booking" ? cancelVendorBooking : cancelVendorRegistration;
      await Promise.all(bulkCancelTarget.refs.map((ref) => cancelFn(ref)));
      if (bulkCancelTarget.kind === "booking") {
        setBookings((prev) => prev.map((b) => (bulkCancelTarget.refs.includes(b.ref) ? { ...b, status: "cancelled" } : b)));
        setSelectedBookings(new Set());
      } else {
        setRegistrations((prev) => prev.map((r) => (bulkCancelTarget.refs.includes(r.ref) ? { ...r, status: "cancelled" } : r)));
        setSelectedRegistrations(new Set());
      }
      setBulkCancelTarget(null);
    } catch {
      setBulkError("Some cancellations failed — please check and retry");
    } finally {
      setBulkBusy(false);
    }
  };

  // HC-QA-066 — a real button (keyboard-reachable, named), not a clickable div.
  const bookingRow = (b: VendorBookingRow) => (
    <button
      type="button"
      className="btn-reset"
      onClick={() => setOpenRef(b.ref)}
      style={{ display: "flex", width: "100%", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, opacity: b.status === "cancelled" ? 0.55 : 1 }}
    >
      <span>{b.time} · {b.roomName ?? b.centreName} · {b.name}</span>
      <span style={{ color: colors.mutedLight }}>{b.status === "cancelled" ? "Cancelled" : "Confirmed"}</span>
    </button>
  );

  // Vendor Experience Polish — mobile card fallback for the bookings table
  // below (`.hide-mobile`/`.mobile-cards`, see index.css). Tapping a card
  // opens the same detail popup the desktop row does — that's the "primary
  // contextual action" plus every secondary action (resend/refund/cancel/
  // check-in) in one place, so this doesn't need its own "•••" menu.
  // Bulk multi-select isn't carried into the card view (harder to hit
  // targets reliably on a phone, and every action is one tap away in the
  // popup regardless) — desktop/tablet keep it via the table.
  const bookingCard = (b: VendorBookingRow) => (
    <Card key={b.ref} onClick={() => setOpenRef(b.ref)} style={{ cursor: "pointer", opacity: b.status === "cancelled" ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name={b.name} size={28} />
          <div>
            <button type="button" className="btn-reset" onClick={(e) => { e.stopPropagation(); setOpenRef(b.ref); }} aria-label={`Open booking for ${b.name}`} style={{ fontWeight: 700, fontSize: 13.5 }}>{b.name}</button>
            <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{b.roomName ? `${b.centreName} — ${b.roomName}` : b.centreName}</div>
          </div>
        </div>
        {b.status === "cancelled" ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Cancelled</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Confirmed</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: colors.muted, marginBottom: 8 }}>{b.date} · {b.time}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>€{(b.totalCents / 100).toFixed(2)}</span>
        {b.paymentStatus === "refunded" && (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Refunded</span>
        )}
      </div>
    </Card>
  );

  // Vendor Experience Polish — mobile card fallback for the registrations
  // table below. Registrations have no detail popup (unlike bookings), so
  // every action stays visible on the card itself rather than being tucked
  // behind a "•••" that would hide the only way to reach it.
  const registrationCard = (r: MyRegistration & { email: string; phone: string }) => (
    <Card key={r.ref} style={{ opacity: r.status === "cancelled" ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name={`${r.childFirst} ${r.childLast}`} size={28} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.childFirst} {r.childLast}</div>
            <div style={{ fontSize: 11.5, color: colors.mutedLight }}>{r.clubName}</div>
          </div>
        </div>
        {r.status === "cancelled" ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Cancelled</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px", flex: "none" }}>Confirmed</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: colors.mutedLight, marginBottom: 8 }}>{r.email}, {r.phone}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>€{(r.totalCents / 100).toFixed(2)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {r.paymentStatus === "refunded" && (
            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Refunded</span>
          )}
          {r.status !== "cancelled" && (
            <>
              <CheckInButton
                kind="registration"
                reference={r.ref}
                checkedIn={checkedInRefs.has(`registration:${r.ref}`)}
                noShow={noShowRefs.has(`registration:${r.ref}`)}
                canMarkNoShow
                onChecked={(ref) => markCheckedIn("registration", ref)}
                onNoShow={(ref) => markNoShow("registration", ref)}
              />
              <ResendConfirmationButton onResend={() => resendRegistrationConfirmation(r.ref).then(() => {})} />
              {r.paymentStatus === "paid" && Boolean(r.hasStripePayment) && (
                <button
                  onClick={() => setRefundRegistrationRef(r.ref)}
                  style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "3px 10px", cursor: "pointer" }}
                >
                  Refund
                </button>
              )}
              <button
                onClick={() => setBulkCancelTarget({ kind: "registration", refs: [r.ref] })}
                style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: "none", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );

  if (openRef) {
    if (loadError.bookings && !loaded.bookings) return <RecordState state="error" backLabel="Bookings" onBack={closeRecord} onRetry={loadBookings} />;
    if (!loaded.bookings) return <RecordState state="loading" backLabel="Bookings" onBack={closeRecord} />;
    if (!openBooking) return <RecordState state="missing" backLabel="Bookings" onBack={closeRecord} message="It may belong to another organisation, or the reference is wrong." />;
    return <BookingRecord booking={openBooking} onBack={closeRecord} onCancelled={handleCancelled} onRefunded={handleRefunded} />;
  }

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Booking UX Phase 6 — refunds and deposits still owed, across every order type (org-wide view only). */}
      {!centreId && !clubId && <VendorActionNeeded />}
      <BookingsFilterBar status={statusFilter} onStatus={setStatusFilter} when={whenFilter} onWhen={setWhenFilter} search={search} onSearch={setSearch} />
      {bulkError && <p style={{ color: colors.danger, fontSize: 13 }}>{bulkError}</p>}

      {showBookings && (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Hall bookings</h2>
          <div style={{ display: "flex", gap: 6 }}>
            {(["list", "calendar"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  border: "none", borderRadius: radius.pill, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
                  background: view === v ? colors.dark : colors.panel, color: view === v ? "#fff" : colors.muted,
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {loadError.bookings ? (
          <LoadErrorState title="Couldn't load hall bookings." onRetry={loadBookings} />
        ) : !loaded.bookings ? (
          <p role="status" aria-busy="true" style={{ fontSize: 13.5, color: colors.mutedLight }}>Loading bookings…</p>
        ) : filteredBookings.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={26} />} title={bookings.length === 0 ? "No bookings yet" : "No bookings match these filters"} />
        ) : view === "calendar" ? (
          <MonthCalendar items={filteredBookings.map((b) => ({ date: b.date, el: bookingRow(b) }))} />
        ) : (
          <>
            <BulkActionBar
              count={selectedBookings.size}
              busy={bulkBusy}
              onCheckIn={() => handleBulkCheckIn("booking", [...selectedBookings])}
              onCancel={() => setBulkCancelTarget({ kind: "booking", refs: [...selectedBookings] })}
            />
            <div className="mobile-cards">{filteredBookings.map(bookingCard)}</div>
            <div className="hide-mobile" style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle} />
                    <th style={thStyle}>Guest</th>
                    <th style={thStyle}>Centre</th>
                    <th style={thStyle}>Date/Time</th>
                    <th style={thStyle}>Contact</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookings.map((b) => (
                    <tr key={b.ref} onClick={() => setOpenRef(b.ref)} style={{ opacity: b.status === "cancelled" ? 0.55 : 1, cursor: "pointer" }}>
                      <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                        {b.status !== "cancelled" && (
                          <input type="checkbox" checked={selectedBookings.has(b.ref)} onChange={() => toggleSelected(setSelectedBookings, b.ref)} />
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar name={b.name} size={24} />
                          {/* HC-QA-066 — keyboard path to the same detail the row click opens. */}
                          <button type="button" className="btn-reset" onClick={(e) => { e.stopPropagation(); setOpenRef(b.ref); }} aria-label={`Open booking for ${b.name}`} style={{ fontWeight: 600 }}>{b.name}</button>
                        </div>
                      </td>
                      <td style={tdStyle}>{b.roomName ? `${b.centreName} — ${b.roomName}` : b.centreName}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{b.date} {b.time}</td>
                      <td style={{ ...tdStyle, color: colors.mutedLight }}>{b.email}, {b.phone}</td>
                      <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {b.status === "cancelled" ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" }}>Cancelled</span>
                          ) : (
                            <CheckInButton
                              kind="booking"
                              reference={b.ref}
                              checkedIn={checkedInRefs.has(`booking:${b.ref}`)}
                              noShow={noShowRefs.has(`booking:${b.ref}`)}
                              canMarkNoShow={b.date <= today}
                              onChecked={(ref) => markCheckedIn("booking", ref)}
                              onNoShow={(ref) => markNoShow("booking", ref)}
                            />
                          )}
                          {b.paymentStatus === "refunded" && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Refunded</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      )}
      {showRegistrations && (
      <Card>
        <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h2>
        {loadError.registrations ? (
          <LoadErrorState title="Couldn't load club registrations." onRetry={loadRegistrations} />
        ) : !loaded.registrations ? (
          <p role="status" aria-busy="true" style={{ fontSize: 13.5, color: colors.mutedLight }}>Loading registrations…</p>
        ) : filteredRegistrations.length === 0 ? (
          <EmptyState icon={<AwardIcon size={26} />} title={registrations.length === 0 ? "No registrations yet" : "No registrations match these filters"} />
        ) : (
          <>
            <BulkActionBar
              count={selectedRegistrations.size}
              busy={bulkBusy}
              onCheckIn={() => handleBulkCheckIn("registration", [...selectedRegistrations])}
              onCancel={() => setBulkCancelTarget({ kind: "registration", refs: [...selectedRegistrations] })}
            />
            <div className="mobile-cards">{filteredRegistrations.map(registrationCard)}</div>
            <div className="hide-mobile" style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle} />
                    <th style={thStyle}>Registrant</th>
                    <th style={thStyle}>Club</th>
                    <th style={thStyle}>Contact</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegistrations.map((r) => (
                    <tr key={r.ref} style={{ opacity: r.status === "cancelled" ? 0.55 : 1 }}>
                      <td style={tdStyle}>
                        {r.status !== "cancelled" && (
                          <input type="checkbox" checked={selectedRegistrations.has(r.ref)} onChange={() => toggleSelected(setSelectedRegistrations, r.ref)} />
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar name={`${r.childFirst} ${r.childLast}`} size={24} />
                          {r.childFirst} {r.childLast}
                        </div>
                      </td>
                      <td style={tdStyle}>{r.clubName}</td>
                      <td style={{ ...tdStyle, color: colors.mutedLight }}>{r.email}, {r.phone}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {r.status === "cancelled" ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" }}>Cancelled</span>
                          ) : (
                            <CheckInButton
                kind="registration"
                reference={r.ref}
                checkedIn={checkedInRefs.has(`registration:${r.ref}`)}
                noShow={noShowRefs.has(`registration:${r.ref}`)}
                canMarkNoShow
                onChecked={(ref) => markCheckedIn("registration", ref)}
                onNoShow={(ref) => markNoShow("registration", ref)}
              />
                          )}
                          {r.paymentStatus === "refunded" && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, borderRadius: radius.pill, padding: "2px 8px" }}>Refunded</span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {r.status !== "cancelled" && (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <ResendConfirmationButton onResend={() => resendRegistrationConfirmation(r.ref).then(() => {})} />
                            {r.paymentStatus === "paid" && Boolean(r.hasStripePayment) && (
                              <button
                                onClick={() => setRefundRegistrationRef(r.ref)}
                                style={{ fontSize: 11, fontWeight: 700, color: colors.muted, background: colors.panel, border: "none", borderRadius: radius.pill, padding: "3px 10px", cursor: "pointer" }}
                              >
                                Refund
                              </button>
                            )}
                            <button
                              onClick={() => setBulkCancelTarget({ kind: "registration", refs: [r.ref] })}
                              style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: "none", border: "none", cursor: "pointer" }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      )}

      <ConfirmDialog
        open={!!bulkCancelTarget}
        title={bulkCancelTarget && bulkCancelTarget.refs.length > 1 ? `Cancel ${bulkCancelTarget.refs.length} ${bulkCancelTarget.kind}s?` : `Cancel this ${bulkCancelTarget?.kind}?`}
        message="Every guest will be notified. Anyone who paid online is refunded in full automatically."
        confirmLabel={bulkBusy ? "Cancelling…" : "Cancel"}
        busy={bulkBusy}
        onConfirm={handleBulkCancel}
        onCancel={() => setBulkCancelTarget(null)}
      />
      <ConfirmDialog
        open={!!refundRegistrationRef}
        title="Issue a refund?"
        message="This refunds the full amount to the guest via Stripe — this can't be undone."
        confirmLabel={refundBusy ? "Refunding…" : "Issue refund"}
        busy={refundBusy}
        onConfirm={handleRefundRegistration}
        onCancel={() => setRefundRegistrationRef(null)}
      >
        {refundError && <p style={{ color: colors.danger, fontSize: 13 }}>{refundError}</p>}
      </ConfirmDialog>
    </div>
  );
}

// --- demand intelligence (Tier 3) — search_misses was logged with nothing
// to show it. Purely descriptive: no action a vendor can take from here
// beyond deciding to create a listing/session that matches the demand. ------

export function DemandTab() {
  const [rows, setRows] = useState<DemandRow[] | "forbidden" | null>(null);
  const [scope, setScope] = useState<"own" | "all">("own");

  useEffect(() => {
    setRows(null);
    fetchVendorDemand(scope)
      .then(setRows)
      .catch(() => setRows("forbidden"));
  }, [scope]);

  return (
    <div className="fade-panel">
      <DemandSignalsView
        title="What people are searching for"
        subtitle={
          scope === "own"
            ? "Searches in your county for your kind of listing that returned nothing — a signal for what to add next."
            : "Every unmet search across the platform, not just your own county or listing type."
        }
        rows={rows}
        scope={{ value: scope, onChange: setScope }}
      />
    </div>
  );
}
