import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { applyReportAction, ModerationError } from "../reportModeration.js";
import { reportsRouter } from "./reports.js";

// Detail-page audit (2026-10-22): a host or provider can now be reported from
// their public page, and those reports are review-only — no one-click
// "suspend" for a person.

let server: Server;
let baseUrl: string;
const clientId = `test-client-dpa-${crypto.randomUUID()}`;
const hostId = `test-dpa-host-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/reports", reportsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'DPA Host')`).run(hostId, `${hostId}@example.test`);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM reports WHERE reporter_client_id = ?`).run(clientId);
  await db.prepare(`DELETE FROM residents WHERE id = ?`).run(hostId);
});

const report = (targetType: string, targetId: string) =>
  fetch(`${baseUrl}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
    body: JSON.stringify({ targetType, targetId, reason: "Something's not right" }),
  });

describe("reporting a host (DP-06)", () => {
  it("accepts a report on a real host and refuses an unknown one", async () => {
    expect((await report("host", hostId)).status).toBe(201);
    expect((await report("host", "no-such-host")).status).toBe(404);
  });

  it("is review-only: the suspend action is refused with a pointer to the right tool", async () => {
    await expect(applyReportAction({ id: 1, targetType: "host", targetId: hostId }, "admin", { reasonCategory: "other", explanation: "x" } as never)).rejects.toBeInstanceOf(ModerationError);
  });
});
