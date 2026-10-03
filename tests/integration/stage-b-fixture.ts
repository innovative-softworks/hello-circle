import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect } from "@playwright/test";
import { withActors } from "./authorization-fixture";
import { env, personas } from "./fixtures";

export type Scope = Parameters<Parameters<typeof withActors>[2]>[0];
export const FUTURE = "2030-06-20";

/** Synthetic invited staff (or independent owner when role is null) in the
 * owner's organisation, real bcrypt + real login. Counts toward the limiter. */
export async function staffLogin(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, owner: string | null, platformRole: string | null, opened: APIRequestContext[]) {
  const id = randomUUID(), password = randomBytes(32).toString("hex"), email = `qa_stageb_${id}@example.test`;
  let orgId: string;
  if (owner) {
    const [rows] = await f.connection.query<any[]>("SELECT org_id FROM users WHERE id = ?", [personas[owner].id]);
    orgId = rows[0].org_id; expect(!!orgId).toBe(true);
  } else {
    orgId = randomUUID();
    await f.connection.execute("INSERT INTO organisations (id, name, kind) VALUES (?, 'QA synthetic org', 'vendor')", [orgId]);
    f.track("organisations", "id", orgId);
  }
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', 'QA stage B staff', ?, ?, ?)",
    [id, email, bcrypt.hashSync(password, 10), orgId, platformRole, owner ? 1 : 0]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  const context = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
  opened.push(context);
  expect((await context.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  return { id, email, orgId, context };
}

export async function centreFor(f: Scope, role: string) {
  const response = await f.actors[role].post("/api/vendor/centres", { data: { name: `QA stage B ${randomUUID()}`, paymentMethod: "cash" } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).id as string;
  for (const [table, column] of [["centres", "id"], ["rooms", "centre_id"], ["room_blocks", "centre_id"], ["centre_hours", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["bookings", "centre_id"]]) f.track(table, column, id);
  const rooms = await (await f.actors[role].get(`/api/vendor/centres/${id}/rooms`)).json();
  return { id, room: rooms[0].id as string };
}

export async function programFor(f: Scope, role: string, centre: string) {
  const response = await f.actors[role].post("/api/vendor/programs", { data: { listingType: "centre", listingId: centre, title: "QA stage B programme", description: "Synthetic authorization only" } });
  expect(response.status()).toBe(201);
  const id = (await response.json()).id as string;
  f.track("programs", "id", id); f.track("program_sessions", "program_id", id); f.track("program_enrollments", "program_id", id);
  return id;
}

export async function experienceFor(f: Scope, role: string) {
  const id = randomUUID();
  await f.connection.execute(`INSERT INTO experiences (id, vendor_id, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
    VALUES (?, ?, 'QA stage B experience', '', '', '', '', '', '', '', '', '', '', '', 'draft')`, [id, personas[role].id]);
  for (const [table, column] of [["experiences", "id"], ["experience_sessions", "experience_id"], ["experience_bookings", "experience_id"], ["experience_images", "experience_id"]]) f.track(table, column, id);
  return id;
}

export async function clubFor(f: Scope, role: string, status = "approved") {
  const id = randomUUID();
  await f.connection.execute(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, blurb, vendor_id, status)
    VALUES (?, ?, 'QA', 'QA', 'Dublin', 'All', 0, 'year', 0, '', 'Synthetic', ?, ?)`, [id, `QA stage B club ${id}`, personas[role].id, status]);
  for (const [table, column] of [["clubs", "id"], ["club_sessions", "club_id"], ["club_images", "club_id"], ["club_includes", "club_id"], ["registrations", "club_id"]]) f.track(table, column, id);
  return id;
}

export async function residentCircle(f: Scope, organiser: string, joinMode = "invite") {
  const id = randomUUID();
  await f.connection.execute("INSERT INTO circles (id, name, about, created_by_resident_id, join_mode, status) VALUES (?, ?, 'Synthetic', ?, ?, 'active')", [id, `QA stage B circle ${id}`, personas[organiser].id, joinMode]);
  await f.connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')", [id, personas[organiser].id]);
  f.track("circles", "id", id); f.track("circle_members", "circle_id", id);
  return id;
}

export async function paidBooking(f: Scope, centre: { id: string; room: string }, opts: { stripe?: boolean; clientId?: string; email?: string; residentId?: string | null } = {}) {
  const ref = `QA${randomBytes(6).toString("hex").toUpperCase()}`;
  await f.connection.execute(`INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status, stripe_session_id, status, resident_id)
    VALUES (?, ?, ?, ?, ?, '12:00', 2, 'QA', 4, 'QA synthetic guest', ?, '000', '', 0, 'paid', ?, 'confirmed', ?)`,
    [ref, opts.clientId ?? randomUUID(), centre.id, centre.room, FUTURE, opts.email ?? `qa_booking_${ref.toLowerCase()}@example.test`, opts.stripe ? `cs_test_qa_${randomUUID()}` : null, opts.residentId ?? null]);
  f.track("bookings", "ref", ref); f.track("attendance", "ref", ref); f.track("audit_log", "object_id", ref); f.track("notifications", "ref", ref);
  return ref;
}

/** Response body/header must not echo any synthetic canary or internal detail. */
export async function assertNoLeak(text: string, canaries: string[]) {
  for (const canary of canaries) expect(text.includes(canary), "Synthetic canary must not be reflected").toBe(false);
  for (const pattern of [/ER_[A-Z_]+/, /sqlMessage|sqlState|SELECT .* FROM/i, /\/Users\/|\/home\/|node_modules|\.ts:\d+/, /\n\s+at /, /stripe_secret|sk_(live|test)_|password_hash|STRIPE_|SMTP_|R2_/i]) {
    expect(pattern.test(text), `Response must not expose internal detail (${pattern})`).toBe(false);
  }
}
