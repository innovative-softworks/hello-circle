import crypto from "node:crypto";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { secondApproverRequired } from "../commerce/rules.js";
import { recordConsent } from "../consent.js";

// Revenue & Connect Stage 4 — policy CMS workflow (brief §20).
//
//   draft → review → approved → (legal sign-off) → published → retired
//
// Publication is refused while the text still has an unresolved
// [[PLACEHOLDER]] (after substituting the admin-entered values) or an
// editorial note in square brackets, and until a named legal reviewer has
// signed the version off. The published text is frozen at publish time
// (published_body + SHA-256), so editing a placeholder value later never
// changes what someone accepted. Nothing here claims legal compliance: it
// only makes sure that unreviewed drafts don't go public.

export class PolicyError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export interface PolicyActor {
  userId: string;
  role?: string | null;
}

export const MANDATORY_PLACEHOLDERS = [
  "LEGAL_ENTITY_NAME",
  "TRADING_NAME",
  "COMPANY_NUMBER",
  "VAT_NUMBER",
  "REGISTERED_ADDRESS",
  "SUPPORT_EMAIL",
  "LEGAL_EMAIL",
  "PRIVACY_EMAIL",
  "PHONE_NUMBER",
  "STRIPE_ACCOUNT_COUNTRY",
  "GOVERNING_LAW",
  "COURT_JURISDICTION",
  "DATA_RETENTION_PERIOD",
  "MINIMUM_USER_AGE",
] as const;

const PLACEHOLDER_RE = /\[\[([A-Z0-9_]{2,60})\]\]/g;
const MAX_BODY = 200_000;

export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

/** Square-bracket editorial notes ("[notice period — legal review required]")
 * that aren't Markdown links. A published policy must not contain any. */
export function editorialNotesIn(body: string): string[] {
  const withoutPlaceholders = body.replace(PLACEHOLDER_RE, "");
  return [...withoutPlaceholders.matchAll(/\[([^\]\n]+)\](?!\()/g)].map((m) => m[1]);
}

export function substitute(body: string, values: Map<string, string>): string {
  return body.replace(PLACEHOLDER_RE, (whole, key: string) => values.get(key) ?? whole);
}

export async function placeholderValues(): Promise<Map<string, string>> {
  const rows = (await db.prepare(`SELECT placeholder, value FROM policy_values`).all()) as { placeholder: string; value: string }[];
  return new Map(rows.map((r) => [r.placeholder, r.value]));
}

/** What still blocks publishing this text. Empty = publishable. */
export async function publicationBlockers(body: string): Promise<{ placeholders: string[]; notes: string[] }> {
  const rendered = substitute(body, await placeholderValues());
  return { placeholders: placeholdersIn(rendered), notes: editorialNotesIn(rendered) };
}

const hash = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// --- reads ----------------------------------------------------------------------------

export interface PolicyVersionRow {
  id: number;
  docKey: string;
  version: number;
  status: string;
  body: string;
  publishedBody: string | null;
  contentHash: string | null;
  changeSummary: string | null;
  material: number;
  effectiveFrom: string | null;
  createdBy: string;
  approvedBy: string | null;
  legalReviewerName: string | null;
  legalReviewedAt: string | null;
  publishedAt: string | null;
  retiredAt: string | null;
  rowVersion: number;
  createdAt: string;
}

const VERSION_FIELDS = `id, doc_key as docKey, version, status, body, published_body as publishedBody, content_hash as contentHash,
  change_summary as changeSummary, material, effective_from as effectiveFrom, created_by as createdBy, approved_by as approvedBy,
  legal_reviewer_name as legalReviewerName, legal_reviewed_at as legalReviewedAt, published_at as publishedAt, retired_at as retiredAt,
  row_version as rowVersion, created_at as createdAt`;

