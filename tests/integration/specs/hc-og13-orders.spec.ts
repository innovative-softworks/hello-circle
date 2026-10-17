import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import { bookableCentre, bookableClub, bookableExperience, bookingBody, experienceBody, guest, irelandDate, registrationBody } from "../booking-fixture";

// OG-13 / DEC-04 — the partner's read-only All orders list in a real browser:
// one list over hall bookings, club registrations and experience bookings;
// type / status / date / search filters kept in the URL; each row opens the
// record that manages it; another organisation's orders never appear and its
// booking record can't be opened by URL. Synthetic cash/free orders only.

test("OG-13-ORDERS: All orders lists every order type, filters in the URL, opens records, and never shows another organisation's orders", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  const opened: APIRequestContext[] = [];
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "QA_USER", "GUEST"], async (f) => {
    const tag = randomUUID().slice(0, 6);
    // Our organisation: a hall booking (cash → paid), a free club registration, an experience booking.
    const centre = await bookableCentre(f, { rate: 20, cap: 10 });
    const g = await guest(playwright, opened);
    const hall = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { name: `OG13 Hall ${tag}` }) });
    expect(hall.status()).toBe(201);
    const hallRef = (await hall.json()).ref as string;
    const club = await bookableClub(f, { price: 0 });
    const reg = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { childFirst: "OG13", childLast: `Club${tag}` }) });
    expect(reg.status()).toBe(201);
    const regRef = (await reg.json()).ref as string;
    const exp = await bookableExperience(f, { price: 1000, capacity: 4, payment: "cash", date: irelandDate(20) });
    const xb = await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email, { participantName: `OG13 Trip ${tag}` }) });
    expect(xb.status()).toBe(201);
    const expRef = (await xb.json()).ref as string;
    // Another organisation's booking.
    const otherCentre = await bookableCentre(f, { rate: 20, cap: 10, owner: "QA_VENDOR_B" });
    const ob = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(otherCentre, g.email, { name: `OG13 Other ${tag}` }) });
    expect(ob.status()).toBe(201);
    const otherRef = (await ob.json()).ref as string;
    expect((await rows(f, "SELECT payment_status FROM bookings WHERE ref IN (?, ?) ORDER BY ref", [hallRef, otherRef])).map((r) => r.payment_status)).toEqual(["paid", "paid"]);

    // --- server: scoped to the caller's organisation; signed-out and residents refused ----
    const refsOf = async (actor: APIRequestContext) => ((await (await actor.get("/api/vendor/orders")).json()) as { ref: string }[]).map((o) => o.ref);
    const mine = await refsOf(f.actors.QA_VENDOR);
    expect(mine).toEqual(expect.arrayContaining([hallRef, regRef, expRef]));
    expect(mine, "another organisation's order never listed").not.toContain(otherRef);
    const theirs = await refsOf(f.actors.QA_VENDOR_B);
    expect(theirs).toContain(otherRef);
    expect(theirs.some((r) => [hallRef, regRef, expRef].includes(r)), "and the other way round").toBe(false);
    expect((await f.actors.GUEST.get("/api/vendor/orders")).status(), "signed out").toBe(401);
    expect([401, 403], "a resident session is not a partner").toContain((await f.actors.QA_USER.get("/api/vendor/orders")).status());

    // --- browser ------------------------------------------------------------------------
    const v = await staffActor(browser, "QA_VENDOR");
    try {
      await v.page.goto("/vendor?tab=bookings&bsec=all");
      const list = v.page.getByRole("table");
      await expect(v.page.getByRole("heading", { name: "All orders" })).toBeVisible();
      for (const name of [`OG13 Hall ${tag}`, `OG13 Club${tag}`, `OG13 Trip ${tag}`]) await expect(list.getByText(name, { exact: false }).first()).toBeVisible();
      await expect(list.getByText(`OG13 Other ${tag}`)).toHaveCount(0);

      // Search by reference → one row; the filter is in the URL and survives a reload.
      await v.page.getByLabel("Search orders").fill(regRef);
      await expect(list.locator("tbody tr")).toHaveCount(1);
      await expect(list.getByText(`OG13 Club${tag}`, { exact: false })).toBeVisible();
      await expect.poll(() => new URL(v.page.url()).searchParams.get("oq")).toBe(regRef);
      await v.page.reload();
      await expect(v.page.getByLabel("Search orders")).toHaveValue(regRef);
      await expect(v.page.getByRole("table").locator("tbody tr")).toHaveCount(1);

      // Type filter + search by tag: only the experience booking.
      await v.page.getByLabel("Search orders").fill(tag);
      await v.page.getByLabel("Type", { exact: true }).selectOption("experience");
      await expect(v.page.getByRole("table").locator("tbody tr")).toHaveCount(1);
      await expect(v.page.getByRole("table").getByText(`OG13 Trip ${tag}`)).toBeVisible();
      // Date range that excludes the experience (it's on day 20) → nothing matches.
      await v.page.getByLabel("To", { exact: true }).fill(irelandDate(15));
      await expect(v.page.getByText("No orders match")).toBeVisible();
      await v.page.getByLabel("To", { exact: true }).fill("");
      // Status: cancelled → none of ours.
      await v.page.getByLabel("Type", { exact: true }).selectOption("all");
      await v.page.getByLabel("Status", { exact: true }).selectOption("cancelled");
      await expect(v.page.getByText("No orders match")).toBeVisible();
      await v.page.getByLabel("Status", { exact: true }).selectOption("all");
      // Another organisation's reference: nothing, even searched exactly.
      await v.page.getByLabel("Search orders").fill(otherRef);
      await expect(v.page.getByText("No orders match")).toBeVisible();

      // Record navigation: the hall booking opens its booking record (H1 = booker), Back returns to the list.
      await v.page.getByLabel("Search orders").fill(hallRef);
      await v.page.getByRole("button", { name: `Open OG13 Hall ${tag}'s hall booking` }).click();
      await expect(v.page.getByRole("heading", { level: 1, name: `OG13 Hall ${tag}` })).toBeVisible();
      expect(new URL(v.page.url()).searchParams.get("record")).toBe(`booking:${hallRef}`);
      await v.page.goBack();
      await expect(v.page.getByRole("heading", { name: "All orders" })).toBeVisible();
      // The experience row opens that experience's page.
      await v.page.getByLabel("Search orders").fill(expRef);
      await v.page.getByRole("button", { name: `Open OG13 Trip ${tag}'s experience` }).click();
      await expect(v.page).toHaveURL(new RegExp(`/vendor/experiences/${exp.id}`));

      // Another organisation's booking record by URL: "not found", no details.
      await v.page.goto(`/vendor?tab=bookings&record=booking:${otherRef}`);
      await expect(v.page.getByText("It may belong to another organisation, or the reference is wrong.")).toBeVisible();
      await expect(v.page.getByText(`OG13 Other ${tag}`)).toHaveCount(0);

      // A failed load shows an error with Retry, never an empty list.
      await v.page.route("**/api/vendor/orders", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "QA simulated failure" }) }));
      await v.page.goto("/vendor?tab=bookings&bsec=all");
      await expect(v.page.getByText("Couldn't load your orders")).toBeVisible();
      await expect(v.page.getByText("No orders yet")).toHaveCount(0);
      await v.page.unroute("**/api/vendor/orders");
      await v.page.getByRole("button", { name: /Retry|Try again/ }).first().click();
      await expect(v.page.getByRole("table").getByText(`OG13 Hall ${tag}`)).toBeVisible();

      await evidence("og-13-orders", { types: "booking,registration,experience", filtersInUrl: true, recordOpens: true, crossOrgListed: false, crossOrgRecord: "missing", errorState: true });
      expect(v.consoleErrors, "no page errors").toEqual([]);
    } finally {
      await v.close();
      for (const c of opened) await c.dispose();
    }
    void personas;
  });
});
