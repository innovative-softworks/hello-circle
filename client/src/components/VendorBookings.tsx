import { useEffect, useState } from "react";
import { checkInBooking, fetchVendorBookings, fetchVendorDemand, fetchVendorRegistrations } from "../api";
import { AwardIcon, CalendarIcon } from "./icons";
import { Avatar, Card, EmptyState, tableStyle, tdStyle, thStyle } from "./ui";
import { DemandSignalsView } from "./DemandSignals";
import { colors, fonts, radius } from "../theme";
import type { DemandRow, MyBooking, MyRegistration } from "../types";

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
    return <span style={{ fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "3px 10px", flex: "none" }}>✓ Checked in</span>;
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

export function BookingsTab() {
  const [bookings, setBookings] = useState<(MyBooking & { name: string; email: string; phone: string })[]>([]);
  const [registrations, setRegistrations] = useState<(MyRegistration & { email: string; phone: string })[]>([]);

  useEffect(() => {
    fetchVendorBookings().then(setBookings);
    fetchVendorRegistrations().then(setRegistrations);
  }, []);

  return (
    <div className="fade-panel" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Hall bookings</h4>
        {bookings.length === 0 ? (
          <EmptyState icon={<CalendarIcon size={26} />} title="No bookings yet" />
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
                  <tr key={b.ref} style={{ opacity: b.status === "cancelled" ? 0.55 : 1 }}>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={b.name} size={24} />
                        {b.name}
                      </div>
                    </td>
                    <td style={tdStyle}>{b.centreName}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{b.date} {b.time}</td>
                    <td style={{ ...tdStyle, color: colors.mutedLight }}>{b.email}, {b.phone}</td>
                    <td style={tdStyle}>
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
      <Card>
        <h4 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, margin: "0 0 14px" }}>Club registrations</h4>
        {registrations.length === 0 ? (
          <EmptyState icon={<AwardIcon size={26} />} title="No registrations yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Child</th>
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
