import { test, expect } from "../fixtures/browser";

for (const scenario of [
  { status: 401, error: "Email or password is incorrect", id: "QA-AUTH-002a" },
  { status: 500, error: "Sign-in is temporarily unavailable", id: "QA-AUTH-002b" },
]) {
  test.describe(scenario.id, () => {
    test.use({ expectedResponses: [{ method: "POST", path: "/api/guest/login", status: scenario.status, reason: "Deliberately injected sign-in error; UI handling only" }] });
    test(`sign-in displays ${scenario.status} and retains email @mock`, async ({ page, context }) => {
      await context.route("**/api/guest/login", (route) => route.fulfill({ status: scenario.status, json: { error: scenario.error } }));
      await page.goto("/signin");
      await page.getByRole("button", { name: "Necessary only", exact: true }).click();
      await page.getByLabel("Email address", { exact: true }).fill("qa-invalid@example.test");
      await page.getByLabel("Password", { exact: true }).fill("Synthetic-invalid-input-123");
      await page.getByRole("button", { name: /Log in →/ }).click();
      await expect(page.getByRole("alert")).toHaveText(scenario.error);
      await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("qa-invalid@example.test");
      await expect(page.getByRole("button", { name: /Log in →/ })).toBeEnabled();
      await expect(page).toHaveURL(/\/signin$/);
    });
  });
}
