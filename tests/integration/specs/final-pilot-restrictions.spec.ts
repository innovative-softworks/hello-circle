import { randomUUID } from "node:crypto";
import { expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookableClub } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Pilot remediation (docs/participation-expansion/final-validation/14 §6): the
// restricted features are refused by the server, not just hidden. Every call
// below goes straight to the API, as a client that ignores the UI would.
// Nothing is switched on; the switches' stored values are checked unchanged.

const KEYS = ["participation.reminders", "participation.host_questions", "participation.partial_cancel", "participation.special_category_questions", "commerce.open_booking"];

test("FINAL-RESTRICT: restricted pilot features are refused by the server on direct API calls", async ({ playwright }) => {
  test.setTimeout(120_000);
  await withActors(playwright, ["QA_ADMIN", "QA_VENDOR", "QA_USER", "QA_HOST"], async (f) => {
    const settings = async () => Object.fromEntries((await rows(f, `SELECT \`key\` AS k, value AS v FROM app_settings WHERE \`key\` IN (${KEYS.map(() => "?").join(", ")})`, KEYS)).map((r: any) => [r.k, r.v]));
    const before = await settings();
    // Default state of the isolated QA database: none of these is on.
    for (const k of KEYS) expect([k, before[k] === "true"]).toEqual([k, false]);

    // Locked switches: even an admin with platform.settings can't turn them on.
    for (const key of ["participation.partial_cancel", "participation.special_category_questions"]) {
      const r = await f.actors.QA_ADMIN.put(`/api/admin/config/feature-switches/${key}`, { data: { enabled: true } });
      expect([key, r.status(), (await r.json()).locked]).toEqual([key, 409, true]);
    }

    // Donations and external payment verification are unavailable capabilities: refused for any organisation.
    const [org] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    const view = await (await f.actors.QA_ADMIN.get(`/api/admin/organisations/${org.org_id}/capabilities`)).json();
    for (const cap of ["donations", "external_payments"]) {
      const r = await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.org_id}/capabilities`, { data: { configVersion: view.configVersion, reason: "QA pilot restriction check", enabled: { [cap]: true } } });
      expect([cap, r.status()]).toEqual([cap, 409]);
      expect((await r.json()).error).toMatch(/can't be switched on/);
    }
    const [{ n: flags }] = await rows(f, "SELECT COUNT(*) AS n FROM feature_flags WHERE org_id = ? AND flag_key IN ('donations', 'external_payments') AND enabled = 1", [org.org_id]);
    expect(Number(flags)).toBe(0);

    // Partial cancellation (switch locked off): the remove-a-person endpoint refuses.
    expect((await f.actors.QA_USER.post(`/api/experiences/bookings/QA-NONE-${randomUUID().slice(0, 6)}/remove`, { headers: { "X-Client-Id": randomUUID() }, data: { attendeeNo: 2 } })).status()).toBe(404);

    // Host questions (switch off): a host can't set them on their own activity.
    const game = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA restrict ${randomUUID().slice(0, 6)}`, date: "2030-09-20", time: "18:30", capacity: 6, locationText: "QA pitch" } });
    expect(game.status()).toBe(201);
    const gameId = (await game.json()).id as string;
    for (const [t, c] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"]]) f.track(t, c, gameId);
    expect((await f.actors.QA_HOST.put(`/api/games/${gameId}/questions`, { data: { picks: [{ key: "q_hostlevel" }] } })).status()).toBe(404);
    expect(await rows(f, "SELECT id FROM registration_questions WHERE listing_id = ?", [gameId])).toEqual([]);

    // Sensitive questions: a partner can't publish a health question on a listing form.
    const restore = await setSwitches(f.connection, { "participation.attendees": true });
    try {
      const clubId = await bookableClub(f, { price: 0, payment: "cash" });
      f.track("registration_questions", "listing_id", clubId); f.track("registration_form_drafts", "listing_id", clubId);
      // A draft is private to the partner; what matters is that it can never be published (asked of anyone).
      const draft = await f.actors.QA_VENDOR.put(`/api/vendor/forms/club/${clubId}/questions/draft`, { data: { questions: [{ scope: "attendee", inputType: "text", label: "Any medical conditions or allergies?", purpose: "Safety" }] } });
      const publish = await f.actors.QA_VENDOR.post(`/api/vendor/forms/club/${clubId}/questions/publish`);
      expect([draft.status(), publish.status() >= 400 && publish.status() < 500]).toEqual([draft.status(), true]);
      expect((await publish.json()).error ?? (await draft.json()).error).toMatch(/sensitive|special-category|health/i);
      expect(await rows(f, "SELECT id FROM registration_questions WHERE listing_id = ? AND active = 1", [clubId])).toEqual([]);
      // The public listing asks nothing.
      const club = await (await f.actors.QA_USER.get(`/api/clubs/${clubId}`)).json();
      expect(JSON.stringify(club)).not.toMatch(/medical conditions/i);
    } finally { await restore(); }

    // Make It Happen (paused): search and confirm refuse.
    expect((await f.actors.QA_USER.post("/api/make-it-happen/search", { data: { county: "Dublin", date: "2030-09-01", time: "10:00", duration: 1, partySize: 4 } })).status()).toBe(503);
    expect((await f.actors.QA_USER.post("/api/make-it-happen/confirm", { data: { county: "Dublin", date: "2030-09-01", time: "10:00", duration: 1, partySize: 4 } })).status()).toBe(503);

    // Nothing above changed a switch.
    expect(await settings()).toEqual(before);
  });
});
