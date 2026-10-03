import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("VISIBILITY-CLUB: saved sessions respect parent publication without breaking public hydration", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER"], async ({ actors, connection, track, snapshot }) => {
    const club = randomUUID(), session = randomUUID();
    track("clubs", "id", club); track("club_sessions", "id", session); track("favourites", "listing_id", session);
    await connection.execute("INSERT INTO clubs (id,name,sport,area,county,ages,price,unit,trial,ph,blurb,status) VALUES (?,'QA saved club','QA','QA','Dublin','All',0,'session',0,'','QA only','approved')", [club]);
    await connection.execute("INSERT INTO club_sessions (id,club_id,day_of_week,time,label) VALUES (?,?,1,'12:00','QA saved session')", [session,club]);
    await connection.execute("INSERT INTO favourites (resident_id,listing_type,listing_id) VALUES (?,'club_session',?)", [personas.QA_USER.id,session]);
    const unchanged = await snapshot("SELECT * FROM favourites WHERE listing_id = ?", [session]);
    for (const status of ["approved", "pending", "approved"]) {
      await connection.execute("UPDATE clubs SET status = ? WHERE id = ?", [status,club]);
      const response = await actors.QA_USER.get("/api/favourites");
      expect(response.status(), "Saved club sessions must not cause an SQL hydration error").toBe(200);
      expect((await response.json()).some((r: {listingId: string}) => r.listingId === session)).toBe(status === "approved");
      await unchanged();
    }
  });
});

test("VISIBILITY-ADJACENT: saved activity and feed follow canonical visibility after state changes", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async ({ actors, connection, track, snapshot }) => {
    const input = { activityLabel: `QA visibility ${randomUUID()}`, date: "2030-06-20", time: "12:00", capacity: 5, locationText: "QA only", lifecycle: "draft", priceCents: 0 };
    const created = await actors.QA_HOST.post("/api/games", { data: input });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"], ["favourites", "listing_id"]]) track(table, column, id);
    for (const actor of Object.values(actors)) expect((await actor.post("/api/favourites", { data: { listingType: "game", listingId: id } })).status()).toBe(201);
    const relationUnchanged = await snapshot("SELECT * FROM favourites WHERE listing_id = ? ORDER BY resident_id", [id]);
    const [follow] = await connection.execute<any>("INSERT INTO follows (resident_id, followed_type, followed_id) VALUES (?, 'host', ?)", [personas.QA_USER_B.id, personas.QA_HOST.id]);
    track("follows", "id", follow.insertId);
    const states = [
      { lifecycle: "draft", visibility: "public", status: "open", publish: null, date: "2030-06-20", other: false },
      { lifecycle: "active", visibility: "public", status: "open", publish: null, date: "2030-06-20", other: true },
      { lifecycle: "active", visibility: "invite", status: "open", publish: null, date: "2030-06-20", other: false },
      { lifecycle: "draft", visibility: "public", status: "open", publish: null, date: "2030-06-20", other: false },
      { lifecycle: "active", visibility: "public", status: "open", publish: "2031-01-01 00:00:00", date: "2030-06-20", other: false },
      { lifecycle: "archived", visibility: "public", status: "open", publish: null, date: "2030-06-20", other: true },
      { lifecycle: "active", visibility: "public", status: "cancelled", publish: null, date: "2030-06-20", other: true },
      { lifecycle: "draft", visibility: "public", status: "open", publish: null, date: "2020-01-01", other: false },
    ];
    for (const state of states) {
      await connection.execute("UPDATE games SET lifecycle=?, visibility=?, status=?, publish_at=?, date=? WHERE id=? AND host_resident_id=?", [state.lifecycle, state.visibility, state.status, state.publish, state.date, id, personas.QA_HOST.id]);
      for (const [role, visible] of [["QA_HOST", true], ["QA_USER_B", state.other]] as const) {
        expect((await actors[role].get(`/api/games/${id}`)).status()).toBe(visible ? 200 : 404);
        const saved = await (await actors[role].get("/api/favourites")).json();
        expect(saved.some((r: { listingId: string }) => r.listingId === id)).toBe(visible);
      }
      const feed = await (await actors.QA_USER_B.get("/api/follows/feed")).json();
      if (!state.other) expect(feed.some((r: { id: string }) => r.id === id)).toBe(false);
      await relationUnchanged();
    }
    await connection.execute("DELETE FROM games WHERE id = ? AND host_resident_id = ?", [id, personas.QA_HOST.id]);
    expect((await actors.QA_USER_B.get(`/api/games/${id}`)).status()).toBe(404);
    expect((await (await actors.QA_USER_B.get("/api/favourites")).json()).some((r: { listingId: string }) => r.listingId === id)).toBe(false);
    await relationUnchanged();
  });
});
