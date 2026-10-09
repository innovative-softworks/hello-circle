import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { db, getSetting, setSetting } from "../db/index.js";
import { CATEGORIES, COMMERCE_SWITCHES, RULE_KEYS, SCENARIOS, type ScopeType } from "../commerce/catalog.js";
import {
  RuleError,
  RuleResolutionError,
  approveDraft,
  createDraft,
  diffPayloads,
  discardDraft,
  endOverride,
  getRuleVersion,
  inForceIds,
  lifecycleOf,
  listRuleVersions,
  previewDraft,
  publishDraft,
  resolveRule,
  rollbackTo,
  secondApproverRequired,
  updateDraft,
  type Actor,
} from "../commerce/rules.js";

// Commerce Engine Phase 1 — admin-only commercial configuration. Mounted
// from admin.ts under /api/admin/commerce, so adminRouter's requireAdmin
// already applies to every route here. Every write needs a change reason and
// is audited inside the same transaction (commerce/rules.ts).
export const adminCommerceRouter = Router();

function actorOf(req: Request): Actor {
  return { userId: req.user!.id, correlationId: crypto.randomUUID() };
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new RuleError("Invalid rule version id", 404);
  return id;
}

async function handle(res: Response, fn: () => Promise<unknown>) {
  try {
    res.json(await fn());
  } catch (e) {
    if (e instanceof RuleError) return res.status(e.status).json({ error: e.message });
    if (e instanceof RuleResolutionError) return res.status(409).json({ error: e.message });
    throw e;
  }
}

adminCommerceRouter.get("/catalog", async (_req, res) => {
  const switches = await Promise.all(
    COMMERCE_SWITCHES.map(async (s) => ({ ...s, enabled: (await getSetting(s.key, s.defaultValue ? "true" : "false")) === "true" }))
  );
  res.json({ ruleKeys: Object.values(RULE_KEYS), scenarios: SCENARIOS, categories: CATEGORIES, switches, secondApproverRequired: await secondApproverRequired() });
});

adminCommerceRouter.get("/rules", async (req, res) => {
  const key = typeof req.query.key === "string" && RULE_KEYS[req.query.key] ? req.query.key : undefined;
  const [rows, active] = await Promise.all([listRuleVersions({ key }), inForceIds()]);
  res.json(rows.map((r) => ({ ...r, lifecycle: lifecycleOf(r, active), inForce: active.has(r.id) })));
});

adminCommerceRouter.get("/rules/:id", (req, res) =>
  handle(res, async () => {
    const row = await getRuleVersion(idParam(req));
    if (!row) throw new RuleError("Rule version not found", 404);
    const previous = row.previousVersionId ? await getRuleVersion(row.previousVersionId) : null;
    return { version: row, previous, changesFromPrevious: previous ? diffPayloads(row.ruleKey, previous.payload, row.payload) : [] };
  })
);

adminCommerceRouter.get("/rules/:id/diff/:otherId", (req, res) =>
  handle(res, async () => {
    const a = await getRuleVersion(idParam(req));
    const b = await getRuleVersion(Number(req.params.otherId));
    if (!a || !b) throw new RuleError("Rule version not found", 404);
    if (a.ruleKey !== b.ruleKey) throw new RuleError("Only versions of the same rule can be compared");
    return { from: a, to: b, changes: diffPayloads(a.ruleKey, a.payload, b.payload) };
  })
);

adminCommerceRouter.get("/rules/:id/preview", (req, res) => handle(res, () => previewDraft(idParam(req))));

adminCommerceRouter.post("/rules/drafts", (req, res) =>
  handle(res, () => {
    const b = req.body as { key?: string; scopeType?: ScopeType; scopeId?: string; payload?: unknown; reason?: unknown };
    return createDraft({ key: String(b.key ?? ""), scopeType: (b.scopeType ?? "global") as ScopeType, scopeId: String(b.scopeId ?? ""), payload: b.payload, reason: b.reason }, actorOf(req));
  })
);

adminCommerceRouter.put("/rules/:id", (req, res) => handle(res, () => updateDraft(idParam(req), req.body ?? {}, actorOf(req))));
adminCommerceRouter.post("/rules/:id/discard", (req, res) => handle(res, () => discardDraft(idParam(req), req.body ?? {}, actorOf(req))));
adminCommerceRouter.post("/rules/:id/approve", (req, res) => handle(res, () => approveDraft(idParam(req), req.body ?? {}, actorOf(req))));
adminCommerceRouter.post("/rules/:id/publish", (req, res) => handle(res, () => publishDraft(idParam(req), req.body ?? {}, actorOf(req))));
adminCommerceRouter.post("/rules/:id/end", (req, res) => handle(res, () => endOverride(idParam(req), req.body ?? {}, actorOf(req))));
adminCommerceRouter.post("/rules/:id/rollback", (req, res) => handle(res, () => rollbackTo(idParam(req), req.body ?? {}, actorOf(req))));

/** What a quote in this context would resolve to right now (or at ?at=). */
adminCommerceRouter.get("/resolve", (req, res) =>
  handle(res, async () => {
    const q = req.query as Record<string, string | undefined>;
    const key = q.key && RULE_KEYS[q.key] ? q.key : "pricing";
    const at = q.at ? new Date(q.at) : new Date();
    if (Number.isNaN(at.getTime())) throw new RuleError("Invalid date");
    return resolveRule(key, { scenario: q.scenario || null, category: q.category || null, orgId: q.orgId || null, hostResidentId: q.hostResidentId || null }, at);
  })
);

adminCommerceRouter.put("/switches/:key", async (req, res) => {
  const spec = COMMERCE_SWITCHES.find((s) => s.key === req.params.key);
  if (!spec) return res.status(404).json({ error: "Unknown switch" });
  const { enabled, reason } = req.body as { enabled?: unknown; reason?: unknown };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
  if (typeof reason !== "string" || reason.trim().length < 5) return res.status(400).json({ error: "A change reason (at least 5 characters) is required" });
  const before = (await getSetting(spec.key, spec.defaultValue ? "true" : "false")) === "true";
  await setSetting(spec.key, enabled ? "true" : "false");
  await db
    .prepare(
      `INSERT INTO audit_log (actor_user_id, actor_kind, action, object_type, object_id, previous_value, new_value, reason, correlation_id, environment)
       VALUES (?, 'user', 'commerce_switch.changed', 'commerce_switch', ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user!.id, spec.key, JSON.stringify(before), JSON.stringify(enabled), reason.trim().slice(0, 2000), crypto.randomUUID(), (process.env.APP_ENV || process.env.NODE_ENV || "development").slice(0, 20));
  res.json({ key: spec.key, enabled });
});

adminCommerceRouter.get("/audit", async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT a.id, a.actor_user_id as actorUserId, u.email as actorEmail, a.action, a.object_type as objectType, a.object_id as objectId,
              a.previous_value as previousValue, a.new_value as newValue, a.reason, a.correlation_id as correlationId, a.environment, a.created_at as createdAt
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.object_type IN ('commerce_rule', 'commerce_switch')
       ORDER BY a.id DESC LIMIT 200`
    )
    .all();
  res.json(rows);
});
