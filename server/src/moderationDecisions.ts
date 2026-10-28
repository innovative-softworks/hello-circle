import { db } from "./db/index.js";

// D-03 — moderation decision reasons and history (approved for local
// implementation, 2026-10-14; docs/hellocircle-operating-decisions.md).
//
// Every listing, partner, claim, host-application and place-suggestion
// decision is recorded here as its own row; rows are never edited (a later
// decision is a new row). Rejections and suspensions require a reason category
// and an explanation that the affected partner or applicant sees; a separate,
// optional internal note is stored for authorised admins only and is never
// returned by partner/applicant APIs, notifications or the audit log.
// Decisions made before this existed have no row; they show "No reason
// recorded" and nothing is back-filled.
//
// This is product policy. It doesn't claim to satisfy any particular legal
// requirement.

type Conn = Pick<typeof db, "prepare">;

export const REASON_CATEGORIES = {
  listing_rejection: {
    incomplete: "Incomplete details",
    misleading: "Misleading or inaccurate",
    ineligible: "Not an eligible activity",
    safety: "Safety concern",
    duplicate: "Duplicate listing",
    other: "Other",
  },
  suspension: {
    terms_breach: "Breach of terms",
    safety: "Safety concern",
    payment_risk: "Payment or fraud risk",
    legal_request: "Legal request",
    verification_failed: "Verification failed",
    other: "Other",
  },
  application_rejection: {
    incomplete: "Incomplete details",
    ineligible: "Doesn't meet the criteria",
    duplicate: "Duplicate",
    safety: "Safety concern",
    other: "Other",
  },
  // Trust & Retention batch 1 — declining or withdrawing a verification check.
  verification: {
    details_mismatch: "Details didn't match the record",
    insufficient_evidence: "Not enough information to confirm",
    no_longer_accurate: "No longer accurate",
    expired: "Check has expired",
    other: "Other",
  },
} as const;

export type ReasonKind = keyof typeof REASON_CATEGORIES;

export const EXPLANATION_MIN = 20;
export const EXPLANATION_MAX = 2000;
export const NOTE_MAX = 4000;

export interface DecisionReason {
  category: string;
  explanation: string;
  internalNote: string | null;
}

export type DecisionObjectType = "centre" | "club" | "experience" | "vendor" | "claim" | "host_application" | "place_suggestion" | "organisation" | "game" | "chat_message" | "verification_check";

/**
 * Reads `reasonCategory`, `explanation` and `internalNote` from a request
 * body. `required` → category and explanation must be present and valid.
 * Optional (e.g. reinstatement) → anything given is still validated.
 */
export function parseDecisionReason(
  body: unknown,
  kind: ReasonKind,
  required: boolean
): { ok: true; reason: DecisionReason | null } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const category = typeof b.reasonCategory === "string" ? b.reasonCategory.trim() : "";
  const explanation = typeof b.explanation === "string" ? b.explanation.trim() : "";
  const note = typeof b.internalNote === "string" ? b.internalNote.trim() : "";
  if (note.length > NOTE_MAX) return { ok: false, error: `The internal note can be at most ${NOTE_MAX} characters` };
  if (!required && !category && !explanation) {
    return { ok: true, reason: note ? { category: "", explanation: "", internalNote: note } : null };
  }
  const allowed = REASON_CATEGORIES[kind] as Record<string, string>;
  if (!category || !Object.prototype.hasOwnProperty.call(allowed, category)) {
    return { ok: false, error: `Choose a reason category (${Object.keys(allowed).join(", ")})` };
  }
  if (explanation.length < EXPLANATION_MIN) return { ok: false, error: `Write an explanation for them of at least ${EXPLANATION_MIN} characters` };
  if (explanation.length > EXPLANATION_MAX) return { ok: false, error: `Keep the explanation under ${EXPLANATION_MAX} characters` };
  return { ok: true, reason: { category, explanation, internalNote: note || null } };
}

export function categoryLabel(kind: ReasonKind, category: string | null | undefined): string | null {
  if (!category) return null;
  return (REASON_CATEGORIES[kind] as Record<string, string>)[category] ?? category;
}

/** Which category list a stored decision's category belongs to. */
function kindForAction(action: string): ReasonKind {
  if (action.startsWith("partner.")) return "suspension";
  if (action.startsWith("listing.")) return "listing_rejection";
  if (action.startsWith("verification.")) return "verification";
  return "application_rejection";
}

export async function recordDecision(
  conn: Conn,
  input: {
    objectType: DecisionObjectType;
    objectId: string;
    action: string;
    previousState: string | null;
    newState: string;
    reason: DecisionReason | null;
    actorUserId: string;
  }
): Promise<number> {
  const info = await conn
    .prepare(
      `INSERT INTO moderation_decisions (object_type, object_id, action, previous_state, new_state, reason_category, explanation, internal_note, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.objectType,
      input.objectId,
      input.action,
      input.previousState,
      input.newState,
      input.reason?.category || null,
      input.reason?.explanation || null,
      input.reason?.internalNote || null,
      input.actorUserId
    );
  return Number(info.lastInsertRowid);
}

export interface PublicDecision {
  id: number;
  action: string;
  newState: string;
  category: string | null;
  categoryLabel: string | null;
  explanation: string | null;
  decidedAt: string;
}

interface DecisionRow {
  id: number;
  action: string;
  previous_state: string | null;
  new_state: string;
  reason_category: string | null;
  explanation: string | null;
  internal_note: string | null;
  actor_user_id: string;
  actor_email: string | null;
  created_at: string;
}

const toPublic = (r: DecisionRow): PublicDecision => ({
  id: Number(r.id),
  action: r.action,
  newState: r.new_state,
  category: r.reason_category,
  categoryLabel: categoryLabel(kindForAction(r.action), r.reason_category),
  explanation: r.explanation,
  decidedAt: r.created_at,
});

/** The latest decision on an object, for the partner/applicant — never includes the internal note. */
export async function latestPublicDecision(objectType: DecisionObjectType, objectId: string, actions?: string[]): Promise<PublicDecision | null> {
  const filter = actions?.length ? ` AND action IN (${actions.map(() => "?").join(",")})` : "";
  const row = (await db
    .prepare(
      `SELECT id, action, previous_state, new_state, reason_category, explanation, NULL as internal_note, actor_user_id, NULL as actor_email, created_at
       FROM moderation_decisions WHERE object_type = ? AND object_id = ?${filter} ORDER BY id DESC LIMIT 1`
    )
    .get(objectType, objectId, ...(actions ?? []))) as DecisionRow | undefined;
  return row ? toPublic(row) : null;
}

/** Full history for admins. The internal note is included only when `includeNotes`. */
export async function decisionHistory(objectType: string, objectId: string, includeNotes: boolean) {
  const rows = (await db
    .prepare(
      `SELECT d.id, d.action, d.previous_state, d.new_state, d.reason_category, d.explanation, d.internal_note, d.actor_user_id, u.email as actor_email, d.created_at
       FROM moderation_decisions d LEFT JOIN users u ON u.id = d.actor_user_id
       WHERE d.object_type = ? AND d.object_id = ? ORDER BY d.id DESC LIMIT 100`
    )
    .all(objectType, objectId)) as DecisionRow[];
  return rows.map((r) => ({
    ...toPublic(r),
    previousState: r.previous_state,
    actorEmail: r.actor_email,
    ...(includeNotes ? { internalNote: r.internal_note } : {}),
  }));
}
