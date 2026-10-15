import { Router } from "express";
import { db } from "../db/index.js";
import {
  MANDATORY_PLACEHOLDERS,
  PolicyError,
  accept,
  acknowledge,
  createDraft,
  getDocument,
  getVersion,
  listDocuments,
  listVersions,
  pendingAcceptances,
  placeholderValues,
  companyProfile,
  publicCompanyDetails,
  placeholdersIn,
  editorialNotesIn,
  publicVersion,
  setPlaceholderValue,
  substitute,
  transition,
  updateDraft,
  type Subject,
} from "../policy/cms.js";
import { requireAdminPermission } from "../adminPermissions.js";

// Revenue & Connect Stage 4 — Policy Centre.
//   /api/policies               public: published documents, history, acceptance
//   /api/admin/policies         legal/super: drafts, workflow, placeholder values

export const policiesRouter = Router();

const KEY_RE = /^[a-z0-9-]{2,60}$/;

function handle(res: import("express").Response, e: unknown) {
  if (e instanceof PolicyError) return res.status(e.status).json({ error: e.message });
  throw e;
}

/** Every document, with its published version (if any). Drafts are never exposed. */
policiesRouter.get("/", async (_req, res) => {
  const docs = await listDocuments();
  res.json(docs.map((d) => ({ docKey: d.docKey, title: d.title, audience: d.audience, publishedVersion: d.publishedVersion, publishedAt: d.publishedAt })));
});

/** Company details for the public About and Contact pages — only fields
 * whose current value appears in a published (legally signed-off) policy;
 * a value that's merely set, or changed since publication, is left out (see
 * companyProfile() in policy/cms.ts). Registered before "/:key" so "company"
 * is never read as a document key. */
policiesRouter.get("/company", async (_req, res) => {
  res.json(await publicCompanyDetails());
});

/** Policies the signed-in partner and/or resident still have to accept. */
policiesRouter.get("/acceptance/pending", async (req, res) => {
  const out: { user: Awaited<ReturnType<typeof pendingAcceptances>>; resident: Awaited<ReturnType<typeof pendingAcceptances>> } = { user: [], resident: [] };
  if (req.user?.role === "vendor") out.user = await pendingAcceptances({ type: "user", id: req.user.id }, ["partner"]);
  if (req.resident) {
    const r = (await db.prepare(`SELECT host_status as hostStatus FROM residents WHERE id = ?`).get(req.resident.id)) as { hostStatus: string | null } | undefined;
    out.resident = await pendingAcceptances({ type: "resident", id: req.resident.id }, r?.hostStatus === "verified" ? ["resident", "host"] : ["resident"]);
  }
  res.json(out);
});

policiesRouter.post("/:key/accept", async (req, res) => {
  const { version, as, context } = req.body as { version?: number; as?: string; context?: string };
  if (!KEY_RE.test(req.params.key) || !Number.isInteger(Number(version))) return res.status(400).json({ error: "Policy and version are required" });
  let subject: Subject | null = null;
  if (as === "user" && req.user?.role === "vendor") subject = { type: "user", id: req.user.id };
  if (as === "resident" && req.resident) subject = { type: "resident", id: req.resident.id };
  if (!subject) return res.status(401).json({ error: "Sign in to accept" });
  try {
    res.json(await accept(subject, req.params.key, Number(version), typeof context === "string" ? context : "gate"));
  } catch (e) {
    handle(res, e);
  }
});

policiesRouter.post("/:key/acknowledge", async (req, res) => {
  const { version, as } = req.body as { version?: number; as?: string };
  if (!KEY_RE.test(req.params.key) || !Number.isInteger(Number(version))) return res.status(400).json({ error: "Policy and version are required" });
  let subject: Subject | null = null;
  if (as === "user" && req.user?.role === "vendor") subject = { type: "user", id: req.user.id };
  if (as === "resident" && req.resident) subject = { type: "resident", id: req.resident.id };
  if (!subject) return res.status(401).json({ error: "Sign in to continue" });
  try {
    res.json(await acknowledge(subject, req.params.key, Number(version), "policy_gate"));
  } catch (e) {
    handle(res, e);
  }
});

