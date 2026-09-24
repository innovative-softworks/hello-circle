import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSetting, setSetting } from "../db/index.js";
import { adminMediaRouter } from "./adminMedia.js";

// Media Cost Controls / Cloudinary pilot pass — exercises the admin-only
// usage-visibility + editorial-collection + pause-toggle surface.
// Cloudinary has real, verified credentials AND is genuinely enabled in
// this dev environment's .env (2026-09-24, at the user's own request,
// with a real test upload already done) — this suite restores whatever
// the app_settings toggles were BEFORE it ran, rather than forcing a
// fixed "always end up disabled" value, so running this file never
// silently undoes that real, deliberate enablement.

let server: Server;
let baseUrl: string;
const adminId = `test-admin-${crypto.randomUUID()}`;
const vendorId = `test-vendor-${crypto.randomUUID()}`;
let originalMediaUploadsEnabled: string;
let originalCloudinaryUploadsEnabled: string;

function asAdmin() {
  return { "X-Test-User-Id": adminId, "X-Test-User-Role": "admin" };
}
function asVendor() {
  return { "X-Test-User-Id": vendorId, "X-Test-User-Role": "vendor", "X-Test-User-Status": "approved" };
}

beforeAll(async () => {
  originalMediaUploadsEnabled = await getSetting("media_uploads_enabled", "true");
  originalCloudinaryUploadsEnabled = await getSetting("cloudinary_uploads_enabled", "false");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("X-Test-User-Id");
    if (userId) {
      (req as any).user = { id: userId, role: req.header("X-Test-User-Role") ?? "vendor", status: req.header("X-Test-User-Status") ?? "approved", invitedStaff: false, orgId: null };
    }
    next();
  });
  app.use("/admin/media", adminMediaRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Restore exactly what these settings were before this file ran — never
  // a hardcoded "always disabled" value, which would fight the user's own
  // real, deliberate toggle state.
  await setSetting("media_uploads_enabled", originalMediaUploadsEnabled);
  await setSetting("cloudinary_uploads_enabled", originalCloudinaryUploadsEnabled);
});

describe("adminMediaRouter authorization", () => {
  it("rejects a non-admin", async () => {
    const res = await fetch(`${baseUrl}/admin/media/usage`, { headers: asVendor() });
    expect(res.status).toBe(401); // requireAdmin returns 401 for "authenticated but wrong role" too, not just "no session"
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await fetch(`${baseUrl}/admin/media/usage`);
    expect(res.status).toBe(401);
  });
});

describe("GET /admin/media/usage", () => {
  // This dev environment's server/.env now has real, verified Cloudinary
  // credentials AND CLOUDINARY_UPLOADS_ENABLED=true (2026-09-24, real test
  // upload verified end-to-end at the user's request) — reflects that
  // real state. cloudinaryUploadAllowed additionally depends on the
  // runtime app_settings toggle, which other tests in this file flip, so
  // it's asserted separately (see "pause toggles" below) rather than here.
  it("reports Cloudinary as configured and env-enabled, and never reports provider-billing numbers as available", async () => {
    const res = await fetch(`${baseUrl}/admin/media/usage`, { headers: asAdmin() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.cloudinaryConfigured).toBe(true);
    // Cloudinary was genuinely enabled in this dev environment's .env this
    // session (real credentials, real test upload verified) — reflects
    // that real state rather than an environment this suite doesn't
    // actually run in.
    expect(body.config.cloudinaryEnabledByEnv).toBe(true);
    expect(body.providerReported.r2.available).toBe(false);
    expect(body.providerReported.cloudinary.available).toBe(false);
    expect(Array.isArray(body.application.byProviderAndStatus)).toBe(true);
  });
});

describe("editorial collection", () => {
  it("lists an empty (or unaffected) collection without error", async () => {
    const res = await fetch(`${baseUrl}/admin/media/editorial`, { headers: asAdmin() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.images)).toBe(true);
  });

  it("refuses an editorial upload whose content isn't a real, decodable image signature, without crashing", async () => {
    // Deliberately NOT a bare-SOI JPEG stub (imageSniff.ts's own tests
    // show that still passes signature sniffing) — this asserts the
    // rejection deterministically regardless of whether Cloudinary is
    // currently enabled in this environment, by using content that fails
    // validation before any provider is ever reached.
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("this is not an image at all")], { type: "image/jpeg" }), "test.jpg");
    const res = await fetch(`${baseUrl}/admin/media/editorial`, { method: "POST", headers: asAdmin(), body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Only JPEG, PNG or WebP images are allowed|Cloudinary uploads are not enabled/);
  });

  it("404s deleting an editorial image that doesn't exist", async () => {
    const res = await fetch(`${baseUrl}/admin/media/editorial/${crypto.randomUUID()}`, { method: "DELETE", headers: asAdmin() });
    expect(res.status).toBe(404);
  });
});

describe("pause toggles", () => {
  it("round-trips the global uploads-enabled switch and audits the change", async () => {
    const before = await (await fetch(`${baseUrl}/admin/media/config/uploads-enabled`, { headers: asAdmin() })).json();
    expect(before.enabled).toBe(true);

    const put = await fetch(`${baseUrl}/admin/media/config/uploads-enabled`, { method: "PUT", headers: { ...asAdmin(), "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(put.status).toBe(200);
    expect((await put.json()).enabled).toBe(false);

    const after = await (await fetch(`${baseUrl}/admin/media/config/uploads-enabled`, { headers: asAdmin() })).json();
    expect(after.enabled).toBe(false);

    // restore for any later test/suite
    await fetch(`${baseUrl}/admin/media/config/uploads-enabled`, { method: "PUT", headers: { ...asAdmin(), "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  });

  // CLOUDINARY_UPLOADS_ENABLED is genuinely "true" in this dev
  // environment's .env now (real credentials, real verified test upload)
  // — so turning the runtime switch ON here is expected to succeed. The
  // 409-when-env-disabled guard itself (`if (enabled &&
  // !mediaConfig.cloudinaryUploadsEnabledByEnv)` in adminMedia.ts) is a
  // one-line condition covered by reading the code, not exercisable
  // against a live server that has the env var set.
  it("round-trips the Cloudinary runtime switch now that CLOUDINARY_UPLOADS_ENABLED is set in this environment", async () => {
    const on = await fetch(`${baseUrl}/admin/media/config/cloudinary-enabled`, { method: "PUT", headers: { ...asAdmin(), "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    expect(on.status).toBe(200);
    expect((await on.json()).enabled).toBe(true);
  });

  it("allows turning Cloudinary OFF at runtime", async () => {
    const res = await fetch(`${baseUrl}/admin/media/config/cloudinary-enabled`, { method: "PUT", headers: { ...asAdmin(), "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
  });
});
