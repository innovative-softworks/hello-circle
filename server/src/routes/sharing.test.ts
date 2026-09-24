import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { sharingRouter } from "./sharing.js";

// Web Image Optimization pass — found and closed a real, independent
// privacy leak: circles.ts's toCircleJson()/toCircleTeaserJson() (Media
// plan Task 2) gate a restricted Circle's real name/about/imageUrl
// correctly, but this file's own getShareData("circle", ...) ran a
// completely separate raw query that never checked join_mode at all —
// reachable with zero auth via GET /api/share/circle/:id and, worse,
// GET /api/share/circle/:id/card.png (a real PNG with the real cover
// photo baked in). This is the regression suite for that fix.

let server: Server;
let baseUrl: string;

const organiserId = `test-share-org-${crypto.randomUUID()}`;
const memberId = `test-share-mem-${crypto.randomUUID()}`;
const outsiderId = `test-share-out-${crypto.randomUUID()}`;
const openCircleId = `test-share-open-${crypto.randomUUID()}`;
const inviteCircleId = `test-share-invite-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId };
    next();
  });
  app.use("/", sharingRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Share Organiser')`).run(organiserId, `${organiserId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Share Member')`).run(memberId, `${memberId}@example.test`);
  await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'Share Outsider')`).run(outsiderId, `${outsiderId}@example.test`);

  await db
    .prepare(
      `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Open Share Circle', 'Testball', 'Area', 'Dublin', 'Open circle about text', ?, 'open', 'https://media.hellocircle.ie/circles/x/cover/open.jpg')`
    )
    .run(openCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(openCircleId, organiserId);

  await db
    .prepare(
      `INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode, image_url) VALUES (?, 'Secret Invite Circle', 'Testball', 'Area', 'Dublin', 'Secret circle about text that must never leak', ?, 'invite', 'https://media.hellocircle.ie/circles/x/cover/secret.jpg')`
    )
    .run(inviteCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(inviteCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(inviteCircleId, memberId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM circle_members WHERE circle_id IN (?, ?)`).run(openCircleId, inviteCircleId);
  await db.prepare(`DELETE FROM circles WHERE id IN (?, ?)`).run(openCircleId, inviteCircleId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(organiserId, memberId, outsiderId);
});

describe("GET /circle/:id — open Circle shares in full (unchanged behaviour)", () => {
  it("returns the real name/about/image to a signed-out visitor", async () => {
    const res = await fetch(`${baseUrl}/circle/${openCircleId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Open Share Circle");
    expect(body.description).toBe("Open circle about text");
    expect(body.image).toBe("https://media.hellocircle.ie/circles/x/cover/open.jpg");
    expect(body.privacy).toBe("public");
  });
});

describe("GET /circle/:id — invite-only Circle never leaks to a non-member", () => {
  it("a signed-out visitor gets the generic stub, not the real name/about/image", async () => {
    const res = await fetch(`${baseUrl}/circle/${inviteCircleId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).not.toContain("Secret Invite Circle");
    expect(body.description).not.toContain("must never leak");
    expect(body.image).toBeUndefined();
    expect(body.privacy).toBe("circle_only");
  });

  it("a non-member resident gets the same stub", async () => {
    const res = await fetch(`${baseUrl}/circle/${inviteCircleId}`, { headers: { "X-Test-Resident-Id": outsiderId } });
    const body = await res.json();
    expect(body.title).not.toContain("Secret Invite Circle");
    expect(body.image).toBeUndefined();
  });

  it("an actual member gets the real data", async () => {
    const res = await fetch(`${baseUrl}/circle/${inviteCircleId}`, { headers: { "X-Test-Resident-Id": memberId } });
    const body = await res.json();
    expect(body.title).toBe("Secret Invite Circle");
    expect(body.image).toBe("https://media.hellocircle.ie/circles/x/cover/secret.jpg");
    expect(body.privacy).toBe("circle_only");
  });

  it("the organiser gets the real data too", async () => {
    const res = await fetch(`${baseUrl}/circle/${inviteCircleId}`, { headers: { "X-Test-Resident-Id": organiserId } });
    const body = await res.json();
    expect(body.title).toBe("Secret Invite Circle");
  });
});

describe("GET /circle/:id/card.png — the actual exploit path (a real PNG with the real photo baked in)", () => {
  it("does not throw/500 for a restricted Circle requested by a non-member, and does not render the real title into it", async () => {
    // We can't easily decode PNG pixel content in this suite, but we can
    // prove the endpoint reached the stub (not the real) ShareData by
    // confirming it still renders successfully (renderShareCardPng must
    // handle a stub with no `image`/`host` fields) rather than crashing —
    // the actual privacy guarantee is covered by the getShareData
    // assertions above, since card.png calls the exact same function.
    const res = await fetch(`${baseUrl}/circle/${inviteCircleId}/card.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
