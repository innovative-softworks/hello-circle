import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, lstatSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { authIntegrationConfigIssues, QA_WEBHOOK_SECRET_PATTERN, stripeTestProfileIssues } from "../support/integration-safety";
import { assertDatabaseIdentity, type DatabaseIdentity } from "./identity";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const manifestPath = path.join(repositoryRoot, ".qa-data", "current.json");
export function acquireRunLock(): () => void {
  const filename = path.join(repositoryRoot, ".qa-data", "operation.lock");
  let descriptor: number;
  try { descriptor = openSync(filename, "wx", 0o600); }
  catch { throw new Error("QA SAFETY ABORT: Another QA mutation/test operation is active (or its lock needs manual inspection)."); }
  writeFileSync(descriptor, String(process.pid));
  return () => { closeSync(descriptor); unlinkSync(filename); };
}
export type Manifest = {
  runId: string; nonce: string; databaseName: string; serverUuid: string;
  containerId: string; containerName: string; imageId: string; networkId: string;
  secretsDir: string; dataDir: string;
};
export function docker(args: string[], input?: string): string {
  try { return execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 180_000 }).trim(); }
  catch { throw new Error("QA SAFETY ABORT: Docker operation failed. No command input or credential-bearing diagnostics printed."); }
}
export function loadRun(): { manifest: Manifest; env: Record<string, string> } {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (!/^qa_[a-z0-9]{8,24}$/.test(manifest.runId) || !/^[a-f0-9]{64}$/.test(manifest.containerId)
    || !/^[a-f0-9]{64}$/.test(manifest.networkId) || !/^sha256:[a-f0-9]{64}$/.test(manifest.imageId)) throw new Error("QA SAFETY ABORT: Invalid run manifest.");
  if (manifest.containerName !== `hellocircle-${manifest.runId}` || manifest.databaseName !== `hello_circle_e2e_${manifest.runId}`
    || manifest.dataDir !== path.join(repositoryRoot, ".qa-data", manifest.runId)) throw new Error("QA SAFETY ABORT: Run target mismatch.");
  if (!path.basename(manifest.secretsDir).startsWith("hellocircle-qa-") || lstatSync(manifest.secretsDir).isSymbolicLink()) throw new Error("QA SAFETY ABORT: Invalid secrets directory.");
  if (realpathSync(manifest.dataDir) !== manifest.dataDir) throw new Error("QA SAFETY ABORT: QA storage must not traverse symlinks.");
  const env = JSON.parse(readFileSync(path.join(manifest.secretsDir, "environment.json"), "utf8")) as Record<string, string>;
  const issues = authIntegrationConfigIssues(env, repositoryRoot);
  if (issues.length || env.QA_RUN_ID !== manifest.runId || env.DB_NAME !== manifest.databaseName) throw new Error("QA SAFETY ABORT: Invalid isolated configuration.");
  // Refuse rather than silently replace a caller's conflicting production/dev configuration.
  for (const key of ["NODE_ENV", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "E2E_API_URL", "E2E_BASE_URL", "QA_E2E_ENABLED"]) {
    if (process.env[key] && process.env[key] !== env[key]) throw new Error(`QA SAFETY ABORT: Conflicting inherited ${key}.`);
  }
  // Phase 9: Stripe TEST-mode keys are tolerated only inside the opt-in Stripe
  // test profile (set by `qa:stripe` after validating the private file).
  const stripeProfile = process.env.QA_STRIPE_TEST_PROFILE === "1"
    && stripeTestProfileIssues({ STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY }).length === 0
    && QA_WEBHOOK_SECRET_PATTERN.test(process.env.STRIPE_WEBHOOK_SECRET ?? "");
  if ((process.env.STRIPE_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET) && !stripeProfile) throw new Error("QA SAFETY ABORT: External credentials inherited by QA command.");
  if (process.env.SMTP_HOST || process.env.FIREBASE_PRIVATE_KEY || process.env.R2_SECRET_ACCESS_KEY) throw new Error("QA SAFETY ABORT: External credentials inherited by QA command.");
  return { manifest, env };
}

export function verifyContainer(manifest: Manifest): void {
  const [container] = JSON.parse(docker(["inspect", manifest.containerId]));
  const [network] = JSON.parse(docker(["network", "inspect", manifest.networkId]));
  const port = container.NetworkSettings.Ports["3306/tcp"];
  if (container.Id !== manifest.containerId || container.Image !== manifest.imageId || container.Name !== `/${manifest.containerName}`
    || container.Config.Labels?.["ie.hellocircle.qa.run"] !== manifest.runId
    || container.Config.Labels?.["ie.hellocircle.qa.nonce"] !== manifest.nonce || !container.State.Running
    || network.Driver !== "bridge" || network.Labels?.["ie.hellocircle.qa.run"] !== manifest.runId
    || Object.keys(container.NetworkSettings.Networks).length !== 1
    || !Object.values(container.NetworkSettings.Networks).some((entry: any) => entry.NetworkID === manifest.networkId)
    || !port || port.length !== 1 || port[0].HostIp !== "127.0.0.1" || port[0].HostPort !== "13306"
    || !container.HostConfig.Tmpfs?.["/var/lib/mysql"]
    || container.Mounts.some((mount: any) => mount.Type !== "tmpfs" && !(mount.Type === "bind" && mount.Source === manifest.secretsDir && mount.Destination === "/run/qa" && !mount.RW))) {
    throw new Error("QA SAFETY ABORT: Container isolation or identity mismatch.");
  }
}

export async function connectedPreflight() {
  const { manifest, env } = loadRun();
  verifyContainer(manifest); // Must precede even connecting to the configured port.
  const connection = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 5000 });
  try {
    const [identity] = await connection.query<any[]>("SELECT DATABASE() AS databaseName, CURRENT_USER() AS account, @@server_uuid AS serverUuid");
    const [grants] = await connection.query<any[]>("SHOW GRANTS");
    const [databases] = await connection.query<any[]>("SHOW DATABASES");
    const [marker] = await connection.query<any[]>("SELECT run_id AS runId, nonce FROM qa_environment_identity");
    if (marker.length !== 1) throw new Error("QA SAFETY ABORT: Missing unique run identity.");
    const actual: DatabaseIdentity = { ...identity[0], ...marker[0], grants: grants.map((row) => String(Object.values(row)[0])), databases: databases.map((row) => row.Database) };
    assertDatabaseIdentity(actual, manifest);
    const [schema] = await connection.query<any[]>("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('residents','users','sessions','guest_sessions')");
    return { manifest, env, connection, schemaReady: Number(schema[0].count) === 4 };
  } catch (error) { await connection.end(); throw error; }
}

export function childEnvironment(env: Record<string, string>, manifest: Manifest): NodeJS.ProcessEnv {
  // Explicit allowlist: never copy process.env or application .env into a backend child.
  return { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env,
    PLAYWRIGHT_NO_COPY_PROMPT: "1",
    DOTENV_CONFIG_PATH: path.join(manifest.secretsDir, "empty.env"),
    QA_RUN_NONCE: manifest.nonce, QA_SERVER_UUID: manifest.serverUuid,
  };
}
