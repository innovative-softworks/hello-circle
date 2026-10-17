import { useEffect, useState } from "react";
import { ApiError, createVendorBlock, fetchVendorRooms, previewVendorBlock, type ClosureAffectedBooking } from "../api";
import { AdminButton, AdminModal, FormField } from "./admin/adminUi";
import { useToast } from "./Toast";
import { formatDate } from "../vendorFormat";
import type { Room, VendorListingSummary } from "../types";

// Block time (OG-04): one dialog for the partner Calendar and the centre
// editor's Availability section. Step 1 says what to close (a whole day or a
// range of hours, one space or the whole centre). Step 2 shows the bookings
// that closure covers — the server re-checks the same list when the closure is
// saved — and, when there are any, the partner chooses what happens to them:
// keep them (the closure only stops new bookings) or cancel them, which tells
// each customer and refunds a paid online booking in full (the existing rule
// for any cancellation by the venue). A booked slot is never closed silently.

const EMPTY = { centreId: "", date: "", roomId: "", allDay: true, startTime: "09:00", endTime: "10:00", reason: "" };
const STARTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
const ENDS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

type Step = { kind: "details" } | { kind: "review"; affected: ClosureAffectedBooking[]; changed?: boolean };

export function VendorBlockTimeDialog({
  open,
  onClose,
  centres,
  fixedCentre,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Calendar: pick from these centres. */
  centres?: VendorListingSummary[];
  /** Centre editor: this centre, with its rooms already loaded. */
  fixedCentre?: { id: string; name: string; rooms: Room[] };
  onCreated?: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState<Step>({ kind: "details" });
  const [resolution, setResolution] = useState<"keep" | "cancel_refund" | "">("");
  const [loadedRooms, setLoadedRooms] = useState<Room[] | null>(null);
  const [roomsFailed, setRoomsFailed] = useState(false);
  const [error, setError] = useState<{ date?: string; time?: string; reason?: string; resolution?: string; save?: string }>({});
  const [busy, setBusy] = useState(false);
  const centreId = fixedCentre?.id ?? (form.centreId || centres?.[0]?.id || "");
  const centreName = fixedCentre?.name ?? centres?.find((c) => c.id === centreId)?.name ?? "the centre";
  const rooms = fixedCentre?.rooms ?? loadedRooms ?? [];

  const loadRooms = () => {
    if (fixedCentre || !open || !centreId) return;
    setLoadedRooms(null);
    setRoomsFailed(false);
    fetchVendorRooms(centreId)
      .then(setLoadedRooms)
      .catch(() => setRoomsFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadRooms, [open, centreId, fixedCentre]);

  const close = () => {
    setForm(EMPTY);
    setStep({ kind: "details" });
    setResolution("");
    setError({});
    onClose();
  };

  const input = () => ({
    date: form.date,
    roomId: form.roomId || undefined,
    reason: form.reason.trim() || undefined,
    ...(form.allDay ? {} : { startTime: form.startTime, endTime: form.endTime }),
  });

  const check = async () => {
    const next: typeof error = {};
    if (!form.date) next.date = "Pick a date";
    if (!form.allDay && form.endTime <= form.startTime) next.time = "The end time must be after the start time";
    setError(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const { affected } = await previewVendorBlock(centreId, input());
      setResolution("");
      setStep({ kind: "review", affected });
    } catch (e) {
      setError({ save: e instanceof Error ? e.message : "Couldn't check the bookings for that time" });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (step.kind !== "review") return;
    const affected = step.affected;
    const next: typeof error = {};
    if (affected.length && !resolution) next.resolution = "Choose what happens to these bookings";
    if (resolution === "cancel_refund" && !form.reason.trim()) next.reason = "Give a reason — it's recorded with each cancellation";
    setError(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const result = await createVendorBlock(centreId, { ...input(), expectedRefs: affected.map((b) => b.ref), resolution: affected.length ? (resolution as "keep" | "cancel_refund") : undefined });
      const where = form.roomId ? rooms.find((r) => r.id === form.roomId)?.name ?? "that space" : centreName;
      const when = form.allDay ? formatDate(form.date) : `${formatDate(form.date)}, ${form.startTime}–${form.endTime}`;
      const failed = result.cancelled.filter((c) => c.refund === "failed").length;
      if (result.cancelled.length) {
        toast.success(`${when} closed for ${where}. ${result.cancelled.length} booking${result.cancelled.length === 1 ? "" : "s"} cancelled.`);
        if (failed) toast.error(`${failed} refund${failed === 1 ? "" : "s"} didn't go through. They're listed under Bookings → Action needed.`);
      } else {
        toast.success(`${when} closed for ${where}`);
      }
      onCreated?.();
      close();
    } catch (e) {
      // The bookings changed since the review: show the new list and ask again.
      const fresh = e instanceof ApiError ? (e.body.affected as ClosureAffectedBooking[] | undefined) : undefined;
      if (e instanceof ApiError && e.status === 409 && Array.isArray(fresh)) {
        setResolution("");
        setStep({ kind: "review", affected: fresh, changed: true });
      } else {
        setError({ save: e instanceof Error ? e.message : "Couldn't close that time" });
      }
    } finally {
      setBusy(false);
    }
  };

  const reviewing = step.kind === "review";
  const affected = reviewing ? step.affected : [];
  const confirmLabel = !affected.length ? "Close this time" : resolution === "cancel_refund" ? `Close and cancel ${affected.length} booking${affected.length === 1 ? "" : "s"}` : "Close this time";

  return (
    <AdminModal
      open={open}
      onClose={close}
      dirty={JSON.stringify(form) !== JSON.stringify(EMPTY)}
      title={reviewing ? "Check the bookings" : "Block time"}
      subtitle={
        reviewing
          ? affected.length
            ? `${affected.length} booking${affected.length === 1 ? " is" : "s are"} already in this time. Choose what happens to ${affected.length === 1 ? "it" : "them"}.`
            : "Nobody has booked this time. Closing it stops new bookings."
          : "Close a day, or some hours, for one space or the whole centre. You'll see any bookings it affects before anything changes."
      }
      footer={
        reviewing ? (
          <>
            <AdminButton variant="quiet" onClick={() => setStep({ kind: "details" })} disabled={busy}>
              Back
            </AdminButton>
            <AdminButton variant="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : confirmLabel}
            </AdminButton>
          </>
        ) : (
          <>
            <AdminButton variant="quiet" onClick={close}>
              Cancel
            </AdminButton>
            <AdminButton type="submit" form="ws-block-time" variant="primary" disabled={busy || !centreId}>
              {busy ? "Checking…" : "Continue"}
            </AdminButton>
          </>
        )
      }
    >
      {reviewing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {step.changed && (
            <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
              The bookings in this time changed while you were looking. This is the up-to-date list.
            </p>
          )}
          <p className="adm-note" style={{ margin: 0 }}>
            {form.allDay ? formatDate(form.date) : `${formatDate(form.date)}, ${form.startTime}–${form.endTime}`} ·{" "}
            {form.roomId ? rooms.find((r) => r.id === form.roomId)?.name ?? "one space" : `the whole of ${centreName}`}
          </p>
          {affected.length > 0 && (
            <>
              <div className="adm-table-wrap">
                <table className="adm-table adm-table--stack">
                  <caption className="adm-visually-hidden">Bookings in this time</caption>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Space</th>
                      <th scope="col">Booked by</th>
                      <th scope="col">Payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affected.map((b) => (
                      <tr key={b.ref}>
                        <td data-label="Time">
                          {b.time} · {b.duration}h
                        </td>
                        <td data-label="Space">{b.roomName ?? "—"}</td>
                        <td data-label="Booked by">
                          {b.name} · {b.guests} {b.guests === 1 ? "guest" : "guests"}
                        </td>
                        <td data-label="Payment">{paymentLabel(b)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <fieldset className="ws-choice" aria-describedby={error.resolution ? "block-resolution-error" : undefined} style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <legend style={{ fontWeight: 700, marginBottom: 6 }}>What happens to these bookings?</legend>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="radio" name="block-resolution" checked={resolution === "keep"} onChange={() => setResolution("keep")} />
                  <span>
                    <strong>Keep them.</strong> They go ahead as booked; the closure only stops new bookings.
                  </span>
                </label>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="radio" name="block-resolution" checked={resolution === "cancel_refund"} onChange={() => setResolution("cancel_refund")} />
                  <span>
                    <strong>Cancel them.</strong> Each customer is told, and a booking paid online is refunded in full. Any activity held on one of them is cancelled too.
                  </span>
                </label>
                {error.resolution && (
                  <p id="block-resolution-error" role="alert" className="adm-field-error" style={{ margin: 0 }}>
                    {error.resolution}
                  </p>
                )}
              </fieldset>
              {resolution === "cancel_refund" && (
                <FormField label="Reason" required error={error.reason} hint="Recorded with each cancellation.">
                  {(p) => <input {...p} className="adm-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="e.g. Burst pipe in the hall" />}
                </FormField>
              )}
            </>
          )}
          {error.save && (
            <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
              {error.save}
            </p>
          )}
        </div>
      ) : (
        <form
          id="ws-block-time"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {!fixedCentre && centres && centres.length > 1 && (
            <FormField label="Centre">
              {(p) => (
                <select {...p} className="adm-select" value={centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value, roomId: "" }))}>
                  {centres.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          <FormField label="Date" required error={error.date}>
            {(p) => <input {...p} type="date" className="adm-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}
          </FormField>
          <FormField label="Space">
            {(p) => (
              <select {...p} className="adm-select" value={form.roomId} onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))} disabled={!fixedCentre && loadedRooms === null && !roomsFailed}>
                <option value="">Whole centre</option>
                {rooms
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            )}
          </FormField>
          {roomsFailed && (
            <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
              Couldn't load this centre's spaces, so only "Whole centre" is available.{" "}
              <button type="button" className="btn-reset" style={{ textDecoration: "underline", fontWeight: 700 }} onClick={loadRooms}>
                Try again
              </button>
            </p>
          )}
          <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend style={{ fontWeight: 700, marginBottom: 6 }}>When</legend>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="block-when" checked={form.allDay} onChange={() => setForm((f) => ({ ...f, allDay: true }))} /> All day
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="block-when" checked={!form.allDay} onChange={() => setForm((f) => ({ ...f, allDay: false }))} /> Some hours
            </label>
          </fieldset>
          {!form.allDay && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <FormField label="From">
                {(p) => (
                  <select {...p} className="adm-select" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}>
                    {STARTS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Until" error={error.time}>
                {(p) => (
                  <select {...p} className="adm-select" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}>
                    {ENDS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          )}
          <FormField label="Reason (optional)">
            {(p) => <input {...p} className="adm-input" placeholder="e.g. Festival, maintenance" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />}
          </FormField>
          {error.save && (
            <p role="alert" className="adm-field-error" style={{ margin: 0 }}>
              {error.save}
            </p>
          )}
        </form>
      )}
    </AdminModal>
  );
}

function paymentLabel(b: ClosureAffectedBooking): string {
  const amount = b.totalCents ? ` · €${(b.totalCents / 100).toFixed(2)}` : "";
  if (b.paymentStatus === "pending") return "Checkout in progress";
  if (b.paymentStatus === "paid" && b.online) return `Paid online${amount}`;
  if (b.paymentStatus === "paid") return b.totalCents ? `Pay at venue${amount}` : "Free";
  return b.paymentStatus;
}
