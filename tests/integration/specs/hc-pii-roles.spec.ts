import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { staffLogin } from "../stage-b-fixture";
import { piiOrders, STAFF_ROLES } from "../pii-fixture";

// Security decision Option A (2026-10-17) — customer personal data by partner
// staff role, against the real server. One invited staff member per role in
// QA_VENDOR's organisation, the owner as a control, and another organisation
// (QA_VENDOR_B). Logins: 2 actors + 5 staff = 7.
//
//   order records (Bookings tab)        centre_manager, facility_manager, finance
//   listing rosters                     centre_manager, facility_manager
//   Customers directory / contacts      + communications
//   bookings CSV                        finance (full); read_only_analyst (no name/email)
//   Overview "today"                    booker name only for the Customers roles

type Role = (typeof STAFF_ROLES)[number] | "owner";
const ORDER: Role[] = ["owner", "centre_manager", "facility_manager", "finance"];
const ROSTER: Role[] = ["owner", "centre_manager", "facility_manager"];
const CUSTOMER: Role[] = ["owner", "centre_manager", "facility_manager", "finance", "communications"];

test("PII-ROLES: every endpoint with customer personal data is limited to its roles; other organisations see nothing", async ({ playwright }) => {
  test.setTimeout(120_000);
  const opened: APIRequestContext[] = [];
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    try {
      const o = await piiOrders(playwright, f, opened);
      const as: Record<Role, APIRequestContext> = { owner: f.actors.QA_VENDOR } as Record<Role, APIRequestContext>;
      for (const role of STAFF_ROLES) as[role] = (await staffLogin(playwright, f, "QA_VENDOR", role, opened)).context;
      const roles = Object.keys(as) as Role[];

      // [path, roles allowed, a string that must appear for allowed roles]
      const reads: [string, Role[], string][] = [
        ["/api/vendor/orders", ORDER, o.email],
        ["/api/vendor/bookings", ORDER, o.email],
        ["/api/vendor/registrations", ORDER, o.child],
        [`/api/vendor/bookings/${o.hallRef}/changes`, ORDER, "["],
        [`/api/vendor/experiences/${o.exp.id}/bookings`, ROSTER, o.participant],
        [`/api/vendor/programs/${o.program}/enrollments`, ROSTER, o.email],
        [`/api/vendor/clubs/${o.club}/participants`, ROSTER, o.child],
        [`/api/vendor/clubs/${o.club}/waitlist`, ROSTER, o.waitlistEmail],
        ["/api/vendor/customers", CUSTOMER, o.email],
        [`/api/vendor/customers/${encodeURIComponent(o.email)}`, CUSTOMER, o.email],
        ["/api/vendor/participants", CUSTOMER, o.email],
      ];
      const matrix: string[] = [];
      for (const [path, allowed, marker] of reads) {
        for (const role of roles) {
          const r = await as[role].get(path);
          const body = await r.text();
          if (allowed.includes(role)) {
            expect(r.status(), `${role} ${path}`).toBe(200);
            expect(body, `${role} ${path} has the data`).toContain(marker);
          } else {
            expect(r.status(), `${role} ${path} refused`).toBe(403);
            for (const pii of [o.email, o.name, o.child, o.participant, o.waitlistEmail]) expect(body, `${role} ${path} leaks nothing`).not.toContain(pii);
          }
          matrix.push(`${path.replace(/\/[0-9a-f-]{36}|%40.*|HB[\w-]+/g, "/:id")} ${role}=${r.status()}`);
        }
        // Another organisation: refused or empty, never this organisation's customer.
        const other = await f.actors.QA_VENDOR_B.get(path);
        const otherBody = await other.text();
        expect([200, 403, 404], `other org ${path}`).toContain(other.status());
        for (const pii of [o.email, o.name, o.child, o.participant, o.waitlistEmail]) expect(otherBody, `other org ${path} leaks nothing`).not.toContain(pii);
      }

      // Bookings CSV: finance and the owner get contact columns; the analyst gets the rows without them; others refused.
      for (const role of roles) {
        const r = await as[role].get("/api/vendor/reports/bookings.csv");
        const text = await r.text();
        if (role === "owner" || role === "finance") {
          expect(r.status(), role).toBe(200);
          expect(text.split("\n")[0]).toContain("name,email");
          expect(text).toContain(o.email);
        } else if (role === "read_only_analyst") {
          expect(r.status()).toBe(200);
          expect(text.split("\n")[0]).toBe("ref,centre,date,time,duration,guests,total_euro,status");
          expect(text, "analyst CSV has the order").toContain(o.hallRef);
          expect(text).not.toContain(o.email);
          expect(text).not.toContain(o.name);
        } else expect(r.status(), `${role} CSV refused`).toBe(403);
      }

      // Overview "today": every role sees the booking; only the Customers roles see the booker's name.
      for (const role of roles) {
        const today = await (await as[role].get("/api/vendor/today")).json();
        const mine = today.bookings.find((b: any) => b.ref === o.hallRef);
        expect(mine, `${role} sees today's booking`).toBeTruthy();
        expect(mine.name, `${role} booker name`).toBe(CUSTOMER.includes(role) ? o.name : null);
        expect(mine.guests).toBe(5);
      }

      await evidence("pii-roles", { endpoints: reads.length + 2, roles: roles.length, checks: matrix.length, matrix: matrix.join("; ") });
    } finally {
      for (const c of opened) await c.dispose();
    }
  });
});
