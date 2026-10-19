import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Page } from "@playwright/test";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import type { Scope } from "../stage-b-fixture";

// OG-15 — the admin Exceptions inbox: an open money exception is listed with
// its type filter and links to the Finance record that resolves it; a failed
// load shows an error with Try again; roles without payment-state access are
// refused by the server and don't get the page.
// OG-24 — the admin Vendors and All listings pages page on the server: status
// counts, filters, search, sorting and record navigation, with page numbers in
// the URL. Synthetic rows only (exact-ID inserts, tracked for cleanup).

async function subAdmin(f: Scope, adminRole: string) {
  const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_og15_${adminRole}_${id.slice(0, 8)}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', ?, ?)", [id, email, bcrypt.hashSync(password, 10), `QA ${adminRole} admin`, adminRole]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  return { id, email, password };
}

const viewButton = (page: Page, group: string, label: string) => page.getByRole("group", { name: group }).getByRole("button", { name: new RegExp(`^${label}\\s*\\d*$`) });

test("OG-15-EXCEPTIONS: an open exception is listed, filtered and opens its Finance record; failed loads retry; roles without access are refused", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR", "GUEST"], async (f) => {
    const tag = randomUUID().slice(0, 8);
    const eventId = `evt_qa_og15_${tag}`;
    await f.connection.execute(
      "INSERT INTO webhook_events (provider, event_id, event_type, summary, payload_sha256, status, attempts, last_error) VALUES ('stripe', ?, 'checkout.session.expired', '{}', ?, 'failed', 1, ?)",
      [eventId, randomBytes(32).toString("hex"), `QA simulated failure ${tag}`]
    );
    f.track("webhook_events", "event_id", eventId);
    const [{ id: rowId }] = await rows(f, "SELECT id FROM webhook_events WHERE event_id = ?", [eventId]);
    const legal = await subAdmin(f, "legal");
    const support = await subAdmin(f, "support");

    // Server: who may read the inbox.
    const admin = await staffActor(browser, "QA_ADMIN");
    const legalUi = await staffActor(browser, "legal", { credentials: legal });
    const supportUi = await staffActor(browser, "support", { credentials: support });
    try {
      const list = await (await admin.context.request.get("/api/admin/finance/exceptions")).json();
      const mine = list.find((e: any) => e.id === `webhook_failed:${rowId}`);
      expect(mine).toMatchObject({ kind: "webhook_failed", severity: "medium", link: `?tab=finance&section=events&record=event:${rowId}` });
      expect((await supportUi.context.request.get("/api/admin/finance/exceptions")).status(), "support reads payment state").toBe(200);
      expect((await legalUi.context.request.get("/api/admin/finance/exceptions")).status(), "legal has no payment-state access").toBe(403);
      expect((await f.actors.QA_VENDOR.get("/api/admin/finance/exceptions")).status(), "a partner is not an admin").toBe(403);
      expect((await f.actors.GUEST.get("/api/admin/finance/exceptions")).status(), "signed out").toBe(401);

      // Browser (super): listed with its detail, filtered by type, and the link opens the Finance record.
      await admin.page.goto("/admin?tab=exceptions");
      const table = admin.page.getByRole("table", { name: "Open exceptions" });
      const row = table.locator("tr", { hasText: `QA simulated failure ${tag}` });
      await expect(row).toBeVisible();
      await expect(row.getByText("Payment event failed · checkout.session.expired")).toBeVisible();
      await admin.page.getByLabel("Type", { exact: true }).selectOption("dispute");
      await expect(admin.page.getByText(`QA simulated failure ${tag}`)).toHaveCount(0);
      await admin.page.getByLabel("Type", { exact: true }).selectOption("webhook_failed");
      await expect(row).toBeVisible();
      expect(new URL(admin.page.url()).searchParams.get("kind"), "filter kept in the URL").toBe("webhook_failed");
      await row.getByRole("link", { name: "Open" }).click();
      await expect(admin.page).toHaveURL(new RegExp(`record=event%3A${rowId}|record=event:${rowId}`));
      await expect(admin.page.getByRole("heading", { level: 1, name: "checkout.session.expired" })).toBeVisible();
      await expect(admin.page.getByText(`QA simulated failure ${tag}`).first()).toBeVisible();

      // A failed load: an error with Try again, never "Nothing needs attention".
      await admin.page.route("**/api/admin/finance/exceptions", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "QA simulated failure" }) }));
      await admin.page.goto("/admin?tab=exceptions");
      await expect(admin.page.getByText("Couldn't load the exceptions")).toBeVisible();
      await expect(admin.page.getByText("Nothing needs attention")).toHaveCount(0);
      await admin.page.unroute("**/api/admin/finance/exceptions");
      await admin.page.getByRole("button", { name: "Try again" }).click();
      await expect(admin.page.getByText(`QA simulated failure ${tag}`)).toBeVisible();

      // Legal admin: the page isn't offered, and opening it by URL shows no exception rows.
      await legalUi.page.goto("/admin?tab=exceptions");
      await expect(legalUi.page.getByText(`QA simulated failure ${tag}`)).toHaveCount(0);
      await expect(legalUi.page.getByRole("table", { name: "Open exceptions" })).toHaveCount(0);

      await evidence("og-15-exceptions", { listed: true, filter: true, linkOpensRecord: true, errorRetry: true, permissionStatuses: "super 200, support 200, legal 403, vendor 403, guest 401" });
      expect([...admin.consoleErrors, ...legalUi.consoleErrors], "no page errors").toEqual([]);
    } finally {
      await admin.close();
      await legalUi.close();
      await supportUi.close();
    }
  });
});

