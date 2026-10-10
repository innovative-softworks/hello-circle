// Commerce Engine — versioned commercial rules (Phase 1).
//
// Storage: commerce_rule_versions (db/index.ts). Each (rule_key, scope_type,
// scope_id) has its own timeline of versions. A version is created as a
// draft, optionally approved by a second admin, then published with an
// effective_from that can never be in the past — so publishing can only ever
// change the future, never re-price history. Published rows are immutable
// except for effective_to, which ends a narrower-scope override.
//
// Resolution at instant T, for each scope that applies to a quote:
//   the published version at that scope with the latest effective_from <= T
//   (ties: higher version) is the one in force; if its effective_to <= T the
//   scope contributes nothing — an older version never silently comes back.
// Values are merged field-by-field from least to most specific:
//   global → scenario → category → partner (org, then host).
// A global version must always resolve; if not, resolution fails closed.

import { db } from "../db/index.js";
import { commerceSwitch } from "./switches.js";
import { RULE_KEYS, SCOPE_ORDER, canonicalHash, scopeIdError, validatePayload, type ScopeType } from "./catalog.js";
import { priceBreakdown, type PricingValues } from "./money.js";

type Tx = Pick<typeof db, "prepare">;

export type RuleStatus = "draft" | "review" | "approved" | "published" | "retired" | "discarded";

export interface RuleVersionRow {
  id: number;
  ruleKey: string;
  scopeType: ScopeType;
  scopeId: string;
  version: number;
  status: RuleStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  currency: string;
  payload: Record<string, number | string>;
  payloadHash: string;
  previousVersionId: number | null;
  createdBy: string;
  reviewedBy: string | null;
  approvedBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  changeReason: string;
  createdAt: string;
}

export class RuleError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export class RuleResolutionError extends Error {}

export interface ResolveContext {
  scenario?: string | null;
  category?: string | null;
  orgId?: string | null;
  hostResidentId?: string | null;
}

export interface ResolvedRule {
  key: string;
  values: Record<string, number | string>;
  sources: { id: number; scopeType: ScopeType; scopeId: string; version: number }[];
  /** sha256 of the canonical merged values — stored on snapshots. */
  hash: string;
  resolvedAt: string;
}

const SELECT_COLUMNS = `id, rule_key as ruleKey, scope_type as scopeType, scope_id as scopeId, version, status,
  effective_from as effectiveFrom, effective_to as effectiveTo, currency, payload, payload_hash as payloadHash,
  previous_version_id as previousVersionId, created_by as createdBy, reviewed_by as reviewedBy, approved_by as approvedBy, published_by as publishedBy,
  published_at as publishedAt, change_reason as changeReason, created_at as createdAt`;

function toRow(raw: Record<string, unknown>): RuleVersionRow {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return {
    ...(raw as unknown as RuleVersionRow),
    payload: JSON.parse(String(raw.payload)),
    effectiveFrom: iso(raw.effectiveFrom),
    effectiveTo: iso(raw.effectiveTo),
    publishedAt: iso(raw.publishedAt),
    createdAt: iso(raw.createdAt)!,
  };
}

export { canonicalHash };

/** MySQL DATETIME literal (UTC — the pool runs with timezone "Z"). */
function sqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function scopesFor(ctx: ResolveContext): { scopeType: ScopeType; scopeId: string }[] {
  const scopes: { scopeType: ScopeType; scopeId: string }[] = [{ scopeType: "global", scopeId: "" }];
  if (ctx.scenario) scopes.push({ scopeType: "scenario", scopeId: ctx.scenario });
  if (ctx.category) scopes.push({ scopeType: "category", scopeId: ctx.category });
  if (ctx.orgId) scopes.push({ scopeType: "partner", scopeId: `org:${ctx.orgId}` });
  if (ctx.hostResidentId) scopes.push({ scopeType: "partner", scopeId: `host:${ctx.hostResidentId}` });
  return scopes;
}

