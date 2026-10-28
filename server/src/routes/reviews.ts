import { Router, type Request, type Response } from "express";
import { writeAudit } from "../audit.js";
import { requireAdminPermission } from "../adminPermissions.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { cleanTags, isReviewSubject, reviewClaimKey, reviewablePlaces, reviewsOwnSubject, reviewSummary, verifiedSql, type ReviewSubject, type Reviewer } from "../reviewEligibility.js";
import { BadRequestError, clientIdFrom } from "../util.js";
import type { Review } from "../types.js";

export const reviewsRouter = Router();

// Public reviews for centres, clubs, Sessions, hosts, experiences and
// programmes. Trust & Retention batch 1 (2026-10-28): a review is tied to one
// occurrence the reviewer attended (see reviewEligibility.ts for the rules and
// what "attended" rests on), one review per attendee per occurrence (enforced
// by the uq_review_occurrence key, so a double submit can't create two), and
// the author can edit or delete it. Hosts and partners reply through their own
// workspaces (residents.ts / vendorOperations.ts). Admin hide/restore needs a
// recorded reason. Averages are always computed live from visible reviews —
// there is no stored or composite score.

interface ReviewRow {
  id: number;
  listing_type: Review["listingType"];
  listing_id: string;
  name: string;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string | null;
  vendor_reply: string | null;
  vendor_reply_at: string | null;
  attendance_basis: string | null;
  /** Live: the occurrence is still person-confirmed for the author (verifiedSql). */
  verified: number | string;
  occurrence_date: string | null;
  tags: string;
  client_id: string;
  resident_id: string | null;
}

const MAX_COMMENT = 2000;
const MAX_NAME = 80;

function toReview(row: ReviewRow, who?: Reviewer): Review {
  return {
    id: row.id,
    listingType: row.listing_type,
    listingId: row.listing_id,
    name: row.name,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vendorReply: row.vendor_reply,
    vendorRepliedAt: row.vendor_reply_at,
    // Only ever "person" — and only while the confirmation still holds. Older
    // reviews (and any written under the earlier, looser rule) carry none.
    attendanceBasis: Number(row.verified) === 1 ? "person" : null,
    occurrenceDate: row.occurrence_date,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    mine: who ? isAuthor(row, who) : false,
  };
}

function isAuthor(row: { client_id: string; resident_id: string | null }, who: Reviewer): boolean {
  if (row.resident_id && who.residentId && row.resident_id === who.residentId) return true;
  return !!who.clientId && row.client_id === who.clientId;
}

/** The reviewer as far as this request can tell — client id is optional on reads. */
function reviewer(req: Request): Reviewer {
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch {
    clientId = null;
  }
  return { clientId, residentId: req.resident?.id ?? null, userId: req.user?.id ?? null, email: req.guestEmail ?? null };
}

async function listingExists(listingType: ReviewSubject, listingId: string): Promise<boolean> {
  if (listingType === "centre") return !!(await getCentre(listingId));
  if (listingType === "club") return !!(await getClub(listingId));
  if (listingType === "game") return !!(await db.prepare(`SELECT 1 FROM games WHERE id = ?`).get(listingId));
  // A host can be reviewed once they have hosted; the occurrence check below
  // is what actually decides eligibility.
  if (listingType === "host") return !!(await db.prepare(`SELECT 1 FROM residents WHERE id = ?`).get(listingId));
  if (listingType === "experience") return !!(await db.prepare(`SELECT 1 FROM experiences WHERE id = ?`).get(listingId));
  return !!(await db.prepare(`SELECT 1 FROM programs WHERE id = ?`).get(listingId));
}

const NOT_ELIGIBLE: Record<ReviewSubject, string> = {
  centre: "You can review a venue once the venue has confirmed you attended a past booking.",
  club: "You can review a club once the club has confirmed you took part.",
  game: "You can review a Session once the host has recorded you as attending.",
  host: "You can review a host once they've recorded you at one of their Sessions.",
  experience: "You can review this once the organiser has confirmed you attended a past booking.",
  program: "You can review a programme once the organiser has confirmed you at a past session.",
};
/** A parent or guardian holding a child's registration (pending a guardian-feedback policy). */
const GUARDIAN = "Reviews are for people who took part themselves. Feedback from parents and guardians about a child's club isn't available yet — for a problem, use Complaints & appeals.";
/** For a place the person holds but that isn't confirmed for them yet. */
const NOT_CONFIRMED = "The organiser hasn't confirmed that you attended yet.";

function badQuery(res: Response) {
  return res.status(400).json({ error: "listingType and listingId are required" });
}

reviewsRouter.get("/", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return badQuery(res);
  const rows = (await db
    .prepare(`SELECT r.*, ${verifiedSql("r")} as verified FROM reviews r WHERE r.listing_type = ? AND r.listing_id = ? AND r.hidden = 0 ORDER BY r.created_at DESC, r.id DESC LIMIT 200`)
    .all(listingType, listingId)) as ReviewRow[];
  const who = reviewer(req);
  res.json(rows.map((r) => toReview(r, who)));
});

