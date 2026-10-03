import { useRef, useState } from "react";
import { ApiError } from "../api/core";
import type { SelfCancelResult } from "../api/public";
import { colors } from "../theme";
import { ConfirmDialog } from "./ui";

// Phase 11B — resident self-cancel for experience bookings and programme
// enrolments. The server is authoritative: the button shows only when the
// server says `canCancel`, the outcome text comes from the server's
// refundState (never "Refunded" before it is), and the cancel call itself
// is the existing cancel route (no client-side rules duplicated here).

export type RefundState = "none" | "pending" | "refunded";

export function refundBadgeText(refundState: RefundState | undefined): string | null {
  if (refundState === "pending") return "Refund processing";
  if (refundState === "refunded") return "Refunded";
  return null;
}

export function SelfCancelControl({
  noun,
  title,
  detail,
  canCancel,
  paidOnline,
  cancel,
  onCancelled,
}: {
  noun: "booking" | "enrolment";
  title: string;
  detail: string;
  canCancel: boolean;
  paidOnline: boolean;
  cancel: () => Promise<SelfCancelResult>;
  onCancelled: (result: { refundState: RefundState }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inFlight = useRef(false);

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await cancel();
      setOpen(false);
      setMessage({ tone: "ok", text: result.refundState === "pending" ? "Cancellation confirmed — refund processing" : "Cancellation confirmed" });
      onCancelled({ refundState: result.refundState });
    } catch (e) {
      setOpen(false);
      if (e instanceof ApiError && e.status === 409) {
        // Already cancelled elsewhere (another tab, a double submit, the host),
        // or no longer cancellable online — show the server's reason, refresh.
        setMessage({ tone: "error", text: e.message });
        onCancelled({ refundState: "none" });
      } else if (e instanceof ApiError) {
        setMessage({ tone: "error", text: e.message || `Couldn't cancel this ${noun} — please try again.` });
      } else {
        setMessage({ tone: "error", text: `Couldn't cancel this ${noun} — check your connection and try again.` });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  // Stays mounted after the row turns cancelled so the outcome message
  // persists; renders nothing when there's neither an action nor a message.
  if (!canCancel && !message && !open) return null;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div aria-live="polite" role={message?.tone === "error" ? "alert" : "status"} style={{ fontSize: 13, fontWeight: 600, color: message?.tone === "error" ? colors.danger : colors.greenText }}>
        {message?.text}
      </div>
      {canCancel && (
        <button
          type="button"
          className="btn-reset"
          onClick={() => setOpen(true)}
          disabled={busy}
          // Several rows can each offer this action — give each a distinct
          // accessible name that still starts with the visible text (WCAG 2.5.3).
          aria-label={busy ? undefined : `Cancel ${noun} for ${title}`}
          style={{ color: colors.danger, fontWeight: 700, fontSize: 13, padding: "6px 2px", cursor: busy ? "default" : "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          {busy ? "Cancelling…" : `Cancel ${noun}`}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Cancel this ${noun}?`}
        message={`${title} · ${detail}.${paidOnline ? " Your refund is issued by the host through HelloCircle — we'll email you when it's done." : ""} This can't be undone.`}
        confirmLabel={busy ? "Cancelling…" : `Cancel ${noun}`}
        cancelLabel={`Keep ${noun}`}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
