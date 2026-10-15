import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, clubFor, programFor, staffLogin } from "../stage-b-fixture";

// Full validation 2026-10-14 — invited-staff role matrix against the real
// server (no UI). The audit's reference doc claimed programme writes were
// unguarded; this proves the current behaviour per role, with every denied
// request leaving the targeted rows byte-identical. Owner (QA_VENDOR) is the
// positive control. 6 logins: owner + five staff roles.

const ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;

test("VAL-STAFF-MATRIX: programme, schedule, money, messaging and org actions follow platform_role", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_VENDOR"], async (f) => {
      const centre = await centreFor(f, "QA_VENDOR");
      const club = await clubFor(f, "QA_VENDOR");
      const centreProgram = await programFor(f, "QA_VENDOR", centre.id);
      const observed: Record<string, number> = {};
      for (const role of ROLES) {
        const staff = await staffLogin(playwright, f, "QA_VENDOR", role, opened);
        const c = staff.context;
        const programRow = await f.snapshot("SELECT * FROM programs WHERE id = ?", [centreProgram]);
        const sessions = await f.snapshot("SELECT COUNT(*) AS n FROM program_sessions WHERE program_id = ?", [centreProgram]);

        // Programme create — role follows the listing the programme is attached to.
        const createCentre = await c.post("/api/vendor/programs", { data: { listingType: "centre", listingId: centre.id, title: `QA ${role}`, description: "Validation" } });
        const createClub = await c.post("/api/vendor/programs", { data: { listingType: "club", listingId: club, title: `QA ${role}`, description: "Validation" } });
        for (const r of [createCentre, createClub]) if (r.status() === 201) {
          const id = (await r.json()).id as string;
          f.track("programs", "id", id); f.track("program_sessions", "program_id", id);
        }
        expect(createCentre.status(), `${role} create centre programme`).toBe(role === "centre_manager" ? 201 : 403);
        expect(createClub.status(), `${role} create club programme`).toBe(role === "facility_manager" ? 201 : 403);

        // Edit / add session / archive on the owner's centre programme.
        const edit = await c.put(`/api/vendor/programs/${centreProgram}`, { data: { title: `Edited by ${role}` } });
        const session = await c.post(`/api/vendor/programs/${centreProgram}/sessions`, { data: { date: "2030-06-21", time: "10:00", durationMinutes: 60 } });
        const allowed = role === "centre_manager";
        expect(edit.status(), `${role} edit programme`).toBe(allowed ? 200 : 403);
        expect([201, 200].includes(session.status()) ? "ok" : session.status(), `${role} add session`).toBe(allowed ? "ok" : 403);
        if (!allowed) {
          expect((await c.delete(`/api/vendor/programs/${centreProgram}`)).status(), `${role} archive programme`).toBe(403);
          await programRow();
          await sessions();
        } else {
          // Restore the title for later roles' snapshots.
          expect((await c.put(`/api/vendor/programs/${centreProgram}`, { data: { title: "QA stage B programme" } })).status()).toBe(200);
        }

        // Money: partner coupons and payments are finance-only; CSV also for the analyst.
        const code = `VAL${randomUUID().slice(0, 8).toUpperCase()}`;
        const coupon = await c.post("/api/vendor/coupons", { data: { code, kind: "percent", amount: 10, eligibleListingType: "centre", eligibleListingId: centre.id } });
        if (coupon.status() === 201 || coupon.status() === 200) f.track("coupons", "code", code);
        expect(coupon.status() < 300, `${role} create coupon`).toBe(role === "finance");
        expect((await c.get("/api/vendor/payments")).status(), `${role} payments`).toBe(role === "finance" ? 200 : 403);
        expect((await c.get("/api/vendor/reports/bookings.csv")).status(), `${role} CSV`).toBe(["finance", "read_only_analyst"].includes(role) ? 200 : 403);

        // Messaging: communications only (no paid participants, so nothing is sent).
        const message = await c.post("/api/vendor/messages", { data: { listingType: "centre", listingId: centre.id, subject: "QA", body: "Validation only" } });
        expect(message.status() < 300, `${role} broadcast`).toBe(role === "communications");

        // Owner-only organisation actions.
        expect((await c.post("/api/vendor/org/staff/invite", { data: { email: `qa_inv_${randomUUID()}@example.test`, platformRole: "finance" } })).status(), `${role} invite`).toBe(403);
        expect((await c.put("/api/vendor/org/policies", { data: { cancellationHours: 1 } })).status(), `${role} policies`).toBe(403);

        // Claims carry no role check today (decision needed) — recorded, not asserted.
        const unowned = randomUUID();
        await f.connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb, status, vendor_id) VALUES (?, 'QA unowned', 'QA', 'Dublin', 0, 0, 10, 0, '', '', 'QA', 'approved', NULL)", [unowned]);
        f.track("listing_claims", "listing_id", unowned); f.track("centres", "id", unowned);
        observed[`claim_${role}`] = (await c.post("/api/vendor/claims", { data: { listingType: "centre", listingId: unowned } })).status();
      }
      await evidence("val-staff-matrix", { roles: ROLES.length, ...observed });
    });
  } finally { for (const c of opened) await c.dispose(); }
});
