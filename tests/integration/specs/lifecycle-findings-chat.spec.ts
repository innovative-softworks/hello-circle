import { randomUUID } from "node:crypto";
import { expect, personas, env } from "../fixtures";
import { centreFor, clubFor, programFor } from "../stage-b-fixture";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, joinedIds, waitlist, notificationsFor, trackGame } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 7 finding gate HC-QA-022..033. The original failing-before regressions
// are kept unchanged (red before remediation, green after); the *-INVARIANT /
// *-SEMANTICS / *-CROSS-SCOPE cases extend them. Free synthetic data only.

test("HC-QA-022: chat inbox loads when a resident has two conversations with messages", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER"], async f => {
    for (let i = 0; i < 2; i++) {
      const circle = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
      expect((await f.actors.QA_USER.post(`/api/circles/${circle.id}/join`, { data: {} })).status()).toBe(201);
      expect((await f.actors.QA_USER.post(`/api/chat/circle/${circle.id}/messages`, { data: { body: `QA inbox ${i}` } })).status()).toBe(201);
    }
    const inbox = await f.actors.QA_USER.get("/api/chat/mine");
    await evidence("hc-qa-022", { inboxStatus: inbox.status() });
    expect(inbox.status()).toBe(200);
    expect((await inbox.json()).items.length).toBeGreaterThanOrEqual(2);
  });
});

test("HC-QA-022-CROSS-SCOPE: inbox lists every accessible conversation across scopes with latest message, unread and ordering", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST_B", "QA_USER", "QA_USER_B", "QA_VENDOR"], async f => {
    const { QA_HOST_B: organiser, QA_USER: user, QA_USER_B: other } = f.actors;
    const inbox = async (actor: any) => { const r = await actor.get("/api/chat/mine"); expect(r.status()).toBe(200); return (await r.json()) as { items: any[]; unread: number }; };
    // 0 conversations → valid empty response.
    expect((await inbox(other)).items.filter((i: any) => i.lastMessage)).toEqual([]);
    const post = async (actor: any, scope: string, id: string, body: string) => {
      const r = await actor.post(`/api/chat/${scope}/${id}/messages`, { data: { body } });
      expect(r.status(), `${scope} post`).toBe(201);
      await new Promise(res => setTimeout(res, 1100)); // distinct second-resolution timestamps for ordering
    };
    // 1 conversation.
    const c1 = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await user.post(`/api/circles/${c1.id}/join`, { data: {} })).status()).toBe(201);
    await post(user, "circle", c1.id, "QA c1 first");
    expect((await inbox(user)).items.map((i: any) => i.scopeId)).toEqual([c1.id]);
    // Game chat opens 24h before start: schedule ~3h from now (Ireland wall time).
    const start = new Date(Date.now() + 3 * 3600_000);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(start).map(p => [p.type, p.value]));
    const game = await createActivity(f, "QA_HOST_B", { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` });
    expect((await user.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    // Club and program memberships: synthetic cash-marked paid rows (no provider), as in Stage B.
    const club = await clubFor(f, "QA_VENDOR");
    const regRef = `QAR${randomUUID().slice(0, 8).toUpperCase()}`;
    await f.connection.execute(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status, resident_id)
      VALUES (?, ?, ?, 'QA', 'QAChild', 'Synthetic', '2015-01-01', 'QA', 'Guardian', ?, '000', 'QA', 'QA', '000', 'QA', '', 1, 0, 0, 'paid', 'confirmed', ?)`, [regRef, randomUUID(), club, env.QA_USER_EMAIL, personas.QA_USER.id]);
    for (const [t, c] of [["attendance", "ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(t, c, regRef);
    f.track("chat_messages", "scope_id", club); f.track("chat_reads", "scope_id", club);
    const centre = await centreFor(f, "QA_VENDOR");
    const program = await programFor(f, "QA_VENDOR", centre.id);
    await f.connection.execute("INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, resident_id) VALUES (?, ?, ?, 'QA participant', ?, 0, 'paid', ?)", [randomUUID(), program, randomUUID(), env.QA_USER_EMAIL, personas.QA_USER.id]);
    f.track("chat_messages", "scope_id", program); f.track("chat_reads", "scope_id", program);
    const c2 = await createCircle(f, "QA_HOST_B", { joinMode: "open" });
    expect((await user.post(`/api/circles/${c2.id}/join`, { data: {} })).status()).toBe(201);
    // A conversation the user cannot access must never appear.
    const hidden = await createCircle(f, "QA_HOST_B", { joinMode: "invite" });
    await post(organiser, "circle", hidden.id, "QA hidden");
    await post(user, "game", game.id, "QA game msg");
    await post(user, "club", club, "QA club msg");
    await post(user, "program", program, "QA program msg");
    await post(organiser, "circle", c2.id, "QA c2 from organiser");
    await post(organiser, "circle", c1.id, "QA c1 latest from organiser");
    const result = await inbox(user);
    const withMessages = result.items.filter((i: any) => i.lastMessage);
    await evidence("hc-qa-022-cross-scope", { conversations: withMessages.length, scopes: [...new Set(withMessages.map((i: any) => i.scopeType))].sort().join(","), unread: result.unread });
    expect(withMessages.map((i: any) => i.scopeId)).toEqual([c1.id, c2.id, program, club, game.id]); // newest activity first
    expect(withMessages.map((i: any) => i.lastMessage.body)).toEqual(["QA c1 latest from organiser", "QA c2 from organiser", "QA program msg", "QA club msg", "QA game msg"]);
    expect(Object.fromEntries(withMessages.map((i: any) => [i.scopeType + ":" + i.scopeId, i.unread]))).toEqual({ [`circle:${c1.id}`]: 1, [`circle:${c2.id}`]: 1, [`program:${program}`]: 0, [`club:${club}`]: 0, [`game:${game.id}`]: 0 });
    expect(result.unread).toBe(2);
    expect(result.items.map((i: any) => i.scopeId)).not.toContain(hidden.id);
    expect(withMessages.find((i: any) => i.scopeId === c1.id)).toMatchObject({ scopeType: "circle", listingId: c1.id, href: `/circles/${c1.slug}` });
    // Reading a conversation clears its unread state only.
    expect((await user.get(`/api/chat/circle/${c1.id}/messages`)).status()).toBe(200);
    const afterRead = await inbox(user);
    expect(afterRead.unread).toBe(1);
    // Other residents see none of these conversations.
    const otherIds = (await inbox(other)).items.map((i: any) => i.scopeId);
    for (const id of [c1.id, c2.id, game.id, club, program, hidden.id]) expect(otherIds).not.toContain(id);
  });
});
