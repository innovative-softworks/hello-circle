import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { vendorExperiencesRouter } from "./vendorExperiences.js";
import { vendorInsightsRouter } from "./vendorInsights.js";
import { vendorOperationsRouter } from "./vendorOperations.js";
import { vendorProgramsRouter } from "./vendorPrograms.js";

// Security decision Option A (2026-10-17) — which partner staff role may read
// customer personal data. Owners are unrestricted; every route stays scoped
// to the organisation's own listings.

let server: Server;
let baseUrl: string;
const t = crypto.randomUUID().slice(0, 8);
const owner = `test-pii-owner-${t}`;
const centre = `c-pii-${t}`;
const ref = `HBPII-${t}`;
const email = `pii-${t}@example.test`;
const ROLES = ["owner", "centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;
type Role = (typeof ROLES)[number];

const get = async (path: string, role: Role) => {
  const r = await fetch(`${baseUrl}/vendor${path}`, { headers: role === "owner" ? {} : { "X-Staff-Role": role } });
  return { status: r.status, text: await r.text() };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const staffRole = req.header("X-Staff-Role");
    (req as any).user = { id: owner, role: "vendor", status: "approved", invitedStaff: !!staffRole, platformRole: staffRole ?? null };
    (req as any).vendorIds = [owner];
    next();
  });
  for (const r of [vendorOperationsRouter, vendorInsightsRouter, vendorExperiencesRouter, vendorProgramsRouter]) app.use("/vendor", r);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'V')`).run(owner, `${owner}@example.test`);
  await db.prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'PII Centre', 'A', 'Dublin', 0, 0, 1, 1, 'M', '', '', '', ?, 'approved')`).run(centre, owner);
  await db
    .prepare(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status) VALUES (?, 'c', ?, 'r', ?, '10:00', 1, 'M', 4, 'Pii Person', ?, '0851234567', '', 2500, 'confirmed', 'paid')`)
    .run(ref, centre, irelandTodayIso(), email);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(ref);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centre);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(owner);
});

describe("Option A — customer data by staff role", () => {
  const ORDER: Role[] = ["owner", "centre_manager", "facility_manager", "finance"];
  const ROSTER: Role[] = ["owner", "centre_manager", "facility_manager"];
  const CUSTOMER: Role[] = [...ORDER, "communications"];
  const roleRefused = (r: { status: number; text: string }) => r.status === 403 && r.text.includes("Not authorized for this role");

  it.each([
    ["/orders", ORDER],
    ["/bookings", ORDER],
    ["/registrations", ORDER],
    [`/bookings/${ref}/changes`, ORDER],
    ["/customers", CUSTOMER],
    [`/customers/${encodeURIComponent(email)}`, CUSTOMER],
    ["/participants", CUSTOMER],
    ["/experiences/x/bookings", ROSTER],
    ["/programs/x/enrollments", ROSTER],
    ["/clubs/x/participants", ROSTER],
    ["/clubs/x/waitlist", ROSTER],
  ] as [string, Role[]][])("%s", async (path, allowed) => {
    for (const role of ROLES) {
      const r = await get(path, role);
      if (allowed.includes(role)) expect(roleRefused(r), `${role} ${path} allowed`).toBe(false);
      else {
        expect(roleRefused(r), `${role} ${path} refused`).toBe(true);
        expect(r.text).not.toContain(email);
      }
    }
    expect((await get(path, "owner")).text.includes(email) || !path.match(/^\/(orders|bookings|customers|participants)$/)).toBe(true);
  });

  it("bookings CSV: contact columns for finance and the owner; none for the analyst; others refused", async () => {
    for (const role of ROLES) {
      const r = await get("/reports/bookings.csv", role);
      if (role === "owner" || role === "finance") expect(r.text).toContain(email);
      else if (role === "read_only_analyst") {
        expect(r.status).toBe(200);
        expect(r.text.split("\n")[0]).toBe("ref,centre,date,time,duration,guests,total_euro,status");
        expect(r.text).toContain(ref);
        expect(r.text).not.toContain(email);
        expect(r.text).not.toContain("Pii Person");
      } else expect(r.status).toBe(403);
    }
  });

  it("Overview 'today': every role sees the booking; only customer roles see the name", async () => {
    for (const role of ROLES) {
      const body = JSON.parse((await get("/today", role)).text);
      const b = body.bookings.find((x: { ref: string }) => x.ref === ref);
      expect(b, role).toBeTruthy();
      expect(b.name, role).toBe(CUSTOMER.includes(role) ? "Pii Person" : null);
      expect(b.guests).toBe(4);
    }
  });
});