export async function listDocuments() {
  return db
    .prepare(
      `SELECT d.doc_key as docKey, d.title, d.audience, d.acceptance_audience as acceptanceAudience, d.sort_order as sortOrder,
        (SELECT MAX(version) FROM policy_versions v WHERE v.doc_key = d.doc_key) as latestVersion,
        (SELECT status FROM policy_versions v WHERE v.doc_key = d.doc_key ORDER BY version DESC LIMIT 1) as latestStatus,
        (SELECT version FROM policy_versions v WHERE v.doc_key = d.doc_key AND v.status = 'published' LIMIT 1) as publishedVersion,
        (SELECT published_at FROM policy_versions v WHERE v.doc_key = d.doc_key AND v.status = 'published' LIMIT 1) as publishedAt
       FROM policy_documents d ORDER BY d.sort_order, d.doc_key`
    )
    .all() as Promise<
    {
      docKey: string;
      title: string;
      audience: string;
      acceptanceAudience: string | null;
      sortOrder: number;
      latestVersion: number;
      latestStatus: string;
      publishedVersion: number | null;
      publishedAt: string | null;
    }[]
  >;
}

export async function getDocument(docKey: string) {
  return db.prepare(`SELECT doc_key as docKey, title, audience, acceptance_audience as acceptanceAudience FROM policy_documents WHERE doc_key = ?`).get(docKey) as Promise<
    { docKey: string; title: string; audience: string; acceptanceAudience: string | null } | undefined
  >;
}

export async function listVersions(docKey: string): Promise<PolicyVersionRow[]> {
  return (await db.prepare(`SELECT ${VERSION_FIELDS} FROM policy_versions WHERE doc_key = ? ORDER BY version DESC`).all(docKey)) as PolicyVersionRow[];
}

export async function getVersion(id: number): Promise<PolicyVersionRow | undefined> {
  return (await db.prepare(`SELECT ${VERSION_FIELDS} FROM policy_versions WHERE id = ?`).get(id)) as PolicyVersionRow | undefined;
}

/** The public view: the published version, or a specific published/retired
 * version for the history. Drafts are never served publicly. */
export async function publicVersion(docKey: string, version?: number) {
  const row = (await db
    .prepare(
      `SELECT version, status, published_body as body, content_hash as contentHash, change_summary as changeSummary, effective_from as effectiveFrom,
        published_at as publishedAt, retired_at as retiredAt, legal_reviewed_at as legalReviewedAt
       FROM policy_versions WHERE doc_key = ? AND ${version ? "version = ? AND status IN ('published','retired')" : "status = 'published'"} LIMIT 1`
    )
    .get(...(version ? [docKey, version] : [docKey]))) as
    | { version: number; status: string; body: string; contentHash: string; changeSummary: string | null; effectiveFrom: string | null; publishedAt: string; retiredAt: string | null; legalReviewedAt: string }
    | undefined;
  if (!row) return undefined;
  const history = (await db
    .prepare(`SELECT version, status, change_summary as changeSummary, published_at as publishedAt, retired_at as retiredAt FROM policy_versions WHERE doc_key = ? AND status IN ('published','retired') ORDER BY version DESC`)
    .all(docKey)) as { version: number; status: string; changeSummary: string | null; publishedAt: string; retiredAt: string | null }[];
  return { ...row, history };
}

// --- workflow ---------------------------------------------------------------------------

async function lockVersion(tx: Pick<typeof db, "prepare">, id: number) {
  const row = (await tx.prepare(`SELECT ${VERSION_FIELDS} FROM policy_versions WHERE id = ? FOR UPDATE`).get(id)) as PolicyVersionRow | undefined;
  if (!row) throw new PolicyError("Policy version not found", 404);
  return row;
}

function checkReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim().length < 5) throw new PolicyError("A reason (at least 5 characters) is required");
  return reason.trim();
}

function checkBody(body: unknown): string {
  if (typeof body !== "string" || !body.trim()) throw new PolicyError("The policy text is required");
  if (body.length > MAX_BODY) throw new PolicyError("The policy text is too long");
  if (body.includes("\0")) throw new PolicyError("The policy text contains invalid characters");
  return body;
}

