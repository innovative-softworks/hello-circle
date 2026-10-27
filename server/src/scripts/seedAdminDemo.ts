import "dotenv/config";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, initSchema } from "../db/index.js";
import { computePricing } from "../pricing.js";
import { recordPaymentConfirmed } from "../commerce/payments.js";

// Admin demo seed: fills every /admin page (queues, orders, exceptions,
// vendors, reviews, complaints, coupons, audit, privacy…) with fictional rows
// on top of the reset-demo / seed-big listings. Dev only — refuses any
// database that isn't hello_circle_dev unless ADMIN_DEMO_ALLOW_DB names it.
// Every row carries a marker (refs "ADM-…", ids "adm-demo-…", client id
// "adm-demo", emails "@adm-demo.example.test") and the script clears its own
// earlier rows first, so it can be re-run; `--clear` only removes them.
// Paid orders go through recordPaymentConfirmed() (provider "stub"), so the
// payment records, allocations and ledger postings are the real ones.

const DB = process.env.DB_NAME ?? "hello_circle";
if (DB !== "hello_circle_dev" && process.env.ADMIN_DEMO_ALLOW_DB !== DB) {
  console.error(`Refusing to seed "${DB}". This script only writes to hello_circle_dev.`);
  process.exit(1);
}

const MAIL = "adm-demo.example.test";
const CLIENT = "adm-demo";
const day = 86_400_000;
const at = (offsetDays: number, hour = 10) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const pick = <T>(list: T[], i: number) => list[i % list.length];

async function clear() {
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
  // Ledger and allocations created for the demo orders.
  const groups = (await db.prepare(`SELECT id FROM ledger_entry_groups WHERE source_id LIKE 'ADM-%' OR source_id LIKE '%:ADM-%' OR idempotency_key LIKE '%:ADM-%'`).all()) as { id: string }[];
  for (const g of groups) {
    await q(`DELETE FROM ledger_entries WHERE group_id = ?`, g.id);
    await q(`DELETE FROM ledger_entry_groups WHERE id = ?`, g.id);
  }
  await q(`DELETE l FROM allocation_lines l JOIN allocation_snapshots s ON s.id = l.snapshot_id WHERE s.source_ref LIKE 'ADM-%'`);
  const refTables = (await db
    .prepare(`SELECT DISTINCT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'source_ref'`)
    .all()) as { t: string }[];
  for (const { t } of refTables) await q(`DELETE FROM \`${t}\` WHERE source_ref LIKE 'ADM-%'`);
  for (const t of ["bookings", "registrations", "program_enrollments", "experience_bookings", "passes"]) await q(`DELETE FROM ${t} WHERE ref LIKE 'ADM-%'`);
  await q(`DELETE FROM payment_reviews WHERE checkout_session_id LIKE 'cs_adm_demo_%'`);
  await q(`DELETE FROM disputes WHERE provider_dispute_id LIKE 'dp_adm_demo_%'`);
  await q(`DELETE FROM reviews WHERE client_id = ?`, CLIENT);
  await q(`DELETE FROM reports WHERE reporter_client_id = ?`, CLIENT);
  await q(`DELETE FROM complaints WHERE email LIKE ?`, `%@${MAIL}`);
  await q(`DELETE FROM privacy_requests WHERE email LIKE ?`, `%@${MAIL}`);
  await q(`DELETE FROM admin_invites WHERE email LIKE ?`, `%@${MAIL}`);
  await q(`DELETE FROM audit_log WHERE correlation_id = 'adm-demo'`);
  await q(`DELETE FROM moderation_decisions WHERE object_id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM coupons WHERE code LIKE 'ADMDEMO%'`);
  await q(`DELETE FROM listing_claims WHERE vendor_id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM place_suggestions WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM trader_profiles WHERE party_id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM rooms WHERE centre_id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM centres WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM clubs WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM experiences WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM users WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM organisations WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM games WHERE id LIKE 'adm-demo-%'`);
  await q(`DELETE FROM residents WHERE id LIKE 'adm-demo-%'`);
}

await initSchema();
await clear();
if (process.argv.includes("--clear")) {
  console.log(`Admin demo rows removed from ${DB}.`);
  process.exit(0);
}

const admin = (await db.prepare(`SELECT id FROM users WHERE role = 'admin' AND admin_role = 'super' ORDER BY created_at LIMIT 1`).get()) as { id: string } | undefined;
if (!admin) throw new Error("No super admin found — start the server once so it seeds one.");
const centres = (await db
  .prepare(`SELECT c.id, c.name, c.vendor_id, r.id AS room_id, r.rate FROM centres c JOIN rooms r ON r.centre_id = c.id AND r.active = 1 WHERE c.status = 'approved' AND r.rate > 0 ORDER BY c.name LIMIT 12`)
  .all()) as { id: string; name: string; vendor_id: string | null; room_id: string; rate: number }[];
