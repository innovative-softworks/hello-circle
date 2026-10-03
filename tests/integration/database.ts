import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { authIntegrationConfigIssues, authQaPersonas } from "../support/integration-safety";
import { acquireRunLock, connectedPreflight, docker, manifestPath, repositoryRoot, verifyContainer, type Manifest } from "./runtime";

const secret = () => randomBytes(32).toString("hex");
async function setup() {
  if (existsSync(manifestPath)) throw new Error("QA SAFETY ABORT: An isolated run already exists; refusing to overwrite its identity.");
  if (Object.entries(process.env).some(([key, value]) => value && (/^(DB_|STRIPE_|SMTP_|R2_|FIREBASE_)/.test(key) || key === "NODE_ENV" && value !== "test"))) {
    throw new Error("QA SAFETY ABORT: Clear inherited application/database/service configuration before provisioning.");
  }
  const runId = `qa_${randomBytes(8).toString("hex")}`;
  const dataDir = path.join(repositoryRoot, ".qa-data", runId);
  const secretsDir = mkdtempSync(path.join(os.tmpdir(), "hellocircle-qa-"));
  const rootPassword = secret();
  const env: Record<string, string> = {
    NODE_ENV: "test", QA_E2E_ENABLED: "true", QA_PROFILE: "auth", QA_RUN_ID: runId,
    E2E_ENVIRONMENT: "local", E2E_BASE_URL: "http://127.0.0.1:4178", E2E_API_URL: "http://127.0.0.1:4311",
    CLIENT_URL: "http://127.0.0.1:4178", PUBLIC_ORIGINS: "http://127.0.0.1:4178", PORT: "4311",
    DB_HOST: "127.0.0.1", DB_PORT: "13306", DB_USER: "hello_circle_qa", DB_PASSWORD: secret(),
    DB_NAME: `hello_circle_e2e_${runId}`, DATA_DIR: dataDir,
    MEDIA_PROVIDER: "local", CLOUDINARY_UPLOADS_ENABLED: "false", MEDIA_LOCAL_PROCESSING_ENABLED: "false",
    VITE_MAPBOX_ENABLED: "false", VITE_LAUNCH_MODE: "public", GEOCODER_BASE_URL: "http://127.0.0.1:4312",
  };
  for (const persona of authQaPersonas) {
    env[`${persona}_EMAIL`] = `${persona.toLowerCase()}@example.test`;
    env[`${persona}_PASSWORD`] = secret();
  }
  env.HELLO_CIRCLE_ADMIN_EMAIL = env.QA_ADMIN_EMAIL;
  env.HELLO_CIRCLE_ADMIN_PASSWORD = env.QA_ADMIN_PASSWORD;
  if (authIntegrationConfigIssues(env, repositoryRoot).length) throw new Error("QA SAFETY ABORT: Provisioning configuration rejected.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const privateFile = (name: string, value: string) => writeFileSync(path.join(secretsDir, name), value, { mode: 0o600, flag: "wx" });
  privateFile("root-password", rootPassword);
  privateFile("mysql-admin.cnf", `[client]\nuser=root\npassword=${rootPassword}\n`);
  privateFile("environment.json", JSON.stringify(env));
  privateFile("empty.env", "");
  const [image] = JSON.parse(docker(["image", "inspect", "mysql:8.0"]));
  if (!/^sha256:[a-f0-9]{64}$/.test(image.Id)) throw new Error("QA SAFETY ABORT: Expected cached MySQL 8.0 image unavailable.");
  const nonce = secret();
  const containerName = `hellocircle-${runId}`;
  const networkId = docker(["network", "create", "--driver", "bridge", "--label", `ie.hellocircle.qa.run=${runId}`, containerName]);
  const containerId = docker(["run", "-d", "--name", containerName, "--network", networkId,
    "--label", `ie.hellocircle.qa.run=${runId}`, "--label", `ie.hellocircle.qa.nonce=${nonce}`,
    "--publish", "127.0.0.1:13306:3306", "--tmpfs", "/var/lib/mysql:rw,nosuid,size=1g",
    "--mount", `type=bind,source=${secretsDir},target=/run/qa,readonly`,
    "--env", "MYSQL_ROOT_PASSWORD_FILE=/run/qa/root-password", image.Id]);
  const manifest: Manifest = { runId, nonce, databaseName: env.DB_NAME, serverUuid: "", containerId, containerName, imageId: image.Id, networkId, secretsDir, dataDir };
  // Persist recovery identity before readiness checks; never touch unrelated Docker resources.
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  verifyContainer(manifest);
  const admin = (sql: string) => docker(["exec", "-i", containerId, "mysql", "--defaults-extra-file=/run/qa/mysql-admin.cnf", "--batch", "--skip-column-names"], sql);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if (admin("SELECT 1") === "1") { ready = true; break; } } catch { /* bounded service readiness polling */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("QA SAFETY ABORT: Isolated MySQL did not become ready; no schema or persona setup attempted.");
  verifyContainer(manifest);
  // Root is used ONLY inside this newly created disposable container for account provisioning.
  const grantDatabase = env.DB_NAME.replaceAll("_", "\\_");
  admin(`CREATE DATABASE \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hello_circle_qa'@'%' IDENTIFIED BY '${env.DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON \`${grantDatabase}\`.* TO 'hello_circle_qa'@'%';
CREATE TABLE \`${env.DB_NAME}\`.qa_environment_identity (run_id VARCHAR(40) PRIMARY KEY, nonce VARCHAR(64) NOT NULL);
INSERT INTO \`${env.DB_NAME}\`.qa_environment_identity VALUES ('${runId}', '${nonce}');`);
  manifest.serverUuid = admin("SELECT @@server_uuid");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  const checked = await connectedPreflight();
  await checked.connection.end();
  console.log(`QA SAFE: disposable MySQL provisioned; database=${env.DB_NAME}; restricted user=hello_circle_qa. No application schema/personas seeded.`);
}

async function main() {
  if (process.argv[2] === "setup") return setup();
  if (process.argv[2] === "reset") {
    const release = acquireRunLock();
    try {
    const checked = await connectedPreflight();
    try {
      const [others] = await checked.connection.query<any[]>("SELECT ID FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID()");
      if (others.length) throw new Error("QA SAFETY ABORT: Other QA database connections exist; stop the backend/tests before reset.");
      verifyContainer(checked.manifest);
    } finally { await checked.connection.end(); }
    // Dispose only this exact verified container. No DROP/TRUNCATE/global DELETE exists.
    docker(["rm", "--force", checked.manifest.containerId]);
    docker(["network", "rm", checked.manifest.networkId]);
    renameSync(manifestPath, path.join(checked.manifest.dataDir, "retired-manifest.json"));
    console.log("Disposed verified QA container and its volatile database; retained local recovery metadata. Recreating an empty isolated run.");
    return await setup();
    } finally { release(); }
  }
  if (process.argv[2] !== "preflight") throw new Error("QA SAFETY ABORT: Unsupported database command.");
  const checked = await connectedPreflight();
  await checked.connection.end();
  console.log(`QA SAFE: connected database/container/grants verified (read-only). Schema ${checked.schemaReady ? "present" : "not initialized"}. Backend identity not yet verified.`);
}
main().catch((error) => { console.error(error instanceof Error && error.message.startsWith("QA ") ? error.message : "QA SAFETY ABORT: Operation failed; credential-bearing diagnostics suppressed."); process.exitCode = 1; });
