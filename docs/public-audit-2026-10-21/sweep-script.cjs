// Public-site audit sweep, 2026-10-21. Read-only: every non-GET request is aborted.
// Usage: node sweep.cjs <baseUrl> <outDir> <mode: public|resident> [sessionToken]
const { createRequire } = require("module");
const req = createRequire("/Users/gopaallyamala/Documents/Isoftworks/HelloCircle/hello-circle/package.json");
const { chromium } = req("@playwright/test");
const fs = require("fs");
const path = require("path");

const [, , BASE, OUT, MODE, TOKEN] = process.argv;
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

const PUBLIC = [
  "/", "/home", "/explore", "/explore?q=yoga", "/explore?q=zzzzqqq", "/search?q=hike", "/games", "/games?when=weekend",
  "/games/adm-demo-game-1", "/games/adm-demo-game-2", "/games/does-not-exist",
  "/circles", "/circles/demo-circle-1", "/circles/does-not-exist",
  "/programs", "/programs/demo-prog-yoga", "/experiences", "/experiences/demo-experience-10",
  "/adventures", "/adventures/demo-experience-1", "/volunteer",
  "/browse/centres", "/browse/clubs", "/centres/c2", "/clubs/s2", "/book/c2", "/register/s2",
  "/provider/33c1128a-b1d3-4318-83ec-51a740a5f77a", "/host/bee0eac9-7ab0-47c5-8791-5c796401b4a4",
  "/free-time", "/dublin/badminton", "/cork/yoga", "/make-it-happen", "/suggest-place",
  "/games/host", "/circles/start", "/become-a-host", "/for-venues", "/pricing", "/vendor/signup",
  "/signin", "/signin/create", "/login", "/forgot-password",
  "/about", "/contact", "/complaints", "/help-guide", "/help-guide/explore", "/policies", "/privacy", "/cookies",
  "/bookings", "/profile", "/chats", "/receipts/HC-NOPE", "/payment/success", "/payment/cancel", "/this-is-not-a-page",
];
const RESIDENT = [
  "/my-life", "/bookings", "/profile", "/profile?tab=favourites", "/profile?tab=following", "/profile?tab=inbox",
  "/profile?tab=notificationPrefs", "/profile?tab=credit", "/profile?tab=receipts", "/profile?tab=passes",
  "/profile?tab=hosting", "/profile?tab=safety", "/profile?tab=help", "/profile?tab=privacy", "/profile?tab=household",
  "/chats", "/circles", "/circles/demo-circle-2", "/circles/demo-circle-6", "/manage", "/manage?tab=circles",
  "/manage/circles/demo-circle-6", "/games/host", "/circles/start", "/games/adm-demo-game-1", "/home",
];
const routes = MODE === "resident" ? RESIDENT : PUBLIC;
const widths = (process.env.WIDTHS || "390,768,1024,1440,1920").split(",").map(Number);
const SHOT_WIDTHS = new Set((process.env.SHOT_WIDTHS || "390,1440").split(",").map(Number));