const clubs = (await db.prepare(`SELECT id, name, price, vendor_id FROM clubs WHERE status = 'approved' AND price > 0 ORDER BY name LIMIT 12`).all()) as { id: string; name: string; price: number; vendor_id: string | null }[];
const exps = (await db
  .prepare(`SELECT e.id, e.title, e.price_cents, MIN(s.id) AS session_id FROM experiences e JOIN experience_sessions s ON s.experience_id = e.id WHERE e.status = 'approved' GROUP BY e.id, e.title, e.price_cents ORDER BY e.title LIMIT 8`)
  .all()) as { id: string; title: string; price_cents: number; session_id: string }[];
const programs = (await db.prepare(`SELECT id, title, price_cents FROM programs WHERE status = 'active' ORDER BY title LIMIT 6`).all()) as { id: string; title: string; price_cents: number }[];
const games = (await db.prepare(`SELECT id FROM games ORDER BY created_at DESC LIMIT 6`).all()) as { id: string }[];
const circles = (await db.prepare(`SELECT id FROM circles ORDER BY created_at DESC LIMIT 4`).all()) as { id: string }[];
if (!centres.length || !clubs.length) throw new Error("No approved centres/clubs — run reset-demo or seed-big first.");

// ---------- people ----------
const NAMES = [
  ["Niamh", "Kelly"], ["Ciarán", "Murphy"], ["Siobhán", "O'Brien"], ["Darragh", "Ryan"], ["Orla", "Doyle"], ["Cian", "Byrne"],
  ["Róisín", "McCarthy"], ["Eoin", "Walsh"], ["Clodagh", "Kennedy"], ["Fionn", "Lynch"], ["Aisling", "Murray"], ["Tadhg", "Quinn"],
  ["Gráinne", "Brennan"], ["Oisín", "Fitzgerald"], ["Sadhbh", "Nolan"], ["Rory", "Gallagher"],
];
const COUNTIES = ["Dublin", "Cork", "Galway", "Limerick", "Kerry", "Wexford", "Wicklow", "Kildare"];
const residents: { id: string; name: string; email: string }[] = [];
for (let i = 0; i < NAMES.length; i++) {
  const [f, l] = NAMES[i];
  const id = `adm-demo-res-${i + 1}`;
  const email = `${f.normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}.${l.replace(/[^a-zA-Z]/g, "").toLowerCase()}@${MAIL}`;
  const host = i < 3 ? "pending" : i < 5 ? "verified" : i === 5 ? "rejected" : "none";
  await db
    .prepare(
      `INSERT INTO residents (id, email, name, home_county, created_at, onboarding_completed, host_status, host_bio, host_applied_at, host_decided_at, email_verified_at, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, '2026-10')`
    )
    .run(
      id, email, `${f} ${l}`, pick(COUNTIES, i), at(-60 + i * 3), host,
      host === "none" ? null : `I run weekend ${pick(["walks", "five-a-side games", "sea swims", "board-game nights", "park runs", "yoga sessions"], i)} for neighbours in ${pick(COUNTIES, i)}.`,
      host === "none" ? null : at(-6 + i), host === "verified" || host === "rejected" ? at(-2 + i) : null, at(-60 + i * 3), at(-60 + i * 3)
    );
  residents.push({ id, name: `${f} ${l}`, email });
}

// ---------- vendors + organisations ----------
const hash = await bcrypt.hash(randomBytes(24).toString("hex"), 4); // nobody can sign in as these
const VENDORS = [
  { biz: "Ballymun Sports Hub", type: "centre", status: "pending", county: "Dublin" },
  { biz: "Kinsale Sailing Club", type: "club", status: "pending", county: "Cork" },
  { biz: "Burren Trail Guides", type: "experience", status: "pending", county: "Clare" },
  { biz: "Tralee Community Hall", type: "centre", status: "approved", county: "Kerry" },
  { biz: "Salthill Swim Collective", type: "club", status: "approved", county: "Galway" },
  { biz: "Liffey Paddle Tours", type: "experience", status: "approved", county: "Dublin" },
  { biz: "Midlands Climbing Wall", type: "centre", status: "suspended", county: "Westmeath" },
];
const vendors: { id: string; org: string; biz: string; type: string; status: string; county: string }[] = [];
for (let i = 0; i < VENDORS.length; i++) {
  const v = VENDORS[i];
  const id = `adm-demo-vendor-${i + 1}`;
  const org = `adm-demo-org-${i + 1}`;
  await db.prepare(`INSERT INTO organisations (id, name, kind, created_at, status, status_changed_at) VALUES (?, ?, 'vendor', ?, ?, ?)`).run(
    org, v.biz, at(-40 + i * 4), v.status === "suspended" ? "suspended" : "active", v.status === "suspended" ? at(-3) : null
  );
  const [f, l] = NAMES[(i + 7) % NAMES.length];
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, status, name, created_at, vendor_type, business_name, address, county, mobile, description, org_id, provider_tier, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, 'vendor', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-10')`
    )
    .run(
      id, `owner.${i + 1}@${MAIL}`, hash, v.status, `${f} ${l}`, at(-40 + i * 4), v.type, v.biz, `${10 + i} Main Street`, v.county,
      `087 555 01${String(10 + i)}`, `${v.biz} runs community sessions in ${v.county}.`, org, i === 5 ? "pro" : "standard", at(-40 + i * 4)
    );
  vendors.push({ id, org, ...v });
}

