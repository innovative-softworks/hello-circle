import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Browser, Page } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";
import { businessUiActor } from "../product-fixture";
import { connectedPreflight } from "../runtime";

// Trust & Retention (docs/trust-retention/05-*) — admin browser checks in the
// isolated QA environment: verification checks, attendance corrections,
// review moderation, safety reports and reconsideration. Disposable data only;
// the admin persona and two role-restricted admins created here exist only in
// this QA database (QA turns admin two-step sign-in off for its own personas).
// Logins: QA_VENDOR + QA_VENDOR_B (API), QA_ADMIN (UI), support + finance admins = 5.

async function shot(page: Page, name: string) {
  const checked = await connectedPreflight();
  await checked.connection.end();
  const dir = path.join(checked.manifest.dataDir, "evidence", "trust");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

const WIDTHS = [1280, 820, 375] as const;
async function noOverflowAt(page: Page, url: string, name: string, ready: (p: Page) => Promise<void>) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.goto(url);
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} at ${w}px has no horizontal overflow`).toBeLessThanOrEqual(0);
    await shot(page, `${name}-${w}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function roleAdmin(browser: Browser, role: "finance" | "support", track: (t: string, c: string, id: string) => void, connection: any) {
  const id = randomUUID();
  const password = randomBytes(24).toString("hex");
  const email = `qa_trust_${role}_${id}@example.test`;
  await connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', ?, ?)", [id, email, bcrypt.hashSync(password, 10), `QA trust ${role}`, role]);
  for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "actor_user_id"]]) track(t, c, id);
  const context = await browser.newContext({ baseURL: env.E2E_BASE_URL, serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async (route) => (new URL(route.request().url()).origin === env.E2E_BASE_URL ? route.continue() : route.abort("blockedbyclient")));
  await context.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", "rejected"); } catch { /* storage unavailable */ } });
  expect((await context.request.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  return { context, page: await context.newPage() };
}

test("Trust admin: verification, attendance corrections, review moderation, safety reports and reconsideration", async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const vendorA = personas.QA_VENDOR.id;
    const vendorB = personas.QA_VENDOR_B.id;
    const tag = randomUUID().slice(0, 8);

    // --- fixtures ---------------------------------------------------------------
    const created = await f.actors.QA_VENDOR.post("/api/vendor/centres", { data: { name: `QA Trust Hall ${tag}`, paymentMethod: "cash" } });
    expect(created.status()).toBe(201);
    const { id: centreId, name: centreName } = (await created.json()) as { id: string; name: string };
    for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["notifications", "listing_id"]]) f.track(t, c, centreId);
    for (const v of [vendorA, vendorB]) {
      f.track("verification_checks", "subject_id", v);
      f.track("notifications", "recipient_id", v);
    }
    const askA = await f.actors.QA_VENDOR.post("/api/vendor/verification", { data: { checkType: "business_details", details: `QA Trust Ltd ${tag}, CRO 600000, 1 Main Street, Dublin` } });
    const askB = await f.actors.QA_VENDOR_B.post("/api/vendor/verification", { data: { checkType: "business_details", details: `QA Other Ltd ${tag}, CRO 600001, 2 Main Street, Cork` } });
    expect([askA.status(), askB.status()]).toEqual([201, 201]);
    const checkA = ((await askA.json()) as { id: number }).id;
    const checkB = ((await askB.json()) as { id: number }).id;
    for (const id of [checkA, checkB]) {
      f.track("moderation_decisions", "object_id", String(id));
      f.track("audit_log", "object_id", String(id));
    }

    const longComment = `${"Long feedback that has to wrap cleanly without breaking the layout. ".repeat(12)}End ${tag}.`;
    const [rv] = await f.connection.execute<any>("INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES ('centre', ?, ?, 'QA Reviewer', 1, ?)", [centreId, `qa-trust-${tag}`, longComment]);
    const reviewId = String(rv.insertId);
    f.track("reviews", "id", reviewId);
    f.track("audit_log", "object_id", reviewId);
    const [safety] = await f.connection.execute<any>("INSERT INTO reports (target_type, target_id, reporter_client_id, reason, category) VALUES ('review', ?, ?, 'Unsafe: threatening language', 'safety')", [reviewId, `qa-trust-${tag}`]);
    const [system] = await f.connection.execute<any>("INSERT INTO reports (target_type, target_id, reporter_client_id, reason, category) VALUES ('review', ?, 'system:attendance', 'Attendance changed after this review was published: the organiser recorded a no-show.', 'content')", [reviewId]);
    const [decided] = await f.connection.execute<any>("INSERT INTO reports (target_type, target_id, reporter_client_id, reason, status, decided_at, statement_of_reasons) VALUES ('review', ?, ?, 'Spam', 'dismissed', NOW(), 'Not spam: a genuine, critical review.')", [reviewId, `qa-trust-${tag}`]);
    for (const r of [safety, system, decided]) f.track("reports", "id", String(r.insertId));
    const [corr] = await f.connection.execute<any>(
      "INSERT INTO attendance_corrections (kind, ref, client_id, note, status, owner_vendor_id, decision_note, decided_by, decided_by_kind, decided_at) VALUES ('booking', ?, ?, 'I was there, signed the book', 'declined', ?, 'Not on our register', ?, 'user', NOW())",
      [`QA-T-${tag}`, `qa-trust-${tag}`, vendorA, vendorA]
    );
    f.track("attendance_corrections", "id", String(corr.insertId));
    f.track("attendance", "ref", `QA-T-${tag}`);
    f.track("audit_log", "object_id", String(corr.insertId));

    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    const support = await roleAdmin(browser, "support", f.track, f.connection);
    const finance = await roleAdmin(browser, "finance", f.track, f.connection);
    try {
      const page = admin.page;
      page.setDefaultTimeout(15_000);

      // --- verification checks: empty, failed, list, record, dialogs ---------------
      await page.goto("/admin?tab=verification&view=approved");
      await expect(page.getByText("No checks here")).toBeVisible();
      await page.route("**/api/admin/verification?status=open", (route) => route.fulfill({ status: 500, body: JSON.stringify({ error: "boom" }), contentType: "application/json" }));
      await page.goto("/admin?tab=verification");
      await expect(page.getByRole("button", { name: /Try again|Retry/ })).toBeVisible();
      await shot(page, "verification-failed");
      await page.unroute("**/api/admin/verification?status=open");
      await noOverflowAt(page, "/admin?tab=verification", "verification-list", async (p) => {
        await expect(p.getByRole("button", { name: /Open the business details check for/ }).first()).toBeVisible();
      });

      await page.goto(`/admin?tab=verification&record=check:${checkA}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(`QA Trust Ltd ${tag}`)).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).click();
      const approve = page.getByRole("alertdialog");
      await expect(approve).toBeVisible();
      await expect.poll(() => page.evaluate(() => !!document.querySelector('[role="alertdialog"]')?.contains(document.activeElement))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(approve).toBeHidden();
      await page.getByRole("button", { name: "Approve" }).click();
      const confirmApprove = approve.getByRole("button", { name: "Approve check" });
      await expect(confirmApprove).toBeDisabled();
      await approve.getByLabel(/What you checked/).fill(`EVIDENCE-${tag}: CRO record 600000 matches name and address`);
      await expect(confirmApprove).toBeEnabled();
      await shot(page, "verification-approve-dialog");
      await confirmApprove.click();
      await expect(approve).toBeHidden();
      await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`EVIDENCE-${tag}`)).toBeVisible();
      await expect(page.getByRole("button", { name: "Withdraw check" })).toBeVisible();
      await noOverflowAt(page, `/admin?tab=verification&record=check:${checkA}`, "verification-record", async (p) => {
        await expect(p.getByText(`EVIDENCE-${tag}`)).toBeVisible();
      });

      // Decline needs a category and an explanation the partner sees.
      await page.goto(`/admin?tab=verification&record=check:${checkB}`);
      await page.getByRole("button", { name: "Decline" }).click();
      const decline = page.getByRole("alertdialog");
      const confirmDecline = decline.getByRole("button", { name: "Decline check" });
      await expect(confirmDecline).toBeDisabled();
      await decline.getByLabel(/Reason category/).selectOption("details_mismatch");
      await decline.getByLabel(/^Explanation/).fill("The registered address on the CRO record is different.");
      await expect(confirmDecline).toBeEnabled();
      await confirmDecline.click();
      await expect(page.getByText("Declined", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("The registered address on the CRO record is different.").first()).toBeVisible();
      const [audit] = await f.connection.query<any[]>("SELECT action FROM audit_log WHERE object_type = 'verification_check' AND object_id IN (?, ?) ORDER BY id", [String(checkA), String(checkB)]);
      expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(["verification.requested", "verification.approved", "verification.rejected"]));

      // --- attendance corrections: support settles a declined dispute ---------------
      await noOverflowAt(page, "/admin?tab=attendance", "attendance-list", async (p) => {
        await expect(p.getByText(`QA-T-${tag}`)).toBeVisible();
      });
      const row = page.locator("tr", { hasText: `QA-T-${tag}` });
      await row.getByRole("button", { name: "Mark attended" }).click();
      const settle = page.getByRole("alertdialog");
      await expect(settle.getByRole("button", { name: "Mark attended" })).toBeDisabled();
      await settle.getByRole("textbox").fill("Support checked the sign-in sheet photo the participant sent.");
      await settle.getByRole("button", { name: "Mark attended" }).click();
      await page.goto("/admin?tab=attendance&view=accepted");
      await expect(page.locator("tr", { hasText: `QA-T-${tag}` }).getByText("Corrected")).toBeVisible();

      // --- review moderation: hide and restore need reasons ---------------------------
      await page.goto("/admin?tab=reviews");
      await page.getByLabel("Search reviews").fill(tag);
      await page.getByRole("button", { name: "Hide review by QA Reviewer" }).click();
      const hide = page.getByRole("alertdialog");
      await expect(hide.getByRole("button", { name: "Hide" })).toBeDisabled();
      await hide.getByRole("textbox").fill("Contains a threat (safety report).");
      await hide.getByRole("button", { name: "Hide" }).click();
      await expect(page.getByText("Hidden: Contains a threat (safety report).")).toBeVisible();
      await shot(page, "reviews-hidden");
      await page.getByRole("button", { name: "Unhide review by QA Reviewer" }).click();
      const show = page.getByRole("alertdialog");
      await expect(show.getByRole("button", { name: "Show again" })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(show).toBeHidden();
      const [hidden] = await f.connection.query<any[]>("SELECT hidden, hidden_reason FROM reviews WHERE id = ?", [reviewId]);
      expect(hidden[0]).toMatchObject({ hidden: 1, hidden_reason: "Contains a threat (safety report)." });

      // --- safety reports listed first, with the badge; case page --------------------
      await noOverflowAt(page, "/admin?tab=reviews", "reports", async (p) => {
        await expect(p.getByText("Safety concern").first()).toBeVisible();
      });
      await expect(page.getByText(/Attendance changed after this review was published/).first()).toBeVisible();

      // --- reconsideration through the existing appeal route ----------------------------
      const caseRef = `R-${String(decided.insertId).padStart(6, "0")}`;
      const guest = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      const appeal = await guest.post("/api/complaints", { data: { kind: "appeal", subjectType: "moderation_decision", subjectRef: caseRef, email: `qa_trust_appeal_${tag}@example.test`, body: "Please reconsider: the review is genuine and I was at the event." } });
      expect(appeal.status()).toBe(201);
      const appealId = ((await appeal.json()) as { id: number }).id;
      f.track("complaints", "id", String(appealId));
      await guest.dispose();
      const [linked] = await f.connection.query<any[]>("SELECT report_id FROM complaints WHERE id = ?", [appealId]);
      expect(Number(linked[0].report_id)).toBe(Number(decided.insertId));

      // --- permission-denied: finance can't open trust queues; support can --------------
      await finance.page.goto("/admin?tab=verification");
      await expect(finance.page.getByText("Not included in your admin role")).toBeVisible();
      expect((await finance.context.request.get("/api/admin/verification")).status()).toBe(403);
      expect((await finance.context.request.get("/api/admin/attendance/corrections")).status()).toBe(403);
      await shot(finance.page, "verification-finance-denied");
      await support.page.goto(`/admin?tab=verification&record=check:${checkA}`);
      await expect(support.page.getByText(`EVIDENCE-${tag}`)).toBeVisible();
      expect((await support.context.request.put(`/api/admin/verification/${checkA}/approve`, { data: { rowVersion: 0, evidenceNote: "x".repeat(30) } })).status()).toBe(409);
    } finally {
      await support.context.close();
      await finance.context.close();
      await admin.close();
    }
  });
});