reviewsRouter.get("/summary", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return badQuery(res);
  res.json(await reviewSummary(listingType, listingId));
});

/** What the viewer can review: each occurrence, and whether it already has their review. */
reviewsRouter.get("/eligible", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return badQuery(res);
  const who = reviewer(req);
  if (!who.clientId && !who.residentId && !who.email) return res.status(400).json({ error: "Missing X-Client-Id header" });
  if (!isReviewSubject(listingType)) return res.json({ eligible: false, reason: "not_reviewable", occurrences: [] });
  if (await reviewsOwnSubject(listingType, listingId, who)) return res.json({ eligible: false, reason: "own", message: "You can't review something you run.", occurrences: [] });
  const { confirmed: occurrences, unconfirmed, guardianPlaces } = await reviewablePlaces(listingType, listingId, who);
  if (!occurrences.length && !unconfirmed.length && guardianPlaces) {
    return res.json({ eligible: false, reason: "guardian", message: GUARDIAN, occurrences: [] });
  }
  const reviewed = occurrences.length
    ? ((await db
        .prepare(
          `SELECT occurrence_kind as kind, occurrence_ref as ref, author_key as authorKey FROM reviews
           WHERE listing_type = ? AND occurrence_ref IN (${occurrences.map(() => "?").join(", ")})`
        )
        .all(listingType, ...occurrences.map((o) => o.ref))) as { kind: string; ref: string; authorKey: string }[])
    : [];
  const done = new Set(reviewed.map((r) => `${r.kind}|${r.ref}|${r.authorKey}`));
  const list = occurrences.map((o) => ({ kind: o.kind, ref: o.ref, date: o.date, label: o.label, basis: o.basis, reviewed: done.has(`${o.kind}|${o.ref}|${o.authorKey}`) }));
  const open = list.filter((o) => !o.reviewed);
  const reason = open.length ? null : list.length ? "already_reviewed" : unconfirmed.length ? "not_confirmed" : "no_attendance";
  res.json({
    eligible: open.length > 0,
    reason,
    message: reason === null ? null : reason === "already_reviewed" ? "You've reviewed every visit you can." : reason === "not_confirmed" ? NOT_CONFIRMED : NOT_ELIGIBLE[listingType],
    occurrences: list,
    /** Past places that could be confirmed — the client links to the booking to ask. */
    unconfirmed: unconfirmed.map((u) => ({ kind: u.kind, ref: u.ref, date: u.date, label: u.label })),
  });
});