/** The published version in force at `at` for one scope, or null. */
async function inForce(tx: Tx, key: string, scopeType: ScopeType, scopeId: string, at: Date): Promise<RuleVersionRow | null> {
  const raw = (await tx
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM commerce_rule_versions
       WHERE rule_key = ? AND scope_type = ? AND scope_id = ? AND status = 'published' AND effective_from <= ?
       ORDER BY effective_from DESC, version DESC LIMIT 1`
    )
    .get(key, scopeType, scopeId, sqlTime(at))) as Record<string, unknown> | undefined;
  if (!raw) return null;
  const row = toRow(raw);
  if (row.effectiveTo && new Date(row.effectiveTo) <= at) return null;
  return row;
}

/** Resolves the commercial values for `key` in force at `at`. Fails closed
 * (throws RuleResolutionError) if no global version is in force. Pass
 * `override` to preview a draft as if it were published at its scope. */
export async function resolveRule(key: string, ctx: ResolveContext = {}, at: Date = new Date(), opts: { tx?: Tx; override?: RuleVersionRow } = {}): Promise<ResolvedRule> {
  const tx = opts.tx ?? db;
  if (!RULE_KEYS[key]) throw new RuleResolutionError(`Unknown rule "${key}"`);
  const values: Record<string, number | string> = {};
  const sources: ResolvedRule["sources"] = [];
  const scopes = scopesFor(ctx).sort((a, b) => SCOPE_ORDER.indexOf(a.scopeType) - SCOPE_ORDER.indexOf(b.scopeType));
  for (const scope of scopes) {
    const draft = opts.override;
    const row = draft && draft.ruleKey === key && draft.scopeType === scope.scopeType && draft.scopeId === scope.scopeId ? draft : await inForce(tx, key, scope.scopeType, scope.scopeId, at);
    if (!row) {
      if (scope.scopeType === "global") throw new RuleResolutionError(`No published global "${key}" rule is in force`);
      continue;
    }
    Object.assign(values, row.payload);
    sources.push({ id: row.id, scopeType: row.scopeType, scopeId: row.scopeId, version: row.version });
  }
  // Stage 5f — a field added to a rule after its versions were published takes the
  // catalog's v1 default until a version sets it (rules with every field are unchanged).
  const spec = RULE_KEYS[key];
  for (const f of Object.keys(spec.fields)) if (!(f in values) && spec.v1[f] !== undefined) values[f] = spec.v1[f];
  const check = validatePayload(key, "global", values);
  if (!check.ok) throw new RuleResolutionError(`Resolved "${key}" rule is invalid: ${check.errors.join("; ")}`);
  return { key, values, sources, hash: canonicalHash(values), resolvedAt: at.toISOString() };
}

// --- audit (written inside the same transaction as the change) ------------

export interface Actor {
  userId: string;
  correlationId: string;
  /** Admin sub-role at the time of the change (audit_log.actor_role). */
  role?: string | null;
}

async function auditTx(tx: Tx, actor: Actor, action: string, objectId: string, previousValue: unknown, newValue: unknown, reason: string) {
  await tx
    .prepare(
      `INSERT INTO audit_log (actor_user_id, actor_kind, actor_role, action, object_type, object_id, previous_value, new_value, reason, correlation_id, environment)
       VALUES (?, 'user', ?, ?, 'commerce_rule', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      actor.userId,
      actor.role ?? null,
      action,
      objectId,
      previousValue === undefined ? null : JSON.stringify(previousValue),
      newValue === undefined ? null : JSON.stringify(newValue),
      reason,
      actor.correlationId,
      (process.env.APP_ENV || process.env.NODE_ENV || "development").slice(0, 20)
    );
}

function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 5) throw new RuleError("A change reason (at least 5 characters) is required");
  return reason.trim().slice(0, 2000);
}

async function lockRow(tx: Tx, id: number): Promise<RuleVersionRow> {
  const raw = (await tx.prepare(`SELECT ${SELECT_COLUMNS} FROM commerce_rule_versions WHERE id = ? FOR UPDATE`).get(id)) as Record<string, unknown> | undefined;
  if (!raw) throw new RuleError("Rule version not found", 404);
  return toRow(raw);
}

async function partnerExists(scopeId: string): Promise<boolean> {
  const [kind, id] = [scopeId.slice(0, scopeId.indexOf(":")), scopeId.slice(scopeId.indexOf(":") + 1)];
  const sql = kind === "org" ? `SELECT id FROM organisations WHERE id = ?` : `SELECT id FROM residents WHERE id = ? AND host_status = 'verified'`;
  return !!(await db.prepare(sql).get(id));
}