test("OG-24-PAGING: Vendors and All listings page on the server with counts, filters, search, sort and record navigation", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, [], async (f) => {
    const tag = `OG24${randomUUID().slice(0, 6)}`;
    // 25 partners: 3 pending, 18 approved, 4 suspended; 5 of them sports clubs. Newest = highest number.
    const vendorIds: string[] = [];
    for (let i = 1; i <= 25; i++) {
      const id = `qa-og24-${tag}-${i}`;
      const status = i <= 3 ? "pending" : i <= 21 ? "approved" : "suspended";
      await f.connection.execute(
        "INSERT INTO users (id, email, password_hash, role, status, name, business_name, vendor_type, county, created_at) VALUES (?, ?, 'x', 'vendor', ?, 'QA paging', ?, ?, 'Cork', DATE_SUB(NOW(), INTERVAL ? MINUTE))",
        [id, `${id}@example.test`, status, `${tag} Biz ${String(i).padStart(2, "0")}`, i % 5 === 0 ? "sports" : "community", 100 - i]
      );
      f.track("users", "id", id);
      vendorIds.push(id);
    }
    // 22 centres owned by partner 4: 2 pending, 20 live; 2 in Kerry.
    for (let i = 1; i <= 22; i++) {
      const id = `qa-og24-c-${tag}-${i}`;
      await f.connection.execute(
        "INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at) VALUES (?, ?, 'QA', ?, 0, 0, 1, 1, 'QA', '', '', '', ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))",
        [id, `${tag} Hall ${String(i).padStart(2, "0")}`, i > 20 ? "Kerry" : "Cork", vendorIds[3], i <= 2 ? "pending" : "approved", 100 - i]
      );
      f.track("centres", "id", id);
    }
    const admin = await staffActor(browser, "QA_ADMIN");
    const pagedCalls: string[] = [];
    admin.page.on("request", (r) => {
      const u = new URL(r.url());
      if (/^\/api\/admin\/(vendors|listings)$/.test(u.pathname) && u.searchParams.has("page")) pagedCalls.push(`${u.pathname}?${u.searchParams.toString()}`);
    });
    try {
      // --- Vendors -------------------------------------------------------------------
      await admin.page.goto(`/admin?tab=vendors&q=${encodeURIComponent(tag)}`);
      const counts = admin.page.getByRole("group", { name: "Account status" });
      await expect(counts.getByRole("button", { name: /^All\s*25$/ })).toBeVisible();
      await expect(counts.getByRole("button", { name: /^Pending\s*3$/ })).toBeVisible();
      await expect(counts.getByRole("button", { name: /^Approved\s*18$/ })).toBeVisible();
      await expect(counts.getByRole("button", { name: /^Suspended\s*4$/ })).toBeVisible();
      await expect(admin.page.getByText("Showing 1–20 of 25 partners")).toBeVisible();
      // Pending first (newest pending = Biz 03), then newest.
      const firstRows = admin.page.getByRole("table", { name: "Partner accounts" }).locator("tbody tr");
      await expect(firstRows.first()).toContainText(`${tag} Biz 03`);
      await expect(firstRows.nth(3)).toContainText(`${tag} Biz 25`);
      await admin.page.getByRole("button", { name: "Next page" }).click();
      await expect(admin.page.getByText("Showing 21–25 of 25 partners")).toBeVisible();
      expect(new URL(admin.page.url()).searchParams.get("page")).toBe("2");
      // Record navigation from page 2, and Back lands on page 2 again.
      const lastRow = admin.page.getByRole("table", { name: "Partner accounts" }).locator("tbody tr").last();
      const lastName = (await lastRow.locator(".adm-cell-title").textContent())!.trim();
      await lastRow.getByRole("button", { name: /^(Open|Review) / }).click();
      await expect(admin.page.getByRole("heading", { level: 1, name: lastName })).toBeVisible();
      await admin.page.goBack();
      await expect(admin.page.getByText("Showing 21–25 of 25 partners")).toBeVisible();
      // A status tab resets to page 1 and counts stay over the search.
      await viewButton(admin.page, "Account status", "Suspended").click();
      await expect(admin.page.getByText("Showing 1–4 of 4 partners")).toBeVisible();
      expect(new URL(admin.page.url()).searchParams.get("page") ?? "1").toBe("1");
      // Type filter narrows the counts too.
      await viewButton(admin.page, "Account status", "All").click();
      await admin.page.getByLabel("Type", { exact: true }).selectOption("sports");
      await expect(counts.getByRole("button", { name: /^All\s*5$/ })).toBeVisible();
      // A partner record by URL loads on its own (no list needed); an unknown one is "not found".
      await admin.page.goto(`/admin?tab=vendors&record=${vendorIds[3]}`);
      await expect(admin.page.getByRole("heading", { level: 1, name: `${tag} Biz 04` })).toBeVisible();
      await expect(admin.page.getByText(`${tag} Hall 01`)).toBeVisible(); // its listings, from the server
      await admin.page.goto(`/admin?tab=vendors&record=qa-og24-missing-${tag}`);
      await expect(admin.page.getByRole("heading", { level: 1, name: "This record doesn't exist or was removed" })).toBeVisible();

      // --- All listings ----------------------------------------------------------------
      await admin.page.goto(`/admin?tab=listings&q=${encodeURIComponent(tag)}`);
      const status = admin.page.getByRole("group", { name: "Listing status" });
      await expect(status.getByRole("button", { name: /^All\s*22$/ })).toBeVisible();
      await expect(status.getByRole("button", { name: /^Pending\s*2$/ })).toBeVisible();
      await expect(status.getByRole("button", { name: /^Live\s*20$/ })).toBeVisible();
      await expect(admin.page.getByText("Showing 1–20 of 22 listings")).toBeVisible();
      const listRows = admin.page.getByRole("table", { name: "All listings" }).locator("tbody tr");
      await expect(listRows.first(), "pending first").toContainText(`${tag} Hall 01`);
      await admin.page.getByLabel("Sort", { exact: true }).selectOption("nameDesc");
      await expect(listRows.first()).toContainText(`${tag} Hall 22`);
      await admin.page.getByLabel("County", { exact: true }).selectOption("Kerry");
      await expect(admin.page.getByText("Showing 1–2 of 2 listings")).toBeVisible();
      await admin.page.getByLabel("County", { exact: true }).selectOption("all");
      await admin.page.getByRole("button", { name: "Next page" }).click();
      await expect(admin.page.getByText("Showing 21–22 of 22 listings")).toBeVisible();
      await expect(listRows.first()).toContainText(`${tag} Hall 02`);
      // Open a record from page 2; Back returns to page 2 with the sort kept.
      await admin.page.getByRole("button", { name: `Review ${tag} Hall 02` }).click();
      await expect(admin.page.getByRole("heading", { level: 1, name: `${tag} Hall 02` })).toBeVisible();
      await admin.page.goBack();
      await expect(admin.page.getByText("Showing 21–22 of 22 listings")).toBeVisible();
      expect(new URL(admin.page.url()).searchParams.get("sort")).toBe("nameDesc");
      // A live listing's record by URL, and a missing one.
      await admin.page.goto(`/admin?tab=listings&record=centre:qa-og24-c-${tag}-10`);
      await expect(admin.page.getByRole("heading", { level: 1, name: `${tag} Hall 10` })).toBeVisible();
      await admin.page.goto(`/admin?tab=listings&record=centre:qa-og24-missing-${tag}`);
      await expect(admin.page.getByRole("heading", { level: 1, name: "This record doesn't exist or was removed" })).toBeVisible();

      expect(pagedCalls.some((c) => c.startsWith("/api/admin/vendors?")), "Vendors used server pages").toBe(true);
      expect(pagedCalls.some((c) => c.startsWith("/api/admin/listings?")), "All listings used server pages").toBe(true);
      await evidence("og-24-paging", { vendorCounts: [25, 3, 18, 4], vendorPages: 2, listingCounts: [22, 2, 20], listingPages: 2, pagedRequests: pagedCalls.length });
      expect(admin.consoleErrors, "no page errors").toEqual([]);
    } finally {
      await admin.close();
    }
  });
});
