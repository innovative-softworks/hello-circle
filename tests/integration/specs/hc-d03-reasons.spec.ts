import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, env, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { mailTo } from "../product-fixture";

// D-03 (approved for local implementation 2026-10-14) — decision reasons on
// existing moderation actions, against the real server and the isolated QA
// database. Emails go to the QA backend's in-memory sink (recipient + subject
// only, never bodies); nothing reaches a real inbox.
// Logins in this batch (real limiter of 10 per IP): 3 personas + 2 suspended
// sign-in attempts = 5. The browser checks are hc-d03-ui.spec.ts.

const NOTE = "INTERNAL-NOTE-MARKER do not show to partners";
const listingReason = { reasonCategory: "misleading", explanation: "The photos show a different building to the one at this address.", internalNote: NOTE };

test("D03-API: reasons are required, recorded append-only, shown to the affected person without the internal note", async ({ playwright, request }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN", "QA_VENDOR", "QA_VENDOR_B"], async (f) => {
      const admin = f.actors.QA_ADMIN, vendor = f.actors.QA_VENDOR;

      // --- listing rejection -------------------------------------------------
      const created = await vendor.post("/api/vendor/centres", { data: { name: `QA D-03 ${randomUUID()}`, paymentMethod: "cash" } });
      expect(created.status()).toBe(201);
      const centreId = (await created.json()).id as string;
      for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "listing_id"]]) f.track(t, c, centreId);
      expect((await vendor.put(`/api/vendor/centres/${centreId}`, { data: { area: "Rathmines", county: "Dublin", blurb: "D-03 centre" } })).status()).toBe(200);
      expect((await vendor.post(`/api/vendor/centres/${centreId}/publish`)).status()).toBe(200);
      const centreStatus = async () => (await f.connection.query<any[]>("SELECT status FROM centres WHERE id = ?", [centreId]))[0][0].status;
      const decisions = async (id: string) => (await f.connection.query<any[]>("SELECT action, reason_category, explanation, internal_note FROM moderation_decisions WHERE object_id = ? ORDER BY id", [id]))[0];

      for (const bad of [{}, { reasonCategory: "misleading" }, { ...listingReason, explanation: "too short" }, { ...listingReason, reasonCategory: "payment_risk" }, { ...listingReason, internalNote: "n".repeat(4001) }]) {
        expect((await admin.put(`/api/admin/centres/${centreId}/status`, { data: { status: "rejected", ...bad } })).status(), JSON.stringify(bad).slice(0, 60)).toBe(400);
      }
      expect(await centreStatus()).toBe("pending");
      expect(await decisions(centreId)).toEqual([]);

      expect((await admin.put(`/api/admin/centres/${centreId}/status`, { data: { status: "rejected", ...listingReason } })).status()).toBe(200);
      expect(await centreStatus()).toBe("rejected");
      expect((await decisions(centreId)).map((d: any) => [d.action, d.reason_category, d.explanation, d.internal_note])).toEqual([["listing.rejected", "misleading", listingReason.explanation, NOTE]]);

      // Audit entry links the decision; the note is not copied into the audit log.
      const [[audit]] = await f.connection.query<any[]>("SELECT new_value FROM audit_log WHERE object_id = ? AND action = 'centre.status_changed' ORDER BY id DESC LIMIT 1", [centreId]);
      expect(JSON.parse(audit.new_value).decisionId).toBeTruthy();
      expect(audit.new_value).not.toContain("INTERNAL-NOTE-MARKER");

      // Partner sees category + explanation, never the note; another partner can't read it.
      const mine = await vendor.get(`/api/vendor/decisions/centre/${centreId}`);
      expect(mine.status()).toBe(200);
      const mineText = await mine.text();
      expect(JSON.parse(mineText).latest).toMatchObject({ action: "listing.rejected", category: "misleading", explanation: listingReason.explanation });
      expect(mineText).not.toContain("INTERNAL-NOTE-MARKER");
      expect((await f.actors.QA_VENDOR_B.get(`/api/vendor/decisions/centre/${centreId}`)).status()).toBe(403);

      // Workspace notice + email (QA sink: recipient and subject only).
      const [notes] = await f.connection.query<any[]>("SELECT kind, body FROM notifications WHERE recipient_id = ? AND listing_id = ? AND kind = 'moderation'", [personas.QA_VENDOR.id, centreId]);
      expect(notes.length).toBe(1);
      expect(notes[0].body).toContain(listingReason.explanation);
      expect(notes[0].body).not.toContain("INTERNAL-NOTE-MARKER");
      expect((await mailTo(request, env.QA_VENDOR_EMAIL)).some((m) => /wasn't approved/.test(m.subject))).toBe(true);

      // Admin history: the note only for roles allowed to see it (finance isn't).
      const history = await (await admin.get(`/api/admin/decisions?objectType=centre&objectId=${centreId}`)).json();
      expect(history.includesInternalNotes).toBe(true);
      expect(history.decisions[0].internalNote).toBe(NOTE);

      // Resubmit and reject again: the first decision stays unchanged (append-only).
      expect((await vendor.post(`/api/vendor/centres/${centreId}/publish`)).status()).toBe(200);
      expect((await admin.put(`/api/admin/centres/${centreId}/status`, { data: { status: "rejected", reasonCategory: "incomplete", explanation: "Opening hours are still missing after the update." } })).status()).toBe(200);
      const all = await decisions(centreId);
      expect(all.map((d: any) => d.action)).toEqual(["listing.rejected", "listing.rejected"]);
      expect(all[0].explanation).toBe(listingReason.explanation);
      expect((await (await vendor.get(`/api/vendor/decisions/centre/${centreId}`)).json()).latest.category).toBe("incomplete");

      // The same rejection sent again changes nothing (no second decision or notice);
      // two identical rejections at once on a fresh pending listing record one.
      const noticeCount = async (id: string) => Number((await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM notifications WHERE listing_id = ? AND kind = 'moderation'", [id]))[0][0].n);
      const repeat = { status: "rejected", reasonCategory: "incomplete", explanation: "Opening hours are still missing after the update." };
      expect((await admin.put(`/api/admin/centres/${centreId}/status`, { data: repeat })).status()).toBe(200);
      expect((await decisions(centreId)).length).toBe(2);
      expect(await noticeCount(centreId)).toBe(2);
      const second = await vendor.post("/api/vendor/centres", { data: { name: `QA D-03 race ${randomUUID()}`, paymentMethod: "cash" } });
      const raceId = (await second.json()).id as string;
      for (const [t, c] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "listing_id"]]) f.track(t, c, raceId);
      expect((await vendor.put(`/api/vendor/centres/${raceId}`, { data: { area: "Rathmines", county: "Dublin", blurb: "D-03 race" } })).status()).toBe(200);
      expect((await vendor.post(`/api/vendor/centres/${raceId}/publish`)).status()).toBe(200);
      const both = await Promise.all([1, 2].map(() => admin.put(`/api/admin/centres/${raceId}/status`, { data: { status: "rejected", ...listingReason } })));
      expect(both.map((r) => r.status())).toEqual([200, 200]);
      expect((await decisions(raceId)).length, "one decision for two identical concurrent rejections").toBe(1);
      expect(await noticeCount(raceId), "one partner notice").toBe(1);

      // A listing rejected before reasons existed has no decision: "No reason recorded", never a made-up one.
      const oldId = randomUUID();
      await f.connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, vendor_id, created_at) VALUES (?, 'QA old rejection', 'QA', 'Dublin', 0, 0, 0, 0, '', '', '', 'QA', 'rejected', ?, NOW())", [oldId, personas.QA_VENDOR.id]);
      f.track("centres", "id", oldId);
      expect((await (await vendor.get(`/api/vendor/decisions/centre/${oldId}`)).json()).latest).toBeNull();

      // --- partner suspension and reinstatement ------------------------------
      const ownerId = randomUUID(), password = randomBytes(24).toString("hex"), ownerEmail = `qa_d03_owner_${ownerId}@example.test`;
      await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, ?, 'vendor', 'approved', 'QA D-03 partner')", [ownerId, ownerEmail, bcrypt.hashSync(password, 10)]);
      for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "recipient_id"]]) f.track(t, c, ownerId);
      expect((await admin.put(`/api/admin/vendors/${ownerId}/status`, { data: { status: "suspended" } })).status()).toBe(400);
      expect((await f.connection.query<any[]>("SELECT status FROM users WHERE id = ?", [ownerId]))[0][0].status).toBe("approved");
      const suspension = { status: "suspended", reasonCategory: "payment_risk", explanation: "Several card payments for your sessions were disputed this month.", internalNote: NOTE };
      expect((await admin.put(`/api/admin/vendors/${ownerId}/status`, { data: suspension })).status()).toBe(200);
      // Suspending again is an idempotent 200: no second decision or email.
      expect((await admin.put(`/api/admin/vendors/${ownerId}/status`, { data: suspension })).status()).toBe(200);
      expect((await decisions(ownerId)).length).toBe(1);
      expect((await mailTo(request, ownerEmail)).filter((m) => /suspended/.test(m.subject)).length).toBe(1);
      const login = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      opened.push(login);
      // A wrong password never reveals the decision; the right one shows category + explanation only.
      const wrong = await login.post("/api/auth/login", { data: { email: ownerEmail, password: "not-the-password" } });
      expect(wrong.status()).toBe(401);
      expect(await wrong.text()).not.toContain("disputed");
      // Without signing in there is no way to read it either.
      expect((await login.get("/api/auth/account-decision")).status()).toBe(401);
      const right = await login.post("/api/auth/login", { data: { email: ownerEmail, password } });
      expect(right.status()).toBe(403);
      const rightText = await right.text();
      expect(JSON.parse(rightText)).toMatchObject({ suspended: true, decision: { category: "payment_risk", explanation: suspension.explanation } });
      expect(rightText).not.toContain("INTERNAL-NOTE-MARKER");
      expect((await mailTo(request, ownerEmail)).map((m) => m.subject)).toContain("Your HelloCircle partner account has been suspended");
      expect((await admin.put(`/api/admin/vendors/${ownerId}/status`, { data: { status: "approved", explanation: "Thanks for sorting out the disputed payments with your bank." } })).status()).toBe(200);
      expect((await decisions(ownerId)).map((d: any) => d.action)).toEqual(["partner.suspended", "partner.reinstated"]);
      // The reinstatement notice is sent after the response (fire-and-forget,
      // by design), so wait for it to arrive instead of reading the outbox once.
      await expect.poll(async () => (await mailTo(request, ownerEmail)).map((m) => m.subject), { timeout: 10_000 }).toContain("Your HelloCircle partner account has been reinstated");

      // --- host application, claim and place suggestion -----------------------
      const residentId = `qa-d03-${randomUUID()}`;
      await f.connection.execute("INSERT INTO residents (id, email, name, host_status, host_applied_at) VALUES (?, ?, 'QA D-03 applicant', 'pending', NOW())", [residentId, `${residentId}@example.test`]);
      for (const [t, c] of [["residents", "id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "resident_id"]]) f.track(t, c, residentId);
      expect((await admin.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "rejected" } })).status()).toBe(400);
      expect((await admin.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "rejected", reasonCategory: "incomplete", explanation: "Please tell us a little about the sessions you host.", internalNote: NOTE } })).status()).toBe(200);
      // A repeat finds nothing pending: no second decision or notice.
      expect((await admin.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "rejected", reasonCategory: "incomplete", explanation: "Please tell us a little about the sessions you host." } })).status()).toBe(404);
      expect((await decisions(residentId)).length).toBe(1);
      const [residentNotes] = await f.connection.query<any[]>("SELECT kind, listing_type, body FROM notifications WHERE resident_id = ?", [residentId]);
      expect(residentNotes.map((n: any) => [n.kind, n.listing_type])).toEqual([["moderation", "host"]]);
      expect(residentNotes[0].body).toContain("sessions you host");
      expect(residentNotes[0].body).not.toContain("INTERNAL-NOTE-MARKER");
      expect((await mailTo(request, `${residentId}@example.test`)).map((m) => m.subject)).toContain("Your Verified Host application");

      const claimCentre = randomUUID();
      await f.connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, created_at) VALUES (?, 'QA D-03 claimable', 'QA', 'Dublin', 0, 0, 0, 0, '', '', '', 'QA', 'approved', NOW())", [claimCentre]);
      const [claim] = await f.connection.execute<any>("INSERT INTO listing_claims (listing_type, listing_id, vendor_id, message) VALUES ('centre', ?, ?, 'QA D-03 claim')", [claimCentre, personas.QA_VENDOR.id]);
      const claimId = String(claim.insertId);
      for (const [t, c, id] of [["centres", "id", claimCentre], ["listing_claims", "listing_id", claimCentre], ["audit_log", "object_id", claimCentre], ["moderation_decisions", "object_id", claimId], ["notifications", "listing_id", claimCentre]] as const) f.track(t, c, id);
      expect((await admin.put(`/api/admin/claims/${claimId}/status`, { data: { status: "rejected" } })).status()).toBe(400);
      const claimReason = { status: "rejected", reasonCategory: "ineligible", explanation: "We couldn't confirm that your organisation runs this hall." };
      expect((await admin.put(`/api/admin/claims/${claimId}/status`, { data: claimReason })).status()).toBe(200);
      // Lifecycle unchanged: an already-decided claim can't be decided again.
      expect((await admin.put(`/api/admin/claims/${claimId}/status`, { data: claimReason })).status()).toBe(409);
      expect((await decisions(claimId)).map((d: any) => d.action)).toEqual(["claim.rejected"]);

      const clientId = randomUUID(), suggestionId = `qa-d03-sugg-${randomUUID()}`;
      await f.connection.execute("INSERT INTO place_suggestions (id, client_id, suggested_name, category, area, county, description, contact_info) VALUES (?, ?, 'QA D-03 suggestion', 'centre', 'QA', 'Cork', 'QA', '')", [suggestionId, clientId]);
      for (const [t, c] of [["place_suggestions", "id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"]]) f.track(t, c, suggestionId);
      expect((await admin.put(`/api/admin/place-suggestions/${suggestionId}/status`, { data: { status: "rejected" } })).status()).toBe(400);
      // Two admins rejecting at once: one decision, the other is told it's already reviewed.
      const suggestionRace = await Promise.all([1, 2].map(() => admin.put(`/api/admin/place-suggestions/${suggestionId}/status`, { data: { status: "rejected", reasonCategory: "duplicate", explanation: "This hall is already listed under its parish name.", internalNote: NOTE } })));
      expect(suggestionRace.map((r) => r.status()).sort()).toEqual([200, 409]);
      expect((await decisions(suggestionId)).length).toBe(1);
      const suggester = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL, extraHTTPHeaders: { "X-Client-Id": clientId } });
      opened.push(suggester);
      const mineList = await suggester.get("/api/place-suggestions/mine");
      const mineListText = await mineList.text();
      expect(JSON.parse(mineListText)[0]).toMatchObject({ id: suggestionId, status: "rejected", decision: { category: "duplicate", explanation: "This hall is already listed under its parish name." } });
      expect(mineListText).not.toContain("INTERNAL-NOTE-MARKER");

      await evidence("d03-api", { validationRejects: 5, listingDecisions: all.length, suspensionDecisionShownAfterPassword: 403, claimRedecide: 409 });
    });
  } finally { for (const c of opened) await c.dispose(); }
});
