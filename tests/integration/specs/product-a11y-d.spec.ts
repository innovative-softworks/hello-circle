import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { bookableExperience, bookableProgram } from "../booking-fixture";
import { headingAudit, settle, type HeadingAudit } from "../a11y-audit";

// Phase 12 — HC-QA-083 / HC-QA-070 on the business surfaces (vendor, admin).

const problems = (rows: HeadingAudit[]) => rows.filter((r) => r.h1 !== 1 || r.skips.length > 0 || r.main !== 1).map((r) => `${r.path}: h1=${r.h1} main=${r.main} ${r.skips.join("; ")}`);

test("HC-QA-083-BUSINESS: vendor dashboard, programme/experience editors and admin have one H1, no skips; sidebar marks the current section", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const prog = await bookableProgram(f, { price: 0, capacity: 3 });
    const exp = await bookableExperience(f, { price: 0, capacity: 3, payment: "cash" });
    const rows: HeadingAudit[] = [];
    const vendor = await businessUiActor(browser, "QA_VENDOR", "desktop");
    let currentMarked = 0;
    try {
      for (const path of ["/vendor", `/vendor/programs/${prog.id}`, `/vendor/experiences/${exp.id}`]) {
        await settle(vendor.page, path);
        rows.push(await headingAudit(vendor.page, path));
      }
      await settle(vendor.page, "/vendor");
      currentMarked = await vendor.page.locator('[aria-current="page"]').count();
    } finally { await vendor.close(); }
    const admin = await businessUiActor(browser, "QA_ADMIN", "desktop");
    try {
      await settle(admin.page, "/admin");
      rows.push(await headingAudit(admin.page, "/admin"));
    } finally { await admin.close(); }
    await evidence("hc-qa-083-business", { audit: JSON.stringify(rows), problems: problems(rows).join(" | ") || "none", sidebarCurrent: currentMarked });
    expect(problems(rows)).toEqual([]);
    expect(currentMarked, "current dashboard section exposed").toBeGreaterThanOrEqual(1);
  });
});
