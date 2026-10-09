import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { MANDATORY_PLACEHOLDERS, editorialNotesIn, placeholdersIn } from "../policy/cms.js";
import { POLICY_SEEDS } from "../policy/drafts.js";
import { adminRouter } from "./admin.js";
import { complaintsRouter } from "./complaints.js";
import { policiesRouter } from "./policies.js";
import { hostTraderRouter, publicTraderRouter } from "./traders.js";

// Revenue & Connect Stage 4 — policy CMS gates (placeholders, editorial
// notes, legal sign-off), frozen published text, acceptance and
// re-acceptance, complaints/appeals with statements of reasons, and trader
// profiles (masked TIN, public only after self-certification).

const run = crypto.randomUUID().slice(0, 8);
const legal = `pol-legal-${run}`;
const support = `pol-sup-${run}`;
const support2 = `pol-sup2-${run}`;
const finance = `pol-fin-${run}`;
const resident = `pol-res-${run}`;
const DOC = "general-terms";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  for (const [id, role] of [
    [legal, "legal"],
    [support, "support"],
    [support2, "support"],
    [finance, "finance"],
  ]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', ?, ?)`).run(id, `${id}@example.test`, role, role);
  }
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Policy Resident')`).run(resident, `${resident}@example.test`);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const admin = req.header("X-Test-Admin");
    if (admin) (req as any).user = { id: admin, email: `${admin}@example.test`, role: "admin", status: "approved", adminRole: admin.split("-")[1] === "sup2" ? "support" : { legal: "legal", sup: "support", fin: "finance" }[admin.split("-")[1]] };
    if (req.header("X-Test-Resident")) (req as any).resident = { id: resident, email: `${resident}@example.test`, name: "Policy Resident" };
    next();
  });
  app.use("/policies", policiesRouter);
  app.use("/complaints", complaintsRouter);
  app.use("/traders", publicTraderRouter);
  app.use("/host/trader-profile", hostTraderRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Put the seeded document back exactly as initSchema leaves it.
  const seed = POLICY_SEEDS.find((d) => d.key === DOC)!;
  await db.prepare(`DELETE FROM policy_versions WHERE doc_key = ? AND version > 1`).run(DOC);
  await db
    .prepare(
      `UPDATE policy_versions SET status = 'draft', body = ?, published_body = NULL, content_hash = NULL, change_summary = 'Initial structured draft', material = 1, effective_from = NULL,
        submitted_by = NULL, approved_by = NULL, approved_at = NULL, legal_reviewer_name = NULL, legal_reviewed_by = NULL, legal_reviewed_at = NULL, published_by = NULL, published_at = NULL, retired_at = NULL
       WHERE doc_key = ? AND version = 1`
    )
    .run(seed.body, DOC);
  await db.prepare(`DELETE FROM policy_values WHERE updated_by = ?`).run(legal);
  await db.prepare(`DELETE FROM policy_acceptances WHERE subject_id = ?`).run(resident);
  await db.prepare(`DELETE FROM complaints WHERE email LIKE ?`).run(`%${run}%`);
  await db.prepare(`DELETE FROM reports WHERE reporter_client_id = ?`).run(`pol-${run}`);
  await db.prepare(`DELETE FROM trader_profiles WHERE party_id = ?`).run(resident);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?, ?, ?)`).run(legal, support, support2, finance);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(resident);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`).run(legal, support, support2, finance);
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
const asLegal = { "X-Test-Admin": legal };
const asResident = { "X-Test-Resident": "1" };

async function versionId(version: number) {
  const row = (await db.prepare(`SELECT id FROM policy_versions WHERE doc_key = ? AND version = ?`).get(DOC, version)) as { id: number };
  return row.id;
}