function slug(r) { return (r === "/" ? "root" : r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_")).slice(0, 60); }

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w <= 390 ? 844 : w <= 768 ? 1024 : 900 }, deviceScaleFactor: 1, isMobile: w <= 390, hasTouch: w <= 768 });
    if (TOKEN) await ctx.addCookies([{ name: "hello_circle_guest_session", value: TOKEN, url: BASE }]);
    // Dismiss the cookie banner for consistent screenshots (localStorage only).
    await ctx.addInitScript(() => { try { localStorage.setItem("hello_circle_cookie_consent", JSON.stringify({ v: 2, analytics: false, advertising: false, decidedAt: new Date().toISOString() })); } catch {} });
    if (process.env.HIDE_TERMS) await ctx.addInitScript(() => {
      // Audit-only: hide the one-time Terms gate for screenshots (no data written).
      const kill = () => { const t = document.getElementById("terms-dialog-title"); if (t) { let el = t; while (el.parentElement && getComputedStyle(el.parentElement).position !== "fixed") el = el.parentElement; (el.parentElement || el).remove(); document.body.style.overflow = ""; } };
      new MutationObserver(kill).observe(document, { childList: true, subtree: true });
    });
    for (const r of routes) {
      const page = await ctx.newPage();
      const rec = { route: r, width: w, consoleErrors: [], pageErrors: [], failedGets: [], aborted: [] };
      page.on("console", (m) => { if (m.type() === "error") rec.consoleErrors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => rec.pageErrors.push(String(e).slice(0, 200)));
      page.on("response", (res) => { if (res.status() >= 400 && res.request().method() === "GET") rec.failedGets.push(`${res.status()} ${res.url().replace(BASE, "")}`.slice(0, 160)); });
      await page.route("**/*", (route) => {
        const m = route.request().method();
        if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") { rec.aborted.push(`${m} ${route.request().url().replace(BASE, "")}`.slice(0, 120)); return route.abort(); }
        return route.continue();
      });
      const t0 = Date.now();
      try { await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 25000 }); } catch (e) { rec.navError = String(e).slice(0, 120); }
      await page.waitForTimeout(700);
      rec.loadMs = Date.now() - t0;
      try {
        Object.assign(rec, await page.evaluate(() => {
          const vw = window.innerWidth, vh = window.innerHeight;
          const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && b.width > 0 && b.height > 0 && !el.closest("[aria-hidden='true']"); };
          const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
          const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis);
          const levels = hs.map((h) => +h.tagName[1]);
          const skips = []; let prev = 0;
          levels.forEach((l, i) => { if (prev && l > prev + 1) skips.push(`h${prev}>h${l}:${hs[i].textContent.trim().slice(0, 24)}`); prev = l; });
          const overflowEls = [];
          if (document.documentElement.scrollWidth > vw + 1) {
            for (const el of document.querySelectorAll("body *")) { const b = el.getBoundingClientRect(); if (b.right > vw + 2 && b.width > 0 && vis(el) && getComputedStyle(el).position !== "fixed") { overflowEls.push(`${desc(el)}@${Math.round(b.right)}`); if (overflowEls.length > 4) break; } }
          }
          const inter = [...document.querySelectorAll("a[href],button,input,select,textarea,[role=button],[role=tab]")].filter(vis);
          const unnamed = inter.filter((el) => { const n = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.getAttribute("alt") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("placeholder") || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim(); return !n && el.type !== "hidden"; }).map(desc).slice(0, 5);
          const small = inter.filter((el) => { const b = el.getBoundingClientRect(); return (b.width < 24 || b.height < 24) && el.tagName !== "INPUT"; });
          const smallInline = small.filter((el) => el.tagName === "A" && getComputedStyle(el).display === "inline").length;
          const imgs = [...document.querySelectorAll("img")];
          const noAlt = imgs.filter((i) => !i.hasAttribute("alt")).length;
          const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0 && vis(i)).map((i) => (i.currentSrc || i.src).slice(0, 80)).slice(0, 4);
          const fixedBottom = [...document.querySelectorAll("body *")].filter((el) => { const s = getComputedStyle(el); if (!(s.position === "fixed" || s.position === "sticky")) return false; const b = el.getBoundingClientRect(); return vis(el) && b.bottom >= vh - 4 && b.top > vh / 2; }).map((el) => `${desc(el)}:${(el.innerText || "").replace(/\s+/g, " ").slice(0, 40)}`).slice(0, 3);
          const aboveFoldButtons = inter.filter((el) => { const b = el.getBoundingClientRect(); return b.top < vh && b.bottom > 0 && (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || /btn|button|cta/i.test(String(el.className))); }).map((el) => (el.innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 28)).filter(Boolean).slice(0, 12);
          const h1 = hs.filter((h) => h.tagName === "H1");
          const inputsUnlabelled = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(vis).filter((el) => !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).length;
          return {
            finalPath: location.pathname + location.search, title: document.title,
            h1Count: h1.length, h1: h1.map((h) => h.innerText.replace(/\s+/g, " ").trim().slice(0, 70)),
            headingCount: hs.length, skips: skips.slice(0, 4), mains: document.querySelectorAll("main").length,
            pageHeight: document.documentElement.scrollHeight, screens: +(document.documentElement.scrollHeight / vh).toFixed(1),
            hOverflow: document.documentElement.scrollWidth > vw + 1, scrollWidth: document.documentElement.scrollWidth, overflowEls,
            interactive: inter.length, unnamed, smallTargets: small.length - smallInline, imgs: imgs.length, noAlt, broken,
            fixedBottom, aboveFoldButtons, inputsUnlabelled,
            bodyStart: (document.querySelector("main")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220),
          };
        }));
      } catch (e) { rec.evalError = String(e).slice(0, 120); }
      if (SHOT_WIDTHS.has(w)) {
        try { await page.screenshot({ path: path.join(OUT, "shots", `${MODE}-${slug(r)}-${w}.png`), fullPage: !!process.env.FULL, timeout: 15000 }); } catch {}
      }
      results.push(rec);
      process.stdout.write(`${w} ${r} -> ${rec.finalPath} ${rec.hOverflow ? "OVERFLOW" : ""} ce=${rec.consoleErrors.length} ${rec.navError ? "NAVERR" : ""}\n`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, `${MODE}-results.json`), JSON.stringify(results, null, 1));
})();
