import { randomBytes, randomUUID } from "node:crypto";
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { assertNoLeak } from "../stage-b-fixture";

// Synthetic canaries only: never real credentials. Each canary is a random
// value unknown to the application; any reflection in a response body or
// header is a disclosure. Also rejects SQL/stack/filesystem/provider detail.

test("STAGE-B-ERRORS: authentication, authorization and exception paths never echo secrets or internals", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "GUEST"], async (f) => {
    const canary = `qacanary${randomBytes(12).toString("hex")}`;
    const inspect = async (label: string, response: APIResponse, extra: string[] = []) => {
      const headers = JSON.stringify(response.headers());
      const body = await response.text();
      await assertNoLeak(`${headers}\n${body}`, [canary, ...extra]);
      expect(response.status(), label).toBeGreaterThanOrEqual(400);
      return response.status();
    };
    const G = f.actors.GUEST;
    const statuses: Record<string, number> = {};
    statuses.vendorLogin = await inspect("vendor login", await G.post("/api/auth/login", { data: { email: `${canary}@example.test`, password: canary } }));
    statuses.residentLogin = await inspect("resident login", await G.post("/api/guest/login", { data: { email: `${canary}@example.test`, password: canary } }));
    expect((await G.storageState()).cookies.length, "Failed logins set no cookie").toBe(0);
    const bearer = { headers: { Authorization: `Bearer ${canary}`, Cookie: `hello_circle_session=${canary}; hello_circle_guest_session=${canary}`, "X-Client-Id": canary } };
    for (const [label, path] of [["vendor", "/api/vendor/listings"], ["admin", "/api/admin/vendors"], ["resident", "/api/residents/me/receipts"], ["org", "/api/vendor/org"]]) {
      statuses[`forged-${label}`] = await inspect(label, await G.get(path, bearer));
    }
    statuses.inviteToken = await inspect("invite token", await G.get(`/api/invites/${canary}`));
    statuses.invitationToken = await inspect("invitation token", await G.get(`/api/invitations/token/${canary}`));
    statuses.linkConfirm = await inspect("link confirm", await G.post("/api/manage/link/confirm", { data: { token: canary } }));
    statuses.acceptInvite = await inspect("accept invite", await G.post("/api/auth/accept-invite", { data: { token: canary, password: canary, name: canary } }));
    statuses.malformedJson = await inspect("malformed JSON", await G.post("/api/guest/login", { headers: { "Content-Type": "application/json" }, data: `{"email":"${canary}",` }));
    statuses.unknownRoute = await inspect("unknown API route", await G.get(`/api/qa-unknown-${randomUUID()}`), []);
    // Forced database exception on an authenticated path: oversize value with canary.
    const oversized = await f.actors.QA_USER.post("/api/circles", { data: { name: `${canary}${"x".repeat(5000)}`, joinMode: "invite" } });
    if (oversized.status() === 201) {
      const id = (await oversized.json()).id;
      f.track("circles", "id", id); f.track("circle_members", "circle_id", id);
      statuses.oversizedCircle = 201;
    } else statuses.oversizedCircle = await inspect("database exception", oversized);
    const oversizedBody = oversized.status() === 201 ? "" : await oversized.text();
    await evidence("stage-b-errors", { ...statuses, genericServerError: oversizedBody === '{"error":"Internal server error"}' || oversized.status() < 500 });
  });
});
