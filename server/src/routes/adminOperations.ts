import { Router } from "express";
import { ChangeError, proposeBookingChange } from "../bookingChanges.js";
import { activityDetail, listActivities, listCircles, listHosts, listPeople } from "../adminDirectories.js";
import { requireAdminPermission } from "../adminPermissions.js";
import { cancelOrderOnBehalf, type CancellableOrderKind } from "../hallBookingCancel.js";
import { parseDecisionReason } from "../moderationDecisions.js";
import { ModerationError, cancelActivityByPlatform } from "../reportModeration.js";
import { ORDER_KINDS, listOrders, pageLimit, type OrderKind } from "../supportLookup.js";

// OG-14 / OG-10 — admin Operations: paged directories of people, orders,
// activities, Circles and hosts, plus the two actions an admin can take from
// them. Every route declares its permission (D-02). Cancelling uses the same
// provider-cancel paths partners use, so the customer is told and a paid
// online order is refunded in full — no new money rule.

export const adminOperationsRouter = Router();

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

adminOperationsRouter.get("/people", requireAdminPermission("support.search"), async (req, res) => {
  const filter = req.query.filter === "host" || req.query.filter === "verified_host" || req.query.filter === "deactivated" ? req.query.filter : undefined;
  res.json(await listPeople({ q: str(req.query.q), filter }, req.query.cursor, pageLimit(req.query.limit)));
});

adminOperationsRouter.get("/orders", requireAdminPermission("support.search"), async (req, res) => {
  const kind = ORDER_KINDS.includes(req.query.kind as OrderKind) ? (req.query.kind as OrderKind) : undefined;
  res.json(
    await listOrders(
      { kind, status: str(req.query.status), paymentStatus: str(req.query.paymentStatus), from: date(req.query.from), to: date(req.query.to), q: str(req.query.q) },
      req.query.cursor,
      pageLimit(req.query.limit)
    )
  );
});

adminOperationsRouter.get("/activities", requireAdminPermission("support.search"), async (req, res) => {
  const when = req.query.when === "upcoming" || req.query.when === "past" ? req.query.when : undefined;
  res.json(await listActivities({ q: str(req.query.q), status: str(req.query.status), when }, req.query.cursor, pageLimit(req.query.limit)));
});

adminOperationsRouter.get("/activities/:id", requireAdminPermission("support.search"), async (req, res) => {
  const detail = await activityDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Activity not found" });
  res.json(detail);
});

adminOperationsRouter.post("/activities/:id/cancel", requireAdminPermission("activities.moderate"), async (req, res) => {
  const parsed = parseDecisionReason(req.body, "suspension", true);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    await cancelActivityByPlatform(req.params.id, req.user!.id, parsed.reason!);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ModerationError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

adminOperationsRouter.get("/circles", requireAdminPermission("support.search"), async (req, res) => {
  res.json(await listCircles({ q: str(req.query.q), status: str(req.query.status) }, req.query.cursor, pageLimit(req.query.limit)));
});

adminOperationsRouter.get("/hosts", requireAdminPermission("support.search"), async (req, res) => {
  res.json(await listHosts({ q: str(req.query.q), status: str(req.query.status) }, req.query.cursor, pageLimit(req.query.limit)));
});

// OG-10 / OG-11 — HelloCircle proposes a new time for a hall booking on the
// venue's behalf; the customer still decides (DEC-17).
adminOperationsRouter.post("/orders/booking/:ref/propose-change", requireAdminPermission("orders.cancel"), async (req, res) => {
  const b = req.body as { date?: string; time?: string; message?: string };
  if (!b.date || !b.time) return res.status(400).json({ error: "Choose the new date and time" });
  if (typeof b.message !== "string" || b.message.trim().length < 10) return res.status(400).json({ error: "Explain the change to the customer (at least 10 characters)" });
  try {
    res.status(201).json(await proposeBookingChange({ ref: req.params.ref, vendorIds: null, actorUserId: req.user!.id, date: b.date, time: b.time, message: b.message }));
  } catch (e) {
    if (e instanceof ChangeError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

const CANCELLABLE: CancellableOrderKind[] = ["booking", "registration", "program", "experience"];

adminOperationsRouter.post("/orders/:kind/:ref/cancel", requireAdminPermission("orders.cancel"), async (req, res) => {
  const kind = req.params.kind as CancellableOrderKind;
  if (!CANCELLABLE.includes(kind)) return res.status(400).json({ error: "Only hall bookings, club registrations, programme enrolments and experience bookings can be cancelled here" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10) return res.status(400).json({ error: "Give a reason of at least 10 characters — it's recorded with the cancellation" });
  const result = await cancelOrderOnBehalf(kind, req.params.ref, req.user!.id, reason.slice(0, 1000));
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, refund: result.refund, ...(result.refundError ? { refundError: result.refundError } : {}) });
});
