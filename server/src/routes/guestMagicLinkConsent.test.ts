import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { createLoginToken } from "../guestAuth.js";
import { residentsRouter } from "./residents.js";
import { guestAuthRouter } from "./guestAuth.js";

// Onboarding audit (consent pass) — opening a magic link proves inbox
// access, not agreement to Terms. A brand-new email must NOT become a
// resident row (or get a session) until Terms are accepted; a returning
// resident still signs straight in, with nothing fabricated onto their
// existing consent columns. Runs against the real (dev) DB like the sibling
// guest/manage route tests.

let server: Server;
let baseUrl: string;
const testEmails: string[] = [];

function freshEmail(label: string): string {
  const email = `magic-consent-${label}-${crypto.randomUUID()}@example.test`;
  testEmails.push(email);
  return email;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Stub resident identity for the resend-verification route only.
  app.use(async (req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) {
      const row = (await db.prepare(`SELECT id, email FROM residents WHERE id = ?`).get(id)) as { id: string; email: string } | undefined;
      if (row) (req as any).resident = row;
    }
    next();
  });
  app.use("/guest", guestAuthRouter);
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
    const ph = testEmails.map(() => "?").join(",");
    await db.prepare(`DELETE FROM guest_login_tokens WHERE email IN (${ph})`).run(...testEmails);
    await db.prepare(`DELETE FROM resident_signup_tokens WHERE email IN (${ph})`).run(...testEmails);
    await db.prepare(`DELETE FROM guest_sessions WHERE email IN (${ph})`).run(...testEmails);
    await db.prepare(`DELETE FROM residents WHERE email IN (${ph})`).run(...testEmails);
  }
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function residentRow(email: string) {
  return (await db.prepare(`SELECT id, terms_accepted_at, marketing_consent, email_verified_at FROM residents WHERE email = ?`).get(email)) as
    | { id: string; terms_accepted_at: string | null; marketing_consent: number; email_verified_at: string | null }
    | undefined;
}

describe("POST /guest/verify — brand-new email", () => {
  it("returns needs_completion and creates no resident row and no session", async () => {
    const email = freshEmail("new");
    const { token } = await createLoginToken(email);
    const res = await post("/guest/verify", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; email: string; completionToken: string };
    expect(body.status).toBe("needs_completion");
    expect(body.email).toBe(email);
    expect(body.completionToken).toBeTruthy();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await residentRow(email)).toBeUndefined();
  });

  it("the original login token is single-use", async () => {
    const email = freshEmail("single-use");
    const { token } = await createLoginToken(email);
    expect((await post("/guest/verify", { token })).status).toBe(200);
    expect((await post("/guest/verify", { token })).status).toBe(400);
  });

  it("rejects completion without termsAccepted, creates nothing, and does not burn the completion token", async () => {
    const email = freshEmail("no-terms");
    const { token } = await createLoginToken(email);
    const { completionToken } = (await (await post("/guest/verify", { token })).json()) as { completionToken: string };

    const bad = await post("/guest/verify/complete", { completionToken, name: "X", termsAccepted: false });
    expect(bad.status).toBe(400);
    expect(await residentRow(email)).toBeUndefined();

    const good = await post("/guest/verify/complete", { completionToken, name: "X", termsAccepted: true });
    expect(good.status).toBe(200);
  });

  it("creates the account on completion with terms + verified email recorded, marketing defaulting to off, and a session", async () => {
    const email = freshEmail("complete");
    const { token } = await createLoginToken(email);
    const { completionToken } = (await (await post("/guest/verify", { token })).json()) as { completionToken: string };

    const res = await post("/guest/verify/complete", { completionToken, name: "  Niamh  ", termsAccepted: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("hello_circle_guest_session");

    const row = await residentRow(email);
    expect(row?.terms_accepted_at).toBeTruthy();
    expect(row?.email_verified_at).toBeTruthy();
    expect(row?.marketing_consent).toBe(0);
    const name = (await db.prepare(`SELECT name FROM residents WHERE email = ?`).get(email)) as { name: string };
    expect(name.name).toBe("Niamh");
  });

  it("records marketing consent only when explicitly given", async () => {
    const email = freshEmail("marketing");
    const { token } = await createLoginToken(email);
    const { completionToken } = (await (await post("/guest/verify", { token })).json()) as { completionToken: string };
    await post("/guest/verify/complete", { completionToken, name: "", termsAccepted: true, marketingConsent: true });
    expect((await residentRow(email))?.marketing_consent).toBe(1);
  });

  it("the completion token is single-use and rejects an unknown token", async () => {
    const email = freshEmail("reuse");
    const { token } = await createLoginToken(email);
    const { completionToken } = (await (await post("/guest/verify", { token })).json()) as { completionToken: string };
    expect((await post("/guest/verify/complete", { completionToken, termsAccepted: true })).status).toBe(200);
    expect((await post("/guest/verify/complete", { completionToken, termsAccepted: true })).status).toBe(400);
    expect((await post("/guest/verify/complete", { completionToken: "nope", termsAccepted: true })).status).toBe(400);
  });
});

describe("POST /guest/verify — returning resident", () => {
  it("signs straight in without asking for Terms and does not fabricate consent on a legacy row", async () => {
    const email = freshEmail("returning");
    await db.prepare(`INSERT INTO residents (id, email) VALUES (?, ?)`).run(crypto.randomUUID(), email);

    const { token } = await createLoginToken(email);
    const res = await post("/guest/verify", { token });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("signed_in");
    expect(res.headers.get("set-cookie")).toContain("hello_circle_guest_session");

    const row = await residentRow(email);
    expect(row?.terms_accepted_at).toBeNull();
    expect(row?.email_verified_at).toBeTruthy();
  });
});

describe("POST /guest/verify — native app (legacy shape preserved)", () => {
  it("still creates the account immediately but never fabricates a Terms timestamp", async () => {
    const email = freshEmail("native");
    const { token } = await createLoginToken(email);
    const res = await post("/guest/verify", { token }, { "X-Client-Platform": "mobile" });
    const body = (await res.json()) as { email: string; token: string; status?: string };
    expect(body.email).toBe(email);
    expect(body.token).toBeTruthy();
    expect(body.status).toBeUndefined();
    expect((await residentRow(email))?.terms_accepted_at).toBeNull();
  });
});

describe("POST /residents/me/resend-verification", () => {
  it("reports alreadyVerified for a verified resident and sends nothing new", async () => {
    const email = freshEmail("verified");
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO residents (id, email, email_verified_at) VALUES (?, ?, NOW())`).run(id, email);
    const res = await post("/residents/me/resend-verification", {}, { "X-Test-Resident-Id": id });
    expect(await res.json()).toEqual({ ok: true, alreadyVerified: true });
    const tokens = (await db.prepare(`SELECT token FROM guest_login_tokens WHERE email = ?`).all(email)) as unknown[];
    expect(tokens).toHaveLength(0);
  });

  it("creates a fresh single-use token for an unverified resident and requires a resident session", async () => {
    const email = freshEmail("unverified");
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO residents (id, email) VALUES (?, ?)`).run(id, email);

    expect((await post("/residents/me/resend-verification", {})).status).toBe(401);

    const res = await post("/residents/me/resend-verification", {}, { "X-Test-Resident-Id": id });
    expect(await res.json()).toEqual({ ok: true, alreadyVerified: false });
    const tokens = (await db.prepare(`SELECT token FROM guest_login_tokens WHERE email = ?`).all(email)) as unknown[];
    expect(tokens).toHaveLength(1);
  });
});