/** New draft version, copied from the latest version's text unless a body is given. */
export async function createDraft(docKey: string, actor: PolicyActor, input: { body?: string; changeSummary?: string; reason: string }) {
  const reason = checkReason(input.reason);
  const id = await db.transaction(async (tx) => {
    const doc = await tx.prepare(`SELECT doc_key FROM policy_documents WHERE doc_key = ? FOR UPDATE`).get(docKey);
    if (!doc) throw new PolicyError("Unknown policy", 404);
    const open = await tx.prepare(`SELECT id FROM policy_versions WHERE doc_key = ? AND status IN ('draft','review','approved') LIMIT 1`).get(docKey);
    if (open) throw new PolicyError("This policy already has a version in progress — edit that one", 409);
    const latest = (await tx.prepare(`SELECT version, body FROM policy_versions WHERE doc_key = ? ORDER BY version DESC LIMIT 1`).get(docKey)) as { version: number; body: string } | undefined;
    const body = input.body !== undefined ? checkBody(input.body) : latest?.body ?? "";
    const r = await tx
      .prepare(`INSERT INTO policy_versions (doc_key, version, status, body, change_summary, created_by) VALUES (?, ?, 'draft', ?, ?, ?)`)
      .run(docKey, (latest?.version ?? 0) + 1, body, input.changeSummary?.trim().slice(0, 2000) || null, actor.userId);
    return Number(r.lastInsertRowid);
  });
  await writeAudit({ actorUserId: actor.userId, action: "policy.draft_created", objectType: "policy_version", objectId: String(id), newValue: { docKey }, reason });
  return id;
}

export async function updateDraft(id: number, actor: PolicyActor, input: { body: string; changeSummary?: string; material?: boolean; rowVersion: number }) {
  const body = checkBody(input.body);
  await db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    if (v.status !== "draft") throw new PolicyError("Only a draft can be edited — send it back to draft first", 409);
    if (Number(input.rowVersion) !== v.rowVersion) throw new PolicyError("Someone else changed this draft — reload before saving", 409);
    await tx
      .prepare(`UPDATE policy_versions SET body = ?, change_summary = ?, material = ?, row_version = row_version + 1 WHERE id = ?`)
      .run(body, input.changeSummary?.trim().slice(0, 2000) || null, input.material === undefined ? v.material : input.material ? 1 : 0, id);
  });
  await writeAudit({ actorUserId: actor.userId, action: "policy.draft_updated", objectType: "policy_version", objectId: String(id) });
}

type Transition = "submit" | "approve" | "reject" | "legal_signoff" | "publish" | "discard";

