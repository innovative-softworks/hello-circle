import { useEffect, useState, type ReactNode } from "react";
import { fetchMyReports, submitReport } from "../api";
import { Button, Modal } from "./ui";
import { colors, radius } from "../theme";

// OG-32 — a report link for an activity or a listing, the same flow Circles,
// reviews and chat messages already have: a reason, optional detail, and the
// report lands in the admin Reviews & reports queue. Works signed out (reports
// are keyed by the anonymous client id), and remembers that you've reported it.

export type ReportableType = "game" | "centre" | "club" | "experience" | "program" | "host" | "provider" | "circle_memory" | "circle_plan";

const REASONS = ["Spam or fake", "Misleading or inaccurate", "Unsafe", "Harassment or abuse", "Other"];

export function ReportContentButton({
  targetType,
  targetId,
  what,
  render,
}: {
  targetType: ReportableType;
  targetId: string;
  /** "this activity", "this listing" … used in the dialog text. */
  what: string;
  render?: (onClick: () => void, alreadyReported: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [already, setAlready] = useState(false);

  useEffect(() => {
    fetchMyReports()
      .then((rows) => setAlready(rows.some((r) => r.targetType === targetType && r.targetId === targetId)))
      .catch(() => {});
  }, [targetType, targetId]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitReport(targetType, targetId, detail.trim() ? `${reason}: ${detail.trim()}` : reason);
      setAlready(true);
      setOpen(false);
      setDetail("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't send the report. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onClick = () => setOpen(true);
  return (
    <>
      {render ? (
        render(onClick, already)
      ) : (
        <button type="button" className="tap-target" onClick={onClick} disabled={already} style={{ background: "none", border: "none", padding: 0, cursor: already ? "default" : "pointer", color: colors.mutedLight, fontSize: 13, textDecoration: already ? "none" : "underline" }}>
          {already ? "Reported" : "Report"}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Report ${what}`}
        subtitle="HelloCircle reviews every report. The organiser isn't told who reported it."
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Sending…" : "Send report"}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend style={{ fontWeight: 700, marginBottom: 6 }}>What's wrong?</legend>
            {REASONS.map((r) => (
              <label key={r} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="radio" name={`report-${targetType}`} checked={reason === r} onChange={() => setReason(r)} /> {r}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`report-detail-${targetType}`} style={{ fontWeight: 700 }}>
            More detail <span style={{ fontWeight: 400, color: colors.mutedLight }}>(optional)</span>
          </label>
          <textarea
            id={`report-detail-${targetType}`}
            rows={3}
            value={detail}
            maxLength={1500}
            onChange={(e) => setDetail(e.target.value)}
            style={{ border: `1px solid ${colors.border}`, borderRadius: radius.control, padding: 10, font: "inherit", resize: "vertical" }}
          />
          {error && (
            <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
