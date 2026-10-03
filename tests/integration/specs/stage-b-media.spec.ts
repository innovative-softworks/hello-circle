import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, manifest } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, clubFor, experienceFor, programFor } from "../stage-b-fixture";

// Local proof only. R2/Cloudinary are absent in the QA profile, so an
// AUTHORIZED request stops at "Cloud media storage is not configured" (503)
// or a release no-op; real delivery/deletion is EXTERNAL PENDING. Every
// unauthorized request must be rejected before that storage boundary.

const STORAGE_BOUNDARY = "Cloud media storage is not configured";

test("STAGE-B-MEDIA: upload, association and release authorization for every remaining media entity type", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "QA_USER", "QA_USER_B", "GUEST"], async (f) => {
    const centre = await centreFor(f, "QA_VENDOR");
    const program = await programFor(f, "QA_VENDOR", centre.id);
    const experience = await experienceFor(f, "QA_VENDOR");
    const club = await clubFor(f, "QA_VENDOR");
    const clubSession = randomUUID();
    await f.connection.execute("INSERT INTO club_sessions (id, club_id, day_of_week, time) VALUES (?, ?, 1, '10:00')", [clubSession, club]);
    const [org] = await f.connection.query<any[]>("SELECT org_id FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    const orgA = org[0].org_id;
    const targets: [string, string][] = [
      ["program-cover", program], ["experience-gallery", experience], ["club-session-cover", clubSession], ["club-gallery", club],
      ["org-logo", orgA], ["vendor-draft-media", orgA], ["resident-avatar", personas.QA_USER.id],
    ];
    const invariants = await Promise.all([
      f.snapshot("SELECT id, image_url FROM programs WHERE id = ?", [program]),
      f.snapshot("SELECT id, image_url FROM experiences WHERE id = ?", [experience]),
      f.snapshot("SELECT * FROM club_sessions WHERE id = ?", [clubSession]),
      f.snapshot("SELECT id, image_url FROM clubs WHERE id = ?", [club]),
      f.snapshot("SELECT id, logo, avatar FROM (SELECT id, logo, NULL AS avatar FROM users WHERE org_id = ? UNION ALL SELECT id, NULL, avatar_url FROM residents WHERE id = ?) x ORDER BY id", [orgA, personas.QA_USER.id]),
    ]);
    const uploads = path.join(manifest.dataDir, "uploads");
    const files = () => (existsSync(uploads) ? readdirSync(uploads).length : 0);
    const before = files();
    const results: Record<string, number[]> = {};
    for (const [entityType, entityId] of targets) {
      const foreign = entityType === "resident-avatar" ? ["QA_USER_B", "QA_VENDOR", "GUEST"] : ["QA_VENDOR_B", "QA_USER", "GUEST"];
      for (const role of foreign) {
        const actor: APIRequestContext = f.actors[role];
        for (const [action, data] of [
          ["authorize", { entityType, entityId, contentType: "image/png" }],
          ["finalize", { entityType, entityId, objectKey: `qa/${randomUUID()}.png` }],
          ["release", { entityType, entityId, url: "/uploads/qa-nonexistent.png" }],
        ] as [string, object][]) {
          const response = await actor.post(`/api/media/${action}`, { data });
          const key = `${entityType}:${role}`;
          (results[key] ??= []).push(response.status());
          expect([401, 403], `${key} ${action}`).toContain(response.status());
          expect(JSON.stringify(await response.json()).includes(STORAGE_BOUNDARY), `${key} ${action} denied before storage`).toBe(false);
          for (const unchanged of invariants) await unchanged();
        }
      }
    }
    // Legacy local-disk upload requires vendor/admin; multipart from a resident/guest writes nothing.
    for (const role of ["QA_USER", "GUEST"]) {
      const response = await f.actors[role].post("/api/uploads", { multipart: { file: { name: "qa.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") } } });
      expect([401, 403], `${role} legacy upload`).toContain(response.status());
      const local = await f.actors[role].post("/api/media/upload", { multipart: { entityType: "program-cover", entityId: program, file: { name: "qa.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") } } });
      expect([401, 403], `${role} local processing upload`).toContain(local.status());
    }
    expect(files(), "No file written by denied uploads").toBe(before);
    // Authorized owners reach exactly the external storage boundary.
    const boundary: Record<string, number> = {};
    for (const [entityType, entityId] of targets) {
      const actor = entityType === "resident-avatar" ? f.actors.QA_USER : f.actors.QA_VENDOR;
      const response = await actor.post("/api/media/authorize", { data: { entityType, entityId, contentType: "image/png" } });
      boundary[entityType] = response.status();
      expect(response.status(), `${entityType} owner reaches storage boundary`).toBe(503);
      for (const unchanged of invariants) await unchanged();
    }
    await evidence("stage-b-media", { ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.join(",")])), ownerBoundary: JSON.stringify(boundary), externalDeliveryTested: false });
  });
});
