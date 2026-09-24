import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { Avatar, Button, ManageCard as Card, ConfirmDialog, Drawer, EmptyState, tableStyle, tdStyle, thStyle } from "./ui";
import { DemandSignalsView } from "./DemandSignals";
import { MonthCalendar } from "./MonthCalendar";
import { colors, fonts, radius } from "../theme";
import type { DemandRow, MyRegistration, VendorBookingRow } from "../types";

// Bookings/registrations visibility (with manual check-in) + demand
// intelligence — split out of the original single VendorDashboard.tsx (see
// CLAUDE.md).

// Manual check-in (Tier 3, FUTURE-scaffolding made usable) — no QR/hardware,
// just a button a vendor taps at the door. State is owned by BookingsTab
// (`checkedInRefs`), not local to this button, so a bulk "Check in
// selected" action and an individual click both land in the same place —
// previously this managed its own local state and never preloaded real
// status, so a bulk check-in wouldn't have been reflected here at all.
function CheckInButton({ kind, reference, checkedIn, onChecked }: { kind: "booking" | "registration"; reference: string; checkedIn: boolean; onChecked: (reference: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkInBooking(kind, reference);
      onChecked(reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check in");
    } finally {
      setBusy(false);
    }
  };

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
    </span>
  );
}

// One-off, per-row "Resend confirmation" — small enough not to warrant a
// full detail drawer for registrations (which don't have one today).
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
    borderRadius: 100,
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

