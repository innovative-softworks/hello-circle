import { expect } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { businessUiActor } from "../product-fixture";
import { bookableProgram } from "../booking-fixture";

// Phase 13 — HC-QA-100: dates picked in the UI must be stored as picked, for
// a user on Irish time (IST in summer = UTC+1). The schedule builders turned
// "YYYY-MM-DD" into LOCAL midnight and then read it back in UTC, which moved
// every date one day earlier east of UTC (Ireland from late March to late
// October) — including single, non-repeating sessions.

test("HC-QA-100: programme sessions added in an Irish-time browser keep the picked dates (summer single + weekly, winter)", async ({ playwright, browser }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_VENDOR"], async (f) => {
    const prog = await bookableProgram(f, { price: 0, capacity: 5 });
    const vendor = await businessUiActor(browser, "QA_VENDOR", "desktop", { timezoneId: "Europe/Dublin" });
    const stored = async () => (await rows(f, "SELECT DATE_FORMAT(date, '%Y-%m-%d') AS d FROM program_sessions WHERE program_id = ? ORDER BY date", [prog.id])).map((r: any) => r.d as string);
    try {
      const { page } = vendor;
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Europe/Dublin");
      await page.goto(`/vendor/programs/${prog.id}`);
      await expect(page.getByRole("heading", { name: "SESSIONS" })).toBeVisible({ timeout: 20_000 });
      // The session form is collapsed behind an "Add session" toggle.
      const openForm = async () => {
        if (await page.getByLabel("Session date").isVisible()) return;
        await page.getByRole("button", { name: "Add session" }).first().click({ timeout: 10_000 });
        await expect(page.getByLabel("Session date"), "session form is shown").toBeVisible({ timeout: 10_000 });
      };
      const add = async (date: string, repeat: "none" | "weekly", n?: number) => {
        const before = (await stored()).length;
        await openForm();
        await page.getByLabel("Session date").fill(date, { timeout: 10_000 });
        await page.getByLabel("Session start time").fill("18:00", { timeout: 10_000 });
        await page.getByLabel("Repeat").selectOption(repeat, { timeout: 10_000 });
        if (n) await page.getByPlaceholder("Times").fill(String(n), { timeout: 10_000 });
        await page.getByRole("button", { name: repeat === "none" ? "Add session" : `Add ${n} sessions` }).first().click({ timeout: 10_000 });
        await expect.poll(async () => (await stored()).length, { timeout: 15_000 }).toBe(before + (n ?? 1));
      };
      await add("2027-07-15", "none");          // Thursday, Irish summer time (UTC+1)
      await add("2027-08-05", "weekly", 3);     // Thursdays 5, 12, 19 August
      await add("2027-01-14", "none");          // Thursday, Irish winter time (UTC+0)
      const dates = await stored();
      await evidence("hc-qa-100", { stored: dates.join(","), browserTimeZone: "Europe/Dublin" });
      expect(dates).toEqual(["2027-01-14", "2027-07-15", "2027-08-05", "2027-08-12", "2027-08-19"]);
    } finally { await vendor.close(); }
  });
});
