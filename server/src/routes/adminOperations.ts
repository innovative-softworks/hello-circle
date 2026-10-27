import { writeAudit } from "../audit.js";
import { notifyResident } from "../notifications.js";
import { circlePlanningForAdmin, deletePoll, removePlan, removeWishGroup } from "../circleModeration.js";
import { adminRemoveLink, circleLinksForAdmin } from "./circleLinks.js";
import { db } from "../db/index.js";
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

// Circle planning moderation (owner, 2026-10-24): staff can take down a
// wish, a plan or a poll inside a Circle. A reason is required and recorded;
// wishes stay totals only — staff never see who wished for what.
adminOperationsRouter.get("/circles/:id/planning", requireAdminPermission("reports.view"), async (req, res) => {
  const circle = (await db.prepare(`SELECT id, name, slug, status, activity_label as activityLabel, closed_by as closedBy FROM circles WHERE id = ?`).get(req.params.id)) as Record<string, unknown> | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  res.json({ circle, ...(await circlePlanningForAdmin(req.params.id)), links: await circleLinksForAdmin(req.params.id) });
});

function moderationReason(req: { body?: unknown }): string | null {
  const r = typeof (req.body as { reason?: unknown })?.reason === "string" ? ((req.body as { reason: string }).reason).trim() : "";
  return r.length >= 10 ? r.slice(0, 500) : null;
}

// Circles 3.1 — take down a listing linked to a Circle (the listing itself is untouched).
adminOperationsRouter.post("/circles/:id/links/:linkId/remove", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — organisers see it" });
  const r = await adminRemoveLink(req.params.id, req.params.linkId, req.user!.id, reason);
  if (r === "missing") return res.status(404).json({ error: "That link has already gone" });
  res.json({ ok: true });
});

// Circles 3.0 — HelloCircle closes a Circle directly (not only through a
// report), or reopens one it closed. Reason required, organisers told,
// audited. An organiser's own closure stays theirs to reopen.
adminOperationsRouter.post("/circles/:id/close", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — organisers see it" });
  const circle = (await db.prepare(`SELECT name FROM circles WHERE id = ?`).get(req.params.id)) as { name: string } | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const r = await db.prepare(`UPDATE circles SET status = 'closed', closed_by = 'helloCircle' WHERE id = ? AND status != 'closed'`).run(req.params.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This Circle is already closed" });
  await writeAudit({ actorUserId: req.user!.id, action: "circle.closed_by_helloCircle", objectType: "circle", objectId: req.params.id, previousValue: { status: "active" }, newValue: { status: "closed" }, reason });
  await tellOrganisers(req.params.id, `Closed by HelloCircle: ${circle.name}`, `HelloCircle closed this Circle: ${reason}`);
  res.json({ ok: true });
});

adminOperationsRouter.post("/circles/:id/reopen", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — organisers see it" });
  const circle = (await db.prepare(`SELECT name, status, closed_by as closedBy FROM circles WHERE id = ?`).get(req.params.id)) as { name: string; status: string; closedBy: string | null } | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (circle.status !== "closed" || circle.closedBy !== "helloCircle") return res.status(409).json({ error: "Only a Circle HelloCircle closed can be reopened here" });
  const r = await db.prepare(`UPDATE circles SET status = 'active', closed_by = NULL WHERE id = ? AND status = 'closed' AND closed_by = 'helloCircle'`).run(req.params.id);
  if (r.changes !== 1) return res.status(409).json({ error: "This Circle has already changed — reload" });
  await writeAudit({ actorUserId: req.user!.id, action: "circle.reopened_by_helloCircle", objectType: "circle", objectId: req.params.id, previousValue: { status: "closed" }, newValue: { status: "active" }, reason });
  await tellOrganisers(req.params.id, `Reopened: ${circle.name}`, `HelloCircle reopened this Circle: ${reason}`);
  res.json({ ok: true });
});

async function tellOrganisers(circleId: string, title: string, body: string) {
  const organisers = (await db.prepare(`SELECT resident_id FROM circle_members WHERE circle_id = ? AND role = 'organiser'`).all(circleId)) as { resident_id: string }[];
  for (const o of organisers) await notifyResident({ residentId: o.resident_id, kind: "circle", title, body, listingType: "circle", listingId: circleId, ref: circleId });
}

adminOperationsRouter.post("/circles/:id/wishes/remove", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — the people who added it see it" });
  const { weekStart, interestKey } = req.body as { weekStart?: string; interestKey?: string };
  if (!weekStart || !interestKey) return res.status(400).json({ error: "Choose a wish" });
  const n = await removeWishGroup(req.params.id, weekStart, interestKey, { kind: "admin", userId: req.user!.id }, reason);
  if (n === 0) return res.status(404).json({ error: "That wish has already gone" });
  res.json({ ok: true, removed: n });
});

adminOperationsRouter.post("/circles/:id/plans/:planId/remove", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — members see it" });
  const r = await removePlan(req.params.id, req.params.planId, { kind: "admin", userId: req.user!.id }, reason);
  if (r === "missing") return res.status(404).json({ error: "Plan not found" });
  if (r === "too_late") return res.status(409).json({ error: "This plan is already an activity or closed — cancel the activity instead" });
  res.json({ ok: true });
});

adminOperationsRouter.post("/circles/:id/polls/:pollId/delete", requireAdminPermission("reports.moderate"), async (req, res) => {
  const reason = moderationReason(req);
  if (!reason) return res.status(400).json({ error: "Give a reason of at least 10 characters — it's recorded" });
  if (!(await deletePoll(req.params.id, req.params.pollId, { kind: "admin", userId: req.user!.id }, reason))) return res.status(404).json({ error: "Poll not found" });
  res.json({ ok: true });
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
