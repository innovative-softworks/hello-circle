import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { shot } from "../revenue-fixture";
import { createActivity, createCircle, test, withActors } from "../lifecycle-fixture";
import { noHorizontalScroll, uiActor } from "../lifecycle-ui-fixture";

// Public-site batch 1 (docs/hellocircle-public-gap-matrix.md, 2026-10-21):
// PUB-04/05/06/08/09/10/14/15/21/22/23/31/33/35. Real backend and personas in
// the isolated QA database; synthetic Circles/activities are created through
// the real API and removed by exact ID. Failure is injected only for the one
// endpoint under test (same rule as product-states.spec.ts).

async function failNext(page: Page, pathname: RegExp) {
  let armed = true;
  await page.route((u) => armed && pathname.test(u.pathname), async (route) => {
    armed = false;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal Server Error" }) });
  });
}

/** Client-side navigation (no reload), so the page keeps the session it already knew. */
async function spaNavigate(page: Page, to: string) {
  await page.evaluate((href) => {
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);
}

test("PUB-05/33: a visitor who never signed in sees one sign-in state on My Life and no session-expired alert", async ({ browser }) => {
  for (const viewport of ["mobile", "desktop"] as const) {
    const ui = await uiActor(browser, null, viewport);
    try {
      const { page } = ui;
      await page.goto("/my-life");
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to see your life" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Your session has expired")).toHaveCount(0);
      await expect(page.getByText("Nothing here yet")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Explore HelloCircle" })).toBeVisible();
      await shot(page, `pub-my-life-signed-out-${viewport}`);
      await page.goto("/receipts/HB-QA-NONE");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("Your session has expired")).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally { await ui.close(); }
  }
  await evidence("pub-05-33-visitor", { expiryAlert: false, singleSignedOutState: true });
});

test("PUB-05: a session that really expires mid-visit still shows the expiry alert", async ({ browser }) => {
  const ui = await uiActor(browser, "QA_USER", "desktop");
  try {
    const { page, context } = ui;
    await page.goto("/my-life");
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    const session = (await context.cookies()).find((c) => c.name === "hello_circle_guest_session");
    expect(session, "resident session cookie").toBeTruthy();
    // End the session server-side, then put the dead cookie back: the page
    // still believes it's signed in, exactly like a real expiry.
    expect((await context.request.post("/api/guest/logout")).status()).toBe(200);
    await context.addCookies([session!]);
    await spaNavigate(page, "/profile?tab=favourites");
    await expect(page.getByText("Your session has expired")).toBeVisible();
  } finally { await ui.context.close(); }
});

test("PUB-06: a resident opening /chats directly sees their own chats view, not the provider view", async ({ browser }) => {
  for (const viewport of ["mobile", "desktop"] as const) {
    const ui = await uiActor(browser, "QA_USER", viewport);
    try {
      const { page } = ui;
      await page.goto("/chats");
      await expect(page.getByRole("heading", { level: 1, name: "Chats" })).toBeVisible();
      await expect(page.getByText("Group chats for everything you're taking part in.")).toBeVisible();
      await expect(page.getByText("Conversations with the people taking part in your listings.")).toHaveCount(0);
      await expect(page.getByText(/register with your club/)).toHaveCount(0);
      await shot(page, `pub-chats-${viewport}`);
    } finally { await ui.close(); }
  }
  await evidence("pub-06-chats", { personalView: true });
});

