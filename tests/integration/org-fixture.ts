import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect, env } from "./fixtures";
import { irelandDate } from "./booking-fixture";
import type { Scope } from "./stage-b-fixture";

// D-01 / D-08 — a synthetic partner organisation: an owner and invited staff
// with real password hashes and real logins (each login counts toward the
// real limiter), plus listings created as specific members. Rows are written
// for THIS test only and removed by exact id afterwards.

export type Member = { id: string; email: string; password: string; ctx: APIRequestContext | null };
export type Org = { id: string; name: string; owner: Member; staff: Member[] };

async function member(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, orgId: string, invited: boolean, platformRole: string | null, opened: APIRequestContext[], login: boolean): Promise<Member> {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_org_${id.slice(0, 8)}@example.test`;
  await f.connection.execute(
    "INSERT INTO users (id, email, password_hash, role, status, name, business_name, org_id, platform_role, invited_staff, terms_accepted_at, terms_version) VALUES (?, ?, ?, 'vendor', 'approved', ?, ?, ?, ?, ?, NOW(), 'qa')",
    [id, email, bcrypt.hashSync(password, 10), invited ? `QA staff ${platformRole}` : "QA owner", invited ? "" : `QA Org ${orgId.slice(0, 6)}`, orgId, platformRole, invited ? 1 : 0]
  );
  for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "actor_user_id"], ["audit_log", "object_id"], ["notifications", "recipient_id"], ["moderation_decisions", "object_id"]]) f.track(t, c, id);
  let ctx: APIRequestContext | null = null;
  if (login) ctx = await loginAs(playwright, email, password, opened);
  return { id, email, password, ctx };
}

export async function loginAs(playwright: PlaywrightWorkerArgs["playwright"], email: string, password: string, opened: APIRequestContext[]) {
  const ctx = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
  opened.push(ctx);
  expect((await ctx.post("/api/auth/login", { data: { email, password } })).status(), `login ${email}`).toBe(200);
  return ctx;
}

/** `staffRoles`: one entry per staff member; `login` lists which members sign in now (owner = "owner"). */
export async function syntheticOrg(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, opened: APIRequestContext[], staffRoles: string[], login: ("owner" | number)[] = ["owner"]): Promise<Org> {
  const id = randomUUID(), name = `QA Org ${id.slice(0, 6)}`;
  await f.connection.execute("INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')", [id, name]);
  for (const [t, c] of [["organisations", "id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["feature_flags", "org_id"], ["org_policies", "org_id"]]) f.track(t, c, id);
  const owner = await member(playwright, f, id, false, null, opened, login.includes("owner"));
  const staff: Member[] = [];
  for (let i = 0; i < staffRoles.length; i++) staff.push(await member(playwright, f, id, true, staffRoles[i], opened, login.includes(i)));
  return { id, name, owner, staff };
}

const trackListing = (f: Scope, id: string) => {
  for (const [t, c] of [["notifications", "listing_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"]]) f.track(t, c, id);
};

/** An approved, bookable centre with one active room, owned by `vendorId`. */
export async function seedCentre(f: Scope, vendorId: string, opts: { status?: string; payment?: "cash" | "online"; rate?: number } = {}) {
  const id = randomUUID(), room = randomUUID();
  await f.connection.execute(
    "INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, vendor_id, opens_at, closes_at, is_open, payment_method, created_at) VALUES (?, ?, 'QA area', 'Dublin', 0, 0, 10, 20, '', '', '', 'QA org centre', ?, ?, '09:00', '21:00', 1, ?, NOW())",
    [id, `QA org centre ${id.slice(0, 6)}`, opts.status ?? "approved", vendorId, opts.payment ?? "cash"]
  );
  await f.connection.execute("INSERT INTO rooms (id, centre_id, name, cap, rate, `desc`, sort_order, payment_method, active) VALUES (?, ?, 'Main Room', 10, ?, '', 0, ?, 1)", [room, id, opts.rate ?? 20, opts.payment ?? "cash"]);
  for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["bookings", "centre_id"], ["room_blocks", "centre_id"], ["centre_hours", "centre_id"], ["games", "centre_id"]]) f.track(t, c, id);
  trackListing(f, id);
  return { id, room };
}

export async function seedClub(f: Scope, vendorId: string, opts: { status?: string; price?: number; payment?: "cash" | "online" } = {}) {
  const id = randomUUID();
  await f.connection.execute(
    "INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, payment_method) VALUES (?, ?, 'QA', 'QA area', 'Dublin', 'All', ?, 'session', 0, '', '', 'QA org club', ?, ?, ?)",
    [id, `QA org club ${id.slice(0, 6)}`, opts.price ?? 0, vendorId, opts.status ?? "approved", opts.payment ?? "online"]
  );
  for (const [t, c] of [["clubs", "id"], ["club_sessions", "club_id"], ["registrations", "club_id"], ["waitlist_entries", "listing_id"], ["passes", "listing_id"]]) f.track(t, c, id);
  trackListing(f, id);
  return id;
}

export async function seedExperience(f: Scope, vendorId: string, opts: { status?: string; price?: number; payment?: "cash" | "online" } = {}) {
  const id = randomUUID(), session = randomUUID();
  await f.connection.execute(
    `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity, payment_method, area, county)
     VALUES (?, ?, 'adventure', ?, '', '', '', '', '', '', '', '', '', '', '', ?, ?, 8, ?, 'QA area', 'Dublin')`,
    [id, vendorId, `QA org adventure ${id.slice(0, 6)}`, opts.status ?? "approved", opts.price ?? 0, opts.payment ?? "cash"]
  );
  await f.connection.execute("INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, ?, '10:00', 8, 'scheduled')", [session, id, irelandDate(14)]);
  for (const [t, c] of [["experiences", "id"], ["experience_sessions", "experience_id"], ["experience_bookings", "experience_id"]]) f.track(t, c, id);
  trackListing(f, id);
  return { id, session };
}

export async function seedProgram(f: Scope, vendorId: string, centreId: string, opts: { status?: string; price?: number } = {}) {
  const id = randomUUID();
  await f.connection.execute(
    "INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, price_cents, capacity, status) VALUES (?, 'centre', ?, ?, ?, 'QA', ?, NULL, ?)",
    [id, centreId, vendorId, `QA org programme ${id.slice(0, 6)}`, opts.price ?? 0, opts.status ?? "published"]
  );
  await f.connection.execute("INSERT INTO program_sessions (id, program_id, date, time, duration_minutes, status) VALUES (?, ?, ?, '18:00', 60, 'scheduled')", [randomUUID(), id, irelandDate(14)]);
  for (const [t, c] of [["programs", "id"], ["program_sessions", "program_id"], ["program_enrollments", "program_id"]]) f.track(t, c, id);
  trackListing(f, id);
  return id;
}

export const enrolBody = (email: string) => ({ participantName: `QA participant ${randomUUID().slice(0, 4)}`, email, phone: "000" });
export const qaRef = () => `QA${randomUUID().slice(0, 6)}`;
