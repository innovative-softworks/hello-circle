import { expect } from "../fixtures";
import { createActivity, rows, test, withActors } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";
import { businessUiActor } from "../product-fixture";
import { bookableCentre } from "../booking-fixture";
import { fitsViewport, setSwitches } from "../revenue-fixture";

// Revenue & Connect Stage 5e — venue/host split UI at desktop and mobile
// (provider stub): the host proposes a split for a paid game at a partner
// venue from their earnings page; the venue's organisation sees it on its
// earnings page, can't decline without a reason, and accepts. Wording comes
// from the editable "venue_split" help entry. The payout card shows an
// explicit account state.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-SPLIT-${viewport}: host proposes a venue split, the venue accepts`, async ({ playwright, browser }) => {
    test.setTimeout(120_000);
    await withActors(playwright, ["QA_HOST", "QA_VENDOR"], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.connect_v1": true });
      const centre = await bookableCentre(f, { rate: 20, cap: 20, payment: "online" });
      const game = await createActivity(f, "QA_HOST", { capacity: 4, priceCents: 4000 });
      await f.connection.execute("UPDATE games SET centre_id = ? WHERE id = ?", [centre.id, game.id]);
      const host = await uiActor(browser, "QA_HOST", viewport);
      const venue = await businessUiActor(browser, "QA_VENDOR", viewport);
      try {
        // Host side.
        const hp = host.page;
        await hp.goto("/manage?tab=earnings");
        await expect(hp.getByTestId("host-splits")).toBeVisible();
        await expect(hp.getByTestId("payout-state")).toHaveAttribute("data-state", /not_started|onboarding_incomplete/);
        const row = hp.locator("div").filter({ hasText: game.activityLabel }).filter({ has: hp.getByRole("button", { name: "Propose to venue" }) }).last();
        await expect(row.getByText(/No split/)).toBeVisible();
        await row.getByLabel("Split type").selectOption("percentage");
        await row.getByLabel("Split value").fill("60");
        await row.getByRole("button", { name: "Propose to venue" }).click();
        await expect(row.getByText(/Venue 60\.00% · host 40\.00% — Waiting for the venue/)).toBeVisible();
        await fitsViewport(hp);
        const [a] = await rows(f, "SELECT id, venue_bps AS bps, status FROM venue_split_agreements WHERE game_id = ? ORDER BY version DESC", [game.id]);
        expect([Number(a.bps), a.status]).toEqual([6000, "proposed"]);

        // Venue side.
        const vp = venue.page;
        await vp.goto("/vendor?tab=earnings");
        await expect(vp.getByTestId("venue-splits")).toBeVisible();
        const vrow = vp.getByRole("row").filter({ hasText: "Venue 60.00% · host 40.00%" }).first();
        await expect(vrow.getByText("Waiting for the venue")).toBeVisible();
        await vrow.getByRole("button", { name: "Decline" }).click();
        await expect(vp.getByRole("alert").filter({ hasText: /reason/i })).toBeVisible();
        await vrow.getByRole("button", { name: "Accept" }).click();
        await expect(vp.getByRole("row").filter({ hasText: "Venue 60.00% · host 40.00%" }).first().getByText("Agreed")).toBeVisible();
        await fitsViewport(vp);
        expect((await rows(f, "SELECT status FROM venue_split_agreements WHERE id = ?", [a.id]))[0].status).toBe("accepted");
      } finally {
        await host.close();
        await venue.close();
        await f.connection.execute("DELETE FROM venue_split_agreements WHERE game_id = ?", [game.id]);
        await restore();
      }
    });
  });
}
