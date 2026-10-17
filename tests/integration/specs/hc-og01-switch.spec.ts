import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import { residentCircle } from "../stage-b-fixture";

// OG-01 / DEC-03 — explicit switching between a partner's business account and
// the personal account it is linked to, in a real browser against the real
// stack. QA_VENDOR is linked to QA_HOST's personal account for this test only
// (exact-ID update, restored in finally). Nothing switches without a click;
// an unlinked partner is sent to its own workspace and can't mint a personal
// session; a signed-out caller can't switch at all.

test("OG-01-SWITCH: linked partner switches to the personal account from the gate and the account menu; unlinked and signed-out callers can't", async ({ playwright, browser }) => {
  test.setTimeout(150_000);
  await withActors(playwright, ["QA_VENDOR_B", "GUEST"], async (f) => {
    const [before] = await rows(f, "SELECT resident_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    expect(await rows(f, "SELECT id FROM users WHERE resident_id = ?", [personas.QA_HOST.id]), "QA_HOST isn't linked to any business account yet").toEqual([]);
    await f.connection.execute("UPDATE users SET resident_id = ? WHERE id = ?", [personas.QA_HOST.id, personas.QA_VENDOR.id]);
    const circle = await residentCircle(f, "QA_HOST");
    const a = await staffActor(browser, "QA_VENDOR");
    const b = await staffActor(browser, "QA_VENDOR");
    const other = await staffActor(browser, "QA_VENDOR_B");
    try {
      const auditBefore = Number((await rows(f, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'manage.switched_workspace' AND actor_user_id = ?", [personas.QA_VENDOR.id]))[0].n);

      // 1. Business-only session on Circle management → the explicit gate, not a redirect.
      await a.page.goto(`/manage/circles/${circle}`);
      await expect(a.page.getByRole("heading", { name: "Managing a Circle uses your personal account" })).toBeVisible();
      expect((await (await a.context.request.get("/api/residents/me")).json()).resident, "no personal session until the click").toBeNull();

      // 2. The Host workspace with a tab in the URL: the gate, then Switch keeps the URL.
      await a.page.goto("/manage?tab=activities");
      await expect(a.page.getByRole("heading", { name: "Hosting uses your personal account" })).toBeVisible();
      await expect(a.page.getByRole("link", { name: "Back to Partner workspace" })).toHaveAttribute("href", "/vendor");
      await a.page.getByRole("button", { name: "Switch to personal account" }).click();
      await expect(a.page.getByRole("heading", { name: "Hosting uses your personal account" })).toHaveCount(0);
      expect(new URL(a.page.url()).searchParams.get("tab"), "the page asked for still renders").toBe("activities");
      await expect(a.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const me = await (await a.context.request.get("/api/residents/me")).json();
      expect(me.resident.id, "now holds QA_HOST's personal session").toBe(personas.QA_HOST.id);
      expect((await (await a.context.request.get("/api/auth/me")).json()).user.id, "business session kept alongside").toBe(personas.QA_VENDOR.id);
      // The Circle record now renders for its organiser instead of the gate.
      await a.page.goto(`/manage/circles/${circle}`);
      await expect(a.page.getByRole("heading", { name: "Managing a Circle uses your personal account" })).toHaveCount(0);

      // 3. From the Partner workspace: account menu → "Switch to Personal".
      await b.page.goto("/vendor");
      await b.page.getByRole("button", { name: /^Account menu/ }).filter({ visible: true }).first().click();
      await b.page.getByRole("button", { name: "Switch to Personal" }).click();
      await expect(b.page).toHaveURL(/\/bookings/);
      expect((await (await b.context.request.get("/api/residents/me")).json()).resident.id).toBe(personas.QA_HOST.id);
      await expect.poll(async () => Number((await rows(f, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'manage.switched_workspace' AND actor_user_id = ?", [personas.QA_VENDOR.id]))[0].n), { message: "each switch audited" }).toBe(auditBefore + 2);

      // 4. Unlinked partner: sent to its own workspace; the switch API refuses.
      await other.page.goto("/manage?tab=activities");
      await expect(other.page).toHaveURL(/\/vendor/);
      await expect(other.page.getByRole("heading", { name: "Hosting uses your personal account" })).toHaveCount(0);
      const refused = await other.context.request.post("/api/manage/switch", { data: { to: "resident" } });
      expect(refused.status(), "no linked personal account").toBe(404);
      expect((await (await other.context.request.get("/api/residents/me")).json()).resident, "no personal session minted").toBeNull();
      expect((await f.actors.QA_VENDOR_B.post("/api/manage/switch", { data: { to: "vendor" } })).status(), "business → business is not a switch").toBe(401);

      // 5. Signed out: neither direction.
      expect((await f.actors.GUEST.post("/api/manage/switch", { data: { to: "resident" } })).status()).toBe(404);
      expect((await f.actors.GUEST.post("/api/manage/switch", { data: { to: "vendor" } })).status()).toBe(401);

      await evidence("og-01-switch", { gateShown: true, urlKept: true, menuSwitch: true, audited: 2, unlinkedRefused: 404, signedOut: [404, 401] });
      expect([...a.consoleErrors, ...b.consoleErrors, ...other.consoleErrors], "no page errors").toEqual([]);
    } finally {
      // End the personal sessions this test minted, then the business ones.
      for (const x of [a, b]) await x.context.request.post("/api/guest/logout").catch(() => undefined);
      await a.close();
      await b.close();
      await other.close();
      await f.connection.execute("UPDATE users SET resident_id = ? WHERE id = ?", [before.resident_id ?? null, personas.QA_VENDOR.id]);
    }
  });
});
