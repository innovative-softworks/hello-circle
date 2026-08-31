import { useEffect, useState, type ReactNode } from "react";
import { cancelVendorBooking, checkInBooking, fetchVendorBookings, fetchVendorDemand, fetchVendorRegistrations } from "../api";
import { AwardIcon, CalendarIcon, CheckIcon } from "./icons";
import { Avatar, ManageCard as Card, ConfirmDialog, Drawer, EmptyState, tableStyle, tdStyle, thStyle } from "./ui";
import { DemandSignalsView } from "./DemandSignals";
import { MonthCalendar } from "./MonthCalendar";
import { colors, fonts, radius } from "../theme";
import type { DemandRow, MyRegistration, VendorBookingRow } from "../types";

// Bookings/registrations visibility (with manual check-in) + demand
// intelligence — split out of the original single VendorDashboard.tsx (see
// CLAUDE.md).

// Manual check-in (Tier 3, FUTURE-scaffolding made usable) — no QR/hardware,
// just a button a vendor taps at the door. Doesn't preload existing status
// (would need a bulk endpoint that doesn't exist yet) — starts unchecked
// each page load and reflects clicks made in this session.
function CheckInButton({ kind, reference }: { kind: "booking" | "registration"; reference: string }) {
  const [checkedIn, setCheckedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkInBooking(kind, reference);
      setCheckedIn(true);
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

function BookingDetailDrawer({ booking, onClose, onCancelled }: { booking: VendorBookingRow | null; onClose: () => void; onCancelled: (ref: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          {booking.status !== "cancelled" && (
            <button
              onClick={() => setConfirming(true)}
              style={{ alignSelf: "flex-start", background: "none", border: "none", color: colors.danger, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: 0 }}
            >
              Cancel booking
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Cancel this booking?"
        message="The guest will be notified. This only flips the booking's status — any refund is handled off-platform."
        confirmLabel={busy ? "Cancelling…" : "Cancel booking"}
        busy={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirming(false)}
      >
        {error && <p style={{ color: colors.danger, fontSize: 13 }}>{error}</p>}
      </ConfirmDialog>
    </Drawer>
  );
}

export function BookingsTab() {
  const [bookings, setBookings] = useState<VendorBookingRow[]>([]);
  const [registrations, setRegistrations] = useState<(MyRegistration & { email: string; phone: string })[]>([]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [openRef, setOpenRef] = useState<string | null>(null);

  useEffect(() => {
    fetchVendorBookings().then(setBookings);
    fetchVendorRegistrations().then(setRegistrations);
  }, []);

  const openBooking = bookings.find((b) => b.ref === openRef) ?? null;

  const handleCancelled = (ref: string) => {
    setBookings((prev) => prev.map((b) => (b.ref === ref ? { ...b, status: "cancelled" } : b)));
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

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
        {bookings.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={26} />} title="No bookings yet" />
        ) : view === "calendar" ? (
          <MonthCalendar items={bookings.map((b) => ({ date: b.date, el: bookingRow(b) }))} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Guest</th>
                  <th style={thStyle}>Centre</th>
                  <th style={thStyle}>Date/Time</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.ref} onClick={() => setOpenRef(b.ref)} style={{ opacity: b.status === "cancelled" ? 0.55 : 1, cursor: "pointer" }}>
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
                      {b.status === "cancelled" ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" }}>Cancelled</span>
                      ) : (
                        <CheckInButton kind="booking" reference={b.ref} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <BookingDetailDrawer booking={openBooking} onClose={() => setOpenRef(null)} onCancelled={handleCancelled} />
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h4>
        {registrations.length === 0 ? (
          <EmptyState icon={<AwardIcon size={26} />} title="No registrations yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Registrant</th>
                  <th style={thStyle}>Club</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((r) => (
                  <tr key={r.ref} style={{ opacity: r.status === "cancelled" ? 0.55 : 1 }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={`${r.childFirst} ${r.childLast}`} size={24} />
                        {r.childFirst} {r.childLast}
                      </div>
                    </td>
                    <td style={tdStyle}>{r.clubName}</td>
                    <td style={{ ...tdStyle, color: colors.mutedLight }}>{r.email}, {r.phone}</td>
                    <td style={tdStyle}>
                      {r.status === "cancelled" ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.danger, background: colors.dangerBg, borderRadius: radius.pill, padding: "2px 8px" }}>Cancelled</span>
                      ) : (
                        <CheckInButton kind="registration" reference={r.ref} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