export async function secondApproverRequired(): Promise<boolean> {
  return commerceSwitch("commerce.require_second_approver");
}

// --- reads ------------------------------------------------------------------

export async function listRuleVersions(filter: { key?: string } = {}): Promise<RuleVersionRow[]> {
  const rows = (await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM commerce_rule_versions ${filter.key ? "WHERE rule_key = ?" : ""} ORDER BY rule_key, scope_type, scope_id, version DESC`)
    .all(...(filter.key ? [filter.key] : []))) as Record<string, unknown>[];
  return rows.map(toRow);
}

export async function getRuleVersion(id: number): Promise<RuleVersionRow | null> {
  const raw = (await db.prepare(`SELECT ${SELECT_COLUMNS} FROM commerce_rule_versions WHERE id = ?`).get(id)) as Record<string, unknown> | undefined;
  return raw ? toRow(raw) : null;
}

/** Derived lifecycle label for display: draft | approved | scheduled | active | ended | superseded | discarded. */
export function lifecycleOf(row: RuleVersionRow, inForceIds: Set<number>, now = new Date()): string {
  if (row.status !== "published") return row.status;
  if (row.effectiveFrom && new Date(row.effectiveFrom) > now) return "scheduled";
  if (inForceIds.has(row.id)) return "active";
  if (row.effectiveTo && new Date(row.effectiveTo) <= now) return "ended";
  return "superseded";
}

/** Ids of every version currently in force at its own scope. */
export async function inForceIds(at = new Date()): Promise<Set<number>> {
  const scopes = (await db
    .prepare(`SELECT DISTINCT rule_key as ruleKey, scope_type as scopeType, scope_id as scopeId FROM commerce_rule_versions WHERE status = 'published'`)
    .all()) as { ruleKey: string; scopeType: ScopeType; scopeId: string }[];
  const ids = new Set<number>();
  for (const s of scopes) {
    const row = await inForce(db, s.ruleKey, s.scopeType, s.scopeId, at);
    if (row) ids.add(row.id);
  }
  return ids;
}

// --- writes -----------------------------------------------------------------

export async function createDraft(input: { key: string; scopeType: ScopeType; scopeId: string; payload: unknown; reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  const scopeId = input.scopeType === "global" ? "" : String(input.scopeId ?? "");
  const scopeErr = scopeIdError(input.scopeType, scopeId);
  if (scopeErr) throw new RuleError(scopeErr);
  const check = validatePayload(input.key, input.scopeType, input.payload);
  if (!check.ok) throw new RuleError(check.errors.join("; "));
  if (input.scopeType === "partner" && !(await partnerExists(scopeId))) throw new RuleError("That organisation or verified host doesn't exist");
  const payload = input.payload as Record<string, number | string>;
  try {
    return await db.transaction(async (tx) => {
      // Serialise version numbering per scope (gap lock on the unique index).
      const max = (await tx
        .prepare(`SELECT MAX(version) as v FROM commerce_rule_versions WHERE rule_key = ? AND scope_type = ? AND scope_id = ? FOR UPDATE`)
        .get(input.key, input.scopeType, scopeId)) as { v: number | null };
      const current = await inForce(tx, input.key, input.scopeType, scopeId, new Date());
      const version = Number(max.v ?? 0) + 1;
      const info = await tx
        .prepare(
          `INSERT INTO commerce_rule_versions (rule_key, scope_type, scope_id, version, status, payload, payload_hash, previous_version_id, created_by, change_reason)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .run(input.key, input.scopeType, scopeId, version, JSON.stringify(payload), canonicalHash(payload), current?.id ?? null, actor.userId, reason);
      const id = Number(info.lastInsertRowid);
      await auditTx(tx, actor, "commerce_rule.draft_created", String(id), current ? { id: current.id, version: current.version, payload: current.payload } : undefined, { key: input.key, scopeType: input.scopeType, scopeId, version, payload }, reason);
      return lockRow(tx, id);
    });
  } catch (e) {
    if (e instanceof Error && /Duplicate/.test(e.message)) throw new RuleError("Someone else just created a version for this rule — reload and try again", 409);
    throw e;
  }
}