export async function transition(
  id: number,
  action: Transition,
  actor: PolicyActor,
  input: { reason: string; reviewerName?: string; effectiveFrom?: string; material?: boolean }
) {
  const reason = checkReason(input.reason);
  const result = await db.transaction(async (tx) => {
    const v = await lockVersion(tx, id);
    const set = async (sql: string, ...params: unknown[]) => tx.prepare(`UPDATE policy_versions SET ${sql}, row_version = row_version + 1 WHERE id = ?`).run(...params, id);
    switch (action) {
      case "submit":
        if (v.status !== "draft") throw new PolicyError("Only a draft can be sent for review", 409);
        await set(`status = 'review', submitted_by = ?`, actor.userId);
        return { status: "review" };
      case "reject":
        if (v.status !== "review" && v.status !== "approved") throw new PolicyError("Only a version in review or approved can be sent back", 409);
        await set(`status = 'draft', approved_by = NULL, approved_at = NULL, legal_reviewer_name = NULL, legal_reviewed_by = NULL, legal_reviewed_at = NULL`);
        return { status: "draft" };
      case "approve":
        if (v.status !== "review") throw new PolicyError("Only a version in review can be approved", 409);
        if ((await secondApproverRequired()) && v.createdBy === actor.userId) throw new PolicyError("A second admin must approve a version they didn't write", 403);
        await set(`status = 'approved', approved_by = ?, approved_at = NOW()`, actor.userId);
        return { status: "approved" };
      case "legal_signoff": {
        if (v.status !== "approved") throw new PolicyError("Legal sign-off happens after approval", 409);
        if (actor.role !== "legal" && actor.role !== "super") throw new PolicyError("Only a legal (or super) admin can record legal sign-off", 403);
        const name = (input.reviewerName ?? "").trim();
        if (name.length < 3) throw new PolicyError("Give the name of the legal reviewer who approved this text");
        await set(`legal_reviewer_name = ?, legal_reviewed_by = ?, legal_reviewed_at = NOW()`, name.slice(0, 160), actor.userId);
        return { status: "approved", legalReviewed: true };
      }
      case "publish": {
        if (v.status !== "approved") throw new PolicyError("Only an approved version can be published", 409);
        if (!v.legalReviewedAt) throw new PolicyError("Legal review required: record the legal reviewer's sign-off before publishing", 409);
        const values = new Map((((await tx.prepare(`SELECT placeholder, value FROM policy_values`).all()) as { placeholder: string; value: string }[]).map((r) => [r.placeholder, r.value])));
        const rendered = substitute(v.body, values);
        const missing = placeholdersIn(rendered);
        if (missing.length) throw new PolicyError(`Fill in these placeholders before publishing: ${missing.join(", ")}`, 409);
        const notes = editorialNotesIn(rendered);
        if (notes.length) throw new PolicyError(`Remove the editorial notes in square brackets before publishing: ${notes.slice(0, 3).join(" · ")}`, 409);
        const effective = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
        if (Number.isNaN(effective.getTime())) throw new PolicyError("Effective date isn't valid");
        const firstPublish = !(await tx.prepare(`SELECT id FROM policy_versions WHERE doc_key = ? AND status IN ('published','retired') LIMIT 1`).get(v.docKey));
        const material = firstPublish || input.material === true || (input.material === undefined && v.material === 1);
        await tx.prepare(`UPDATE policy_versions SET status = 'retired', retired_at = NOW() WHERE doc_key = ? AND status = 'published'`).run(v.docKey);
        await set(
          `status = 'published', published_body = ?, content_hash = ?, material = ?, effective_from = ?, published_by = ?, published_at = NOW()`,
          rendered,
          hash(rendered),
          material ? 1 : 0,
          effective,
          actor.userId
        );
        return { status: "published", material, contentHash: hash(rendered) };
      }
      case "discard":
        if (v.status !== "draft") throw new PolicyError("Only a draft can be discarded", 409);
        await tx.prepare(`DELETE FROM policy_versions WHERE id = ? AND status = 'draft'`).run(id);
        return { status: "discarded" };
    }
  });
  await writeAudit({ actorUserId: actor.userId, action: `policy.${action}`, objectType: "policy_version", objectId: String(id), newValue: result, reason });
  return result;
}

export async function setPlaceholderValue(placeholder: string, value: string, actor: PolicyActor, reason: string) {
  const why = checkReason(reason);
  if (!/^[A-Z0-9_]{2,60}$/.test(placeholder)) throw new PolicyError("Invalid placeholder name");
  const v = value.trim();
  if (!v || v.length > 500) throw new PolicyError("Value must be 1–500 characters");
  if (/\[\[|\]\]/.test(v)) throw new PolicyError("A value can't contain another placeholder");
  const prev = (await db.prepare(`SELECT value FROM policy_values WHERE placeholder = ?`).get(placeholder)) as { value: string } | undefined;
  await db.prepare(`INSERT INTO policy_values (placeholder, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`).run(placeholder, v, actor.userId);
  await writeAudit({ actorUserId: actor.userId, action: "policy.placeholder_set", objectType: "policy_value", objectId: placeholder, previousValue: prev?.value, newValue: v, reason: why });
}

// --- acceptance --------------------------------------------------------------------------

export type Subject = { type: "user" | "resident"; id: string };

/** Policies the subject must (re-)accept: for each published document aimed
 * at one of their audiences, the newest material published version that
 * they haven't accepted (accepting a later version also counts). */