describe("policy drafts", () => {
  it("seeds all 18 documents as unpublished drafts that use the mandatory placeholders", async () => {
    const docs = await call("GET", "/policies");
    expect(docs.body).toHaveLength(18);
    const all = POLICY_SEEDS.map((d) => d.body).join("\n");
    for (const p of MANDATORY_PLACEHOLDERS.filter((p) => p !== "VAT_NUMBER" && p !== "STRIPE_ACCOUNT_COUNTRY")) expect(placeholdersIn(all)).toContain(p);
    const terms = await call("GET", `/policies/${DOC}`);
    expect(terms.body).toMatchObject({ docKey: DOC, title: "General Terms", published: null });
  });

  it("detects editorial notes but not Markdown links", () => {
    expect(editorialNotesIn("See [Pricing](/pricing). [notice period — legal review required] [[LEGAL_ENTITY_NAME]]")).toEqual(["notice period — legal review required"]);
    expect(placeholdersIn("[[A_B]] and [[A_B]] [[C]]")).toEqual(["A_B"]);
  });

  it("only legal/super admins reach the CMS", async () => {
    expect((await call("GET", "/admin/policies", undefined, { "X-Test-Admin": finance })).status).toBe(403);
    expect((await call("GET", "/admin/policies", undefined, asLegal)).status).toBe(200);
  });
});

describe("publication gates", () => {
  it("refuses to publish without legal sign-off, with placeholders, or with editorial notes — then freezes the published text", async () => {
    const v1 = await versionId(1);
    const draft = (await call("GET", `/admin/policies/versions/${v1}/preview`, undefined, asLegal)).body;
    expect(draft.blockers.placeholders).toContain("LEGAL_ENTITY_NAME");
    expect(draft.blockers.notes.length).toBeGreaterThan(0);
    expect(draft.blockers.legalReview).toBe(true);

    // Remove the editorial notes from the draft text (the solicitor's job in real life).
    const cleaned = draft.body.replace(/\[([^\]\n]+)\](?!\()/g, (m: string) => (m.startsWith("[[") ? m : "Agreed clause."));
    expect((await call("PUT", `/admin/policies/versions/${v1}`, { body: cleaned, rowVersion: draft.rowVersion + 99 }, asLegal)).status).toBe(409);
    expect((await call("PUT", `/admin/policies/versions/${v1}`, { body: cleaned, rowVersion: draft.rowVersion, changeSummary: "First version" }, asLegal)).status).toBe(200);

    expect((await call("POST", `/admin/policies/versions/${v1}/publish`, { reason: "go live now" }, asLegal)).status).toBe(409);
    expect((await call("POST", `/admin/policies/versions/${v1}/submit`, { reason: "ready for review" }, asLegal)).body.status).toBe("review");
    expect((await call("POST", `/admin/policies/versions/${v1}/approve`, { reason: "content approved" }, asLegal)).body.status).toBe("approved");

    const noSignoff = await call("POST", `/admin/policies/versions/${v1}/publish`, { reason: "go live now" }, asLegal);
    expect(noSignoff.status).toBe(409);
    expect(noSignoff.body.error).toMatch(/Legal review required/);
    expect((await call("POST", `/admin/policies/versions/${v1}/legal_signoff`, { reason: "signed off", reviewerName: "" }, asLegal)).status).toBe(400);
    expect((await call("POST", `/admin/policies/versions/${v1}/legal_signoff`, { reason: "signed off", reviewerName: "A. Solicitor" }, asLegal)).body.legalReviewed).toBe(true);

    const missing = await call("POST", `/admin/policies/versions/${v1}/publish`, { reason: "go live now" }, asLegal);
    expect(missing.status).toBe(409);
    expect(missing.body.error).toMatch(/LEGAL_ENTITY_NAME/);

    for (const p of placeholdersIn(cleaned)) {
      expect((await call("PUT", `/admin/policies/placeholders/${p}`, { value: `Value ${p}`, reason: "entity details" }, asLegal)).status).toBe(200);
    }
    const published = await call("POST", `/admin/policies/versions/${v1}/publish`, { reason: "go live now" }, asLegal);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: "published", material: true });

    const pub = (await call("GET", `/policies/${DOC}`)).body.published;
    expect(pub.version).toBe(1);
    expect(pub.body).toContain("Value LEGAL_ENTITY_NAME");
    expect(pub.body).not.toMatch(/\[\[/);
    expect(pub.contentHash).toBe(crypto.createHash("sha256").update(pub.body, "utf8").digest("hex"));

    // Changing a value later never rewrites what was published.
    await call("PUT", `/admin/policies/placeholders/LEGAL_ENTITY_NAME`, { value: "Changed Ltd", reason: "entity renamed" }, asLegal);
    expect((await call("GET", `/policies/${DOC}`)).body.published.body).toContain("Value LEGAL_ENTITY_NAME");
  });
});