test("PUB-14: missing listings say so; a real load failure offers Try again", async ({ browser, playwright }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    const cases: [string, RegExp][] = [
      ["/games/qa-missing-activity", /This activity isn.t available/],
      ["/circles/qa-missing-circle", /This Circle doesn't exist/],
      ["/programs/qa-missing-programme", /This programme isn.t available/],
      ["/host/qa-missing-host", /Host profile not available/],
      ["/provider/qa-missing-provider", /Provider not available/],
    ];
    for (const [path, heading] of cases) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
      if (path.startsWith("/games/")) await shot(page, "pub-activity-not-found");
      await expect(page.getByRole("button", { name: "Try again" }), `${path}: no retry for a missing record`).toHaveCount(0);
    }
  } finally { await ui.close(); }

  await withActors(playwright, ["QA_HOST"], async (f) => {
    const activity = await createActivity(f, "QA_HOST");
    const viewer = await uiActor(browser, null, "mobile");
    try {
      const { page } = viewer;
      await failNext(page, new RegExp(`^/api/games/${activity.id}$`));
      await page.goto(`/games/${activity.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "We couldn't load this activity." })).toBeVisible();
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("heading", { level: 1, name: activity.activityLabel })).toBeVisible();
    } finally { await viewer.close(); }
  });
  await evidence("pub-14-not-found", { notFoundHasNoRetry: true, failureRetries: true });
});

test("PUB-04: the payment result title never says confirmed for a booking that isn't", async ({ browser }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    await page.goto("/payment/success");
    await expect(page.getByRole("heading", { name: "We couldn't find that booking" })).toBeVisible();
    await expect(page).toHaveTitle("Booking not found | HelloCircle");
    await page.goto("/payment/success?ref=HB-QA-NONE");
    await expect(page.getByRole("heading", { name: "We couldn't find that booking" })).toBeVisible();
    await expect(page).toHaveTitle("Booking not found | HelloCircle");
    await failNext(page, /^\/api\/bookings\/status\/HB-QA-ERR$/);
    await page.goto("/payment/success?ref=HB-QA-ERR");
    await expect(page.getByRole("heading", { name: "We couldn't check your payment just now" })).toBeVisible();
    await expect(page).toHaveTitle("Couldn't check your payment | HelloCircle");
    expect(await page.title()).not.toMatch(/confirmed/i);
  } finally { await ui.close(); }
  await evidence("pub-04-titles", { notFound: "Booking not found", error: "Couldn't check your payment" });
});

test("PUB-08/31: My Life lists every Circle, never shows a nearby activity as a Circle's next plan, and has no nested buttons", async ({ browser, playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_HOST", "QA_USER"], async (f) => {
    const label = `QA batch1 ${randomUUID().slice(0, 6)}`;
    const circles: { id: string; slug: string }[] = [];
    for (let i = 0; i < 4; i++) circles.push(await createCircle(f, "QA_HOST_B", { joinMode: "open", ...(i === 0 ? { activityLabel: label } : {}) }));
    for (const c of circles) expect((await f.actors.QA_USER.post(`/api/circles/${c.id}/join`, { data: {} })).status(), "join").toBeLessThan(300);
    // A public activity that only shares the first Circle's activity label —
    // the server reports it as a "nearby" plan, never the Circle's own.
    await createActivity(f, "QA_HOST", { activityLabel: label });
    const mine = await (await f.actors.QA_USER.get("/api/circles/mine")).json() as { id: string; nextPlan: { source: string } | null }[];
    expect(mine.find((c) => c.id === circles[0].id)?.nextPlan?.source, "fixture produces a nearby plan").toBe("nearby");

    for (const viewport of ["desktop", "mobile"] as const) {
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto("/my-life");
        const section = page.locator("#my-circles");
        await expect(section).toBeVisible();
        const header = page.getByText(/\d+ Circles? active/);
        const count = Number(((await header.textContent()) ?? "").match(/(\d+) Circle/)![1]);
        expect(count).toBeGreaterThanOrEqual(4);
        const rowLinks = section.locator("a.stretched-link");
        await expect(rowLinks).toHaveCount(3);
        await section.getByRole("button", { name: `Show all ${count} Circles` }).click();
        await expect(rowLinks).toHaveCount(count);
        const nearbyRow = section.locator(`a.stretched-link[href="/circles/${circles[0].slug}"]`).locator("xpath=..");
        await expect(nearbyRow).toContainText("Nothing planned yet");
        await expect(nearbyRow).not.toContainText("NEXT");
        expect(await page.locator("button button, a a, button a, a button").count(), "no nested interactive elements").toBe(0);
        // With nothing joined coming up, the main column says so instead of staying blank.
        await expect(page.getByRole("heading", { name: "Nothing booked yet" }).or(page.getByRole("heading", { name: "Coming up" })).first()).toBeVisible();
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `pub-my-life-circles-${viewport}`);
      } finally { await ui.close(); }
    }
    for (const c of circles) await f.actors.QA_USER.delete(`/api/circles/${c.id}/join`);
  });
  await evidence("pub-08-31-my-life", { allCirclesListed: true, nearbyNotShownAsNext: true, nestedButtons: 0 });
});

test("PUB-15: affected public forms have programmatic labels; PUB-35: resident and business sign-in link to each other", async ({ browser }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    await page.goto("/suggest-place");
    for (const label of ["Place name", "Type", "County", "Area / town (optional)", "What's it like? (optional)", "Contact info (optional)"]) {
      await expect(page.getByLabel(label, { exact: true }), label).toBeVisible();
    }
    const unlabelled = await page.evaluate(() => Array.from(document.querySelectorAll("main input:not([type=hidden]), main select, main textarea"))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => !((el as HTMLInputElement).labels?.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length);
    expect(unlabelled, "unlabelled fields on Suggest a place").toBe(0);

    await page.goto("/signin");
    await page.getByRole("link", { name: "Business log in →" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Personal sign in" }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/forgot-password");
    await expect(page.getByText("Enter the email on your business (venue, club, experience or admin) account.")).toBeVisible();
    await page.getByRole("link", { name: "Reset it from Sign in" }).click();
    await expect(page).toHaveURL(/\/signin\?forgot=1$/);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toHaveCount(0);
  } finally { await ui.close(); }
  await evidence("pub-15-35", { suggestPlaceUnlabelled: 0, crossLinks: true });
});

test("PUB-09/10: no discovery link leads to the venue gate while venues are closed; no pre-launch banner once public", async ({ browser }) => {
  const ui = await uiActor(browser, null, "desktop");
  try {
    const { page } = ui;
    // The QA client runs with VITE_LAUNCH_MODE=public and venue pages gated (VITE_VENUE_PAGES_PUBLIC unset).
    await page.goto("/explore");
    await expect(page.getByRole("heading", { level: 1, name: "Explore" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Compare places" })).toHaveCount(0);
    const gated = await page.locator('main a[href^="/browse/"], main a[href^="/centres/"], main a[href^="/clubs/"]').count();
    expect(gated, "Explore links into gated venue routes").toBe(0);
    await page.goto("/notacounty/badminton");
    await expect(page).toHaveURL(/\/explore$/);
    await page.goto("/for-venues");
    await expect(page.getByRole("heading", { level: 1, name: /Get discovered/ })).toBeVisible();
    await expect(page.getByText(/launches soon/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notify me" })).toHaveCount(0);
  } finally { await ui.close(); }
  await evidence("pub-09-10", { compareHidden: true, preLaunchBanner: false });
});
