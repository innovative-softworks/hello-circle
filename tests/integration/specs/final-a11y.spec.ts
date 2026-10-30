import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor, uiActor, noHorizontalScroll, overflowingElements } from "../lifecycle-ui-fixture";
import { bookableClub } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";
import { headingAudit } from "../a11y-audit";

// Final validation (docs/participation-expansion/final-validation/09):
// automated structural checks of the participation pages at 375, 768, 1024
// and 1440 px. Enforced: no horizontal scroll, one visible H1, a <main>
// landmark, every visible form control and button has an accessible name.
// Measured and reported (not enforced; need manual review): targets under
// 24×24 px and text below the WCAG contrast ratio. Not a substitute for a
// manual screen-reader and keyboard pass.

// 320 px is the WCAG 1.4.10 reflow width (1280 px at 400% zoom).
const WIDTHS = [320, 375, 768, 1024, 1440] as const;
const KEYBOARD_WIDTHS = new Set<number>([375, 1440]);

/** Tabs through the page: every stop must be on screen, outside aria-hidden, and show a focus
 * indicator (on the element or a wrapper up to three levels up, e.g. a :focus-within ring);
 * the same element may keep focus for a native control's own parts (a date input's day,
 * month and year) but not longer. Elements are tracked by identity, not by name. */
async function keyboardSweep(page: Page, max = 40) {
  const issues: string[] = [];
  await page.locator("body").focus();
  let last = -1;
  let repeats = 0;
  let stops = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((n) => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      if (!e.dataset.kbdStop) e.dataset.kbdStop = String(n);
      const r = e.getBoundingClientRect();
      const shows = (el: Element | null) => {
        if (!el) return false;
        const st = getComputedStyle(el);
        return (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
      };
      let ring = shows(e);
      for (let a = e.parentElement, k = 0; !ring && a && k < 3; a = a.parentElement, k++) ring = a.matches(":focus-within") && shows(a);
      const name = (e.getAttribute("aria-label") || e.textContent || (e as HTMLInputElement).placeholder || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const cs = getComputedStyle(e);
      const detail = `outline=${cs.outlineStyle}/${cs.outlineWidth} shadow=${cs.boxShadow.slice(0, 30)} focusVisible=${e.matches(":focus-visible")} focus=${e.matches(":focus")} root=${e.closest(".adm,.adm-panel,.adm-sheet,.adm-dlg")?.className.split(" ")[0] ?? "none"}`;
      const segmented = e.tagName === "INPUT" && /^(date|time|datetime-local|month|week)$/.test((e as HTMLInputElement).type);
      return { id: Number(e.dataset.kbdStop), label: `${e.tagName}[${(e as HTMLInputElement).type ?? ""}] "${name}"`, w: r.width, h: r.height, hidden: !!e.closest("[aria-hidden='true'],[inert]"), ring, segmented, detail };
    }, i);
    if (!info) break;
    stops++;
    repeats = info.id === last ? repeats + 1 : 0;
    last = info.id;
    // A native date/time input's parts (day, month, year, picker) are separate Tab stops of one element.
    if (repeats >= (info.segmented ? 5 : 3)) { issues.push(`focus stuck on ${info.label}`); break; }
    if (info.w === 0 || info.h === 0) issues.push(`focus on an invisible element: ${info.label}`);
    else if (info.hidden) issues.push(`focus inside aria-hidden: ${info.label}`);
    else if (!info.ring) issues.push(`no visible focus indicator: ${info.label} (${info.detail})`);
  }
  return { issues, stops };
}

