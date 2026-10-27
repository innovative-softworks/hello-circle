import { useEffect, useMemo, useState, type ReactNode } from "react";
import { VendorAllOrders } from "./VendorAllOrders";
import { BookingChangeHistory, ProposeChangeDialog } from "./workspace/BookingChangeParts";
import { dateLabel } from "../euro";
import {
  cancelVendorBooking,
  proposeVendorBookingChange,
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
import { Award, Building2, CalendarDays, List, ListChecks, QrCode, X } from "lucide-react";
import { ScanPassModal, readPassCode, type ScanResult } from "./pass/ScanPassModal";
import { ActionMenu } from "./ActionMenu";
import { useToast } from "./Toast";
import { RecordState, RecordView } from "./workspace/RecordView";
import { DetailStats } from "./workspace/DetailParts";
import { AdminButton, Box, Facts, IconTabs, SearchField, SectionLabel, SelectField, Toolbar } from "./admin/adminUi";
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
        <span className="adm-chip" data-tone="warn">No-show</span>
        <AdminButton size="sm" variant="quiet" onClick={handleClick} disabled={busy}>
          {busy ? "…" : "Undo — they came"}
        </AdminButton>
      </span>
    );
  }

  if (checkedIn) {
    return (
      <span className="adm-chip" data-tone="good">
        <CheckIcon size={11} /> Checked in
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none", flexWrap: "wrap" }}>
      {error && <span className="adm-field-error">{error}</span>}
      <AdminButton size="sm" onClick={handleClick} disabled={busy}>
        {busy ? "…" : "Check in"}
      </AdminButton>
      {canMarkNoShow && (
        <AdminButton size="sm" variant="quiet" onClick={() => mark("no_show")} disabled={busy}>
          No-show
        </AdminButton>
      )}
    </span>
  );
}

type StatusFilter = "all" | "confirmed" | "cancelled";
type WhenFilter = "all" | "upcoming" | "past";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
];
const WHEN_OPTIONS: { value: WhenFilter; label: string }[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All dates" },
];

