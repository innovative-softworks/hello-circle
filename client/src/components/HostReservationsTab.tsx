import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { fetchHostReservations, type HostReservation } from "../api";
import { dateLabel } from "../euro";
import { irelandToday } from "../irelandDate";
import { useUrlParam } from "../useUrlTab";
import { AdminButton, Box, EmptyMessage, Loaded, SelectField, StatusTag, Toolbar, useAdminData } from "./admin/adminUi";

// OG-16 — the venues a host has booked, with the activity held on each.
// Booking a venue still happens on the venue's public page (search is the
// same for everyone); changing or cancelling a booking happens from My Life,
// or by moving its activity (OG-12).

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function statusOf(r: HostReservation): { status: string; label: string } {
  if (r.status === "cancelled") return { status: "cancelled", label: "Cancelled" };
  if (r.paymentStatus === "pending") return { status: "pending", label: "Payment pending" };
  if (r.paymentStatus === "refunded") return { status: "rejected", label: "Refunded" };
  return { status: "active", label: "Confirmed" };
}

export function HostReservationsTab() {
  const navigate = useNavigate();
  const [when, setWhen] = useUrlParam<string>("when", "upcoming");
  const state = useAdminData(fetchHostReservations);
  const today = irelandToday();
  return (
    <Box
      flush
      icon={Building2}
      title="Venue reservations"
      subtitle="Halls and rooms you've booked, and what's held on them."
      actions={
        <AdminButton variant="primary" onClick={() => navigate("/browse/centres")}>
          Find a venue
        </AdminButton>
      }
    >
      <Toolbar label="Filter reservations">
        <SelectField
          label="Show"
          value={when}
          onChange={setWhen}
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "past", label: "Past" },
            { value: "cancelled", label: "Cancelled" },
            { value: "all", label: "All" },
          ]}
        />
      </Toolbar>
      <Loaded state={state} title="Couldn't load your reservations">
        {(all) => {
          const rows = all.filter((r) =>
            when === "all" ? true : when === "cancelled" ? r.status === "cancelled" : when === "past" ? r.status !== "cancelled" && r.date < today : r.status !== "cancelled" && r.date >= today
          );
          if (rows.length === 0)
            return (
              <EmptyMessage
                title={when === "upcoming" ? "No upcoming venue bookings" : "Nothing here"}
                detail={when === "upcoming" ? "Book a hall or room for an activity, then pick that booking when you create the activity." : undefined}
              />
            );
          return (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Venue reservations</caption>
                <thead>
                  <tr>
                    <th scope="col">Venue</th>
                    <th scope="col">When</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="adm-num">
                      Paid
                    </th>
                    <th scope="col">Held on it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = statusOf(r);
                    return (
                      <tr key={r.ref}>
                        <td data-label="Venue">
                          <strong>{r.centreName}</strong>
                          <div className="adm-note">
                            {r.roomName ?? "Room"} · <span className="adm-mono">{r.ref}</span>
                          </div>
                        </td>
                        <td data-label="When">
                          {dateLabel(r.date)} · {r.time} · {r.duration}h
                        </td>
                        <td data-label="Status">
                          <StatusTag status={st.status} label={st.label} />
                        </td>
                        <td data-label="Paid" className="adm-num">
                          {r.totalCents ? euro(r.totalCents) : "Free"}
                          {r.refundedCents > 0 && <div className="adm-note">{euro(r.refundedCents)} refunded</div>}
                        </td>
                        <td data-label="Held on it">
                          {r.gameId ? (
                            <button type="button" className="adm-linkish" onClick={() => navigate(`/manage?tab=activities&record=activity:${r.gameId}`)}>
                              {r.activityLabel}
                            </button>
                          ) : (
                            <span className="adm-note">No activity yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loaded>
    </Box>
  );
}
