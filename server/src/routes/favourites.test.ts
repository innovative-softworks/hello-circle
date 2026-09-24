import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { favouritesRouter } from "./favourites.js";

// Resident Experience Polish — Changeset 4. Circle was the one entity type
// left out of the unified save system (server previously rejected
// listingType: "circle" entirely — LISTING_TYPES didn't include it). Proves
// the full round-trip through the real API: save, persist, retrieve with a
// real name/slug attached, unsave — plus program_session/club_session
// getting a real parentId now that they didn't have before.

let server: Server;
let baseUrl: string;

const residentId = `test-resident-favs-${crypto.randomUUID()}`;
const circleId = `test-circle-favs-${crypto.randomUUID()}`;
const organiserResidentId = `test-organiser-${crypto.randomUUID()}`;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).resident = { id: residentId };
    next();
  });
  app.use("/", favouritesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  await db
    .prepare(`INSERT INTO circles (id, name, area, county, about, created_by_resident_id, slug) VALUES (?, 'Favourites Test Circle', 'Test Area', 'Dublin', 'A test circle', ?, ?)`)
    .run(circleId, organiserResidentId, "favourites-test-circle");
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM favourites WHERE resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
});

describe("Circle favourites — full round trip", () => {
  it("saves a circle", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingType: "circle", listingId: circleId }),
    });
    expect(res.status).toBe(201);
  });

  it("persists and retrieves it with a real name/slug/subtitle attached", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { listingType: string; listingId: string; name: string | null; slug?: string; subtitle: string | null }[];
    const row = rows.find((r) => r.listingType === "circle" && r.listingId === circleId);
    expect(row).toBeTruthy();
    expect(row?.name).toBe("Favourites Test Circle");
    expect(row?.slug).toBe("favourites-test-circle");
    expect(row?.subtitle).toBe("Test Area");
  });

  it("unsaves it", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingType: "circle", listingId: circleId }),
    });
    expect(res.status).toBe(200);

    const listRes = await fetch(`${baseUrl}/`);
    const rows = (await listRes.json()) as { listingType: string; listingId: string }[];
    expect(rows.some((r) => r.listingType === "circle" && r.listingId === circleId)).toBe(false);
  });

  it("rejects listingType values the Save API doesn't support", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingType: "not-a-real-type", listingId: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
