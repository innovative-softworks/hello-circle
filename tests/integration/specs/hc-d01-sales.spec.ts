import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookingBody, experienceBody, guest, irelandDate, registrationBody } from "../booking-fixture";
import { mailTo } from "../product-fixture";
import { enrolBody, loginAs, seedCentre, seedClub, seedExperience, seedProgram, syntheticOrg } from "../org-fixture";
import type { Scope } from "../stage-b-fixture";

// D-01 (approved for local implementation 2026-10-15) — organisation
// suspension, real server and isolated database. Runs with the QA payment
// provider stub (batch name "revenue-…"): online checkouts get a synthetic
// session and /api/__qa/provider drives the app's own outcome handling — no
// network, no Stripe. Email goes to the QA sink only.
// Logins (real limiter of 10 per IP): org owner, manager, analyst, other
// org's owner, QA_ADMIN, QA_USER, support admin = 7.

const NOTE = "INTERNAL-ORG-NOTE-MARKER";
const suspension = { status: "suspended", reasonCategory: "safety", explanation: "Several serious safety complaints about your venues this month.", internalNote: NOTE };
const provider = (actor: APIRequestContext, type: string, ref: string, outcome: "success" | "failure" | "expired") => actor.post("/api/__qa/provider", { data: { type, ref, outcome } });

async function supportAdmin(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, opened: APIRequestContext[]) {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_d01_support_${id.slice(0, 8)}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', 'QA D-01 support', 'support')", [id, email, bcrypt.hashSync(password, 10)]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  return loginAs(playwright, email, password, opened);
}