async function structure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el as HTMLElement);
      const r = (el as HTMLElement).getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0 && !(el as HTMLElement).closest("[aria-hidden='true']");
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? "." + (el as HTMLElement).className.split(/\s+/)[0] : ""}`;
    const nameOf = (el: Element) => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim(); if (t) return t; }
      const id = el.getAttribute("id");
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l?.textContent?.trim()) return l.textContent.trim(); }
      const wrap = el.closest("label");
      if (wrap?.textContent?.trim()) return wrap.textContent.trim();
      if (el.tagName === "BUTTON" || el.tagName === "A") {
        const t = (el as HTMLElement).innerText?.trim() || Array.from(el.querySelectorAll("img[alt],svg[aria-label]")).map((i) => i.getAttribute("alt") || i.getAttribute("aria-label")).join(" ").trim();
        if (t) return t;
      }
      return el.getAttribute("title")?.trim() ?? "";
    };
    const controls = Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea")).filter(visible);
    const unlabelled = controls.filter((c) => !nameOf(c)).map(describe);
    const buttons = Array.from(document.querySelectorAll("button,a[href],[role=button]")).filter(visible);
    const unnamed = buttons.filter((b) => !nameOf(b)).map(describe);
    // WCAG 2.5.8 target size (minimum 24×24), inline links in running text excluded.
    const small = [...buttons, ...controls].filter((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) return false;
      if (el.tagName === "A" && el.closest("p,li") && !(el as HTMLElement).className) return false;
      if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio") return !!el.closest("label") === false && (r.width < 16 || r.height < 16);
      return true;
    }).map((el) => `${describe(el)} ${Math.round((el as HTMLElement).getBoundingClientRect().width)}×${Math.round((el as HTMLElement).getBoundingClientRect().height)}`);
    // Text contrast against the first opaque ancestor background (images and gradients skipped).
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const lowContrast: string[] = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim() || !visible(el)) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      const fg = rgb(s.color);
      if (fg.length > 3 && fg[3] < 1) continue;
      let bg: number[] | null = null;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (as.backgroundImage !== "none") { bg = null; break; }
        const c = rgb(as.backgroundColor);
        if (c.length === 3 || (c.length > 3 && c[3] === 1)) { bg = c.slice(0, 3); break; }
      }
      if (!bg) continue;
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5) && !el.closest("[disabled],[aria-disabled='true']")) lowContrast.push(`${describe(el)} "${n.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
    }
    return { unlabelled, unnamed, small: small.slice(0, 15), smallCount: small.length, lowContrast: lowContrast.slice(0, 15), lowContrastCount: lowContrast.length };
  });
}

