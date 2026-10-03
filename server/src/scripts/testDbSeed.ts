// HC-QA-092 — schema + deterministic seed for the isolated server-test
// database. Only ever invoked by testIsolated.ts; refuses anything else.
//
// On top of the normal demo seed (2 centres, 2 clubs), it adds a small, fixed
// set of fixtures that several suites previously found only by accident in a
// developer's hello_circle_dev (an approved vendor owning listings, an
// experience, a published programme with an upcoming session, an archived
// programme). Fixed ids, so every run starts from the same state.
import { assertIsolatedServerTestProfile } from "../testProfile.js";

await assertIsolatedServerTestProfile();
const { db, initSchema } = await import("../db/index.js");
const { seedIfEmpty } = await import("../db/seed.js");
await initSchema();
await seedIfEmpty();

const ORG = "srvtest-org";
const VENDOR = "srvtest-vendor";
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Server Test Org', 'vendor')`).run(ORG);
await db
  .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, terms_accepted_at) VALUES (?, 'srvtest-vendor@example.test', 'x', 'vendor', 'approved', 'Server Test Vendor', ?, 0, NOW())`)
  .run(VENDOR, ORG);
await db.prepare(`UPDATE centres SET vendor_id = ?`).run(VENDOR);
await db.prepare(`UPDATE clubs SET vendor_id = ?`).run(VENDOR);
const centre = (await db.prepare(`SELECT id FROM centres WHERE status = 'approved' ORDER BY id LIMIT 1`).get()) as { id: string };

await db
  .prepare(
    `INSERT INTO experiences (id, vendor_id, kind, title, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required,
       transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, status)
     VALUES ('srvtest-exp', ?, 'adventure', 'Server Test Hike', 'Dublin', '', '', '', '', '', '', '', '', '', '', '', 1500, 10, 'approved')`
  )
  .run(VENDOR);
await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, status) VALUES ('srvtest-exp-s1', 'srvtest-exp', ?, '10:00', 'scheduled')`).run(future(14));

await db
  .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES ('srvtest-prog-pub', 'centre', ?, ?, 'Server Test Programme', 'Fixture', 'published')`)
  .run(centre.id, VENDOR);
await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES ('srvtest-prog-s1', 'srvtest-prog-pub', ?, '18:00', 'scheduled')`).run(future(10));
await db
  .prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES ('srvtest-prog-arch', 'centre', ?, ?, 'Server Test Archived Programme', 'Fixture', 'archived')`)
  .run(centre.id, VENDOR);

console.log("[server-test] schema applied, demo seed + deterministic fixtures loaded");
process.exit(0);
