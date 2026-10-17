import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import type { Scope } from "../stage-b-fixture";
import { piiOrders } from "../pii-fixture";

// Security decision Option A (2026-10-17) — the same rules in a real browser,
// including opening records directly by URL. Logins: QA_VENDOR (fixtures) +
// three staff browsers = 4.

async function staffAccount(f: Scope, platformRole: string) {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_pii_${platformRole}_${id.slice(0, 8)}@example.test`;
  const [[{ org_id: orgId }]] = await f.connection.query<any[]>("SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', ?, ?, ?, 1)", [id, email, bcrypt.hashSync(password, 10), `QA ${platformRole}`, orgId, platformRole]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  return { email, password };
}

/** The page's whole text, after its data has loaded. */
async function settledText(page: Page) {
  await page.waitForLoadState("networkidle");
  return (await page.locator("body").innerText()) ?? "";
}

test("PII-UI: analyst, communications and finance see exactly their customer data, including records opened by URL", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  const opened: APIRequestContext[] = [];
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const o = await piiOrders(playwright, f, opened);
    const pii = [o.email, o.name, o.child, o.participant, o.waitlistEmail, "0851112222"];
    const noPii = (text: string, where: string) => { for (const p of pii) expect(text, `${where}: no customer data`).not.toContain(p); };
    const analyst = await staffActor(browser, "QA_VENDOR_STAFF", { credentials: await staffAccount(f, "read_only_analyst") });
    const comms = await staffActor(browser, "QA_VENDOR_STAFF", { credentials: await staffAccount(f, "communications") });
    const finance = await staffActor(browser, "QA_VENDOR_STAFF", { credentials: await staffAccount(f, "finance") });
    try {
      // --- read-only analyst: no customer data anywhere, even by direct URL -------------
      const a = analyst.page;
      await a.goto("/vendor");
      await expect(a.getByRole("heading", { level: 1 }).first()).toBeVisible();
      noPii(await settledText(a), "analyst overview");
      for (const url of [
        `/vendor?tab=bookings&record=booking:${o.hallRef}`,
        "/vendor?tab=bookings&bsec=all",
        `/vendor?tab=customers&record=customer:${encodeURIComponent(o.email)}`,
        "/vendor?tab=customers",
        `/vendor/experiences/${o.exp.id}`,
        `/vendor/programs/${o.program}`,
        `/vendor/clubs/${o.club}`,
      ]) {
        await a.goto(url);
        noPii(await settledText(a), `analyst ${url}`);
      }
      // The experience page's Bookings section is refused, not shown empty.
      await a.goto(`/vendor/experiences/${o.exp.id}`);
      const bookingsTab = a.locator("button[aria-pressed]", { hasText: /^Bookings$/ });
      await bookingsTab.click();
      await expect(a.getByText("Couldn't load bookings for this listing.")).toBeVisible();
      noPii(await settledText(a), "analyst experience bookings");
      // The analyst's CSV export has the orders without names or emails.
      const csv = await analyst.context.request.get("/api/vendor/reports/bookings.csv");
      expect(csv.status()).toBe(200);
      const csvText = await csv.text();
      expect(csvText).toContain(o.hallRef);
      noPii(csvText, "analyst CSV");

      // --- communications: the Customers record, but not the order records ---------------
      const c = comms.page;
      await c.goto(`/vendor?tab=customers&record=customer:${encodeURIComponent(o.email)}`);
      await expect(c.locator(`a[href="mailto:${o.email}"]`).first()).toBeVisible();
      // The hall booking is listed as plain text: its booking record isn't theirs to open.
      const customerText = await settledText(c);
      expect(customerText).toContain(o.hallRef);
      await expect(c.getByRole("table").locator("button.adm-linkish")).toHaveCount(0);
      for (const url of [`/vendor?tab=bookings&record=booking:${o.hallRef}`, "/vendor?tab=bookings&bsec=all", `/vendor/experiences/${o.exp.id}`]) {
        await c.goto(url);
        const text = await settledText(c);
        for (const p of [o.child, o.participant, "0851112222"]) expect(text, `communications ${url}`).not.toContain(p);
      }
      expect((await comms.context.request.get(`/api/vendor/bookings`)).status(), "order records refused").toBe(403);
      await c.goto("/vendor?tab=org");
      await expect(c.getByRole("button", { name: "Export bookings CSV" })).toHaveCount(0);

      // --- finance: the order records, by list and by URL ---------------------------------
      const fp = finance.page;
      await fp.goto("/vendor?tab=bookings&bsec=all");
      await expect(fp.getByRole("table").getByText(o.name).first()).toBeVisible();
      await fp.goto(`/vendor?tab=bookings&record=booking:${o.hallRef}`);
      await expect(fp.getByRole("heading", { level: 1, name: o.name })).toBeVisible();
      // Finance doesn't run listing rosters.
      expect((await finance.context.request.get(`/api/vendor/experiences/${o.exp.id}/bookings`)).status()).toBe(403);

      await evidence("pii-ui", { analystPagesChecked: 8, communicationsCustomerRecord: true, communicationsOrderRecordsRefused: true, financeOrderRecord: true });
      expect((await rows(f, "SELECT COUNT(*) AS n FROM bookings WHERE ref = ?", [o.hallRef]))[0].n).toBe(1);
      expect([...analyst.consoleErrors, ...comms.consoleErrors, ...finance.consoleErrors], "no page errors").toEqual([]);
    } finally {
      await analyst.close();
      await comms.close();
      await finance.close();
      for (const x of opened) await x.dispose();
    }
  });
});