export async function pendingAcceptances(subject: Subject, audiences: string[]) {
  if (!audiences.length) return [];
  audiences = [...audiences, "all"];
  const rows = (await db
    .prepare(
      `SELECT d.doc_key as docKey, d.title, d.acceptance_kind as kind, p.version, p.effective_from as effectiveFrom, p.change_summary as changeSummary,
        (SELECT MAX(m.version) FROM policy_versions m WHERE m.doc_key = d.doc_key AND m.status IN ('published','retired') AND m.material = 1) as requiredVersion
       FROM policy_documents d JOIN policy_versions p ON p.doc_key = d.doc_key AND p.status = 'published'
       WHERE d.acceptance_audience IN (${audiences.map(() => "?").join(",")})
       ORDER BY d.sort_order`
    )
    .all(...audiences)) as { docKey: string; title: string; kind: string; version: number; effectiveFrom: string | null; changeSummary: string | null; requiredVersion: number | null }[];
  const out = [];
  for (const r of rows) {
    const need = Number(r.requiredVersion ?? r.version);
    // Stage 5c — a contract is accepted (policy_acceptances); the privacy notice
    // is acknowledged (consent_records privacy_notice_ack). Neither counts as the other.
    const done =
      r.kind === "acknowledge"
        ? await db
            .prepare(`SELECT id FROM consent_records WHERE subject_type = ? AND subject_id = ? AND purpose = 'privacy_notice_ack' AND granted = 1 AND policy_doc_key = ? AND policy_version >= ? LIMIT 1`)
            .get(subject.type, subject.id, r.docKey, need)
        : await db.prepare(`SELECT id FROM policy_acceptances WHERE doc_key = ? AND subject_type = ? AND subject_id = ? AND version >= ? LIMIT 1`).get(r.docKey, subject.type, subject.id, need);
    if (!done) out.push({ docKey: r.docKey, title: r.title, kind: r.kind === "acknowledge" ? ("acknowledge" as const) : ("accept" as const), version: Number(r.version), effectiveFrom: r.effectiveFrom, changeSummary: r.changeSummary });
  }
  return out;
}

/** Stage 5c — records that the subject has read the current privacy notice (an acknowledgement, not consent or acceptance). */
export async function acknowledge(subject: Subject, docKey: string, version: number, source: string) {
  const doc = (await db.prepare(`SELECT acceptance_kind as kind FROM policy_documents WHERE doc_key = ?`).get(docKey)) as { kind: string } | undefined;
  if (!doc) throw new PolicyError("Unknown policy", 404);
  if (doc.kind !== "acknowledge") throw new PolicyError("This document is accepted, not acknowledged", 400);
  const current = (await db.prepare(`SELECT version FROM policy_versions WHERE doc_key = ? AND status = 'published'`).get(docKey)) as { version: number } | undefined;
  if (!current) throw new PolicyError("That policy isn't published", 404);
  if (Number(current.version) !== Number(version)) throw new PolicyError("That version has been replaced — please read the current version", 409);
  await recordConsent(subject, "privacy_notice_ack", true, source, { docKey, version: Number(version) });
  return { docKey, version: Number(version) };
}

export async function accept(subject: Subject, docKey: string, version: number, context: string) {
  const kind = (await db.prepare(`SELECT acceptance_kind as kind FROM policy_documents WHERE doc_key = ?`).get(docKey)) as { kind: string } | undefined;
  if (kind?.kind === "acknowledge") throw new PolicyError("The privacy notice is acknowledged, not accepted — use acknowledge", 400);
  const current = (await db.prepare(`SELECT version FROM policy_versions WHERE doc_key = ? AND status = 'published'`).get(docKey)) as { version: number } | undefined;
  if (!current) throw new PolicyError("That policy isn't published", 404);
  if (Number(current.version) !== Number(version)) throw new PolicyError("That version has been replaced — please review the current version", 409);
  await db
    .prepare(`INSERT IGNORE INTO policy_acceptances (doc_key, version, subject_type, subject_id, context) VALUES (?, ?, ?, ?, ?)`)
    .run(docKey, version, subject.type, subject.id, context.slice(0, 40));
  return { docKey, version: Number(version) };
}
