import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { HOST_PAYOUTS_NOT_ELIGIBLE, hostPayoutsRouter } from "./payouts.js";

// Sitemap audit P2-17 — only residents who can actually earn may start host
// payout onboarding: a verified host, or anyone who has hosted a priced
// activity. The Connect switch stays off here, so an eligible resident gets
// the existing "switch off" refusal (409) and no payout account is ever made;
// an ineligible one is refused first, with 403.

const run = crypto.randomUUID().slice(0, 8);
const verified = `test-hp-verified-${run}`;
const paidHost = `test-hp-paid-${run}`;
const freeHost = `test-hp-free-${run}`;
const nobody = `test-hp-none-${run}`;
const games = [`test-hp-game-paid-${run}`, `test-hp-game-free-${run}`];
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  for (const [id, status] of [[verified, "verified"], [paidHost, "none"], [freeHost, "pending"], [nobody, "none"]] as const) {
    await db.prepare(`INSERT INTO residents (id, email, name, host_status) VALUES (?, ?, 'HP', ?)`).run(id, `${id}@example.test`, status);
  }
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'Paid', '2099-07-02', '10:00', 5, 'open', 800)`).run(games[0], paidHost);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, price_cents) VALUES (?, ?, 'Free', '2099-07-02', '10:00', 5, 'open', 0)`).run(games[1], freeHost);
  await setSetting("commerce.connect_v1", "false");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, email: `${id}@example.test` };
    next();
  });
  app.use("/host/payout-account", hostPayoutsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(...games);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?, ?)`).run(verified, paidHost, freeHost, nobody);
});

const onboard = (residentId?: string) =>
  fetch(`${baseUrl}/host/payout-account/onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(residentId ? { "X-Test-Resident-Id": residentId } : {}) },
    body: "{}",
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as { error?: string } }));

describe("host payout onboarding eligibility", () => {
  it("lets a verified host through to onboarding", async () => {
    expect((await onboard(verified)).status).not.toBe(403);
  });

  it("lets an unverified host who has hosted a priced activity through", async () => {
    expect((await onboard(paidHost)).status).not.toBe(403);
  });

  it("refuses a resident with no verification and no priced activity", async () => {
    for (const id of [freeHost, nobody]) {
      const r = await onboard(id);
      expect(r.status).toBe(403);
      expect(r.body.error).toBe(HOST_PAYOUTS_NOT_ELIGIBLE);
    }
  });

  it("still requires sign-in, and viewing the overview stays open", async () => {
    expect((await onboard()).status).toBe(401);
    const overview = await fetch(`${baseUrl}/host/payout-account`, { headers: { "X-Test-Resident-Id": nobody } });
    expect(overview.status).toBe(200);
  });
});
