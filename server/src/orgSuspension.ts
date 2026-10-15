import { db } from "./db/index.js";
import { writeAudit } from "./audit.js";
import { recordDecision, type DecisionReason } from "./moderationDecisions.js";
import { NEXT_STEPS, notifyPartner } from "./moderationNotify.js";
import { paymentProvider } from "./payments/provider.js";
import type { AuthedUser } from "./auth.js";

// D-01 — suspending and reinstating an organisation, and the read-only
// obligations a suspended organisation's members can still see.
// See orgStatus.ts for ownership and the checks that enforce a suspension.

/** Today's date in YYYY-MM-DD (server UTC; good enough for "upcoming"). */
const today = () => new Date().toISOString().slice(0, 10);

/** Supply the organisation owns, by type: ids of listings whose member is in the org. */
const ORG_MEMBER = `(SELECT id FROM users WHERE org_id = ?)`;

export interface OrgSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  statusChangedAt: string | null;
  members: { id: string; name: string; email: string; status: string; platformRole: string | null; invitedStaff: boolean }[];
  listings: { type: string; status: string; n: number }[];
  upcoming: { bookings: number; registrations: number; enrolments: number; experienceBookings: number; passes: number; total: number };
}

export async function orgSummary(orgId: string): Promise<OrgSummary | null> {
  const org = (await db.prepare(`SELECT id, name, kind, status, status_changed_at AS statusChangedAt FROM organisations WHERE id = ?`).get(orgId)) as
    | { id: string; name: string; kind: string; status: string; statusChangedAt: string | null }
    | undefined;
  if (!org) return null;
  const members = (await db
    .prepare(`SELECT id, name, email, status, platform_role AS platformRole, invited_staff AS invitedStaff FROM users WHERE org_id = ? ORDER BY invited_staff, created_at`)
    .all(orgId)) as { id: string; name: string; email: string; status: string; platformRole: string | null; invitedStaff: number }[];
  const listings: { type: string; status: string; n: number }[] = [];
  for (const [type, table] of [["centre", "centres"], ["club", "clubs"], ["experience", "experiences"], ["programme", "programs"]] as const) {
    const rows = (await db.prepare(`SELECT status, COUNT(*) AS n FROM ${table} WHERE vendor_id IN ${ORG_MEMBER} GROUP BY status`).all(orgId)) as { status: string; n: number }[];
    for (const r of rows) listings.push({ type, status: r.status, n: Number(r.n) });
  }
  const counts = await upcomingCounts(orgId);
  return { ...org, members: members.map((m) => ({ ...m, invitedStaff: !!m.invitedStaff })), listings, upcoming: counts };
}

async function upcomingCounts(orgId: string) {
  const d = today();
  const n = async (sql: string, ...p: unknown[]) => Number(((await db.prepare(sql).get(...p)) as { n: number }).n);
  const bookings = await n(
    `SELECT COUNT(*) AS n FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN ${ORG_MEMBER} AND b.date >= ? AND b.status != 'cancelled' AND b.payment_status IN ('paid','pending')`,
    orgId, d
  );
  const registrations = await n(
    `SELECT COUNT(*) AS n FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN ${ORG_MEMBER} AND r.status != 'cancelled' AND r.payment_status IN ('paid','pending')`,
    orgId
  );
  const enrolments = await n(
    `SELECT COUNT(*) AS n FROM program_enrollments e JOIN programs p ON p.id = e.program_id WHERE p.vendor_id IN ${ORG_MEMBER} AND e.status != 'cancelled' AND e.payment_status IN ('paid','pending') AND p.status != 'archived'`,
    orgId
  );
  const experienceBookings = await n(
    `SELECT COUNT(*) AS n FROM experience_bookings b JOIN experience_sessions s ON s.id = b.session_id JOIN experiences x ON x.id = b.experience_id WHERE x.vendor_id IN ${ORG_MEMBER} AND s.date >= ? AND b.status != 'cancelled' AND b.payment_status IN ('paid','pending')`,
    orgId, d
  );
  const passes = await n(
    `SELECT COUNT(*) AS n FROM passes p JOIN clubs c ON c.id = p.listing_id AND p.listing_type = 'club' WHERE c.vendor_id IN ${ORG_MEMBER} AND p.payment_status = 'paid' AND p.credits_used < p.credits_total`,
    orgId
  );
  return { bookings, registrations, enrolments, experienceBookings, passes, total: bookings + registrations + enrolments + experienceBookings + passes };
}

export type SuspensionResult =
  | { ok: true; changed: false; status: string }
  | { ok: true; changed: true; status: string; decisionId: number; previous: string }
  | { ok: false; status: 404 };

