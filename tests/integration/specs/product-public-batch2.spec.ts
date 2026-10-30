import { randomUUID } from "node:crypto";
import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { createActivity, test, withActors } from "../lifecycle-fixture";
import { noHorizontalScroll, uiActor } from "../lifecycle-ui-fixture";
import { shot } from "../revenue-fixture";

// Public-site Batch 2 (approved 2026-10-22): Explore and the lists, the
// no-photo card, and the Booking details page (/bookings/:kind/:ref). Real
// backend and personas in the isolated QA database; synthetic activities are
// created through the real API and removed by exact ID.

test("B2-LISTS: one results grid, the no-photo card, and the first result on the first phone screen", async ({ browser, playwright }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const word = `qawalk${randomUUID().slice(0, 6)}`;
    // Search only covers the next 60 days (server/src/routes/search.ts), so date it soon.
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const activity = await createActivity(f, "QA_HOST", { activityLabel: `QA ${word} meetup`, date: soon });

    for (const viewport of ["mobile", "desktop"] as const) {
      const ui = await uiActor(browser, null, viewport);
      try {
        const { page } = ui;
        await page.goto(`/explore?q=${word}`);
        const card = page.locator("main .listing-card").filter({ hasText: activity.activityLabel }).first();
        await expect(card).toBeVisible();
        // No photo: the card shows its own kind/title/date block, not an icon placeholder.
        await expect(card.locator(".no-photo-text")).toContainText(activity.activityLabel);
        // One grid — the old per-type section headings are gone.
        await expect(page.getByText("THINGS TO DO", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^Filters/ })).toBeVisible();
        // Explore redesign: sorting is a "Sort" control in the "Filter and sort" toolbar.
        await expect(page.getByRole("toolbar", { name: "Filter and sort" }).getByRole("button", { name: "Sort" })).toBeVisible();
        if (viewport === "mobile") {
          const top = await card.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
          expect(top, "first Explore result within the first phone screen").toBeLessThan(600);
          await shot(page, "b2-explore-mobile");
        } else await shot(page, "b2-explore-desktop");
        expect(await noHorizontalScroll(page)).toBe(true);

        for (const path of ["/games", "/programs", "/experiences", "/adventures"]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await page.waitForLoadState("networkidle");
          expect(await noHorizontalScroll(page), `${path} no sideways scroll`).toBe(true);
          await expect(page.locator("main").getByRole("button", { name: "Search", exact: true }), `${path}: results filter as you type`).toHaveCount(0);
          if (viewport === "mobile" && path === "/games") {
            const first = page.locator("main .listing-card").first();
            await expect(first).toBeVisible();
            const top = await first.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
            expect(top, "first Activities result within the first phone screen").toBeLessThan(600);
            // Card redesign (owner, 2026-10-22) replaced Batch 2's phone row
            // layout: one full-width card per row with a full-width photo.
            await expect(first).not.toHaveClass(/listing-card--row/);
            const widths = await first.evaluate((el) => ({ card: el.getBoundingClientRect().width, main: (el.closest(".listing-grid") as HTMLElement).getBoundingClientRect().width }));
            expect(Math.abs(widths.card - widths.main), "phone card is full width").toBeLessThan(2);
            await shot(page, "b2-activities-mobile");
          }
        }
      } finally { await ui.close(); }
    }
  });
  await evidence("b2-lists", { singleGrid: true, noPhotoCard: true, firstResultUnder600: true });
});

test("B2-MOTION: pages and covers load without entrance animations (skeletons only)", async ({ browser, playwright }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const activity = await createActivity(f, "QA_HOST");
    for (const viewport of ["mobile", "desktop"] as const) {
      const ui = await uiActor(browser, null, viewport);
      try {
        const { page } = ui;
        for (const path of ["/games", "/programs", `/games/${activity.id}`, "/this-is-not-a-page"]) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          const running = await page.evaluate(() => Array.from(document.querySelectorAll("main, main *"))
            .filter((el) => getComputedStyle(el).animationName !== "none" && !el.classList.contains("skeleton") && !el.classList.contains("spinner") && !el.classList.contains("page-spinner"))
            .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 30)}`));
          expect(running, `${path}: no entrance animations`).toEqual([]);
        }
        // The shared cover: same 16:9 frame on the activity page.
        await page.goto(`/games/${activity.id}`);
        const cover = page.locator("main .cover-frame").first();
        await expect(cover).toBeVisible();
        const ratio = await cover.evaluate((el) => { const r = el.getBoundingClientRect(); return r.width / r.height; });
        expect(ratio, "16:9 cover (or capped height)").toBeGreaterThan(1.7);
      } finally { await ui.close(); }
    }
  });
});

test("B2-BOOKING: a joined activity has its own booking page; leaving updates it in place; other people's or unknown refs read as not found", async ({ browser, playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const activity = await createActivity(f, "QA_HOST");
    expect((await f.actors.QA_USER.post(`/api/games/${activity.id}/join`, { data: {} })).status(), "join").toBeLessThan(300);

    for (const viewport of ["mobile", "desktop"] as const) {
      const ui = await uiActor(browser, "QA_USER", viewport);
      try {
        const { page } = ui;
        await page.goto(`/bookings/game/${activity.id}`);
        await expect(page.getByRole("heading", { level: 1, name: "You're booked" })).toBeVisible();
        await expect(page.getByText(activity.activityLabel).first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Add to calendar" })).toBeVisible();
        await expect(page.getByRole("button", { name: "View the activity" })).toBeVisible();
        await expect(page).toHaveTitle(new RegExp(`${activity.activityLabel} — booking`));
        expect(await noHorizontalScroll(page)).toBe(true);
        await shot(page, `b2-booking-${viewport}`);
        if (viewport === "desktop") {
          await page.getByRole("button", { name: "Leave activity" }).click();
          const dialog = page.getByRole("alertdialog");
          await expect(dialog).toContainText(activity.activityLabel);
          await dialog.getByRole("button", { name: "Leave activity" }).click();
          await expect(page.getByRole("heading", { level: 1, name: "Cancelled" })).toBeVisible();
          await expect(page.getByText("You've left this activity.")).toBeVisible();
          await expect(page.getByRole("button", { name: "Leave activity" })).toHaveCount(0);
          const left = await (await f.actors.QA_USER.get("/api/games/mine")).json() as { id: string }[];
          expect(left.some((g) => g.id === activity.id), "server agrees the resident left").toBe(false);
          await shot(page, "b2-booking-left");
        }
      } finally { await ui.close(); }
    }

    // Someone else's activity, an unknown ref and an unknown kind all read the same.
    const visitor = await uiActor(browser, null, "mobile");
    try {
      const { page } = visitor;
      for (const path of [`/bookings/game/${activity.id}`, "/bookings/booking/HB-QA-NONE", "/bookings/nonsense/1"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1, name: "We couldn't find that booking" }), path).toBeVisible();
        await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
        await expect(page.getByText("Your session has expired")).toHaveCount(0);
      }
    } finally { await visitor.close(); }
  });
  await evidence("b2-booking", { ownPage: true, leaveInPlace: true, notFoundForOthers: true });
});
