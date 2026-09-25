import "express-async-errors";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { attachUser, createSession, createUser, SESSION_COOKIE } from "../auth.js";
import { db } from "../db/index.js";
import { authRouter } from "./auth.js";
import { guestAuthRouter } from "./guestAuth.js";
import { residentsRouter } from "./residents.js";

// Google sign-in (Audit and Complete Google Sign-In). verifyGoogleIdToken
// itself needs a real Google-signed JWT to exercise for real, which a test
// can't produce — every scenario below mocks that one external boundary
// (../googleAuth.js) and otherwise runs the real route/DB logic end to end,
// same as vendorAuthFlow.test.ts does for password auth.

vi.mock("../googleAuth.js", () => ({
  verifyGoogleIdToken: vi.fn(),
  GoogleAuthNotConfigured: class GoogleAuthNotConfigured extends Error {},
}));

const { verifyGoogleIdToken, GoogleAuthNotConfigured } = (await import("../googleAuth.js")) as unknown as {
  verifyGoogleIdToken: ReturnType<typeof vi.fn>;
  GoogleAuthNotConfigured: new () => Error;
};

let server: Server;
let baseUrl: string;

const testEmails: string[] = [];
function freshEmail(label: string): string {
  const email = `google-${label}-${crypto.randomUUID()}@example.test`;
  testEmails.push(email);
  return email;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);
  app.use("/auth", authRouter);
  app.use("/guest", guestAuthRouter);
  // residentsRouter normally sits behind attachGuestEmail/attachResident —
  // stubbed here the same way residents.test.ts does, via a test-only
  // header, since this file is only exercising POST /me/google's own logic
  // (requireResident + linkResidentGoogleUid), not that middleware chain.
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId };
    next();
  });
  app.use("/residents", residentsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (testEmails.length) {
    const placeholders = testEmails.map(() => "?").join(",");
    const vendorRows = (await db.prepare(`SELECT id, org_id FROM users WHERE email IN (${placeholders})`).all(...testEmails)) as {
      id: string;
      org_id: string | null;
    }[];
    for (const { id, org_id } of vendorRows) {
      const centres = (await db.prepare(`SELECT id FROM centres WHERE vendor_id = ?`).all(id)) as { id: string }[];
      for (const { id: centreId } of centres) await db.prepare(`DELETE FROM rooms WHERE centre_id = ?`).run(centreId);
      await db.prepare(`DELETE FROM centres WHERE vendor_id = ?`).run(id);
      await db.prepare(`DELETE FROM clubs WHERE vendor_id = ?`).run(id);
      if (org_id) await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(org_id);
    }
    await db.prepare(`DELETE FROM guest_sessions WHERE email IN (${placeholders})`).run(...testEmails);
    await db.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))`).run(...testEmails);
    await db.prepare(`DELETE FROM residents WHERE email IN (${placeholders})`).run(...testEmails);
    await db.prepare(`DELETE FROM users WHERE email IN (${placeholders})`).run(...testEmails);
  }
});

const VENDOR_INTAKE = {
  name: "Test Google Vendor",
  vendorType: "community" as const,
  businessName: "Test Google Vendor Biz",
  address: "1 Test Road",
  county: "Dublin",
  mobile: "0850000000",
  description: "A test vendor signed up via Google",
  termsAccepted: true,
  marketingConsent: false,
};

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /guest/google — resolving a sign-in (never creates or links by itself)", () => {
  it("returns needs_completion for a brand-new identity and creates no resident row", async () => {
    const email = freshEmail("new-resident");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "New Resident", picture: "https://example.test/pic.jpg" });

    const res = await postJson("/guest/google", { idToken: "fake" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; email: string; name: string | null };
    expect(body.status).toBe("needs_completion");
    expect(body.email).toBe(email);
    expect(body.name).toBe("New Resident");
    expect(res.headers.get("set-cookie")).toBeNull();

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("returns needs_completion again on a retry after an abandoned/cancelled completion — no duplicate created either way", async () => {
    const email = freshEmail("cancelled-then-resumed");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValue({ uid, email, name: "Resumer", picture: null });

    const first = await postJson("/guest/google", { idToken: "fake" });
    expect((await first.json()).status).toBe("needs_completion");

    // Simulates the person closing the tab without completing, then coming
    // back later and clicking Google again.
    const second = await postJson("/guest/google", { idToken: "fake" });
    expect((await second.json()).status).toBe("needs_completion");

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);

    // Now actually completing it should still work cleanly.
    const complete = await postJson("/guest/google/complete", { idToken: "fake", name: "Resumer", termsAccepted: true, marketingConsent: false });
    expect(complete.status).toBe(200);
    const rowsAfter = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rowsAfter).toHaveLength(1);
  });

  it("logs an existing linked resident straight in, no interstitial", async () => {
    const email = freshEmail("returning-resident");
    const uid = `uid-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name, google_uid) VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), email, "Returning", uid);

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Returning", picture: null });
    const res = await postJson("/guest/google", { idToken: "fake" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; email: string };
    expect(body.status).toBe("signed_in");
    expect(body.email).toBe(email);
    expect(res.headers.get("set-cookie")).toContain("hello_circle_guest_session");
  });

  it("rejects (409) an existing account matched only by email — does not log in and does not link", async () => {
    const email = freshEmail("email-taken");
    const uid = `uid-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(crypto.randomUUID(), email, "Existing Name");

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Google Name", picture: null });
    const res = await postJson("/guest/google", { idToken: "fake" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { accountExists: boolean };
    expect(body.accountExists).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();

    const row = (await db.prepare(`SELECT google_uid FROM residents WHERE email = ?`).get(email)) as { google_uid: string | null };
    expect(row.google_uid).toBeNull();
  });

  it("rejects a missing idToken", async () => {
    const res = await postJson("/guest/google", {});
    expect(res.status).toBe(400);
  });

  it("rejects a token verification failure", async () => {
    verifyGoogleIdToken.mockResolvedValueOnce(null);
    const res = await postJson("/guest/google", { idToken: "bad" });
    expect(res.status).toBe(401);
  });

  it("responds 503 when Google sign-in isn't configured", async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new GoogleAuthNotConfigured());
    const res = await postJson("/guest/google", { idToken: "fake" });
    expect(res.status).toBe(503);
  });
});

describe("POST /guest/google/complete — creates the account, only after explicit confirmation", () => {
  it("creates the resident with the submitted name, terms/marketing consent, and avatar from Google", async () => {
    const email = freshEmail("complete-new");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValue({ uid, email, name: "Google Name", picture: "https://example.test/pic.jpg" });

    const res = await postJson("/guest/google/complete", { idToken: "fake", name: "Chosen Name", termsAccepted: true, marketingConsent: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("hello_circle_guest_session");

    const row = (await db.prepare(`SELECT name, google_uid, avatar_url, terms_accepted_at, marketing_consent FROM residents WHERE email = ?`).get(
      email
    )) as { name: string; google_uid: string; avatar_url: string; terms_accepted_at: string; marketing_consent: number };
    expect(row.name).toBe("Chosen Name");
    expect(row.google_uid).toBe(uid);
    expect(row.avatar_url).toBe("https://example.test/pic.jpg");
    expect(row.terms_accepted_at).toBeTruthy();
    expect(row.marketing_consent).toBe(1);
  });

  it("rejects completion without terms acceptance, and creates nothing", async () => {
    const email = freshEmail("complete-no-terms");
    // No verifyGoogleIdToken mock needed here — the route rejects on the
    // missing termsAccepted flag before ever verifying the token, so
    // queuing an unconsumed mockResolvedValueOnce here would silently leak
    // into (and desync) whichever test runs next.
    const res = await postJson("/guest/google/complete", { idToken: "fake", name: "Someone", termsAccepted: false, marketingConsent: false });
    expect(res.status).toBe(400);

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("does not create duplicate residents from two concurrent completions of the same brand-new identity", async () => {
    const email = freshEmail("complete-concurrent");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValue({ uid, email, name: "Concurrent", picture: null });

    const [res1, res2] = await Promise.all([
      postJson("/guest/google/complete", { idToken: "fake", name: "Concurrent", termsAccepted: true, marketingConsent: false }),
      postJson("/guest/google/complete", { idToken: "fake", name: "Concurrent", termsAccepted: true, marketingConsent: false }),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const rows = (await db.prepare(`SELECT id FROM residents WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(1);
  });

  it("rejects completion for an email a different account already claimed in the meantime", async () => {
    const email = freshEmail("complete-race-taken");
    const uid = `uid-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(crypto.randomUUID(), email, "Someone Else");

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Late Arrival", picture: null });
    const res = await postJson("/guest/google/complete", { idToken: "fake", name: "Late Arrival", termsAccepted: true, marketingConsent: false });
    expect(res.status).toBe(409);
  });
});

describe("POST /residents/me/google — explicit linking from an authenticated session", () => {
  it("links a Google identity onto the caller's own account", async () => {
    const email = freshEmail("resident-explicit-link");
    const residentId = crypto.randomUUID();
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(residentId, email, "Link Me");
    const uid = `uid-${crypto.randomUUID()}`;

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email: "whatever@example.test", name: null, picture: null });
    const res = await fetch(`${baseUrl}/residents/me/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": residentId },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(200);

    const row = (await db.prepare(`SELECT google_uid FROM residents WHERE id = ?`).get(residentId)) as { google_uid: string };
    expect(row.google_uid).toBe(uid);
  });

  it("rejects linking a Google identity already linked to a different resident", async () => {
    const emailA = freshEmail("resident-link-conflict-a");
    const emailB = freshEmail("resident-link-conflict-b");
    const uid = `uid-${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO residents (id, email, name, google_uid) VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), emailA, "Already Linked", uid);
    const residentBId = crypto.randomUUID();
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(residentBId, emailB, "Wants Same Google");

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email: "whatever@example.test", name: null, picture: null });
    const res = await fetch(`${baseUrl}/residents/me/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-Resident-Id": residentBId },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(409);

    const row = (await db.prepare(`SELECT google_uid FROM residents WHERE id = ?`).get(residentBId)) as { google_uid: string | null };
    expect(row.google_uid).toBeNull();
  });

  it("requires an authenticated resident session", async () => {
    const res = await fetch(`${baseUrl}/residents/me/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/google — vendor/admin sign-in (login only, never auto-links)", () => {
  it("logs in an account already linked by uid", async () => {
    const email = freshEmail("vendor-returning");
    const uid = `uid-${crypto.randomUUID()}`;
    const user = await createUser(email, "irrelevant-password-123", "Returning Vendor", "vendor", "approved", {
      vendorType: "community",
      businessName: "Test Biz",
      address: "1 Road",
      county: "Dublin",
      mobile: "0850000000",
      description: "desc",
    });
    await db.prepare(`UPDATE users SET google_uid = ? WHERE id = ?`).run(uid, user.id);

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Returning Vendor", picture: null });
    const res = await postJson("/auth/google", { idToken: "fake" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe(email);
    expect(res.headers.get("set-cookie")).toContain("hello_circle_session");
  });

  it("rejects (409) an existing account matched only by email — does not log in and does not link", async () => {
    const email = freshEmail("vendor-email-taken");
    const uid = `uid-${crypto.randomUUID()}`;
    await createUser(email, "irrelevant-password-123", "Test Vendor", "vendor", "approved", {
      vendorType: "community",
      businessName: "Test Biz",
      address: "1 Road",
      county: "Dublin",
      mobile: "0850000000",
      description: "desc",
    });

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Vendor Google Name", picture: null });
    const res = await postJson("/auth/google", { idToken: "fake" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { accountExists: boolean };
    expect(body.accountExists).toBe(true);
    expect(res.headers.get("set-cookie")).toBeNull();

    const row = (await db.prepare(`SELECT google_uid FROM users WHERE email = ?`).get(email)) as { google_uid: string | null };
    expect(row.google_uid).toBeNull();
  });

  it("never creates a new vendor account for an unrecognised Google email", async () => {
    const email = freshEmail("vendor-no-account");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Nobody", picture: null });

    const res = await postJson("/auth/google", { idToken: "fake" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { noAccount: boolean };
    expect(body.noAccount).toBe(true);

    const rows = (await db.prepare(`SELECT id FROM users WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("rejects a suspended account even when already linked by uid", async () => {
    const email = freshEmail("vendor-suspended");
    const uid = `uid-${crypto.randomUUID()}`;
    const user = await createUser(email, "irrelevant-password-123", "Suspended Vendor", "vendor", "approved", {
      vendorType: "community",
      businessName: "Test Biz",
      address: "1 Road",
      county: "Dublin",
      mobile: "0850000000",
      description: "desc",
    });
    await db.prepare(`UPDATE users SET status = 'suspended', google_uid = ? WHERE id = ?`).run(uid, user.id);

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Suspended Vendor", picture: null });
    const res = await postJson("/auth/google", { idToken: "fake" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("PUT /auth/link-google — explicit linking from an authenticated vendor/admin session", () => {
  async function sessionCookieFor(email: string) {
    const user = await createUser(email, "irrelevant-password-123", "Link Test Vendor", "vendor", "approved", {
      vendorType: "community",
      businessName: "Link Test Biz",
      address: "1 Road",
      county: "Dublin",
      mobile: "0850000000",
      description: "desc",
    });
    const { token } = await createSession(user.id);
    return { user, cookie: `${SESSION_COOKIE}=${token}` };
  }

  it("links a Google identity onto the caller's own account", async () => {
    const email = freshEmail("vendor-explicit-link");
    const { user, cookie } = await sessionCookieFor(email);
    const uid = `uid-${crypto.randomUUID()}`;

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email: "whatever@example.test", name: null, picture: null });
    const res = await fetch(`${baseUrl}/auth/link-google`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(200);

    const row = (await db.prepare(`SELECT google_uid FROM users WHERE id = ?`).get(user.id)) as { google_uid: string };
    expect(row.google_uid).toBe(uid);
  });

  it("rejects linking a Google identity already linked to a different account", async () => {
    const emailA = freshEmail("vendor-link-conflict-a");
    const emailB = freshEmail("vendor-link-conflict-b");
    const { user: userA } = await sessionCookieFor(emailA);
    const { cookie: cookieB } = await sessionCookieFor(emailB);
    const uid = `uid-${crypto.randomUUID()}`;
    await db.prepare(`UPDATE users SET google_uid = ? WHERE id = ?`).run(uid, userA.id);

    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email: "whatever@example.test", name: null, picture: null });
    const res = await fetch(`${baseUrl}/auth/link-google`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(409);
  });

  it("requires an authenticated vendor/admin session", async () => {
    const res = await fetch(`${baseUrl}/auth/link-google`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "fake" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/signup-google (vendor Google signup — full intake, still pending)", () => {
  it("creates a pending vendor + draft centre from a verified Google identity, with no session set", async () => {
    const email = freshEmail("vendor-google-signup");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Google Vendor", picture: null });

    const res = await postJson("/auth/signup-google", { idToken: "fake", ...VENDOR_INTAKE });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toBeNull();

    const row = (await db.prepare(`SELECT status, google_uid, org_id, terms_accepted_at, marketing_consent FROM users WHERE email = ?`).get(
      email
    )) as { status: string; google_uid: string; org_id: string; terms_accepted_at: string; marketing_consent: number };
    expect(row.status).toBe("pending");
    expect(row.google_uid).toBe(uid);
    expect(row.org_id).toBeTruthy();
    expect(row.terms_accepted_at).toBeTruthy();
    expect(row.marketing_consent).toBe(0);

    const centres = (await db.prepare(`SELECT id, status FROM centres WHERE name = ?`).all(VENDOR_INTAKE.businessName)) as {
      id: string;
      status: string;
    }[];
    expect(centres).toHaveLength(1);
    expect(centres[0].status).toBe("pending");
  });

  it("rejects signup without terms acceptance, and creates nothing", async () => {
    const email = freshEmail("vendor-google-no-terms");
    // Same reasoning as the resident-complete test above — no mock needed,
    // the route never reaches verifyGoogleIdToken for this case.
    const res = await postJson("/auth/signup-google", { idToken: "fake", ...VENDOR_INTAKE, termsAccepted: false });
    expect(res.status).toBe(400);

    const rows = (await db.prepare(`SELECT id FROM users WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("rejects a duplicate email that already has an account", async () => {
    const email = freshEmail("vendor-google-dup");
    await createUser(email, "irrelevant-password-123", "Existing Vendor", "vendor", "approved", {
      vendorType: "community",
      businessName: "Existing Biz",
      address: "1 Road",
      county: "Dublin",
      mobile: "0850000000",
      description: "desc",
    });

    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Google Vendor", picture: null });
    const res = await postJson("/auth/signup-google", { idToken: "fake", ...VENDOR_INTAKE, businessName: "Different Biz Name" });
    expect(res.status).toBe(409);
  });

  it("rejects an incomplete listing intake", async () => {
    const email = freshEmail("vendor-google-incomplete");
    const uid = `uid-${crypto.randomUUID()}`;
    verifyGoogleIdToken.mockResolvedValueOnce({ uid, email, name: "Google Vendor", picture: null });

    const res = await postJson("/auth/signup-google", { idToken: "fake", name: "Google Vendor", termsAccepted: true });
    expect(res.status).toBe(400);

    const rows = (await db.prepare(`SELECT id FROM users WHERE email = ?`).all(email)) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it("rejects a missing idToken", async () => {
    const res = await postJson("/auth/signup-google", VENDOR_INTAKE);
    expect(res.status).toBe(400);
  });
});
