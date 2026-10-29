import { useState } from "react";
import { downloadParticipationReport, fetchParticipationReport, type ParticipationReport } from "../api";
import { addDays, irelandToday } from "../irelandDate";
import { AdminButton, Box, ErrorMessage, LoadingRows, Toolbar, useAdminData } from "./admin/adminUi";

// Phase L (docs/participation-expansion/20) — the organisation's participation
// report: registrations by listing type, attendance, capacity, cancellations
// by month and registration-form completion. Counts only (no names, contact
// details or answers), so finance and the read-only analyst can read it too.
// The CSV holds the same numbers; every download is audited by the server.

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table--stack">
        <caption className="adm-visually-hidden">{caption}</caption>
        <thead>
          <tr>{head.map((h, i) => <th key={h} scope="col" className={i > 0 ? "adm-num" : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} data-label={head[j]} className={j > 0 ? "adm-num" : undefined}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VendorReportsTab() {
  const today = irelandToday();
  const [from, setFrom] = useState(addDays(today, -90));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const report = useAdminData<ParticipationReport>(() => fetchParticipationReport(from, to), [from, to]);

  const download = async () => {
    setBusy(true);
    setDownloadError(null);
    try {
      await downloadParticipationReport(from, to);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Couldn't download the report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Toolbar label="Report period">
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          From
          <input type="date" className="adm-input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          To
          <input type="date" className="adm-input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <AdminButton onClick={download} disabled={busy} aria-busy={busy || undefined}>{busy ? "Preparing…" : "Download CSV"}</AdminButton>
      </Toolbar>
      {downloadError && <p role="alert" className="adm-note" style={{ color: "var(--adm-bad, #b42318)" }}>{downloadError}</p>}
      <p className="adm-note" style={{ margin: 0 }}>Counts only — no names, contact details or answers. Events and hall bookings count by their date; club registrations and programme enrolments by the day they were made.</p>
      {report.error ? (
        <ErrorMessage error={report.error} onRetry={report.reload} title="Couldn't load the report" />
      ) : !report.data ? (
        <LoadingRows rows={6} label="Loading the report" />
      ) : (
        <>
          <Box title="Registrations by listing type">
            <Table caption="Registrations by listing type" head={["Type", "Orders", "Confirmed", "Cancelled", "People"]} rows={report.data.byType.map((t) => [t.type, t.orders, t.active, t.cancelled, t.people])} />
          </Box>
          <Box title="Attendance (what has already happened)">
            <Table caption="Attendance" head={["Type", "Expected", "Attended", "Not attended", "Not marked", "Attendance"]} rows={report.data.attendance.map((t) => [t.type, t.expected, t.attended, t.noShow, t.unmarked, pct(t.attended, t.expected)])} />
          </Box>
          <Box title="Capacity">
            <Table caption="Capacity" head={["Places", "Offered", "Taken", "Filled"]} rows={report.data.capacity.map((t) => [t.type, t.offered, t.taken, pct(t.taken, t.offered)])} />
          </Box>
          <Box title="Cancellations by month">
            {report.data.cancellationsByMonth.length === 0 ? (
              <p className="adm-note">Nothing in this period.</p>
            ) : (
              <Table caption="Cancellations by month" head={["Month · type", "Orders", "Cancelled", "Rate"]} rows={report.data.cancellationsByMonth.map((m) => [`${m.month} · ${m.type}`, m.total, m.cancelled, pct(m.cancelled, m.total)])} />
            )}
          </Box>
          <Box title="Registration forms">
            <Table
              caption="Registration form completion"
              head={["Measure", "Value"]}
              rows={[
                ["Listings asking required questions", report.data.forms.listingsWithForm],
                ["Confirmed bookings on those listings", report.data.forms.ordersChecked],
                ["All required answers given", report.data.forms.complete],
                ["Waiting for answers", report.data.forms.incomplete],
              ]}
            />
            {report.data.forms.truncated && <p className="adm-note">Only the first 1,000 bookings in the period were checked — choose a shorter period for an exact count.</p>}
          </Box>
        </>
      )}
    </div>
  );
}
