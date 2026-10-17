import { useNavigate } from "react-router-dom";
import { fetchVendorOrders, type VendorOrder } from "../api";
import { dateLabel } from "../euro";
import { useUrlParam } from "../useUrlTab";
import { AdminButton, Box, EmptyMessage, Loaded, SearchField, SelectField, StatusTag, Toolbar, useAdminData } from "./admin/adminUi";

// OG-13 / DEC-04 — every order across the organisation's listings in one
// read-only list: hall bookings, club registrations, programme enrolments and
// experience bookings (the four order tables stay separate; the server reads
// them together). Each row opens the place that already manages that order.

const TYPE_LABEL: Record<VendorOrder["type"], string> = { booking: "Hall booking", registration: "Club registration", program: "Programme", experience: "Experience" };
const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export function VendorAllOrders({ onOpenBooking, onOpenRegistration }: { onOpenBooking: (ref: string) => void; onOpenRegistration: (ref: string) => void }) {
  const navigate = useNavigate();
  const state = useAdminData(() => fetchVendorOrders(false));
  const [type, setType] = useUrlParam<string>("otype", "all");
  const [status, setStatus] = useUrlParam<string>("ostatus", "all");
  const [payment, setPayment] = useUrlParam<string>("opay", "all");
  const [listing, setListing] = useUrlParam<string>("olisting", "all");
  const [from, setFrom] = useUrlParam<string>("ofrom", "");
  const [to, setTo] = useUrlParam<string>("oto", "");
  const [q, setQ] = useUrlParam<string>("oq", "");

  const open = (o: VendorOrder) => {
    if (o.type === "booking") onOpenBooking(o.ref);
    else if (o.type === "registration") onOpenRegistration(o.ref);
    else if (o.type === "program" && o.listingId) navigate(`/vendor/programs/${o.listingId}`);
    else if (o.type === "experience" && o.listingId) navigate(`/vendor/experiences/${o.listingId}`);
  };

  return (
    <Box flush title="All orders" subtitle="Every booking, registration and enrolment across your listings. Open one to manage it.">
      <Loaded state={state} title="Couldn't load your orders">
        {(orders) => {
          const listings = Array.from(new Set(orders.map((o) => o.listingName))).sort();
          const needle = q.trim().toLowerCase();
          const rows = orders.filter((o) => {
            const day = o.date ?? o.createdAt.slice(0, 10);
            return (
              (type === "all" || o.type === type) &&
              (status === "all" || (status === "cancelled" ? o.status === "cancelled" : o.status !== "cancelled")) &&
              (payment === "all" || (payment === "attention" ? o.attention.length > 0 : o.paymentStatus === payment)) &&
              (listing === "all" || o.listingName === listing) &&
              (!from || day >= from) &&
              (!to || day <= to) &&
              (!needle || o.customerName.toLowerCase().includes(needle) || o.email.toLowerCase().includes(needle) || o.ref.toLowerCase().includes(needle))
            );
          });
          return (
            <>
              <Toolbar label="Filter orders">
                <SearchField label="Search orders" value={q} onChange={setQ} placeholder="Customer, email or reference" />
                <SelectField label="Type" value={type} onChange={setType} options={[{ value: "all", label: "All types" }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
                <SelectField label="Listing" value={listing} onChange={setListing} options={[{ value: "all", label: "All listings" }, ...listings.map((l) => ({ value: l, label: l }))]} />
                <SelectField label="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "Any" }, { value: "active", label: "Confirmed" }, { value: "cancelled", label: "Cancelled" }]} />
                <SelectField
                  label="Payment"
                  value={payment}
                  onChange={setPayment}
                  options={[
                    { value: "all", label: "Any" },
                    { value: "paid", label: "Paid" },
                    { value: "refunded", label: "Refunded" },
                    { value: "attention", label: "Needs action" },
                  ]}
                />
                <div className="adm-field">
                  <label htmlFor="orders-from-date">From</label>
                  <input id="orders-from-date" type="date" className="adm-input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="adm-field">
                  <label htmlFor="orders-to-date">To</label>
                  <input id="orders-to-date" type="date" className="adm-input" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </Toolbar>
              {rows.length === 0 ? (
                <EmptyMessage title={orders.length ? "No orders match" : "No orders yet"} detail={orders.length ? "Try a different filter." : undefined} />
              ) : (
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table--stack">
                    <caption className="adm-visually-hidden">All orders</caption>
                    <thead>
                      <tr>
                        <th scope="col">Customer</th>
                        <th scope="col">Type</th>
                        <th scope="col">For</th>
                        <th scope="col">When</th>
                        <th scope="col" className="adm-num">
                          Total
                        </th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="adm-visually-hidden">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={`${o.type}:${o.ref}`}>
                          <td data-label="Customer">
                            <strong>{o.customerName}</strong>
                            <div className="adm-note">
                              {o.email} · <span className="adm-mono">{o.ref}</span>
                            </div>
                          </td>
                          <td data-label="Type">{TYPE_LABEL[o.type]}</td>
                          <td data-label="For">{o.listingName}</td>
                          <td data-label="When">{o.date ? `${dateLabel(o.date)}${o.time ? ` · ${o.time}` : ""}` : "—"}</td>
                          <td data-label="Total" className="adm-num">
                            {o.totalCents ? euro(o.totalCents) : "Free"}
                            {o.refundedCents > 0 && <div className="adm-note">{euro(o.refundedCents)} refunded</div>}
                          </td>
                          <td data-label="Status">
                            {o.attention.includes("refund_pending") ? (
                              <StatusTag status="pending" label="Refund due" />
                            ) : o.status === "cancelled" ? (
                              <StatusTag status="cancelled" label="Cancelled" />
                            ) : (
                              <StatusTag status={o.paymentStatus === "refunded" ? "rejected" : "active"} label={o.paymentStatus === "refunded" ? "Refunded" : "Confirmed"} />
                            )}
                          </td>
                          <td data-label="">
                            <AdminButton size="sm" onClick={() => open(o)} aria-label={`Open ${o.customerName}'s ${TYPE_LABEL[o.type].toLowerCase()}`}>
                              Open
                            </AdminButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </Box>
  );
}
