import { useId, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { fetchActivityOverview, supportSearch } from "../../api";
import { AdminButton, Box, EmptyMessage, ErrorMessage, LoadingRows, StatusTag, useAdminData } from "./adminUi";

// Support lookup (admin redesign 2026-10-14). Same two endpoints as before:
// /support/search (≤20 per type; blank query = most recent) and
// /activity-overview (latest 50 Open Bookings and circles).

function ResultTable<T>({ title, rows, columns, rowKey, empty = "No matches." }: { title: string; rows: T[]; columns: { label: string; render: (r: T) => ReactNode; mono?: boolean }[]; rowKey: (r: T) => string | number; empty?: string }) {
  return (
    <Box title={title} subtitle={`${rows.length} shown`} headingLevel={3} flush>
      {rows.length === 0 ? (
        <p className="adm-note" style={{ padding: "14px 18px" }}>{empty}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table adm-table--stack">
            <caption className="adm-visually-hidden">{title}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th scope="col" key={c.label}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)}>
                  {columns.map((c) => (
                    <td key={c.label} data-label={c.label} className={c.mono ? "adm-mono" : undefined}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Box>
  );
}

function Payment({ status, payment }: { status: string; payment: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <StatusTag status={status} label={status === "approved" ? "Confirmed" : undefined} />
      <StatusTag status={payment === "paid" ? "active" : payment === "failed" ? "rejected" : "pending"} label={`Payment: ${payment}`} />
    </span>
  );
}

export function AdminSupportPage() {
  const inputId = useId();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const results = useAdminData(() => supportSearch(query), [query]);
  const overview = useAdminData(fetchActivityOverview);

  return (
    <div className="adm-stack">
      <Box flush>
        <form
          className="adm-toolbar"
          role="search"
          aria-label="Support lookup"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <div className="adm-field adm-search" style={{ flex: "1 1 320px" }}>
            <label htmlFor={inputId}>Booking, registration, session or circle reference, name, or email</label>
            <div style={{ position: "relative" }}>
              <Search size={18} strokeWidth={1.9} aria-hidden="true" />
              <input id={inputId} type="search" className="adm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. HC-7Q2K or name@example.com" />
            </div>
          </div>
          <AdminButton type="submit" variant="primary">
            Search
          </AdminButton>
          {query && (
            <AdminButton
              onClick={() => {
                setQ("");
                setQuery("");
              }}
            >
              Show recent
            </AdminButton>
          )}
        </form>
        <p className="adm-note" style={{ padding: "10px 14px" }} aria-live="polite">
          {query ? `Results for “${query}” — up to 20 per type.` : "Showing the most recent records of each type. Accounts appear only when you search."}
        </p>
      </Box>

      {results.error ? (
        <Box>
          <ErrorMessage error={results.error} onRetry={results.reload} />
        </Box>
      ) : results.data === null ? (
        <Box>
          <LoadingRows rows={4} label="Searching" />
        </Box>
      ) : (
        <>
          <ResultTable
            title="Bookings"
            rows={results.data.bookings}
            rowKey={(b) => b.ref}
            columns={[
              { label: "Reference", render: (b) => b.ref, mono: true },
              { label: "Guest", render: (b) => <>{b.name}<div className="adm-cell-sub">{b.email}</div></> },
              { label: "Date", render: (b) => `${b.date} ${b.time}` },
              { label: "Status", render: (b) => <Payment status={b.status} payment={b.paymentStatus} /> },
            ]}
          />
          <ResultTable
            title="Registrations"
            rows={results.data.registrations}
            rowKey={(r) => r.ref}
            columns={[
              { label: "Reference", render: (r) => r.ref, mono: true },
              { label: "Guardian", render: (r) => <>{r.gFirst} {r.gLast}<div className="adm-cell-sub">{r.email}</div></> },
              { label: "Status", render: (r) => <Payment status={r.status} payment={r.paymentStatus} /> },
            ]}
          />
          {query && (
            <ResultTable
              title="Accounts"
              rows={results.data.users}
              rowKey={(u) => u.id}
              columns={[
                { label: "Name", render: (u) => u.name || "—" },
                { label: "Email", render: (u) => u.email },
                { label: "Role", render: (u) => u.role },
                { label: "Status", render: (u) => <StatusTag status={u.status} label={u.status === "approved" ? "Approved" : undefined} /> },
              ]}
            />
          )}
          <ResultTable
            title="Sessions"
            rows={results.data.games}
            rowKey={(g) => g.id}
            columns={[
              { label: "Activity", render: (g) => g.activityLabel },
              { label: "Date", render: (g) => `${g.date} ${g.time}` },
              { label: "Status", render: (g) => <StatusTag status={g.status} /> },
              { label: "Open Booking", render: (g) => g.bookingRef ?? "—", mono: true },
            ]}
          />
          <ResultTable
            title="Circles"
            rows={results.data.circles}
            rowKey={(c) => c.id}
            columns={[
              { label: "Name", render: (c) => c.name },
              { label: "Activity", render: (c) => c.activityLabel },
              { label: "Status", render: (c) => <StatusTag status={c.status} /> },
            ]}
          />
        </>
      )}

      <h2 className="adm-box-title" style={{ marginTop: 8 }}>Recent platform activity</h2>
      {overview.error ? (
        <Box>
          <ErrorMessage error={overview.error} onRetry={overview.reload} />
        </Box>
      ) : overview.data === null ? (
        <Box>
          <LoadingRows rows={3} />
        </Box>
      ) : overview.data.openBookings.length === 0 && overview.data.circleActivity.length === 0 ? (
        <Box>
          <EmptyMessage title="No Open Bookings or circles yet" />
        </Box>
      ) : (
        <>
          <ResultTable
            title="Open Bookings (latest 50)"
            rows={overview.data.openBookings}
            rowKey={(o) => o.id}
            empty="None yet."
            columns={[
              { label: "Session", render: (o) => <>{o.activityLabel}<div className="adm-cell-sub">{o.date} {o.time}</div></> },
              { label: "Booking", render: (o) => <><span className="adm-mono">{o.bookingRefFull}</span><div className="adm-cell-sub">{o.bookingName}</div></> },
              { label: "Centre", render: (o) => o.centreName ?? "—" },
              { label: "Status", render: (o) => <StatusTag status={o.status} /> },
            ]}
          />
          <ResultTable
            title="Circles (latest 50)"
            rows={overview.data.circleActivity}
            rowKey={(c) => c.id}
            empty="None yet."
            columns={[
              { label: "Name", render: (c) => c.name },
              { label: "Activity", render: (c) => c.activityLabel },
              { label: "Members", render: (c) => c.memberCount },
              { label: "Status", render: (c) => <StatusTag status={c.status} /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
