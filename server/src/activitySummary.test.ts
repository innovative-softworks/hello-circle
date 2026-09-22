import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clubSessionToActivitySummary,
  experienceToActivitySummary,
  gameToActivitySummary,
  listUpcomingExperienceSessionRows,
  programSessionToActivitySummary,
  type ExperienceSessionRow,
} from "./activitySummary.js";
import { db } from "./db/index.js";
import type { ClubSessionRow, GameRow, ProgramSessionRow } from "./db/queries.js";

// Phase 1 "Connect" — the three fixture-based adapters are pure functions
// (no DB access), matching the codebase's existing pure-function test
// convention (see capacity.test.ts). listUpcomingExperienceSessionRows does
// hit the DB (it's new — Experiences were never part of the existing
// ScheduledActivity query), so that one gets a small real-DB test instead.

describe("gameToActivitySummary", () => {
  const row: GameRow = {
    id: "test-game-1",
    activity_label: "Beginner Badminton",
    date: "2099-01-01",
    time: "18:00",
    price_cents: 500,
    capacity: 10,
    image_url: "https://example.test/image.jpg",
    centre_name: "Test Centre",
    area: "Test Area",
    county: "Dublin",
    joined: 3,
    lat: "53.349805",
    lng: "-6.260310",
  };

  it("maps kind, capacity math, and canonical URL correctly", () => {
    const summary = gameToActivitySummary(row, new Date("2098-01-01"));
    expect(summary.kind).toBe("game");
    expect(summary.href).toBe("/games/test-game-1");
    expect(summary.canonicalUrl).toBe("/games/test-game-1");
    expect(summary.spotsLeft).toBe(7);
    expect(summary.joined).toBe(3);
    expect(summary.lat).toBe(53.349805);
    expect(summary.lng).toBe(-6.26031);
    expect(summary.centreName).toBe("Test Centre");
    expect(summary.clubName).toBeNull();
  });

  it("never returns a negative spotsLeft when overbooked", () => {
    const summary = gameToActivitySummary({ ...row, joined: 15 }, new Date("2098-01-01"));
    expect(summary.spotsLeft).toBe(0);
  });

  it("leaves the new host/vendor/circle fields null (not carried by GameRow today)", () => {
    const summary = gameToActivitySummary(row, new Date("2098-01-01"));
    expect(summary.host).toBeNull();
    expect(summary.hostVerified).toBeNull();
    expect(summary.vendorName).toBeNull();
    expect(summary.circleId).toBeNull();
  });
});

describe("programSessionToActivitySummary", () => {
  const centreRow: ProgramSessionRow = {
    id: "test-session-1",
    date: "2099-01-01",
    time: "10:00",
    title: "Test Program",
    price_cents: 2000,
    listing_type: "centre",
    image_url: "",
    listing_name: "Test Centre",
    area: "Test Area",
    county: "Cork",
    duration_minutes: 90,
    lat: null,
    lng: null,
  };

  it("puts a centre-attached program's listing name under centreName, not clubName", () => {
    const summary = programSessionToActivitySummary(centreRow);
    expect(summary.centreName).toBe("Test Centre");
    expect(summary.clubName).toBeNull();
    expect(summary.spotsLeft).toBeNull(); // one enrollment covers every session — no per-session capacity concept
  });

  it("puts a club-attached program's listing name under clubName, not centreName", () => {
    const summary = programSessionToActivitySummary({ ...centreRow, listing_type: "club" });
    expect(summary.clubName).toBe("Test Centre");
    expect(summary.centreName).toBeNull();
  });
});

describe("clubSessionToActivitySummary", () => {
  const row: ClubSessionRow = {
    id: "test-cs-1",
    day_of_week: 3,
    time: "17:00",
    label: "",
    image_url: "",
    club_id: "test-club-1",
    club_name: "Test Club",
    area: "Test Area",
    county: "Galway",
    price: 12.5,
    lat: null,
    lng: null,
  };

  it("falls back to the club name when the session has no label", () => {
    const summary = clubSessionToActivitySummary(row, new Date("2098-01-01"));
    expect(summary.title).toBe("Test Club");
    expect(summary.href).toBe("/clubs/test-club-1");
  });

  it("converts euro price to cents", () => {
    const summary = clubSessionToActivitySummary(row, new Date("2098-01-01"));
    expect(summary.priceCents).toBe(1250);
  });

  it("resolves to the next occurrence of the session's weekday, not a stored date", () => {
    const summary = clubSessionToActivitySummary(row, new Date("2098-01-01"));
    expect(new Date(summary.date).getUTCDay()).toBe(3);
  });
});

describe("experienceToActivitySummary + listUpcomingExperienceSessionRows", () => {
  const testVendorId = `test-vendor-${crypto.randomUUID()}`;
  const testExperienceId = `test-experience-${crypto.randomUUID()}`;
  const testSessionId = `test-session-${crypto.randomUUID()}`;

  beforeAll(async () => {
    await db
      .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, provider_tier) VALUES (?, ?, 'x', 'vendor', 'approved', 'Test Vendor', 'verified')`)
      .run(testVendorId, `${testVendorId}@example.test`);
    await db
      .prepare(
        `INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, county, status)
         VALUES (?, ?, 'Test Coastal Walk', 'A test blurb', 'A test description', '', '', '', '', '', '', '', '', '', 3000, 8, 'Wicklow', 'approved')`
      )
      .run(testExperienceId, testVendorId);
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '09:00')`).run(testSessionId, testExperienceId, future);
  });

  afterAll(async () => {
    await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(testExperienceId);
    await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(testExperienceId);
    await db.prepare(`DELETE FROM users WHERE id = ?`).run(testVendorId);
  });

  it("lists an upcoming scheduled session for an approved experience", async () => {
    const from = new Date();
    const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const rows = await listUpcomingExperienceSessionRows({ from, to, county: "Wicklow" });
    expect(rows.some((r) => r.id === testSessionId)).toBe(true);
  });

  it("maps a session row to a well-formed ActivitySummary, including vendor verification", () => {
    const row: ExperienceSessionRow = {
      id: testSessionId,
      date: "2099-06-01",
      time: "09:00",
      capacity: null,
      experience_id: testExperienceId,
      title: "Test Coastal Walk",
      price_cents: 3000,
      image_url: "",
      area: "",
      county: "Wicklow",
      lat: null,
      lng: null,
      booked: 2,
      vendor_business_name: "",
      vendor_name: "Test Vendor",
      vendor_provider_tier: "verified",
    };
    const summary = experienceToActivitySummary({ ...row, experience_capacity: 8 });
    expect(summary.kind).toBe("experience_session");
    expect(summary.href).toBe(`/experiences/${testExperienceId}`);
    expect(summary.spotsLeft).toBe(6); // falls back to the parent experience's capacity when the session has none of its own
    expect(summary.vendorName).toBe("Test Vendor");
    expect(summary.hostVerified).toBe(true);
  });

  it("treats a standard-tier vendor as unverified", () => {
    const row: ExperienceSessionRow = {
      id: testSessionId,
      date: "2099-06-01",
      time: "09:00",
      capacity: 5,
      experience_id: testExperienceId,
      title: "Test Coastal Walk",
      price_cents: 3000,
      image_url: "",
      area: "",
      county: "Wicklow",
      lat: null,
      lng: null,
      booked: 0,
      vendor_business_name: "",
      vendor_name: "Test Vendor",
      vendor_provider_tier: "standard",
    };
    const summary = experienceToActivitySummary(row);
    expect(summary.hostVerified).toBe(false);
    expect(summary.spotsLeft).toBe(5);
  });
});
