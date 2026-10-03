import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { acquireRunLock, childEnvironment, connectedPreflight, repositoryRoot } from "./runtime";
import type {} from "../../server/src/guestAuth";

async function main() {
  const checked = await connectedPreflight();
  await checked.connection.end();
  if (process.argv[2] !== "child") {
    const release = acquireRunLock();
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/integration/seed.ts", "child"], {
      cwd: repositoryRoot, env: childEnvironment(checked.env, checked.manifest), stdio: "inherit",
    });
    release();
    process.exit(result.status ?? 1);
  }
  const { env, manifest } = checked;
  const { db, initSchema } = await import("../../server/src/db/index");
  const identity = await db.prepare("SELECT DATABASE() AS name, CURRENT_USER() AS account, @@server_uuid AS uuid").get();
  if (identity.name !== manifest.databaseName || identity.account !== "hello_circle_qa@%" || identity.uuid !== manifest.serverUuid) throw new Error("QA SAFETY ABORT: Application pool identity mismatch.");
  await initSchema();
  const { createResidentWithPassword, getResidentByEmail } = await import("../../server/src/residents");
  const { createUser, findUserByEmail, hashPassword, verifyPassword } = await import("../../server/src/auth");
  const personas: Record<string, { id: string; role: string }> = {};
  for (const persona of ["QA_USER", "QA_USER_B", "QA_HOST", "QA_HOST_B"]) {
    const isHost = persona.startsWith("QA_HOST");
    const email = env[`${persona}_EMAIL`];
    let resident = await getResidentByEmail(email);
    if (!resident) {
      resident = await createResidentWithPassword(email, hashPassword(env[`${persona}_PASSWORD`]), persona, true, false);
      if (!resident) throw new Error("QA SAFETY ABORT: Resident seed conflict.");
      await db.prepare("UPDATE residents SET onboarding_completed = 1, email_verified_at = NOW(), host_status = ? WHERE id = ? AND email = ?")
        .run(isHost ? "verified" : "none", resident.id, email);
    }
    const stored = await db.prepare("SELECT password_hash, onboarding_completed, email_verified_at, host_status FROM residents WHERE id = ? AND email = ?").get(resident.id, email);
    if (!stored || !verifyPassword(env[`${persona}_PASSWORD`], stored.password_hash) || !stored.onboarding_completed || !stored.email_verified_at
      || stored.host_status !== (isHost ? "verified" : "none")) throw new Error("QA SAFETY ABORT: Resident persona verification failed; no credentials overwritten.");
    personas[persona] = { id: resident.id, role: isHost ? "resident-host" : "resident" };
  }
  for (const persona of ["QA_VENDOR", "QA_VENDOR_B", "QA_ADMIN"]) {
    const role = persona === "QA_ADMIN" ? "admin" : "vendor";
    let user = await findUserByEmail(env[`${persona}_EMAIL`]);
    if (!user) {
      await createUser(env[`${persona}_EMAIL`], env[`${persona}_PASSWORD`], persona, role, "approved");
      user = await findUserByEmail(env[`${persona}_EMAIL`]);
    }
    if (!user || user.role !== role || user.status !== "approved" || !verifyPassword(env[`${persona}_PASSWORD`], user.passwordHash)) throw new Error("QA SAFETY ABORT: Role persona verification failed.");
    personas[persona] = { id: user.id, role };
  }
  if (new Set(Object.values(personas).map(({ id }) => id)).size !== 7) throw new Error("QA SAFETY ABORT: Persona IDs are not unique.");
  const suspendedEmail = "qa_suspended@example.test";
  if (!await findUserByEmail(suspendedEmail)) await createUser(suspendedEmail, env.QA_VENDOR_B_PASSWORD, "QA suspended control", "vendor", "suspended");
  const suspended = await findUserByEmail(suspendedEmail);
  if (!suspended || suspended.status !== "suspended" || !verifyPassword(env.QA_VENDOR_B_PASSWORD, suspended.passwordHash)) throw new Error("QA SAFETY ABORT: Suspended control verification failed.");
  writeFileSync(path.join(manifest.secretsDir, "personas.json"), JSON.stringify(personas), { mode: 0o600 });
  console.log("QA SAFE: seven unique personas and one suspended-account control verified with production password hashing. Existing seed identities preserved.");
  process.exit(0); // Application pool has no public close helper.
}
main().catch((error) => { console.error("QA SAFETY ABORT: Seed failed.", /^[A-Z_]+$/.test(error?.code) ? error.code : "Credential-bearing diagnostics suppressed."); process.exit(1); });
