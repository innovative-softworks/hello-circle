// Revenue & Connect Stage 2a — partner plans (Free / Pro / Enterprise) and
// promotions (docs/revenue-connect/07).
//
// A partner's plan at instant T is the latest partner_plan_assignments row
// with effective_from <= T < effective_to (open-ended when NULL); with no row
// they are on Free. Plan prices, fee rates and features are NOT stored here —
// they are versioned rules (plan_free / plan_pro / entitlements_*) resolved at
// T, so a rate change never alters an order already priced (its snapshot keeps
// the resolved values). Assignments can only start now or in the future, so
// history is never rewritten.
//
// `fee_plan_key` lets an assignment carry one plan's features with another
// plan's commission — used by the founding-partner promotion (Pro features
// with the subscription waived, while the commission stays on Free rates by
// default: decision B12).

import { db } from "../db/index.js";
import { resolveRule, RuleError, type ResolvedRule } from "./rules.js";

type Tx = Pick<typeof db, "prepare">;

export const PLAN_KEYS = ["free", "pro", "enterprise"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PartnerKind = "org" | "vendor" | "host";

export interface PartnerKey {
  kind: PartnerKind;
  id: string;
}

export interface PlanAssignment {
  id: number | null;
  planKey: PlanKey;
  feePlanKey: PlanKey;
  source: "default" | "admin" | "subscription" | "promotion";
  sourceRef: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/** The plan in force for a partner at `at` (Free when nothing is assigned). */
export async function currentPlanFor(partner: PartnerKey, at: Date = new Date(), tx: Tx = db): Promise<PlanAssignment> {
  const row = (await tx
    .prepare(
      `SELECT id, plan_key as planKey, fee_plan_key as feePlanKey, source, source_ref as sourceRef, effective_from as effectiveFrom, effective_to as effectiveTo
       FROM partner_plan_assignments
       WHERE partner_kind = ? AND partner_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, id DESC LIMIT 1`
    )
    .get(partner.kind, partner.id, sqlTime(at), sqlTime(at))) as Record<string, unknown> | undefined;
  if (!row) return { id: null, planKey: "free", feePlanKey: "free", source: "default", sourceRef: null, effectiveFrom: null, effectiveTo: null };
  const planKey = row.planKey as PlanKey;
  return {
    id: Number(row.id),
    planKey,
    feePlanKey: ((row.feePlanKey as PlanKey | null) ?? planKey) as PlanKey,
    source: row.source as PlanAssignment["source"],
    sourceRef: (row.sourceRef as string | null) ?? null,
    effectiveFrom: iso(row.effectiveFrom),
    effectiveTo: iso(row.effectiveTo),
  };
}

export interface PlanTerms {
  assignment: PlanAssignment;
  /** Commission terms (from the fee plan). */
  fees: ResolvedRule;
  /** Feature set (from the plan itself). Enterprise has none until enabled. */
  entitlements: ResolvedRule | null;
}

function ruleCtx(partner: PartnerKey) {
  return { orgId: partner.kind === "org" ? partner.id : null, hostResidentId: partner.kind === "host" ? partner.id : null };
}

/** Resolves the commission and features a partner gets at `at`. Enterprise
 * is disabled for the MVP: resolving it fails closed. */
export async function planTermsFor(partner: PartnerKey, at: Date = new Date()): Promise<PlanTerms> {
  const assignment = await currentPlanFor(partner, at);
  if (assignment.feePlanKey === "enterprise" || assignment.planKey === "enterprise") throw new RuleError("The Enterprise plan isn't available yet", 409);
  const fees = await resolveRule(`plan_${assignment.feePlanKey}`, ruleCtx(partner), at);
  const entitlements = await resolveRule(`entitlements_${assignment.planKey}`, {}, at);
  return { assignment, fees, entitlements };
}

export async function hasEntitlement(partner: PartnerKey, feature: string, at: Date = new Date()): Promise<boolean> {
  const terms = await planTermsFor(partner, at);
  return terms.entitlements?.values[feature] === "included";
}

async function assertPartnerExists(partner: PartnerKey, tx: Tx) {
  const sql =
    partner.kind === "org"
      ? `SELECT id FROM organisations WHERE id = ?`
      : partner.kind === "vendor"
        ? `SELECT id FROM users WHERE id = ? AND role = 'vendor'`
        : `SELECT id FROM residents WHERE id = ? AND host_status = 'verified'`;
  if (!(await tx.prepare(sql).get(partner.id))) throw new RuleError("That partner doesn't exist", 404);
}

async function planEnabled(planKey: string, tx: Tx) {
  const row = (await tx.prepare(`SELECT status FROM pricing_plans WHERE plan_key = ?`).get(planKey)) as { status: string } | undefined;
  if (!row) throw new RuleError("Unknown plan", 400);
  if (row.status !== "active") throw new RuleError(`The ${planKey} plan isn't available`, 409);
}

export interface AssignInput {
  partner: PartnerKey;
  planKey: string;
  feePlanKey?: string | null;
  source: PlanAssignment["source"];
  sourceRef?: string | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  reason: string;
  actorId: string;
}

/** Starts a plan for a partner from `effectiveFrom` (now by default, never
 * in the past). The previously open assignment ends at the same instant, so
 * at most one assignment is in force at any time. Runs inside `tx` when
 * given (promotion enrollment uses its own transaction). */
export async function assignPlan(input: AssignInput, outer?: Tx): Promise<number> {
  const run = async (tx: Tx) => {
    if (!(PLAN_KEYS as readonly string[]).includes(input.planKey)) throw new RuleError("Unknown plan", 400);
    if (input.feePlanKey && !(PLAN_KEYS as readonly string[]).includes(input.feePlanKey)) throw new RuleError("Unknown fee plan", 400);
    if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RuleError("A reason (at least 5 characters) is required");
    await planEnabled(input.planKey, tx);
    if (input.feePlanKey) await planEnabled(input.feePlanKey, tx);
    await assertPartnerExists(input.partner, tx);
    const now = new Date();
    const from = input.effectiveFrom && input.effectiveFrom > now ? input.effectiveFrom : now;
    if (input.effectiveFrom && input.effectiveFrom.getTime() < now.getTime() - 60_000) throw new RuleError("A plan can't start in the past");
    if (input.effectiveTo && input.effectiveTo <= from) throw new RuleError("A plan must end after it starts");
    // Serialise per partner and close whatever is open at `from`.
    await tx.prepare(`SELECT id FROM partner_plan_assignments WHERE partner_kind = ? AND partner_id = ? FOR UPDATE`).all(input.partner.kind, input.partner.id);
    await tx
      .prepare(
        `UPDATE partner_plan_assignments SET effective_to = ?
         WHERE partner_kind = ? AND partner_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)`
      )
      .run(sqlTime(from), input.partner.kind, input.partner.id, sqlTime(from), sqlTime(from));
    const info = await tx
      .prepare(
        `INSERT INTO partner_plan_assignments (partner_kind, partner_id, plan_key, fee_plan_key, source, source_ref, effective_from, effective_to, created_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.partner.kind, input.partner.id, input.planKey, input.feePlanKey ?? null, input.source, input.sourceRef ?? null, sqlTime(from), input.effectiveTo ? sqlTime(input.effectiveTo) : null, input.actorId, input.reason.trim().slice(0, 2000));
    return Number(info.lastInsertRowid);
  };
  return outer ? run(outer) : db.transaction(run);
}

// --- promotions -------------------------------------------------------------

export interface CampaignInput {
  campaignKey: string;
  planKey: string;
  commissionPlanKey: string;
  benefitDays: number;
  maxEnrollments: number;
  startsAt: Date;
  endsAt: Date;
  terms: string;
}

export async function createCampaign(input: CampaignInput, actorId: string): Promise<number> {
  if (!/^[a-z0-9_-]{3,60}$/.test(input.campaignKey)) throw new RuleError("Campaign key: 3–60 lowercase letters, digits, - or _");
  if (!(PLAN_KEYS as readonly string[]).includes(input.planKey) || !(PLAN_KEYS as readonly string[]).includes(input.commissionPlanKey)) throw new RuleError("Unknown plan");
  if (!Number.isInteger(input.benefitDays) || input.benefitDays < 1 || input.benefitDays > 366) throw new RuleError("Benefit must be 1–366 days");
  if (!Number.isInteger(input.maxEnrollments) || input.maxEnrollments < 1 || input.maxEnrollments > 10_000) throw new RuleError("Maximum partners must be 1–10000");
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime()) || input.endsAt <= input.startsAt) throw new RuleError("The campaign must end after it starts");
  if (typeof input.terms !== "string" || input.terms.trim().length < 10) throw new RuleError("Campaign terms are required");
  try {
    const info = await db
      .prepare(
        `INSERT INTO promotion_campaigns (campaign_key, kind, plan_key, commission_plan_key, benefit_days, max_enrollments, starts_at, ends_at, status, terms, created_by)
         VALUES (?, 'plan_waiver', ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(input.campaignKey, input.planKey, input.commissionPlanKey, input.benefitDays, input.maxEnrollments, sqlTime(input.startsAt), sqlTime(input.endsAt), input.terms.trim(), actorId);
    return Number(info.lastInsertRowid);
  } catch (e) {
    if (e instanceof Error && /Duplicate/.test(e.message)) throw new RuleError("A campaign with that key already exists", 409);
    throw e;
  }
}

/** Enrols an approved partner: the campaign's plan for `benefit_days` from
 * now, with the campaign's commission plan. The cap is enforced under a lock
 * on the campaign row, so concurrent enrolments can't exceed it. */
export async function enrollInCampaign(campaignId: number, partner: PartnerKey, actorId: string, reason: string): Promise<{ enrollmentId: number; assignmentId: number }> {
  try {
    return await db.transaction(async (tx) => {
      const c = (await tx.prepare(`SELECT * FROM promotion_campaigns WHERE id = ? FOR UPDATE`).get(campaignId)) as Record<string, any> | undefined;
      if (!c) throw new RuleError("Campaign not found", 404);
      const now = new Date();
      if (c.status !== "active" || new Date(c.starts_at) > now || new Date(c.ends_at) <= now) throw new RuleError("This campaign isn't open for enrolment", 409);
      const { n } = (await tx.prepare(`SELECT COUNT(*) as n FROM promotion_enrollments WHERE campaign_id = ?`).get(campaignId)) as { n: number };
      if (Number(n) >= Number(c.max_enrollments)) throw new RuleError("This campaign is full", 409);
      const until = new Date(now.getTime() + Number(c.benefit_days) * 24 * 3600 * 1000);
      const assignmentId = await assignPlan(
        { partner, planKey: c.plan_key, feePlanKey: c.commission_plan_key, source: "promotion", sourceRef: c.campaign_key, effectiveTo: until, reason: `Promotion ${c.campaign_key}: ${reason}`, actorId },
        tx
      );
      const info = await tx
        .prepare(`INSERT INTO promotion_enrollments (campaign_id, partner_kind, partner_id, assignment_id, enrolled_by) VALUES (?, ?, ?, ?, ?)`)
        .run(campaignId, partner.kind, partner.id, assignmentId, actorId);
      return { enrollmentId: Number(info.lastInsertRowid), assignmentId };
    });
  } catch (e) {
    if (e instanceof Error && /Duplicate/.test(e.message)) throw new RuleError("This partner is already enrolled in the campaign", 409);
    throw e;
  }
}

/** Pro break-even (brief §5): monthly GMV at which the fee saving pays for
 * the subscription. Integer maths; returns null when Pro saves nothing. */
export function proBreakEvenMinor(freeRateBps: number, proRateBps: number, proMonthlyMinor: number): number | null {
  const diff = freeRateBps - proRateBps;
  if (diff <= 0) return null;
  return Math.ceil((proMonthlyMinor * 10_000) / diff);
}