/** Suspend (status "suspended") or reinstate (status "active"). Idempotent:
 * re-sending the current status changes nothing. The organisation row lock
 * serialises this with every sale (sales take a shared lock on the same row). */
export async function setOrgStatus(orgId: string, next: "suspended" | "active", reason: DecisionReason | null, actor: AuthedUser): Promise<SuspensionResult> {
  const result = await db.transaction(async (tx) => {
    const org = (await tx.prepare(`SELECT status FROM organisations WHERE id = ? FOR UPDATE`).get(orgId)) as { status: string } | undefined;
    if (!org) return null;
    if (org.status === next) return { changed: false as const, status: org.status };
    const decisionId = await recordDecision(tx, {
      objectType: "organisation",
      objectId: orgId,
      action: next === "suspended" ? "org.suspended" : "org.reinstated",
      previousState: org.status,
      newState: next,
      reason,
      actorUserId: actor.id,
    });
    await tx.prepare(`UPDATE organisations SET status = ?, status_changed_at = NOW(), status_decision_id = ? WHERE id = ?`).run(next, decisionId, orgId);
    return { changed: true as const, status: next, decisionId, previous: org.status };
  });
  if (!result) return { ok: false, status: 404 };
  if (!result.changed) return { ok: true, changed: false, status: result.status };

  await writeAudit({
    actorUserId: actor.id,
    action: next === "suspended" ? "organisation.suspended" : "organisation.reinstated",
    objectType: "organisation",
    objectId: orgId,
    previousValue: { status: result.previous },
    newValue: { status: next, decisionId: result.decisionId, ...(reason?.category ? { reasonCategory: reason.category } : {}) },
  });
  void notifyMembers(orgId, next, reason);
  if (next === "suspended") void expireOpenCheckouts(orgId);
  return { ok: true, changed: true, status: next, decisionId: result.decisionId, previous: result.previous };
}

async function notifyMembers(orgId: string, next: "suspended" | "active", reason: DecisionReason | null) {
  const members = (await db.prepare(`SELECT id FROM users WHERE org_id = ? AND role = 'vendor'`).all(orgId)) as { id: string }[];
  for (const m of members) {
    if (next === "suspended") {
      await notifyPartner(m.id, {
        title: "Your organisation has been suspended on HelloCircle",
        intro:
          "Your organisation has been suspended on HelloCircle. Its listings are hidden and can't take new bookings, and the Partner workspace is read-only until it's reinstated. Existing bookings aren't cancelled or refunded by this — you can still see your upcoming obligations when you sign in.",
        kind: "suspension",
        reason,
        nextSteps: NEXT_STEPS.suspension,
      });
    } else {
      await notifyPartner(m.id, {
        title: "Your organisation has been reinstated on HelloCircle",
        intro: `Your organisation has been reinstated. Listings that were live before the suspension are visible and bookable again; drafts, paused and rejected listings are unchanged.${reason?.explanation ? `\n\n${reason.explanation}` : ""}`,
        kind: "suspension",
        reason: null,
        nextSteps: "",
      });
    }
  }
}

/** Best effort, after the suspension is committed: expire open checkout
 * sessions on the organisation's pending orders so no new payment can be
 * taken. A payment that completes anyway is caught at confirmation and
 * parked for finance review (stripeWebhook.ts). Never throws. */
async function expireOpenCheckouts(orgId: string) {
  const provider = paymentProvider();
  if (!provider) return;
  const rows = (await db
    .prepare(
      `SELECT b.stripe_session_id AS sid FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN ${ORG_MEMBER} AND b.payment_status = 'pending' AND b.stripe_session_id IS NOT NULL
       UNION ALL SELECT r.stripe_session_id FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN ${ORG_MEMBER} AND r.payment_status = 'pending' AND r.stripe_session_id IS NOT NULL
       UNION ALL SELECT e.stripe_session_id FROM program_enrollments e JOIN programs p ON p.id = e.program_id WHERE p.vendor_id IN ${ORG_MEMBER} AND e.payment_status = 'pending' AND e.stripe_session_id IS NOT NULL
       UNION ALL SELECT b.stripe_session_id FROM experience_bookings b JOIN experiences x ON x.id = b.experience_id WHERE x.vendor_id IN ${ORG_MEMBER} AND b.payment_status = 'pending' AND b.stripe_session_id IS NOT NULL
       UNION ALL SELECT p.stripe_session_id FROM passes p JOIN clubs c ON c.id = p.listing_id AND p.listing_type = 'club' WHERE c.vendor_id IN ${ORG_MEMBER} AND p.payment_status = 'pending' AND p.stripe_session_id IS NOT NULL`
    )
    .all(orgId, orgId, orgId, orgId, orgId)) as { sid: string }[];
  for (const { sid } of rows) {
    try {
      if ((await provider.checkoutSessionStatus(sid)) === "open") await provider.expireCheckoutSession(sid);
    } catch (e) {
      console.error("[org-suspension] couldn't expire a checkout session:", e instanceof Error ? e.message : e);
    }
  }
}