test("FINAL-A11Y: participation pages (partner, resident, host, admin) at 320, 375, 768, 1024 and 1440 — overflow, headings, landmarks, names, keyboard focus; targets and contrast measured", async ({ playwright, browser }) => {
  test.setTimeout(600_000);
  const pages: { who: "vendor" | "resident" | "host" | "admin"; url: string; name: string }[] = [];
  const findings: Record<string, unknown> = {};
  const failures: string[] = [];
  await withActors(playwright, ["QA_VENDOR", "QA_USER", "QA_HOST"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.attendees": true });
    // One sign-in per persona for the whole sweep (the login limiter is per backend).
    const actors = {
      vendor: await staffActor(browser, "QA_VENDOR"),
      admin: await staffActor(browser, "QA_ADMIN"),
      resident: await uiActor(browser, "QA_USER", "desktop"),
      host: await uiActor(browser, "QA_HOST", "desktop"),
    };
    try {
      for (const r of [actors.resident, actors.host]) await r.context.request.post("/api/residents/me/accept-terms", { data: { termsAccepted: true } });
      const clubId = await bookableClub(f, { price: 0, payment: "cash" });
      const Q = `/api/vendor/forms/club/${clubId}/questions`;
      expect((await f.actors.QA_VENDOR.put(`${Q}/draft`, { data: { questions: [{ scope: "booking", inputType: "select", label: "Kit size", purpose: "Kit", choices: ["S", "M", "L"], required: true }, { scope: "booking", inputType: "long_text", label: "Anything else", purpose: "Notes" }] } })).status()).toBe(200);
      const pub = await f.actors.QA_VENDOR.post(`${Q}/publish`);
      expect(pub.status()).toBe(200);
      const form = (await pub.json()) as { version: number; questions: { key: string; label: string }[] };
      const [me] = await rows(f, "SELECT email FROM residents WHERE id = ?", [personas.QA_USER.id]);
      const reg = await f.actors.QA_USER.post("/api/registrations/checkout", { headers: { "X-Client-Id": randomUUID() }, data: { clubId, registrantType: "adult", childFirst: "QA", childLast: `A11y${randomUUID().slice(0, 4)}`, gFirst: "QA", gLast: "Adult", email: String(me.email), phone: "000", address: "QA", consent: true, trial: false, acceptedTerms: true, questionsVersion: form.version, answers: { booking: { [form.questions.find((q) => q.label === "Kit size")!.key]: "M" } } } });
      expect(reg.status()).toBe(201);
      const ref = (await reg.json()).ref as string;
      const game = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA A11y ${randomUUID().slice(0, 6)}`, date: "2030-07-20", time: "18:30", capacity: 8, locationText: "QA pitch" } });
      expect(game.status()).toBe(201);
      const gameId = (await game.json()).id as string;
      pages.push(
        { who: "vendor", url: "/vendor?tab=reports", name: "partner-reports" },
        { who: "vendor", url: "/vendor?tab=messages", name: "partner-messages" },
        { who: "vendor", url: `/vendor/clubs/${clubId}?tab=questions`, name: "partner-form-builder" },
        { who: "vendor", url: `/vendor/orders/registration/${ref}`, name: "partner-registration-record" },
        { who: "vendor", url: "/vendor/door", name: "partner-door" },
        { who: "resident", url: `/register/${clubId}`, name: "resident-registration-form" },
        { who: "resident", url: `/bookings/registration/${ref}`, name: "resident-registration-detail" },
        { who: "resident", url: "/my-life", name: "resident-my-life" },
        { who: "host", url: `/manage?tab=activities&record=activity:${gameId}`, name: "host-activity-record" },
        { who: "admin", url: "/admin?tab=governance", name: "admin-governance" },
        { who: "admin", url: "/admin?tab=categories", name: "admin-categories" },
        { who: "admin", url: "/admin?tab=organisations", name: "admin-organisations" },
        { who: "admin", url: "/admin?tab=settings", name: "admin-settings" },
      );
      for (const width of WIDTHS) {
        for (const p of pages) {
          const { page } = actors[p.who];
          page.setDefaultTimeout(15_000);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
          await page.goto(p.url);
          await expect(page.locator("h1").first()).toBeVisible();
          await page.waitForLoadState("networkidle").catch(() => undefined);
          const key = `${p.name}@${width}`;
          if (!(await noHorizontalScroll(page))) failures.push(`${key} overflow: ${(await overflowingElements(page)).join(" | ")}`);
          const h = await headingAudit(page, p.url);
          if (h.h1 !== 1) failures.push(`${key} h1 count ${h.h1}`);
          if (h.main < 1) failures.push(`${key} no <main>`);
          const s = await structure(page);
          if (s.unlabelled.length) failures.push(`${key} unlabelled controls: ${s.unlabelled.join(", ")}`);
          if (s.unnamed.length) failures.push(`${key} unnamed buttons/links: ${s.unnamed.join(", ")}`);
          let keyboard: { issues: string[]; stops: number } | null = null;
          if (KEYBOARD_WIDTHS.has(width)) {
            keyboard = await keyboardSweep(page);
            for (const issue of keyboard.issues) failures.push(`${key} keyboard: ${issue}`);
          }
          findings[key] = { h1: h.h1Text, headingSkips: h.skips, smallTargets: s.smallCount, smallExamples: s.small, lowContrast: s.lowContrastCount, lowContrastExamples: s.lowContrast, keyboardStops: keyboard?.stops ?? null };
        }
      }
    } finally {
      for (const a of Object.values(actors)) await a.close();
      mkdirSync(`${process.cwd()}/.qa-data`, { recursive: true });
      writeFileSync(`${process.cwd()}/.qa-data/final-a11y.json`, JSON.stringify({ failures, findings }, null, 2));
      await restoreSwitches();
    }
  });
  expect(failures, "participation pages at 320/375/768/1024/1440").toEqual([]);
});
