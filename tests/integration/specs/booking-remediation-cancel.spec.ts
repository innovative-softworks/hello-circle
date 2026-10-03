import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableCentre, bookableClub, bookingBody, guest, registrationBody } from "../booking-fixture";

// HC-QA-046 extended — 6 simultaneous cancels per model. Booking and
// registration cancels sit behind the real 10-request lookup limiter, so each
// test runs in its own fresh backend batch (no limiter bypass).

for (const kind of ["booking", "registration"] as const) {
  test(`REM-046-${kind.toUpperCase()}: six simultaneous cancels → one transition, one release, one notification set`, async ({ playwright }) => {
    test.skip(process.env.QA_AUTH_BATCH !== `booking-remediation-cancel-${kind}`, "runs in its own limiter batch");
    await withActors(playwright, ["QA_VENDOR"], async f => {
      const opened: APIRequestContext[] = [];
      try {
        const g = await guest(playwright, opened);
        let ref: string, listing: string;
        if (kind === "booking") {
          const centre = await bookableCentre(f, { rate: 20 });
          listing = centre.id;
          ref = (await (await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email) })).json()).ref;
        } else {
          listing = await bookableClub(f, { price: 0, capacity: 1 });
          ref = (await (await g.ctx.post("/api/registrations/checkout", { data: registrationBody(listing, g.email) })).json()).ref;
        }
        await new Promise(r => setTimeout(r, 800));
        const before = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length;
        const path = kind === "booking" ? `/api/bookings/${ref}/cancel` : `/api/registrations/${ref}/cancel`;
        const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => g.ctx.post(path, { data: {} })));
        await new Promise(r => setTimeout(r, 1200));
        const after = (await rows(f, "SELECT id FROM notifications WHERE ref = ?", [ref])).length - before;
        const table = kind === "booking" ? "bookings" : "registrations";
        expect(results.map(r => r.status()).sort()).toEqual([200, 409, 409, 409, 409, 409]);
        expect((await rows(f, `SELECT status FROM ${table} WHERE ref = ?`, [ref]))[0].status).toBe("cancelled");
        expect(after, "one cancellation notification set").toBeLessThanOrEqual(2);
        if (kind === "registration") {
          // Capacity released once: the single place is bookable again exactly once.
          const [x, y] = await Promise.all([1, 2].map(() => guest(playwright, opened)));
          const rebook = await Promise.all([x, y].map(h => h.ctx.post("/api/registrations/checkout", { data: registrationBody(listing, h.email) })));
          expect(rebook.map(r => r.status()).sort()).toEqual([201, 409]);
        }
        await evidence(`rem-046-${kind}`, { statuses: results.map(r => r.status()).sort().join(","), notifications: after });
      } finally { for (const c of opened) await c.dispose(); }
    });
  });
}
