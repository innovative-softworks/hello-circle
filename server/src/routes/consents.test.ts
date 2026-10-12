import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentConsents } from "../consent.js";
import { db } from "../db/index.js";
import { residentAllows } from "../notifications.js";
import { createResidentWithPassword } from "../residents.js";
import { consentsRouter } from "./consents.js";
import { policiesRouter } from "./policies.js";
import { residentsRouter } from "./residents.js";

// Revenue & Connect Stage 5c — five separate records: contractual policy
// acceptance, privacy acknowledgement, marketing consent, analytics-cookie
// consent and advertising-cookie consent. None is ever implied by another.

const run = crypto.randomUUID().slice(0, 8);
const client = crypto.randomUUID();
let residentId = "";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  residentId = (await createResidentWithPassword(`consent-${run}@example.test`, "x", "Consent Resident", true, false)).id;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.header("X-Test-Resident")) (req as any).resident = { id: residentId, email: `consent-${run}@example.test`, name: "Consent Resident" };
    next();
  });
  app.use("/consents", consentsRouter);
  app.use("/policies", policiesRouter);
  app.use("/residents", residentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`UPDATE policy_versions SET status = 'draft', published_body = NULL, content_hash = NULL, published_at = NULL WHERE doc_key = 'privacy-policy' AND version = 1`).run();
  await db.prepare(`DELETE FROM consent_records WHERE subject_id IN (?, ?)`).run(residentId, client);
  await db.prepare(`DELETE FROM policy_acceptances WHERE subject_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(residentId);
});

const call = (method: string, path: string, body?: unknown, resident = true) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(resident ? { "X-Test-Resident": "1" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

describe("marketing consent", () => {
  it("is off after a signup that didn't opt in — and accepting the Terms grants nothing", async () => {
    const c = await currentConsents({ type: "resident", id: residentId });
    expect(c.marketing_email).toMatchObject({ granted: false, source: "signup_password" });
    expect(c.analytics_cookies.granted).toBe(false);
    expect(c.advertising_cookies.granted).toBe(false);
    expect(c.privacy_notice_ack.granted).toBe(false);
    const terms = (await db.prepare(`SELECT terms_accepted_at as t FROM residents WHERE id = ?`).get(residentId)) as { t: string | null };
    expect(terms.t).not.toBeNull(); // the contract was accepted…
    expect(await residentAllows(residentId, "marketing")).toBe(false); // …but marketing stays off, even with no prefs saved
  });

  it("the notification-settings toggle records consent only when it changes, and isn't stored as a notification pref", async () => {
    expect((await call("PUT", "/residents/me/notification-prefs", { bookingReminders: false, marketing: true })).status).toBe(200);
    expect((await call("PUT", "/residents/me/notification-prefs", { bookingReminders: false, marketing: true })).status).toBe(200);
    const rows = (await db.prepare(`SELECT granted, source FROM consent_records WHERE subject_id = ? AND purpose = 'marketing_email' ORDER BY id`).all(residentId)) as { granted: number; source: string }[];
    expect(rows.map((r) => [Number(r.granted), r.source])).toEqual([
      [0, "signup_password"],
      [1, "notification_settings"],
    ]);
    const prefs = (await db.prepare(`SELECT notification_prefs as p, marketing_consent as m FROM residents WHERE id = ?`).get(residentId)) as { p: string; m: number };
    expect(JSON.parse(prefs.p)).toEqual({ bookingReminders: false });
    expect(Number(prefs.m)).toBe(1); // legacy mirror column kept in step
    const me = await call("GET", "/residents/me");
    expect(me.body.resident.notificationPrefs).toMatchObject({ bookingReminders: false, marketing: true });
    expect(await residentAllows(residentId, "marketing")).toBe(true);
    await call("PUT", "/consents/me/marketing", { granted: false });
    expect(await residentAllows(residentId, "marketing")).toBe(false);
  });
});

describe("cookie consent", () => {
  it("records analytics and advertising as separate purposes, for the browser and the signed-in person", async () => {
    expect((await call("POST", "/consents/cookies", { analytics: true })).status).toBe(400);
    expect((await call("POST", "/consents/cookies", { analytics: true, advertising: false })).status).toBe(200);
    const browser = await currentConsents({ type: "client", id: client });
    expect([browser.analytics_cookies.granted, browser.advertising_cookies.granted]).toEqual([true, false]);
    const person = await currentConsents({ type: "resident", id: residentId });
    expect([person.analytics_cookies.granted, person.advertising_cookies.granted, person.marketing_email.granted]).toEqual([true, false, false]);
    // Turning advertising on later doesn't touch analytics' history.
    await call("POST", "/consents/cookies", { analytics: false, advertising: true }, false);
    const after = await currentConsents({ type: "client", id: client });
    expect([after.analytics_cookies.granted, after.advertising_cookies.granted]).toEqual([false, true]);
  });
});

describe("privacy acknowledgement", () => {
  it("is asked for separately from contract acceptance, and recorded as an acknowledgement — not an acceptance", async () => {
    // Publish privacy notice v1 directly (the CMS publication gates are covered in policies.test.ts).
    await db.prepare(`UPDATE policy_versions SET status = 'published', published_body = body, content_hash = REPEAT('a', 64), published_at = NOW() WHERE doc_key = 'privacy-policy' AND version = 1`).run();
    const pending = await call("GET", "/policies/acceptance/pending");
    expect(pending.body.resident).toEqual(expect.arrayContaining([expect.objectContaining({ docKey: "privacy-policy", kind: "acknowledge", version: 1 })]));
    expect((await call("POST", "/policies/privacy-policy/accept", { version: 1, as: "resident" })).status).toBe(400);
    expect((await call("POST", "/policies/privacy-policy/acknowledge", { version: 1, as: "resident" })).status).toBe(200);
    const acceptances = (await db.prepare(`SELECT COUNT(*) as n FROM policy_acceptances WHERE subject_id = ? AND doc_key = 'privacy-policy'`).get(residentId)) as { n: number };
    expect(Number(acceptances.n)).toBe(0);
    const c = await currentConsents({ type: "resident", id: residentId });
    expect(c.privacy_notice_ack).toMatchObject({ granted: true, policyDocKey: "privacy-policy", policyVersion: 1 });
    expect(c.marketing_email.granted).toBe(false); // acknowledging the notice consents to nothing
    const after = await call("GET", "/policies/acceptance/pending");
    expect(after.body.resident.map((p: { docKey: string }) => p.docKey)).not.toContain("privacy-policy");
    // A contract can't be "acknowledged" instead of accepted.
    expect((await call("POST", "/policies/general-terms/acknowledge", { version: 1, as: "resident" })).status).toBe(400);
  });
});
