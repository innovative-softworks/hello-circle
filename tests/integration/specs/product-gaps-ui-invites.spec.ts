import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows, createCircle } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { tabTo, focused } from "../product-fixture";
import { closureGame } from "../closure-fixture";

// Phase 11B — host "Revoke invitation" (activity) and organiser "Revoke
// invitation" (Circle) in the UI. Fail-before: neither control existed.

const nameOf = async (f: any, id: string) => ((await rows(f, "SELECT name FROM residents WHERE id = ?", [id]))[0].name as string);

test("HC-GAP-UI-HOST-REVOKE: host revokes a pending activity invitation from the invite sheet, keyboard-only with a confirmation", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER"], async (f) => {
    const game = await closureGame(f);
    expect((await f.actors.QA_HOST.post("/api/invitations", { data: { entityType: "game", entityId: game, inviteeResidentIds: [personas.QA_USER.id] } })).status()).toBe(201);
    const [inv] = await rows(f, "SELECT id FROM invitations WHERE entity_id = ? AND invitee_resident_id = ?", [game, personas.QA_USER.id]);
    f.track("audit_log", "object_id", inv.id);
    const invitee = await nameOf(f, personas.QA_USER.id);
    const ui = await uiActor(browser, "QA_HOST", "desktop");
    try {
      const { page } = ui;
      await page.goto(`/games/${game}`);
      await page.getByRole("button", { name: "Invite" }).first().click();
      const list = page.getByRole("list", { name: "Invitations sent" });
      await expect(list).toContainText(invitee);
      await expect(list).toContainText("Pending");
      const target = await tabTo(page, (x) => x.name === `Revoke invitation to ${invitee}`, { max: 40 });
      expect(target, "Revoke invitation reachable by keyboard").not.toBeNull();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("alertdialog").filter({ hasText: "Revoke invitation?" });
      await expect(dialog).toBeVisible();
      await expect.poll(async () => (await focused(page)).inDialog).toBe(true);
      await dialog.getByRole("button", { name: "Revoke invitation" }).click();
      await expect(page.getByRole("status").filter({ hasText: `Invitation to ${invitee} revoked.` })).toBeVisible();
      await expect(list).toContainText("Revoked");
      await expect(page.getByRole("button", { name: `Revoke invitation to ${invitee}` })).toHaveCount(0);
      expect((await rows(f, "SELECT status FROM invitations WHERE id = ?", [inv.id]))[0].status).toBe("revoked");
      expect((await f.actors.QA_USER.get(`/api/games/${game}`)).status(), "access gone").toBe(404);
      await evidence("hc-gap-ui-host-revoke", { keyboard: true, confirmed: true, accessAfter: 404 });
    } finally { await ui.close(); }
  });
});

test("HC-GAP-UI-CIRCLE-REVOKE: organiser revokes a pending Circle invitation on the Manage Circle page (mobile)", async ({ playwright, browser }) => {
  await withActors(playwright, ["QA_HOST"], async (f) => {
    const circle = await createCircle(f, "QA_HOST", { joinMode: "invite" });
    expect((await f.actors.QA_HOST.post(`/api/circles/${circle.id}/invite`, { data: { residentId: personas.QA_USER_B.id } })).status()).toBe(201);
    const [inv] = await rows(f, "SELECT id FROM circle_invites WHERE circle_id = ? AND resident_id = ?", [circle.id, personas.QA_USER_B.id]);
    f.track("audit_log", "object_id", inv.id);
    const invitee = await nameOf(f, personas.QA_USER_B.id);
    const ui = await uiActor(browser, "QA_HOST", "mobile");
    try {
      const { page } = ui;
      await page.goto(`/manage/circles/${circle.id}?tab=members`);
      const card = page.getByRole("list", { name: "Pending invitations" });
      await expect(card).toContainText(invitee);
      await page.getByRole("button", { name: `Revoke invitation to ${invitee}` }).click();
      const dialog = page.getByRole("alertdialog").filter({ hasText: `Revoke ${invitee}'s invitation?` });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Revoke invitation" }).click();
      await expect(page.getByRole("status").filter({ hasText: `Invitation to ${invitee} revoked.` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Revoke invitation to ${invitee}` })).toHaveCount(0);
      expect((await rows(f, "SELECT status FROM circle_invites WHERE id = ?", [inv.id]))[0].status).toBe("revoked");
      await evidence("hc-gap-ui-circle-revoke", { mobile: true, confirmed: true });
    } finally { await ui.close(); }
  });
});