describe("acceptance and re-acceptance", () => {
  async function publishNew(material: boolean, summary: string) {
    const created = await call("POST", `/admin/policies/${DOC}/drafts`, { changeSummary: summary, reason: "update terms" }, asLegal);
    expect(created.status).toBe(200);
    const id = created.body.id;
    for (const step of ["submit", "approve"]) await call("POST", `/admin/policies/versions/${id}/${step}`, { reason: "workflow step" }, asLegal);
    await call("POST", `/admin/policies/versions/${id}/legal_signoff`, { reason: "signed off", reviewerName: "A. Solicitor" }, asLegal);
    const r = await call("POST", `/admin/policies/versions/${id}/publish`, { reason: "publish update", material }, asLegal);
    expect(r.status).toBe(200);
  }

  it("asks a resident to accept, records it, and asks again only after a material change", async () => {
    const pending = await call("GET", "/policies/acceptance/pending", undefined, asResident);
    expect(pending.body.resident.map((p: { docKey: string }) => p.docKey)).toContain(DOC);
    expect((await call("POST", `/policies/${DOC}/accept`, { version: 1, as: "resident" })).status).toBe(401);
    expect((await call("POST", `/policies/${DOC}/accept`, { version: 99, as: "resident" }, asResident)).status).toBe(409);
    expect((await call("POST", `/policies/${DOC}/accept`, { version: 1, as: "resident" }, asResident)).status).toBe(200);
    expect((await call("GET", "/policies/acceptance/pending", undefined, asResident)).body.resident.map((p: { docKey: string }) => p.docKey)).not.toContain(DOC);

    await publishNew(false, "Typo fixes");
    expect((await call("GET", "/policies/acceptance/pending", undefined, asResident)).body.resident.map((p: { docKey: string }) => p.docKey)).not.toContain(DOC);

    await publishNew(true, "New liability clause");
    const again = (await call("GET", "/policies/acceptance/pending", undefined, asResident)).body.resident.find((p: { docKey: string }) => p.docKey === DOC);
    expect(again).toMatchObject({ version: 3, changeSummary: "New liability clause" });

    const history = (await call("GET", `/policies/${DOC}?version=1`)).body.published;
    expect(history.status).toBe("retired");
    expect(history.history.map((h: { version: number }) => h.version)).toEqual([3, 2, 1]);
  });

  it("allows only one version in progress per document", async () => {
    const first = await call("POST", `/admin/policies/${DOC}/drafts`, { reason: "next draft" }, asLegal);
    expect(first.status).toBe(200);
    expect((await call("POST", `/admin/policies/${DOC}/drafts`, { reason: "another draft" }, asLegal)).status).toBe(409);
    expect((await call("POST", `/admin/policies/versions/${first.body.id}/discard`, { reason: "not needed" }, asLegal)).body.status).toBe("discarded");
  });
});

