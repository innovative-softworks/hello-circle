import { useCallback, useEffect, useState } from "react";
import { fetchVendorOrders, issueVendorRefund, type VendorOrder } from "../api";
import { dateLabel } from "../euro";
import { Button, ConfirmDialog, ManageCard as Card } from "./ui";
import { colors, fonts, radius } from "../theme";

// Booking UX Phase 6 (UX plan S10, audit B12) — what still needs doing on
// this organisation's orders, at the top of the Bookings tab: refunds for
// cancelled-but-paid orders, and deposits due back after an event. Amounts
// come from the server's order list; the refund itself is the existing
// finance-only refund route (refund-once, recorded, audited) — staff without
// the finance role see the server's refusal rather than a hidden button.

const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const TYPE_LABEL: Record<VendorOrder["type"], string> = { booking: "Venue booking", registration: "Registration", program: "Programme", experience: "Experience" };

type Action = { order: VendorOrder; kind: "refund" | "deposit"; amountCents: number };

function actionsFor(o: VendorOrder): Action[] {
  const out: Action[] = [];
  if (o.attention.includes("refund_pending")) out.push({ order: o, kind: "refund", amountCents: Math.max(0, o.totalCents - o.refundedCents) });
  if (o.attention.includes("deposit_due")) out.push({ order: o, kind: "deposit", amountCents: Math.max(0, o.depositCents - o.refundedCents) });
  return out;
}

export function VendorActionNeeded() {
  const [orders, setOrders] = useState<VendorOrder[] | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    fetchVendorOrders(true)
      .then(setOrders)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  // Refunds and deposits still owed: a failed check must never read as "nothing owed".
  if (failed)
    return (
      <p role="alert" style={{ fontSize: 13.5, margin: 0 }}>
        Couldn't check for refunds or deposits still owed.{" "}
        <button type="button" className="btn-reset" onClick={load} style={{ textDecoration: "underline", fontWeight: 600 }}>
          Try again
        </button>
      </p>
    );
  if (!orders || orders.length === 0) return message ? <p role="status" style={{ fontSize: 13.5, color: colors.greenText, fontWeight: 600 }}>{message.text}</p> : null;

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      await issueVendorRefund({
        sourceType: pending.order.type,
        ref: pending.order.ref,
        // A deposit is a partial refund of exactly what's still owed on it; a
        // cancelled order's refund is "the rest" (the server works it out).
        amountMinor: pending.kind === "deposit" ? pending.amountCents : undefined,
        reason: pending.kind === "deposit" ? "Refundable deposit returned after the event" : "Order was cancelled",
      });
      setMessage({ tone: "ok", text: `${euro(pending.amountCents)} refunded to ${pending.order.customerName}.` });
      load();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Couldn't issue that refund" });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Card>
      <h2 style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 17, margin: "0 0 4px" }}>Action needed</h2>
      <p style={{ margin: "0 0 14px", fontSize: 13.5, color: colors.mutedLight }}>Money still owed back to customers.</p>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} style={{ margin: "0 0 12px", fontSize: 13.5, fontWeight: 600, color: message.tone === "error" ? colors.danger : colors.greenText }}>
          {message.text}
        </p>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {orders.flatMap(actionsFor).map((a) => (
          <li key={`${a.order.ref}-${a.kind}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: colors.bg, borderRadius: radius.control, padding: "12px 14px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {a.kind === "deposit" ? "Deposit to return" : "Refund pending"} · {euro(a.amountCents)}
              </div>
              <div style={{ fontSize: 13, color: colors.mutedLight }}>
                {TYPE_LABEL[a.order.type]} · {a.order.listingName} · {a.order.customerName}
                {a.order.date ? ` · ${dateLabel(a.order.date)}` : ""} · {a.order.ref}
              </div>
            </div>
            <Button variant="dark" onClick={() => setPending(a)} disabled={busy}>
              {a.kind === "deposit" ? "Return deposit" : "Refund"}
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!pending}
        title={pending?.kind === "deposit" ? "Return this deposit?" : "Refund this order?"}
        message={pending ? `${euro(pending.amountCents)} goes back to ${pending.order.customerName}'s card (${pending.order.ref}). This can't be undone.` : ""}
        confirmLabel={busy ? "Refunding…" : `Refund ${pending ? euro(pending.amountCents) : ""}`}
        cancelLabel="Not now"
        tone="neutral"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => !busy && setPending(null)}
      />
    </Card>
  );
}
