import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, manifest } from "../fixtures";
import { connectedPreflight, repositoryRoot } from "../runtime";

test("SEC-REVIEW-001: unauthenticated signup must not claim an existing passwordless identity", async ({ request }) => {
  const id = randomUUID();
  const email = `qa_passwordless_${randomBytes(8).toString("hex")}@example.test`;
  const password = randomBytes(32).toString("hex");
  const googleUid = `qa-google-${id}`;
  const checked = await connectedPreflight();
  let inserted = false;
  let evidence: Record<string, unknown> | undefined;
  try {
    expect((await request.storageState()).cookies.length).toBe(0);
    // Supported existing Google-linked account shape; no Google/provider call or real identity.
    await checked.connection.execute("INSERT INTO residents (id, email, name, google_uid, email_verified_at) VALUES (?, ?, ?, ?, NOW())", [id, email, "QA passwordless original owner", googleUid]);
    inserted = true;
    const [before] = await checked.connection.query<any[]>("SELECT password_hash FROM residents WHERE id = ?", [id]);
    expect(before[0].password_hash === null).toBe(true);
    const signup = await request.post("/api/guest/signup", { data: { email, password, name: "QA unrelated requester", termsAccepted: true, marketingConsent: false } });
    const me = await (await request.get("/api/residents/me")).json();
    const protectedResponse = await request.get("/api/residents/me/receipts");
    const [after] = await checked.connection.query<any[]>("SELECT password_hash, google_uid FROM residents WHERE id = ?", [id]);
    const passwordAssigned = !!after[0]?.password_hash && bcrypt.compareSync(password, after[0].password_hash);
    const existingIdentityAccessible = me.resident?.id === id;
    evidence = {
      classification: passwordAssigned && existingIdentityAccessible ? "CONFIRMED SECURITY DEFECT" : "NOT CONFIRMED",
      environment: "isolated disposable local MySQL", runId: manifest.runId,
      endpoint: "POST /api/guest/signup", initiallyPasswordless: true, initiallyUnauthenticated: true,
      signupStatus: signup.status(), passwordAssigned, existingIdentityAccessible,
      originalProfileNameReturned: me.resident?.name === "QA passwordless original owner",
      googleLinkPreserved: after[0]?.google_uid === googleUid,
      protectedEndpointStatus: protectedResponse.status(),
      identityProofProvided: false,
    };
  } finally {
    await checked.connection.end();
    if (inserted) {
      const cleanup = await connectedPreflight(); // Independently guard exact fixture cleanup.
      try {
        if (cleanup.manifest.runId !== manifest.runId) throw new Error("QA SAFETY ABORT: Run changed before fixture cleanup.");
        await cleanup.connection.execute("DELETE FROM guest_sessions WHERE email = ?", [email]);
        await cleanup.connection.execute("DELETE FROM guest_login_tokens WHERE email = ?", [email]);
        await cleanup.connection.execute("DELETE FROM residents WHERE id = ? AND email = ? AND google_uid = ?", [id, email, googleUid]);
      } finally { await cleanup.connection.end(); }
    }
  }
  if (!evidence) throw new Error("QA security probe did not produce evidence.");
  const directory = path.join(repositoryRoot, ".qa-data", manifest.runId, "evidence");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, "passwordless-signup.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log("Sanitized passwordless-signup evidence:", JSON.stringify(evidence));
  // Preserve the secure expectation. A product defect MUST stay red (no test.fail/skip).
  expect(evidence.passwordAssigned, "Signup must not assign credentials without proving existing-account ownership").toBe(false);
  expect(evidence.existingIdentityAccessible, "Unverified signup must not authenticate as the existing owner").toBe(false);
});
