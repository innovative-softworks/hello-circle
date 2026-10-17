import { UsersRound } from "lucide-react";
import { fetchVendorCustomer, fetchVendorCustomers, type VendorCustomer } from "../api";
import { dateLabel } from "../euro";
import { useRecordParam, useUrlParam } from "../useUrlTab";
import { RecordState, RecordView } from "./workspace/RecordView";
import { AdminButton, Box, EmptyMessage, Facts, Loaded, SearchField, SectionLabel, StatusTag, Toolbar, formatDate, matches, useAdminData } from "./admin/adminUi";

// OG-20 — the people who book with this organisation: one row per email
// across hall bookings, club registrations, programme enrolments and
// experience bookings. A customer's page shows only their orders here.

const TYPE: Record<string, string> = { booking: "Hall booking", registration: "Club registration", program: "Programme", experience: "Experience" };
const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export function VendorCustomersTab({ onOpenBooking }: { onOpenBooking: (ref: string) => void }) {
  const [record, openRecord, closeRecord] = useRecordParam();
  const [q, setQ] = useUrlParam<string>("cq", "");
  const state = useAdminData(() => fetchVendorCustomers());
  if (record?.startsWith("customer:")) return <CustomerRecord email={record.slice(9)} onBack={closeRecord} onOpenBooking={onOpenBooking} />;
  return (
    <Box flush icon={UsersRound} title="Customers" subtitle="Everyone who has booked, registered or enrolled with you.">
      <Toolbar label="Find a customer">
        <SearchField label="Search customers" value={q} onChange={setQ} placeholder="Name or email" />
      </Toolbar>
      <Loaded state={state} title="Couldn't load your customers">
        {(all) => {
          const rows = all.filter((c: VendorCustomer) => matches(q, c.name, c.email));
          if (!rows.length) return <EmptyMessage title={all.length ? "No customers match" : "No customers yet"} detail={all.length ? "Try a different name or email." : "People appear here after their first booking."} />;
          return (
            <div className="adm-table-wrap">
              <table className="adm-table adm-table--stack">
                <caption className="adm-visually-hidden">Customers</caption>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col" className="adm-num">
                      Orders
                    </th>
                    <th scope="col" className="adm-num">
                      Upcoming
                    </th>
                    <th scope="col" className="adm-num">
                      Paid
                    </th>
                    <th scope="col">Last activity</th>
                    <th scope="col">
                      <span className="adm-visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.email}>
                      <td data-label="Customer">
                        <strong>{c.name || c.email}</strong>
                        <div className="adm-note">{c.email}</div>
                      </td>
                      <td data-label="Orders" className="adm-num">
                        {c.orders}
                        {c.cancelled > 0 && <div className="adm-note">{c.cancelled} cancelled</div>}
                      </td>
                      <td data-label="Upcoming" className="adm-num">
                        {c.upcoming}
                      </td>
                      <td data-label="Paid" className="adm-num">
                        {euro(c.spentCents)}
                      </td>
                      <td data-label="Last activity">{formatDate(c.lastActivity)}</td>
                      <td data-label="">
                        <AdminButton size="sm" onClick={() => openRecord(`customer:${c.email}`)} aria-label={`Open ${c.name || c.email}`}>
                          Open
                        </AdminButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loaded>
    </Box>
  );
}

function CustomerRecord({ email, onBack, onOpenBooking }: { email: string; onBack: () => void; onOpenBooking: (ref: string) => void }) {
  const state = useAdminData(() => fetchVendorCustomer(email), [email]);
  if (state.error) return <RecordState state={(state.error as { status?: number }).status === 404 ? "missing" : "error"} backLabel="Customers" onBack={onBack} onRetry={state.reload} />;
  if (!state.data) return <RecordState state="loading" backLabel="Customers" onBack={onBack} />;
  const c = state.data;
  return (
    <RecordView
      title={c.name || c.email}
      reference={c.email}
      backLabel="Customers"
      onBack={onBack}
      actions={
        <a className="adm-btn" href={`mailto:${c.email}`}>
          Email
        </a>
      }
    >
      <div className="adm-record-grid">
        <div>
          <SectionLabel>Orders with you ({c.orders.length})</SectionLabel>
          <div className="adm-table-wrap">
            <table className="adm-table adm-table--stack">
              <caption className="adm-visually-hidden">Orders</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attendance</th>
                  <th scope="col" className="adm-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={`${o.type}:${o.ref}`}>
                    <td data-label="What">
                      {o.type === "booking" ? (
                        <button type="button" className="adm-linkish" onClick={() => onOpenBooking(o.ref)}>
                          {o.listingName}
                        </button>
                      ) : (
                        o.listingName
                      )}
                      <div className="adm-note">
                        {TYPE[o.type] ?? o.type} · <span className="adm-mono">{o.ref}</span>
                      </div>
                    </td>
                    <td data-label="When">{o.date ? `${dateLabel(o.date)}${o.time ? ` · ${o.time}` : ""}` : formatDate(o.createdAt)}</td>
                    <td data-label="Status">
                      <StatusTag status={o.status === "cancelled" ? "cancelled" : o.paymentStatus === "refunded" ? "rejected" : "active"} label={o.status === "cancelled" ? "Cancelled" : o.paymentStatus === "refunded" ? "Refunded" : "Confirmed"} />
                    </td>
                    <td data-label="Attendance">{o.attendance === "present" || o.attendance === "late" ? "Came" : o.attendance === "no_show" ? "No-show" : "—"}</td>
                    <td data-label="Total" className="adm-num">
                      {o.totalCents ? euro(o.totalCents) : "Free"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <SectionLabel>Contact</SectionLabel>
          <Facts rows={[["Email", c.email], ["Phone", c.phone ?? "—"]]} />
          <SectionLabel>Attendance</SectionLabel>
          <Facts rows={[["Checked in", String(c.attended)], ["No-shows", String(c.noShows)]]} />
          <p className="adm-note">Only their orders with your organisation are shown.</p>
        </div>
      </div>
    </RecordView>
  );
}
