import { useState } from "react";
import { useEffect } from "react";
import {
  downloadParticipationReport,
  fetchParticipationDetail,
  fetchParticipationReport,
  fetchVendorExperienceSessions,
  fetchVendorExperiences,
  fetchVendorListings,
  fetchVendorPrograms,
  type ParticipationDetail,
  type ParticipationReport,
} from "../api";
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

type ListingPick = { type: "experience" | "centre" | "club" | "program"; id: string; name: string };
const TYPE_NAME: Record<ListingPick["type"], string> = { experience: "Events and experiences", centre: "Halls", club: "Clubs", program: "Programmes" };

/** Weekly registrations as simple bars — a trend is the one place a chart earns its space here. */
function WeeklyBars({ weeks }: { weeks: ParticipationDetail["overTime"] }) {
  if (weeks.length === 0) return <p className="adm-note">Nothing in this period.</p>;
  const max = Math.max(...weeks.map((w) => w.total), 1);
  const bw = 28;
  const h = 120;
  return (
    <figure style={{ margin: 0, overflowX: "auto" }}>
      <svg role="img" aria-label={`Registrations per week: ${weeks.map((w) => `week of ${w.week}, ${w.total}`).join("; ")}`} width={Math.max(weeks.length * (bw + 8), 200)} height={h + 34}>
        {weeks.map((w, i) => {
          const bh = Math.round((w.total / max) * h);
          return (
            <g key={w.week} transform={`translate(${i * (bw + 8)},0)`}>
              <rect x={0} y={h - bh} width={bw} height={bh} fill="var(--adm-accent, #172019)" />
              <text x={bw / 2} y={h - bh - 4} textAnchor="middle" fontSize={11} fill="currentColor">{w.total}</text>
              <text x={bw / 2} y={h + 14} textAnchor="middle" fontSize={10} fill="currentColor">{w.week.slice(5)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="adm-note">Registrations per week (week starting).</figcaption>
    </figure>
  );
}

// Filters wrap on phones: a long listing name must not widen the page (375px reflow).
const FIELD = { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, minWidth: 0, maxWidth: "100%" } as const;
const FIT = { maxWidth: "100%", minWidth: 0 } as const;

function Filters({ value, onChange }: { value: { type: string; listing: string; session: string }; onChange: (v: { type: string; listing: string; session: string }) => void }) {
  const [listings, setListings] = useState<ListingPick[]>([]);
  const [sessions, setSessions] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    Promise.all([fetchVendorListings().catch(() => ({ centres: [], clubs: [] })), fetchVendorPrograms().catch(() => []), fetchVendorExperiences().catch(() => [])]).then(([l, p, e]) =>
      setListings([
        ...e.map((x) => ({ type: "experience" as const, id: x.id, name: x.title })),
        ...l.centres.map((x) => ({ type: "centre" as const, id: x.id, name: x.name })),
        ...l.clubs.map((x) => ({ type: "club" as const, id: x.id, name: x.name })),
        ...p.map((x) => ({ type: "program" as const, id: x.id, name: x.title })),
      ])
    );
  }, []);
  useEffect(() => {
    setSessions([]);
    const pick = listings.find((l) => l.id === value.listing);
    if (pick?.type === "experience") fetchVendorExperienceSessions(pick.id).then((rows) => setSessions(rows.map((r) => ({ id: r.id, label: `${r.date} · ${r.time}` })))).catch(() => undefined);
  }, [value.listing, listings]);
  const shown = listings.filter((l) => !value.type || l.type === value.type);
  return (
    <>
      <label style={FIELD}>
        Type
        <select className="adm-select" style={FIT} value={value.type} onChange={(e) => onChange({ type: e.target.value, listing: "", session: "" })}>
          <option value="">All types</option>
          {(Object.keys(TYPE_NAME) as ListingPick["type"][]).map((t) => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}
        </select>
      </label>
      <label style={FIELD}>
        Listing
        <select className="adm-select" style={FIT} value={value.listing} onChange={(e) => {
          const pick = listings.find((l) => l.id === e.target.value);
          onChange({ type: pick ? pick.type : value.type, listing: e.target.value, session: "" });
        }}>
          <option value="">All listings</option>
          {shown.map((l) => <option key={`${l.type}:${l.id}`} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {sessions.length > 0 && (
        <label style={FIELD}>
          Date
          <select className="adm-select" style={FIT} value={value.session} onChange={(e) => onChange({ ...value, session: e.target.value })}>
            <option value="">All dates</option>
            {sessions.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      )}
    </>
  );
}

export function VendorReportsTab() {
  const today = irelandToday();
  const [from, setFrom] = useState(addDays(today, -90));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const report = useAdminData<ParticipationReport>(() => fetchParticipationReport(from, to), [from, to]);
  const [sel, setSel] = useState({ type: "", listing: "", session: "" });
  const detail = useAdminData<ParticipationDetail>(() => fetchParticipationDetail(from, to, { listingType: sel.type, listingId: sel.listing, sessionId: sel.session }), [from, to, sel.type, sel.listing, sel.session]);

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
        <label style={FIELD}>
          From
          <input type="date" className="adm-input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label style={FIELD}>
          To
          <input type="date" className="adm-input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <Filters value={sel} onChange={setSel} />
        <AdminButton onClick={download} disabled={busy} aria-busy={busy || undefined}>{busy ? "Preparing…" : "Download CSV"}</AdminButton>
      </Toolbar>
      {downloadError && <p role="alert" className="adm-note" style={{ color: "var(--adm-bad, #b42318)" }}>{downloadError}</p>}
      <p className="adm-note" style={{ margin: 0 }}>Counts only — no names, contact details or answers. Events and hall bookings count by their date; club registrations and programme enrolments by the day they were made.</p>
      {detail.error ? (
        <ErrorMessage error={detail.error} onRetry={detail.reload} title="Couldn't load the listing details" />
      ) : !detail.data ? (
        <LoadingRows rows={4} label="Loading the listing details" />
      ) : (
        <>
          <Box title="Registrations over time">
            <WeeklyBars weeks={detail.data.overTime} />
          </Box>
          <Box title="By listing">
            {detail.data.perListing.length === 0 ? (
              <p className="adm-note">Nothing in this period.</p>
            ) : (
              <Table caption="By listing" head={["Listing", "Orders", "Cancelled", "People", "Checked in", "Attendance"]} rows={detail.data.perListing.map((l) => [`${l.title} · ${l.type}`, l.orders, l.cancelled, l.people, l.attended, pct(l.attended, l.people)])} />
            )}
          </Box>
          <Box title="Check-in activity">
            {detail.data.checkins.length === 0 ? <p className="adm-note">No check-ins in this period.</p> : <Table caption="Check-ins by day" head={["Day", "Check-ins"]} rows={detail.data.checkins.map((c) => [c.day, c.count])} />}
          </Box>
          <Box title="Repeat participation">
            <Table caption="Repeat participation" head={["Measure", "Value"]} rows={[["People with a confirmed booking", detail.data.repeat.people], ["Of them, booked more than once", detail.data.repeat.returning], ["Returning share", pct(detail.data.repeat.returning, detail.data.repeat.people)]]} />
            <p className="adm-note">A person is a signed-in resident, or the same email address for guests.{detail.data.truncated ? " Only the first 20,000 bookings were counted — choose a shorter period." : ""}</p>
          </Box>
        </>
      )}
      {(sel.type || sel.listing) && <p className="adm-note" style={{ margin: 0 }}>The summary below covers all your listings; the sections above follow the type and listing you chose.</p>}
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