// --- read-only obligations for a suspended organisation's members ----------

/** Roles that see per-booking detail in the workspace today (the Bookings tab):
 * the owner, both manager roles and finance. Other roles see the schedule-level
 * view they already have (date, listing, count) — never customer details. */
const DETAIL_ROLES = ["centre_manager", "facility_manager", "finance"];
export const canSeeObligationDetail = (u: Pick<AuthedUser, "invitedStaff" | "platformRole">) => !u.invitedStaff || (!!u.platformRole && DETAIL_ROLES.includes(u.platformRole));

export interface Obligation {
  kind: "booking" | "registration" | "enrolment" | "experience";
  listing: string;
  date: string | null;
  time: string | null;
  /** Detail roles only. */
  ref?: string;
  customerFirstName?: string;
  paymentState?: string;
}

export async function orgObligations(orgId: string, detail: boolean): Promise<{ items: Obligation[]; summary: { date: string | null; listing: string; count: number }[] }> {
  const d = today();
  const firstName = (full: string | null) => (full ?? "").trim().split(/\s+/)[0] ?? "";
  const rows: Obligation[] = [];
  const bookings = (await db
    .prepare(
      `SELECT b.ref, c.name AS listing, b.date, b.time, b.name, b.payment_status AS ps FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id IN ${ORG_MEMBER} AND b.date >= ? AND b.status != 'cancelled' AND b.payment_status IN ('paid','pending') ORDER BY b.date, b.time LIMIT 200`
    )
    .all(orgId, d)) as { ref: string; listing: string; date: string; time: string; name: string; ps: string }[];
  for (const r of bookings) rows.push({ kind: "booking", listing: r.listing, date: r.date, time: r.time, ref: r.ref, customerFirstName: firstName(r.name), paymentState: r.ps });
  const regs = (await db
    .prepare(
      `SELECT r.ref, c.name AS listing, r.g_first AS first, r.payment_status AS ps FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id IN ${ORG_MEMBER} AND r.status != 'cancelled' AND r.payment_status IN ('paid','pending') ORDER BY r.created_at LIMIT 200`
    )
    .all(orgId)) as { ref: string; listing: string; first: string; ps: string }[];
  for (const r of regs) rows.push({ kind: "registration", listing: r.listing, date: null, time: null, ref: r.ref, customerFirstName: firstName(r.first), paymentState: r.ps });
  const enrols = (await db
    .prepare(
      `SELECT e.ref, p.title AS listing, e.participant_name AS name, e.payment_status AS ps FROM program_enrollments e JOIN programs p ON p.id = e.program_id
       WHERE p.vendor_id IN ${ORG_MEMBER} AND e.status != 'cancelled' AND e.payment_status IN ('paid','pending') AND p.status != 'archived' ORDER BY e.created_at LIMIT 200`
    )
    .all(orgId)) as { ref: string; listing: string; name: string; ps: string }[];
  for (const r of enrols) rows.push({ kind: "enrolment", listing: r.listing, date: null, time: null, ref: r.ref, customerFirstName: firstName(r.name), paymentState: r.ps });
  const exps = (await db
    .prepare(
      `SELECT b.ref, x.title AS listing, s.date, s.time, b.participant_name AS name, b.payment_status AS ps FROM experience_bookings b
       JOIN experience_sessions s ON s.id = b.session_id JOIN experiences x ON x.id = b.experience_id
       WHERE x.vendor_id IN ${ORG_MEMBER} AND s.date >= ? AND b.status != 'cancelled' AND b.payment_status IN ('paid','pending') ORDER BY s.date, s.time LIMIT 200`
    )
    .all(orgId, d)) as { ref: string; listing: string; date: string; time: string; name: string; ps: string }[];
  for (const r of exps) rows.push({ kind: "experience", listing: r.listing, date: r.date, time: r.time, ref: r.ref, customerFirstName: firstName(r.name), paymentState: r.ps });

  const summaryMap = new Map<string, { date: string | null; listing: string; count: number }>();
  for (const r of rows) {
    const k = `${r.date ?? ""}|${r.listing}`;
    const cur = summaryMap.get(k) ?? { date: r.date, listing: r.listing, count: 0 };
    cur.count++;
    summaryMap.set(k, cur);
  }
  const summary = [...summaryMap.values()];
  if (!detail) return { items: [], summary };
  return { items: rows, summary };
}
