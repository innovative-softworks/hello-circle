import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 10A — HC-QA-063 (an API failure presented as "0 results") and
// HC-QA-064 (My Life shows "Sign in" to a signed-in user when one request
// fails). Failure is injected ONLY for the single endpoint under test, inside
// a test-owned browser context; every other request hits the real backend.

const listEndpoint = (pattern: RegExp) => (url: URL) => pattern.test(url.pathname) ;

async function failOnce(page: Page, match: (u: URL) => boolean, mode: "500" | "abort") {
  let armed = true;
  await page.route((u) => armed && match(u), async (route) => {
    if (mode === "abort") await route.abort("timedout");
    else await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal Server Error: ER_LOCK_DEADLOCK at /srv/app/node_modules/mysql2" }) });
  });
  return () => { armed = false; };
}

for (const [path, endpoint, viewport] of [
  ["/games", /^\/api\/games$/, "mobile"],
  ["/games", /^\/api\/games$/, "desktop"],
  ["/circles", /^\/api\/circles$/, "desktop"],
  ["/programs", /^\/api\/programs$/, "desktop"],
] as const) {
  test(`HC-QA-063: ${path} shows an error with retry, not "0 results", when its list API fails (${viewport})`, async ({ browser }) => {
    const ui = await uiActor(browser, null, viewport);
    try {
      const { page } = ui;
      const disarm = await failOnce(page, listEndpoint(endpoint), "500");
      await page.goto(path);
      const alert = page.getByRole("alert").filter({ hasText: /couldn't load/i });
      await expect(alert, "explicit load error").toBeVisible();
      await expect(page.getByText(/\b0 (games|circles|programs)\b|No open sessions yet|Nothing matching that yet|No circles/i)).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/ER_LOCK|node_modules|\/srv\/app/);
      disarm();
      await alert.getByRole("button", { name: /try again/i }).click();
      await expect(alert).toBeHidden();
      await evidence(`hc-qa-063-${path.slice(1)}-${viewport}`, { errorShown: true, falseEmpty: false, retryRecovers: true });
    } finally { await ui.close(); }
  });
}

test("HC-QA-063-TIMEOUT: a network timeout on /games is an error state, distinct from empty", async ({ browser }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    await failOnce(page, listEndpoint(/^\/api\/games$/), "abort");
    await page.goto("/games");
    await expect(page.getByRole("alert").filter({ hasText: /couldn't load/i })).toBeVisible();
    await expect(page.getByText(/0 games/i)).toHaveCount(0);
  } finally { await ui.close(); }
});

test("HC-QA-064: a failed profile request does not show 'Sign in' to a signed-in resident", async ({ browser }) => {
  const ui = await uiActor(browser, "QA_USER", "mobile");
  try {
    const { page } = ui;
    const disarm = await failOnce(page, listEndpoint(/^\/api\/residents\/me$/), "500");
    await page.goto("/my-life");
    const alert = page.getByRole("alert").filter({ hasText: /couldn't load/i });
    await expect(alert).toBeVisible();
    await expect(page.getByText("Sign in to see your life")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    // The session itself is intact: retry recovers the signed-in view.
    disarm();
    await alert.getByRole("button", { name: /try again/i }).click();
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    expect((await page.request.get("/api/residents/me")).status()).toBe(200);
    await evidence("hc-qa-064", { signInShown: false, sessionKept: true, retryRecovers: true });
  } finally { await ui.close(); }
});

test("HC-QA-064-STATES: session-check failure is an error; a real signed-out visitor still sees Sign in", async ({ browser }) => {
  const signedIn = await uiActor(browser, "QA_USER", "desktop");
  try {
    const { page } = signedIn;
    await failOnce(page, listEndpoint(/^\/api\/guest\/me$/), "abort");
    await page.goto("/my-life");
    await expect(page.getByRole("alert").filter({ hasText: /couldn't load/i })).toBeVisible();
    await expect(page.getByText("Sign in to see your life")).toHaveCount(0);
  } finally { await signedIn.close(); }
  const visitor = await uiActor(browser, null, "desktop");
  try {
    await visitor.page.goto("/my-life");
    await expect(visitor.page.getByText("Sign in to see your life")).toBeVisible();
    await expect(visitor.page.getByRole("alert").filter({ hasText: /couldn't load/i })).toHaveCount(0);
  } finally { await visitor.close(); }
});