export async function updateDraft(id: number, input: { payload: unknown; reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!EDITABLE.includes(row.status)) throw new RuleError("Only a draft can be edited — create a new version instead", 409);
    const check = validatePayload(row.ruleKey, row.scopeType, input.payload);
    if (!check.ok) throw new RuleError(check.errors.join("; "));
    const payload = input.payload as Record<string, number | string>;
    // Editing an approved draft voids the approval — the approver approved the old values.
    await tx
      .prepare(`UPDATE commerce_rule_versions SET payload = ?, payload_hash = ?, status = 'draft', reviewed_by = NULL, approved_by = NULL, change_reason = ? WHERE id = ?`)
      .run(JSON.stringify(payload), canonicalHash(payload), reason, id);
    await auditTx(tx, actor, "commerce_rule.draft_updated", String(id), row.payload, payload, reason);
    return lockRow(tx, id);
  });
}

export async function discardDraft(id: number, input: { reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!EDITABLE.includes(row.status)) throw new RuleError("Only a draft can be discarded", 409);
    await tx.prepare(`UPDATE commerce_rule_versions SET status = 'discarded' WHERE id = ?`).run(id);
    await auditTx(tx, actor, "commerce_rule.draft_discarded", String(id), { status: row.status }, { status: "discarded" }, reason);
    return lockRow(tx, id);
  });
}

/** Statuses a version can still be edited/discarded/published from. */
const EDITABLE: RuleStatus[] = ["draft", "review", "approved"];

/** Draft → review: the author asks for review (brief §17 step 2). Any admin
 * can review; recording who reviewed is separate from who approves. */
export async function submitForReview(id: number, input: { reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.status !== "draft") throw new RuleError("Only a draft can be sent for review", 409);
    await tx.prepare(`UPDATE commerce_rule_versions SET status = 'review' WHERE id = ?`).run(id);
    await auditTx(tx, actor, "commerce_rule.submitted_for_review", String(id), { status: "draft" }, { status: "review" }, reason);
    return lockRow(tx, id);
  });
}

/** Published → retired (brief §17 step 6). A retired version never resolves
 * again. The global version in force can't be retired (publish a
 * replacement); an override in force is ended at the same moment. */
export async function retireVersion(id: number, input: { reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  const now = new Date();
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.status !== "published") throw new RuleError("Only a published version can be retired", 409);
    const current = await inForce(tx, row.ruleKey, row.scopeType, row.scopeId, now);
    if (row.scopeType === "global" && current?.id === row.id) throw new RuleError("The global version in force can't be retired — publish a replacement first", 409);
    if (row.effectiveFrom && new Date(row.effectiveFrom) > now) {
      // A scheduled version that never took effect: retiring it simply cancels it.
    } else if (current?.id === row.id && !row.effectiveTo) {
      await tx.prepare(`UPDATE commerce_rule_versions SET effective_to = ? WHERE id = ?`).run(sqlTime(now), id);
    }
    await tx.prepare(`UPDATE commerce_rule_versions SET status = 'retired' WHERE id = ?`).run(id);
    await auditTx(tx, actor, "commerce_rule.retired", String(id), { status: "published" }, { status: "retired" }, reason);
    return lockRow(tx, id);
  });
}

export async function approveDraft(id: number, input: { reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.status !== "draft" && row.status !== "review") throw new RuleError("Only a draft or a version in review can be approved", 409);
    if (row.createdBy === actor.userId) throw new RuleError("A different admin must approve this change", 403);
    await tx.prepare(`UPDATE commerce_rule_versions SET status = 'approved', approved_by = ? WHERE id = ?`).run(actor.userId, id);
    await auditTx(tx, actor, "commerce_rule.approved", String(id), { status: row.status }, { status: "approved", payloadHash: row.payloadHash }, reason);
    return lockRow(tx, id);
  });
}

/** Publishes a draft. `effectiveFrom` defaults to now and may not be in the
 * past (a one-minute clock-skew allowance), so history is never re-priced. */
