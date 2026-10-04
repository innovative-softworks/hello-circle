import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 13 — MEASUREMENT ONLY (no assertions on the numbers): HC-QA-075 CLS
// and HC-QA-074 request duplication, on the production build
// (QA_PROD_BUILD=1), Chromium, with Phase 10's throttling (4x CPU, 150 ms
// latency). Each route is loaded cold in a fresh context.

type Shift = { value: number; sources: string[] };

test("PERF-P13: CLS and API request accounting per route (390 + 1440)", async ({ playwright, browser }) => {
  test.skip(browser.browserType().name() !== "chromium", "layout-shift entries + CDP throttling are Chromium-only");
  test.skip(process.env.QA_PROD_BUILD !== "1", "measures the production build only (QA_PROD_BUILD=1)");
  test.setTimeout(600_000);
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const game = await createActivity(f, "QA_HOST");
    const routes: [string, string | null][] = [["/home", null], ["/explore", null], ["/games", null], ["/circles", null], [`/games/${game.id}`, null], ["/login", null], ["/my-life", "QA_USER"], ["/profile", "QA_USER"]];
    for (const viewport of ["mobile", "desktop"] as const) {
      const out: Record<string, string | number> = {};
      for (const [path, role] of routes) {
        const ui = await uiActor(browser, role, viewport);
        try {
          const { page } = ui;
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 });
          await page.addInitScript(() => {
            (window as any).__shifts = [];
            new PerformanceObserver((list) => {
              for (const e of list.getEntries() as any[]) {
                if (e.hadRecentInput) continue;
                (window as any).__shifts.push({ value: e.value, sources: (e.sources ?? []).map((s: any) => {
                  const n = s.node as Element | null;
                  if (!n || !n.tagName) return "#text";
                  const cls = typeof n.className === "string" && n.className ? "." + n.className.split(/\s+/).slice(0, 2).join(".") : "";
                  return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${cls}`;
                }) });
              }
            }).observe({ type: "layout-shift", buffered: true });
          });
          const api: { url: string; status: number; bytes: number }[] = [];
          const pending: Promise<void>[] = [];
          page.on("requestfinished", (req) => {
            const u = new URL(req.url());
            if (!u.pathname.startsWith("/api/")) return;
            pending.push((async () => {
              const status = await req.response().then((r) => r?.status() ?? 0).catch(() => 0);
              const bytes = await req.sizes().then((x) => x.responseBodySize).catch(() => 0);
              api.push({ url: u.pathname + u.search, status, bytes });
            })());
          });
          await page.goto(path, { waitUntil: "load" });
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(2_000);
          const shifts: Shift[] = await page.evaluate(() => (window as any).__shifts);
          await Promise.all(pending); // every listener settles before the context closes
          const cls = shifts.reduce((s, x) => s + x.value, 0); // whole-load sum (no input happened)
          const bySource = new Map<string, number>();
          for (const s of shifts) for (const src of s.sources) bySource.set(src, (bySource.get(src) ?? 0) + s.value);
          const top = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(" ");
          const counts = new Map<string, number>();
          for (const r of api) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
          const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([u, n]) => `${u}x${n}`).join(" ");
          const unauth = api.filter((r) => r.status === 401).map((r) => r.url).join(" ");
          const largest = api.slice().sort((a, b) => b.bytes - a.bytes)[0];
          const key = path.replace(/[^a-z0-9]+/gi, "_").replace(/_[0-9a-f]{8}_[0-9a-f_]+$/i, "_detail");
          out[`${key}_cls`] = Number(cls.toFixed(3));
          out[`${key}_shiftSources`] = top || "none";
          out[`${key}_apiRequests`] = api.length;
          out[`${key}_duplicates`] = dups || "none";
          out[`${key}_unauthorized`] = unauth || "none";
          out[`${key}_largest`] = largest ? `${largest.url.split("?")[0]} ${largest.bytes}B` : "none";
        } finally { await ui.close(); }
      }
      await evidence(`perf-p13-${viewport}`, out);
    }
    expect(true).toBe(true);
  });
});
