import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { reportsRouter } from "./reports.js";

// Resident Experience Polish — Changeset 7. Reviews.tsx's new "Report" action
// calls the already-existing generic moderation-report API — this proves
// that a review-targeted report round-trips correctly (created with the
// right target_type/target_id, retrievable via /mine) rather than testing
// new server code (there isn't any).

let server: Server;
let baseUrl: string;

const clientId = `test-client-report-${crypto.randomUUID()}`;
const reviewId = 999000 + Math.floor(Math.random() * 1000);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/reports", reportsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM reports WHERE reporter_client_id = ?`).run(clientId);
});

describe("POST /reports — review reporting", () => {
  it("creates a review-targeted report and returns it from /mine", async () => {
    const createRes = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ targetType: "review", targetId: String(reviewId), reason: "Spam or fake" }),
    });
    expect(createRes.status).toBe(201);
    expect(await createRes.json()).toEqual({ ok: true });

    const mineRes = await fetch(`${baseUrl}/reports/mine`, { headers: { "X-Client-Id": clientId } });
    expect(mineRes.status).toBe(200);
    const mine = await mineRes.json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ targetType: "review", targetId: String(reviewId), reason: "Spam or fake", status: "pending" });
  });

  it("rejects a report missing a reason", async () => {
    const res = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
      body: JSON.stringify({ targetType: "review", targetId: String(reviewId) }),
    });
    expect(res.status).toBe(400);
  });
});

// Circle Experience Polish — Changeset 4/6. CircleDetail.tsx's new "Report
// this Circle" action reuses this exact same generic endpoint with
// targetType: "circle" — proves the round-trip works for that target type
// too (the admin-side case-viewer already handled "circle", per the audit).
describe("POST /reports — circle reporting", () => {
  const circleClientId = `test-client-circle-report-${crypto.randomUUID()}`;
  const circleTargetId = `test-circle-report-target-${crypto.randomUUID()}`;

  afterAll(async () => {
    await db.prepare(`DELETE FROM reports WHERE reporter_client_id = ?`).run(circleClientId);
  });

  it("creates a circle-targeted report and returns it from /mine", async () => {
    const createRes = await fetch(`${baseUrl}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": circleClientId },
      body: JSON.stringify({ targetType: "circle", targetId: circleTargetId, reason: "Inappropriate content" }),
    });
    expect(createRes.status).toBe(201);

    const mineRes = await fetch(`${baseUrl}/reports/mine`, { headers: { "X-Client-Id": circleClientId } });
    const mine = (await mineRes.json()) as { targetType: string; targetId: string; reason: string }[];
    expect(mine.some((r) => r.targetType === "circle" && r.targetId === circleTargetId && r.reason === "Inappropriate content")).toBe(true);
  });

  it("a duplicate-report check against /mine correctly finds the existing report (client-side dedup source)", async () => {
    const mineRes = await fetch(`${baseUrl}/reports/mine`, { headers: { "X-Client-Id": circleClientId } });
    const mine = (await mineRes.json()) as { targetType: string; targetId: string }[];
    const alreadyReported = mine.some((r) => r.targetType === "circle" && r.targetId === circleTargetId);
    expect(alreadyReported).toBe(true);
  });
});