export async function publishDraft(id: number, input: { reason: unknown; effectiveFrom?: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  const now = new Date();
  let effectiveFrom = now;
  if (input.effectiveFrom !== undefined && input.effectiveFrom !== null && input.effectiveFrom !== "") {
    effectiveFrom = new Date(String(input.effectiveFrom));
    if (Number.isNaN(effectiveFrom.getTime())) throw new RuleError("Effective date isn't a valid date/time");
    if (effectiveFrom.getTime() < now.getTime() - 60_000) throw new RuleError("A rule can't take effect in the past — that would change historical pricing");
    if (effectiveFrom < now) effectiveFrom = now;
  }
  const needsSecond = await secondApproverRequired();
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (!EDITABLE.includes(row.status)) throw new RuleError("Only a draft can be published", 409);
    if (needsSecond && (row.status !== "approved" || !row.approvedBy || row.approvedBy === row.createdBy)) {
      throw new RuleError("This change needs approval from a second admin before it can be published", 403);
    }
    const check = validatePayload(row.ruleKey, row.scopeType, row.payload);
    if (!check.ok) throw new RuleError(check.errors.join("; "));
    if (canonicalHash(row.payload) !== row.payloadHash) throw new RuleError("Stored values don't match their hash — refusing to publish", 409);
    await tx
      .prepare(
        `UPDATE commerce_rule_versions SET status = 'published', effective_from = ?, published_at = ?, published_by = ?, approved_by = COALESCE(approved_by, ?) WHERE id = ?`
      )
      .run(sqlTime(effectiveFrom), sqlTime(now), actor.userId, actor.userId, id);
    const replaced = await inForce(tx, row.ruleKey, row.scopeType, row.scopeId, effectiveFrom > now ? effectiveFrom : now);
    await auditTx(tx, actor, "commerce_rule.published", String(id), { status: row.status }, { status: "published", effectiveFrom: effectiveFrom.toISOString(), payload: row.payload, replacesInForceId: replaced && replaced.id !== id ? replaced.id : null }, reason);
    return lockRow(tx, id);
  });
}

/** Ends a narrower-scope override (partner/scenario/category) at `effectiveTo`
 * (default now); resolution then falls back to the wider scope. A global rule
 * can't be ended — publish a replacement version instead. */