describe("complaints and appeals", () => {
  it("takes a complaint, and closing it requires a statement of reasons the submitter can read", async () => {
    expect((await call("POST", "/complaints", { kind: "complaint", subjectType: "booking", body: "The session did not take place at all." })).status).toBe(400);
    const c = await call("POST", "/complaints", { kind: "complaint", subjectType: "booking", subjectRef: "b-1", email: `c-${run}@example.test`, body: "The session did not take place at all." });
    expect(c.status).toBe(201);
    expect((await call("PUT", `/admin/complaints/${c.body.id}`, { status: "closed", decision: "upheld" }, { "X-Test-Admin": support })).status).toBe(400);
    expect((await call("PUT", `/admin/complaints/${c.body.id}`, { status: "closed", decision: "upheld", statementOfReasons: "Refund issued." }, { "X-Test-Admin": finance })).status).toBe(403);
    const ok = await call("PUT", `/admin/complaints/${c.body.id}`, { status: "closed", decision: "upheld", statementOfReasons: "The partner confirmed the cancellation; a full refund was issued." }, { "X-Test-Admin": support });
    expect(ok.status).toBe(200);
    expect((await call("PUT", `/admin/complaints/${c.body.id}`, { status: "closed", decision: "rejected", statementOfReasons: "Changing my mind after the fact." }, { "X-Test-Admin": support })).status).toBe(409);
  });

  it("an appeal of a moderation decision can't be decided by the original decision-maker", async () => {
    const report = await db.prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES ('review', 'r-1', ?, 'spam')`).run(`pol-${run}`);
    const reportId = Number(report.lastInsertRowid);
    expect((await call("PUT", `/admin/reports/${reportId}`, { status: "actioned", statementOfReasons: "Review removed as spam under the Community Standards." }, { "X-Test-Admin": support })).status).toBe(200);
    const stored = (await db.prepare(`SELECT statement_of_reasons as s, decided_by as d FROM reports WHERE id = ?`).get(reportId)) as { s: string; d: string };
    expect(stored).toEqual({ s: "Review removed as spam under the Community Standards.", d: support });

    const appeal = await call("POST", "/complaints", { kind: "appeal", subjectType: "moderation_decision", subjectRef: String(reportId), email: `a-${run}@example.test`, body: "My review was genuine and should be restored." });
    const decide = { status: "closed", decision: "rejected", statementOfReasons: "A second reviewer confirmed the review breaches the spam rule." };
    expect((await call("PUT", `/admin/complaints/${appeal.body.id}`, decide, { "X-Test-Admin": support })).status).toBe(403);
    expect((await call("PUT", `/admin/complaints/${appeal.body.id}`, decide, { "X-Test-Admin": support2 })).status).toBe(200);
  });
});

describe("trader profiles", () => {
  const profile = { entityType: "individual", legalName: "Pat Host", address: "1 Main St, Dublin", country: "IE", email: "pat@example.test", phone: "+353 1 000 0000", dateOfBirth: "1990-01-01", tin: "1234567TA", selfCertify: false };

  it("validates, masks the TIN, and keeps it when the masked value is sent back", async () => {
    expect((await call("PUT", "/host/trader-profile", profile)).status).toBe(401);
    expect((await call("PUT", "/host/trader-profile", { ...profile, dateOfBirth: undefined }, asResident)).status).toBe(400);
    const saved = await call("PUT", "/host/trader-profile", profile, asResident);
    expect(saved.status).toBe(200);
    expect(saved.body.tin).toBe("•••••67TA");
    const again = await call("PUT", "/host/trader-profile", { ...profile, tin: saved.body.tin }, asResident);
    expect(again.body.tin).toBe("•••••67TA");
    const raw = (await db.prepare(`SELECT tin FROM trader_profiles WHERE party_type = 'host' AND party_id = ?`).get(resident)) as { tin: string };
    expect(raw.tin).toBe("1234567TA");
  });

  it("is public on the host's games only after self-certification, without the TIN or date of birth", async () => {
    const gameId = `pol-game-${run}`;
    await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status) VALUES (?, ?, 'Football', '2030-01-01', '18:00', 10, 'open')`).run(gameId, resident);
    expect((await call("GET", `/traders/listing/game/${gameId}`)).body).toBeNull();
    await call("PUT", "/host/trader-profile", { ...profile, selfCertify: true }, asResident);
    const pub = (await call("GET", `/traders/listing/game/${gameId}`)).body;
    expect(pub).toMatchObject({ legalName: "Pat Host", country: "IE" });
    expect(pub.tin).toBeUndefined();
    expect(pub.dateOfBirth).toBeUndefined();
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
  });

  it("verification needs a legal/support admin and a note", async () => {
    expect((await call("PUT", `/admin/traders/host/${resident}/verification`, { status: "verified", note: "Checked ID" }, { "X-Test-Admin": finance })).status).toBe(403);
    expect((await call("PUT", `/admin/traders/host/${resident}/verification`, { status: "verified" }, asLegal)).status).toBe(400);
    expect((await call("PUT", `/admin/traders/host/${resident}/verification`, { status: "verified", note: "Checked against Stripe KYC" }, asLegal)).status).toBe(200);
  });
});
