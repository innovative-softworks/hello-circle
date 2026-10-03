import { randomUUID } from "node:crypto";
import { test, expect } from "../fixtures";
import { evidence, withActors } from "../authorization-fixture";

test("IDOR-LEAKAGE: saved-item hydration must not expose another host's private draft", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async ({ actors, track, snapshot }) => {
    const title = `QA confidential draft ${randomUUID()}`;
    const created = await actors.QA_HOST.post("/api/games", { data: { activityLabel: title, date: "2030-06-20", time: "12:00", capacity: 5, locationText: "QA private venue", lifecycle: "draft", visibility: "invite", priceCents: 0 } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    track("games", "id", id);
    track("game_participants", "game_id", id);
    track("listing_attributes", "listing_id", id);
    track("favourites", "listing_id", id);
    const unchanged = await snapshot("SELECT * FROM games WHERE id = ?", [id]);
    const denied = await actors.QA_USER_B.get(`/api/games/${id}`);
    expect(denied.status()).toBe(404);
    const saved = await actors.QA_USER_B.post("/api/favourites", { data: { listingType: "game", listingId: id } });
    const listed = await actors.QA_USER_B.get("/api/favourites");
    expect(listed.status()).toBe(200);
    const entry = (await listed.json()).find((row: { listingId: string }) => row.listingId === id);
    const leaked = !!entry && (entry.name === title || !!entry.subtitle || !!entry.imageUrl);
    await unchanged();
    await evidence("hc-qa-005", { directDetailStatus: denied.status(), saveStatus: saved.status(), listStatus: listed.status(), confidentialTitleExposed: entry?.name === title, scheduleExposed: !!entry?.subtitle, victimResourceUnchanged: true });
    expect(leaked, "Knowing an ID must not reveal a protected draft through saved-item hydration").toBe(false);
  });
});