test("D01-SALES: suspension hides and stops every sale path for owner- and staff-created supply; existing customers, other organisations and reinstatement are unaffected", async ({ playwright }) => {
  test.setTimeout(180_000);
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN", "QA_USER"], async (f) => {
      const admin = f.actors.QA_ADMIN;
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager", "read_only_analyst"], ["owner", 0, 1]);
      const other = await syntheticOrg(playwright, f, opened, [], ["owner"]);
      const [owner, manager, analyst] = [org.owner, org.staff[0], org.staff[1]];
      const support = await supportAdmin(playwright, f, opened);

      // Supply created by the owner and by staff; plus listings that must never be published by reinstatement.
      const ownerCentre = await seedCentre(f, owner.id, { payment: "cash" });
      const staffCentre = await seedCentre(f, manager.id, { payment: "online", rate: 20 });
      const staffClub = await seedClub(f, manager.id, { price: 10, payment: "online" });
      const ownerExperience = await seedExperience(f, owner.id, { price: 0, payment: "cash" });
      const ownerProgram = await seedProgram(f, owner.id, ownerCentre.id, { price: 0 });
      const draftCentre = await seedCentre(f, owner.id, { status: "draft" });
      const pausedCentre = await seedCentre(f, manager.id, { status: "paused" });
      const rejectedClub = await seedClub(f, owner.id, { status: "rejected" });
      const otherCentre = await seedCentre(f, other.owner.id, { payment: "cash" });

      const g = await guest(playwright, opened);
      // An existing customer: a cash booking made before the suspension.
      const existing = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(ownerCentre, g.email, { date: irelandDate(20), time: "11:00" }) });
      expect(existing.status()).toBe(201);
      const existingRef = (await existing.json()).ref as string;
      f.track("bookings", "ref", existingRef); f.track("notifications", "ref", existingRef);
      // Checkouts already open when the suspension lands (stub sessions).
      const openPass = await f.actors.QA_USER.post("/api/passes/checkout", { data: { listingId: staffClub, creditsTotal: 2 } });
      expect(openPass.status()).toBe(201);
      const passRef = (await openPass.json()).ref as string;
      f.track("passes", "ref", passRef); f.track("audit_log", "object_id", passRef);
      const openBooking = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(staffCentre, g.email, { date: irelandDate(21), time: "12:00" }) });
      expect(openBooking.status()).toBe(201);
      const openBookingRef = (await openBooking.json()).ref as string;
      f.track("bookings", "ref", openBookingRef); f.track("audit_log", "object_id", openBookingRef);

      const statusSnapshot = async () =>
        (await rows(f, "SELECT id, status FROM centres WHERE id IN (?,?,?,?) UNION ALL SELECT id, status FROM clubs WHERE id IN (?,?) UNION ALL SELECT id, status FROM experiences WHERE id = ? UNION ALL SELECT id, status FROM programs WHERE id = ? ORDER BY id",
          [ownerCentre.id, staffCentre.id, draftCentre.id, pausedCentre.id, staffClub, rejectedClub, ownerExperience.id, ownerProgram])).map((r: any) => `${r.id}:${r.status}`);
      const statusesBefore = await statusSnapshot();

      // --- who may suspend, and the reason --------------------------------------
      expect((await support.put(`/api/admin/organisations/${org.id}/status`, { data: suspension })).status(), "support can't suspend an organisation").toBe(403);
      expect((await admin.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "suspended" } })).status(), "reason required").toBe(400);
      expect((await rows(f, "SELECT status FROM organisations WHERE id = ?", [org.id]))[0].status).toBe("active");
      expect((await admin.put(`/api/admin/organisations/${org.id}/status`, { data: suspension })).status()).toBe(200);
      const again = await admin.put(`/api/admin/organisations/${org.id}/status`, { data: suspension });
      expect((await again.json()).changed, "repeat is a no-op").toBe(false);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM moderation_decisions WHERE object_id = ?", [org.id]))[0].n).toBe(1);
      const [audit] = await rows(f, "SELECT new_value FROM audit_log WHERE object_id = ? AND action = 'organisation.suspended'", [org.id]);
      expect(JSON.parse(audit.new_value).decisionId).toBeTruthy();
      expect(audit.new_value).not.toContain(NOTE);

      // Listing statuses never rewritten.
      expect(await statusSnapshot()).toEqual(statusesBefore);

      // --- discovery and direct links -------------------------------------------
      const ids = async (path: string) => ((await (await g.ctx.get(path)).json()) as { id: string }[]).map((x) => x.id);
      const centres = await ids("/api/centres");
      expect(centres).not.toContain(ownerCentre.id);
      expect(centres).not.toContain(staffCentre.id); // created by staff, owned by the organisation
      expect(centres).toContain(otherCentre.id);
      expect(await ids("/api/clubs")).not.toContain(staffClub);
      expect(await ids("/api/experiences")).not.toContain(ownerExperience.id);
      expect(await ids("/api/programs")).not.toContain(ownerProgram);
      for (const [path, id] of [["/api/centres/", ownerCentre.id], ["/api/centres/", staffCentre.id], ["/api/clubs/", staffClub], ["/api/experiences/", ownerExperience.id], ["/api/programs/", ownerProgram], ["/api/providers/", owner.id]] as const) {
        const r = await g.ctx.get(`${path}${id}`);
        expect(r.status(), `${path}${id}`).toBe(200);
        const body = await r.json();
        expect(body.unavailable, `${path}${id} unavailable`).toBe(true);
        expect(JSON.stringify(body)).not.toMatch(/"(rooms|price|sessions|priceCents)"/);
      }
      // (The sitemap lists no listings before public launch; its organisation filter is covered by orgSuspension.test.ts.)

      // --- every sale path refused, whoever created the listing ------------------
      const refused: Record<string, number> = {
        ownerCentreBooking: (await g.ctx.post("/api/bookings/checkout", { data: bookingBody(ownerCentre, g.email, { date: irelandDate(22) }) })).status(),
        staffCentreBooking: (await g.ctx.post("/api/bookings/checkout", { data: bookingBody(staffCentre, g.email, { date: irelandDate(22) }) })).status(),
        staffClubRegistration: (await g.ctx.post("/api/registrations/checkout", { data: registrationBody(staffClub, g.email) })).status(),
        programmeEnrolment: (await g.ctx.post(`/api/programs/${ownerProgram}/enroll`, { data: enrolBody(g.email) })).status(),
        experienceBooking: (await g.ctx.post(`/api/experiences/${ownerExperience.id}/sessions/${ownerExperience.session}/checkout`, { data: experienceBody(g.email) })).status(),
        pass: (await f.actors.QA_USER.post("/api/passes/checkout", { data: { listingId: staffClub, creditsTotal: 2 } })).status(),
      };
      for (const [k, v] of Object.entries(refused)) expect([404, 409], k).toContain(v);
      expect(refused.ownerCentreBooking).toBe(409);
      expect(refused.staffCentreBooking).toBe(409);
      expect(refused.pass).toBe(409);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM bookings WHERE centre_id IN (?, ?) AND email = ? AND date = ?", [ownerCentre.id, staffCentre.id, g.email, irelandDate(22)]))[0].n).toBe(0);

      // --- payments for checkouts opened before the suspension --------------------
      expect((await provider(f.actors.QA_USER, "pass", passRef, "success")).status(), "late success is not confirmed").toBe(400);
      expect((await provider(g.ctx, "booking", openBookingRef, "success")).status()).toBe(400);
      expect((await rows(f, "SELECT payment_status FROM passes WHERE ref = ?", [passRef]))[0].payment_status).toBe("pending");
      expect((await rows(f, "SELECT payment_status, status FROM bookings WHERE ref = ?", [openBookingRef]))[0]).toEqual({ payment_status: "pending", status: "confirmed" });
      expect((await rows(f, "SELECT action FROM audit_log WHERE object_id IN (?, ?) AND action LIKE '%.held_org_suspended' ORDER BY action", [passRef, openBookingRef])).map((r: any) => r.action)).toEqual(["booking.held_org_suspended", "pass.held_org_suspended"]);

      // --- existing customers keep their bookings --------------------------------
      expect((await rows(f, "SELECT status, payment_status FROM bookings WHERE ref = ?", [existingRef]))[0]).toEqual({ status: "confirmed", payment_status: "paid" });
      expect(((await (await g.ctx.get("/api/bookings")).json()) as { ref: string }[]).map((b) => b.ref)).toContain(existingRef);
      expect((await g.ctx.get(`/api/bookings/status/${existingRef}`)).status()).toBe(200);

      // --- members: existing sessions, read-only obligations, role-scoped detail ---
      for (const [label, ctx] of [["owner", owner.ctx!], ["manager", manager.ctx!]] as const) {
        const r = await ctx.get("/api/vendor/listings");
        expect(r.status(), `${label} workspace`).toBe(403);
        expect((await r.json()).orgSuspended).toBe(true);
      }
      expect((await manager.ctx!.put(`/api/vendor/centres/${staffCentre.id}`, { data: { blurb: "edit while suspended" } })).status()).toBe(403);
      expect((await owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: "qa_nobody@example.test", platformRole: "finance" } })).status()).toBe(403);
      const ownerView = await (await owner.ctx!.get("/api/vendor/obligations")).json();
      expect(ownerView).toMatchObject({ orgStatus: "suspended", detail: true, decision: { category: "safety", explanation: suspension.explanation } });
      expect(ownerView.items.map((i: any) => i.ref)).toContain(existingRef);
      const ownerText = JSON.stringify(ownerView);
      expect(ownerText).not.toContain(NOTE);
      expect(ownerText).not.toContain(g.email); // first name only, never contact details
      const analystView = await (await analyst.ctx!.get("/api/vendor/obligations")).json();
      expect(analystView.detail).toBe(false);
      expect(analystView.items).toEqual([]);
      expect(JSON.stringify(analystView)).not.toContain(existingRef);
      expect(analystView.summary.length).toBeGreaterThan(0);
      expect((await mailTo(f.actors.QA_ADMIN, owner.email)).map((m) => m.subject)).toContain("Your organisation has been suspended on HelloCircle");
      expect((await mailTo(f.actors.QA_ADMIN, manager.email)).map((m) => m.subject)).toContain("Your organisation has been suspended on HelloCircle");

      // --- an unrelated organisation is untouched ---------------------------------
      expect((await other.owner.ctx!.get("/api/vendor/listings")).status()).toBe(200);
      const otherSale = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(otherCentre, g.email, { date: irelandDate(23) }) });
      expect(otherSale.status()).toBe(201);
      f.track("bookings", "ref", (await otherSale.json()).ref);

      // --- reinstatement restores exactly what was there --------------------------
      expect((await admin.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active", explanation: "Thanks for resolving the safety issues with your venues." } })).status()).toBe(200);
      expect(await statusSnapshot()).toEqual(statusesBefore);
      const after = await ids("/api/centres");
      expect(after).toContain(ownerCentre.id);
      expect(after).toContain(staffCentre.id);
      expect(after).not.toContain(draftCentre.id);
      expect(after).not.toContain(pausedCentre.id);
      expect(await ids("/api/clubs")).not.toContain(rejectedClub);
      expect((await owner.ctx!.get("/api/vendor/listings")).status(), "same session, next request").toBe(200);
      // The held payment confirms once the organisation can sell again.
      expect((await provider(f.actors.QA_USER, "pass", passRef, "success")).status()).toBe(200);
      expect((await rows(f, "SELECT payment_status FROM passes WHERE ref = ?", [passRef]))[0].payment_status).toBe("paid");
      const resumed = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(ownerCentre, g.email, { date: irelandDate(24) }) });
      expect(resumed.status()).toBe(201);
      f.track("bookings", "ref", (await resumed.json()).ref);

      // --- concurrent suspension and sales: every sale is either fully before or refused ---
      const day = irelandDate(26);
      const attempts = ["09:00", "11:00", "13:00", "15:00", "17:00"].map((time) => g.ctx.post("/api/bookings/checkout", { data: bookingBody(ownerCentre, g.email, { date: day, time, duration: 1 }) }));
      const [suspendRes, ...sales] = await Promise.all([admin.put(`/api/admin/organisations/${org.id}/status`, { data: suspension }), ...attempts]);
      expect(suspendRes.status()).toBe(200);
      const codes = sales.map((r) => r.status());
      for (const c of codes) expect([201, 409]).toContain(c);
      const made = (await rows(f, "SELECT ref FROM bookings WHERE centre_id = ? AND date = ?", [ownerCentre.id, day])).map((r: any) => r.ref);
      for (const ref of made) f.track("bookings", "ref", ref);
      expect(made.length, "rows exist exactly for the accepted sales").toBe(codes.filter((c) => c === 201).length);
      // After the suspension committed, nothing more is accepted.
      expect((await g.ctx.post("/api/bookings/checkout", { data: bookingBody(ownerCentre, g.email, { date: day, time: "19:00", duration: 1 }) })).status()).toBe(409);
      // Two admins suspending at once → one transition.
      expect((await admin.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);
      const both = await Promise.all([1, 2].map(() => admin.put(`/api/admin/organisations/${org.id}/status`, { data: suspension })));
      expect((await Promise.all(both.map((r) => r.json()))).map((b) => b.changed).sort()).toEqual([false, true]);
      expect((await admin.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);

      await evidence("d01-sales", { refusedPaths: Object.keys(refused).length, concurrentAccepted: codes.filter((c) => c === 201).length, concurrentRefused: codes.filter((c) => c === 409).length, heldLatePayments: 2 });
    });
  } finally {
    for (const c of opened) await c.dispose();
  }
});
