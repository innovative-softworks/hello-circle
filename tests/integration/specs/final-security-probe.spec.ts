import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { env, expect, personas } from "../fixtures";
import { test, withActors, rows } from "../lifecycle-fixture";
import { staffActor } from "../lifecycle-ui-fixture";
import { bookableClub } from "../booking-fixture";
import { setSwitches } from "../revenue-fixture";

// Final validation (docs/participation-expansion/final-validation/04): direct
// API probes of the endpoints added in Phases H–O, without the UI. One
// registration of QA_USER on a QA_VENDOR club carries a formula-shaped and a
// script-shaped answer; every other caller is refused, the CSV neutralises
// the formula and the partner page shows the script as text.

const FORMULA = '=HYPERLINK("https://example.test","x")';
const SCRIPT = "<img src=x onerror=window.__hcXss=1>";

test("FINAL-SEC: new participation endpoints refuse other people, roles and stale sessions; exports and pages neutralise injected answers", async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  await withActors(playwright, ["GUEST", "QA_VENDOR", "QA_VENDOR_B", "QA_USER", "QA_USER_B", "QA_HOST", "QA_HOST_B"], async (f) => {
    const restoreSwitches = await setSwitches(f.connection, { "participation.attendees": true });
    try {
      const clubId = await bookableClub(f, { price: 0, payment: "cash" });
      for (const [t, c] of [["registration_questions", "listing_id"], ["registration_form_drafts", "listing_id"], ["audit_log", "object_id"]]) f.track(t, c, clubId);
      const vendor = f.actors.QA_VENDOR;
      const Q = `/api/vendor/forms/club/${clubId}/questions`;
      const question = { scope: "booking", inputType: "text", label: "Team name", purpose: "Printed on the bib", exportable: true };
      expect((await vendor.put(`${Q}/draft`, { data: { questions: [question] } })).status()).toBe(200);
      const published = await vendor.post(`${Q}/publish`);
      expect(published.status()).toBe(200);
      const form = (await published.json()) as { version: number; questions: { key: string }[] };
      const [me] = await rows(f, "SELECT email FROM residents WHERE id = ?", [personas.QA_USER.id]);
      const reg = await f.actors.QA_USER.post("/api/registrations/checkout", {
        headers: { "X-Client-Id": randomUUID() },
        data: {
          clubId, registrantType: "adult", childFirst: "QA", childLast: `Sec${randomUUID().slice(0, 4)}`, gFirst: "QA", gLast: "Adult", email: String(me.email), phone: "000", address: "QA",
          consent: true, trial: false, acceptedTerms: true, questionsVersion: form.version, answers: { booking: { [form.questions[0].key]: FORMULA } },
        },
      });
      expect(reg.status()).toBe(201);
      const ref = (await reg.json()).ref as string;
      for (const [t, c] of [["registration_answers", "source_ref"], ["order_acknowledgements", "source_ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(t, c, ref);
      const record = `/api/vendor/orders/registration/${ref}`;

      // Authentication: none, forged, expired.
      for (const path of [record, "/api/vendor/reports/participation", `${Q}`, "/api/vendor/messages"]) expect([path, (await f.actors.GUEST.get(path)).status()]).toEqual([path, 401]);
      const forged = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, extraHTTPHeaders: { Cookie: `hello_circle_session=${randomBytes(32).toString("hex")}` } });
      try { expect((await forged.get(record)).status()).toBe(401); } finally { await forged.dispose(); }

      // The resident's own record; another resident gets nothing.
      expect((await f.actors.QA_USER.get(`/api/orders/registration/${ref}/registration`)).status()).toBe(200);
      expect((await f.actors.QA_USER_B.get(`/api/orders/registration/${ref}/registration`)).status()).toBe(404);
      expect((await f.actors.QA_USER_B.put(`/api/orders/registration/${ref}/answers`, { data: { questionsVersion: form.version, answers: { booking: { [form.questions[0].key]: "hijack" } } } })).status()).toBe(404);

      // Another organisation: record, notes, answers, export, audience, messages.
      const other = f.actors.QA_VENDOR_B;
      expect((await other.get(record)).status()).toBe(404);
      expect((await other.post(`${record}/notes`, { data: { body: "probe" } })).status()).toBe(404);
      expect([403, 404]).toContain((await other.get(`/api/vendor/forms/club/${clubId}/answers`)).status());
      expect([403, 404]).toContain((await other.get(`/api/vendor/forms/club/${clubId}/answers.csv`)).status());
      expect([403, 404]).toContain((await other.put(`${Q}/draft`, { data: { questions: [question] } })).status());
      expect((await other.post("/api/vendor/messages/preview", { data: { audience: { listingType: "club", listingId: clubId } } })).status()).toBe(403);
      expect((await other.post("/api/vendor/messages", { data: { audience: { listingType: "club", listingId: clubId }, subject: "probe", body: "probe" } })).status()).toBe(403);
      expect(JSON.stringify(await (await other.get("/api/vendor/reports/participation")).json())).not.toContain(clubId);

      // A partner can't switch on its own capabilities (admin-only route).
      const [org] = await rows(f, "SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      expect([401, 403]).toContain((await vendor.put(`/api/admin/organisations/${org.org_id}/capabilities`, { data: { capabilities: { events: true } } })).status());

      // Staff of the same organisation, by role.
      const member = async (role: string) => {
        const id = randomUUID(), password = randomBytes(24).toString("hex"), email = `qa_sec_${role}_${id.slice(0, 6)}@example.test`;
        await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id, platform_role, invited_staff) VALUES (?, ?, ?, 'vendor', 'approved', ?, ?, ?, 1)", [id, email, bcrypt.hashSync(password, 10), `QA Sec ${role}`, org.org_id, role]);
        f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
        const actor = await staffActor(browser, `QA_SEC_${role}`, { credentials: { email, password } });
        expect((await actor.context.request.post("/api/auth/accept-terms", { data: { termsAccepted: true } })).status()).toBe(200);
        return { id, actor, api: actor.context.request };
      };
      const analyst = await member("read_only_analyst");
      try {
        expect((await analyst.api.get("/api/vendor/reports/participation")).status()).toBe(200);
        expect((await analyst.api.put(`${Q}/draft`, { data: { questions: [question] } })).status()).toBe(403);
        expect((await analyst.api.post(`${Q}/publish`)).status()).toBe(403);
        expect((await analyst.api.post(`${record}/notes`, { data: { body: "probe" } })).status()).toBe(403);
        expect((await analyst.api.post("/api/vendor/messages", { data: { audience: { listingType: "club", listingId: clubId }, subject: "probe", body: "probe" } })).status()).toBe(403);
        expect((await analyst.api.get(`/api/vendor/forms/club/${clubId}/answers.csv`)).status()).toBe(403);
        // Session revocation: an expired session stops working at once; a suspended account too.
        await f.connection.execute("UPDATE sessions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?", [analyst.id]);
        expect((await analyst.api.get("/api/vendor/reports/participation")).status()).toBe(401);
      } finally { await analyst.actor.close(); }
      const door = await member("checkin_staff");
      try {
        for (const path of ["/api/vendor/earnings", "/api/vendor/reports/participation", record]) expect([path, (await door.api.get(path)).status()]).toEqual([path, 403]);
        expect((await door.api.post("/api/vendor/messages/preview", { data: { audience: { listingType: "club", listingId: clubId } } })).status()).toBe(403);
        await f.connection.execute("UPDATE users SET status = 'suspended' WHERE id = ?", [door.id]);
        expect((await door.api.get("/api/vendor/door")).status()).toBe(403);
      } finally { await door.actor.close(); }

      // Resident hosts: another host can't manage, read answers or set questions.
      const created = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA Sec ${randomUUID().slice(0, 6)}`, date: "2030-08-15", time: "18:30", capacity: 6, locationText: "QA pitch" } });
      expect(created.status()).toBe(201);
      const gameId = (await created.json()).id as string;
      for (const [t, c] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"], ["registration_questions", "listing_id"]]) f.track(t, c, gameId);
      expect((await f.actors.QA_HOST_B.get(`/api/games/${gameId}/participants/manage`)).status()).toBe(403);
      expect((await f.actors.QA_HOST_B.put(`/api/games/${gameId}/questions`, { data: { picks: [{ key: "q_hostlevel" }] } })).status()).toBe(403);

      // Export: the formula is neutralised; the export is audited without values.
      const csv = await vendor.get(`/api/vendor/forms/club/${clubId}/answers.csv`);
      expect(csv.status()).toBe(200);
      const text = await csv.text();
      expect(text).not.toMatch(/(^|,)"=/m);
      expect(text).toContain(`"'=HYPERLINK`);
      const [audit] = await rows(f, "SELECT new_value FROM audit_log WHERE action = 'club.answers_exported' AND object_id = ? ORDER BY created_at DESC LIMIT 1", [clubId]);
      expect(audit).toBeTruthy();
      expect(String(audit.new_value)).not.toContain("HYPERLINK");

      // A script-shaped answer is stored as text and shown as text to the partner.
      expect((await f.actors.QA_USER.put(`/api/orders/registration/${ref}/answers`, { data: { questionsVersion: form.version, answers: { booking: { [form.questions[0].key]: SCRIPT } } } })).status()).toBe(200);
      const owner = await staffActor(browser, "QA_VENDOR");
      try {
        let dialogs = 0;
        owner.page.on("dialog", (d) => { dialogs++; void d.dismiss(); });
        await owner.page.goto(`/vendor/orders/registration/${ref}`);
        await expect(owner.page.getByText(SCRIPT, { exact: true })).toBeVisible({ timeout: 15_000 });
        expect(await owner.page.evaluate(() => (window as unknown as { __hcXss?: number }).__hcXss ?? 0)).toBe(0);
        expect(dialogs).toBe(0);
      } finally { await owner.close(); }

      // Make It Happen stays paused: its direct API refuses, with or without answers, and books nothing.
      const [mih] = await rows(f, "SELECT value FROM app_settings WHERE `key` = 'commerce.open_booking'", []);
      expect(mih?.value === "true").toBe(false);
      const [hall] = await rows(f, "SELECT c.id AS centreId, r.id AS roomId FROM centres c JOIN rooms r ON r.centre_id = c.id WHERE c.status = 'approved' AND r.active = 1 LIMIT 1", []);
      const before = (await rows(f, "SELECT COUNT(*) AS n FROM bookings", []))[0].n;
      expect((await f.actors.QA_USER.post("/api/make-it-happen/search", { data: { county: "Dublin", date: "2030-09-01", time: "10:00", duration: 1, partySize: 4 } })).status()).toBe(503);
      expect((await f.actors.QA_USER.post("/api/make-it-happen/confirm", { data: { county: "Dublin", date: "2030-09-01", time: "10:00", duration: 1, partySize: 4, centreId: hall?.centreId, roomId: hall?.roomId, name: "QA", email: String(me.email), phone: "0", questionsVersion: 1, answers: { booking: {} } } })).status()).toBe(503);
      expect((await rows(f, "SELECT COUNT(*) AS n FROM bookings", []))[0].n).toBe(before);

      // Error responses don't echo internals.
      const odd = await vendor.get(`/api/vendor/orders/registration/${encodeURIComponent("x' OR 1=1 --")}`);
      expect([400, 404]).toContain(odd.status());
      expect(await odd.text()).not.toMatch(/SELECT|stack|at \w+ \(|ER_/);
    } finally {
      await restoreSwitches();
    }
  });
});