// One toolbar for both lists (bookings and registrations). "When" only
// narrows bookings: a registration is a one-time sign-up with no date of its
// own. Filters that differ from the default show as removable chips.
function BookingsFilterBar({
  status,
  onStatus,
  when,
  onWhen,
  search,
  onSearch,
  showWhen,
}: {
  status: StatusFilter;
  onStatus: (v: StatusFilter) => void;
  when: WhenFilter;
  onWhen: (v: WhenFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  showWhen: boolean;
}) {
  const chips: { label: string; clear: () => void }[] = [];
  if (status !== "all") chips.push({ label: STATUS_OPTIONS.find((o) => o.value === status)!.label, clear: () => onStatus("all") });
  if (showWhen && when !== "upcoming") chips.push({ label: WHEN_OPTIONS.find((o) => o.value === when)!.label, clear: () => onWhen("upcoming") });
  if (search) chips.push({ label: `"${search}"`, clear: () => onSearch("") });
  return (
    <div>
      <Toolbar label="Filter bookings">
        <SearchField label="Search" placeholder="Name or email" value={search} onChange={onSearch} />
        <SelectField label="Status" value={status} onChange={onStatus} options={STATUS_OPTIONS} />
        {showWhen && <SelectField label="When" value={when} onChange={onWhen} options={WHEN_OPTIONS} />}
      </Toolbar>
      {chips.length > 0 && (
        <div className="ws-fchips" aria-label="Active filters">
          {chips.map((c) => (
            <button key={c.label} type="button" className="adm-chip ws-fchip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
              {c.label} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            className="adm-linkish"
            onClick={() => {
              onStatus("all");
              onWhen("upcoming");
              onSearch("");
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function BulkActionBar({ count, onCheckIn, onCancel, onClear, busy }: { count: number; onCheckIn?: () => void; onCancel: () => void; onClear: () => void; busy: boolean }) {
  if (count === 0) return null;
  return (
    <div className="adm-bulk" role="region" aria-label="Bulk actions">
      <span aria-live="polite">{count} selected</span>
      {onCheckIn && (
        <AdminButton size="sm" variant="primary" disabled={busy} onClick={onCheckIn}>
          Check in {count}
        </AdminButton>
      )}
      <AdminButton size="sm" variant="danger" disabled={busy} onClick={onCancel}>
        Cancel {count}
      </AdminButton>
      <AdminButton size="sm" variant="quiet" disabled={busy} onClick={onClear}>
        Clear selection
      </AdminButton>
      {busy && <span role="status">Working…</span>}
    </div>
  );
}

/** "Fri 16 Oct · 18:00" */
function whenLabel(date: string, time?: string | null) {
  return time ? `${dateLabel(date)} · ${time}` : dateLabel(date);
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
  const [proposing, setProposing] = useState(false);
  const [changesKey, setChangesKey] = useState(0);

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
          {booking.status !== "cancelled" && booking.paymentStatus === "paid" && (
            <Button variant="ghost" onClick={() => setProposing(true)}>
              Propose a new time
            </Button>
          )}
          {booking.status !== "cancelled" && (
            <Button onClick={() => setConfirming(true)} style={{ background: colors.dangerSolid }}>
              Cancel booking
            </Button>
          )}
        </>
      }
      stats={
        <DetailStats
          items={[
            { label: "Total", value: total, sub: booking.hasStripePayment ? "Paid online" : "At the venue / free" },
            { label: "When", value: dateLabel(booking.date), sub: booking.time },
            { label: "Duration", value: `${booking.duration} h`, sub: booking.roomName ?? booking.centreName },
            { label: "Guests", value: String(booking.guests), sub: booking.eventType || undefined },
          ]}
        />
      }
      aside={
        <>
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
      <SectionLabel>Booking</SectionLabel>
      <Facts
        rows={[
          ["Venue", booking.centreName],
          ["Room", booking.roomName ?? "—"],
          ["Event type", booking.eventType || "—"],
          ["Notes", booking.notes || "—"],
        ]}
      />
      <SectionLabel>Payment</SectionLabel>
      <Facts
        rows={[
          ["How it was paid", booking.hasStripePayment ? "Online (Stripe)" : "At the venue / free"],
          ["Payment status", st.payment.text],
          ["Refund", booking.paymentStatus === "refunded" ? "Refunded" : st.refund ? "Pending — cancelled after online payment" : "None"],
        ]}
      />
      <p className="adm-note" style={{ marginTop: 6 }}>
        Settlement and payout to your bank are shown under Earnings; they aren't tracked per booking.
      </p>
      <div style={{ marginTop: 20 }}>
        <BookingChangeHistory bookingRef={booking.ref} refreshKey={changesKey} canWithdraw={booking.status !== "cancelled"} />
      </div>
      <ProposeChangeDialog
        open={proposing}
        onClose={() => setProposing(false)}
        current={{ date: booking.date, time: booking.time }}
        onPropose={async (input) => {
          await proposeVendorBookingChange(booking.ref, input);
          setChangesKey((k) => k + 1);
        }}
      />
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
  const [scanning, setScanning] = useState(false);
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
  const toast = useToast();
  // Hall bookings / Club registrations are tabs when both apply.
  const [section, setSection] = useUrlParam<"all" | "bookings" | "registrations">("bsec", "bookings");
  // OG-13 — "All orders" only on the top-level Bookings page (not a single listing's).
  const showAll = !centreId && !clubId && section === "all";
  const showBookingsSection = !showAll && showBookings && (!showRegistrations || section === "bookings");
  const showRegistrationsSection = !showAll && showRegistrations && (!showBookings || section === "registrations");
  const viewToggle = (
    <div className="ws-seg" role="group" aria-label="Show hall bookings as">
      {(["list", "calendar"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
          {v === "list" ? <List size={15} aria-hidden="true" /> : <CalendarDays size={15} aria-hidden="true" />}
          {v === "list" ? "List" : "Month"}
        </button>
      ))}
    </div>
  );

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

  const resend = async (kind: "booking" | "registration", ref: string) => {
    try {
      await (kind === "booking" ? resendBookingConfirmation(ref) : resendRegistrationConfirmation(ref));
      toast.success("Confirmation sent again");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resend the confirmation");
    }
  };

  const checkIn = (kind: "booking" | "registration", ref: string, canMarkNoShow: boolean) => (
    <CheckInButton
      kind={kind}
      reference={ref}
      checkedIn={checkedInRefs.has(`${kind}:${ref}`)}
      noShow={noShowRefs.has(`${kind}:${ref}`)}
      canMarkNoShow={canMarkNoShow}
      onChecked={(r) => markCheckedIn(kind, r)}
      onNoShow={(r) => markNoShow(kind, r)}
    />
  );

  const selectAll = (rows: { ref: string; status: string }[], selected: Set<string>, set: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const open = rows.filter((r) => r.status !== "cancelled").map((r) => r.ref);
    const all = open.length > 0 && open.every((r) => selected.has(r));
    return (
      <input
        type="checkbox"
        aria-label={all ? "Clear selection" : "Select all"}
        checked={all}
        disabled={open.length === 0}
        onChange={() => set(all ? new Set() : new Set(open))}
      />
    );
  };

  // Scan passes (owner 2026-10-27): a room booking or club registration pass
  // holds its reference; the check-in is the same call as the row's button.
  const onScan = async (text: string): Promise<ScanResult> => {
    const code = readPassCode(text);
    if (!code) return { ok: false, message: "That isn't a HelloCircle pass." };
    if (code.kind !== "booking" && code.kind !== "registration") return { ok: false, message: "That pass isn't for a room booking or club registration." };
    const kind = code.kind;
    const ref = code.ref;
    const b = kind === "booking" ? bookings.find((x) => x.ref.toUpperCase() === ref) : undefined;
    const r = kind === "registration" ? registrations.find((x) => x.ref.toUpperCase() === ref) : undefined;
    const who = b ? b.name : r ? `${r.childFirst} ${r.childLast}`.trim() : ref;
    if ((b ?? r)?.status === "cancelled") return { ok: false, message: `${who}: this ${kind} was cancelled.` };
    const realRef = b?.ref ?? r?.ref ?? ref;
    if (checkedInRefs.has(`${kind}:${realRef}`)) return { ok: true, message: `${who} is already checked in.` };
    await checkInBooking(kind, realRef, "present", "qr");
    markCheckedIn(kind, realRef);
    return { ok: true, message: `Checked in: ${who}` };
  };

  if (scanning) {
    return <ScanPassModal open title="Scan passes" hint="Room bookings and club registrations. Hold the code on their pass inside the square." onClose={() => setScanning(false)} onCode={onScan} />;
  }

  if (openRef) {
    if (loadError.bookings && !loaded.bookings) return <RecordState state="error" backLabel="Bookings" onBack={closeRecord} onRetry={loadBookings} />;
    if (!loaded.bookings) return <RecordState state="loading" backLabel="Bookings" onBack={closeRecord} />;
    if (!openBooking) return <RecordState state="missing" backLabel="Bookings" onBack={closeRecord} message="It may belong to another organisation, or the reference is wrong." />;
    return <BookingRecord booking={openBooking} onBack={closeRecord} onCancelled={handleCancelled} onRefunded={handleRefunded} />;
  }

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Booking UX Phase 6 — refunds and deposits still owed, across every order type (org-wide view only). */}
      {!centreId && !clubId && <VendorActionNeeded />}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <AdminButton size="sm" onClick={() => setScanning(true)}>
          <QrCode size={15} aria-hidden="true" /> Scan passes
        </AdminButton>
      </div>
      {!showAll && <BookingsFilterBar
        status={statusFilter}
        onStatus={setStatusFilter}
        when={whenFilter}
        onWhen={setWhenFilter}
        search={search}
        onSearch={setSearch}
        showWhen={showBookingsSection}
      />}
      {bulkError && (
        <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
          {bulkError}
        </p>
      )}

      {showBookings && showRegistrations && (
        <div className="ws-tabrow">
          <IconTabs
            label="Bookings and registrations"
            value={section}
            onChange={setSection}
            items={[
              ...(!centreId && !clubId ? [{ key: "all" as const, label: "All orders", icon: ListChecks }] : []),
              { key: "bookings", label: "Hall bookings", icon: Building2, count: loaded.bookings ? filteredBookings.length : undefined },
              { key: "registrations", label: "Club registrations", icon: Award, count: loaded.registrations ? filteredRegistrations.length : undefined },
            ]}
          />
          {section === "bookings" && viewToggle}
        </div>
      )}
      {showBookings && !showRegistrations && <div className="ws-tabrow ws-tabrow--end">{viewToggle}</div>}
      {showAll && (
        <VendorAllOrders
          onOpenBooking={(ref) => setOpenRef(ref)}
          onOpenRegistration={(ref) => {
            setSection("registrations");
            setSearch(ref);
          }}
        />
      )}

      {showBookingsSection && (
        <Box flush>
          {loadError.bookings ? (
            <div style={{ padding: 16 }}>
              <LoadErrorState title="Couldn't load hall bookings." onRetry={loadBookings} />
            </div>
          ) : !loaded.bookings ? (
            <p role="status" aria-busy="true" className="adm-note" style={{ padding: 16, margin: 0 }}>
              Loading bookings…
            </p>
          ) : filteredBookings.length === 0 ? (
            <EmptyState icon={<CalendarIcon size={22} />} title={bookings.length === 0 ? "No bookings yet" : "No bookings match these filters"} />
          ) : view === "calendar" ? (
            <div style={{ padding: 16 }}>
              <MonthCalendar items={filteredBookings.map((b) => ({ date: b.date, el: bookingRow(b) }))} />
            </div>
          ) : (
            <>
              <BulkActionBar
                count={selectedBookings.size}
                busy={bulkBusy}
                onCheckIn={() => handleBulkCheckIn("booking", [...selectedBookings])}
                onCancel={() => setBulkCancelTarget({ kind: "booking", refs: [...selectedBookings] })}
                onClear={() => setSelectedBookings(new Set())}
              />
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Hall bookings</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="adm-col-check">
                        {selectAll(filteredBookings, selectedBookings, setSelectedBookings)}
                      </th>
                      <th scope="col">Guest</th>
                      <th scope="col">Space</th>
                      <th scope="col">When</th>
                      <th scope="col">Email</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBookings.map((b) => {
                      const cancelled = b.status === "cancelled";
                      return (
                        <tr key={b.ref} data-clickable="true" onClick={() => setOpenRef(b.ref)} style={{ opacity: cancelled ? 0.6 : 1 }}>
                          <td className="adm-col-check" onClick={(e) => e.stopPropagation()}>
                            {!cancelled && (
                              <input type="checkbox" aria-label={`Select booking for ${b.name}`} checked={selectedBookings.has(b.ref)} onChange={() => toggleSelected(setSelectedBookings, b.ref)} />
                            )}
                          </td>
                          <td data-label="Guest">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <Avatar name={b.name} size={24} />
                              {/* HC-QA-066 — keyboard path to the same detail the row click opens. */}
                              <button type="button" className="btn-reset" onClick={(e) => { e.stopPropagation(); setOpenRef(b.ref); }} aria-label={`Open booking for ${b.name}`} style={{ fontWeight: 600 }}>
                                {b.name}
                              </button>
                            </div>
                          </td>
                          <td data-label="Space">
                            {b.roomName ?? b.centreName}
                            {b.roomName && <div className="adm-note">{b.centreName}</div>}
                          </td>
                          <td data-label="When" style={{ whiteSpace: "nowrap" }}>
                            {whenLabel(b.date, b.time)}
                          </td>
                          <td data-label="Email" title={b.phone ? `Phone: ${b.phone}` : undefined} style={{ color: "var(--adm-muted)" }}>
                            {b.email}
                          </td>
                          <td data-label="Status" onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {cancelled ? <span className="adm-chip" data-tone="warn">Cancelled</span> : checkIn("booking", b.ref, b.date <= today)}
                              {b.paymentStatus === "refunded" && <span className="adm-chip">Refunded</span>}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
                            <ActionMenu
                              label={`More actions for ${b.name}'s booking`}
                              buttonText="" className="ws-icon-menu"
                              items={[
                                { label: "Open booking", onSelect: () => setOpenRef(b.ref) },
                                ...(cancelled ? [] : [{ label: "Resend confirmation", onSelect: () => resend("booking", b.ref) }]),
                                ...(cancelled ? [] : [{ label: "Cancel booking", danger: true, onSelect: () => setBulkCancelTarget({ kind: "booking", refs: [b.ref] }) }]),
                              ]}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Box>
      )}

      {showRegistrationsSection && (
        <Box flush>
          {loadError.registrations ? (
            <div style={{ padding: 16 }}>
              <LoadErrorState title="Couldn't load club registrations." onRetry={loadRegistrations} />
            </div>
          ) : !loaded.registrations ? (
            <p role="status" aria-busy="true" className="adm-note" style={{ padding: 16, margin: 0 }}>
              Loading registrations…
            </p>
          ) : filteredRegistrations.length === 0 ? (
            <EmptyState icon={<AwardIcon size={22} />} title={registrations.length === 0 ? "No registrations yet" : "No registrations match these filters"} />
          ) : (
            <>
              <BulkActionBar
                count={selectedRegistrations.size}
                busy={bulkBusy}
                onCheckIn={() => handleBulkCheckIn("registration", [...selectedRegistrations])}
                onCancel={() => setBulkCancelTarget({ kind: "registration", refs: [...selectedRegistrations] })}
                onClear={() => setSelectedRegistrations(new Set())}
              />
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Club registrations</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="adm-col-check">
                        {selectAll(filteredRegistrations, selectedRegistrations, setSelectedRegistrations)}
                      </th>
                      <th scope="col">Registrant</th>
                      <th scope="col">Club</th>
                      <th scope="col">Email</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="adm-visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegistrations.map((r) => {
                      const cancelled = r.status === "cancelled";
                      const name = `${r.childFirst} ${r.childLast}`;
                      return (
                        <tr key={r.ref} style={{ opacity: cancelled ? 0.6 : 1 }}>
                          <td className="adm-col-check">
                            {!cancelled && (
                              <input type="checkbox" aria-label={`Select registration for ${name}`} checked={selectedRegistrations.has(r.ref)} onChange={() => toggleSelected(setSelectedRegistrations, r.ref)} />
                            )}
                          </td>
                          <td data-label="Registrant">
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <Avatar name={name} size={24} />
                              <strong style={{ fontWeight: 600 }}>{name}</strong>
                            </div>
                          </td>
                          <td data-label="Club">{r.clubName}</td>
                          <td data-label="Email" title={r.phone ? `Phone: ${r.phone}` : undefined} style={{ color: "var(--adm-muted)" }}>
                            {r.email}
                          </td>
                          <td data-label="Status">
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {cancelled ? <span className="adm-chip" data-tone="warn">Cancelled</span> : checkIn("registration", r.ref, true)}
                              {r.paymentStatus === "refunded" && <span className="adm-chip">Refunded</span>}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {!cancelled && (
                              <ActionMenu
                                label={`More actions for ${name}'s registration`}
                                buttonText="" className="ws-icon-menu"
                                items={[
                                  { label: "Resend confirmation", onSelect: () => resend("registration", r.ref) },
                                  ...(r.paymentStatus === "paid" && Boolean(r.hasStripePayment) ? [{ label: "Issue a refund", onSelect: () => setRefundRegistrationRef(r.ref) }] : []),
                                  { label: "Cancel registration", danger: true, onSelect: () => setBulkCancelTarget({ kind: "registration", refs: [r.ref] }) },
                                ]}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Box>
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