export async function endOverride(id: number, input: { reason: unknown; effectiveTo?: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  const now = new Date();
  let effectiveTo = now;
  if (input.effectiveTo !== undefined && input.effectiveTo !== null && input.effectiveTo !== "") {
    effectiveTo = new Date(String(input.effectiveTo));
    if (Number.isNaN(effectiveTo.getTime())) throw new RuleError("End date isn't a valid date/time");
    if (effectiveTo.getTime() < now.getTime() - 60_000) throw new RuleError("An override can't be ended in the past");
    if (effectiveTo < now) effectiveTo = now;
  }
  return db.transaction(async (tx) => {
    const row = await lockRow(tx, id);
    if (row.status !== "published") throw new RuleError("Only a published override can be ended", 409);
    if (row.scopeType === "global") throw new RuleError("The global rule can't be ended — publish a new version instead", 409);
    if (row.effectiveTo && new Date(row.effectiveTo) <= now) throw new RuleError("This override has already ended", 409);
    await tx.prepare(`UPDATE commerce_rule_versions SET effective_to = ? WHERE id = ?`).run(sqlTime(effectiveTo), id);
    await auditTx(tx, actor, "commerce_rule.override_ended", String(id), { effectiveTo: row.effectiveTo }, { effectiveTo: effectiveTo.toISOString() }, reason);
    return lockRow(tx, id);
  });
}

/** Rollback = a NEW version carrying an earlier published version's values.
 * History is never rewritten. Published immediately unless a second approver
 * is required, in which case it is left as a draft awaiting approval. */
export async function rollbackTo(id: number, input: { reason: unknown }, actor: Actor): Promise<RuleVersionRow> {
  const reason = requireReason(input.reason);
  const source = await getRuleVersion(id);
  if (!source) throw new RuleError("Rule version not found", 404);
  if (source.status !== "published") throw new RuleError("You can only roll back to a version that was published", 409);
  const draft = await createDraft({ key: source.ruleKey, scopeType: source.scopeType, scopeId: source.scopeId, payload: source.payload, reason: `Rollback to v${source.version}: ${reason}` }, actor);
  if (await secondApproverRequired()) return draft;
  return publishDraft(draft.id, { reason: `Rollback to v${source.version}: ${reason}` }, actor);
}

export interface FieldDiff {
  field: string;
  label: string;
  from: number | string | null;
  to: number | string | null;
}

export function diffPayloads(key: string, from: Record<string, unknown>, to: Record<string, unknown>): FieldDiff[] {
  const spec = RULE_KEYS[key];
  const fields = Object.keys(spec?.fields ?? {});
  return fields
    .filter((f) => (from[f] ?? null) !== (to[f] ?? null))
    .map((f) => ({ field: f, label: spec.fields[f].label, from: (from[f] as number | string | undefined) ?? null, to: (to[f] as number | string | undefined) ?? null }));
}

// --- impact preview -----------------------------------------------------------

const SAMPLE_LIST_PRICES = [1_000, 2_500, 5_000, 10_000, 25_000];

/** Re-prices sample amounts and recent real paid orders under the values in
 * force now vs. with this draft applied. Pricing rule only (the only rule
 * whose change moves money directly); other keys return the value diff. */
export async function previewDraft(id: number) {
  const draft = await getRuleVersion(id);
  if (!draft) throw new RuleError("Rule version not found", 404);
  const ctx: ResolveContext = {
    scenario: draft.scopeType === "scenario" ? draft.scopeId : null,
    category: draft.scopeType === "category" ? draft.scopeId : null,
    orgId: draft.scopeType === "partner" && draft.scopeId.startsWith("org:") ? draft.scopeId.slice(4) : null,
    hostResidentId: draft.scopeType === "partner" && draft.scopeId.startsWith("host:") ? draft.scopeId.slice(5) : null,
  };
  const current = await resolveRule(draft.ruleKey, ctx);
  const proposed = await resolveRule(draft.ruleKey, ctx, new Date(), { override: draft });
  const changes = diffPayloads(draft.ruleKey, current.values, proposed.values);
  if (draft.ruleKey !== "pricing") return { ruleKey: draft.ruleKey, context: ctx, changes, samples: [], recentOrders: [] };

  const cur = current.values as unknown as PricingValues;
  const next = proposed.values as unknown as PricingValues;
  const samples = SAMPLE_LIST_PRICES.map((listMinor) => {
    const input = { listMinor, discountMinor: 0, depositMinor: 0 };
    return { listMinor, current: priceBreakdown(input, cur), proposed: priceBreakdown(input, next) };
  });

  // Recent paid online orders with a stored breakdown. subtotal_cents holds
  // the post-discount amount on these tables (risk register R12), so the list
  // price is subtotal + discount; anything left over in total is the deposit.
  const recent = (await db
    .prepare(
      `SELECT * FROM (
         SELECT 'booking' as kind, ref, subtotal_cents as s, discount_cents as d, vat_cents as v, platform_fee_cents as f, total_cents as t, created_at as createdAt
         FROM bookings WHERE payment_status = 'paid' AND stripe_session_id IS NOT NULL
         UNION ALL
         SELECT 'registration', ref, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, total_cents, created_at
         FROM registrations WHERE payment_status = 'paid' AND stripe_session_id IS NOT NULL
         UNION ALL
         SELECT 'experience', ref, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, total_cents, created_at
         FROM experience_bookings WHERE payment_status = 'paid' AND stripe_session_id IS NOT NULL
       ) recent ORDER BY createdAt DESC LIMIT 25`
    )
    .all()) as { kind: string; ref: string; s: number; d: number; v: number; f: number; t: number }[];
  const recentOrders = recent.map((o) => {
    const deposit = Math.max(0, Number(o.t) - Number(o.s) - Number(o.v) - Number(o.f));
    const input = { listMinor: Number(o.s) + Number(o.d), discountMinor: Number(o.d), depositMinor: deposit };
    const p = priceBreakdown(input, next);
    return { kind: o.kind, ref: o.ref, chargedMinor: Number(o.t), proposedCustomerPaidMinor: p.customerPaidMinor, proposedPartnerPayoutMinor: p.partnerPayoutMinor, proposedPlatformRevenueMinor: p.platformRevenueMinor };
  });
  return { ruleKey: draft.ruleKey, context: ctx, changes, samples, recentOrders };
}
