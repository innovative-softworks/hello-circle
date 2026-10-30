import { Router } from "express";
import { hasPlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { writeAudit } from "../audit.js";
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
  note_added: "Team note added",
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
    // Phase O3 — the team's own notes (never shown to the person who booked); managers only.
    notes_internal: runsListing ? await internalNotes(order.source, order.ref) : null,
    history: [
      { label: "Booked", at: order.createdAt },
      ...history.map((h) => ({ label: HISTORY_LABELS[h.action.split(".").slice(1).join(".")] ?? h.action.split(".").slice(1).join(" ").replace(/_/g, " "), at: h.at instanceof Date ? h.at.toISOString() : String(h.at) })),
    ],
  });
});

// --- Phase O3: the team's operational notes on a booking ---------------------------
// Append-only (a correction is a new note), for the people who run the listing;
// never shown to the person who booked or in exports. Each note is audited
// (who and which booking — not the text).

async function internalNotes(source: string, ref: string) {
  const rows = (await db
    .prepare(`SELECT n.id, n.body, n.created_at AS at, u.name AS author FROM order_notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.source_type = ? AND n.order_ref = ? ORDER BY n.id`)
    .all(source, ref)) as { id: number; body: string; at: Date | string; author: string | null }[];
  return rows.map((r) => ({ id: Number(r.id), body: r.body, author: r.author ?? "A team member", at: r.at instanceof Date ? r.at.toISOString() : String(r.at) }));
}

vendorOrdersRouter.post("/orders/:source/:ref/notes", async (req, res) => {
  const source = req.params.source;
  if (!isOrderSource(source)) return res.status(404).json({ error: "Not found" });
  const order = await orgOrder(source, req.params.ref, req.vendorIds!);
  if (!order) return res.status(404).json({ error: "Not found" });
  if (!hasPlatformRole(req.user!, ...(await listingRoles(order)))) return res.status(403).json({ error: "Only the managers who run this listing can add notes" });
  const body = typeof (req.body ?? {}).body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Write the note" });
  if (body.length > 2000) return res.status(400).json({ error: "Keep the note under 2,000 characters" });
  await db.prepare(`INSERT INTO order_notes (source_type, order_ref, author_user_id, body) VALUES (?, ?, ?, ?)`).run(source, order.ref, req.user!.id, body);
  await writeAudit({ actorUserId: req.user!.id, action: `${source}.note_added`, objectType: source, objectId: order.ref });
  res.status(201).json({ notes: await internalNotes(source, order.ref) });
});