// Pending (and one rejected) listings, cloned from real seeded rows so every column is valid.
async function cloneCentre(fromId: string, id: string, name: string, vendorId: string, status: string) {
  await db
    .prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, views, created_at, opens_at, closes_at, payment_method, is_open, lat, lng, location_source, phone, accessibility, slug, created_by_user_id)
       SELECT ?, ?, area, county, 0, 0, capacity, from_price, ?, ph, image_url, blurb, ?, ?, 0, ?, opens_at, closes_at, payment_method, is_open, lat, lng, location_source, phone, accessibility, ?, ? FROM centres WHERE id = ?`
    )
    .run(id, name, name, vendorId, status, at(-2), id, vendorId, fromId);
  await db
    .prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method, active) SELECT ?, ?, name, cap, rate, \`desc\`, sort_order, payment_method, 1 FROM rooms WHERE centre_id = ? AND active = 1 ORDER BY sort_order LIMIT 1`)
    .run(`${id}-room`, id, fromId);
}
async function cloneClub(fromId: string, id: string, name: string, vendorId: string, status: string) {
  await db
    .prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, views, created_at, payment_method, capacity, lat, lng, location_source, phone, accessibility, category, slug, audience, created_by_user_id)
       SELECT ?, ?, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, ?, ?, 0, ?, payment_method, capacity, lat, lng, location_source, phone, accessibility, category, ?, audience, ? FROM clubs WHERE id = ?`
    )
    .run(id, name, vendorId, status, at(-1), id, vendorId, fromId);
}
await cloneCentre(centres[0].id, "adm-demo-centre-1", "Ballymun Sports Hub", vendors[0].id, "pending");
await cloneCentre(centres[1].id, "adm-demo-centre-2", "Ballymun Sports Hub — Studio", vendors[0].id, "pending");
await cloneCentre(centres[2].id, "adm-demo-centre-3", "Midlands Climbing Wall", vendors[6].id, "rejected");
await cloneClub(clubs[0].id, "adm-demo-club-1", "Kinsale Sailing Club — Juniors", vendors[1].id, "pending");
await cloneClub(clubs[1].id, "adm-demo-club-2", "Kinsale Sailing Club — Adults", vendors[1].id, "pending");
if (exps[0]) {
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, kind, title, area, county, lat, lng, meeting_point, blurb, description, difficulty, duration_minutes, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, payment_method, image_url, status, created_at, location_source, slug)
       SELECT ?, ?, kind, ?, 'Burren', 'Clare', lat, lng, meeting_point, blurb, description, difficulty, duration_minutes, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, payment_method, image_url, 'pending', ?, location_source, ? FROM experiences WHERE id = ?`
    )
    .run("adm-demo-exp-1", vendors[2].id, "Burren Limestone Walk", at(-1, 15), "adm-demo-exp-1", exps[0].id);
}