policiesRouter.get("/:key", async (req, res) => {
  if (!KEY_RE.test(req.params.key)) return res.status(404).json({ error: "Unknown policy" });
  const doc = await getDocument(req.params.key);
  if (!doc) return res.status(404).json({ error: "Unknown policy" });
  const version = req.query.version ? Number(req.query.version) : undefined;
  if (version !== undefined && !Number.isInteger(version)) return res.status(400).json({ error: "Invalid version" });
  const published = await publicVersion(req.params.key, version);
  // 200 with published: null (not 404) so the client can show "not yet published"
  res.json({ docKey: doc.docKey, title: doc.title, audience: doc.audience, published: published ?? null });
});

// --- admin ---------------------------------------------------------------------------

export const adminPoliciesRouter = Router();

const actorOf = (req: import("express").Request) => ({ userId: req.user!.id, role: req.user!.adminRole ?? null });

adminPoliciesRouter.get("/", requireAdminPermission("policies.manage"), async (_req, res) => {
  const [docs, values] = await Promise.all([listDocuments(), placeholderValues()]);
  res.json({
    documents: docs,
    placeholders: MANDATORY_PLACEHOLDERS.map((p) => ({ placeholder: p, value: values.get(p) ?? null })),
    extraValues: [...values.entries()].filter(([k]) => !(MANDATORY_PLACEHOLDERS as readonly string[]).includes(k)).map(([placeholder, value]) => ({ placeholder, value })),
  });
});

/** Company profile completeness for the admin checklist: every field with
 * its value and whether it's missing, set but not yet in a published
 * policy, or published (and so shown on the public pages). */
adminPoliciesRouter.get("/company-profile", requireAdminPermission("policies.manage"), async (_req, res) => {
  res.json(await companyProfile());
});

adminPoliciesRouter.put("/placeholders/:name", requireAdminPermission("policies.manage"), async (req, res) => {
  try {
    await setPlaceholderValue(req.params.name, String(req.body?.value ?? ""), actorOf(req), String(req.body?.reason ?? ""));
    res.json({ ok: true });
  } catch (e) {
    handle(res, e);
  }
});

adminPoliciesRouter.get("/:key/versions", requireAdminPermission("policies.manage"), async (req, res) => {
  if (!(await getDocument(req.params.key))) return res.status(404).json({ error: "Unknown policy" });
  res.json(await listVersions(req.params.key));
});

adminPoliciesRouter.post("/:key/drafts", requireAdminPermission("policies.manage"), async (req, res) => {
  try {
    res.json({ id: await createDraft(req.params.key, actorOf(req), req.body ?? {}) });
  } catch (e) {
    handle(res, e);
  }
});

/** The version's text with current placeholder values substituted, plus what still blocks publishing. */
adminPoliciesRouter.get("/versions/:id/preview", requireAdminPermission("policies.manage"), async (req, res) => {
  const v = await getVersion(Number(req.params.id));
  if (!v) return res.status(404).json({ error: "Policy version not found" });
  const rendered = v.publishedBody ?? substitute(v.body, await placeholderValues());
  res.json({ ...v, rendered, blockers: { placeholders: placeholdersIn(rendered), notes: editorialNotesIn(rendered), legalReview: !v.legalReviewedAt } });
});

adminPoliciesRouter.put("/versions/:id", requireAdminPermission("policies.manage"), async (req, res) => {
  try {
    await updateDraft(Number(req.params.id), actorOf(req), req.body ?? {});
    res.json({ ok: true });
  } catch (e) {
    handle(res, e);
  }
});

const ACTIONS = ["submit", "approve", "reject", "legal_signoff", "publish", "discard"] as const;

adminPoliciesRouter.post("/versions/:id/:action", requireAdminPermission("policies.manage"), async (req, res) => {
  const action = req.params.action as (typeof ACTIONS)[number];
  if (!ACTIONS.includes(action)) return res.status(404).json({ error: "Unknown action" });
  try {
    res.json(await transition(Number(req.params.id), action, actorOf(req), req.body ?? {}));
  } catch (e) {
    handle(res, e);
  }
});
