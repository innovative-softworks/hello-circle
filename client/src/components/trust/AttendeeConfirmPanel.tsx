import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { UserCheck } from "lucide-react";
import { confirmAttendee, fetchAttendeesToConfirm, withdrawAttendeeConfirmation, type AttendeeToConfirm } from "../../api";
import { ConfirmDialog } from "../ui";
import { AdminButton, Box, ErrorMessage, ViewTabs } from "../admin/adminUi";
import "./trust.css";

// Trust & Retention — "Confirm who attended" (partner workspace, Bookings).
// Lists the last 60 days of past places and lets the organiser confirm that
// the *account holder* was there — the only person HelloCircle can identify.
// One row at a time (no bulk "everyone came"); a group booking's guests are
// never marked; a door check-in is shown but isn't a confirmation. A mistake
// is withdrawn with a reason (audited; any review is flagged for moderation,
// not hidden). Server rules: routes/attendanceCorrections.ts.

const KIND: Record<AttendeeToConfirm["kind"], string> = { booking: "Hall booking", registration: "Club registration", experience: "Experience", program_session: "Programme session" };
const DATE = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
const day = (iso: string) => DATE.format(new Date(`${iso}T12:00:00Z`));

function door(s: string | null) {
  if (s === "present" || s === "late") return "Booking checked in at the door";
  if (s === "no_show" || s === "absent") return "Recorded as missed";
  return "No door check-in";
}

export function AttendeeConfirmPanel() {
  const [rows, setRows] = useState<AttendeeToConfirm[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<"todo" | "all">("todo");
  const [confirming, setConfirming] = useState<AttendeeToConfirm | null>(null);
  const [withdrawing, setWithdrawing] = useState<AttendeeToConfirm | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [params] = useSearchParams();
  const load = () => {
    setError(null);
    fetchAttendeesToConfirm()
      .then(setRows)
      .catch(setError);
  };
  useEffect(load, []);
  const shown = useMemo(() => (rows ?? []).filter((r) => view === "all" || !r.confirmationId), [rows, view]);
  if (params.get("record")) return null;
  if (error && !rows) return <ErrorMessage error={error} onRetry={load} title="Couldn't load past attendees" />;
  if (!rows || rows.length === 0) return null;

  return (
    <Box
      title="Confirm who attended"
      icon={UserCheck}
      subtitle="Confirm the person who made each booking was there. Only people you confirm can leave a review — guests on a group booking aren't marked, and a door check-in doesn't say who came."
    >
      <ViewTabs
        label="Show"
        value={view}
        onChange={setView}
        views={[
          { key: "todo", label: "Not confirmed", count: rows.filter((r) => !r.confirmationId).length },
          { key: "all", label: "Last 60 days", count: rows.length },
        ]}
      />
      <div aria-live="polite">{done && <p className="tr-ok" style={{ margin: "4px 0 8px" }}>{done}</p>}</div>
      {shown.length === 0 ? (
        <p className="tr-note">Everyone from the last 60 days is confirmed or has no booking to confirm.</p>
      ) : (
        <ul className="tr-rows tr-org-rows">
          {shown.map((r) => (
            <li key={`${r.kind}:${r.ref}`} className="tr-org-row">
              <div style={{ minWidth: 0 }}>
                <div>
                  <strong>{r.holderName || "Name not given"}</strong>
                  {r.partySize > 1 && <span className="tr-review-meta"> · booked for {r.partySize} people — confirms this person only</span>}
                </div>
                <div className="tr-review-meta">
                  {r.label} · {day(r.date)} · {KIND[r.kind]}
                </div>
                <div className="tr-org-tags">
                  <span>{door(r.doorStatus)}</span>
                  {r.requestOpen && <span className="is-ask">Asked you to confirm</span>}
                  {r.confirmationId && <span className="is-ok">Confirmed{r.confirmedBy === "participant" ? " after their request" : ""}</span>}
                  {r.reviewSubmitted && <span className="is-ok">Review submitted</span>}
                </div>
              </div>
              {r.confirmationId ? (
                <AdminButton size="sm" onClick={() => setWithdrawing(r)} aria-label={`Withdraw confirmation for ${r.holderName ?? "this booking"} on ${r.date}`}>
                  Withdraw
                </AdminButton>
              ) : (
                <AdminButton size="sm" variant="primary" onClick={() => setConfirming(r)} aria-label={`Confirm ${r.holderName ?? "the account holder"} attended on ${r.date}`}>
                  Confirm attended
                </AdminButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!confirming}
        title={`Confirm ${confirming?.holderName ?? "the account holder"} attended?`}
        message={
          confirming
            ? `${confirming.label}, ${day(confirming.date)}. Only confirm if you know the person who made this booking was there themselves${confirming.partySize > 1 ? ` — this doesn't mark the other ${confirming.partySize - 1} people on the booking` : ""}. They can then review it.`
            : ""
        }
        confirmLabel="Confirm attended"
        tone="neutral"
        onConfirm={async () => {
          if (!confirming) return;
          await confirmAttendee(confirming.kind, confirming.ref);
          setDone(`${confirming.holderName ?? "The account holder"} is confirmed.`);
          setConfirming(null);
          load();
        }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={!!withdrawing}
        title="Withdraw this confirmation?"
        message="Use this to fix a mistake. They're told your reason. If they've already reviewed, the review stays up but loses its “Verified attendance” label, and HelloCircle checks it."
        confirmLabel="Withdraw"
        tone="danger"
        confirmDisabled={note.trim().length < 10}
        onConfirm={async () => {
          if (!withdrawing?.confirmationId) return;
          await withdrawAttendeeConfirmation(withdrawing.confirmationId, note.trim());
          setDone("Confirmation withdrawn.");
          setWithdrawing(null);
          setNote("");
          load();
        }}
        onCancel={() => {
          setWithdrawing(null);
          setNote("");
        }}
      >
        <label style={{ display: "block" }}>
          <span className="tr-label">Reason (they see this; at least 10 characters)</span>
          <textarea className="tr-input" rows={3} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ConfirmDialog>
    </Box>
  );
}
