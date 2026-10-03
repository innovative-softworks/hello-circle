import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { test, expect, personas, env } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("RBAC-STAFF: read-only staff cannot mutate own organisation listing or elevate privileges", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR"], async ({ actors, connection, track, snapshot }) => {
    const [owner] = await connection.query<any[]>("SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    expect(!!owner[0].org_id).toBe(true);
    const id = randomUUID();
    const password = randomBytes(32).toString("hex");
    const email = `qa_staff_${id}@example.test`;
    await connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', 'QA read only', ?, 'read_only_analyst', 1)", [id, email, bcrypt.hashSync(password, 10), owner[0].org_id]);
    track("users", "id", id);
    track("sessions", "user_id", id);
    const created = await actors.QA_VENDOR.post("/api/vendor/centres", { data: { name: `QA staff ${randomUUID()}`, paymentMethod: "cash" } });
    expect(created.status()).toBe(201);
    const centre = (await created.json()).id;
    track("centres", "id", centre);
    track("rooms", "centre_id", centre);
    track("audit_log", "object_id", centre);
    const staff = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
    try {
      expect((await staff.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
      const unchanged = await snapshot("SELECT * FROM centres WHERE id = ?", [centre]);
      const identity = await snapshot("SELECT * FROM users WHERE id = ?", [id]);
      expect((await staff.get(`/api/vendor/centres/${centre}`)).status()).toBe(200);
      expect((await staff.put(`/api/vendor/centres/${centre}`, { data: { name: "Forbidden", vendorId: id, status: "approved" } })).status()).toBe(403);
      await unchanged();
      expect((await staff.delete(`/api/vendor/centres/${centre}`)).status()).toBe(403);
      await unchanged();
      expect((await staff.put("/api/vendor/org", { data: { role: "admin", invitedStaff: false, platformRole: "centre_manager", orgId: owner[0].org_id } })).status()).toBe(403);
      await identity();
      expect((await staff.get("/api/admin/stats")).status()).toBe(401);
    } finally { await staff.dispose(); }
  });
});

test("RBAC-BROWSER: resident route redirect and real API both deny admin access", async ({ page }) => {
  await page.goto("/signin?returnTo=%2Fprofile");
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(env.QA_USER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(env.QA_USER_PASSWORD);
  await page.getByRole("button", { name: "Log in →", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  try {
    expect((await page.request.get("/api/admin/vendors")).status()).toBe(401);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  } finally { await page.request.post("/api/guest/logout"); }
});
