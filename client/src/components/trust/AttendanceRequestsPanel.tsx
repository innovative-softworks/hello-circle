import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { decideAttendanceCorrection, fetchOwnedAttendanceCorrections, type AttendanceCorrection } from "../../api";
import { ConfirmDialog } from "../ui";
import { AdminButton, Box, ErrorMessage } from "../admin/adminUi";
import "./trust.css";

// Trust & Retention batch 1 — an organiser's queue of attendance correction
// requests (partner workspace Bookings tab, host Hosting page). Accepting
// records the visit as attended, which is what lets the participant review
// it; declining needs a note the participant sees. Hidden when there's
// nothing to decide, so it never adds an empty box to the page.

const KIND: Record<string, string> = { booking: "Booking", registration: "Registration", experience: "Experience booking", program_session: "Programme session", game: "Session place" };
const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

export function AttendanceRequestsPanel({ asHost = false }: { asHost?: boolean }) {
  const [rows, setRows] = useState<AttendanceCorrection[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [deciding, setDeciding] = useState<{ row: AttendanceCorrection; decision: "accept" | "decline" } | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetchOwnedAttendanceCorrections(asHost)
      .then(setRows)
      .catch(setError);
  };
  useEffect(load, [asHost]);
  // A booking opened as a page (?record=…) has the screen to itself.
  const [params] = useSearchParams();
  if (params.get("record")) return null;

  if (error && !rows) return <ErrorMessage error={error} onRetry={load} title="Couldn't load attendance requests" />;
  const open = (rows ?? []).filter((r) => r.status === "open");
  if (!open.length && !done) return null;

  return (
    <Box title="Attendance requests" icon={ClipboardCheck} subtitle="People asking you to confirm they attended. A door check-in shows a booking was used, not who came; reviews open only for people you confirm.">
      <div aria-live="polite">{done && <p className="tr-ok" style={{ marginBottom: 10 }}>{done}</p>}</div>
      {open.length === 0 ? (
        <p className="tr-note">Nothing waiting.</p>
      ) : (
        <ul className="tr-rows tr-org-rows">
          {open.map((r) => (
            <li key={r.id} className="tr-org-row">
              <div style={{ minWidth: 0 }}>
                <strong>{KIND[r.kind] ?? r.kind}</strong> <span className="tr-review-meta">· asked {DATE.format(new Date(r.createdAt))}</span>
                <div className="tr-review-meta">
                  {[r.placeLabel, r.placeDate ? DATE.format(new Date(`${r.placeDate.slice(0, 10)}T12:00:00Z`)) : null, r.bookedBy ? `booked by ${r.bookedBy}` : null].filter(Boolean).join(" · ") || `Reference ${r.ref.split(":")[0]}`}
                </div>
                {r.note && <p style={{ margin: "6px 0 0", fontSize: 14 }}>“{r.note}”</p>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <AdminButton size="sm" onClick={() => setDeciding({ row: r, decision: "decline" })}>
                  Decline
                </AdminButton>
                <AdminButton size="sm" variant="primary" onClick={() => setDeciding({ row: r, decision: "accept" })}>
                  Confirm they attended
                </AdminButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deciding}
        title={deciding?.decision === "accept" ? "Confirm this person attended?" : "Decline this request?"}
        message={
          deciding?.decision === "accept"
            ? "Only confirm someone you know was there. If the place wasn't recorded, it's recorded as attended. They can then review it. Payments aren't affected."
            : "Tell them why — they see your note and can ask HelloCircle to look at it."
        }
        confirmLabel={deciding?.decision === "accept" ? "Confirm they attended" : "Decline"}
        tone="neutral"
        confirmDisabled={deciding?.decision === "decline" && note.trim().length < 10}
        onConfirm={async () => {
          if (!deciding) return;
          await decideAttendanceCorrection(deciding.row.id, deciding.decision, note.trim() || undefined, asHost);
          setDone(deciding.decision === "accept" ? "Recorded as attended." : "Request declined.");
          setDeciding(null);
          setNote("");
          load();
        }}
        onCancel={() => {
          setDeciding(null);
          setNote("");
        }}
      >
        {deciding?.decision === "decline" && (
          <label style={{ display: "block" }}>
            <span className="tr-label">Your note (at least 10 characters)</span>
            <textarea className="tr-input" rows={3} value={note} maxLength={1500} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </ConfirmDialog>
    </Box>
  );
}
