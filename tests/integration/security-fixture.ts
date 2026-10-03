import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import bcrypt from "bcryptjs";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { connectedPreflight } from "./runtime";

export const conflict = { error: "An account already exists for this email — try logging in instead." };
export async function withSecurityIdentity(kind: "google" | "password" | "magic" | "new", exercise: (fixture: {
  id: string; email: string; password: string; originalPassword: string; googleUid: string | null;
  connection: Awaited<ReturnType<typeof connectedPreflight>>["connection"];
  unchanged: () => Promise<void>; resolveOriginalGoogle: () => Promise<void>;
}) => Promise<void>) {
  const checked = await connectedPreflight();
  const { connection } = checked;
  const id = randomUUID();
  const email = `qa_security_${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(32).toString("hex");
  const originalPassword = randomBytes(32).toString("hex");
  const googleUid = kind === "google" ? `qa-google-${id}` : null;
  let ownsFixture = false;
  try {
    const [existing] = await connection.query<any[]>("SELECT id FROM residents WHERE email = ?", [email]);
    if (existing.length) throw new Error("QA SAFETY ABORT: Synthetic fixture collision.");
    ownsFixture = true;
    if (kind !== "new") await connection.execute("INSERT INTO residents (id, email, name, google_uid, password_hash, email_verified_at, host_status) VALUES (?, ?, ?, ?, ?, NOW(), 'verified')", [
      id, email, "Original QA identity", googleUid, kind === "password" ? bcrypt.hashSync(originalPassword, 10) : null,
    ]);
    const [before] = await connection.query<any[]>("SELECT * FROM residents WHERE email = ?", [email]);
    const unchanged = async () => {
      const [after] = await connection.query<any[]>("SELECT * FROM residents WHERE email = ?", [email]);
      // Compare ALL row fields without exposing either row/hash in failure output.
      expect(isDeepStrictEqual(after, before), "Existing resident row including credentials, linkage, roles, ownership and consent must be unchanged").toBe(true);
      const [sessions] = await connection.query<any[]>("SELECT COUNT(*) AS count FROM guest_sessions WHERE email = ?", [email]);
      expect(Number(sessions[0].count), "Rejected requests must not create a database session").toBe(0);
    };
    const resolveOriginalGoogle = async () => {
      // Actual HelloCircle resolver, NOT a mock OAuth response or a claim of provider verification.
      const { db } = await import("../../server/src/db/index");
      const actual = await db.prepare("SELECT DATABASE() AS name, @@server_uuid AS uuid, CURRENT_USER() AS account").get();
      expect(actual.name === checked.manifest.databaseName && actual.uuid === checked.manifest.serverUuid && actual.account === "hello_circle_qa@%", "Resolver application pool must match guarded QA identity").toBe(true);
      const { resolveGoogleSignIn } = await import("../../server/src/residents");
      const resolved = await resolveGoogleSignIn(googleUid!, email);
      expect(resolved.kind).toBe("existing");
      expect(resolved.kind === "existing" && resolved.resident.id === id).toBe(true);
    };
    await exercise({ id, email, password, originalPassword, googleUid, connection, unchanged, resolveOriginalGoogle });
  } finally {
    await connection.end();
    if (ownsFixture) {
      const cleanup = await connectedPreflight();
      try {
        if (cleanup.manifest.runId !== checked.manifest.runId) throw new Error("QA SAFETY ABORT: Run changed before security fixture cleanup.");
        for (const table of ["guest_sessions", "guest_login_tokens", "resident_password_reset_tokens", "resident_signup_tokens"]) {
          await cleanup.connection.execute(`DELETE FROM ${table} WHERE email = ?`, [email]);
        }
        // The email was reserved absent before this test; no existing persona is eligible.
        await cleanup.connection.execute("DELETE FROM residents WHERE email = ?", [email]);
      } finally { await cleanup.connection.end(); }
    }
  }
}

export async function assertAnonymous(request: APIRequestContext) {
  const state = await request.storageState();
  expect(state.cookies.length, "No authenticated cookie/state issued").toBe(0);
  expect((await (await request.get("/api/residents/me")).json()).resident).toBeNull();
  expect((await request.get("/api/residents/me/receipts")).status()).toBe(401);
}
export async function assertLoggedOut(request: APIRequestContext) {
  // Express currently retains an empty cleared cookie when maxAge is supplied.
  // Unlike a fresh rejected signup, logout need not leave a physically empty jar.
  const state = await request.storageState();
  expect(state.cookies.every((cookie) => cookie.name === "hello_circle_guest_session" && cookie.value === ""), "Logout must leave no credential-bearing cookie").toBe(true);
  expect((await (await request.get("/api/residents/me")).json()).resident).toBeNull();
  expect((await request.get("/api/residents/me/receipts")).status()).toBe(401);
}
export async function assertRejected(response: APIResponse, request: APIRequestContext, status = 409) {
  expect(response.status()).toBe(status);
  expect(response.headers()["set-cookie"] === undefined).toBe(true);
  expect(response.headers()["location"] === undefined).toBe(true);
  const body = await response.json();
  if (status === 409) expect(body).toEqual(conflict);
  // Only an error field: no access/refresh/session/verification token in response.
  expect(Object.keys(body)).toEqual(["error"]);
  await assertAnonymous(request);
}