reviewsRouter.post("/", async (req, res) => {
  const who = reviewer(req);
  if (!who.clientId) return res.status(400).json({ error: "Missing X-Client-Id header" });
  const { listingType, listingId, name, rating, comment, occurrenceRef } = req.body as {
    listingType?: string;
    listingId?: string;
    name?: string;
    rating?: number;
    comment?: string;
    occurrenceRef?: string;
  };
  if (!listingType || !listingId || !name || !String(name).trim() || rating === undefined) {
    return res.status(400).json({ error: "listingType, listingId, name and rating are required" });
  }
  if (!isReviewSubject(listingType)) return res.status(400).json({ error: "This can't be reviewed" });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
  if (typeof comment === "string" && comment.length > MAX_COMMENT) return res.status(400).json({ error: `Keep your review under ${MAX_COMMENT} characters` });
  if (!(await listingExists(listingType, listingId))) return res.status(404).json({ error: "Listing not found" });
  if (await reviewsOwnSubject(listingType, listingId, who)) return res.status(403).json({ error: "You can't review something you run." });

  const { confirmed: occurrences, unconfirmed, guardianPlaces } = await reviewablePlaces(listingType, listingId, who);
  if (!occurrences.length) return res.status(403).json({ error: unconfirmed.length ? NOT_CONFIRMED : guardianPlaces ? GUARDIAN : NOT_ELIGIBLE[listingType] });
  // Without a named occurrence, the most recent one not yet reviewed (the
  // unique key still settles a race between two submits).
  let chosen = occurrenceRef ? occurrences.find((o) => o.ref === occurrenceRef) : undefined;
  if (!occurrenceRef) {
    const done = (await db
      .prepare(`SELECT occurrence_ref as ref, author_key as authorKey FROM reviews WHERE listing_type = ? AND occurrence_ref IN (${occurrences.map(() => "?").join(", ")})`)
      .all(listingType, ...occurrences.map((o) => o.ref))) as { ref: string; authorKey: string }[];
    chosen = occurrences.find((o) => !done.some((d) => d.ref === o.ref && d.authorKey === o.authorKey)) ?? occurrences[0];
  }
  if (!chosen) return res.status(403).json({ error: "You can't review that visit." });

  // Atomic one-review-per-visit: the claim's primary key and the review are
  // written in one transaction, so of two simultaneous submits exactly one
  // commits — with or without uq_review_occurrence (see initSchema()).
  try {
    const id = await db.transaction(async (tx) => {
      await tx
        .prepare(`INSERT INTO review_claims (claim_key, review_id) VALUES (?, 0)`)
        .run(reviewClaimKey(listingType, chosen!.kind, chosen!.ref, chosen!.authorKey));
      const info = await tx
        .prepare(
          `INSERT INTO reviews (listing_type, listing_id, client_id, resident_id, author_key, name, rating, comment, tags, occurrence_kind, occurrence_ref, occurrence_date, attendance_basis)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          listingType,
          listingId,
          who.clientId,
          who.residentId,
          chosen!.authorKey,
          String(name).trim().slice(0, MAX_NAME),
          rating,
          typeof comment === "string" ? comment.trim() : "",
          cleanTags((req.body as { tags?: unknown }).tags).join(","),
          chosen!.kind,
          chosen!.ref,
          chosen!.date,
          chosen!.basis
        );
      await tx
        .prepare(`UPDATE review_claims SET review_id = ? WHERE claim_key = ?`)
        .run(info.lastInsertRowid, reviewClaimKey(listingType, chosen!.kind, chosen!.ref, chosen!.authorKey));
      return info.lastInsertRowid;
    });
    const row = (await db.prepare(`SELECT r.*, ${verifiedSql("r")} as verified FROM reviews r WHERE r.id = ?`).get(id)) as ReviewRow;
    res.status(201).json(toReview(row, who));
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "You've already reviewed this visit. You can edit your review instead." });
    throw e;
  }
});

/** The author edits their own review (rating, words, tags). Moderated reviews stay hidden. */
reviewsRouter.put("/mine/:id", async (req, res) => {
  const who = reviewer(req);
  const row = (await db.prepare(`SELECT r.*, ${verifiedSql("r")} as verified FROM reviews r WHERE r.id = ?`).get(req.params.id)) as (ReviewRow & { hidden: number }) | undefined;
  if (!row || !isAuthor(row, who)) return res.status(404).json({ error: "Review not found" });
  // The same rule as posting: only a review whose visit is still confirmed
  // for its author can be changed. Older reviews can still be deleted.
  if (Number(row.verified) !== 1) return res.status(409).json({ error: "This review can't be edited because your attendance for that visit isn't confirmed. You can delete it.", notConfirmed: true });
  const { rating, comment, name } = req.body as { rating?: number; comment?: string; name?: string };
  if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
  if (typeof comment === "string" && comment.length > MAX_COMMENT) return res.status(400).json({ error: `Keep your review under ${MAX_COMMENT} characters` });
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: "Your name can't be empty" });
  const tags = (req.body as { tags?: unknown }).tags;
  await db
    .prepare(`UPDATE reviews SET rating = COALESCE(?, rating), comment = COALESCE(?, comment), name = COALESCE(?, name), tags = COALESCE(?, tags), updated_at = NOW() WHERE id = ?`)
    .run(
      rating ?? null,
      typeof comment === "string" ? comment.trim() : null,
      name !== undefined ? String(name).trim().slice(0, MAX_NAME) : null,
      tags !== undefined ? cleanTags(tags).join(",") : null,
      row.id
    );
  const updated = (await db.prepare(`SELECT r.*, ${verifiedSql("r")} as verified FROM reviews r WHERE r.id = ?`).get(row.id)) as ReviewRow;
  res.json(toReview(updated, who));
});

/** The author deletes their own review. Removed outright (it's their words); the audit row keeps only the fact. */
reviewsRouter.delete("/mine/:id", async (req, res) => {
  const who = reviewer(req);
  const row = (await db.prepare(`SELECT id, client_id, resident_id, listing_type as listingType, listing_id as listingId FROM reviews WHERE id = ?`).get(req.params.id)) as
    | { id: number; client_id: string; resident_id: string | null; listingType: string; listingId: string }
    | undefined;
  if (!row || !isAuthor(row, who)) return res.status(404).json({ error: "Review not found" });
  // Releases the visit's claim too, so the author can review it again.
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM review_claims WHERE review_id = ?`).run(row.id);
    await tx.prepare(`DELETE FROM reviews WHERE id = ?`).run(row.id);
  });
  await writeAudit({
    actorUserId: who.residentId ?? `client:${who.clientId}`,
    actorKind: who.residentId ? "resident" : "system",
    action: "review.deleted_by_author",
    objectType: "review",
    objectId: String(row.id),
    newValue: { listingType: row.listingType, listingId: row.listingId },
  });
  res.json({ ok: true });
});

// D-02: this only hides the review (reversible: PUT /api/admin/reviews/:id/unhide),
// so it is moderation, not a destructive delete. A reason is recorded.
reviewsRouter.delete("/:id", requireAdminPermission("reviews.moderate"), async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5) return res.status(400).json({ error: "Give the reason for hiding this review" });
  const info = await db
    .prepare(`UPDATE reviews SET hidden = 1, hidden_reason = ?, hidden_by = ?, hidden_at = NOW() WHERE id = ? AND hidden = 0`)
    .run(reason.slice(0, 1000), req.user!.id, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found, or already hidden" });
  await writeAudit({ actorUserId: req.user!.id, action: "review.hidden", objectType: "review", objectId: req.params.id, previousValue: { hidden: false }, newValue: { hidden: true }, reason });
  res.json({ ok: true });
});