// Moderation decisions for the rejected listing and the suspended organisation.
const decide = (objectType: string, objectId: string, action: string, prev: string, next: string, cat: string, why: string, note: string | null, ago: number) =>
  db
    .prepare(
      `INSERT INTO moderation_decisions (object_type, object_id, action, previous_state, new_state, reason_category, explanation, internal_note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(objectType, objectId, action, prev, next, cat, why, note, admin.id, at(-ago, 14));
await decide("centre", "adm-demo-centre-3", "listing.rejected", "pending", "rejected", "incomplete", "The listing has no opening hours and the room rates are missing. Add both and submit it again.", "Second time this was sent without rates.", 4);
const suspension = await decide("organisation", vendors[6].org, "organisation.suspended", "active", "suspended", "verification_failed", "We couldn't verify the insurance certificate you sent. Your listings are hidden until it is renewed.", "Insurer confirmed the policy lapsed in September.", 3);
await db.prepare(`UPDATE organisations SET status_decision_id = ? WHERE id = ?`).run(Number(suspension.lastInsertRowid), vendors[6].org);

// ---------- queues: claims, place suggestions ----------
const claimRows = [
  [centres[3], vendors[3], "We manage this hall for the parish committee and take the evening bookings.", "pending", null],
  [centres[4], vendors[3], "Our team runs the weekday sessions here and would like to keep the listing up to date.", "pending", null],
  [clubs[2], vendors[4], "I'm the club secretary; the contact details on this listing are out of date.", "approved", 5],
  [clubs[3], vendors[4], "We used to train here and want to list our sessions.", "rejected", 8],
] as const;
for (const [listing, vendor, msg, status, ago] of claimRows) {
  await db
    .prepare(`INSERT INTO listing_claims (listing_type, listing_id, vendor_id, message, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("room_id" in listing ? "centre" : "club", listing.id, vendor.id, msg, status, at(-(ago ?? 1) - 2), ago ? at(-ago) : null);
}
const PLACES = [
  ["Glenageary Bowling Green", "centre", "Glenageary", "Dublin", "A public bowling green with a small clubhouse — open to anyone in summer."],
  ["Spanish Point Surf Lessons", "experience", "Spanish Point", "Clare", "Beginner surf lessons on Saturday mornings, boards and wetsuits included."],
  ["Ennis Parkrun Volunteers", "club", "Ennis", "Clare", "Weekly 5k run in the park, volunteers always welcome."],
  ["Douglas Community Garden", "centre", "Douglas", "Cork", "Allotments and a polytunnel with Sunday gardening sessions."],
  ["Athlone Chess Club", "club", "Athlone", "Westmeath", "Meets Tuesday evenings in the library, all levels."],
] as const;
for (let i = 0; i < PLACES.length; i++) {
  const [name, cat, area, county, desc] = PLACES[i];
  await db
    .prepare(`INSERT INTO place_suggestions (id, client_id, resident_id, suggested_name, category, area, county, description, contact_info, status, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`adm-demo-place-${i + 1}`, CLIENT, residents[i + 6].id, name, cat, area, county, desc, i % 2 ? "" : "info@example.test", i < 3 ? "pending" : i === 3 ? "approved" : "rejected", at(-i - 1), i < 3 ? null : at(-i));
}

// ---------- coupons ----------
const COUPONS = [
  ["ADMDEMO10", "percent", 10, 200, null, 1, "platform"],
  ["ADMDEMOWELCOME", "fixed", 500, 500, null, 1, "platform"],
  ["ADMDEMOSUMMER", "percent", 15, 100, -5, 0, "platform"],
  ["ADMDEMOHALL20", "percent", 20, 50, 30, 1, "partner"],
  ["ADMDEMOCLUB5", "fixed", 500, null, 60, 1, "partner"],
] as const;
const couponIds: Record<string, number> = {};
for (const [code, kind, amount, max, expires, active, funding] of COUPONS) {
  const r = await db
    .prepare(`INSERT INTO coupons (code, kind, amount, max_uses, expires_at, active, created_at, funding, platform_share_bps, created_by_vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, kind, amount, max, expires == null ? null : at(expires), active, at(-30), funding, funding === "platform" ? 10000 : 0, funding === "partner" ? centres[0].vendor_id : null);
  couponIds[code] = Number(r.lastInsertRowid);
}

// ---------- orders ----------
type Paid = { type: "booking" | "registration" | "program" | "experience" | "pass"; ref: string; cents: number };
const paid: Paid[] = [];
const BOOK_STATES = ["paid", "paid", "paid", "paid", "pending", "paid", "refunded", "paid", "failed", "paid", "paid", "paid", "paid", "pending"];
const EVENTS = ["Five-a-side training", "Committee meeting", "Birthday party", "Yoga class", "Choir rehearsal", "Badminton", "Community AGM", "Toddler group"];
for (let i = 0; i < BOOK_STATES.length; i++) {
  const c = pick(centres, i);
  const res = pick(residents, i);
  const hours = 1 + (i % 3);
  const coupon = i % 5 === 1 ? "ADMDEMO10" : null;
  const subtotal = c.rate * 100 * hours; // rooms.rate is whole euros per hour
  const discount = coupon ? Math.round(subtotal * 0.1) : 0;
  const p = computePricing(subtotal, 0, discount, coupon);
  const ref = `ADM-B${String(i + 1).padStart(3, "0")}`;
  const state = BOOK_STATES[i];
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, created_at, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, coupon_code, payment_status, status, resident_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ref, CLIENT, c.id, c.room_id, ymd(at(i - 6)), `${String(9 + (i % 10)).padStart(2, "0")}:00`, hours, pick(EVENTS, i), 6 + (i % 20), res.name, res.email, "087 555 0199",
      p.totalCents, at(-14 + i), p.subtotalCents, p.discountCents, p.vatCents, p.platformFeeCents, coupon, state, state === "refunded" || i === 12 ? "cancelled" : "confirmed", res.id
    );
  if (state === "paid" || state === "refunded") paid.push({ type: "booking", ref, cents: p.totalCents });
  if (coupon && state === "paid")
    await db
      .prepare(`INSERT INTO coupon_redemptions (coupon_id, code, source_type, source_ref, customer_key, discount_minor, platform_funded_minor, status) VALUES (?, ?, 'booking', ?, ?, ?, ?, 'confirmed')`)
      .run(couponIds[coupon], coupon, ref, `resident:${res.id}`, discount, discount);
}
const REG_STATES = ["paid", "paid", "pending", "paid", "paid", "refunded", "paid", "paid", "paid", "failed"];
const KIDS = ["Ava", "Jack", "Saoirse", "Conor", "Ella", "Luke", "Aoibhinn", "Seán", "Molly", "Darragh"];
for (let i = 0; i < REG_STATES.length; i++) {
  const club = pick(clubs, i);
  const res = pick(residents, i + 4);
  const [gf, gl] = res.name.split(" ");
  const p = computePricing(club.price * 100, 0, 0, null); // clubs.price is whole euros
  const ref = `ADM-R${String(i + 1).padStart(3, "0")}`;
  await db
    .prepare(
      `INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, created_at, subtotal_cents, discount_cents, vat_cents, platform_fee_cents, payment_status, status, resident_id, waiver_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '087 555 0142', ?, ?, '087 555 0143', 'Parent', '', 1, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'v1')`
    )
    .run(
      ref, CLIENT, club.id, pick(["Under 8s", "Under 10s", "Under 12s", "Seniors"], i), KIDS[i], gl, `201${5 + (i % 4)}-0${1 + (i % 9)}-1${i % 9}`, gf, gl, res.email,
      `${20 + i} Seaview Road`, `${pick(NAMES, i + 3)[0]} ${gl}`, i % 4 === 0 ? 1 : 0, p.totalCents, at(-20 + i * 2), p.subtotalCents, p.vatCents, p.platformFeeCents,
      REG_STATES[i], REG_STATES[i] === "refunded" ? "cancelled" : "confirmed", res.id
    );
  if (REG_STATES[i] === "paid" || REG_STATES[i] === "refunded") paid.push({ type: "registration", ref, cents: p.totalCents });
}
for (let i = 0; i < Math.min(5, programs.length * 2); i++) {
  const prog = pick(programs, i);
  const res = pick(residents, i + 8);
  const ref = `ADM-P${String(i + 1).padStart(3, "0")}`;
  const state = i === 3 ? "pending" : "paid";
  await db
    .prepare(`INSERT INTO program_enrollments (ref, program_id, resident_id, client_id, participant_name, participant_dob, email, total_cents, payment_status, status, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'confirmed', ?)`)
    .run(ref, prog.id, res.id, CLIENT, res.name, res.email, prog.price_cents, state, at(-10 + i));
  if (state === "paid" && prog.price_cents > 0) paid.push({ type: "program", ref, cents: prog.price_cents });
}
for (let i = 0; i < Math.min(6, exps.length * 2); i++) {
  const e = pick(exps, i);
  const res = pick(residents, i + 2);
  const party = 1 + (i % 4);
  const p = computePricing(e.price_cents * party, 0, 0, null);
  const ref = `ADM-E${String(i + 1).padStart(3, "0")}`;
  const state = i === 4 ? "pending" : "paid";
  await db
    .prepare(
      `INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, party_size, subtotal_cents, vat_cents, platform_fee_cents, total_cents, payment_status, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`
    )
    .run(ref, e.id, e.session_id, CLIENT, res.id, res.name, res.email, party, p.subtotalCents, p.vatCents, p.platformFeeCents, p.totalCents, state, at(-8 + i));
  if (state === "paid" && p.totalCents > 0) paid.push({ type: "experience", ref, cents: p.totalCents });
}
for (let i = 0; i < 4; i++) {
  const club = pick(clubs, i + 3);
  const res = pick(residents, i + 10);
  const ref = `ADM-X${String(i + 1).padStart(3, "0")}`;
  const cents = club.price * 100 * 8;
  await db
    .prepare(`INSERT INTO passes (ref, resident_id, listing_type, listing_id, credits_total, credits_used, purchased_cents, payment_status, expires_at, created_at) VALUES (?, ?, 'club', ?, 10, ?, ?, 'paid', ?, ?)`)
    .run(ref, res.id, club.id, i * 2, cents, at(120), at(-25 + i * 5));
  paid.push({ type: "pass", ref, cents });
}
// Real payment confirmation postings (payment record, allocation, ledger) — provider "stub", no Stripe call.
for (const o of paid) {
  await recordPaymentConfirmed({ type: o.type, ref: o.ref, checkoutSessionId: `cs_adm_demo_${o.ref}`, paymentIntentId: `pi_adm_demo_${o.ref}`, amountMinor: o.cents, currency: "EUR", provider: "stub" });
}

// ---------- exceptions: refunds, disputes, payment reviews ----------
const refunded = paid.filter((o) => ["ADM-B007", "ADM-R006"].includes(o.ref));
let rk = 0;
for (const o of refunded) {
  await db
    .prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status, initiated_by, created_at) VALUES (?, ?, ?, ?, 'eur', 'full', 'admin', 'platform', ?, 'succeeded', ?, ?)`)
    .run(o.type, o.ref, `adm-demo-refund-${++rk}`, o.cents, "The centre closed for repairs on the booked date.", admin.id, at(-3));
}
const due = paid.find((o) => o.ref === "ADM-B010");
if (due)
  await db
    .prepare(`INSERT INTO refunds (source_type, source_ref, idempotency_key, amount_minor, currency, kind, origin, responsible, reason, status, initiated_by, last_error, created_at) VALUES ('booking', ?, 'adm-demo-refund-failed', ?, 'eur', 'partial', 'admin', 'partner', ?, 'failed', ?, ?, ?)`)
    .run(due.ref, Math.round(due.cents / 2), "Half refund agreed after the heating failed.", admin.id, "The card issuer declined the refund. Try again or refund by bank transfer.", at(-1));
const DISPUTES = [
  ["ADM-B004", "product_not_received", "needs_response", 6, "not_started"],
  ["ADM-R004", "fraudulent", "under_review", 12, "not_started"],
  ["ADM-E002", "duplicate", "won", null, "recovered"],
] as const;
for (let i = 0; i < DISPUTES.length; i++) {
  const [ref, reason, status, dueIn, recovery] = DISPUTES[i];
  const o = paid.find((x) => x.ref === ref);
  if (!o) continue;
  await db
    .prepare(`INSERT INTO disputes (provider_dispute_id, source_type, source_ref, payment_intent_id, amount_minor, currency, reason, status, evidence_due_by, recovery_status, created_at) VALUES (?, ?, ?, ?, ?, 'eur', ?, ?, ?, ?, ?)`)
    .run(`dp_adm_demo_${i + 1}`, o.type, o.ref, `pi_adm_demo_${o.ref}`, o.cents, reason, status, dueIn == null ? null : at(dueIn), recovery, at(-4 - i));
}
const REVIEWS = [
  ["ADM-B005", "booking", "amount_mismatch", "Received €5.00 more than the agreed total.", "held", 2, "starts_soon"],
  ["ADM-E005", "experience", "order_cancelled", "The booking was cancelled before the payment arrived.", "held", 1, "within_lead"],
  ["ADM-R003", "registration", "capacity_unavailable", "Payment arrived after the last place was taken.", "expired", -1, "none"],
] as const;
for (let i = 0; i < REVIEWS.length; i++) {
  const [ref, type, reason, detail, hold, holdDays, urgency] = REVIEWS[i];
  await db
    .prepare(
      `INSERT INTO payment_reviews (checkout_session_id, source_type, source_ref, payment_intent_id, received_minor, received_currency, agreed_minor, agreed_currency, reason, detail, hold_status, review_hold_until, urgency, status, flagged_at)
       VALUES (?, ?, ?, ?, ?, 'eur', ?, 'eur', ?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(`cs_adm_demo_review_${i + 1}`, type, ref, `pi_adm_demo_review_${i + 1}`, 4500 + i * 1000 + (i === 0 ? 500 : 0), 4500 + i * 1000, reason, detail, hold, at(holdDays), urgency, at(-1 - i));
}

// ---------- upcoming activities (cloned from seeded games, moved into the next fortnight) ----------
const gameCols = ((await db.prepare(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'games' ORDER BY ordinal_position`).all()) as { c: string }[])
  .map((r) => r.c)
  .filter((c) => !["id", "date", "time", "status", "created_at", "booking_ref", "series_id", "plan_id", "publish_at", "booking_open_at", "booking_close_at", "confirmation_deadline", "lifecycle"].includes(c));
const sourceGames = (await db.prepare(`SELECT id FROM games WHERE id NOT LIKE 'adm-demo-%' AND visibility = 'public' ORDER BY created_at DESC LIMIT 10`).all()) as { id: string }[];
for (let i = 0; i < sourceGames.length; i++) {
  const list = gameCols.map((c) => `\`${c}\``).join(", ");
  await db
    .prepare(`INSERT INTO games (id, date, time, status, lifecycle, created_at, ${list}) SELECT ?, ?, ?, ?, 'active', ?, ${list} FROM games WHERE id = ?`)
    .run(`adm-demo-game-${i + 1}`, ymd(at(1 + i)), `${String(10 + (i % 9)).padStart(2, "0")}:00`, i === 7 ? "cancelled" : "open", at(-3), sourceGames[i].id);
}

// ---------- reviews + reports ----------
const COMMENTS = [
  [5, "Spotless hall and the caretaker was really helpful setting up."], [4, "Great space, parking was a bit tight on a Saturday."], [5, "Our kids love the coaches here."],
  [3, "Good session but it started 15 minutes late."], [2, "The heating wasn't on and nobody answered the phone."], [5, "Brilliant guide, we'll be back with friends."],
  [4, "Well organised, would like more evening slots."], [1, "Absolute scam, avoid — call me on 087 000 0000 for the real story."], [5, "Friendly club, very welcoming to beginners."],
  [4, "Lovely venue for our community AGM."], [3, "Fine, though the changing rooms need work."], [5, "Best sea swim group in Galway!"],
] as const;
const reviewTargets = [...centres.slice(0, 5).map((c) => ["centre", c.id] as const), ...clubs.slice(0, 4).map((c) => ["club", c.id] as const), ...exps.slice(0, 3).map((e) => ["experience", e.id] as const)];
const reviewIds: number[] = [];
for (let i = 0; i < COMMENTS.length; i++) {
  const [rating, comment] = COMMENTS[i];
  const [lt, lid] = pick(reviewTargets, i);
  const r = await db
    .prepare(`INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment, hidden, created_at, vendor_reply, vendor_reply_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(lt, lid, CLIENT, pick(residents, i).name, rating, comment, i === 7 ? 1 : 0, at(-30 + i * 2), i === 4 ? "Sorry about that — the boiler has since been replaced." : null, i === 4 ? at(-15) : null);
  reviewIds.push(Number(r.lastInsertRowid));
}
const REPORTS = [
  ["review", String(reviewIds[7]), "This review shares a phone number and makes accusations.", "actioned", "content_removed", "Removed: the review included personal contact details."],
  ["review", String(reviewIds[4]), "The partner says this review is about a different venue.", "pending", null, null],
  ["game", games[0]?.id ?? "", "The organiser asked everyone to pay cash on the day.", "pending", null, null],
  ["circle", circles[0]?.id ?? "", "Members are posting unrelated adverts.", "dismissed", "no_action", "No breach found: the posts were about the circle's own fundraiser."],
  ["game", games[1]?.id ?? "", "Meeting point is on private land.", "pending", null, null],
] as const;
for (let i = 0; i < REPORTS.length; i++) {
  const [tt, tid, reason, status, action, sor] = REPORTS[i];
  if (!tid) continue;
  await db
    .prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason, status, created_at, statement_of_reasons, decided_by, decided_at, action_taken) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tt, tid, CLIENT, reason, status, at(-6 + i), sor, status === "pending" ? null : admin.id, status === "pending" ? null : at(-2), action);
}

// ---------- complaints, trader checks ----------
const COMPLAINTS = [
  ["complaint", "booking", "ADM-B003", "The hall was double-booked and we had to leave after 20 minutes. I'd like a refund for the session.", "open", null, null],
  ["complaint", "listing", centres[2].id, "The listing says the venue is wheelchair accessible but the only entrance has steps.", "open", null, null],
  ["notice", "review", String(reviewIds[7]), "This review contains a private phone number and false claims about our club.", "closed", "upheld", "The review was removed because it included personal contact details."],
  ["appeal", "moderation_decision", "adm-demo-centre-3", "We have now added our opening hours and room rates — please look at the listing again.", "open", null, null],
  ["complaint", "payout", null, "Our September payout still hasn't reached our bank account.", "closed", "not_upheld", "The payout was sent on 2 October; the bank confirmed receipt on 4 October."],
] as const;
for (let i = 0; i < COMPLAINTS.length; i++) {
  const [kind, subject, ref, body, status, decision, sor] = COMPLAINTS[i];
  await db
    .prepare(`INSERT INTO complaints (kind, subject_type, subject_ref, submitter_type, submitter_id, email, body, status, decision, statement_of_reasons, decided_by, decided_at, created_at) VALUES (?, ?, ?, 'resident', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(kind, subject, ref, residents[i].id, `complaint.${i + 1}@${MAIL}`, body, status, decision, sor, decision ? admin.id : null, decision ? at(-1) : null, at(-5 + i));
}
const TRADERS = [
  [vendors[3], "company", "Tralee Community Hall CLG", "verified", "IE-645812"],
  [vendors[4], "sole_trader", "Salthill Swim Collective", "unverified", null],
  [vendors[5], "company", "Liffey Paddle Tours Ltd", "needs_changes", "IE-701234"],
  [vendors[6], "company", "Midlands Climbing Wall Ltd", "rejected", "IE-588120"],
] as const;
for (const [v, entity, legal, status, company] of TRADERS) {
  await db
    .prepare(
      `INSERT INTO trader_profiles (party_type, party_id, entity_type, legal_name, trading_name, address, country, email, phone, company_number, self_certified_at, verification_status, verification_note, verified_by, verified_at)
       VALUES ('org', ?, ?, ?, ?, ?, 'IE', ?, '087 555 0177', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.org, entity, legal, v.biz, `Unit 4, ${v.county}`, `accounts.${v.id.slice(-1)}@${MAIL}`, company, at(-10), status,
      status === "needs_changes" ? "The company number doesn't match the CRO record — please check it." : status === "rejected" ? "Insurance lapsed." : null,
      status === "unverified" ? null : admin.id, status === "unverified" ? null : at(-4)
    );
}

// ---------- privacy, admin team, audit ----------
const PRIVACY = [
  ["access", "Please send me a copy of everything you hold about me.", "received", null],
  ["correction", "My surname is misspelt on my bookings — it should be Ó Briain.", "in_progress", null],
  ["objection", "Please stop using my activity for recommendations.", "completed", "Done — recommendations based on your activity are switched off."],
  ["erasure", "Delete my account; I've moved abroad.", "received", null],
] as const;
for (let i = 0; i < PRIVACY.length; i++) {
  const [kind, details, status, response] = PRIVACY[i];
  await db
    .prepare(`INSERT INTO privacy_requests (resident_id, email, kind, details, status, response, handled_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(residents[i + 12].id, `privacy.${i + 1}@${MAIL}`, kind, details, status, response, status === "received" ? null : admin.id, at(-9 + i * 2));
}
for (const [email, role, status, ago] of [
  [`finance.lead@${MAIL}`, "finance", "pending", 1],
  [`support.desk@${MAIL}`, "support", "pending", 3],
  [`legal.counsel@${MAIL}`, "legal", "revoked", 9],
] as const) {
  await db
    .prepare(`INSERT INTO admin_invites (token_hash, email, admin_role, invited_by, status, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(createHash("sha256").update(randomUUID()).digest("hex"), email, role, admin.id, status, at(-ago), at(7 - ago), status === "revoked" ? at(-ago + 1) : null);
}
const AUDIT = [
  ["vendor.approved", "user", vendors[3].id, { status: "pending" }, { status: "approved" }],
  ["vendor.approved", "user", vendors[4].id, { status: "pending" }, { status: "approved" }],
  ["organisation.suspended", "organisation", vendors[6].org, { status: "active" }, { status: "suspended" }],
  ["centre.status_changed", "centre", "adm-demo-centre-3", { status: "pending" }, { status: "rejected" }],
  ["claim.approved", "claim", "adm-demo-claim", { status: "pending" }, { status: "approved" }],
  ["coupon.created", "coupon", "ADMDEMOWELCOME", null, { kind: "fixed", amount: 500 }],
  ["coupon.archived", "coupon", "ADMDEMOSUMMER", { active: 1 }, { active: 0 }],
  ["review.hidden", "review", String(reviewIds[7]), { hidden: 0 }, { hidden: 1 }],
  ["refund.created", "booking", "ADM-B007", null, { amountMinor: refunded[0]?.cents ?? 0 }],
  ["config.maps_enabled_changed", "app_setting", "maps_enabled", { value: "0" }, { value: "1" }],
  ["admin.invited", "admin_invite", `finance.lead@${MAIL}`, null, { role: "finance" }],
  ["host_application.approved", "host_application", residents[3].id, { status: "pending" }, { status: "verified" }],
] as const;
for (let i = 0; i < AUDIT.length; i++) {
  const [action, type, id, prev, next] = AUDIT[i];
  await db
    .prepare(`INSERT INTO audit_log (actor_user_id, action, object_type, object_id, previous_value, new_value, created_at, actor_kind, correlation_id, environment, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 'adm-demo', 'development', 'super')`)
    .run(admin.id, action, type, id, prev ? JSON.stringify(prev) : null, JSON.stringify(next), at(-12 + i, 9 + (i % 8)));
}

const n = async (sql: string) => Number(((await db.prepare(sql).get()) as { c: number }).c);
console.log(
  `Admin demo seed complete in ${DB}: ${residents.length} people, ${vendors.length} vendors, ` +
    `${await n(`SELECT COUNT(*) c FROM bookings WHERE ref LIKE 'ADM-%'`)} bookings, ${await n(`SELECT COUNT(*) c FROM registrations WHERE ref LIKE 'ADM-%'`)} registrations, ` +
    `${paid.length} paid orders posted, ${await n(`SELECT COUNT(*) c FROM reviews WHERE client_id = 'adm-demo'`)} reviews, ` +
    `${await n(`SELECT COUNT(*) c FROM ledger_entry_groups WHERE source_id LIKE 'ADM-%' OR source_id LIKE '%:ADM-%'`)} ledger groups.`
);
process.exit(0);
