import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// D-02 — Support may approve a *pending* partner but never reinstate a
// suspended one. The handler reads the account status, picks the permission
// from it, then writes in a transaction. This test forces the race
// deterministically (no sleeps): Support's request is paused exactly between
// that read and its write transaction, a Super suspension runs to completion
// in the gap, then Support's write continues. Support must get 409 and change
// nothing; the account stays suspended; no approval email, approval decision
// or approval audit entry is produced.

const sent: { to: string; subject: string }[] = [];
vi.mock("../email.js", () => ({ sendMail: vi.fn(async (m: { to: string; subject: string }) => { sent.push({ to: m.to, subject: m.subject }); }) }));

const { db } = await import("../db/index.js");
const { adminRouter } = await import("./admin.js");

const run = crypto.randomUUID().slice(0, 8);
const superId = `race-super-${run}`;
const supportId = `race-support-${run}`;
const vendorId = `race-vendor-${run}`;
const vendorEmail = `${vendorId}@example.test`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  for (const [id, role] of [[superId, "super"], [supportId, "support"]] as const) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'Race admin', ?)`).run(id, `${id}@example.test`, role);
  }
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'pending', 'Race partner')`).run(vendorId, vendorEmail);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-User-Id");
    if (id) (req as any).user = { id, role: "admin", status: "approved", adminRole: req.header("X-Test-Admin-Role") };
    next();
  });
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM audit_log WHERE object_id = ? OR actor_user_id IN (?, ?)`).run(vendorId, superId, supportId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(superId, supportId, vendorId);
});

const setStatus = (as: string, adminRole: string, body: Record<string, unknown>) =>
  fetch(`${baseUrl}/admin/vendors/${vendorId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Test-User-Id": as, "X-Test-Admin-Role": adminRole },
    body: JSON.stringify(body),
  });

const suspension = { status: "suspended", reasonCategory: "safety", explanation: "Serious safety complaints about recent sessions." };

describe("Support approval vs Super suspension", () => {
  it("when the suspension lands between Support's read and write, Support gets 409 and nothing is reinstated", async () => {
    // Pause Support's request at its first transaction (the write), run the
    // whole Super suspension there, then let Support's write continue.
    const original = db.transaction.bind(db);
    let superStatus = 0;
    let paused = false;
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce(async (fn: any) => {
      paused = true;
      superStatus = (await setStatus(superId, "super", suspension)).status; // uses the real transaction (mockImplementationOnce is spent)
      return original(fn);
    });

    const support = await setStatus(supportId, "support", { status: "approved" });
    spy.mockRestore();

    expect(paused, "Support's request reached its write transaction after the permission check").toBe(true);
    expect(superStatus).toBe(200);
    expect(support.status).toBe(409);

    const row = (await db.prepare(`SELECT status FROM users WHERE id = ?`).get(vendorId)) as { status: string };
    expect(row.status).toBe("suspended");

    const decisions = (await db.prepare(`SELECT action, actor_user_id AS actor FROM moderation_decisions WHERE object_id = ? ORDER BY id`).all(vendorId)) as { action: string; actor: string }[];
    expect(decisions).toEqual([{ action: "partner.suspended", actor: superId }]);

    const audits = (await db.prepare(`SELECT actor_user_id AS actor, new_value FROM audit_log WHERE object_id = ? AND action = 'vendor.status_changed' ORDER BY id`).all(vendorId)) as { actor: string; new_value: string }[];
    expect(audits.map((a) => [a.actor, JSON.parse(a.new_value).status])).toEqual([[superId, "suspended"]]);

    // The suspension notice is sent after the response; wait for that condition, not for time.
    for (let i = 0; i < 200 && !sent.some((m) => m.to === vendorEmail && /suspended/.test(m.subject)); i++) await new Promise((r) => setImmediate(r));
    const toVendor = sent.filter((m) => m.to === vendorEmail).map((m) => m.subject);
    expect(toVendor).toEqual(["Your HelloCircle partner account has been suspended"]);
    expect(toVendor.some((s) => /approved|reinstated/i.test(s))).toBe(false);
    const notices = (await db.prepare(`SELECT title FROM notifications WHERE recipient_id = ?`).all(vendorId)) as { title: string }[];
    expect(notices.map((n) => n.title)).toEqual(["Your HelloCircle partner account has been suspended"]);
  });

  it("once suspended, a Support approval is refused outright (403) and the account stays suspended", async () => {
    expect((await setStatus(supportId, "support", { status: "approved" })).status).toBe(403);
    expect(((await db.prepare(`SELECT status FROM users WHERE id = ?`).get(vendorId)) as { status: string }).status).toBe("suspended");
  });
});
