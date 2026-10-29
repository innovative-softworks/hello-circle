import { Router } from "express";
import { hasPlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { formQuestionsOn } from "../participation/formAnswers.js";
import { ANSWER_SOURCE } from "../participation/formListings.js";
import { isOrderSource, missingRequired, orderAttendance, orderPeople, orgOrder, type OrderCore } from "../participation/orderRecords.js";
import { activeQuestions, questionsVersion, readAnswersFor } from "../participation/questions.js";

// Phase J (docs/participation-expansion/20) — one partner record for any
// participation order: status, people, attendance, registration answers,
// notes, the actions this person may take and the change history. Reads the
// existing order, attendee, answer, attendance and audit rows; no copies.
// Mounted under routes/vendor.ts (requireVendor + attachVendorIds; check-in-
// only staff never get past the /vendor/door allow-list).
//   the record (order, contact, people, attendance, history) — the order
//     roles (both managers + finance), as for the Bookings tab
//   registration answers — only the role that runs the listing (and the owner);
//     finance does NOT get them by default
//   actions — cancel: the listing's role; refund: finance (owners: both)

export const vendorOrdersRouter = Router();

/** The staff role that runs this listing: halls (and programmes at a hall) the centre manager, clubs the facility manager, experiences either. */
async function listingRoles(order: OrderCore): Promise<string[]> {
  if (order.source === "booking") return ["centre_manager"];
  if (order.source === "registration") return ["facility_manager"];
  if (order.source === "program") {
    const p = (await db.prepare(`SELECT listing_type AS t FROM programs WHERE id = ?`).get(order.listingId)) as { t: string } | undefined;
    return [p?.t === "centre" ? "centre_manager" : "facility_manager"];
  }
  return ["centre_manager", "facility_manager"];
}

const HISTORY_LABELS: Record<string, string> = {
  answers_edited: "Answers changed by the person who booked",
  cancelled_by_vendor: "Cancelled by the organiser",
  cancelled: "Cancelled",
  refunded: "Refunded",
  refund_issued: "Refunded",
  checked_in: "Checked in",
  no_show: "Marked as not attended",
  change_proposed: "New time proposed",
};

vendorOrdersRouter.get("/orders/:source/:ref", async (req, res) => {
  const source = req.params.source;
  if (!isOrderSource(source)) return res.status(404).json({ error: "Not found" });
  const user = req.user!;
  if (!hasPlatformRole(user, "centre_manager", "facility_manager", "finance")) return res.status(403).json({ error: "Not authorized for this role" });
  const order = await orgOrder(source, req.params.ref, req.vendorIds!);
  if (!order) return res.status(404).json({ error: "Not found" });
  const roles = await listingRoles(order);
  const runsListing = hasPlatformRole(user, ...roles);
  const people = await orderPeople(order);
  const on = await formQuestionsOn(order.vendorId);
  const questions = on ? await activeQuestions(order.listingType, order.listingId) : [];
  const answers = runsListing ? (await readAnswersFor(ANSWER_SOURCE[order.listingType], [order.ref])).get(order.ref) ?? [] : null;
  const history = (await db
    .prepare(`SELECT action, actor_kind AS actorKind, created_at AS at FROM audit_log WHERE object_id = ? AND action LIKE ? ORDER BY created_at, id LIMIT 100`)
    .all(order.ref, `%.%`)) as { action: string; actorKind: string | null; at: Date | string }[];
  const extra = order.source === "experience"
    ? ((await db.prepare(`SELECT id FROM experience_bookings WHERE ref = ?`).get(order.ref)) as { id: number } | undefined)
    : undefined;
  const open = order.status !== "cancelled";
  res.json({
    source: order.source,
    listingType: order.listingType,
    listingId: order.listingId,
    title: order.title,
    ref: order.ref,
    orderId: order.source === "program" ? order.enrollmentId : extra?.id ?? null,
    date: order.date,
    time: order.time,
    status: order.status,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    contact: { name: order.contactName, email: order.email, phone: order.phone },
    partySize: order.partySize,
    notes: order.notes ?? null,
    people: people.map((p) => ({ attendeeNo: p.attendeeNo, name: p.name, personType: p.personType, lineLabel: p.lineLabel, guardianName: p.guardianName, status: p.status, checkedInAt: p.checkedInAt })),
    attendance: await orderAttendance(order),
    // Answers are for the people who run the listing; others see that they exist, not what they say.
    answersVisible: runsListing,
    answers,
    answerCount: answers ? answers.length : ((await readAnswersFor(ANSWER_SOURCE[order.listingType], [order.ref])).get(order.ref) ?? []).length,
    questionsVersion: on ? await questionsVersion(order.listingId, db, order.listingType) : 0,
    missingAnswers: runsListing && answers && open ? missingRequired(questions, answers, people) : [],
    actions: {
      cancel: open && runsListing && order.source !== "booking",
      refund: order.paymentStatus === "paid" && hasPlatformRole(user, "finance") && order.source !== "booking",
    },
    history: [
      { label: "Booked", at: order.createdAt },
      ...history.map((h) => ({ label: HISTORY_LABELS[h.action.split(".").slice(1).join(".")] ?? h.action.split(".").slice(1).join(" ").replace(/_/g, " "), at: h.at instanceof Date ? h.at.toISOString() : String(h.at) })),
    ],
  });
});
