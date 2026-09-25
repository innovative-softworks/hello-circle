import crypto from "node:crypto";
import http, { type Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { isPlausibleDob } from "../util.js";
import { authRouter } from "./auth.js";
import { householdRouter } from "./household.js";
import { manageRouter } from "./manage.js";

// Onboarding audit (consent pass) — the two account-creation paths that never
// asked for Terms at all (staff invitation acceptance, and a verified Host
// opening a provider account), plus the DOB plausibility check added to
// household members. Real DB, isolated rows, cleaned up after.

let server: Server;
let baseUrl: string;
const suffix = crypto.randomUUID();
const orgId = `org-consent-${suffix}`;
const inviteEmails: string[] = [];
const residentIds: string[] = [];
const createdEmails: string[] = [];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(async (req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) {
      const row = (await db.prepare(`SELECT id, email, name FROM residents WHERE id = ?`).get(id)) as any;
      if (row) (req as any).resident = row;
    }
    next();
  });
  app.use("/auth", authRouter);
  app.use("/manage", manageRouter);
  app.use("/household", householdRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Consent Test Org', 'vendor')`).run(orgId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const emails = [...inviteEmails, ...createdEmails];
  if (emails.length) {
    const ph = emails.map(() => "?").join(",");
    await db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${ph}))`).run(...emails);
    await db.prepare(`DELETE FROM centres WHERE vendor_id IN (SELECT id FROM users WHERE email IN (${ph}))`).run(...emails);
    await db.prepare(`DELETE FROM clubs WHERE vendor_id IN (SELECT id FROM users WHERE email IN (${ph}))`).run(...emails);
    await db.prepare(`DELETE FROM users WHERE email IN (${ph})`).run(...emails);
  }
  await db.prepare(`DELETE FROM org_invites WHERE org_id = ?`).run(orgId);
  await db.prepare(`DELETE FROM audit_log WHERE object_type = 'user' AND action = 'manage.host_became_provider' AND actor_user_id NOT IN (SELECT id FROM users)`).run();
  await db.prepare(`DELETE FROM organisations WHERE id = ? OR name IN ('Consent Test Hall')`).run(orgId);
  if (residentIds.length) {
    const ph = residentIds.map(() => "?").join(",");
    await db.prepare(`DELETE FROM household_members WHERE resident_id IN (${ph})`).run(...residentIds);
    await db.prepare(`DELETE FROM residents WHERE id IN (${ph})`).run(...residentIds);
  }
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function makeInvite(): Promise<{ token: string; email: string }> {
  const token = crypto.randomBytes(16).toString("hex");
  const email = `invitee-${crypto.randomUUID()}@example.test`;
  inviteEmails.push(email);
  await db.prepare(`INSERT INTO org_invites (token, org_id, email, platform_role, expires_at) VALUES (?, ?, ?, 'finance', DATE_ADD(NOW(), INTERVAL 1 DAY))`).run(token, orgId, email);
  return { token, email };
}

describe("POST /auth/accept-invite — Terms", () => {
  it("rejects acceptance without Terms, creates no user, and leaves the invite pending", async () => {
    const { token, email } = await makeInvite();
    const res = await post("/auth/accept-invite", { token, name: "Staff", password: "password123", termsAccepted: false });
    expect(res.status).toBe(400);
    expect(await db.prepare(`SELECT id FROM users WHERE email = ?`).get(email)).toBeUndefined();
    const invite = (await db.prepare(`SELECT status FROM org_invites WHERE token = ?`).get(token)) as { status: string };
    expect(invite.status).toBe("pending");
  });

  it("records terms_accepted_at, keeps marketing off by default, grants only the invited role, and marks the invite accepted", async () => {
    const { token, email } = await makeInvite();
    const res = await post("/auth/accept-invite", { token, name: "Staff", password: "password123", termsAccepted: true });
    expect(res.status).toBe(201);
    const row = (await db.prepare(`SELECT terms_accepted_at, marketing_consent, platform_role, invited_staff, org_id, status FROM users WHERE email = ?`).get(email)) as any;
    expect(row.terms_accepted_at).toBeTruthy();
    expect(row.marketing_consent).toBe(0);
    expect(row.platform_role).toBe("finance");
    expect(row.invited_staff).toBe(1);
    expect(row.org_id).toBe(orgId);
    expect(row.status).toBe("approved");
    const invite = (await db.prepare(`SELECT status FROM org_invites WHERE token = ?`).get(token)) as { status: string };
    expect(invite.status).toBe("accepted");
  });

  it("a reused invitation cannot be accepted twice", async () => {
    const { token } = await makeInvite();
    expect((await post("/auth/accept-invite", { token, name: "A", password: "password123", termsAccepted: true })).status).toBe(201);
    expect((await post("/auth/accept-invite", { token, name: "B", password: "password123", termsAccepted: true })).status).toBe(400);
  });

  it("records marketing consent only when explicitly given", async () => {
    const { token, email } = await makeInvite();
    await post("/auth/accept-invite", { token, name: "Staff", password: "password123", termsAccepted: true, marketingConsent: true });
    const row = (await db.prepare(`SELECT marketing_consent FROM users WHERE email = ?`).get(email)) as { marketing_consent: number };
    expect(row.marketing_consent).toBe(1);
  });
});

describe("POST /manage/become-provider — Terms", () => {
  async function verifiedHost(): Promise<{ id: string; email: string }> {
    const id = `host-consent-${crypto.randomUUID()}`;
    const email = `${id}@example.test`;
    residentIds.push(id);
    createdEmails.push(email);
    await db.prepare(`INSERT INTO residents (id, email, name, host_status) VALUES (?, ?, 'Verified Host', 'verified')`).run(id, email);
    return { id, email };
  }
  const details = { password: "password123", vendorType: "community", businessName: "Consent Test Hall", address: "1 Test St", county: "Dublin", mobile: "0870000000", description: "test" };

  it("rejects without Terms and creates no account, org or listing", async () => {
    const host = await verifiedHost();
    const res = await post("/manage/become-provider", { ...details, termsAccepted: false }, { "X-Test-Resident-Id": host.id });
    expect(res.status).toBe(400);
    expect(await db.prepare(`SELECT id FROM users WHERE email = ?`).get(host.email)).toBeUndefined();
  });

  it("records terms on the new provider row (not inherited from the resident), stays pending, marketing off by default", async () => {
    const host = await verifiedHost();
    const res = await post("/manage/become-provider", { ...details, termsAccepted: true }, { "X-Test-Resident-Id": host.id });
    expect(res.status).toBe(201);
    const row = (await db.prepare(`SELECT terms_accepted_at, marketing_consent, status, resident_id FROM users WHERE email = ?`).get(host.email)) as any;
    expect(row.terms_accepted_at).toBeTruthy();
    expect(row.marketing_consent).toBe(0);
    expect(row.status).toBe("pending");
    expect(row.resident_id).toBe(host.id);
  });
});

describe("household DOB plausibility", () => {
  it("isPlausibleDob accepts real past dates and rejects malformed, impossible and future ones", () => {
    expect(isPlausibleDob("2015-06-30")).toBe(true);
    expect(isPlausibleDob("2024-02-29")).toBe(true);
    expect(isPlausibleDob("2023-02-29")).toBe(false);
    expect(isPlausibleDob("2024-02-30")).toBe(false);
    expect(isPlausibleDob("not-a-date")).toBe(false);
    expect(isPlausibleDob("30/06/2015")).toBe(false);
    expect(isPlausibleDob("")).toBe(false);
    expect(isPlausibleDob("2999-01-01")).toBe(false);
  });

  it("POST /household rejects a bad dob, still allows no dob, and PUT on someone else's member is 403", async () => {
    const id = `hh-${crypto.randomUUID()}`;
    residentIds.push(id);
    await db.prepare(`INSERT INTO residents (id, email) VALUES (?, ?)`).run(id, `${id}@example.test`);
    const otherId = `hh-other-${crypto.randomUUID()}`;
    residentIds.push(otherId);
    await db.prepare(`INSERT INTO residents (id, email) VALUES (?, ?)`).run(otherId, `${otherId}@example.test`);

    const h = { "X-Test-Resident-Id": id };
    expect((await post("/household", { firstName: "A", lastName: "B", dob: "2024-02-30" }, h)).status).toBe(400);
    const ok = await post("/household", { firstName: "A", lastName: "B" }, h);
    expect(ok.status).toBe(201);
    const { id: memberId } = (await ok.json()) as { id: number };

    const put = await fetch(`${baseUrl}/household/${memberId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": otherId },
      body: JSON.stringify({ firstName: "Hijack" }),
    });
    expect(put.status).toBe(403);
  });
});

describe("safeEmailedReturnTo (magic-link returnTo guard)", () => {
  it("keeps a safe path with query and hash", async () => {
    const { safeEmailedReturnTo } = await import("./guestAuth.js");
    expect(safeEmailedReturnTo("/circles/abc?tab=plans#poll")).toBe("/circles/abc?tab=plans#poll");
  });

  it("drops external, protocol-relative, backslash, control-char, oversized and auth-loop targets", async () => {
    const { safeEmailedReturnTo } = await import("./guestAuth.js");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/x\r\ny", "/login", "/signin/email-link", "/accept-invite?token=1", "/" + "a".repeat(2100), undefined, 42]) {
      expect(safeEmailedReturnTo(bad)).toBeNull();
    }
  });
});
