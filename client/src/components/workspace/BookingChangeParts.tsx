import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { fetchVendorBookingChanges, withdrawVendorBookingChange, type BookingChangeProposal } from "../../api";
import { dateLabel } from "../../euro";
import { AdminButton, AdminModal, Box, FormField, Loaded, StatusTag, errorMessage, formatDate, useAdminData } from "../admin/adminUi";
import { useToast } from "../Toast";

// OG-11 / DEC-17 — proposing a new time for a hall booking (partner Bookings
// record, admin order record). The customer gets an email link to accept or
// decline; the booking only moves if they accept, and the server re-checks
// the slot then.

const SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

export function ProposeChangeDialog({
  open,
  onClose,
  current,
  messageRequired,
  onPropose,
}: {
  open: boolean;
  onClose: () => void;
  current: { date: string; time: string };
  messageRequired?: boolean;
  onPropose: (input: { date: string; time: string; message: string }) => Promise<unknown>;
}) {
  const toast = useToast();
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState(current.time);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (date === current.date && time === current.time) return setError("Choose a different date or time");
    if (messageRequired && message.trim().length < 10) return setError("Explain the change to the customer (at least 10 characters)");
    setBusy(true);
    setError(null);
    try {
      await onPropose({ date, time, message: message.trim() });
      toast.success("Sent to the customer to accept or decline");
      onClose();
    } catch (e) {
      setError(errorMessage(e, "Couldn't send that proposal"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      dirty={date !== current.date || time !== current.time || !!message}
      title="Propose a new time"
      subtitle={`Now ${dateLabel(current.date)} at ${current.time}. The customer gets an email to accept or decline; the booking moves only if they accept, and stays as it is if they don't.`}
      footer={
        <>
          <AdminButton variant="quiet" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send to the customer"}
          </AdminButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <FormField label="New date" required>
            {(p) => <input {...p} type="date" className="adm-input" value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          <FormField label="New start time" required>
            {(p) => (
              <select {...p} className="adm-select" value={time} onChange={(e) => setTime(e.target.value)}>
                {SLOTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <FormField label={messageRequired ? "Message to the customer" : "Message to the customer (optional)"} required={messageRequired} hint="Say why. It's included in the email." error={error}>
          {(p) => <textarea {...p} className="adm-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} style={{ resize: "vertical" }} />}
        </FormField>
      </div>
    </AdminModal>
  );
}

const STATUS_TEXT: Record<BookingChangeProposal["status"], string> = {
  proposed: "Waiting for the customer",
  accepted: "Accepted — booking moved",
  declined: "Declined — booking unchanged",
  withdrawn: "Withdrawn",
  expired: "Expired — booking unchanged",
};

export function BookingChangeHistory({ bookingRef, refreshKey, canWithdraw }: { bookingRef: string; refreshKey: number; canWithdraw: boolean }) {
  const toast = useToast();
  const state = useAdminData(() => fetchVendorBookingChanges(bookingRef), [bookingRef, refreshKey]);
  if (state.data && state.data.length === 0) return null;
  return (
    <Box flush icon={CalendarClock} title="Proposed time changes">
      <Loaded state={state} title="Couldn't load proposed changes">
        {(rows) => (
          <ul className="ws-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {rows.map((p) => (
              <li key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "12px 24px", borderTop: "1px solid var(--adm-line)" }}>
                <div>
                  <strong>
                    {dateLabel(p.oldDate)} {p.oldTime} → {dateLabel(p.proposedDate)} {p.proposedTime}
                  </strong>
                  <div className="adm-note">
                    Sent {formatDate(p.createdAt, true)}
                    {p.message ? ` · "${p.message}"` : ""}
                    {p.responseNote ? ` · Customer: "${p.responseNote}"` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <StatusTag status={p.status === "accepted" ? "active" : p.status === "proposed" ? "pending" : "rejected"} label={STATUS_TEXT[p.status]} />
                  {p.status === "proposed" && canWithdraw && (
                    <AdminButton
                      size="sm"
                      onClick={() =>
                        withdrawVendorBookingChange(bookingRef, p.id)
                          .then(() => {
                            toast.success("Proposal withdrawn");
                            state.reload();
                          })
                          .catch((e) => toast.error(errorMessage(e, "Couldn't withdraw it")))
                      }
                    >
                      Withdraw
                    </AdminButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Box>
  );
}
