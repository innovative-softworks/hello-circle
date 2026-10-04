import { randomUUID } from "node:crypto";
import { expect, env, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, rows } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 12 — guest-facing regressions: HC-QA-060 (sitemap/robots for gated
// venue pages), Apple placeholder hidden, no pre-consent Google Fonts
// request, HC-QA-073 Load more (incl. a failing next page keeps page 1).

const backend = () => new URL(env.E2E_API_URL).origin;

test("HC-QA-060: sitemap lists no gated venue URLs (centres/clubs/browse) but keeps public activities; venue pages are noindex", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const [centre] = await rows(f, "SELECT COALESCE(slug, id) AS slug FROM centres WHERE status = 'approved' LIMIT 1");
    const ctx = await playwright.request.newContext();
    try {
      const xml = await (await ctx.get(`${backend()}/sitemap.xml`)).text();
      const venueUrls = (xml.match(/\/(centres|clubs)\/[^<]+|\/browse\/(centres|clubs)/g) ?? []).length;
      const html = centre ? await (await ctx.get(`${backend()}/centres/${centre.slug}`)).text() : "";
      const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? "n/a";
      const browseRobots = (await (await ctx.get(`${backend()}/browse/centres`)).text()).match(/<meta name="robots" content="([^"]+)"/)?.[1] ?? "n/a";
      await evidence("hc-qa-060", { venueUrlsInSitemap: venueUrls, publicGameListed: xml.includes(`/games/${game.id}`), centreRobots: robots, browseRobots });
      expect(venueUrls, "no gated venue URL in the sitemap").toBe(0);
      expect(xml, "public activity pages stay in the sitemap").toContain(`/games/${game.id}`);
      if (centre) expect(robots).toBe("noindex, nofollow");
      expect(browseRobots).toBe("noindex, nofollow");
    } finally { await ctx.dispose(); }
  });
});

test("PART-12-APPLE: no 'Sign in with Apple' control on login, signup or vendor signup (desktop + mobile)", async ({ browser }) => {
  const seen: string[] = [];
  for (const viewport of ["desktop", "mobile"] as const) {
    const ui = await uiActor(browser, null, viewport);
    try {
      for (const path of ["/login", "/signin", "/signin/create", "/vendor/signup"]) {
        await ui.page.goto(path);
        await ui.page.waitForLoadState("networkidle").catch(() => {});
        const apple = await ui.page.getByRole("button", { name: /apple/i }).count();
        seen.push(`${viewport}${path}:${apple}`);
        expect(apple, `${viewport} ${path}`).toBe(0);
      }
    } finally { await ui.close(); }
  }
  await evidence("part-12-apple", { checks: seen.join(" ") });
});

test("PART-13-FONTS: no Google Fonts request before consent; application fonts are self-hosted", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: env.E2E_BASE_URL });
  const thirdParty = new Set<string>();
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === env.E2E_BASE_URL) return route.continue();
    thirdParty.add(u.hostname);
    return route.abort("blockedbyclient");
  });
  try {
    const page = await context.newPage();
    for (const path of ["/home", "/login", "/explore"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    const fontFace = await page.evaluate(async () => { await document.fonts.ready; const faces: FontFace[] = []; (document.fonts as unknown as { forEach: (cb: (f: FontFace) => void) => void }).forEach((f) => faces.push(f)); return faces.some((f) => /Bricolage Grotesque Variable/.test(f.family) && f.status === "loaded"); });
    await evidence("part-13-fonts", { thirdPartyHosts: [...thirdParty].sort().join(",") || "none", selfHostedFontLoaded: fontFace });
    expect([...thirdParty].filter((h) => /fonts\.(googleapis|gstatic)\.com/.test(h)), "no Google Fonts").toEqual([]);
    expect(fontFace, "self-hosted display font loaded").toBe(true);
  } finally { await context.close(); }
});

test("HC-QA-073-UI: Games 'Load more' appends the next server page; a failed next page keeps loaded results and offers retry; end of list reached", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const tag = `QA paginate ${randomUUID().slice(0, 6)}`;
    const hostId = personas.QA_HOST.id;
    const ids: string[] = [];
    const values: unknown[] = [];
    for (let i = 0; i < 75; i++) {
      const id = randomUUID(); ids.push(id);
      const day = new Date(Date.now() + (3 + (i % 20)) * 86_400_000).toISOString().slice(0, 10);
      values.push(id, hostId, `${tag} Rounders`, "QA field", day, "19:00", 10, 0, "public", "open", "active");
    }
    await f.connection.query(`INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, price_cents, visibility, status, lifecycle) VALUES ${ids.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, values);
    for (const id of ids) f.track("games", "id", id);
    const ui = await uiActor(browser, null, "desktop");
    try {
      const { page } = ui;
      await page.goto(`/games?activity=${encodeURIComponent(tag)}`);
      // One card link (labelled with the activity name) per card — chips/summary text don't count.
      const cards = page.getByRole("link", { name: `${tag} Rounders`, exact: true });
      await expect(cards.first()).toBeVisible({ timeout: 20_000 });
      // Reveal the loaded first page, then fetch the next one from the server.
      for (let i = 0; i < 6 && (await page.getByRole("button", { name: /^Show more/ }).count()); i++) await page.getByRole("button", { name: /^Show more/ }).click();
      const loaded = await cards.count();
      expect(loaded, "first server page").toBe(50);
      // Next page fails once → page 1 stays, error + retry shown.
      let failOnce = true;
      await page.route((u) => u.pathname === "/api/games" && u.searchParams.has("cursor"), (route) => (failOnce ? (failOnce = false, route.fulfill({ status: 500, body: "{}" })) : route.continue()));
      await page.getByRole("button", { name: "Load more" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /Couldn't load more/ })).toBeVisible();
      expect(await cards.count(), "loaded results kept after a failed next page").toBe(50);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect.poll(async () => cards.count()).toBeGreaterThan(50);
      for (let i = 0; i < 6 && (await page.getByRole("button", { name: /^Show more/ }).count()); i++) await page.getByRole("button", { name: /^Show more/ }).click();
      await expect.poll(async () => cards.count(), { message: "all 75 reached, no duplicates" }).toBe(75);
      await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
      await evidence("hc-qa-073-ui", { firstPage: loaded, afterRetry: await cards.count(), endReached: true });
    } finally { await ui.close(); }
  });
});
