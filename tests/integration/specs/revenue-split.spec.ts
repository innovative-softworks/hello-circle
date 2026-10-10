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
// explicit account state. Stage 5e — a settled split booking earns reward
// points for both partners, each on its own share, shown on each earnings page.

for (const viewport of ["desktop", "mobile"] as const) {
  test(`REV-SPLIT-${viewport}: host proposes a venue split, the venue accepts`, async ({ playwright, browser }) => {
    test.setTimeout(120_000);
    test.setTimeout(180_000);
    // Sign-ins are rate limited (10 per 15 min per IP): the two browser sessions double as the host and vendor API actors.
    await withActors(playwright, ["QA_USER", "QA_ADMIN"], async (f) => {
      const restore = await setSwitches(f.connection, { "commerce.connect_v1": true, "commerce.settlement_ledger": true, "commerce.circle_credits": true, "commerce.pro_subscriptions": true });
      const host = await uiActor(browser, "QA_HOST", viewport);
      const venue = await businessUiActor(browser, "QA_VENDOR", viewport);
      f.actors.QA_HOST = host.context.request;
      f.actors.QA_VENDOR = venue.context.request;
      const centre = await bookableCentre(f, { rate: 20, cap: 20, payment: "online" });
      const game = await createActivity(f, "QA_HOST", { capacity: 4, priceCents: 7000 }); // both shares ≥ the €25 minimum
      await f.connection.execute("UPDATE games SET centre_id = ? WHERE id = ?", [centre.id, game.id]);
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

        // Stage 5e — split reward points: a paid booking, settled, earns points for BOTH partners on their own share.
        const join = await f.actors.QA_USER.post(`/api/games/${game.id}/join`, { data: {} });
        expect(join.status()).toBe(201);
        const { ref } = await join.json();
        expect((await f.actors.QA_USER.post("/api/__qa/provider", { data: { type: "game", ref, outcome: "success" } })).status()).toBe(200);
        await f.connection.execute("UPDATE games SET date = DATE_SUB(CURDATE(), INTERVAL 5 DAY) WHERE id = ?", [game.id]);
        const run = await f.actors.QA_ADMIN.post("/api/admin/finance/settlements/run", { data: { runKey: `rev-split-${viewport}-${ref}`, dryRun: false, reason: "split points journey" } });
        expect(run.status()).toBe(200);
        const awards = await rows(f, "SELECT party_type AS t, points, eligible_minor AS e FROM reward_split_awards WHERE source_ref = ? ORDER BY party_type DESC", [ref]);
        // €70 at 60 %: venue 4200, host 2800 → ⌊7000 × 1/€⌋ = 70 → 42 / 28 (only after settlement).
        expect(awards.map((x: any) => [x.t, Number(x.e), Number(x.points)])).toEqual([["org", 4200, 42], ["host", 2800, 28]]);
        for (const [pg, scope, path] of [[vp, "vendor", "/vendor?tab=earnings"], [hp, "host", "/manage?tab=earnings"]] as const) {
          const balance = (await (await (scope === "vendor" ? venue.context.request : host.context.request).get(`/api/${scope}/plan`)).json()).rewards.points as number;
          await pg.goto(path);
          await expect(pg.getByText(`${balance.toLocaleString("en-IE")} reward points`)).toBeVisible();
          await fitsViewport(pg);
        }
      } finally {
        delete (f.actors as Record<string, unknown>).QA_HOST; // closed below with their browser sessions
        delete (f.actors as Record<string, unknown>).QA_VENDOR;
        await host.close();
        await venue.close();
        await f.connection.execute("DELETE FROM venue_split_agreements WHERE game_id = ?", [game.id]).catch(() => undefined);
        await f.connection.execute("DELETE FROM reward_split_awards WHERE source_ref IN (SELECT ref FROM game_participants WHERE game_id = ?)", [game.id]);
        await restore();
      }
    });
  });
}