function BookingDetailDrawer({ booking, onClose, onCancelled, onRefunded }: { booking: VendorBookingRow | null; onClose: () => void; onCancelled: (ref: string) => void; onRefunded: (ref: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [refundConfirming, setRefundConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [checkIn, setCheckIn] = useState<{ checkedIn: boolean; checkedInAt: string | null; cancelledAt: string | null } | null>(null);

  useEffect(() => {
    setResent(false);
    setCheckIn(null);
    if (booking) fetchCheckInStatus("booking", booking.ref).then(setCheckIn).catch(() => setCheckIn(null));
  }, [booking?.ref]);

  const handleCancel = async () => {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      await cancelVendorBooking(booking.ref);
      setConfirming(false);
      onCancelled(booking.ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't cancel this booking");
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async () => {
    if (!booking) return;
    setRefundBusy(true);
    setRefundError(null);
    try {
      await refundVendorBooking(booking.ref);
      setRefundConfirming(false);
      onRefunded(booking.ref);
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : "Couldn't issue this refund");
    } finally {
      setRefundBusy(false);
    }
  };

  const handleResend = async () => {
    if (!booking) return;
    setError(null);
    try {
      await resendBookingConfirmation(booking.ref);
      setResent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resend the confirmation");
    }
  };

  const row = (label: string, value: ReactNode) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: `1px solid ${colors.border}`, fontSize: 13.5 }}>
      <span style={{ color: colors.mutedLight }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );

  return (
    <Drawer open={!!booking} onClose={onClose} title="Booking detail">
      {booking && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={booking.name} size={36} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{booking.name}</div>
              <div style={{ fontSize: 12.5, color: colors.mutedLight }}>{booking.email} · {booking.phone}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: colors.mutedLight, marginBottom: 4 }}>Timeline</div>
            <TimelineStep label="Booked" achieved time={booking.createdAt} />
            <TimelineStep label="Payment received" achieved={booking.paymentStatus === "paid"} />
            <TimelineStep label="Checked in" achieved={!!checkIn?.checkedIn} time={checkIn?.checkedInAt} />
            {booking.status === "cancelled" && <TimelineStep label="Cancelled" achieved time={checkIn?.cancelledAt} />}
          </div>

          <div>
            {row("Ref", booking.ref)}
            {row("Centre", booking.centreName)}
            {row("Room", booking.roomName ?? "—")}
            {row("Date / time", `${booking.date} · ${booking.time}`)}
            {row("Duration", `${booking.duration}h`)}
            {row("Event type", booking.eventType || "—")}
            {row("Guests", booking.guests)}
            {row("Notes", booking.notes || "—")}
            {row("Total", `€${(booking.totalCents / 100).toFixed(2)}`)}
            {row("Payment", booking.paymentStatus)}
            {row(
              "Status",
              booking.status === "cancelled" ? (
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" }}>Cancelled</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>Confirmed</span>
              )
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            {booking.status !== "cancelled" && (
              <Button variant="ghost" onClick={handleResend} disabled={resent}>
                {resent ? "Confirmation resent" : "Resend confirmation"}
              </Button>
            )}
            {booking.paymentStatus === "paid" && booking.hasStripePayment && (
              <Button variant="ghost" onClick={() => setRefundConfirming(true)}>
                Issue refund
              </Button>
            )}
            {booking.status !== "cancelled" && (
              <button
                onClick={() => setConfirming(true)}
                style={{ background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0 }}
              >
                Cancel booking
              </button>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Cancel this booking?"
        message="The guest will be notified. This only flips the booking's status — issue a refund separately if one's owed."
        confirmLabel={busy ? "Cancelling…" : "Cancel booking"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirming(false)}
      >
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </ConfirmDialog>
      <ConfirmDialog
        open={refundConfirming}
        title="Issue a refund?"
        message={`This refunds ${booking ? `€${(booking.totalCents / 100).toFixed(2)}` : "the full amount"} to the guest via Stripe — this can't be undone.`}
        confirmLabel={refundBusy ? "Refunding…" : "Issue refund"}
        busy={refundBusy}
        onConfirm={handleRefund}
        onCancel={() => setRefundConfirming(false)}
      >
        {refundError && <p style={{ color: colors.danger, fontSize: 13 }}>{refundError}</p>}
      </ConfirmDialog>
    </Drawer>
  );
}

// `centreId`/`clubId` (Host Manage spec §8) narrow this to one listing's own
// Bookings sub-tab, reusing every bit of dashboard-wide behaviour (filters,
// bulk actions, drawer, timeline, resend, registration cancel) instead of a
// second copy — a centre has no registrations and a club has no hall
// bookings, so whichever table doesn't apply to the given scope is hidden.
export function BookingsTab({ centreId, clubId }: { centreId?: string; clubId?: string } = {}) {
  const [bookings, setBookings] = useState<VendorBookingRow[]>([]);
  const [registrations, setRegistrations] = useState<(MyRegistration & { email: string; phone: string })[]>([]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [openRef, setOpenRef] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [whenFilter, setWhenFilter] = useState<WhenFilter>("upcoming");
  const [search, setSearch] = useState("");

  const [checkedInRefs, setCheckedInRefs] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    if (showBookings) fetchVendorBookings(centreId).then(setBookings);
    if (showRegistrations) fetchVendorRegistrations(clubId).then(setRegistrations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId, clubId]);

  const today = new Date().toISOString().slice(0, 10);

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

  const bookingRow = (b: VendorBookingRow) => (
    <div
      onClick={() => setOpenRef(b.ref)}
      style={{ display: "flex", justifyContent: "space-between", background: colors.bg, borderRadius: radius.control, padding: "10px 14px", fontSize: 13.5, cursor: "pointer", opacity: b.status === "cancelled" ? 0.55 : 1 }}
    >
      <span>{b.time} · {b.roomName ?? b.centreName} · {b.name}</span>
      <span style={{ color: colors.mutedLight }}>{b.status === "cancelled" ? "Cancelled" : "Confirmed"}</span>
    </div>
  );

  // Vendor Experience Polish — mobile card fallback for the bookings table
  // below (`.hide-mobile`/`.mobile-cards`, see index.css). Tapping a card
  // opens the same detail Drawer the desktop row does — that's the "primary
  // contextual action" plus every secondary action (resend/refund/cancel/
  // check-in) in one place, so this doesn't need its own "•••" menu.
  // Bulk multi-select isn't carried into the card view (harder to hit
  // targets reliably on a phone, and every action is one tap away in the
  // drawer regardless) — desktop/tablet keep it via the table.
  const bookingCard = (b: VendorBookingRow) => (
    <Card key={b.ref} onClick={() => setOpenRef(b.ref)} style={{ cursor: "pointer", opacity: b.status === "cancelled" ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name={b.name} size={28} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{b.name}</div>
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
  // table below. Registrations have no detail Drawer (unlike bookings), so
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
              <CheckInButton kind="registration" reference={r.ref} checkedIn={checkedInRefs.has(`registration:${r.ref}`)} onChecked={(ref) => markCheckedIn("registration", ref)} />
              <ResendConfirmationButton onResend={() => resendRegistrationConfirmation(r.ref).then(() => {})} />
              {r.paymentStatus === "paid" && r.hasStripePayment && (
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

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <BookingsFilterBar status={statusFilter} onStatus={setStatusFilter} when={whenFilter} onWhen={setWhenFilter} search={search} onSearch={setSearch} />
      {bulkError && <p style={{ color: colors.danger, fontSize: 13 }}>{bulkError}</p>}

      {showBookings && (
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: 0 }}>Hall bookings</h4>
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
        {filteredBookings.length === 0 ? (
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
                          {b.name}
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
                            <CheckInButton kind="booking" reference={b.ref} checkedIn={checkedInRefs.has(`booking:${b.ref}`)} onChecked={(ref) => markCheckedIn("booking", ref)} />
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
      {showBookings && <BookingDetailDrawer booking={openBooking} onClose={() => setOpenRef(null)} onCancelled={handleCancelled} onRefunded={handleRefunded} />}
      {showRegistrations && (
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h4>
        {filteredRegistrations.length === 0 ? (
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
                            <CheckInButton kind="registration" reference={r.ref} checkedIn={checkedInRefs.has(`registration:${r.ref}`)} onChecked={(ref) => markCheckedIn("registration", ref)} />
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
                            {r.paymentStatus === "paid" && r.hasStripePayment && (
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
        message="Every guest will be notified. This only flips status — issue a refund separately if one's owed."
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
