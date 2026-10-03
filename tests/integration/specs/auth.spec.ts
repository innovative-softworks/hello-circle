import { test, expect, env, personas } from "../fixtures";
import { randomBytes } from "node:crypto";
import { connectedPreflight } from "../runtime";

test("REAL-AUTH-001: resident UI login, refresh, permission boundaries and logout", async ({ page }) => {
  await page.goto("/signin?returnTo=%2Fprofile");
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  await page.getByLabel("Email address", { exact: true }).fill(env.QA_USER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(env.QA_USER_PASSWORD);
  await page.getByRole("button", { name: "Log in →", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  const resident = async () => (await (await page.request.get("/api/residents/me")).json()).resident;
  expect((await resident()).id).toBe(personas.QA_USER.id);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to edit your profile." })).toHaveCount(0);
  expect((await resident()).id).toBe(personas.QA_USER.id);
  expect((await page.request.get("/api/admin/stats")).status()).toBe(401);
  expect((await page.request.get("/api/vendor/listings")).status()).toBe(401);
  for (const url of ["/admin", "/vendor"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("alertdialog").filter({ has: page.getByRole("heading", { name: "Sign out?", exact: true }) }).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(resident).toBeNull();
  expect((await page.request.get("/api/residents/me/receipts")).status()).toBe(401);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Sign in to edit your profile." })).toBeVisible();
});

for (const persona of ["QA_HOST", "QA_VENDOR", "QA_ADMIN"] as const) {
  test(`REAL-AUTH-ROLE: ${persona} real UI login and permitted context`, async ({ page }) => {
    const resident = persona === "QA_HOST";
    const destination = resident ? "/manage" : persona === "QA_VENDOR" ? "/vendor" : "/admin";
    await page.goto(resident ? "/signin?returnTo=%2Fmanage" : "/login");
    await page.getByRole("button", { name: "Necessary only", exact: true }).click();
    await page.getByLabel(resident ? "Email address" : "Email", { exact: true }).fill(env[`${persona}_EMAIL`]);
    await page.getByLabel("Password", { exact: true }).fill(env[`${persona}_PASSWORD`]);
    await page.getByRole("button", { name: resident ? "Log in →" : "Sign in →", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    const identity = await (await page.request.get(resident ? "/api/residents/me" : "/api/auth/me")).json();
    expect((resident ? identity.resident : identity.user).id).toBe(personas[persona].id);
    if (!resident) expect(identity.user.role).toBe(personas[persona].role);
    if (persona === "QA_VENDOR") expect((await page.request.get("/api/vendor/listings")).status()).toBe(200);
    if (persona === "QA_ADMIN") expect((await page.request.get("/api/admin/stats")).status()).toBe(200);
    else {
      expect((await page.request.get("/api/admin/stats")).status()).toBe(401);
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/login(?:\?|$)/);
    }
    expect((await page.request.post(resident ? "/api/guest/logout" : "/api/auth/logout")).ok()).toBe(true);
  });
}

test("REAL-AUTH-NEG: wrong password, unknown account and empty credentials", async ({ request }) => {
  const wrong = await request.post("/api/guest/login", { data: { email: env.QA_USER_EMAIL, password: "Intentionally-wrong-qa-input" } });
  const unknown = await request.post("/api/guest/login", { data: { email: "nobody@example.test", password: "Intentionally-wrong-qa-input" } });
  expect(wrong.status()).toBe(401);
  expect(unknown.status()).toBe(401);
  expect(await wrong.json()).toEqual(await unknown.json());
  expect((await request.post("/api/guest/login", { data: {} })).status()).toBe(400);
  expect((await request.post("/api/auth/login", { data: { email: "qa_suspended@example.test", password: env.QA_VENDOR_B_PASSWORD } })).status()).toBe(403);
  expect((await request.get("/api/vendor/listings")).status()).toBe(401);
});

test("REAL-AUTH-EXPIRY: server rejects an expired real session", async ({ context, page }) => {
  const token = randomBytes(32).toString("hex");
  const checked = await connectedPreflight();
  try {
    await checked.connection.execute("INSERT INTO guest_sessions (token, email, expires_at) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 1 HOUR))", [token, env.QA_USER_EMAIL]);
    await context.addCookies([{ name: "hello_circle_guest_session", value: token, url: env.E2E_BASE_URL }]);
    expect((await page.request.get("/api/residents/me/receipts")).status()).toBe(401);
    await page.goto("/manage");
    await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  } finally {
    await checked.connection.execute("DELETE FROM guest_sessions WHERE token = ? AND email = ?", [token, env.QA_USER_EMAIL]);
    await checked.connection.end();
  }
});

test("REAL-AUTH-GUEST: guest and invalid session cannot access protected resources", async ({ page, context }) => {
  for (const url of ["/api/residents/me/receipts", "/api/vendor/listings", "/api/admin/stats"]) expect((await page.request.get(url)).status()).toBe(401);
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
  await context.addCookies([{ name: "hello_circle_guest_session", value: "invalid-qa-session", url: env.E2E_BASE_URL }]);
  expect((await page.request.get("/api/residents/me/receipts")).status()).toBe(401);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Sign in to edit your profile." })).toBeVisible();
});

test("REAL-AUTH-FORM: empty submit disabled and malformed email rejected in browser", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Necessary only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in →", exact: true })).toBeDisabled();
  await page.getByLabel("Email address", { exact: true }).fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("Intentionally-wrong-qa-input");
  await page.getByRole("button", { name: "Log in →", exact: true }).click();
  expect(await page.getByLabel("Email address", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.typeMismatch)).toBe(true);
  await expect(page).toHaveURL(/\/signin$/);
});
